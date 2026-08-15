import { db } from '../db';
import { faqs, businessAccounts } from '../../shared/schema';
import { embeddingService } from './embeddingService';
import { eq, sql, and, isNull, isNotNull } from 'drizzle-orm';

export interface FAQSearchResult {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  similarity: number;
}

class FAQEmbeddingService {
  /**
   * Generate and store embedding for a single FAQ
   */
  async embedFAQ(faqId: string, question: string, answer: string, businessAccountId: string): Promise<void> {
    try {
      const textToEmbed = `Question: ${question}\nAnswer: ${answer}`;
      const embedding = await embeddingService.generateEmbedding(textToEmbed, businessAccountId);
      
      await db
        .update(faqs)
        .set({ embedding })
        .where(eq(faqs.id, faqId));
      
      console.log(`[FAQ Embedding] Successfully embedded FAQ: ${faqId}`);
    } catch (error) {
      console.error(`[FAQ Embedding] Error embedding FAQ ${faqId}:`, error);
      throw error;
    }
  }

  /**
   * Embed all FAQs for a business that don't have embeddings yet
   */
  async embedMissingFAQs(businessAccountId: string): Promise<number> {
    try {
      const missingFaqs = await db
        .select()
        .from(faqs)
        .where(
          and(
            eq(faqs.businessAccountId, businessAccountId),
            isNull(faqs.embedding)
          )
        );

      if (missingFaqs.length === 0) {
        console.log(`[FAQ Embedding] No FAQs need embedding for business ${businessAccountId}`);
        return 0;
      }

      console.log(`[FAQ Embedding] Embedding ${missingFaqs.length} FAQs for business ${businessAccountId}`);

      for (const faq of missingFaqs) {
        await this.embedFAQ(faq.id, faq.question, faq.answer, businessAccountId);
      }

      console.log(`[FAQ Embedding] Successfully embedded ${missingFaqs.length} FAQs`);
      return missingFaqs.length;
    } catch (error) {
      console.error(`[FAQ Embedding] Error embedding missing FAQs:`, error);
      throw error;
    }
  }

  /**
   * Semantic search for FAQs using vector similarity
   */
  async searchFAQs(
    query: string,
    businessAccountId: string,
    topK: number = 3,
    similarityThreshold: number = 0.5
  ): Promise<FAQSearchResult[]> {
    try {
      if (!query || query.trim().length === 0) {
        return [];
      }

      const queryEmbedding = await embeddingService.generateEmbedding(query, businessAccountId);

      const results = await db
        .select({
          id: faqs.id,
          question: faqs.question,
          answer: faqs.answer,
          category: faqs.category,
          distance: sql<number>`${faqs.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`,
        })
        .from(faqs)
        .where(
          and(
            eq(faqs.businessAccountId, businessAccountId),
            sql`${faqs.embedding} IS NOT NULL`
          )
        )
        .orderBy(sql`${faqs.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
        .limit(topK);

      const allResultsWithScores = results.map(result => ({
        id: result.id,
        question: result.question,
        answer: result.answer,
        category: result.category,
        similarity: 1 - result.distance,
      }));
      
      // Log ALL results with scores for debugging
      console.log(`[FAQ Vector Search] Query: "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"`);
      console.log(`[FAQ Vector Search] Top ${topK} results before threshold filter:`);
      allResultsWithScores.forEach((r, i) => {
        const passThreshold = r.similarity >= similarityThreshold;
        console.log(`  ${i + 1}. [${passThreshold ? 'PASS' : 'FAIL'}] Score: ${(r.similarity * 100).toFixed(1)}% - "${r.question.substring(0, 60)}..."`);
      });
      
      const searchResults: FAQSearchResult[] = allResultsWithScores
        .filter(result => result.similarity >= similarityThreshold);

      console.log(`[FAQ Vector Search] After threshold ${(similarityThreshold * 100).toFixed(0)}%: ${searchResults.length} FAQs matched`);
      
      return searchResults;
    } catch (error) {
      console.error('[FAQ Vector Search] Error:', error);
      return [];
    }
  }

  /**
   * Check if business has any embedded FAQs
   */
  async hasEmbeddedFAQs(businessAccountId: string): Promise<boolean> {
    try {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(faqs)
        .where(
          and(
            eq(faqs.businessAccountId, businessAccountId),
            sql`${faqs.embedding} IS NOT NULL`
          )
        );
      
      return result[0]?.count > 0;
    } catch (error) {
      console.error('[FAQ Embedding] Error checking embedded FAQs:', error);
      return false;
    }
  }

  /**
   * Get stats for all FAQs across all business accounts
   */
  async getAllFAQStats(): Promise<{
    totalFAQs: number;
    embeddedFAQs: number;
    missingEmbeddings: number;
    businessesWithFAQs: number;
  }> {
    try {
      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(faqs);
      
      const embeddedResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(faqs)
        .where(isNotNull(faqs.embedding));
      
      const businessesResult = await db
        .select({ count: sql<number>`count(distinct ${faqs.businessAccountId})` })
        .from(faqs);

      const totalFAQs = Number(totalResult[0]?.count || 0);
      const embeddedFAQs = Number(embeddedResult[0]?.count || 0);

      return {
        totalFAQs,
        embeddedFAQs,
        missingEmbeddings: totalFAQs - embeddedFAQs,
        businessesWithFAQs: Number(businessesResult[0]?.count || 0)
      };
    } catch (error) {
      console.error('[FAQ Embedding] Error getting FAQ stats:', error);
      throw error;
    }
  }

  /**
   * Batch embed all FAQs across all business accounts (SuperAdmin only)
   * Returns detailed results per business account
   */
  async batchEmbedAllFAQs(): Promise<{
    totalProcessed: number;
    totalEmbedded: number;
    totalSkipped: number;
    totalFailed: number;
    businessResults: Array<{
      businessAccountId: string;
      businessName: string;
      embedded: number;
      skipped: number;
      failed: number;
      error?: string;
    }>;
  }> {
    console.log('[FAQ Batch Embedding] Starting batch embedding for all business accounts...');

    const result = {
      totalProcessed: 0,
      totalEmbedded: 0,
      totalSkipped: 0,
      totalFailed: 0,
      businessResults: [] as Array<{
        businessAccountId: string;
        businessName: string;
        embedded: number;
        skipped: number;
        failed: number;
        error?: string;
      }>
    };

    try {
      // Get all business accounts with their OpenAI API keys
      const allBusinesses = await db
        .select({
          id: businessAccounts.id,
          name: businessAccounts.name,
          openaiApiKey: businessAccounts.openaiApiKey
        })
        .from(businessAccounts);

      console.log(`[FAQ Batch Embedding] Found ${allBusinesses.length} business accounts`);

      for (const business of allBusinesses) {
        const businessResult = {
          businessAccountId: business.id,
          businessName: business.name,
          embedded: 0,
          skipped: 0,
          failed: 0,
          error: undefined as string | undefined
        };

        try {
          // Check if business has OpenAI API key
          if (!business.openaiApiKey) {
            console.log(`[FAQ Batch Embedding] Skipping ${business.name} - no OpenAI API key`);
            
            // Count FAQs that would be skipped
            const faqCount = await db
              .select({ count: sql<number>`count(*)` })
              .from(faqs)
              .where(
                and(
                  eq(faqs.businessAccountId, business.id),
                  isNull(faqs.embedding)
                )
              );
            
            businessResult.skipped = Number(faqCount[0]?.count || 0);
            businessResult.error = 'No OpenAI API key configured';
            result.totalSkipped += businessResult.skipped;
            result.businessResults.push(businessResult);
            continue;
          }

          // Get FAQs without embeddings for this business
          const missingFaqs = await db
            .select()
            .from(faqs)
            .where(
              and(
                eq(faqs.businessAccountId, business.id),
                isNull(faqs.embedding)
              )
            );

          if (missingFaqs.length === 0) {
            console.log(`[FAQ Batch Embedding] ${business.name} - all FAQs already embedded`);
            result.businessResults.push(businessResult);
            continue;
          }

          console.log(`[FAQ Batch Embedding] Processing ${missingFaqs.length} FAQs for ${business.name}`);

          for (const faq of missingFaqs) {
            try {
              await this.embedFAQ(faq.id, faq.question, faq.answer, business.id);
              businessResult.embedded++;
              result.totalEmbedded++;
            } catch (embedError: any) {
              console.error(`[FAQ Batch Embedding] Failed to embed FAQ ${faq.id}:`, embedError.message);
              businessResult.failed++;
              result.totalFailed++;
            }
            result.totalProcessed++;
          }

          console.log(`[FAQ Batch Embedding] ${business.name} - embedded: ${businessResult.embedded}, failed: ${businessResult.failed}`);
        } catch (businessError: any) {
          console.error(`[FAQ Batch Embedding] Error processing ${business.name}:`, businessError.message);
          businessResult.error = businessError.message;
        }

        result.businessResults.push(businessResult);
      }

      console.log(`[FAQ Batch Embedding] Complete! Embedded: ${result.totalEmbedded}, Skipped: ${result.totalSkipped}, Failed: ${result.totalFailed}`);
      return result;
    } catch (error: any) {
      console.error('[FAQ Batch Embedding] Fatal error:', error);
      throw error;
    }
  }
}

export const faqEmbeddingService = new FAQEmbeddingService();
