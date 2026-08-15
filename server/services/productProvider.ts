import { db } from "../db";
import { 
  products, 
  erpConfigurations, 
  erpProductCache,
  productEmbeddings,
  categories,
  ErpConfiguration,
  ErpProductCache,
  Product 
} from "@shared/schema";
import { eq, and, gte, lte, ilike, or, sql, desc } from "drizzle-orm";
import { ErpClient, ErpProduct, createErpClient } from "./erpClient";

export type ProductSource = "local" | "erp" | "shopify";

export interface NormalizedProduct {
  id: string;
  erpProductId?: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  category?: string;
  subcategory?: string;
  imageUrl?: string;
  images?: string[];
  sku?: string;
  inStock?: boolean;
  weight?: string;
  metal?: string;
  source: ProductSource;
  additionalAttributes?: Record<string, any>;
}

export interface ProductSearchParams {
  query?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  perPage?: number;
}

export interface ProductSearchResult {
  products: NormalizedProduct[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
  source: ProductSource;
}

export interface ProductProviderConfig {
  businessAccountId: string;
  preferredSource?: ProductSource;
}

export class ProductProvider {
  private businessAccountId: string;
  private erpConfig: ErpConfiguration | null = null;
  private erpClient: ErpClient | null = null;
  private preferredSource: ProductSource;

  constructor(config: ProductProviderConfig) {
    this.businessAccountId = config.businessAccountId;
    this.preferredSource = config.preferredSource || "local";
  }

  async initialize(): Promise<void> {
    const [erpConfig] = await db
      .select()
      .from(erpConfigurations)
      .where(
        and(
          eq(erpConfigurations.businessAccountId, this.businessAccountId),
          eq(erpConfigurations.isActive, "true")
        )
      )
      .limit(1);

    if (erpConfig) {
      this.erpConfig = erpConfig;
      this.erpClient = await createErpClient(erpConfig);
      this.preferredSource = "erp";
    }
  }

  getSource(): ProductSource {
    return this.preferredSource;
  }

  hasErpEnabled(): boolean {
    return this.erpClient !== null && this.erpConfig !== null;
  }

  private normalizeLocalProduct(product: Product): NormalizedProduct {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price ? parseFloat(product.price) : undefined,
      imageUrl: product.imageUrl || undefined,
      images: product.imageUrl ? [product.imageUrl] : [],
      source: product.source === "shopify" ? "shopify" : "local",
    };
  }

  private normalizeErpProduct(product: ErpProduct): NormalizedProduct {
    return {
      id: product.id,
      erpProductId: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency,
      category: product.category,
      subcategory: product.subcategory,
      imageUrl: product.images?.[0],
      images: product.images,
      sku: product.sku,
      inStock: product.inStock,
      weight: product.weight,
      metal: product.metal,
      source: "erp",
      additionalAttributes: product.additionalAttributes,
    };
  }

  private normalizeCachedProduct(cached: ErpProductCache): NormalizedProduct {
    const images = (cached.images as string[]) || [];
    return {
      id: cached.id,
      erpProductId: cached.erpProductId,
      name: cached.name,
      description: cached.description || undefined,
      price: cached.price ? parseFloat(cached.price) : undefined,
      currency: cached.currency || "INR",
      category: cached.category || undefined,
      subcategory: cached.subcategory || undefined,
      imageUrl: images[0],
      images,
      sku: cached.sku || undefined,
      inStock: cached.inStock === "true",
      weight: cached.weight || undefined,
      metal: cached.metal || undefined,
      source: "erp",
      additionalAttributes: (cached.additionalAttributes as Record<string, any>) || undefined,
    };
  }

  async searchProducts(params: ProductSearchParams): Promise<ProductSearchResult> {
    const { query, categoryId, minPrice, maxPrice, page = 1, perPage = 20 } = params;

    if (this.hasErpEnabled() && this.erpConfig?.cacheEnabled === "true") {
      return this.searchCachedProducts(params);
    }

    if (this.hasErpEnabled() && this.erpClient) {
      try {
        const erpResult = await this.erpClient.searchProducts(
          query,
          categoryId,
          minPrice,
          maxPrice,
          page,
          perPage
        );

        return {
          products: erpResult.products.map(p => this.normalizeErpProduct(p)),
          pagination: erpResult.pagination,
          source: "erp",
        };
      } catch (error) {
        console.error("ERP search failed, falling back to cache:", error);
        return this.searchCachedProducts(params);
      }
    }

    return this.searchLocalProducts(params);
  }

  private async searchCachedProducts(params: ProductSearchParams): Promise<ProductSearchResult> {
    const { query, categoryId, minPrice, maxPrice, page = 1, perPage = 20 } = params;
    const offset = (page - 1) * perPage;

    const conditions = [
      eq(erpProductCache.businessAccountId, this.businessAccountId),
      eq(erpProductCache.isValid, "true"),
    ];

    if (query) {
      conditions.push(
        or(
          ilike(erpProductCache.name, `%${query}%`),
          ilike(erpProductCache.sku, `%${query}%`),
          ilike(erpProductCache.description, `%${query}%`)
        )!
      );
    }

    if (categoryId) {
      conditions.push(eq(erpProductCache.category, categoryId));
    }

    if (minPrice !== undefined) {
      conditions.push(gte(erpProductCache.price, String(minPrice)));
    }

    if (maxPrice !== undefined) {
      conditions.push(lte(erpProductCache.price, String(maxPrice)));
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(erpProductCache)
      .where(and(...conditions));

    const total = Number(countResult?.count || 0);

    const cachedProducts = await db
      .select()
      .from(erpProductCache)
      .where(and(...conditions))
      .orderBy(desc(erpProductCache.cachedAt))
      .limit(perPage)
      .offset(offset);

    return {
      products: cachedProducts.map(p => this.normalizeCachedProduct(p)),
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
      source: "erp",
    };
  }

  private async searchLocalProducts(params: ProductSearchParams): Promise<ProductSearchResult> {
    const { query, categoryId, minPrice, maxPrice, page = 1, perPage = 20 } = params;
    const offset = (page - 1) * perPage;

    const conditions = [eq(products.businessAccountId, this.businessAccountId)];

    if (query) {
      conditions.push(
        or(
          ilike(products.name, `%${query}%`),
          ilike(products.description, `%${query}%`)
        )!
      );
    }

    if (minPrice !== undefined) {
      conditions.push(gte(products.price, String(minPrice)));
    }

    if (maxPrice !== undefined) {
      conditions.push(lte(products.price, String(maxPrice)));
    }

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(and(...conditions));

    const total = Number(countResult?.count || 0);

    const localProducts = await db
      .select()
      .from(products)
      .where(and(...conditions))
      .orderBy(desc(products.createdAt))
      .limit(perPage)
      .offset(offset);

    return {
      products: localProducts.map(p => this.normalizeLocalProduct(p)),
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
      source: "local",
    };
  }

  async getProductById(productId: string): Promise<NormalizedProduct | null> {
    if (this.hasErpEnabled() && this.erpClient) {
      try {
        const product = await this.erpClient.getProductById(productId);
        if (product) {
          return this.normalizeErpProduct(product);
        }
      } catch (error) {
        console.error("Failed to fetch product from ERP:", error);
      }

      const [cached] = await db
        .select()
        .from(erpProductCache)
        .where(
          and(
            eq(erpProductCache.businessAccountId, this.businessAccountId),
            eq(erpProductCache.erpProductId, productId)
          )
        )
        .limit(1);

      if (cached) {
        return this.normalizeCachedProduct(cached);
      }
    }

    const [localProduct] = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.businessAccountId, this.businessAccountId),
          eq(products.id, productId)
        )
      )
      .limit(1);

    if (localProduct) {
      return this.normalizeLocalProduct(localProduct);
    }

    return null;
  }

  async getProductsByIds(productIds: string[]): Promise<NormalizedProduct[]> {
    const results: NormalizedProduct[] = [];

    for (const id of productIds) {
      const product = await this.getProductById(id);
      if (product) {
        results.push(product);
      }
    }

    return results;
  }

  async getCategories(): Promise<{ id: string; name: string }[]> {
    if (this.hasErpEnabled() && this.erpClient) {
      try {
        const erpCategories = await this.erpClient.getCategories();
        return erpCategories.map(c => ({ id: c.id, name: c.name }));
      } catch (error) {
        console.error("Failed to fetch categories from ERP:", error);
      }
    }

    const localCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.businessAccountId, this.businessAccountId));

    return localCategories.map(c => ({ id: c.id, name: c.name }));
  }

  async getPriceRange(): Promise<{ min: number; max: number; avg: number }> {
    if (this.hasErpEnabled()) {
      const [result] = await db
        .select({
          min: sql<number>`COALESCE(MIN(CAST(price AS DECIMAL)), 0)`,
          max: sql<number>`COALESCE(MAX(CAST(price AS DECIMAL)), 0)`,
          avg: sql<number>`COALESCE(AVG(CAST(price AS DECIMAL)), 0)`,
        })
        .from(erpProductCache)
        .where(
          and(
            eq(erpProductCache.businessAccountId, this.businessAccountId),
            eq(erpProductCache.isValid, "true")
          )
        );

      return {
        min: Number(result?.min || 0),
        max: Number(result?.max || 0),
        avg: Number(result?.avg || 0),
      };
    }

    const [result] = await db
      .select({
        min: sql<number>`COALESCE(MIN(CAST(price AS DECIMAL)), 0)`,
        max: sql<number>`COALESCE(MAX(CAST(price AS DECIMAL)), 0)`,
        avg: sql<number>`COALESCE(AVG(CAST(price AS DECIMAL)), 0)`,
      })
      .from(products)
      .where(eq(products.businessAccountId, this.businessAccountId));

    return {
      min: Number(result?.min || 0),
      max: Number(result?.max || 0),
      avg: Number(result?.avg || 0),
    };
  }

  async getProductCount(): Promise<number> {
    if (this.hasErpEnabled()) {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(erpProductCache)
        .where(
          and(
            eq(erpProductCache.businessAccountId, this.businessAccountId),
            eq(erpProductCache.isValid, "true")
          )
        );

      return Number(result?.count || 0);
    }

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(eq(products.businessAccountId, this.businessAccountId));

    return Number(result?.count || 0);
  }
}

export async function createProductProvider(businessAccountId: string): Promise<ProductProvider> {
  const provider = new ProductProvider({ businessAccountId });
  await provider.initialize();
  return provider;
}
