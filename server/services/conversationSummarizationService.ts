import OpenAI from "openai";
import { db } from "../db";
import { conversations, messages } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { storage } from "../storage";

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

interface SummarizationResult {
  summary: string;
  topicKeywords: string[];
}

export async function summarizeConversation(
  conversationId: string,
  openaiApiKey?: string
): Promise<SummarizationResult | null> {
  try {
    const conversationMessages = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    if (conversationMessages.length < 3) {
      return null;
    }

    const apiKey = openaiApiKey || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[Summarization] No OpenAI API key available");
      return null;
    }

    const master = await storage.getMasterAiSettings().catch(() => null);
    const useMaster = !!(master?.masterEnabled && master.primaryApiKey);
    const effectiveKey = useMaster ? master!.primaryApiKey! : apiKey;
    const provider = useMaster ? (master!.primaryProvider || 'openai') : 'openai';
    const model = useMaster ? (master!.primaryModel || 'gpt-4o-mini') : 'gpt-4o-mini';
    const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    const openai = provider === 'gemini'
      ? new OpenAI({ apiKey: effectiveKey, baseURL: GEMINI_BASE_URL })
      : new OpenAI({ apiKey: effectiveKey });

    const transcript = conversationMessages
      .map(m => `${m.role === 'user' ? 'Visitor' : 'AI'}: ${m.content}`)
      .slice(-20)
      .join("\n");

    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are a conversation analyst. Given a chat transcript between a visitor and an AI assistant, produce:
1. A concise summary in 2-3 sentences capturing the visitor's intent, key topics discussed, and outcome.
2. A list of 2-5 topic/interest keywords (short phrases) that describe what the visitor was interested in.

Respond in valid JSON format only:
{"summary": "...", "topicKeywords": ["keyword1", "keyword2", ...]}`
        },
        {
          role: "user",
          content: transcript
        }
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = extractJson(content);
    return {
      summary: String(parsed.summary || ""),
      topicKeywords: Array.isArray(parsed.topicKeywords) ? (parsed.topicKeywords as string[]) : []
    };
  } catch (error) {
    console.error("[Summarization] Error:", error);
    return null;
  }
}

export async function summarizeAndSaveConversation(
  conversationId: string,
  openaiApiKey?: string
): Promise<boolean> {
  const result = await summarizeConversation(conversationId, openaiApiKey);
  if (!result) return false;

  try {
    await storage.updateConversationSummary(
      conversationId,
      result.summary,
      JSON.stringify(result.topicKeywords)
    );
    return true;
  } catch (error) {
    console.error("[Summarization] Failed to save:", error);
    return false;
  }
}

export async function bulkSummarizeUnsummarized(
  businessAccountId: string,
  openaiApiKey?: string,
  limit: number = 20
): Promise<number> {
  try {
    const unsummarized = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.businessAccountId, businessAccountId),
          isNull(conversations.summary)
        )
      )
      .orderBy(sql`${conversations.createdAt} DESC`)
      .limit(limit);

    let count = 0;
    for (const conv of unsummarized) {
      const msgCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.conversationId, conv.id));

      if (Number(msgCount[0]?.count || 0) < 3) continue;

      const success = await summarizeAndSaveConversation(conv.id, openaiApiKey);
      if (success) count++;
    }

    return count;
  } catch (error) {
    console.error("[BulkSummarize] Error:", error);
    return 0;
  }
}
