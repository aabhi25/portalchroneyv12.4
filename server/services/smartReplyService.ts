import { db } from "../db";
import { smartReplies } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface SmartReplyMatch {
  id: string;
  keywords: string;
  responseText: string;
  responseUrl: string | null;
  priority: number;
  matchedKeyword: string;
}

export async function matchSmartReplies(
  businessAccountId: string,
  channel: string,
  userMessage: string
): Promise<SmartReplyMatch | null> {
  const rules = await db
    .select()
    .from(smartReplies)
    .where(
      and(
        eq(smartReplies.businessAccountId, businessAccountId),
        eq(smartReplies.channel, channel),
        eq(smartReplies.isActive, true)
      )
    );

  const messageLower = userMessage.toLowerCase();

  const matches: SmartReplyMatch[] = [];

  for (const rule of rules) {
    const keywords = rule.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
    for (const keyword of keywords) {
      if (messageLower.includes(keyword)) {
        matches.push({
          id: rule.id,
          keywords: rule.keywords,
          responseText: rule.responseText,
          responseUrl: rule.responseUrl,
          priority: rule.priority,
          matchedKeyword: keyword,
        });
        break;
      }
    }
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => b.priority - a.priority);
  return matches[0];
}

export function formatSmartReplyResponse(match: SmartReplyMatch): string {
  return match.responseText + (match.responseUrl ? `\n${match.responseUrl}` : '');
}

export async function getSmartReplyResponse(
  businessAccountId: string,
  channel: string,
  userMessage: string
): Promise<{ text: string; matchedKeyword: string; priority: number } | null> {
  const match = await matchSmartReplies(businessAccountId, channel, userMessage);
  if (!match) return null;
  return {
    text: formatSmartReplyResponse(match),
    matchedKeyword: match.matchedKeyword,
    priority: match.priority,
  };
}
