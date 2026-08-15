interface CacheEntry<T> {
  data: T;
  timestamp: number;
  lastAccessed: number;
  ttl: number;
}

export class BusinessContextCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
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
    INTRO_MESSAGE: (businessAccountId: string) => `intro:${businessAccountId}`,
    WA_BUSINESS_CONTEXT: (businessAccountId: string) => `wa-context:${businessAccountId}`,
  };

  // Invalidate both the standard and the K12 content-only business context entries.
  invalidateBusinessContext(businessAccountId: string) {
    this.invalidate(BusinessContextCache.KEYS.BUSINESS_CONTEXT(businessAccountId));
    this.invalidate(BusinessContextCache.KEYS.BUSINESS_CONTEXT_K12(businessAccountId));
  }

  // Invalidation patterns for business account updates
  invalidateBusinessCache(businessAccountId: string) {
    const patterns = [
      new RegExp(`^widget:${businessAccountId}$`),
      new RegExp(`^faqs:${businessAccountId}$`),
      // Catches both `context:<id>` and the `context:<id>:k12co` variant.
      new RegExp(`^context:${businessAccountId}(:k12co)?$`),
      new RegExp(`^intro:${businessAccountId}$`),
      new RegExp(`^wa-context:${businessAccountId}$`),
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

    console.log(`[Cache MISS] ${key} - fetching fresh data`);
    const data = await fetchFn();
    
    if (this.cache.size >= this.MAX_ENTRIES) {
      this.evictLRU();
    }
    
    this.cache.set(key, {
      data,
      timestamp: now,
      lastAccessed: now,
      ttl: ttlMs || this.TTL_MS
    });

    return data;
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
    console.log(`[Cache INVALIDATE PATTERN] ${pattern} - removed ${count} entries`);
  }

  clear() {
    const size = this.cache.size;
    this.cache.clear();
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
    setInterval(() => {
      this.cleanupExpired();
    }, 60 * 1000); // Cleanup every minute
  }
}

export const businessContextCache = new BusinessContextCache();
businessContextCache.startCleanupInterval();
