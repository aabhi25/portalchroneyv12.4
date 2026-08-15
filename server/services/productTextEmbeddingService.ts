import { storage } from "../storage";
import { embeddingService } from "./embeddingService";
import { db } from "../db";
import { products } from "../../shared/schema";
import { eq, isNull, and, sql } from "drizzle-orm";

/**
 * Service for generating and managing text embeddings for products
 * Used for semantic product search via vector similarity
 */
export class ProductTextEmbeddingService {
  
  /**
   * Generate text embedding for a single product (title + description)
   * @param productId - Product ID to generate embedding for
   * @param businessAccountId - Business account ID for OpenAI API key
   */
  async generateEmbeddingForProduct(productId: string, businessAccountId: string): Promise<void> {
    const product = await storage.getProduct(productId, businessAccountId);
    if (!product) {
      console.error(`[Product Embedding] Product not found: ${productId}`);
      return;
    }
    
    // Combine title and description for richer semantic representation
    const textToEmbed = `${product.name}. ${product.description || ''}`.trim();
    
    if (!textToEmbed || textToEmbed.length < 3) {
      console.log(`[Product Embedding] Skipping product ${productId} - insufficient text`);
      return;
    }
    
    try {
      const embedding = await embeddingService.generateEmbedding(textToEmbed, businessAccountId);
      
      // Update product with embedding
      await db.update(products)
        .set({
          textEmbedding: embedding,
          textEmbeddingGeneratedAt: new Date(),
        })
        .where(eq(products.id, productId));
      
      console.log(`[Product Embedding] Generated embedding for: ${product.name}`);
    } catch (error: any) {
      console.error(`[Product Embedding] Failed for ${productId}:`, error.message);
      throw error;
    }
  }
  
  /**
   * Generate embeddings for all products of a business that don't have one
   * @param businessAccountId - Business account ID
   * @param batchSize - Number of products to process in parallel
   */
  async backfillEmbeddingsForBusiness(businessAccountId: string, batchSize: number = 10): Promise<{processed: number, failed: number}> {
    // Get products without text embedding
    const productsWithoutEmbedding = await db.select({
      id: products.id,
      name: products.name,
    })
    .from(products)
    .where(and(
      eq(products.businessAccountId, businessAccountId),
      isNull(products.textEmbedding)
    ));
    
    console.log(`[Product Embedding] Found ${productsWithoutEmbedding.length} products without embeddings for business ${businessAccountId}`);
    
    let processed = 0;
    let failed = 0;
    
    // Process in batches
    for (let i = 0; i < productsWithoutEmbedding.length; i += batchSize) {
      const batch = productsWithoutEmbedding.slice(i, i + batchSize);
      
      const results = await Promise.allSettled(
        batch.map(p => this.generateEmbeddingForProduct(p.id, businessAccountId))
      );
      
      for (const result of results) {
        if (result.status === 'fulfilled') {
          processed++;
        } else {
          failed++;
        }
      }
      
      console.log(`[Product Embedding] Progress: ${processed + failed}/${productsWithoutEmbedding.length}`);
    }
    
    console.log(`[Product Embedding] Backfill complete: ${processed} processed, ${failed} failed`);
    return { processed, failed };
  }
  
  /**
   * Search products using vector similarity
   * @param query - User's search query
   * @param businessAccountId - Business account ID
   * @param limit - Max results to return
   * @param threshold - Minimum similarity threshold (0-1)
   */
  async searchProducts(
    query: string, 
    businessAccountId: string, 
    limit: number = 5,
    threshold: number = 0.4
  ): Promise<Array<{id: string, name: string, description: string, price: string | null, imageUrl: string | null, similarity: number}>> {
    const startTime = Date.now();
    
    // Generate embedding for the query
    const queryEmbedding = await embeddingService.generateEmbedding(query, businessAccountId);
    
    // Use raw SQL for cosine similarity search
    const embeddingStr = JSON.stringify(queryEmbedding);
    const result = await db.execute(sql`
      SELECT 
        id, 
        name, 
        description, 
        price::text as price, 
        image_url,
        1 - (text_embedding <=> ${embeddingStr}::vector) as similarity
      FROM products
      WHERE business_account_id = ${businessAccountId}
        AND text_embedding IS NOT NULL
        AND 1 - (text_embedding <=> ${embeddingStr}::vector) >= ${threshold}
      ORDER BY text_embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);
    
    const elapsed = Date.now() - startTime;
    console.log(`[Product Vector Search] Query: "${query.substring(0, 50)}..." → ${result.rows.length} matches in ${elapsed}ms`);
    
    return result.rows.map((row: any) => ({
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      price: row.price as string | null,
      imageUrl: row.image_url as string | null,
      similarity: parseFloat(row.similarity) as number,
    }));
  }
  
  /**
   * Get product embedding stats across all business accounts (for SuperAdmin)
   */
  async getAllProductStats(): Promise<{
    totalProducts: number;
    embeddedProducts: number;
    missingEmbeddings: number;
    businessesWithProducts: number;
  }> {
    const result = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(text_embedding) as embedded,
        COUNT(*) - COUNT(text_embedding) as missing,
        COUNT(DISTINCT business_account_id) as businesses
      FROM products
    `);
    
    const row = result.rows[0] as any;
    return {
      totalProducts: parseInt(row?.total || '0'),
      embeddedProducts: parseInt(row?.embedded || '0'),
      missingEmbeddings: parseInt(row?.missing || '0'),
      businessesWithProducts: parseInt(row?.businesses || '0'),
    };
  }
  
  /**
   * Batch embed products across all business accounts (for SuperAdmin)
   */
  async batchEmbedAllProducts(): Promise<{
    totalEmbedded: number;
    totalSkipped: number;
    totalFailed: number;
    businessResults: Array<{businessId: string; businessName: string; embedded: number; failed: number}>;
  }> {
    // Get all businesses with products that need embeddings
    const businessesWithMissing = await db.execute(sql`
      SELECT 
        p.business_account_id,
        COALESCE(ba.name, 'Unknown') as business_name,
        COUNT(*) as missing_count
      FROM products p
      LEFT JOIN business_accounts ba ON p.business_account_id = ba.id
      WHERE p.text_embedding IS NULL
      GROUP BY p.business_account_id, ba.name
      HAVING COUNT(*) > 0
    `);
    
    let totalEmbedded = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    const businessResults: Array<{businessId: string; businessName: string; embedded: number; failed: number}> = [];
    
    for (const row of businessesWithMissing.rows) {
      const biz = row as { business_account_id: string; business_name: string; missing_count: string };
      console.log(`[Product Batch Embed] Processing business: ${biz.business_name} (${biz.missing_count} products)`);
      
      try {
        const result = await this.backfillEmbeddingsForBusiness(biz.business_account_id);
        totalEmbedded += result.processed;
        totalFailed += result.failed;
        
        businessResults.push({
          businessId: biz.business_account_id,
          businessName: biz.business_name,
          embedded: result.processed,
          failed: result.failed,
        });
      } catch (error: any) {
        console.error(`[Product Batch Embed] Error for business ${biz.business_account_id}:`, error.message);
        totalSkipped += parseInt(biz.missing_count);
        
        businessResults.push({
          businessId: biz.business_account_id,
          businessName: biz.business_name,
          embedded: 0,
          failed: parseInt(biz.missing_count),
        });
      }
    }
    
    console.log(`[Product Batch Embed] Complete: ${totalEmbedded} embedded, ${totalFailed} failed, ${totalSkipped} skipped`);
    
    return {
      totalEmbedded,
      totalSkipped,
      totalFailed,
      businessResults,
    };
  }
}

export const productTextEmbeddingService = new ProductTextEmbeddingService();
