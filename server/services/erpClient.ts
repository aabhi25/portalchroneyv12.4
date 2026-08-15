import { ErpConfiguration } from "@shared/schema";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-encryption-key-32chars!";

export interface ErpProduct {
  id: string;
  sku?: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  category?: string;
  subcategory?: string;
  images: string[];
  inStock?: boolean;
  weight?: string;
  metal?: string;
  updatedAt?: string;
  additionalAttributes?: Record<string, any>;
}

export interface ErpCategory {
  id: string;
  name: string;
  parentId?: string;
}

export interface ErpProductsResponse {
  products: ErpProduct[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

export interface ErpApiError {
  code: string;
  message: string;
  details?: any;
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(encryptedText: string): string {
  try {
    const [ivHex, encrypted] = encryptedText.split(":");
    if (!ivHex || !encrypted) return encryptedText;
    const iv = Buffer.from(ivHex, "hex");
    const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return encryptedText;
  }
}

export function encryptCredentials(value: string): string {
  return encrypt(value);
}

export function decryptCredentials(value: string): string {
  return decrypt(value);
}

export class ErpClient {
  private config: ErpConfiguration;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: ErpConfiguration) {
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.headers = this.buildHeaders();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    switch (this.config.authType) {
      case "api_key":
        if (this.config.apiKey) {
          const decryptedKey = decryptCredentials(this.config.apiKey);
          headers["X-API-Key"] = decryptedKey;
          headers["Authorization"] = `ApiKey ${decryptedKey}`;
        }
        break;
      case "bearer_token":
        if (this.config.accessToken) {
          headers["Authorization"] = `Bearer ${decryptCredentials(this.config.accessToken)}`;
        }
        break;
      case "basic":
        if (this.config.basicAuthUsername && this.config.basicAuthPassword) {
          const credentials = Buffer.from(
            `${this.config.basicAuthUsername}:${decryptCredentials(this.config.basicAuthPassword)}`
          ).toString("base64");
          headers["Authorization"] = `Basic ${credentials}`;
        }
        break;
    }

    return headers;
  }

  private mapErpProduct(erpData: any): ErpProduct {
    const mapping = (this.config.fieldMapping as Record<string, string>) || {};
    
    const getValue = (field: string, defaultKey: string) => {
      const mappedKey = mapping[field] || defaultKey;
      return erpData[mappedKey];
    };

    let images: string[] = [];
    const imageField = getValue("images", "images");
    if (Array.isArray(imageField)) {
      images = imageField;
    } else if (typeof imageField === "string") {
      images = [imageField];
    } else if (erpData.image) {
      images = [erpData.image];
    } else if (erpData.imageUrl) {
      images = [erpData.imageUrl];
    } else if (erpData.image_url) {
      images = [erpData.image_url];
    }

    return {
      id: String(getValue("id", "id") || erpData.productId || erpData.product_id),
      sku: getValue("sku", "sku") || erpData.designNo || erpData.design_no,
      name: getValue("name", "name") || erpData.title || erpData.productName || erpData.product_name,
      description: getValue("description", "description") || erpData.desc,
      price: parseFloat(getValue("price", "price") || "0") || undefined,
      currency: getValue("currency", "currency") || "INR",
      category: getValue("category", "category") || erpData.categoryName || erpData.category_name,
      subcategory: getValue("subcategory", "subcategory") || erpData.subCategory || erpData.sub_category,
      images,
      inStock: getValue("inStock", "inStock") !== false && getValue("inStock", "inStock") !== "false",
      weight: getValue("weight", "weight") || erpData.grossWeight || erpData.gross_weight,
      metal: getValue("metal", "metal") || erpData.metalType || erpData.metal_type,
      updatedAt: getValue("updatedAt", "updatedAt") || erpData.updated_at || erpData.modifiedAt,
      additionalAttributes: erpData,
    };
  }

  async testConnection(): Promise<{ success: boolean; message: string; productCount?: number }> {
    try {
      const endpoint = this.config.productsEndpoint || "/products";
      const url = `${this.baseUrl}${endpoint}?page=1&per_page=1&limit=1`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          message: `API returned ${response.status}: ${errorText.substring(0, 200)}`,
        };
      }

      const data = await response.json();
      
      let productCount: number | undefined;
      if (data.pagination?.total) {
        productCount = data.pagination.total;
      } else if (data.meta?.total) {
        productCount = data.meta.total;
      } else if (data.total) {
        productCount = data.total;
      } else if (Array.isArray(data.products)) {
        productCount = data.products.length;
      } else if (Array.isArray(data.data)) {
        productCount = data.data.length;
      } else if (Array.isArray(data)) {
        productCount = data.length;
      }

      return {
        success: true,
        message: "Connection successful",
        productCount,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || "Connection failed",
      };
    }
  }

  async getProducts(page: number = 1, perPage: number = 100): Promise<ErpProductsResponse> {
    const endpoint = this.config.productsEndpoint || "/products";
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("limit", String(perPage));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ERP API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    let rawProducts: any[] = [];
    if (Array.isArray(data.products)) {
      rawProducts = data.products;
    } else if (Array.isArray(data.data)) {
      rawProducts = data.data;
    } else if (Array.isArray(data.items)) {
      rawProducts = data.items;
    } else if (Array.isArray(data)) {
      rawProducts = data;
    }

    const products = rawProducts.map(p => this.mapErpProduct(p));

    let total = 0;
    let totalPages = 1;
    if (data.pagination) {
      total = data.pagination.total || data.pagination.totalCount || rawProducts.length;
      totalPages = data.pagination.totalPages || data.pagination.total_pages || Math.ceil(total / perPage);
    } else if (data.meta) {
      total = data.meta.total || data.meta.totalCount || rawProducts.length;
      totalPages = data.meta.totalPages || data.meta.total_pages || Math.ceil(total / perPage);
    } else {
      total = data.total || rawProducts.length;
      totalPages = data.totalPages || Math.ceil(total / perPage);
    }

    return {
      products,
      pagination: {
        page,
        perPage,
        total,
        totalPages,
      },
    };
  }

  async getProductById(productId: string): Promise<ErpProduct | null> {
    const endpoint = (this.config.productDetailEndpoint || "/products/{id}").replace("{id}", productId);
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`ERP API error ${response.status}`);
      }

      const data = await response.json();
      const rawProduct = data.product || data.data || data;
      return this.mapErpProduct(rawProduct);
    } catch (error) {
      console.error(`Failed to fetch product ${productId} from ERP:`, error);
      return null;
    }
  }

  async getUpdatedProducts(since: Date, page: number = 1, perPage: number = 100): Promise<ErpProductsResponse> {
    if (!this.config.deltaSyncEndpoint) {
      return this.getProducts(page, perPage);
    }

    const endpoint = this.config.deltaSyncEndpoint;
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("updated_since", since.toISOString());
    url.searchParams.set("since", since.toISOString());

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`ERP API error ${response.status}`);
    }

    const data = await response.json();
    
    let rawProducts: any[] = [];
    if (Array.isArray(data.products)) {
      rawProducts = data.products;
    } else if (Array.isArray(data.data)) {
      rawProducts = data.data;
    } else if (Array.isArray(data)) {
      rawProducts = data;
    }

    const products = rawProducts.map(p => this.mapErpProduct(p));

    return {
      products,
      pagination: {
        page,
        perPage,
        total: data.pagination?.total || data.total || products.length,
        totalPages: data.pagination?.totalPages || Math.ceil((data.total || products.length) / perPage),
      },
    };
  }

  async getCategories(): Promise<ErpCategory[]> {
    if (!this.config.categoriesEndpoint) {
      return [];
    }

    const url = `${this.baseUrl}${this.config.categoriesEndpoint}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const rawCategories = data.categories || data.data || data;

      if (!Array.isArray(rawCategories)) {
        return [];
      }

      return rawCategories.map(c => ({
        id: String(c.id || c.categoryId || c.category_id),
        name: c.name || c.categoryName || c.category_name || c.title,
        parentId: c.parentId || c.parent_id,
      }));
    } catch {
      return [];
    }
  }

  async searchProducts(
    query?: string,
    categoryId?: string,
    minPrice?: number,
    maxPrice?: number,
    page: number = 1,
    perPage: number = 20
  ): Promise<ErpProductsResponse> {
    const endpoint = this.config.productsEndpoint || "/products";
    const url = new URL(`${this.baseUrl}${endpoint}`);
    
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("limit", String(perPage));
    
    if (query) {
      url.searchParams.set("search", query);
      url.searchParams.set("q", query);
    }
    if (categoryId) {
      url.searchParams.set("category", categoryId);
      url.searchParams.set("category_id", categoryId);
    }
    if (minPrice !== undefined) {
      url.searchParams.set("min_price", String(minPrice));
    }
    if (maxPrice !== undefined) {
      url.searchParams.set("max_price", String(maxPrice));
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`ERP API error ${response.status}`);
    }

    const data = await response.json();
    
    let rawProducts: any[] = [];
    if (Array.isArray(data.products)) {
      rawProducts = data.products;
    } else if (Array.isArray(data.data)) {
      rawProducts = data.data;
    } else if (Array.isArray(data.items)) {
      rawProducts = data.items;
    } else if (Array.isArray(data)) {
      rawProducts = data;
    }

    const products = rawProducts.map(p => this.mapErpProduct(p));

    return {
      products,
      pagination: {
        page,
        perPage,
        total: data.pagination?.total || data.total || products.length,
        totalPages: data.pagination?.totalPages || Math.ceil((data.total || products.length) / perPage),
      },
    };
  }

  async getAllProducts(batchSize?: number): Promise<ErpProduct[]> {
    const allProducts: ErpProduct[] = [];
    const perPage = batchSize || this.config.batchSize || 500;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getProducts(page, perPage);
      allProducts.push(...response.products);
      
      if (page >= response.pagination.totalPages || response.products.length === 0) {
        hasMore = false;
      } else {
        page++;
      }

      if (page > 200) {
        console.warn("Stopping pagination at 200 pages to prevent infinite loop");
        break;
      }
    }

    return allProducts;
  }
}

export async function createErpClient(config: ErpConfiguration): Promise<ErpClient> {
  return new ErpClient(config);
}
