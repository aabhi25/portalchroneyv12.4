import { storage } from '../storage';
import type { Product } from '@shared/schema';
import { geminiMatchScore, GEMINI_CANDIDATE_MIN_SIMILARITY } from './visualSearchEngine';
import { resolveGeminiKey } from './geminiKeys';

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
 * Photo search by image URL: Gemini Embedding 2 fingerprints compared by the built-in matcher.
 * Uses the account's Gemini key, else the platform key; no key means no results.
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
    const geminiKey = (await resolveGeminiKey(businessAccount))?.key;
    if (!geminiKey) return [];

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

  private getMatchType(similarity: number): string {
    if (similarity >= 0.95) return 'Perfect Match';
    if (similarity >= 0.85) return 'Very Similar';
    if (similarity >= 0.70) return 'Somewhat Similar';
    return 'Possible Match';
  }
}

export const unifiedVisualSearchService = new UnifiedVisualSearchService();
