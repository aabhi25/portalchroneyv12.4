import { db } from '../db';
import { products, businessAccounts, productEmbeddings, erpProductCache, productJewelryEmbeddings } from '../../shared/schema';
// Photo fingerprints come from Gemini Embedding 2 (one platform key). Only rows marked with
// GEMINI_EMBEDDING_MARKER are searched, so fingerprints left by the retired Jina CLIP engine never mix in.
import { embedImage, embedImages, GEMINI_EMBEDDING_MARKER } from './geminiImageEmbeddingService';
import { resolveGeminiKey } from './geminiKeys';
import { jewelryDetectionService } from './jewelryDetectionService';
import { imageCroppingService } from './imageCroppingService';
import { imageHashService } from './imageHashService';
import { embeddingService } from './embeddingService';
import { eq, sql, and, isNull, isNotNull, or, notLike } from 'drizzle-orm';

const GEMINI_ROW = `${GEMINI_EMBEDDING_MARKER}%`;
/** Products whose stored fingerprints were made by Gemini (and therefore can be compared with a Gemini query). */
const productHasGeminiFingerprint = sql`${products.visualDescription} LIKE ${GEMINI_ROW}`;

// Lazy import for backgroundRemovalService to avoid loading heavy @imgly/background-removal-node at startup
const getBackgroundRemovalService = async () => {
  const { backgroundRemovalService } = await import('./backgroundRemovalService');
  return backgroundRemovalService;
};

export interface ProductSearchResult {
  id: string;
  name: string;
  description: string;
  price: string | null;
  imageUrl: string | null;
  visualDescription: string | null;
  similarity: number;
  source?: 'local' | 'erp';
  erpProductId?: string;
}

// Extended result with per-embedding metadata for UI grouped tabs
export interface JewelryEmbeddingMatch {
  embeddingId: string;
  productId: string;
  productName: string;
  productDescription: string;
  productPrice: string | null;
  productImageUrl: string | null;
  jewelryType: string;
  croppedImageUrl: string | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  isPrimary: boolean;
  similarity: number;
  source: 'local' | 'erp';
}

class ProductImageEmbeddingService {
  /** The account's Gemini key (its own, else the platform's); throws when there is none. */
  private async geminiKeyFor(businessAccountId: string): Promise<string> {
    const [account] = await db
      .select({ geminiApiKey: businessAccounts.geminiApiKey })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId));
    const resolved = account ? await resolveGeminiKey(account) : null;
    if (!resolved) throw new Error('No Gemini API key for photo search');
    return resolved.key;
  }

  private isCriticalError(errorMessage: string): boolean {
    const lowerMessage = errorMessage.toLowerCase();
    const criticalPatterns = [
      'insufficient balance',
      'insufficient_balance',
      'balance exceeded',
      'insufficient_quota',
      'you exceeded your current quota',
      'api key',
      'invalid api key',
      'api_key',
      'rate limit',
      'rate_limit',
      'too many requests',
      '429',
      '401',
      '403',
      'unauthorized',
      'forbidden',
      'quota',
      'billing',
      'payment required',
      'credit',
    ];
    return criticalPatterns.some(pattern => lowerMessage.includes(pattern));
  }

  /**
   * Generate text embedding for a jewelry description using OpenAI text-embedding-3-small
   * Used for text-based similarity matching alongside image embeddings
   */
  private async generateTextEmbedding(text: string, businessAccountId: string): Promise<number[]> {
    try {
      const embedding = await embeddingService.generateEmbedding(text, businessAccountId);
      console.log(`[Jewelry Description] Generated text embedding (${embedding.length} dims)`);
      return embedding;
    } catch (error: any) {
      console.error(`[Jewelry Description] Failed to generate text embedding:`, error.message);
      throw error;
    }
  }

  /**
   * Fingerprint the whole product photo with Gemini (no detection or cropping).
   * `clearCrops` drops the product's cut-out pieces (used when detection was re-run and found none);
   * cut-outs made for an older engine are always dropped, as they can't be compared with Gemini.
   */
  async embedProduct(
    productId: string,
    imageUrl: string,
    productName: string,
    businessAccountId: string,
    options: { clearCrops?: boolean } = {}
  ): Promise<void> {
    const [current] = await db
      .select({ visualDescription: products.visualDescription })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.businessAccountId, businessAccountId)));
    if (!current) return;

    const embedding = await embedImage(imageUrl, await this.geminiKeyFor(businessAccountId));
    let imageHash: string | null = null;
    try {
      imageHash = await imageHashService.generateHash(imageUrl);
    } catch (e) {
      console.warn(`[Product Image Embedding] pHash failed for ${productName}:`, (e as Error).message);
    }

    if (options.clearCrops || !current.visualDescription?.startsWith(GEMINI_EMBEDDING_MARKER)) {
      await db.delete(productJewelryEmbeddings).where(eq(productJewelryEmbeddings.productId, productId));
    }
    await db
      .update(products)
      .set({
        visualDescription: `${GEMINI_EMBEDDING_MARKER} (full photo) for: ${productName}`,
        imageEmbedding: embedding,
        fullImageEmbedding: embedding,
        ...(imageHash ? { imageHash } : {}),
      })
      .where(eq(products.id, productId));
    console.log(`[Product Image Embedding] Gemini fingerprint saved for ${productName}`);
  }

  /**
   * Record that a product's photo couldn't be fingerprinted, so the background sweep doesn't retry it
   * every run (it is retried when the product's photo changes). Old-engine data is cleared either way.
   */
  private async markEmbeddingFailed(productId: string, productName: string, reason: string): Promise<void> {
    await db.delete(productJewelryEmbeddings).where(eq(productJewelryEmbeddings.productId, productId));
    await db
      .update(products)
      .set({
        visualDescription: `${GEMINI_EMBEDDING_MARKER} failed for: ${productName} (${reason.slice(0, 160)})`,
        imageEmbedding: null,
        fullImageEmbedding: null,
      })
      .where(eq(products.id, productId));
  }

  /**
   * Fingerprint every product photo that has no Gemini fingerprint yet (new products, and products
   * still carrying fingerprints from a retired engine). Products that already failed are skipped.
   */
  async embedMissingProducts(
    businessAccountId: string,
    options: {
      limit?: number;
      /** Detect and cut out each piece first (uses the account's OpenAI key), as AI product processing does. */
      useDetection?: boolean;
      onProgress?: (current: number, total: number, processed: number, failed: number) => void;
    } = {}
  ): Promise<{ processed: number; skipped: number; failed: number; error?: string }> {
    const pending = await db
      .select({ id: products.id, name: products.name, imageUrl: products.imageUrl })
      .from(products)
      .where(
        and(
          eq(products.businessAccountId, businessAccountId),
          isNotNull(products.imageUrl),
          or(isNull(products.visualDescription), notLike(products.visualDescription, GEMINI_ROW))
        )
      )
      .limit(options.limit ?? 10_000);
    return this.embedProductList(businessAccountId, pending, options.onProgress, options.useDetection);
  }

  /** Re-fingerprint products with Gemini; `forceReprocess` also redoes products that already have one. */
  async reembedAllProducts(businessAccountId: string, forceReprocess: boolean = false): Promise<{ processed: number; skipped: number; failed: number; error?: string }> {
    if (!forceReprocess) return this.embedMissingProducts(businessAccountId);
    const all = await db
      .select({ id: products.id, name: products.name, imageUrl: products.imageUrl })
      .from(products)
      .where(and(eq(products.businessAccountId, businessAccountId), isNotNull(products.imageUrl)));
    return this.embedProductList(businessAccountId, all);
  }

  private async embedProductList(
    businessAccountId: string,
    list: Array<{ id: string; name: string; imageUrl: string | null }>,
    onProgress?: (current: number, total: number, processed: number, failed: number) => void,
    useDetection = false
  ): Promise<{ processed: number; skipped: number; failed: number; error?: string }> {
    const CONCURRENCY = 3;
    let processed = 0;
    let failed = 0;
    let completed = 0;
    let criticalError: string | undefined;
    for (let i = 0; i < list.length && !criticalError; i += CONCURRENCY) {
      await Promise.all(list.slice(i, i + CONCURRENCY).map(async product => {
        try {
          if (useDetection) {
            const result = await this.detectAndEmbedProduct(product.id, product.imageUrl!, product.name, businessAccountId);
            if (!result.success) throw Object.assign(new Error(result.error || 'Processing failed'), { critical: result.isCritical });
          } else {
            await this.embedProduct(product.id, product.imageUrl!, product.name, businessAccountId);
          }
          processed++;
        } catch (error: any) {
          const message = error?.message || String(error);
          // Key, quota and billing problems stop the run; nothing is marked so the next run retries.
          if (error?.critical || this.isCriticalError(message) || /No Gemini API key/.test(message)) {
            criticalError = message;
          } else {
            failed++;
            console.warn(`[Product Image Embedding] Could not fingerprint ${product.name}: ${message}`);
            await this.markEmbeddingFailed(product.id, product.name, message).catch(() => {});
          }
        }
        completed++;
        onProgress?.(completed, list.length, processed, failed);
      }));
    }
    if (criticalError) console.error(`[Product Image Embedding] Stopped: ${criticalError}`);
    return { processed, skipped: 0, failed, ...(criticalError ? { error: criticalError } : {}) };
  }

  /** Fingerprint a customer's photo (or a cut-out piece of it) for searching. Null if Gemini is unavailable. */
  async embedUploadedImage(imageDataUrl: string, businessAccountId: string): Promise<{ description: string; embedding: number[] | null }> {
    try {
      return { description: GEMINI_EMBEDDING_MARKER, embedding: await embedImage(imageDataUrl, await this.geminiKeyFor(businessAccountId)) };
    } catch (error: any) {
      console.error(`[Product Image Embedding] Could not fingerprint uploaded photo for ${businessAccountId}: ${error?.message || error}`);
      return { description: GEMINI_EMBEDDING_MARKER, embedding: null };
    }
  }

  /**
   * Search for visually similar products using vector similarity
   * Searches local products, multi-item jewelry embeddings, and ERP product embeddings
   */
  async searchSimilarProducts(
    queryEmbedding: number[],
    businessAccountId: string,
    topK: number = 25,
    similarityThreshold: number = 0.75,
    jewelryTypeFilter?: string // Optional filter by jewelry type
  ): Promise<ProductSearchResult[]> {
    try {
      const allResults: ProductSearchResult[] = [];
      const seenProductIds = new Set<string>();

      // First search the multi-item jewelry embeddings table with JOIN to products (avoid N+1)
      try {
        const jewelryResults = await db
          .select({
            embeddingId: productJewelryEmbeddings.id,
            productId: productJewelryEmbeddings.productId,
            jewelryType: productJewelryEmbeddings.jewelryType,
            croppedImageUrl: productJewelryEmbeddings.croppedImageUrl,
            distance: sql<number>`${productJewelryEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`,
            productName: products.name,
            productDescription: products.description,
            productPrice: products.price,
            productImageUrl: products.imageUrl,
          })
          .from(productJewelryEmbeddings)
          .innerJoin(products, eq(productJewelryEmbeddings.productId, products.id))
          .where(
            jewelryTypeFilter
              ? and(
                  eq(productJewelryEmbeddings.businessAccountId, businessAccountId),
                  sql`${productJewelryEmbeddings.embedding} IS NOT NULL`,
                  productHasGeminiFingerprint,
                  sql`(${productJewelryEmbeddings.jewelryType} = ${jewelryTypeFilter} OR LOWER(${productJewelryEmbeddings.jewelryType}) = 'others')`
                )
              : and(
                  eq(productJewelryEmbeddings.businessAccountId, businessAccountId),
                  sql`${productJewelryEmbeddings.embedding} IS NOT NULL`,
                  productHasGeminiFingerprint
                )
          )
          .orderBy(sql`${productJewelryEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
          .limit(topK * 2);

        for (const jResult of jewelryResults) {
          const similarity = Math.max(0, 1 - jResult.distance);
          if (similarity >= similarityThreshold && !seenProductIds.has(jResult.productId)) {
            seenProductIds.add(jResult.productId);
            allResults.push({
              id: jResult.productId,
              name: jResult.productName,
              description: jResult.productDescription,
              price: jResult.productPrice,
              imageUrl: jResult.productImageUrl,
              visualDescription: `Matched via ${jResult.jewelryType}`,
              similarity,
              source: 'local'
            });
          }
        }
        
        console.log(`[Product Image Embedding] Found ${allResults.length} matches from jewelry embeddings${jewelryTypeFilter ? ` (${jewelryTypeFilter})` : ''}`);
      } catch (e) {
        console.log('[Product Image Embedding] Jewelry embeddings search error (table may not exist yet):', e);
      }

      // Then search the main products table (for products without jewelry detection or as fallback)
      const localResults = await db
        .select({
          id: products.id,
          name: products.name,
          description: products.description,
          price: products.price,
          imageUrl: products.imageUrl,
          visualDescription: products.visualDescription,
          detectedJewelryType: products.detectedJewelryType,
          distance: sql<number>`${products.imageEmbedding} <=> ${JSON.stringify(queryEmbedding)}::vector`,
        })
        .from(products)
        .where(
          jewelryTypeFilter
            ? and(
                eq(products.businessAccountId, businessAccountId),
                sql`${products.imageEmbedding} IS NOT NULL`,
                productHasGeminiFingerprint,
                // Products fingerprinted from the full photo may have no detected type: keep them in.
                sql`(${products.detectedJewelryType} = ${jewelryTypeFilter} OR LOWER(${products.detectedJewelryType}) = 'others' OR ${products.detectedJewelryType} IS NULL)`
              )
            : and(
                eq(products.businessAccountId, businessAccountId),
                sql`${products.imageEmbedding} IS NOT NULL`,
                productHasGeminiFingerprint
              )
        )
        .orderBy(sql`${products.imageEmbedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
        .limit(topK);

      for (const result of localResults) {
        const similarity = Math.max(0, 1 - result.distance);
        if (similarity >= similarityThreshold && !seenProductIds.has(result.id)) {
          seenProductIds.add(result.id);
          allResults.push({
            id: result.id,
            name: result.name,
            description: result.description,
            price: result.price,
            imageUrl: result.imageUrl,
            visualDescription: result.visualDescription,
            similarity,
            source: 'local'
          });
        }
      }

      // Search ERP embeddings (if no type filter - ERP doesn't have type detection yet)
      if (!jewelryTypeFilter) {
        try {
          const erpResults = await db
            .select({
              id: productEmbeddings.id,
              erpProductId: productEmbeddings.erpProductId,
              imageUrl: productEmbeddings.imageUrl,
              visualDescription: productEmbeddings.visualDescription,
              cachedName: productEmbeddings.cachedName,
              cachedPrice: productEmbeddings.cachedPrice,
              distance: sql<number>`${productEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`,
            })
            .from(productEmbeddings)
            .where(
              and(
                eq(productEmbeddings.businessAccountId, businessAccountId),
                sql`${productEmbeddings.embedding} IS NOT NULL`,
                sql`${productEmbeddings.visualDescription} LIKE ${GEMINI_ROW}`
              )
            )
            .orderBy(sql`${productEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
            .limit(topK);

          for (const result of erpResults) {
            const similarity = Math.max(0, 1 - result.distance);
            if (similarity >= similarityThreshold) {
              allResults.push({
                id: result.id,
                name: result.cachedName || 'ERP Product',
                description: '',
                price: result.cachedPrice,
                imageUrl: result.imageUrl,
                visualDescription: result.visualDescription,
                similarity,
                source: 'erp',
                erpProductId: result.erpProductId
              });
            }
          }
        } catch (e) {
          console.log('[Product Image Embedding] No ERP embeddings table or error searching:', e);
        }
      }

      allResults.sort((a, b) => b.similarity - a.similarity);
      const finalResults = allResults.slice(0, topK);

      console.log(`[Product Image Embedding] Found ${finalResults.length} similar products total`);
      return finalResults;
    } catch (error) {
      console.error('[Product Image Embedding] Error searching similar products:', error);
      throw error;
    }
  }

  /**
   * Search for visually similar products with per-embedding metadata
   * Returns individual embedding matches (not deduplicated by product)
   * Used for UI grouped tabs showing each detected jewelry item's matches
   */
  async searchWithEmbeddingMetadata(
    queryEmbedding: number[],
    businessAccountId: string,
    topK: number = 25,
    similarityThreshold: number = 0.75,
    jewelryTypeFilter?: string
  ): Promise<JewelryEmbeddingMatch[]> {
    try {
      const allMatches: JewelryEmbeddingMatch[] = [];

      // Search the jewelry embeddings table with JOIN to products
      const jewelryResults = await db
        .select({
          embeddingId: productJewelryEmbeddings.id,
          productId: productJewelryEmbeddings.productId,
          jewelryType: productJewelryEmbeddings.jewelryType,
          croppedImageUrl: productJewelryEmbeddings.croppedImageUrl,
          boundingBox: productJewelryEmbeddings.boundingBox,
          isPrimary: productJewelryEmbeddings.isPrimary,
          distance: sql<number>`${productJewelryEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`,
          productName: products.name,
          productDescription: products.description,
          productPrice: products.price,
          productImageUrl: products.imageUrl,
        })
        .from(productJewelryEmbeddings)
        .innerJoin(products, eq(productJewelryEmbeddings.productId, products.id))
        .where(
          jewelryTypeFilter
            ? and(
                eq(productJewelryEmbeddings.businessAccountId, businessAccountId),
                eq(productJewelryEmbeddings.jewelryType, jewelryTypeFilter),
                sql`${productJewelryEmbeddings.embedding} IS NOT NULL`,
                productHasGeminiFingerprint
              )
            : and(
                eq(productJewelryEmbeddings.businessAccountId, businessAccountId),
                sql`${productJewelryEmbeddings.embedding} IS NOT NULL`,
                productHasGeminiFingerprint
              )
        )
        .orderBy(sql`${productJewelryEmbeddings.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
        .limit(topK);

      for (const result of jewelryResults) {
        const similarity = Math.max(0, 1 - result.distance);
        if (similarity >= similarityThreshold) {
          allMatches.push({
            embeddingId: result.embeddingId,
            productId: result.productId,
            productName: result.productName,
            productDescription: result.productDescription,
            productPrice: result.productPrice,
            productImageUrl: result.productImageUrl,
            jewelryType: result.jewelryType,
            croppedImageUrl: result.croppedImageUrl,
            boundingBox: result.boundingBox as { x: number; y: number; width: number; height: number } | null,
            isPrimary: result.isPrimary === 'true',
            similarity,
            source: 'local'
          });
        }
      }

      console.log(`[Product Image Embedding] Found ${allMatches.length} embedding matches${jewelryTypeFilter ? ` (${jewelryTypeFilter})` : ''}`);
      return allMatches;
    } catch (error) {
      console.error('[Product Image Embedding] Error searching with embedding metadata:', error);
      throw error;
    }
  }

  /**
   * Get count of products with/without embeddings (includes both local and ERP)
   */
  async getEmbeddingStats(businessAccountId: string): Promise<{ 
    total: number; 
    withEmbedding: number; 
    withoutEmbedding: number;
    erpEmbeddings: number;
  }> {
    try {
      const allProducts = await db
        .select({ id: products.id, hasEmbedding: sql<boolean>`(${products.imageEmbedding} IS NOT NULL AND ${productHasGeminiFingerprint})` })
        .from(products)
        .where(eq(products.businessAccountId, businessAccountId));

      const total = allProducts.length;
      const withEmbedding = allProducts.filter(p => p.hasEmbedding).length;
      const withoutEmbedding = total - withEmbedding;

      let erpEmbeddings = 0;
      try {
        const [erpCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(productEmbeddings)
          .where(and(eq(productEmbeddings.businessAccountId, businessAccountId), sql`${productEmbeddings.visualDescription} LIKE ${GEMINI_ROW}`));
        erpEmbeddings = erpCount?.count || 0;
      } catch (e) {
      }

      return { total, withEmbedding, withoutEmbedding, erpEmbeddings };
    } catch (error) {
      console.error('[Product Image Embedding] Error getting stats:', error);
      throw error;
    }
  }

  /** Gemini fingerprint for a photo by URL (ERP catalog sync). */
  async generateEmbeddingFromUrl(
    imageUrl: string,
    businessAccountId: string,
    productName?: string
  ): Promise<{ embedding: number[] | null; visualDescription: string | null }> {
    try {
      return { embedding: await embedImage(imageUrl, await this.geminiKeyFor(businessAccountId)), visualDescription: `${GEMINI_EMBEDDING_MARKER} for: ${productName || 'ERP product'}` };
    } catch (error: any) {
      console.error(`[Product Image Embedding] Could not fingerprint ${productName || imageUrl}: ${error?.message || error}`);
      return { embedding: null, visualDescription: null };
    }
  }

  /**
   * Detect jewelry in image, crop it, and generate embedding from the cropped image
   * This provides more accurate matching by focusing only on the jewelry, not the mannequin/background
   * Now stores embeddings for ALL detected jewelry items in the productJewelryEmbeddings table
   */
  async detectAndEmbedProduct(
    productId: string,
    imageUrl: string,
    productName: string,
    businessAccountId: string
  ): Promise<{ success: boolean; detectedType?: string; croppedUrl?: string; allItems?: number; error?: string; isCritical?: boolean }> {
    try {
      if (!imageUrl) {
        console.log(`[Jewelry Detection] Skipping product ${productId} - no image URL`);
        return { success: false, error: 'No image URL provided' };
      }

      console.log(`[Jewelry Detection] Processing product: ${productName}`);

      // STEP 1: pHash (exact copies) and a Gemini fingerprint of the full photo (exact-match check)
      const geminiKey = await this.geminiKeyFor(businessAccountId);
      let fullImageEmbedding: number[] | null = await embedImage(imageUrl, geminiKey);
      let imageHash: string | null = null;
      
      // Generate pHash for exact image matching (free, local, no API cost)
      try {
        imageHash = await imageHashService.generateHash(imageUrl);
        console.log(`[Jewelry Detection] Generated pHash for: ${productName}`);
      } catch (e) {
        console.error(`[Jewelry Detection] Failed to generate pHash for ${productName}:`, e);
      }
      
      // STEP 2: Detect jewelry items
      const detection = await jewelryDetectionService.detectJewelry(imageUrl, businessAccountId);
      
      if (!detection.success || detection.detectedItems.length === 0) {
        console.log(`[Jewelry Detection] No jewelry detected in ${productName}, using original image`);
        await this.embedProduct(productId, imageUrl, productName, businessAccountId, { clearCrops: true });
        return { success: true };
      }

      console.log(`[Jewelry Detection] Found ${detection.detectedItems.length} jewelry items in ${productName}`);

      // Crop ALL detected items
      const croppedImages = await imageCroppingService.cropJewelryFromUrl(imageUrl, detection.detectedItems);
      
      if (croppedImages.length === 0) {
        console.log(`[Jewelry Detection] Cropping failed for ${productName}, using original image`);
        await this.embedProduct(productId, imageUrl, productName, businessAccountId, { clearCrops: true });
        return { success: true };
      }

      // Find the primary item (highest confidence)
      const primaryItem = detection.detectedItems.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );
      const primaryType = jewelryDetectionService.mapTypeToCategory(primaryItem.type);

      // Query existing embeddings BEFORE deleting to cache processed images
      const existingEmbeddings = await db
        .select({
          boundingBox: productJewelryEmbeddings.boundingBox,
          processedImageUrl: productJewelryEmbeddings.processedImageUrl,
          croppedImageUrl: productJewelryEmbeddings.croppedImageUrl,
        })
        .from(productJewelryEmbeddings)
        .where(eq(productJewelryEmbeddings.productId, productId));
      
      // Create a cache map for existing processed images by bounding box key
      const processedImageCache = new Map<string, string>();
      for (const existing of existingEmbeddings) {
        if (existing.processedImageUrl && existing.boundingBox) {
          const box = existing.boundingBox as { x: number; y: number; width: number; height: number };
          const key = `${box.x.toFixed(2)}_${box.y.toFixed(2)}_${box.width.toFixed(2)}_${box.height.toFixed(2)}`;
          processedImageCache.set(key, existing.processedImageUrl);
        }
      }
      console.log(`[Jewelry Detection] Found ${processedImageCache.size} cached processed images for ${productName}`);
      
      // Delete existing jewelry embeddings for this product
      await db.delete(productJewelryEmbeddings).where(eq(productJewelryEmbeddings.productId, productId));

      // Map cropped images back to their original detected items using bounding box matching
      const croppedWithItems = croppedImages.map(cropped => {
        const matchedItem = detection.detectedItems.find(item => 
          item.boundingBox.x === cropped.originalBoundingBox.x &&
          item.boundingBox.y === cropped.originalBoundingBox.y
        );
        return matchedItem ? { cropped, item: matchedItem } : null;
      }).filter((pair): pair is { cropped: typeof croppedImages[0]; item: typeof detection.detectedItems[0] } => pair !== null);

      if (croppedWithItems.length === 0) {
        console.log(`[Jewelry Detection] No valid crop-item pairs for ${productName}, using original image`);
        await this.embedProduct(productId, imageUrl, productName, businessAccountId, { clearCrops: true });
        return { success: true };
      }

      // STEP 1: Process all images with background removal (use cache when available)
      console.log(`[Jewelry Detection] Processing ${croppedWithItems.length} items with background removal...`);
      
      const processedItems: Array<{
        cropped: typeof croppedImages[0];
        item: typeof detection.detectedItems[0];
        index: number;
        imageDataUrl: string;
        processedDataUrl: string | null;
      }> = [];
      
      let cacheHits = 0;
      let cacheMisses = 0;
      
      for (let index = 0; index < croppedWithItems.length; index++) {
        const { cropped, item } = croppedWithItems[index];
        let imageDataUrlForEmbedding = cropped.croppedDataUrl;
        let processedDataUrl: string | null = null;
        
        // Check cache first using bounding box as key
        const cacheKey = `${item.boundingBox.x.toFixed(2)}_${item.boundingBox.y.toFixed(2)}_${item.boundingBox.width.toFixed(2)}_${item.boundingBox.height.toFixed(2)}`;
        const cachedProcessedUrl = processedImageCache.get(cacheKey);
        
        if (cachedProcessedUrl) {
          // Cache hit - reuse existing processed image
          processedDataUrl = cachedProcessedUrl;
          imageDataUrlForEmbedding = cachedProcessedUrl;
          cacheHits++;
          console.log(`[Jewelry Detection] Cache HIT for ${item.type} (${index + 1}/${croppedWithItems.length})`);
        } else {
          // Cache miss - run background removal
          cacheMisses++;
          try {
            const base64Data = cropped.croppedDataUrl.split(',')[1];
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const bgService = await getBackgroundRemovalService();
            const processedBuffer = await bgService.removeBackground(imageBuffer);
            processedDataUrl = `data:image/png;base64,${processedBuffer.toString('base64')}`;
            imageDataUrlForEmbedding = processedDataUrl;
            console.log(`[Jewelry Detection] Background removed for ${item.type} (${index + 1}/${croppedWithItems.length})`);
          } catch (bgError: any) {
            console.warn(`[Jewelry Detection] Background removal failed for ${item.type}, using original:`, bgError.message);
          }
        }
        
        processedItems.push({
          cropped,
          item,
          index,
          imageDataUrl: imageDataUrlForEmbedding,
          processedDataUrl
        });
      }
      
      console.log(`[Jewelry Detection] Background removal: ${cacheHits} cache hits, ${cacheMisses} cache misses`);
      
      // STEP 2: Extract attributes from CROPPED images (not full image detection)
      // This ensures consistent attribute extraction between catalog products and visual search uploads
      console.log(`[Jewelry Detection] Extracting attributes from ${processedItems.length} cropped images...`);
      
      const extractedAttributesMap = new Map<number, { description: string; attributes: Record<string, any> | null }>();
      
      // Process attribute extraction in parallel (but with some concurrency limit to avoid API overload)
      const ATTR_CONCURRENCY = 3;
      for (let i = 0; i < processedItems.length; i += ATTR_CONCURRENCY) {
        const batch = processedItems.slice(i, i + ATTR_CONCURRENCY);
        const attrPromises = batch.map(async (processedItem) => {
          try {
            // Use the processed (background-removed) image if available, otherwise cropped image
            const imageToAnalyze = processedItem.processedDataUrl || processedItem.imageDataUrl;
            const result = await jewelryDetectionService.extractAttributesFromCroppedImage(imageToAnalyze, businessAccountId);
            
            if (result.success && result.attributes) {
              console.log(`[Jewelry Detection] Extracted attributes for ${processedItem.item.type}: ${Object.keys(result.attributes).length} attributes`);
              return {
                index: processedItem.index,
                description: result.description || processedItem.item.description || '',
                attributes: result.attributes
              };
            } else {
              console.warn(`[Jewelry Detection] Attribute extraction failed for ${processedItem.item.type}, using detection attributes`);
              return {
                index: processedItem.index,
                description: processedItem.item.description || '',
                attributes: processedItem.item.attributes || null
              };
            }
          } catch (error: any) {
            console.warn(`[Jewelry Detection] Attribute extraction error for ${processedItem.item.type}: ${error.message}`);
            return {
              index: processedItem.index,
              description: processedItem.item.description || '',
              attributes: processedItem.item.attributes || null
            };
          }
        });
        
        const results = await Promise.all(attrPromises);
        for (const result of results) {
          extractedAttributesMap.set(result.index, { description: result.description, attributes: result.attributes });
        }
      }
      
      console.log(`[Jewelry Detection] Extracted attributes for ${extractedAttributesMap.size} items`);
      
      // STEP 3: Gemini fingerprints for every cut-out piece (up to 6 per request)
      const imageDataUrls = processedItems.map(p => p.imageDataUrl);
      const batchEmbeddings: number[][] = await embedImages(imageDataUrls, geminiKey);
      
      // STEP 4: Build results using attributes extracted from cropped images (STEP 2)
      const validResults: Array<{
        embedding: number[];
        type: string;
        originalType: string;
        confidence: number;
        boundingBox: { x: number; y: number; width: number; height: number };
        croppedDataUrl: string;
        processedDataUrl: string | null;
        originalIndex: number;
        description: string;
        attributes: Record<string, any> | null;
      }> = [];
      
      for (let i = 0; i < processedItems.length; i++) {
        const processedItem = processedItems[i];
        const embedding = batchEmbeddings[i];
        
        if (!embedding || embedding.length === 0) {
          console.error(`[Jewelry Detection] No embedding for ${processedItem.item.type}, skipping`);
          continue;
        }
        
        const mappedType = jewelryDetectionService.mapTypeToCategory(processedItem.item.type);
        
        // Use attributes extracted from CROPPED image (STEP 2), not detection attributes
        const extractedData = extractedAttributesMap.get(processedItem.index);
        
        validResults.push({
          embedding,
          type: mappedType,
          originalType: processedItem.item.type,
          confidence: processedItem.item.confidence,
          boundingBox: processedItem.item.boundingBox,
          croppedDataUrl: processedItem.cropped.croppedDataUrl,
          processedDataUrl: processedItem.processedDataUrl,
          originalIndex: processedItem.index,
          description: extractedData?.description || processedItem.item.description || '',
          attributes: extractedData?.attributes || processedItem.item.attributes || null
        });
      }

      if (validResults.length === 0) {
        console.log(`[Jewelry Detection] All embeddings failed for ${productName}, using original image`);
        await this.embedProduct(productId, imageUrl, productName, businessAccountId, { clearCrops: true });
        return { success: true };
      }

      // De-duplicate same-type items with high similarity (e.g., duplicate earring-pair detections)
      const deduplicatedResults = this.deduplicateSameTypeItems(validResults, 0.95);
      
      if (deduplicatedResults.length < validResults.length) {
        console.log(`[Jewelry Detection] De-duplicated ${validResults.length - deduplicatedResults.length} similar items for ${productName}`);
      }

      // Determine primary: highest confidence, break ties by original index (first detected)
      const sortedByConfidence = [...deduplicatedResults].sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return a.originalIndex - b.originalIndex;
      });
      const primaryResult = sortedByConfidence[0];

      // Batch insert all jewelry embeddings with descriptions and attributes
      const insertValues = deduplicatedResults.map(result => ({
        productId,
        businessAccountId,
        jewelryType: result.type,
        confidence: result.confidence.toFixed(4),
        croppedImageUrl: result.croppedDataUrl,
        processedImageUrl: result.processedDataUrl,
        boundingBox: result.boundingBox,
        embedding: result.embedding,
        description: result.description || null,
        descriptionEmbedding: null,
        attributes: result.attributes || null,
        isPrimary: result === primaryResult ? 'true' : 'false'
      }));

      await db.insert(productJewelryEmbeddings).values(insertValues);

      // Also update the primary item in the products table for backward compatibility
      // Store BOTH full image embedding (for exact match) and cropped embedding (for similar match)
      // Also store pHash for exact pixel-level matching verification
      await db
        .update(products)
        .set({ 
          visualDescription: `${GEMINI_EMBEDDING_MARKER} (cropped ${primaryResult.originalType}) for: ${productName}`,
          imageEmbedding: primaryResult.embedding,
          fullImageEmbedding: fullImageEmbedding, // Full image embedding for exact match detection
          imageHash: imageHash, // pHash for exact image verification
          croppedJewelryUrl: primaryResult.croppedDataUrl,
          detectedJewelryType: primaryResult.type
        })
        .where(eq(products.id, productId));

      console.log(`[Jewelry Detection] Successfully processed: ${productName} - ${deduplicatedResults.length} items (primary: ${primaryType})`);
      return { 
        success: true, 
        detectedType: primaryType, 
        croppedUrl: primaryResult.croppedDataUrl,
        allItems: deduplicatedResults.length
      };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      console.error(`[Jewelry Detection] Error processing product ${productId}:`, errorMessage);
      
      const isCritical = this.isCriticalError(errorMessage);
      
      if (isCritical) {
        return { success: false, error: errorMessage, isCritical: true };
      }
      
      try {
        await this.embedProduct(productId, imageUrl, productName, businessAccountId, { clearCrops: true });
        return { success: true };
      } catch (fallbackError: any) {
        const fallbackErrorMessage = fallbackError?.message || String(fallbackError);
        const isFallbackCritical = this.isCriticalError(fallbackErrorMessage);
        return { success: false, error: fallbackErrorMessage, isCritical: isFallbackCritical };
      }
    }
  }

  /**
   * Regenerate embeddings for a product using user-provided custom bounding boxes
   * This bypasses AI detection and uses the exact crop boundaries specified by the user
   */
  async regenerateWithCustomBoxes(
    productId: string,
    imageUrl: string,
    productName: string,
    businessAccountId: string,
    customBoundingBoxes: Array<{ jewelryType: string; boundingBox: { x: number; y: number; width: number; height: number } }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[Custom Crop] Processing ${customBoundingBoxes.length} custom bounding boxes for ${productName}`);

      const geminiKey = await this.geminiKeyFor(businessAccountId);
      const fullImageEmbedding: number[] | null = await embedImage(imageUrl, geminiKey);

      // Generate pHash for exact matching
      let imageHash: string | null = null;
      try {
        imageHash = await imageHashService.generateHash(imageUrl);
        console.log(`[Custom Crop] Generated pHash for: ${productName}`);
      } catch (e) {
        console.error(`[Custom Crop] Failed to generate pHash for ${productName}:`, e);
      }

      // Delete existing jewelry embeddings for this product
      await db.delete(productJewelryEmbeddings).where(eq(productJewelryEmbeddings.productId, productId));

      // Crop images using the custom bounding boxes
      const croppedImages = await imageCroppingService.cropJewelryFromUrl(
        imageUrl,
        customBoundingBoxes.map(b => ({
          type: b.jewelryType,
          confidence: 1.0,
          boundingBox: b.boundingBox,
          description: '',
          attributes: {}
        }))
      );

      if (croppedImages.length === 0) {
        console.log(`[Custom Crop] Cropping failed for ${productName}`);
        return { success: false, error: 'Failed to crop images' };
      }

      // Process each cropped image with background removal (skip cache for custom boundaries)
      const processedItems: Array<{
        jewelryType: string;
        boundingBox: { x: number; y: number; width: number; height: number };
        croppedDataUrl: string;
        imageDataUrl: string;
        processedDataUrl: string | null;
      }> = [];

      for (let i = 0; i < croppedImages.length; i++) {
        const cropped = croppedImages[i];
        const customBox = customBoundingBoxes[i];
        let imageDataUrlForEmbedding = cropped.croppedDataUrl;
        let processedDataUrl: string | null = null;

        try {
          const base64Data = cropped.croppedDataUrl.split(',')[1];
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const bgService = await getBackgroundRemovalService();
          const processedBuffer = await bgService.removeBackground(imageBuffer);
          processedDataUrl = `data:image/png;base64,${processedBuffer.toString('base64')}`;
          imageDataUrlForEmbedding = processedDataUrl;
          console.log(`[Custom Crop] Background removed for ${customBox.jewelryType} (${i + 1}/${croppedImages.length})`);
        } catch (bgError: any) {
          console.warn(`[Custom Crop] Background removal failed for ${customBox.jewelryType}, using original:`, bgError.message);
        }

        processedItems.push({
          jewelryType: customBox.jewelryType,
          boundingBox: customBox.boundingBox,
          croppedDataUrl: cropped.croppedDataUrl,
          imageDataUrl: imageDataUrlForEmbedding,
          processedDataUrl
        });
      }

      const imageDataUrls = processedItems.map(p => p.imageDataUrl);
      const batchEmbeddings: number[][] = await embedImages(imageDataUrls, geminiKey);

      // Build insert values
      const insertValues = processedItems.map((item, index) => {
        const embedding = batchEmbeddings[index];
        const mappedType = jewelryDetectionService.mapTypeToCategory(item.jewelryType);
        
        return {
          productId,
          businessAccountId,
          jewelryType: mappedType,
          confidence: '1.0000',
          croppedImageUrl: item.croppedDataUrl,
          processedImageUrl: item.processedDataUrl,
          boundingBox: item.boundingBox,
          embedding: embedding.length > 0 ? embedding : null,
          description: null,
          descriptionEmbedding: null,
          isPrimary: index === 0 ? 'true' : 'false'
        };
      }).filter(v => v.embedding !== null);

      if (insertValues.length === 0) {
        console.log(`[Custom Crop] All embeddings failed for ${productName}`);
        return { success: false, error: 'Failed to generate embeddings' };
      }

      await db.insert(productJewelryEmbeddings).values(insertValues);

      // Update product record with primary item
      const primaryItem = insertValues[0];
      const primaryType = jewelryDetectionService.mapTypeToCategory(processedItems[0].jewelryType);

      await db
        .update(products)
        .set({
          visualDescription: `${GEMINI_EMBEDDING_MARKER} (custom crop ${primaryType}) for: ${productName}`,
          imageEmbedding: primaryItem.embedding,
          fullImageEmbedding: fullImageEmbedding,
          imageHash: imageHash,
          croppedJewelryUrl: primaryItem.croppedImageUrl,
          detectedJewelryType: primaryType
        })
        .where(eq(products.id, productId));

      console.log(`[Custom Crop] Successfully processed: ${productName} - ${insertValues.length} items`);
      return { success: true };
    } catch (error: any) {
      console.error(`[Custom Crop] Error processing product ${productId}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate cosine similarity between two embedding vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * De-duplicate same-type items with high embedding similarity
   * Prevents duplicate embeddings for identical earring pairs, etc.
   * Keeps the item with highest confidence when duplicates are found
   */
  private deduplicateSameTypeItems<T extends { type: string; embedding: number[]; confidence: number }>(
    items: T[],
    similarityThreshold: number = 0.95
  ): T[] {
    if (items.length <= 1) return items;
    
    // Group items by type
    const byType = new Map<string, T[]>();
    for (const item of items) {
      const existing = byType.get(item.type) || [];
      existing.push(item);
      byType.set(item.type, existing);
    }
    
    const deduplicated: T[] = [];
    
    for (const [type, typeItems] of Array.from(byType.entries())) {
      if (typeItems.length === 1) {
        deduplicated.push(typeItems[0]);
        continue;
      }
      
      // For items of same type, check similarity and keep unique ones
      const kept: T[] = [];
      
      for (const item of typeItems) {
        let isDuplicate = false;
        
        for (const keptItem of kept) {
          const similarity = this.cosineSimilarity(item.embedding, keptItem.embedding);
          if (similarity >= similarityThreshold) {
            // This is a duplicate - keep the one with higher confidence
            if (item.confidence > keptItem.confidence) {
              const index = kept.indexOf(keptItem);
              kept[index] = item;
            }
            isDuplicate = true;
            break;
          }
        }
        
        if (!isDuplicate) {
          kept.push(item);
        }
      }
      
      deduplicated.push(...kept);
    }
    
    return deduplicated;
  }

  /**
   * Process all products for a business with jewelry detection
   * Uses parallel processing with bounded concurrency for faster throughput
   */
  async reprocessWithJewelryDetection(
    businessAccountId: string,
    forceReprocess: boolean = false,
    onProgress?: (current: number, total: number, processed: number, failed: number) => void
  ): Promise<{ processed: number; failed: number; skipped: number; error?: string; stoppedEarly?: boolean }> {
    const CONCURRENCY_LIMIT = 2; // detection and attribute calls go to the account's OpenAI key
    
    try {
      // Get all products with images first
      const allProducts = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.businessAccountId, businessAccountId),
            isNotNull(products.imageUrl)
          )
        );

      // Smart resume: filter products that need processing
      // A product is complete if it has croppedJewelryUrl AND both Gemini fingerprints
      const productsToProcess = forceReprocess
        ? allProducts
        : allProducts.filter(p => 
            !p.croppedJewelryUrl || !p.imageEmbedding || !p.fullImageEmbedding ||
            !p.visualDescription?.startsWith(GEMINI_EMBEDDING_MARKER)
          );
      
      const alreadyComplete = allProducts.length - productsToProcess.length;

      if (productsToProcess.length === 0) {
        console.log(`[Jewelry Detection] All ${allProducts.length} products already processed for business ${businessAccountId}`);
        return { processed: 0, failed: 0, skipped: alreadyComplete };
      }

      const validProducts = productsToProcess.filter(p => p.imageUrl);
      const skipped = alreadyComplete + (productsToProcess.length - validProducts.length);
      const total = validProducts.length;
      
      console.log(`[Jewelry Detection] Processing ${total} products (${alreadyComplete} already complete) with concurrency ${CONCURRENCY_LIMIT}`);

      let processed = 0;
      let failed = 0;
      let completed = 0;
      let criticalError: string | undefined;
      let shouldStop = false;

      const processProduct = async (product: typeof validProducts[0]): Promise<void> => {
        if (shouldStop) return;

        const result = await this.detectAndEmbedProduct(
          product.id,
          product.imageUrl!,
          product.name,
          businessAccountId
        );

        completed++;

        if (result.success) {
          processed++;
        } else {
          failed++;
          if (result.isCritical) {
            shouldStop = true;
            criticalError = result.error;
            console.error(`[Jewelry Detection] Critical error, stopping: ${result.error}`);
          }
        }

        if (onProgress) {
          onProgress(completed, total, processed, failed);
        }
        
        console.log(`[Jewelry Detection] Progress: ${completed}/${total} (${processed} success, ${failed} failed)`);
      };

      for (let i = 0; i < validProducts.length; i += CONCURRENCY_LIMIT) {
        if (shouldStop) break;

        const batch = validProducts.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map(product => processProduct(product)));
        
        if (!shouldStop && i + CONCURRENCY_LIMIT < validProducts.length) {
          // Pause between batches to stay within API rate limits
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      console.log(`[Jewelry Detection] Completed: ${processed} processed, ${failed} failed, ${skipped} skipped`);
      
      if (criticalError) {
        return { processed, failed, skipped, error: criticalError, stoppedEarly: true };
      }
      
      return { processed, failed, skipped };
    } catch (error: any) {
      console.error('[Jewelry Detection] Error in batch processing:', error);
      throw error;
    }
  }

  /** Fingerprint the products still waiting for a Gemini fingerprint. */
  async processAwaitingEmbeddings(
    businessAccountId: string,
    onProgress?: (current: number, total: number, processed: number, failed: number) => void
  ): Promise<{ processed: number; failed: number; skipped: number; error?: string; stoppedEarly?: boolean }> {
    const result = await this.embedMissingProducts(businessAccountId, { onProgress });
    return { ...result, ...(result.error ? { stoppedEarly: true } : {}) };
  }
}

export const productImageEmbeddingService = new ProductImageEmbeddingService();
