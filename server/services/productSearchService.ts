import { GoogleAuth } from 'google-auth-library';
import { decrypt } from './encryptionService';

interface ProductSearchConfig {
  projectId: string;
  location: string;
  productSetId: string;
}

interface SearchResult {
  productId: string;
  productName: string;
  score: number;
  imageUri: string;
  productLabels: Record<string, string>;
}

interface ProductInfo {
  name: string;
  displayName: string;
  description?: string;
  productCategory: string;
  productLabels: { key: string; value: string }[];
}

const AUTH_CACHE_TTL = 55 * 60 * 1000;
const authClientCache = new Map<string, { auth: GoogleAuth; credentials: any; expiresAt: number }>();

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.log(`[ProductSearch] Retrying after ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delayMs);
        continue;
      }
      
      return response;
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.log(`[ProductSearch] Network error, retrying after ${delayMs}ms: ${error.message}`);
        await sleep(delayMs);
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

class ProductSearchService {
  private parseCredentials(encryptedOrPlainCredentials: string): any {
    if (!encryptedOrPlainCredentials) {
      throw new Error('Product Search credentials not configured');
    }

    try {
      const decrypted = decrypt(encryptedOrPlainCredentials);
      return JSON.parse(decrypted);
    } catch (decryptError) {
      try {
        return JSON.parse(encryptedOrPlainCredentials);
      } catch (parseError) {
        throw new Error('Failed to parse Product Search credentials');
      }
    }
  }

  private async getAuthClientForCredentials(encryptedCredentials: string): Promise<{ auth: GoogleAuth; credentials: any }> {
    const cacheKey = encryptedCredentials.substring(0, 32);
    const cached = authClientCache.get(cacheKey);
    
    if (cached && cached.expiresAt > Date.now()) {
      return { auth: cached.auth, credentials: cached.credentials };
    }

    const credentials = this.parseCredentials(encryptedCredentials);
    
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    
    authClientCache.set(cacheKey, {
      auth,
      credentials,
      expiresAt: Date.now() + AUTH_CACHE_TTL
    });
    
    return { auth, credentials };
  }

  private async getAccessToken(encryptedCredentials: string): Promise<string> {
    const { auth } = await this.getAuthClientForCredentials(encryptedCredentials);
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    
    if (!tokenResponse.token) {
      throw new Error('Failed to get access token');
    }
    
    return tokenResponse.token;
  }

  async testConnection(config: ProductSearchConfig, encryptedCredentials: string): Promise<{ success: boolean; message: string; productSetExists?: boolean }> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      const { projectId, location } = config;
      
      const url = `https://vision.googleapis.com/v1/projects/${projectId}/locations/${location}/productSets`;
      
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, message: `API Error: ${response.status} - ${errorText}` };
      }
      
      const data = await response.json();
      const productSets = data.productSets || [];
      
      if (config.productSetId) {
        const exists = productSets.some((ps: any) => ps.name.endsWith(`/${config.productSetId}`));
        return { 
          success: true, 
          message: exists ? 'Connection successful, Product Set found' : 'Connection successful, but Product Set not found',
          productSetExists: exists
        };
      }
      
      return { success: true, message: `Connection successful. Found ${productSets.length} product sets.` };
    } catch (error: any) {
      console.error('[ProductSearch] Connection test failed:', error);
      return { success: false, message: error.message || 'Connection failed' };
    }
  }

  async createProductSet(
    projectId: string,
    location: string,
    productSetId: string,
    displayName: string,
    encryptedCredentials: string
  ): Promise<{ success: boolean; name?: string; error?: string }> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      
      const url = `https://vision.googleapis.com/v1/projects/${projectId}/locations/${location}/productSets?productSetId=${productSetId}`;
      
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: displayName,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 409) {
          return { success: true, name: `projects/${projectId}/locations/${location}/productSets/${productSetId}` };
        }
        return { success: false, error: `Failed to create product set: ${response.status} - ${errorText}` };
      }
      
      const data = await response.json();
      console.log('[ProductSearch] Created product set:', data.name);
      return { success: true, name: data.name };
    } catch (error: any) {
      console.error('[ProductSearch] Failed to create product set:', error);
      return { success: false, error: error.message };
    }
  }

  async createProduct(
    projectId: string,
    location: string,
    productId: string,
    displayName: string,
    description: string,
    productCategory: string,
    labels: { key: string; value: string }[],
    encryptedCredentials: string
  ): Promise<{ success: boolean; name?: string; error?: string }> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      
      const url = `https://vision.googleapis.com/v1/projects/${projectId}/locations/${location}/products?productId=${productId}`;
      
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: displayName.substring(0, 100),
          description: description?.substring(0, 4096) || '',
          productCategory: productCategory,
          productLabels: labels,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 409) {
          return { success: true, name: `projects/${projectId}/locations/${location}/products/${productId}` };
        }
        return { success: false, error: `Failed to create product: ${response.status} - ${errorText}` };
      }
      
      const data = await response.json();
      return { success: true, name: data.name };
    } catch (error: any) {
      console.error('[ProductSearch] Failed to create product:', error);
      return { success: false, error: error.message };
    }
  }

  async addProductToProductSet(
    projectId: string,
    location: string,
    productSetId: string,
    productId: string,
    encryptedCredentials: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      
      const productSetName = `projects/${projectId}/locations/${location}/productSets/${productSetId}`;
      const productName = `projects/${projectId}/locations/${location}/products/${productId}`;
      
      const url = `https://vision.googleapis.com/v1/${productSetName}:addProduct`;
      
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          product: productName,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 409 || errorText.includes('already exists')) {
          return { success: true };
        }
        return { success: false, error: `Failed to add product to set: ${response.status} - ${errorText}` };
      }
      
      return { success: true };
    } catch (error: any) {
      console.error('[ProductSearch] Failed to add product to set:', error);
      return { success: false, error: error.message };
    }
  }

  async createReferenceImage(
    projectId: string,
    location: string,
    productId: string,
    referenceImageId: string,
    imageUri: string,
    encryptedCredentials: string
  ): Promise<{ success: boolean; name?: string; error?: string }> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      
      const productName = `projects/${projectId}/locations/${location}/products/${productId}`;
      const url = `https://vision.googleapis.com/v1/${productName}/referenceImages?referenceImageId=${referenceImageId}`;
      
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uri: imageUri,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 409) {
          return { success: true, name: `${productName}/referenceImages/${referenceImageId}` };
        }
        return { success: false, error: `Failed to create reference image: ${response.status} - ${errorText}` };
      }
      
      const data = await response.json();
      return { success: true, name: data.name };
    } catch (error: any) {
      console.error('[ProductSearch] Failed to create reference image:', error);
      return { success: false, error: error.message };
    }
  }

  async searchByImage(
    projectId: string,
    location: string,
    productSetId: string,
    imageContent: string,
    encryptedCredentials: string,
    maxResults: number = 10,
    filter?: string
  ): Promise<SearchResult[]> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      
      const productSetPath = `projects/${projectId}/locations/${location}/productSets/${productSetId}`;
      
      const url = `https://vision.googleapis.com/v1/images:annotate`;
      
      const requestBody: any = {
        requests: [{
          image: {
            content: imageContent,
          },
          features: [{
            type: 'PRODUCT_SEARCH',
            maxResults: maxResults,
          }],
          imageContext: {
            productSearchParams: {
              productSet: productSetPath,
              productCategories: ['general'],
              filter: filter || '',
            },
          },
        }],
      };
      
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to search by image: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      const results: SearchResult[] = [];
      
      const annotations = data.responses?.[0]?.productSearchResults;
      if (annotations?.results) {
        for (const result of annotations.results) {
          const product = result.product;
          if (product) {
            const productId = product.name.split('/').pop() || '';
            const labels: Record<string, string> = {};
            
            if (product.productLabels) {
              for (const label of product.productLabels) {
                labels[label.key] = label.value;
              }
            }
            
            results.push({
              productId: productId,
              productName: product.displayName || '',
              score: result.score || 0,
              imageUri: result.image || '',
              productLabels: labels,
            });
          }
        }
      }
      
      console.log(`[ProductSearch] Search returned ${results.length} results`);
      return results;
    } catch (error: any) {
      console.error('[ProductSearch] Search failed:', error);
      throw error;
    }
  }

  async searchByImageUrl(
    projectId: string,
    location: string,
    productSetId: string,
    imageUrl: string,
    encryptedCredentials: string,
    maxResults: number = 10
  ): Promise<SearchResult[]> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      
      const productSetPath = `projects/${projectId}/locations/${location}/productSets/${productSetId}`;
      
      const url = `https://vision.googleapis.com/v1/images:annotate`;
      
      const requestBody = {
        requests: [{
          image: {
            source: {
              imageUri: imageUrl,
            },
          },
          features: [{
            type: 'PRODUCT_SEARCH',
            maxResults: maxResults,
          }],
          imageContext: {
            productSearchParams: {
              productSet: productSetPath,
              productCategories: ['general'],
            },
          },
        }],
      };
      
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to search by image URL: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      const results: SearchResult[] = [];
      
      const annotations = data.responses?.[0]?.productSearchResults;
      if (annotations?.results) {
        for (const result of annotations.results) {
          const product = result.product;
          if (product) {
            const productId = product.name.split('/').pop() || '';
            const labels: Record<string, string> = {};
            
            if (product.productLabels) {
              for (const label of product.productLabels) {
                labels[label.key] = label.value;
              }
            }
            
            results.push({
              productId: productId,
              productName: product.displayName || '',
              score: result.score || 0,
              imageUri: result.image || '',
              productLabels: labels,
            });
          }
        }
      }
      
      console.log(`[ProductSearch] URL Search returned ${results.length} results`);
      return results;
    } catch (error: any) {
      console.error('[ProductSearch] URL Search failed:', error);
      throw error;
    }
  }

  async deleteProduct(
    projectId: string,
    location: string,
    productId: string,
    encryptedCredentials: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      
      const productName = `projects/${projectId}/locations/${location}/products/${productId}`;
      const url = `https://vision.googleapis.com/v1/${productName}`;
      
      const response = await fetchWithRetry(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        return { success: false, error: `Failed to delete product: ${response.status} - ${errorText}` };
      }
      
      return { success: true };
    } catch (error: any) {
      console.error('[ProductSearch] Failed to delete product:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteProductSet(
    projectId: string,
    location: string,
    productSetId: string,
    encryptedCredentials: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      
      const productSetName = `projects/${projectId}/locations/${location}/productSets/${productSetId}`;
      const url = `https://vision.googleapis.com/v1/${productSetName}`;
      
      const response = await fetchWithRetry(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        return { success: false, error: `Failed to delete product set: ${response.status} - ${errorText}` };
      }
      
      return { success: true };
    } catch (error: any) {
      console.error('[ProductSearch] Failed to delete product set:', error);
      return { success: false, error: error.message };
    }
  }

  async listProducts(
    projectId: string,
    location: string,
    productSetId: string,
    encryptedCredentials: string
  ): Promise<{ products: ProductInfo[]; error?: string }> {
    try {
      const token = await this.getAccessToken(encryptedCredentials);
      
      const productSetName = `projects/${projectId}/locations/${location}/productSets/${productSetId}`;
      const url = `https://vision.googleapis.com/v1/${productSetName}/products`;
      
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return { products: [], error: `Failed to list products: ${response.status} - ${errorText}` };
      }
      
      const data = await response.json();
      const products: ProductInfo[] = [];
      
      if (data.products) {
        for (const product of data.products) {
          products.push({
            name: product.name,
            displayName: product.displayName || '',
            description: product.description || '',
            productCategory: product.productCategory || 'general',
            productLabels: product.productLabels || [],
          });
        }
      }
      
      return { products };
    } catch (error: any) {
      console.error('[ProductSearch] Failed to list products:', error);
      return { products: [], error: error.message };
    }
  }

  async getSyncStatus(
    projectId: string,
    location: string,
    productSetId: string,
    encryptedCredentials: string,
    totalLocalProducts: number
  ): Promise<{ totalProducts: number; syncedProducts: number; pendingProducts: number }> {
    try {
      const { products, error } = await this.listProducts(projectId, location, productSetId, encryptedCredentials);
      
      if (error) {
        console.error('[ProductSearch] Failed to get sync status:', error);
        return { totalProducts: totalLocalProducts, syncedProducts: 0, pendingProducts: totalLocalProducts };
      }
      
      const syncedProducts = products.length;
      
      return {
        totalProducts: totalLocalProducts,
        syncedProducts,
        pendingProducts: Math.max(0, totalLocalProducts - syncedProducts),
      };
    } catch (error: any) {
      console.error('[ProductSearch] Failed to get sync status:', error);
      return { totalProducts: totalLocalProducts, syncedProducts: 0, pendingProducts: totalLocalProducts };
    }
  }
}

export const productSearchService = new ProductSearchService();
