import OpenAI from 'openai';
import { storage } from '../storage';
import { db } from '../db';
import { aiSuggestions, questionBankEntries, conversations, messages, leads, faqs, products, conversationJourneys } from '../../shared/schema';
import { eq, and, gte, desc, sql } from 'drizzle-orm';

interface AnalysisResult {
  faqSuggestions: FAQSuggestion[];
  trainingSuggestions: TrainingSuggestion[];
  journeySuggestions: JourneySuggestion[];
  productSuggestions: ProductSuggestion[];
}

interface FAQSuggestion {
  question: string;
  suggestedAnswer: string;
  conversationCount: number;
  exampleQuestions: string[];
  conversationIds: string[];
  confidence: number;
}

interface TrainingSuggestion {
  issue: string;
  suggestedInstruction: string;
  examples: string[];
  conversationCount: number;
  confidence: number;
}

interface JourneySuggestion {
  name: string;
  description: string;
  suggestedSteps: { question: string; required: boolean }[];
  conversationCount: number;
  pattern: string;
  confidence: number;
}

interface ProductSuggestion {
  productName: string;
  description: string;
  conversationCount: number;
  exampleMentions: string[];
  confidence: number;
}

class ConversationAnalyzer {
  /**
   * Creates an OpenAI client using the business account's API key
   */
  private async getOpenAIClient(businessAccountId: string): Promise<OpenAI> {
    const storage = (await import('../storage')).storage;
    const apiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId);
    
    if (!apiKey) {
      throw new Error('OpenAI API key not found for business account');
    }
    
    return new OpenAI({ apiKey });
  }

  /**
   * Main analysis function - analyzes conversations and generates all types of suggestions
   */
  async analyzeConversations(businessAccountId: string, daysBack: number = 7): Promise<AnalysisResult> {
    console.log(`[ConversationAnalyzer] Starting analysis for business: ${businessAccountId} (last ${daysBack} days)`);

    // Get OpenAI client
    const openai = await this.getOpenAIClient(businessAccountId);

    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    // Get all recent conversations with messages
    const recentConversations = await db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.businessAccountId, businessAccountId),
        gte(conversations.createdAt, since)
      ))
      .orderBy(desc(conversations.createdAt));

    console.log(`[ConversationAnalyzer] Found ${recentConversations.length} recent conversations`);

    if (recentConversations.length === 0) {
      return {
        faqSuggestions: [],
        trainingSuggestions: [],
        journeySuggestions: [],
        productSuggestions: [],
      };
    }

    // Get question bank entries (unanswered questions)
    const questionBankData = await db
      .select()
      .from(questionBankEntries)
      .where(and(
        eq(questionBankEntries.businessAccountId, businessAccountId),
        gte(questionBankEntries.createdAt, since)
      ));

    console.log(`[ConversationAnalyzer] Found ${questionBankData.length} question bank entries`);

    // Get existing FAQs to avoid duplicates
    const existingFAQs = await storage.getAllFaqs(businessAccountId);

    // Run parallel analysis
    const [faqSuggestions, trainingSuggestions, journeySuggestions, productSuggestions] = await Promise.all([
      this.analyzeFAQOpportunities(openai, businessAccountId, questionBankData, existingFAQs),
      this.analyzeTrainingOpportunities(openai, businessAccountId, recentConversations),
      this.analyzeJourneyOpportunities(openai, businessAccountId, recentConversations),
      this.analyzeProductGaps(openai, businessAccountId, recentConversations),
    ]);

    console.log(`[ConversationAnalyzer] Analysis complete:`, {
      faqs: faqSuggestions.length,
      training: trainingSuggestions.length,
      journeys: journeySuggestions.length,
      products: productSuggestions.length,
    });

    return {
      faqSuggestions,
      trainingSuggestions,
      journeySuggestions,
      productSuggestions,
    };
  }

  /**
   * Analyze question bank for FAQ opportunities
   */
  private async analyzeFAQOpportunities(
    openai: OpenAI,
    businessAccountId: string,
    questionBankData: any[],
    existingFAQs: any[]
  ): Promise<FAQSuggestion[]> {
    if (questionBankData.length === 0) {
      return [];
    }

    console.log('[ConversationAnalyzer] Analyzing FAQ opportunities...');

    // Group similar questions
    const questionGroups = this.groupSimilarQuestions(questionBankData);
    
    // Filter groups with at least 3 similar questions
    const significantGroups = questionGroups.filter(group => group.questions.length >= 3);

    if (significantGroups.length === 0) {
      return [];
    }

    const suggestions: FAQSuggestion[] = [];

    for (const group of significantGroups.slice(0, 10)) { // Top 10 suggestions
      try {
        // Check if similar FAQ already exists
        const isDuplicate = existingFAQs.some(faq => 
          this.isSimilarQuestion(faq.question, group.questions[0])
        );

        if (isDuplicate) {
          console.log('[ConversationAnalyzer] Skipping duplicate FAQ:', group.questions[0].substring(0, 50));
          continue;
        }

        // Generate answer using AI
        const answer = await this.generateFAQAnswer(openai, group.questions, businessAccountId);

        suggestions.push({
          question: group.representativeQuestion,
          suggestedAnswer: answer,
          conversationCount: group.questions.length,
          exampleQuestions: group.questions.slice(0, 5),
          conversationIds: group.conversationIds,
          confidence: Math.min(95, 70 + (group.questions.length * 5)),
        });
      } catch (error) {
        console.error('[ConversationAnalyzer] Error generating FAQ suggestion:', error);
      }
    }

    return suggestions;
  }

  /**
   * Group similar questions together
   */
  private groupSimilarQuestions(questionBankData: any[]): any[] {
    const groups: any[] = [];
    const processed = new Set<string>();

    for (const entry of questionBankData) {
      if (processed.has(entry.id)) continue;

      const group = {
        representativeQuestion: entry.question,
        questions: [entry.question],
        conversationIds: [entry.conversationId],
      };

      // Find similar questions
      for (const otherEntry of questionBankData) {
        if (otherEntry.id !== entry.id && !processed.has(otherEntry.id)) {
          if (this.isSimilarQuestion(entry.question, otherEntry.question)) {
            group.questions.push(otherEntry.question);
            group.conversationIds.push(otherEntry.conversationId);
            processed.add(otherEntry.id);
          }
        }
      }

      processed.add(entry.id);
      groups.push(group);
    }

    return groups.sort((a, b) => b.questions.length - a.questions.length);
  }

  /**
   * Check if two questions are similar (simple keyword matching)
   */
  private isSimilarQuestion(q1: string, q2: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[?!.,]/g, '').trim();
    const words1 = new Set(normalize(q1).split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(normalize(q2).split(/\s+/).filter(w => w.length > 3));

    if (words1.size === 0 || words2.size === 0) return false;

    const intersection = Array.from(words1).filter(w => words2.has(w));
    const similarityScore = intersection.length / Math.max(words1.size, words2.size);

    return similarityScore > 0.5;
  }

  /**
   * Generate FAQ answer using AI
   */
  private async generateFAQAnswer(openai: OpenAI, questions: string[], businessAccountId: string): Promise<string> {
    const businessAccount = await storage.getBusinessAccount(businessAccountId);

    const prompt = `Based on these similar customer questions, generate a clear, helpful FAQ answer:

Questions:
${questions.slice(0, 5).map((q, i) => `${i + 1}. ${q}`).join('\n')}

Business: ${businessAccount?.name || 'Business'}
Website: ${businessAccount?.website || ''}

Generate a concise, accurate answer (2-4 sentences) that addresses these questions.
If you don't have enough information, provide a general helpful response.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at writing clear, helpful FAQ answers for businesses.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return response.choices[0].message.content?.trim() || 'Answer not generated';
  }

  /**
   * Analyze training opportunities
   */
  private async analyzeTrainingOpportunities(
    openai: OpenAI,
    businessAccountId: string,
    recentConversations: any[]
  ): Promise<TrainingSuggestion[]> {
    console.log('[ConversationAnalyzer] Analyzing training opportunities...');

    if (recentConversations.length === 0) {
      return [];
    }

    // Sample conversations for analysis
    const sampleSize = Math.min(20, recentConversations.length);
    const sampleConversations = recentConversations.slice(0, sampleSize);

    // Get messages for sampled conversations
    const conversationTranscripts: string[] = [];

    for (const conv of sampleConversations) {
      const convMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(messages.createdAt);

      if (convMessages.length > 0) {
        const transcript = convMessages
          .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
          .join('\n');
        conversationTranscripts.push(transcript);
      }
    }

    if (conversationTranscripts.length === 0) {
      return [];
    }

    // Use AI to identify training opportunities
    try {
      const prompt = `Analyze these customer conversations and identify training improvements for the AI chatbot.

Sample Conversations (${conversationTranscripts.length} total):
${conversationTranscripts.slice(0, 5).map((t, i) => `\nConversation ${i + 1}:\n${t.substring(0, 500)}...\n`).join('\n')}

Identify all significant training improvements needed (up to 8). For each, provide:
1. The issue/gap you noticed
2. A DIRECT instruction that will be added to the AI's system prompt
3. Example from conversations

CRITICAL: The suggestedInstruction must be written as a direct command to the AI, NOT as advice for the business user.

Good examples:
✓ "When a user asks for human help, provide contact information: support@company.com and offer to connect them with the team."
✓ "If a user seems reluctant to share personal information, offer to help with general information first before asking for details."
✓ "Always ask clarifying questions when the user's request is ambiguous before making assumptions."

Bad examples (DO NOT use these formats):
✗ "Train AI to recognize when a user may benefit from human assistance..."
✗ "Improve the AI's ability to handle pricing questions..."
✗ "The chatbot should be trained to..."

Respond with JSON:
{
  "suggestions": [
    {
      "issue": "Brief description of the issue",
      "suggestedInstruction": "Direct instruction for the AI (use imperative commands like 'When X, do Y')",
      "example": "Example from conversation"
    }
  ]
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at analyzing chatbot conversations and identifying training improvements.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.5,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(response.choices[0].message.content || '{"suggestions":[]}');

      return result.suggestions.map((s: any, index: number) => {
        // Dynamic confidence calculation based on position and sample size
        // Earlier suggestions are typically more significant patterns
        const positionScore = Math.max(85 - (index * 5), 65); // First issue gets 85%, decreases by 5% per position
        const sampleScore = Math.min(sampleSize / 20 * 10, 15); // More conversations analyzed = higher confidence
        const confidence = Math.min(95, Math.max(60, positionScore + sampleScore));
        
        return {
          issue: s.issue,
          suggestedInstruction: s.suggestedInstruction,
          examples: [s.example],
          conversationCount: sampleSize,
          confidence: Math.round(confidence),
        };
      });
    } catch (error) {
      console.error('[ConversationAnalyzer] Error analyzing training opportunities:', error);
      return [];
    }
  }

  /**
   * Analyze journey opportunities
   */
  private async analyzeJourneyOpportunities(
    openai: OpenAI,
    businessAccountId: string,
    recentConversations: any[]
  ): Promise<JourneySuggestion[]> {
    console.log('[ConversationAnalyzer] Analyzing journey opportunities...');
    // Implementation for journey pattern detection
    // This would analyze conversation flows and suggest structured journeys
    return [];
  }

  /**
   * Analyze product gaps
   */
  private async analyzeProductGaps(
    openai: OpenAI,
    businessAccountId: string,
    recentConversations: any[]
  ): Promise<ProductSuggestion[]> {
    console.log('[ConversationAnalyzer] Analyzing product gaps...');
    
    // Get existing products
    const existingProducts = await storage.getAllProducts(businessAccountId);
    const productNames = existingProducts.map(p => p.name.toLowerCase());

    // Implementation to detect mentions of products not in catalog
    return [];
  }

  /**
   * Helper to truncate text at word boundary
   */
  private truncateAtWord(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    // If we find a space, cut there; otherwise use the full length
    return lastSpace > maxLength * 0.7 
      ? truncated.substring(0, lastSpace) + '...'
      : truncated + '...';
  }

  /**
   * Save suggestions to database
   */
  async saveSuggestions(businessAccountId: string, analysisResult: AnalysisResult): Promise<void> {
    console.log('[ConversationAnalyzer] Saving suggestions to database...');

    const suggestionsToInsert: any[] = [];

    // FAQ suggestions
    for (const faq of analysisResult.faqSuggestions) {
      suggestionsToInsert.push({
        businessAccountId,
        type: 'faq',
        title: `Add FAQ: "${faq.question}"`,
        description: `Asked ${faq.conversationCount} times`,
        suggestedContent: {
          question: faq.question,
          answer: faq.suggestedAnswer,
        },
        conversationCount: faq.conversationCount,
        confidence: faq.confidence,
        priority: faq.conversationCount >= 5 ? 'high' : faq.conversationCount >= 3 ? 'medium' : 'low',
        exampleQuestions: faq.exampleQuestions,
        conversationIds: faq.conversationIds,
        status: 'pending',
      });
    }

    // Training suggestions
    for (const training of analysisResult.trainingSuggestions) {
      suggestionsToInsert.push({
        businessAccountId,
        type: 'training',
        title: `Improve: ${training.issue}`,
        description: `Based on ${training.conversationCount} conversations`,
        suggestedContent: {
          instruction: training.suggestedInstruction,
        },
        conversationCount: training.conversationCount,
        confidence: training.confidence,
        priority: 'medium',
        exampleQuestions: training.examples,
        status: 'pending',
      });
    }

    // Insert all suggestions
    if (suggestionsToInsert.length > 0) {
      await db.insert(aiSuggestions).values(suggestionsToInsert);
      console.log(`[ConversationAnalyzer] Saved ${suggestionsToInsert.length} suggestions`);
    } else {
      console.log('[ConversationAnalyzer] No suggestions to save');
    }
  }
}

export const conversationAnalyzer = new ConversationAnalyzer();
