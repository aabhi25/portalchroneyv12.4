import { trackTimer } from "../lib/lifecycle";
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  lastAccessed: number;
  ttl: number;
}

export class BusinessContextCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  // Fetches in progress: a second caller for the same key (e.g. the chat-open prewarm
  // still loading when the first message arrives) joins it instead of loading again.
  private inflight: Map<string, Promise<any>> = new Map();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_ENTRIES = 100; // Maximum cache size to prevent memory leaks

  // Cache key prefixes for different data types
  static readonly KEYS = {
    WIDGET_SETTINGS: (businessAccountId: string) => `widget:${businessAccountId}`,
    FAQ_LIST: (businessAccountId: string) => `faqs:${businessAccountId}`,
    BUSINESS_CONTEXT: (businessAccountId: string) => `context:${businessAccountId}`,
    // K12 content-only accounts (e.g. TopScholar) build a lean curriculum-only
    // context. It is cached under a distinct key so a non-K12 caller (e.g. the
    // widget prewarm, which has no K12 flags) can't populate the shared
    // `context:<id>` entry with the full sales/website context and starve the
    // K12 path of its lean variant.
    BUSINESS_CONTEXT_K12: (businessAccountId: string) => `context:${businessAccountId}:k12co`,
    // Retrieval-mode website chat: compact profile + retrievable passages (see chatContext/).
    BUSINESS_CONTEXT_RETRIEVAL: (businessAccountId: string) => `context:${businessAccountId}:rv`,
    INTRO_MESSAGE: (businessAccountId: string) => `intro:${businessAccountId}`,
    // Widget greeting per language / settings fingerprint (see GET /api/chat/widget/intro).
    INTRO_VARIANT: (businessAccountId: string, variant: string) => `intro:${businessAccountId}:${variant}`,
    // Whether the account has any FAQs / documents / URLs / pages (chatContext/knowledgePresence).
    KNOWLEDGE_PRESENCE: (businessAccountId: string) => `context:${businessAccountId}:kp`,
    WA_BUSINESS_CONTEXT: (businessAccountId: string) => `wa-context:${businessAccountId}`,
  };

  // Invalidate both the standard and the K12 content-only business context entries.
  invalidateBusinessContext(businessAccountId: string) {
    this.invalidate(BusinessContextCache.KEYS.BUSINESS_CONTEXT(businessAccountId));
    this.invalidate(BusinessContextCache.KEYS.BUSINESS_CONTEXT_K12(businessAccountId));
    this.invalidate(BusinessContextCache.KEYS.BUSINESS_CONTEXT_RETRIEVAL(businessAccountId));
    this.invalidate(BusinessContextCache.KEYS.KNOWLEDGE_PRESENCE(businessAccountId));
  }

  /** Drop the cached widget greetings (every language) of one account. */
  invalidateIntro(businessAccountId: string) {
    const id = businessAccountId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.invalidatePattern(new RegExp(`^intro:${id}(:.*)?$`));
  }

  // Invalidation patterns for business account updates. Drops everything cached
  // for one account (widget settings, FAQs, every prompt-context variant, intro,
  // WhatsApp context). Used after training / lead-config changes and group
  // publish. Per-process only: other app instances keep their copy until TTL.
  invalidateBusinessCache(businessAccountId: string) {
    const id = businessAccountId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`^widget:${id}$`),
      new RegExp(`^faqs:${id}$`),
      // Catches `context:<id>` and the `:k12co` / `:rv` / `:kp` variants.
      new RegExp(`^context:${id}(:k12co|:rv|:kp)?$`),
      new RegExp(`^intro:${id}(:.*)?$`),
      // WhatsApp context keys carry a knowledge-toggle suffix (`:w1d0` etc.).
      new RegExp(`^wa-context:${id}(:.*)?$`),
      // Instagram / Facebook DM context (per platform suffix).
      new RegExp(`^ig_business_context_${id}(:.*)?$`),
    ];
    for (const pattern of patterns) {
      this.invalidatePattern(pattern);
    }
  }

  async getOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);
    const entryTtl = cached?.ttl || this.TTL_MS;

    if (cached && (now - cached.timestamp) < entryTtl) {
      cached.lastAccessed = now;
      console.log(`[Cache HIT] ${key} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
      return cached.data as T;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      console.log(`[Cache JOIN] ${key} - joining a load already in progress`);
      return pending as Promise<T>;
    }

    console.log(`[Cache MISS] ${key} - fetching fresh data`);
    return this.load(key, fetchFn, ttlMs);
  }

  /**
   * Reload a key in the background of its current value: callers keep getting the cached
   * copy (if still fresh) until the new one is stored. Joins a load already in progress.
   */
  async refresh<T>(key: string, fetchFn: () => Promise<T>, ttlMs?: number): Promise<T> {
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    console.log(`[Cache REFRESH] ${key}`);
    return this.load(key, fetchFn, ttlMs);
  }

  private async load<T>(key: string, fetchFn: () => Promise<T>, ttlMs?: number): Promise<T> {
    const now = Date.now();
    const self: { load?: Promise<T> } = {};
    const load: Promise<T> = (async () => {
      const data = await fetchFn();
      // Invalidated while loading → hand the result to the callers but don't keep it.
      if (this.inflight.get(key) === self.load) {
        if (!this.cache.has(key) && this.cache.size >= this.MAX_ENTRIES) {
          this.evictLRU();
        }
        this.cache.set(key, {
          data,
          timestamp: now,
          lastAccessed: now,
          ttl: ttlMs || this.TTL_MS
        });
      }
      return data;
    })();
    self.load = load;
    this.inflight.set(key, load);
    try {
      return await load;
    } finally {
      if (this.inflight.get(key) === load) this.inflight.delete(key);
    }
  }

  /** Age in ms of a fresh cached entry, or null (missing / expired). */
  freshAgeMs(key: string): number | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    const age = Date.now() - cached.timestamp;
    return age < (cached.ttl || this.TTL_MS) ? age : null;
  }

  private evictLRU() {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      console.log(`[Cache LRU EVICT] Removed "${oldestKey}" (size: ${this.cache.size}/${this.MAX_ENTRIES})`);
    }
  }

  invalidate(key: string) {
    this.cache.delete(key);
    this.inflight.delete(key);
    console.log(`[Cache INVALIDATE] ${key}`);
  }

  invalidatePattern(pattern: RegExp) {
    let count = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    for (const key of Array.from(this.inflight.keys())) {
      if (pattern.test(key)) this.inflight.delete(key);
    }
    console.log(`[Cache INVALIDATE PATTERN] ${pattern} - removed ${count} entries`);
  }

  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.inflight.clear();
    console.log(`[Cache CLEAR] Removed ${size} entries`);
  }

  private cleanupExpired() {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of Array.from(this.cache.entries())) {
      const entryTtl = entry.ttl || this.TTL_MS;
      if ((now - entry.timestamp) >= entryTtl) {
        this.cache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`[Cache CLEANUP] Removed ${removed} expired entries`);
    }
  }

  startCleanupInterval() {
    trackTimer(setInterval(() => {
      this.cleanupExpired();
    }, 60 * 1000)); // Cleanup every minute
  }
}

export const businessContextCache = new BusinessContextCache();
businessContextCache.startCleanupInterval();
