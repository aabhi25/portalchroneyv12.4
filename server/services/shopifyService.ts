interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  variants: {
    edges: {
      node: {
        id: string;
        price: string;
      };
    }[];
  };
  images: {
    edges: {
      node: {
        src: string;
      };
    }[];
  };
}

interface ShopifyProductsResponse {
  data: {
    products: {
      edges: {
        node: ShopifyProduct;
        cursor: string;
      }[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string;
      };
    };
  };
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        currentlyAvailable: number;
        maximumAvailable: number;
        restoreRate: number;
      };
    };
  };
}

export interface SimplifiedShopifyProduct {
  shopifyId: string;
  name: string;
  description: string;
  price: string | null;
  imageUrl: string | null;
}

export class ShopifyService {
  private storeUrl: string;
  private accessToken: string;

  constructor(storeUrl: string, accessToken: string) {
    this.storeUrl = storeUrl;
    this.accessToken = accessToken;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async makeGraphQLRequest(
    query: string,
    variables: any,
    retryCount: number = 0
  ): Promise<ShopifyProductsResponse> {
    const maxRetries = 3;
    const baseDelay = 1000;

    try {
      const response = await fetch(
        `https://${this.storeUrl}/admin/api/2025-10/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': this.accessToken,
          },
          body: JSON.stringify({ query, variables }),
        }
      );

      if (response.status === 429) {
        if (retryCount >= maxRetries) {
          throw new Error('Rate limit exceeded - max retries reached');
        }

        const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
        const delay = Math.max(retryAfter * 1000, baseDelay * Math.pow(2, retryCount));
        
        console.log(`[Shopify] Rate limited, retrying after ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await this.sleep(delay);
        
        return this.makeGraphQLRequest(query, variables, retryCount + 1);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
      }

      const result: any = await response.json();

      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e: any) => e.message).join(', ');
        
        const isFatalError = result.errors.some((e: any) => 
          e.message.includes('throttled') || 
          e.message.includes('access denied') ||
          e.message.includes('invalid')
        );
        
        if (isFatalError || !result.data) {
          throw new Error(`Shopify GraphQL errors: ${errorMessages}`);
        }
        
        console.log(`[Shopify] Non-fatal GraphQL warnings: ${errorMessages}`);
      }

      if (!result.data) {
        throw new Error('Invalid response from Shopify API - no data field');
      }

      if (result.extensions?.cost?.throttleStatus) {
        const throttle = result.extensions.cost.throttleStatus;
        const availablePercentage = (throttle.currentlyAvailable / throttle.maximumAvailable) * 100;
        
        if (availablePercentage < 25) {
          const pointsNeeded = throttle.maximumAvailable * 0.4 - throttle.currentlyAvailable;
          const waitTime = Math.ceil((pointsNeeded / throttle.restoreRate) * 1000);
          console.log(`[Shopify] Throttle status low (${availablePercentage.toFixed(1)}%), waiting ${waitTime}ms for budget to restore`);
          await this.sleep(Math.min(waitTime, 5000));
        }
      }

      return result as ShopifyProductsResponse;
    } catch (error: any) {
      if (retryCount < maxRetries && error.message.includes('ECONNRESET')) {
        const delay = baseDelay * Math.pow(2, retryCount);
        console.log(`[Shopify] Connection error, retrying after ${delay}ms`);
        await this.sleep(delay);
        return this.makeGraphQLRequest(query, variables, retryCount + 1);
      }
      throw error;
    }
  }

  async fetchProducts(pageSize: number = 250): Promise<SimplifiedShopifyProduct[]> {
    const allProducts: SimplifiedShopifyProduct[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let pageCount = 0;

    while (hasNextPage) {
      pageCount++;
      console.log(`[Shopify] Fetching page ${pageCount}${cursor ? ` (cursor: ${cursor.substring(0, 20)}...)` : ''}`);

      const query = `
        query GetProducts($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            edges {
              node {
                id
                title
                description
                variants(first: 1) {
                  edges {
                    node {
                      id
                      price
                    }
                  }
                }
                images(first: 1) {
                  edges {
                    node {
                      src
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const variables: any = { first: pageSize };
      if (cursor) {
        variables.after = cursor;
      }

      const result = await this.makeGraphQLRequest(query, variables);

      if (!result.data.products) {
        throw new Error('Invalid products response from Shopify API');
      }

      const products = result.data.products.edges.map((edge) => {
        const product = edge.node;
        const firstVariant = product.variants.edges[0]?.node;
        const firstImage = product.images.edges[0]?.node;

        return {
          shopifyId: product.id,
          name: product.title,
          description: product.description || '',
          price: firstVariant?.price || null,
          imageUrl: firstImage?.src || null,
        };
      });

      allProducts.push(...products);
      
      hasNextPage = result.data.products.pageInfo.hasNextPage;
      cursor = result.data.products.pageInfo.endCursor;

      console.log(`[Shopify] Fetched ${products.length} products (total: ${allProducts.length})`);

      if (hasNextPage) {
        await this.sleep(500);
      }
    }

    console.log(`[Shopify] Completed fetching all products: ${allProducts.length} total across ${pageCount} pages`);
    return allProducts;
  }

  async testConnection(): Promise<boolean> {
    try {
      const query = `
        query {
          shop {
            name
          }
        }
      `;

      console.log(`[Shopify] Testing connection to: https://${this.storeUrl}/admin/api/2025-10/graphql.json`);
      console.log(`[Shopify] Access token length: ${this.accessToken?.length || 0}`);
      console.log(`[Shopify] Access token starts with: ${this.accessToken?.substring(0, 6)}...`);

      const response = await fetch(
        `https://${this.storeUrl}/admin/api/2025-10/graphql.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': this.accessToken,
          },
          body: JSON.stringify({ query }),
        }
      );

      console.log(`[Shopify] Connection test response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Shopify] Connection test failed - Status ${response.status}:`, errorText);
        
        if (response.status === 401) {
          console.error('[Shopify] Authentication failed. Please verify:');
          console.error('  1. Your access token is correct and starts with "shpat_"');
          console.error('  2. The custom app has "read_products" permission enabled');
          console.error('  3. The app is installed in your Shopify store');
        }
        
        return false;
      }

      const result: any = await response.json();
      
      if (result.errors && result.errors.length > 0) {
        console.error('[Shopify] Connection test GraphQL errors:', JSON.stringify(result.errors, null, 2));
        return false;
      }

      if (result.data?.shop?.name) {
        console.log(`[Shopify] Connection test successful - Connected to shop: ${result.data.shop.name}`);
        return true;
      }

      console.error('[Shopify] Connection test failed - Unexpected response format:', JSON.stringify(result, null, 2));
      return false;
    } catch (error: any) {
      console.error('[Shopify] Connection test exception:', error.message, error.stack);
      return false;
    }
  }
}
