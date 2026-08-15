import { db } from '../db';
import { aiUsageEvents, modelPricing } from '../../shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Per-1000-token rates in USD.
 *
 * `inputCostPer1k` / `outputCostPer1k` are TEXT rates. The audio and cached
 * rates are optional: when a model does not define one, cost falls back to the
 * corresponding text rate, so text-only models price exactly as they always
 * have.
 */
export interface ModelRates {
  inputCostPer1k: number;
  outputCostPer1k: number;
  cachedInputCostPer1k?: number;
  audioInputCostPer1k?: number;
  audioCachedInputCostPer1k?: number;
  audioOutputCostPer1k?: number;
}

// Model pricing constants. Verified against OpenAI's published pricing table.
// Rates are per 1,000 tokens, i.e. the per-1M price divided by 1000.
const DEFAULT_MODEL_PRICING: Record<string, ModelRates> = {
  'gpt-4o-mini': {
    inputCostPer1k: 0.00015,        // $0.15 per 1M tokens
    outputCostPer1k: 0.0006,        // $0.60 per 1M tokens
    cachedInputCostPer1k: 0.000075, // $0.075 per 1M tokens
  },
  'gpt-4o': {
    inputCostPer1k: 0.0025,   // $2.50 per 1M tokens
    outputCostPer1k: 0.010,   // $10.00 per 1M tokens
  },
  'gpt-4o-vision': {
    inputCostPer1k: 0.0025,   // $2.50 per 1M tokens (same as gpt-4o)
    outputCostPer1k: 0.010,   // $10.00 per 1M tokens
  },
  // Realtime voice models. Audio tokens cost ~17x text tokens, so the two must
  // be priced separately — pricing the whole session at the text rate
  // understates real spend by roughly an order of magnitude.
  // gpt-realtime-mini and gpt-realtime-2.1-mini are priced identically.
  'gpt-realtime-mini': {
    inputCostPer1k: 0.0006,             // text      $0.60 per 1M
    outputCostPer1k: 0.0024,            // text out  $2.40 per 1M
    cachedInputCostPer1k: 0.00006,      // text cached $0.06 per 1M
    audioInputCostPer1k: 0.010,         // audio     $10.00 per 1M
    audioCachedInputCostPer1k: 0.0003,  // audio cached $0.30 per 1M
    audioOutputCostPer1k: 0.020,        // audio out $20.00 per 1M
  },
  'gpt-realtime-2.1-mini': {
    inputCostPer1k: 0.0006,             // text      $0.60 per 1M
    outputCostPer1k: 0.0024,            // text out  $2.40 per 1M
    cachedInputCostPer1k: 0.00006,      // text cached $0.06 per 1M
    audioInputCostPer1k: 0.010,         // audio     $10.00 per 1M
    audioCachedInputCostPer1k: 0.0003,  // audio cached $0.30 per 1M
    audioOutputCostPer1k: 0.020,        // audio out $20.00 per 1M
  },
  'text-embedding-3-small': {
    inputCostPer1k: 0.00002,  // $0.020 per 1M tokens
    outputCostPer1k: 0,       // Embeddings have no output tokens
  },
};

export type UsageCategory = 'chat' | 'website_analysis' | 'document_analysis' | 'image_search' | 'voice_mode' | 'rag_embeddings';

/**
 * Modality / cache breakdown of a usage event.
 *
 * Every field is a SUBSET of `tokensInput` / `tokensOutput`, never an addition
 * to them. Omit them entirely for text-only calls.
 */
export interface TokenBreakdown {
  tokensInputAudio?: number;       // audio portion of tokensInput
  tokensOutputAudio?: number;      // audio portion of tokensOutput
  tokensInputCached?: number;      // cached portion of tokensInput (text + audio)
  tokensInputCachedAudio?: number; // audio portion of tokensInputCached
}

interface LogUsageParams extends TokenBreakdown {
  businessAccountId: string;
  category: UsageCategory;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  metadata?: Record<string, any>;
}

/** Serialize an optional rate for a nullable numeric column. */
const rate = (v: number | undefined): string | null => (v === undefined ? null : v.toString());

/** A breakdown guaranteed to be internally consistent and a true subset of the totals. */
export interface NormalizedUsage {
  tokensInput: number;
  tokensOutput: number;
  tokensInputAudio: number;
  tokensOutputAudio: number;
  tokensInputCached: number;
  tokensInputCachedAudio: number;
}

/**
 * Force a reported usage breakdown into a self-consistent partition.
 *
 * Input tokens are partitioned four ways — {fresh, cached} x {text, audio} —
 * but the provider reports overlapping aggregates (total, audio, cached) plus a
 * nested cached-audio figure. If that nested figure is missing or wrong, naive
 * arithmetic double-counts: with total=100, audio=100 and cached=100, treating
 * cached-audio as 0 bills 100 fresh-audio PLUS 100 cached-text — 200 tokens for
 * a 100-token turn, at the most expensive rates.
 *
 * The overlap is therefore bounded on both sides. Cached-audio cannot exceed
 * either cached or audio, and it cannot be smaller than cached + audio - total
 * (the pigeonhole minimum: that much cached and audio must overlap to fit).
 * Clamping into [max(0, cached + audio - total), min(cached, audio)] makes the
 * four buckets sum to exactly the total for any input, however malformed, and
 * leaves well-formed payloads untouched.
 */
export function normalizeUsage(
  tokensInput: number,
  tokensOutput: number,
  breakdown?: TokenBreakdown,
): NormalizedUsage {
  const nn = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };

  const total = nn(tokensInput);
  const output = nn(tokensOutput);
  const audio = Math.min(nn(breakdown?.tokensInputAudio), total);
  const cached = Math.min(nn(breakdown?.tokensInputCached), total);
  const outputAudio = Math.min(nn(breakdown?.tokensOutputAudio), output);

  // lo <= hi always holds because audio <= total and cached <= total.
  const lo = Math.max(0, cached + audio - total);
  const hi = Math.min(cached, audio);
  const cachedAudio = Math.min(Math.max(nn(breakdown?.tokensInputCachedAudio), lo), hi);

  return {
    tokensInput: total,
    tokensOutput: output,
    tokensInputAudio: audio,
    tokensOutputAudio: outputAudio,
    tokensInputCached: cached,
    tokensInputCachedAudio: cachedAudio,
  };
}

class AIUsageLogger {
  private pricingCache: Map<string, ModelRates> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Initialize model pricing in database (run once on startup).
   *
   * This upserts every rate on every boot, so the constants above are the
   * source of truth and a stale or wrong row in the database is corrected
   * automatically rather than persisting silently.
   */
  async initializePricing(): Promise<void> {
    try {
      for (const [model, pricing] of Object.entries(DEFAULT_MODEL_PRICING)) {
        const values = {
          inputCostPer1k: pricing.inputCostPer1k.toString(),
          outputCostPer1k: pricing.outputCostPer1k.toString(),
          cachedInputCostPer1k: rate(pricing.cachedInputCostPer1k),
          audioInputCostPer1k: rate(pricing.audioInputCostPer1k),
          audioCachedInputCostPer1k: rate(pricing.audioCachedInputCostPer1k),
          audioOutputCostPer1k: rate(pricing.audioOutputCostPer1k),
        };
        await db.insert(modelPricing)
          .values({ model, ...values })
          .onConflictDoUpdate({
            target: modelPricing.model,
            set: values,
          });
      }
      // Drop any cached rates so a running process picks up corrected pricing
      // immediately rather than serving stale values for up to the TTL.
      this.pricingCache.clear();
      this.cacheExpiry = 0;
      console.log('[AIUsageLogger] Model pricing initialized');
    } catch (error) {
      console.error('[AIUsageLogger] Error initializing pricing:', error);
    }
  }

  /**
   * Get pricing for a model (with caching)
   */
  private async getPricing(model: string): Promise<ModelRates> {
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
        const row = pricing[0];
        const opt = (v: string | null): number | undefined => {
          if (v === null || v === undefined) return undefined;
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : undefined;
        };
        const result: ModelRates = {
          inputCostPer1k: parseFloat(row.inputCostPer1k),
          outputCostPer1k: parseFloat(row.outputCostPer1k),
          cachedInputCostPer1k: opt(row.cachedInputCostPer1k),
          audioInputCostPer1k: opt(row.audioInputCostPer1k),
          audioCachedInputCostPer1k: opt(row.audioCachedInputCostPer1k),
          audioOutputCostPer1k: opt(row.audioOutputCostPer1k),
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
   * Calculate cost from token totals plus an optional modality/cache breakdown.
   *
   * The breakdown fields are subsets of the totals, so the text portion is
   * derived by subtraction. When a model defines no audio or cached rate, the
   * corresponding tokens fall back to the plain text rate — which reduces to
   * the original `input * inRate + output * outRate` for text-only models.
   */
  private calculateCost(usage: NormalizedUsage, pricing: ModelRates): number {
    // Rates, each falling back to the text rate when unset, so a text-only
    // model reduces to input * inRate + output * outRate exactly as before.
    const textInRate = pricing.inputCostPer1k;
    const textOutRate = pricing.outputCostPer1k;
    const cachedTextRate = pricing.cachedInputCostPer1k ?? textInRate;
    const audioInRate = pricing.audioInputCostPer1k ?? textInRate;
    const audioOutRate = pricing.audioOutputCostPer1k ?? textOutRate;
    const cachedAudioRate = pricing.audioCachedInputCostPer1k ?? audioInRate;

    // normalizeUsage guarantees these four buckets sum to exactly tokensInput,
    // so no token can be billed twice and none can go negative.
    const cachedAudioIn = usage.tokensInputCachedAudio;
    const cachedTextIn = usage.tokensInputCached - cachedAudioIn;
    const freshAudioIn = usage.tokensInputAudio - cachedAudioIn;
    const freshTextIn = usage.tokensInput - usage.tokensInputAudio - cachedTextIn;

    const audioOut = usage.tokensOutputAudio;
    const textOut = usage.tokensOutput - audioOut;

    const cost =
      freshTextIn * textInRate +
      cachedTextIn * cachedTextRate +
      freshAudioIn * audioInRate +
      cachedAudioIn * cachedAudioRate +
      textOut * textOutRate +
      audioOut * audioOutRate;

    return cost / 1000;
  }

  /**
   * Log AI usage event
   */
  async logUsage(params: LogUsageParams): Promise<void> {
    try {
      const pricing = await this.getPricing(params.model);
      // Normalize ONCE, then use the same numbers for costing and for the row,
      // so the persisted breakdown always matches what was actually billed and
      // stays a true subset of the totals.
      const usage = normalizeUsage(params.tokensInput, params.tokensOutput, params);
      const costUsd = this.calculateCost(usage, pricing);

      await db.insert(aiUsageEvents).values({
        businessAccountId: params.businessAccountId,
        category: params.category,
        model: params.model,
        tokensInput: usage.tokensInput.toString(),
        tokensOutput: usage.tokensOutput.toString(),
        tokensInputAudio: usage.tokensInputAudio.toString(),
        tokensOutputAudio: usage.tokensOutputAudio.toString(),
        tokensInputCached: usage.tokensInputCached.toString(),
        tokensInputCachedAudio: usage.tokensInputCachedAudio.toString(),
        costUsd: costUsd.toFixed(6),
        metadata: params.metadata || null,
      });

      const audioNote = usage.tokensInputAudio || usage.tokensOutputAudio
        ? ` (audio in:${usage.tokensInputAudio} out:${usage.tokensOutputAudio})`
        : '';
      console.log(`[AIUsageLogger] Logged usage: ${params.category} | ${params.model} | in:${usage.tokensInput} out:${usage.tokensOutput}${audioNote} | $${costUsd.toFixed(6)}`);
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
  async logVoiceModeUsage(
    businessAccountId: string,
    model: string,
    tokensInput: number,
    tokensOutput: number,
    metadata?: Record<string, any>,
    breakdown?: TokenBreakdown,
  ): Promise<void> {
    await this.logUsage({
      businessAccountId,
      category: 'voice_mode',
      model,
      tokensInput,
      tokensOutput,
      metadata,
      ...breakdown,
    });
  }

  /**
   * Helper: Extract token usage from an OpenAI Realtime `response.done` payload.
   *
   * The Realtime API reports totals plus a per-modality breakdown, e.g.
   *
   *   usage: {
   *     input_tokens, output_tokens, total_tokens,
   *     input_token_details:  { cached_tokens, text_tokens, audio_tokens,
   *                             cached_tokens_details: { text_tokens, audio_tokens } },
   *     output_token_details: { text_tokens, audio_tokens }
   *   }
   *
   * Field names are read defensively: any missing detail degrades to zero,
   * which prices those tokens at the text rate rather than throwing away the
   * event entirely. Returns null when there is no usable usage object.
   */
  extractRealtimeUsage(usage: any): ({ tokensInput: number; tokensOutput: number } & TokenBreakdown) | null {
    if (!usage || typeof usage !== 'object') return null;

    const n = (v: any): number => {
      const parsed = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
    };

    const inDetails = usage.input_token_details ?? {};
    const outDetails = usage.output_token_details ?? {};
    const cachedDetails = inDetails.cached_tokens_details ?? {};

    const tokensInput = n(usage.input_tokens);
    const tokensOutput = n(usage.output_tokens);
    if (tokensInput === 0 && tokensOutput === 0) return null;

    return {
      tokensInput,
      tokensOutput,
      tokensInputAudio: n(inDetails.audio_tokens),
      tokensOutputAudio: n(outDetails.audio_tokens),
      tokensInputCached: n(inDetails.cached_tokens),
      tokensInputCachedAudio: n(cachedDetails.audio_tokens),
    };
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
