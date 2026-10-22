import { storage } from '../storage';
import { visionWarehouseService } from './visionWarehouseService';
import { resolveVisualSearch, geminiMatchScore, GEMINI_CANDIDATE_MIN_SIMILARITY } from './visualSearchEngine';
import type { Product } from '@shared/schema';

export interface VisualSearchResult {
  product: Product;
  similarity: number;
  matchType?: string;
}

export interface VisualSearchOptions {
  topK?: number;
  minSimilarity?: number;
}

/**
 * Unified Visual Search Service: photo search through Vision Warehouse for accounts that have it
 * set up, and through Gemini Embedding 2 fingerprints (built-in matcher) for everyone else.
 * Text search is Vision Warehouse only.
 */
class UnifiedVisualSearchService {
  async searchByImage(
    businessAccountId: string,
    imageUrl: string,
    options: VisualSearchOptions = {}
  ): Promise<VisualSearchResult[]> {
    const { topK = 10, minSimilarity = 0.5 } = options;

    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) {
      throw new Error('Business account not found');
    }

    const { engine, geminiKey } = await resolveVisualSearch(businessAccount);
    if (engine === 'gemini') return this.searchWithGemini(businessAccountId, imageUrl, topK, minSimilarity, geminiKey!);
    return this.searchWithVisionWarehouse(businessAccountId, businessAccount, imageUrl, topK, minSimilarity);
  }

  private async searchWithGemini(
    businessAccountId: string,
    imageUrl: string,
    topK: number,
    minSimilarity: number,
    geminiKey: string
  ): Promise<VisualSearchResult[]> {
    try {
      const { embedImage } = await import('./geminiImageEmbeddingService');
      const { productImageEmbeddingService } = await import('./productImageEmbeddingService');
      const queryEmbedding = await embedImage(imageUrl, geminiKey);
      const matches = await productImageEmbeddingService.searchSimilarProducts(queryEmbedding, businessAccountId, topK, GEMINI_CANDIDATE_MIN_SIMILARITY);

      const results: VisualSearchResult[] = [];
      for (const match of matches) {
        if (match.source === 'erp') continue;
        const score = geminiMatchScore(match.similarity);
        if (score < minSimilarity) continue;
        const product = await storage.getProduct(match.id, businessAccountId);
        if (product) results.push({ product, similarity: score, matchType: this.getMatchType(score) });
      }
      return results;
    } catch (error: any) {
      console.error('[UnifiedVisualSearch] Gemini search failed:', error.message);
      return [];
    }
  }

  async searchByText(
    businessAccountId: string,
    query: string,
    options: VisualSearchOptions = {}
  ): Promise<VisualSearchResult[]> {
    const { topK = 10, minSimilarity = 0.5 } = options;

    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    if (!businessAccount) {
      throw new Error('Business account not found');
    }

    return this.textSearchWithVisionWarehouse(businessAccountId, businessAccount, query, topK, minSimilarity);
  }

  private async searchWithVisionWarehouse(
    businessAccountId: string,
    businessAccount: any,
    imageUrl: string,
    topK: number,
    minSimilarity: number
  ): Promise<VisualSearchResult[]> {
    const endpointId = businessAccount.googleVisionWarehouseEndpointId;
    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
    
    if (!endpointId) {
      console.warn('[UnifiedVisualSearch] Vision Warehouse endpoint not configured');
      return [];
    }
    
    if (!encryptedCredentials) {
      console.warn('[UnifiedVisualSearch] Vision Warehouse credentials not configured');
      return [];
    }

    try {
      const vwResults = await visionWarehouseService.searchByImage(encryptedCredentials, endpointId, imageUrl, topK);
      
      const results: VisualSearchResult[] = [];
      for (const result of vwResults) {
        const productId = result.assetId.replace('p-', '');
        const product = await storage.getProduct(productId, businessAccountId);
        
        if (product && result.score >= minSimilarity) {
          results.push({
            product,
            similarity: result.score,
            matchType: this.getMatchType(result.score),
          });
        }
      }

      return results;
    } catch (error: any) {
      console.error('[UnifiedVisualSearch] Vision Warehouse search failed:', error.message);
      return [];
    }
  }

  private async textSearchWithVisionWarehouse(
    businessAccountId: string,
    businessAccount: any,
    query: string,
    topK: number,
    minSimilarity: number
  ): Promise<VisualSearchResult[]> {
    const endpointId = businessAccount.googleVisionWarehouseEndpointId;
    const encryptedCredentials = businessAccount.googleVisionWarehouseCredentials;
    
    if (!endpointId) {
      console.warn('[UnifiedVisualSearch] Vision Warehouse endpoint not configured');
      return [];
    }
    
    if (!encryptedCredentials) {
      console.warn('[UnifiedVisualSearch] Vision Warehouse credentials not configured');
      return [];
    }

    try {
      const vwResults = await visionWarehouseService.searchByText(encryptedCredentials, endpointId, query, topK);
      
      const results: VisualSearchResult[] = [];
      for (const result of vwResults) {
        const productId = result.assetId.replace('p-', '');
        const product = await storage.getProduct(productId, businessAccountId);
        
        if (product && result.score >= minSimilarity) {
          results.push({
            product,
            similarity: result.score,
            matchType: this.getMatchType(result.score),
          });
        }
      }

      return results;
    } catch (error: any) {
      console.error('[UnifiedVisualSearch] Vision Warehouse text search failed:', error.message);
      return [];
    }
  }

  private getMatchType(similarity: number): string {
    if (similarity >= 0.95) return 'Perfect Match';
    if (similarity >= 0.85) return 'Very Similar';
    if (similarity >= 0.70) return 'Somewhat Similar';
    return 'Possible Match';
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}

export const unifiedVisualSearchService = new UnifiedVisualSearchService();
