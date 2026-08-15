import { db } from '../db';
import { documentChunks, trainingDocuments, urlContentChunks, trainedUrls } from '../../shared/schema';
import { embeddingService } from './embeddingService';
import { eq, sql, and } from 'drizzle-orm';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentName: string;
  chunkText: string;
  chunkIndex: number;
  similarity: number;
  sourceType: 'pdf' | 'url';
}

interface CachedEmbedding {
  embedding: number[];
  timestamp: number;
}

interface CachedSearchResult {
  results: SearchResult[];
  timestamp: number;
}

export class VectorSearchService {
  // Simple in-memory cache for query embeddings (TTL: 5 minutes)
  private embeddingCache = new Map<string, CachedEmbedding>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  
  // Result cache for similar queries (TTL: 2 minutes, shorter since documents may be updated)
  private resultCache = new Map<string, CachedSearchResult>();
  private readonly RESULT_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
  private readonly MAX_RESULT_CACHE_SIZE = 500;

  /**
   * Get or generate embedding for a query text with caching
   */
  private async getOrGenerateEmbedding(query: string, businessAccountId: string): Promise<number[]> {
    const cacheKey = `${businessAccountId}:${query.toLowerCase().trim()}`;
    
    // Check cache
    const cached = this.embeddingCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      console.log('[VectorSearch] Using cached embedding for query');
      return cached.embedding;
    }

    // Generate new embedding
    const embedding = await embeddingService.generateEmbedding(query, businessAccountId);
    
    // Store in cache
    this.embeddingCache.set(cacheKey, {
      embedding,
      timestamp: Date.now()
    });

    // Clean up old cache entries (simple cleanup every 100 calls)
    if (this.embeddingCache.size > 100) {
      this.cleanupCache();
    }

    return embedding;
  }

  /**
   * Remove expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    const entries = Array.from(this.embeddingCache.entries());
    for (const [key, value] of entries) {
      if (now - value.timestamp > this.CACHE_TTL_MS) {
        this.embeddingCache.delete(key);
      }
    }
  }

  /**
   * Generate a cache key for search results
   */
  private getResultCacheKey(query: string, businessAccountId: string, topK: number, threshold: number): string {
    return `${businessAccountId}:${query.toLowerCase().trim()}:${topK}:${threshold}`;
  }

  /**
   * Get cached search results if available
   */
  private getCachedResults(cacheKey: string): SearchResult[] | null {
    const cached = this.resultCache.get(cacheKey);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.RESULT_CACHE_TTL_MS) {
      this.resultCache.delete(cacheKey);
      return null;
    }
    
    // Refresh recency for LRU behavior
    this.resultCache.delete(cacheKey);
    this.resultCache.set(cacheKey, {
      results: cached.results,
      timestamp: Date.now()
    });
    
    return cached.results;
  }

  /**
   * Cache search results with LRU eviction
   */
  private cacheResults(cacheKey: string, results: SearchResult[]): void {
    if (this.resultCache.size >= this.MAX_RESULT_CACHE_SIZE) {
      // Evict oldest 10%
      const entriesToDelete = Math.floor(this.MAX_RESULT_CACHE_SIZE * 0.1);
      const iterator = this.resultCache.keys();
      for (let i = 0; i < entriesToDelete; i++) {
        const key = iterator.next().value;
        if (key) this.resultCache.delete(key);
      }
    }
    
    this.resultCache.set(cacheKey, {
      results,
      timestamp: Date.now()
    });
  }

  /**
   * Invalidate result cache for a business account (call when documents are updated)
   */
  invalidateBusinessCache(businessAccountId: string): void {
    const entries = Array.from(this.resultCache.keys());
    for (const key of entries) {
      if (key.startsWith(businessAccountId + ':')) {
        this.resultCache.delete(key);
      }
    }
    console.log(`[VectorSearch] Invalidated result cache for business ${businessAccountId}`);
  }

  /**
   * Semantic search using vector similarity across PDF documents and trained URLs
   * @param query - Search query text
   * @param businessAccountId - Business account ID for filtering
   * @param topK - Number of top results to return (default: 5)
   * @param similarityThreshold - Minimum similarity score (0-1, default: 0.7)
   * @returns Array of relevant chunks with similarity scores
   */
  async search(
    query: string,
    businessAccountId: string,
    topK: number = 5,
    similarityThreshold: number = 0.7
  ): Promise<SearchResult[]> {
    try {
      // Validate query
      if (!query || query.trim().length === 0) {
        console.log('[VectorSearch] Empty query - skipping search');
        return [];
      }

      // Check result cache first
      const resultCacheKey = this.getResultCacheKey(query, businessAccountId, topK, similarityThreshold);
      const cachedResults = this.getCachedResults(resultCacheKey);
      if (cachedResults) {
        console.log('[VectorSearch] Result cache HIT - returning cached results');
        return cachedResults;
      }

      // Get or generate embedding with caching
      const queryEmbedding = await this.getOrGenerateEmbedding(query, businessAccountId);

      // Search both PDF document chunks and URL content chunks in parallel
      const [pdfResults, urlResults] = await Promise.all([
        // Search PDF document chunks
        db
          .select({
            chunkId: documentChunks.id,
            documentId: documentChunks.trainingDocumentId,
            chunkText: documentChunks.chunkText,
            chunkIndex: documentChunks.chunkIndex,
            documentName: trainingDocuments.originalFilename,
            distance: sql<number>`${documentChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`,
          })
          .from(documentChunks)
          .innerJoin(
            trainingDocuments,
            eq(documentChunks.trainingDocumentId, trainingDocuments.id)
          )
          .where(
            and(
              eq(documentChunks.businessAccountId, businessAccountId),
              eq(trainingDocuments.uploadStatus, 'completed')
            )
          )
          .orderBy(sql`${documentChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
          .limit(topK),
        
        // Search URL content chunks
        db
          .select({
            chunkId: urlContentChunks.id,
            documentId: urlContentChunks.trainedUrlId,
            chunkText: urlContentChunks.chunkText,
            chunkIndex: urlContentChunks.chunkIndex,
            documentName: trainedUrls.title,
            url: trainedUrls.url,
            distance: sql<number>`${urlContentChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`,
          })
          .from(urlContentChunks)
          .innerJoin(
            trainedUrls,
            eq(urlContentChunks.trainedUrlId, trainedUrls.id)
          )
          .where(
            and(
              eq(urlContentChunks.businessAccountId, businessAccountId),
              eq(trainedUrls.status, 'completed'),
              eq(trainedUrls.embeddingStatus, 'completed')
            )
          )
          .orderBy(sql`${urlContentChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
          .limit(topK)
      ]);

      // Convert PDF results with sourceType
      const pdfSearchResults: SearchResult[] = pdfResults
        .map(result => ({
          chunkId: result.chunkId,
          documentId: result.documentId,
          documentName: result.documentName,
          chunkText: result.chunkText,
          chunkIndex: result.chunkIndex,
          similarity: 1 - result.distance,
          sourceType: 'pdf' as const,
        }))
        .filter(result => result.similarity >= similarityThreshold);

      // Convert URL results with sourceType
      const urlSearchResults: SearchResult[] = urlResults
        .map(result => ({
          chunkId: result.chunkId,
          documentId: result.documentId,
          documentName: result.documentName || result.url,
          chunkText: result.chunkText,
          chunkIndex: result.chunkIndex,
          similarity: 1 - result.distance,
          sourceType: 'url' as const,
        }))
        .filter(result => result.similarity >= similarityThreshold);

      // Merge and sort by similarity, limit to topK
      const searchResults = [...pdfSearchResults, ...urlSearchResults]
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);

      console.log(`[VectorSearch] Found ${searchResults.length} relevant chunks (${pdfSearchResults.length} PDF, ${urlSearchResults.length} URL) for query (threshold: ${similarityThreshold})`);
      
      // If no results from vector search, try keyword fallback for person names and proper nouns
      if (searchResults.length === 0) {
        console.log('[VectorSearch] No vector results - trying keyword fallback');
        const keywordResults = await this.keywordFallbackSearch(query, businessAccountId, topK);
        if (keywordResults.length > 0) {
          console.log(`[VectorSearch] Keyword fallback found ${keywordResults.length} chunks`);
          // Cache keyword fallback results too
          this.cacheResults(resultCacheKey, keywordResults);
          return keywordResults;
        }
      }
      
      // Cache search results before returning
      this.cacheResults(resultCacheKey, searchResults);
      console.log('[VectorSearch] Result cache MISS - stored new results');
      
      return searchResults;
    } catch (error: any) {
      console.error('[VectorSearch] Search failed:', error);
      throw new Error(`Vector search failed: ${error.message}`);
    }
  }

  /**
   * Keyword-based fallback search for when vector search returns no results
   * Useful for proper nouns, names, and specific terms that may not embed well
   * Searches both PDF document chunks and URL content chunks
   */
  private async keywordFallbackSearch(
    query: string,
    businessAccountId: string,
    topK: number = 5
  ): Promise<SearchResult[]> {
    try {
      // Extract potential keywords from query (remove common words)
      const commonWords = ['tell', 'me', 'about', 'what', 'is', 'who', 'where', 'when', 'how', 'the', 'a', 'an'];
      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 2 && !commonWords.includes(word));

      if (keywords.length === 0) {
        return [];
      }

      console.log(`[VectorSearch] Keyword fallback searching for: ${keywords.join(', ')}`);

      // Search both PDF and URL chunks in parallel
      const [pdfResults, urlResults] = await Promise.all([
        // Search PDF document chunks
        db
          .select({
            chunkId: documentChunks.id,
            documentId: documentChunks.trainingDocumentId,
            chunkText: documentChunks.chunkText,
            chunkIndex: documentChunks.chunkIndex,
            documentName: trainingDocuments.originalFilename,
          })
          .from(documentChunks)
          .innerJoin(
            trainingDocuments,
            eq(documentChunks.trainingDocumentId, trainingDocuments.id)
          )
          .where(
            and(
              eq(documentChunks.businessAccountId, businessAccountId),
              eq(trainingDocuments.uploadStatus, 'completed'),
              sql`LOWER(${documentChunks.chunkText}) LIKE ANY(ARRAY[${sql.join(
                keywords.map(kw => sql`${'%' + kw + '%'}`),
                sql`, `
              )}])`
            )
          )
          .limit(topK),
        
        // Search URL content chunks
        db
          .select({
            chunkId: urlContentChunks.id,
            documentId: urlContentChunks.trainedUrlId,
            chunkText: urlContentChunks.chunkText,
            chunkIndex: urlContentChunks.chunkIndex,
            documentName: trainedUrls.title,
            url: trainedUrls.url,
          })
          .from(urlContentChunks)
          .innerJoin(
            trainedUrls,
            eq(urlContentChunks.trainedUrlId, trainedUrls.id)
          )
          .where(
            and(
              eq(urlContentChunks.businessAccountId, businessAccountId),
              eq(trainedUrls.status, 'completed'),
              eq(trainedUrls.embeddingStatus, 'completed'),
              sql`LOWER(${urlContentChunks.chunkText}) LIKE ANY(ARRAY[${sql.join(
                keywords.map(kw => sql`${'%' + kw + '%'}`),
                sql`, `
              )}])`
            )
          )
          .limit(topK)
      ]);

      // Convert PDF results with sourceType
      const pdfSearchResults: SearchResult[] = pdfResults.map(result => ({
        chunkId: result.chunkId,
        documentId: result.documentId,
        documentName: result.documentName,
        chunkText: result.chunkText,
        chunkIndex: result.chunkIndex,
        similarity: 0.6, // Fixed similarity score for keyword matches
        sourceType: 'pdf' as const,
      }));

      // Convert URL results with sourceType
      const urlSearchResults: SearchResult[] = urlResults.map(result => ({
        chunkId: result.chunkId,
        documentId: result.documentId,
        documentName: result.documentName || result.url,
        chunkText: result.chunkText,
        chunkIndex: result.chunkIndex,
        similarity: 0.6, // Fixed similarity score for keyword matches
        sourceType: 'url' as const,
      }));

      // Merge and limit to topK
      return [...pdfSearchResults, ...urlSearchResults].slice(0, topK);
    } catch (error: any) {
      console.error('[VectorSearch] Keyword fallback failed:', error);
      return [];
    }
  }

  /**
   * Retrieve surrounding context chunks for a specific chunk
   * Useful for getting more context around a search result
   */
  async getContextChunks(
    chunkId: string,
    businessAccountId: string,
    before: number = 1,
    after: number = 1
  ): Promise<SearchResult[]> {
    try {
      // Get the target chunk first
      const targetChunk = await db
        .select()
        .from(documentChunks)
        .where(
          and(
            eq(documentChunks.id, chunkId),
            eq(documentChunks.businessAccountId, businessAccountId)
          )
        )
        .limit(1);

      if (targetChunk.length === 0) {
        return [];
      }

      const target = targetChunk[0];
      const minIndex = Math.max(0, target.chunkIndex - before);
      const maxIndex = target.chunkIndex + after;

      // Retrieve chunks in range
      const contextChunks = await db
        .select({
          chunkId: documentChunks.id,
          documentId: documentChunks.trainingDocumentId,
          chunkText: documentChunks.chunkText,
          chunkIndex: documentChunks.chunkIndex,
          documentName: trainingDocuments.originalFilename,
        })
        .from(documentChunks)
        .innerJoin(
          trainingDocuments,
          eq(documentChunks.trainingDocumentId, trainingDocuments.id)
        )
        .where(
          and(
            eq(documentChunks.trainingDocumentId, target.trainingDocumentId),
            eq(documentChunks.businessAccountId, businessAccountId),
            sql`${documentChunks.chunkIndex} >= ${minIndex}`,
            sql`${documentChunks.chunkIndex} <= ${maxIndex}`
          )
        )
        .orderBy(documentChunks.chunkIndex);

      return contextChunks.map(chunk => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        chunkText: chunk.chunkText,
        chunkIndex: chunk.chunkIndex,
        similarity: chunk.chunkId === chunkId ? 1.0 : 0.8, // Mark target chunk
        sourceType: 'pdf' as const, // getContextChunks currently only works with PDF chunks
      }));
    } catch (error: any) {
      console.error('[VectorSearch] Context retrieval failed:', error);
      return [];
    }
  }

  /**
   * Get statistics about embedded documents for a business
   */
  async getEmbeddingStats(businessAccountId: string): Promise<{
    totalDocuments: number;
    totalChunks: number;
    documentsWithEmbeddings: number;
  }> {
    try {
      const stats = await db
        .select({
          totalChunks: sql<number>`count(*)`,
          uniqueDocs: sql<number>`count(distinct ${documentChunks.trainingDocumentId})`,
        })
        .from(documentChunks)
        .where(eq(documentChunks.businessAccountId, businessAccountId));

      const totalDocs = await db
        .select({ count: sql<number>`count(*)` })
        .from(trainingDocuments)
        .where(
          and(
            eq(trainingDocuments.businessAccountId, businessAccountId),
            eq(trainingDocuments.uploadStatus, 'completed')
          )
        );

      return {
        totalDocuments: Number(totalDocs[0]?.count || 0),
        totalChunks: Number(stats[0]?.totalChunks || 0),
        documentsWithEmbeddings: Number(stats[0]?.uniqueDocs || 0),
      };
    } catch (error: any) {
      console.error('[VectorSearch] Stats retrieval failed:', error);
      return {
        totalDocuments: 0,
        totalChunks: 0,
        documentsWithEmbeddings: 0,
      };
    }
  }
}

export const vectorSearchService = new VectorSearchService();
