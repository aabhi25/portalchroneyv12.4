import { db } from '../db';
import { aiUsageEvents, modelPricing } from '../../shared/schema';
import { eq } from 'drizzle-orm';

// Model pricing constants (updated as of Dec 2024)
const DEFAULT_MODEL_PRICING = {
  'gpt-4o-mini': {
    inputCostPer1k: 0.00015,  // $0.15 per 1M tokens
    outputCostPer1k: 0.0006,  // $0.60 per 1M tokens
  },
  'gpt-4o': {
    inputCostPer1k: 0.0025,   // $2.50 per 1M tokens
    outputCostPer1k: 0.010,   // $10.00 per 1M tokens
  },
  'gpt-4o-vision': {
    inputCostPer1k: 0.0025,   // $2.50 per 1M tokens (same as gpt-4o)
    outputCostPer1k: 0.010,   // $10.00 per 1M tokens
  },
  'gpt-realtime-mini': {
    inputCostPer1k: 0.06,     // $60 per 1M tokens ($0.06 per 1k)
    outputCostPer1k: 0.24,    // $240 per 1M tokens ($0.24 per 1k)
  },
  'text-embedding-3-small': {
    inputCostPer1k: 0.00002,  // $0.020 per 1M tokens
    outputCostPer1k: 0,       // Embeddings have no output tokens
  },
};

export type UsageCategory = 'chat' | 'website_analysis' | 'document_analysis' | 'image_search' | 'voice_mode' | 'rag_embeddings';

interface LogUsageParams {
  businessAccountId: string;
  category: UsageCategory;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  metadata?: Record<string, any>;
}

class AIUsageLogger {
  private pricingCache: Map<string, { inputCostPer1k: number; outputCostPer1k: number }> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Initialize model pricing in database (run once on startup)
   */
  async initializePricing(): Promise<void> {
    try {
      for (const [model, pricing] of Object.entries(DEFAULT_MODEL_PRICING)) {
        await db.insert(modelPricing)
          .values({
            model,
            inputCostPer1k: pricing.inputCostPer1k.toString(),
            outputCostPer1k: pricing.outputCostPer1k.toString(),
          })
          .onConflictDoUpdate({
            target: modelPricing.model,
            set: {
              inputCostPer1k: pricing.inputCostPer1k.toString(),
              outputCostPer1k: pricing.outputCostPer1k.toString(),
            },
          });
      }
      console.log('[AIUsageLogger] Model pricing initialized');
    } catch (error) {
      console.error('[AIUsageLogger] Error initializing pricing:', error);
    }
  }

  /**
   * Get pricing for a model (with caching)
   */
  private async getPricing(model: string): Promise<{ inputCostPer1k: number; outputCostPer1k: number }> {
    // Refresh cache if expired
    if (Date.now() > this.cacheExpiry) {
      this.pricingCache.clear();
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    }

    // Check cache
    const cached = this.pricingCache.get(model);
    if (cached) {
      return cached;
    }

    // Fetch from database
    try {
      const pricing = await db.select()
        .from(modelPricing)
        .where(eq(modelPricing.model, model))
        .limit(1);

      if (pricing.length > 0) {
        const result = {
          inputCostPer1k: parseFloat(pricing[0].inputCostPer1k),
          outputCostPer1k: parseFloat(pricing[0].outputCostPer1k),
        };
        this.pricingCache.set(model, result);
        return result;
      }
    } catch (error) {
      console.error(`[AIUsageLogger] Error fetching pricing for ${model}:`, error);
    }

    // Fallback to default pricing
    const defaultPricing = DEFAULT_MODEL_PRICING[model as keyof typeof DEFAULT_MODEL_PRICING];
    if (defaultPricing) {
      this.pricingCache.set(model, defaultPricing);
      return defaultPricing;
    }

    // Final fallback (gpt-4o-mini pricing)
    console.warn(`[AIUsageLogger] No pricing found for model ${model}, using gpt-4o-mini pricing as fallback`);
    return DEFAULT_MODEL_PRICING['gpt-4o-mini'];
  }

  /**
   * Calculate cost based on tokens and pricing
   */
  private calculateCost(tokensInput: number, tokensOutput: number, pricing: { inputCostPer1k: number; outputCostPer1k: number }): number {
    const inputCost = (tokensInput / 1000) * pricing.inputCostPer1k;
    const outputCost = (tokensOutput / 1000) * pricing.outputCostPer1k;
    return inputCost + outputCost;
  }

  /**
   * Log AI usage event
   */
  async logUsage(params: LogUsageParams): Promise<void> {
    try {
      const pricing = await this.getPricing(params.model);
      const costUsd = this.calculateCost(params.tokensInput, params.tokensOutput, pricing);

      await db.insert(aiUsageEvents).values({
        businessAccountId: params.businessAccountId,
        category: params.category,
        model: params.model,
        tokensInput: params.tokensInput.toString(),
        tokensOutput: params.tokensOutput.toString(),
        costUsd: costUsd.toFixed(6),
        metadata: params.metadata || null,
      });

      console.log(`[AIUsageLogger] Logged usage: ${params.category} | ${params.model} | in:${params.tokensInput} out:${params.tokensOutput} | $${costUsd.toFixed(6)}`);
    } catch (error) {
      console.error('[AIUsageLogger] Error logging usage:', error);
      // Don't throw - logging failures shouldn't break the main flow
    }
  }

  /**
   * Helper: Extract token usage from OpenAI completion response
   */
  extractTokensFromCompletion(response: any): { tokensInput: number; tokensOutput: number } {
    const usage = response?.usage;
    return {
      tokensInput: usage?.prompt_tokens || 0,
      tokensOutput: usage?.completion_tokens || 0,
    };
  }

  /**
   * Helper: Log chat usage (convenience method)
   */
  async logChatUsage(businessAccountId: string, model: string, response: any, metadata?: Record<string, any>): Promise<void> {
    const tokens = this.extractTokensFromCompletion(response);
    await this.logUsage({
      businessAccountId,
      category: 'chat',
      model,
      tokensInput: tokens.tokensInput,
      tokensOutput: tokens.tokensOutput,
      metadata,
    });
  }

  /**
   * Helper: Log website analysis usage
   */
  async logWebsiteAnalysisUsage(businessAccountId: string, model: string, response: any, metadata?: Record<string, any>): Promise<void> {
    const tokens = this.extractTokensFromCompletion(response);
    await this.logUsage({
      businessAccountId,
      category: 'website_analysis',
      model,
      tokensInput: tokens.tokensInput,
      tokensOutput: tokens.tokensOutput,
      metadata,
    });
  }

  /**
   * Helper: Log document analysis usage
   */
  async logDocumentAnalysisUsage(businessAccountId: string, model: string, response: any, metadata?: Record<string, any>): Promise<void> {
    const tokens = this.extractTokensFromCompletion(response);
    await this.logUsage({
      businessAccountId,
      category: 'document_analysis',
      model,
      tokensInput: tokens.tokensInput,
      tokensOutput: tokens.tokensOutput,
      metadata,
    });
  }

  /**
   * Helper: Log image search usage
   */
  async logImageSearchUsage(businessAccountId: string, model: string, response: any, metadata?: Record<string, any>): Promise<void> {
    const tokens = this.extractTokensFromCompletion(response);
    await this.logUsage({
      businessAccountId,
      category: 'image_search',
      model,
      tokensInput: tokens.tokensInput,
      tokensOutput: tokens.tokensOutput,
      metadata,
    });
  }

  /**
   * Helper: Log voice mode usage
   */
  async logVoiceModeUsage(businessAccountId: string, model: string, tokensInput: number, tokensOutput: number, metadata?: Record<string, any>): Promise<void> {
    await this.logUsage({
      businessAccountId,
      category: 'voice_mode',
      model,
      tokensInput,
      tokensOutput,
      metadata,
    });
  }

  /**
   * Helper: Log embedding usage (RAG)
   */
  async logEmbeddingUsage(businessAccountId: string, model: string, response: any, metadata?: Record<string, any>): Promise<void> {
    const usage = response?.usage;
    const tokensInput = usage?.prompt_tokens || usage?.total_tokens || 0;
    
    await this.logUsage({
      businessAccountId,
      category: 'rag_embeddings',
      model,
      tokensInput,
      tokensOutput: 0, // Embeddings don't have output tokens
      metadata,
    });
  }
}

// Singleton instance
export const aiUsageLogger = new AIUsageLogger();
