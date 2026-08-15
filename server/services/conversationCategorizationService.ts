import OpenAI from "openai";
import { db } from "../db";
import { conversations, messages, widgetSettings, businessAccounts, conversationCategorySettings } from "@shared/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";

interface CustomCategoryConfig {
  categories: { name: string; subcategories: string[] }[];
  allowOtherCategory: boolean;
}

const customCategoriesCache = new Map<string, { config: CustomCategoryConfig | null; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getCustomCategories(businessAccountId: string): Promise<CustomCategoryConfig | null> {
  const cached = customCategoriesCache.get(businessAccountId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  try {
    const [settings] = await db
      .select()
      .from(conversationCategorySettings)
      .where(eq(conversationCategorySettings.businessAccountId, businessAccountId));

    const cats = settings?.categories as CustomCategoryConfig['categories'] | null | undefined;
    const config = cats && cats.length > 0
      ? { categories: cats, allowOtherCategory: settings!.allowOtherCategory }
      : null;

    customCategoriesCache.set(businessAccountId, { config, fetchedAt: Date.now() });
    return config;
  } catch {
    return null;
  }
}

export function clearCustomCategoriesCache(businessAccountId: string) {
  customCategoriesCache.delete(businessAccountId);
}

function toTitleCase(str: string): string {
  return str
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

const CATEGORY_MERGE_MAP: Record<string, string> = {
  'general inquiry': 'General',
  'general inquiries': 'General',
  'course inquiry': 'Course Info',
  'course information': 'Course Info',
  'course guidance': 'Course Info',
  'program inquiry': 'Program Info',
  'programs': 'Program Info',
};

function normalizeCategory(raw: string): string {
  const titleCased = toTitleCase(raw);
  const key = titleCased.toLowerCase();
  return CATEGORY_MERGE_MAP[key] || titleCased;
}

function extractJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return {};
  }
}

interface CategorizationResult {
  category: string;
  subcategory: string;
  confidence: number;
  relevance: 'relevant' | 'irrelevant';
}

async function getBusinessContext(businessAccountId: string): Promise<string> {
  try {
    const [business] = await db
      .select({
        name: businessAccounts.name,
        description: businessAccounts.description,
        website: businessAccounts.website,
      })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId));

    const [widget] = await db
      .select({
        customInstructions: widgetSettings.customInstructions,
      })
      .from(widgetSettings)
      .where(eq(widgetSettings.businessAccountId, businessAccountId));

    const parts: string[] = [];
    if (business?.name) parts.push(`Business: ${business.name}`);
    if (business?.description) parts.push(`Description: ${business.description}`);
    if (business?.website) parts.push(`Website: ${business.website}`);
    if (widget?.customInstructions) parts.push(`Custom Instructions: ${widget.customInstructions}`);

    return parts.join("\n") || "No business context available";
  } catch {
    return "No business context available";
  }
}

export async function categorizeConversation(
  conversationId: string,
  businessAccountId: string,
  openaiApiKey?: string
): Promise<CategorizationResult | null> {
  try {
    const conversationMessages = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    if (conversationMessages.length === 0) {
      return null;
    }

    const userMessages = conversationMessages
      .filter(m => m.role === "user")
      .map(m => m.content)
      .join("\n");

    if (!userMessages.trim()) {
      return { category: "General", subcategory: "Greeting", confidence: 100, relevance: 'irrelevant' };
    }

    const apiKey = openaiApiKey || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[Categorization] No OpenAI API key available");
      return null;
    }

    const { storage } = await import('../storage');
    const master = await storage.getMasterAiSettings().catch(() => null);
    const useMaster = !!(master?.masterEnabled && master.primaryApiKey);
    const effectiveKey = useMaster ? master!.primaryApiKey! : apiKey;
    const provider = useMaster ? (master!.primaryProvider || 'openai') : 'openai';
    const model = useMaster ? (master!.primaryModel || 'gpt-4o-mini') : 'gpt-4o-mini';
    const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    const openai = provider === 'gemini'
      ? new OpenAI({ apiKey: effectiveKey, baseURL: GEMINI_BASE_URL })
      : new OpenAI({ apiKey: effectiveKey });

    const businessContext = await getBusinessContext(businessAccountId);
    const customCategories = await getCustomCategories(businessAccountId);

    const transcript = conversationMessages
      .slice(0, 20)
      .map(m => `${m.role}: ${(m.content || "").substring(0, 200)}`)
      .join("\n");

    let systemPrompt: string;

    if (customCategories && customCategories.categories.length > 0) {
      const categoryList = customCategories.categories.map(c => {
        if (c.subcategories.length > 0) {
          return `- "${c.name}" (subcategories: ${c.subcategories.map(s => `"${s}"`).join(", ")})`;
        }
        return `- "${c.name}"`;
      }).join("\n");

      const otherLine = customCategories.allowOtherCategory
        ? `\n- "Other" (fallback for conversations that don't fit any defined category)`
        : '';

      const otherRule = customCategories.allowOtherCategory
        ? `If the conversation does not fit any of the defined categories, use category "Other" with an appropriate subcategory.`
        : `You MUST choose from the defined categories only. Never use any category not in this list.`;

      systemPrompt = `You categorize customer conversations for a business. You MUST ONLY use the categories defined below — do NOT invent new categories.

Business Context:
${businessContext}

ALLOWED CATEGORIES:
${categoryList}${otherLine}

Rules:
1. "category" = MUST be one of the allowed categories listed above. Use the exact name as shown.
2. "subcategory" = If the category has defined subcategories, you MUST pick from ONLY those subcategories. If the category has no defined subcategories, provide a short descriptive subcategory (1-4 words, Title Case).
3. ${otherRule}
4. confidence = 0-100 how confident you are.
5. "relevant" = true if the conversation is a genuine business inquiry. false if it is spam, greetings-only, off-topic, test messages, gibberish, or not related to the business.

Respond with JSON only: {"category": "...", "subcategory": "...", "confidence": 0-100, "relevant": true/false}`;
    } else {
      systemPrompt = `You categorize customer conversations for a business. Use the business context below to generate relevant categories and subcategories that fit this specific business — do NOT use generic or hardcoded categories.

Business Context:
${businessContext}

Rules:
1. "category" = broad topic (e.g. "Pricing", "Product Info", "Support", "Enrollment", "Complaints"). Use Title Case. Keep it short (1-3 words).
2. "subcategory" = specific subtopic within that category (e.g. "Payment Plans", "Return Policy", "Course Duration"). Use Title Case. Keep it short (1-4 words).
3. Categories and subcategories must be relevant to THIS business — infer from the business description, website, and instructions what topics make sense.
4. Use "Spam" category for irrelevant/bot messages, "General" for greetings or vague messages.
5. Be consistent: similar conversations should get the same category/subcategory names.
6. confidence = 0-100 how confident you are.
7. "relevant" = true if the conversation is a genuine business inquiry (someone asking about products, services, pricing, support, enrollment, etc.). false if it is spam, greetings-only, off-topic, test messages, gibberish, or not related to the business.

Respond with JSON only: {"category": "...", "subcategory": "...", "confidence": 0-100, "relevant": true/false}`;
    }

    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `Categorize this conversation:\n\n${transcript}`
        }
      ],
      temperature: 0.2,
      max_tokens: 100,
      response_format: { type: "json_object" }
    });

    const result = extractJson(response.choices[0].message.content || "{}");
    const isRelevant = result.relevant === true || result.relevant === 'true';

    let finalCategory: string;
    let finalSubcategory: string;

    if (customCategories && customCategories.categories.length > 0) {
      const rawCategory = String(result.category || "").trim();
      const rawSubcategory = String(result.subcategory || "").trim();

      const matched = customCategories.categories.find(c => c.name.toLowerCase() === rawCategory.toLowerCase());
      if (matched) {
        finalCategory = matched.name;
        if (matched.subcategories.length > 0) {
          const subMatch = matched.subcategories.find(s => s.toLowerCase() === rawSubcategory.toLowerCase());
          finalSubcategory = subMatch || matched.subcategories[0];
        } else {
          finalSubcategory = rawSubcategory || "General";
        }
      } else if (customCategories.allowOtherCategory) {
        finalCategory = "Other";
        finalSubcategory = rawSubcategory || rawCategory || "Uncategorized";
      } else {
        finalCategory = customCategories.categories[0].name;
        const firstSubs = customCategories.categories[0].subcategories;
        finalSubcategory = firstSubs.length > 0 ? firstSubs[0] : "General";
      }
    } else {
      finalCategory = normalizeCategory(String(result.category || "General")).substring(0, 50);
      finalSubcategory = toTitleCase(String(result.subcategory || "Other")).substring(0, 50);
    }

    return {
      category: finalCategory || "General",
      subcategory: finalSubcategory || "Other",
      confidence: Math.min(100, Math.max(0, Number(result.confidence) || 80)),
      relevance: isRelevant ? 'relevant' as const : 'irrelevant' as const,
    };
  } catch (error) {
    console.error("[Categorization] Error:", error);
    return null;
  }
}

export async function categorizeAndSaveConversation(
  conversationId: string,
  businessAccountId: string,
  openaiApiKey?: string
): Promise<boolean> {
  const result = await categorizeConversation(conversationId, businessAccountId, openaiApiKey);

  if (!result) return false;

  try {
    await db.update(conversations)
      .set({
        category: result.category,
        subcategory: result.subcategory,
        categoryConfidence: result.confidence.toString(),
        relevance: result.relevance,
      })
      .where(eq(conversations.id, conversationId));

    console.log(`[Categorization] Saved: ${result.category} > ${result.subcategory} (${result.confidence}%) [${result.relevance}]`);
    return true;
  } catch (error) {
    console.error("[Categorization] Failed to save category:", error);
    return false;
  }
}

export async function batchCategorizeUncategorized(
  businessAccountId: string,
  limit: number = 50,
  openaiApiKey?: string
): Promise<{ processed: number; failed: number }> {
  const uncategorized = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.businessAccountId, businessAccountId),
        sql`(${conversations.category} IS NULL OR ${conversations.relevance} IS NULL)`
      )
    )
    .orderBy(desc(conversations.createdAt))
    .limit(limit);

  let processed = 0;
  let failed = 0;

  for (const conv of uncategorized) {
    const success = await categorizeAndSaveConversation(conv.id, businessAccountId, openaiApiKey);
    if (success) {
      processed++;
    } else {
      failed++;
    }
  }

  return { processed, failed };
}

export async function getCategoryBreakdown(
  businessAccountId: string,
  fromDate?: Date,
  toDate?: Date
): Promise<{
  categories: { category: string; count: number; label: string; subcategories: { subcategory: string; count: number }[] }[];
  relevanceSummary: { relevant: number; irrelevant: number; uncategorized: number };
}> {
  const dateConditions: any[] = [eq(conversations.businessAccountId, businessAccountId)];
  if (fromDate) dateConditions.push(sql`${conversations.createdAt} >= ${fromDate}`);
  if (toDate) dateConditions.push(sql`${conversations.createdAt} <= ${toDate}`);

  const conditions = [...dateConditions, sql`${conversations.category} IS NOT NULL`];

  const categoryResults = await db
    .select({
      category: conversations.category,
      count: sql<number>`count(*)::int`
    })
    .from(conversations)
    .where(and(...conditions))
    .groupBy(conversations.category);

  const subcategoryResults = await db
    .select({
      category: conversations.category,
      subcategory: conversations.subcategory,
      count: sql<number>`count(*)::int`
    })
    .from(conversations)
    .where(and(...conditions, sql`${conversations.subcategory} IS NOT NULL`))
    .groupBy(conversations.category, conversations.subcategory);

  const relevanceResults = await db
    .select({
      relevance: conversations.relevance,
      count: sql<number>`count(*)::int`
    })
    .from(conversations)
    .where(and(...dateConditions))
    .groupBy(conversations.relevance);

  let relevant = 0, irrelevant = 0, uncategorized = 0;
  for (const row of relevanceResults) {
    if (row.relevance === 'relevant') relevant += row.count;
    else if (row.relevance === 'irrelevant') irrelevant += row.count;
    else uncategorized += row.count;
  }

  const customConfig = await getCustomCategories(businessAccountId);
  const hasCustom = customConfig && customConfig.categories.length > 0;

  const mergedCategories = new Map<string, number>();
  for (const row of categoryResults) {
    const catName = hasCustom ? (row.category || "Unknown") : normalizeCategory(row.category || "Unknown");
    mergedCategories.set(catName, (mergedCategories.get(catName) || 0) + row.count);
  }

  const subcategoryMap = new Map<string, Map<string, number>>();
  for (const row of subcategoryResults) {
    const catName = hasCustom ? (row.category || "Unknown") : normalizeCategory(row.category || "Unknown");
    const subName = hasCustom ? (row.subcategory || "Other") : toTitleCase(row.subcategory || "Other");
    if (!subcategoryMap.has(catName)) subcategoryMap.set(catName, new Map());
    const subMap = subcategoryMap.get(catName)!;
    subMap.set(subName, (subMap.get(subName) || 0) + row.count);
  }

  const categories = Array.from(mergedCategories.entries())
    .map(([category, count]) => {
      const subMap = subcategoryMap.get(category);
      const subcategories = subMap
        ? Array.from(subMap.entries())
            .map(([subcategory, subCount]) => ({ subcategory, count: subCount }))
            .sort((a, b) => b.count - a.count)
        : [];
      return { category, count, label: category, subcategories };
    })
    .sort((a, b) => b.count - a.count);

  return { categories, relevanceSummary: { relevant, irrelevant, uncategorized } };
}
