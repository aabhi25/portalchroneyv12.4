import OpenAI from "openai";
import crypto from "crypto";
import { storage } from "../storage";
import { aiUsageLogger } from "./aiUsageLogger";

// Embedding cache with content hashing to avoid redundant OpenAI API calls
interface EmbeddingCacheEntry {
  embedding: number[];
  timestamp: number;
}

export class EmbeddingService {
  private embeddingCache: Map<string, EmbeddingCacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_CACHE_SIZE = 10000; // Max entries to prevent memory bloat

  /**
   * Generate a content hash for cache key
   */
  private getContentHash(text: string, businessAccountId: string): string {
    return crypto
      .createHash('sha256')
      .update(`${businessAccountId}:${text}`)
      .digest('hex');
  }

  /**
   * Get cached embedding if available and not expired
   * Refreshes recency on hit to implement LRU-like behavior
   */
  private getCachedEmbedding(hash: string): number[] | null {
    const entry = this.embeddingCache.get(hash);
    if (!entry) return null;
    
    // Check if expired
    if (Date.now() - entry.timestamp > this.CACHE_TTL_MS) {
      this.embeddingCache.delete(hash);
      return null;
    }
    
    // Refresh recency by deleting and reinserting (Map maintains insertion order)
    this.embeddingCache.delete(hash);
    this.embeddingCache.set(hash, {
      embedding: entry.embedding,
      timestamp: Date.now() // Also refresh the TTL
    });
    
    return entry.embedding;
  }

  /**
   * Cache an embedding with eviction if needed
   */
  private cacheEmbedding(hash: string, embedding: number[]): void {
    // Evict oldest entries if cache is full
    if (this.embeddingCache.size >= this.MAX_CACHE_SIZE) {
      const entriesToDelete = Math.floor(this.MAX_CACHE_SIZE * 0.1); // Evict 10%
      const iterator = this.embeddingCache.keys();
      for (let i = 0; i < entriesToDelete; i++) {
        const key = iterator.next().value;
        if (key) this.embeddingCache.delete(key);
      }
    }
    
    this.embeddingCache.set(hash, {
      embedding,
      timestamp: Date.now()
    });
  }

  private async getOpenAIClient(businessAccountId: string): Promise<OpenAI> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    
    if (!businessAccount?.openaiApiKey) {
      throw new Error('OpenAI API key not configured for this business account');
    }

    return new OpenAI({ apiKey: businessAccount.openaiApiKey });
  }

  /**
   * Generate embedding for a single text using OpenAI text-embedding-3-small
   * Uses content-hash caching to avoid redundant API calls for identical text
   * @param text - Text to embed (will be truncated if > 8191 tokens)
   * @param businessAccountId - Business account ID for API key
   * @returns Embedding vector (1536 dimensions)
   */
  async generateEmbedding(text: string, businessAccountId: string): Promise<number[]> {
    // text-embedding-3-small supports up to 8191 tokens
    // Rough approximation: 1 token ≈ 4 characters
    const maxChars = 8191 * 4; // ~32,764 characters
    const truncatedText = text.slice(0, maxChars);
    
    // Check cache first using content hash
    const contentHash = this.getContentHash(truncatedText, businessAccountId);
    const cachedEmbedding = this.getCachedEmbedding(contentHash);
    
    if (cachedEmbedding) {
      console.log('[Embedding Cache] HIT - reusing cached embedding');
      return cachedEmbedding;
    }
    
    try {
      const openai = await this.getOpenAIClient(businessAccountId);

      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: truncatedText,
        encoding_format: 'float',
      });

      // Log usage for cost tracking (fire-and-forget)
      aiUsageLogger.logEmbeddingUsage(
        businessAccountId,
        'text-embedding-3-small',
        response
      ).catch(err => console.error('[Usage] Failed to log embedding:', err));

      const embedding = response.data[0].embedding;
      
      // Cache the embedding for future use
      this.cacheEmbedding(contentHash, embedding);
      console.log('[Embedding Cache] MISS - stored new embedding');

      return embedding;
    } catch (error: any) {
      console.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batches
   * @param texts - Array of texts to embed
   * @param businessAccountId - Business account ID for API key
   * @param batchSize - Number of texts to process per API call (max 2048 for text-embedding-3-small)
   * @returns Array of embedding vectors
   */
  async generateBatchEmbeddings(
    texts: string[],
    businessAccountId: string,
    batchSize: number = 100
  ): Promise<number[][]> {
    const embeddings: number[][] = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await this.processBatch(batch, businessAccountId);
      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  private async processBatch(texts: string[], businessAccountId: string): Promise<number[][]> {
    try {
      const openai = await this.getOpenAIClient(businessAccountId);

      // Truncate each text to stay within limits
      const maxChars = 8191 * 4;
      const truncatedTexts = texts.map(text => text.slice(0, maxChars));

      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: truncatedTexts,
        encoding_format: 'float',
      });

      // Log usage for cost tracking
      aiUsageLogger.logEmbeddingUsage(
        businessAccountId,
        'text-embedding-3-small',
        response
      ).catch(err => console.error('[Usage] Failed to log embedding batch:', err));

      // Return embeddings in the same order as input
      return response.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding);
    } catch (error: any) {
      console.error('Error generating batch embeddings:', error);
      throw new Error(`Failed to generate batch embeddings: ${error.message}`);
    }
  }
}

export const embeddingService = new EmbeddingService();
