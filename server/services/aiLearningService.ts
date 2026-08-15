import { storage } from '../storage';

/**
 * AI Learning Service
 * Learns from human corrections and customer feedback to improve future responses
 */

interface LearningExample {
  originalQuestion: string;
  aiResponse: string;
  betterResponse: string;
  feedback: 'positive' | 'negative';
  context: string;
  category: string;
}

class AILearningService {
  
  /**
   * Store a learning example when human corrects AI or customer is dissatisfied
   */
  async storeLearningExample(
    businessAccountId: string,
    ticketId: string,
    learningExample: LearningExample
  ): Promise<void> {
    try {
      // Store in database as FAQ with special category for learning
      await storage.createFaq({
        businessAccountId,
        question: `[AI_LEARNING:${learningExample.feedback}] ${learningExample.originalQuestion}`,
        answer: learningExample.betterResponse,
        category: `ai_learning_${learningExample.category}`
      });

      console.log(`[AILearning] Stored learning example from ticket ${ticketId}:`, {
        question: learningExample.originalQuestion.substring(0, 50),
        feedback: learningExample.feedback
      });

      // Also create internal ticket note about the learning
      await storage.createTicketMessage({
        ticketId,
        senderName: 'AI Learning System',
        senderType: 'agent',
        message: `📚 AI Learning: Stored improved response for future reference. This interaction will help AI provide better responses to similar questions.`,
        messageType: 'text',
        isInternal: 'true',
        aiDrafted: 'false'
      });
    } catch (error) {
      console.error('[AILearning] Error storing learning example:', error);
      // Don't fail the operation if learning storage fails
    }
  }

  /**
   * Store negative feedback when AI auto-resolution fails
   */
  async learnFromFailedAutoResolution(
    businessAccountId: string,
    ticketId: string,
    originalIssue: string,
    aiAttempt: string,
    customerComplaint: string,
    humanResolution: string | null = null
  ): Promise<void> {
    try {
      const learningExample: LearningExample = {
        originalQuestion: originalIssue,
        aiResponse: aiAttempt,
        betterResponse: humanResolution || `Customer was dissatisfied. Complaint: ${customerComplaint}. Requires human intervention for: ${originalIssue}`,
        feedback: 'negative',
        context: `Customer complaint after AI resolution: ${customerComplaint}`,
        category: 'failed_auto_resolution'
      };

      await this.storeLearningExample(businessAccountId, ticketId, learningExample);
      
      console.log(`[AILearning] Learned from failed auto-resolution for ticket ${ticketId}`);
    } catch (error) {
      console.error('[AILearning] Error learning from failed resolution:', error);
    }
  }

  /**
   * Store positive feedback when AI auto-resolution succeeds
   */
  async learnFromSuccessfulAutoResolution(
    businessAccountId: string,
    ticketId: string,
    issue: string,
    aiSolution: string
  ): Promise<void> {
    try {
      const learningExample: LearningExample = {
        originalQuestion: issue,
        aiResponse: aiSolution,
        betterResponse: aiSolution,
        feedback: 'positive',
        context: 'Customer confirmed satisfaction with AI resolution',
        category: 'successful_auto_resolution'
      };

      await this.storeLearningExample(businessAccountId, ticketId, learningExample);
      
      console.log(`[AILearning] Reinforced successful pattern for ticket ${ticketId}`);
    } catch (error) {
      console.error('[AILearning] Error learning from successful resolution:', error);
    }
  }

  /**
   * Learn when human agent provides a better response than AI suggested
   */
  async learnFromHumanCorrection(
    businessAccountId: string,
    ticketId: string,
    originalIssue: string,
    aiDraft: string,
    humanResponse: string,
    ticketCategory: string
  ): Promise<void> {
    try {
      // Only store if human response is significantly different (not just minor edits)
      if (this.isSimilarEnough(aiDraft, humanResponse)) {
        console.log(`[AILearning] Human response too similar to AI draft - not storing as learning example`);
        return;
      }

      const learningExample: LearningExample = {
        originalQuestion: originalIssue,
        aiResponse: aiDraft,
        betterResponse: humanResponse,
        feedback: 'negative',
        context: 'Human agent provided better response',
        category: ticketCategory
      };

      await this.storeLearningExample(businessAccountId, ticketId, learningExample);
      
      console.log(`[AILearning] Learned from human correction for ticket ${ticketId}`);
    } catch (error) {
      console.error('[AILearning] Error learning from human correction:', error);
    }
  }

  /**
   * Check if two responses are similar (to avoid storing minor edits)
   */
  private isSimilarEnough(response1: string, response2: string): boolean {
    const cleanedR1 = response1.toLowerCase().trim();
    const cleanedR2 = response2.toLowerCase().trim();
    
    // If one is at least 80% contained in the other, they're similar
    const similarity = this.calculateSimilarity(cleanedR1, cleanedR2);
    return similarity > 0.8;
  }

  /**
   * Calculate similarity between two strings (simple Jaccard similarity)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = words1.filter(x => set2.has(x)).length;
    const union = new Set([...words1, ...words2]);
    
    return intersection / union.size;
  }

  /**
   * Get learning statistics for business
   */
  async getLearningStats(businessAccountId: string): Promise<{
    totalExamples: number;
    positiveExamples: number;
    negativeExamples: number;
    categories: Record<string, number>;
  }> {
    try {
      const allFaqs = await storage.getAllFaqs(businessAccountId);
      const learningExamples = allFaqs.filter(faq => 
        faq.category?.startsWith('ai_learning_') || faq.question.includes('[AI_LEARNING:')
      );

      const stats = {
        totalExamples: learningExamples.length,
        positiveExamples: 0,
        negativeExamples: 0,
        categories: {} as Record<string, number>
      };

      learningExamples.forEach(example => {
        if (example.question.includes('[AI_LEARNING:positive]')) stats.positiveExamples++;
        if (example.question.includes('[AI_LEARNING:negative]')) stats.negativeExamples++;
        
        const category = example.category || 'general';
        stats.categories[category] = (stats.categories[category] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error('[AILearning] Error getting learning stats:', error);
      return {
        totalExamples: 0,
        positiveExamples: 0,
        negativeExamples: 0,
        categories: {}
      };
    }
  }
}

export const aiLearningService = new AILearningService();
