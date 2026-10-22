// Conversation list rows (business account and group admin): who the visitor is, what they're
// after, and the lead / journey / form badges.
import { db } from "../db";
import { leads, journeySessions, conversationJourneys, journeyResponses, messages } from "@shared/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { maskLeadPhone, maskPhonesInText } from "./leadAccess";

export interface ConversationListExtras {
  hasLead: boolean;
  leadBadge: string | null;
  viaJourney: boolean;
  viaForm: boolean;
  visitorLabel: string;
  subtitle: string | null;
  journeyName: string | null;
}

const DEFAULT_TITLES = new Set(['New Chat', 'Anonymous', '']);
const looksLikeContact = (v: string) => /@/.test(v) || v.replace(/\D/g, '').length >= 7;
const oneLine = (v: string, max = 90) => {
  const t = v.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Extras for each conversation, keyed by conversation id. Phone numbers (in the heading and the
 * latest-message preview) are masked for accounts in `maskedAccountIds`.
 */
export async function conversationListExtras(
  convs: Array<{ id: string; businessAccountId: string | null; title: string | null; visitorCity: string | null }>,
  maskedAccountIds: Set<string>,
): Promise<Map<string, ConversationListExtras>> {
  const out = new Map<string, ConversationListExtras>();
  const conversationIds = convs.map(c => c.id);
  const accountIds = Array.from(new Set(convs.map(c => c.businessAccountId).filter((v): v is string => !!v)));
  const leadBadgeMap = new Map<string, string>();
  const journeyConvIds = new Set<string>();
  const viaFormConvIds = new Set<string>();
  const leadContact = new Map<string, { name: string | null; phone: string | null; email: string | null }>();
  const journeyNameByConv = new Map<string, string>();
  const answersByConv = new Map<string, string[]>();
  const lastMessageByConv = new Map<string, { role: string; content: string }>();
  if (conversationIds.length > 0 && accountIds.length > 0) {
    const [leadRows, journeyRows, answerRows, lastMessageRows] = await Promise.all([
      db.select({ conversationId: leads.conversationId, topicsOfInterest: leads.topicsOfInterest, name: leads.name, phone: leads.phone, email: leads.email })
        .from(leads)
        .where(and(inArray(leads.businessAccountId, accountIds), inArray(leads.conversationId, conversationIds)))
        .orderBy(asc(leads.createdAt)),
      db.select({ conversationId: journeySessions.conversationId, journeyName: conversationJourneys.name })
        .from(journeySessions)
        .leftJoin(conversationJourneys, eq(conversationJourneys.id, journeySessions.journeyId))
        .where(and(inArray(journeySessions.businessAccountId, accountIds), inArray(journeySessions.conversationId, conversationIds)))
        .orderBy(asc(journeySessions.createdAt)),
      db.select({ conversationId: journeyResponses.conversationId, response: journeyResponses.response })
        .from(journeyResponses)
        .where(inArray(journeyResponses.conversationId, conversationIds))
        .orderBy(asc(journeyResponses.createdAt)),
      db.selectDistinctOn([messages.conversationId], { conversationId: messages.conversationId, role: messages.role, content: messages.content })
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
        .orderBy(messages.conversationId, desc(messages.createdAt)),
    ]);
    for (const row of leadRows) {
      if (row.conversationId) {
        const topics = (row.topicsOfInterest as string[]) || [];
        const badge = topics.includes('Discount Availed') ? 'Discount Availed' : 'Lead Captured';
        leadBadgeMap.set(row.conversationId, badge);
        if (topics.includes('Via Form')) viaFormConvIds.add(row.conversationId);
        if (!leadContact.has(row.conversationId)) {
          leadContact.set(row.conversationId, { name: row.name, phone: row.phone, email: row.email });
        }
      }
    }
    for (const row of journeyRows) {
      journeyConvIds.add(row.conversationId);
      if (row.journeyName && !journeyNameByConv.has(row.conversationId)) journeyNameByConv.set(row.conversationId, row.journeyName);
    }
    for (const row of answerRows) {
      const list = answersByConv.get(row.conversationId) || [];
      list.push(row.response);
      answersByConv.set(row.conversationId, list);
    }
    for (const row of lastMessageRows) {
      lastMessageByConv.set(row.conversationId, { role: row.role, content: row.content });
    }
  }

  for (const conv of convs) {
    const maskPhones = !!conv.businessAccountId && maskedAccountIds.has(conv.businessAccountId);
    const lead = leadContact.get(conv.id);
    const journeyName = journeyNameByConv.get(conv.id) || null;
    const visitorLabel = (() => {
      const name = lead?.name?.trim();
      if (name && name !== 'Anonymous') return name;
      if (lead?.phone) return maskPhones ? (maskLeadPhone(lead.phone) as string) : lead.phone;
      if (lead?.email) return lead.email;
      return conv.visitorCity ? `Visitor from ${conv.visitorCity}` : 'Website visitor';
    })();
    const subtitle = (() => {
      // Journey chats: their key answers (contact details are already in the heading).
      const answers = (answersByConv.get(conv.id) || [])
        .map(a => a.trim())
        .filter(a => a && a.length <= 40 && !looksLikeContact(a) && a !== lead?.name);
      if (answers.length > 0) return answers.slice(0, 3).join(' · ');
      // Chats: the topic the AI gave the chat, else the latest message.
      const title = (conv.title || '').trim();
      if (!DEFAULT_TITLES.has(title) && title !== journeyName && !looksLikeContact(title) && title !== lead?.name) return title;
      const last = lastMessageByConv.get(conv.id);
      if (last?.content) {
        const text = maskPhones ? (maskPhonesInText(last.content) || '') : last.content;
        return `${last.role === 'user' ? 'Visitor' : 'AI'}: ${oneLine(text)}`;
      }
      return null;
    })();
    out.set(conv.id, {
      hasLead: leadBadgeMap.has(conv.id),
      leadBadge: leadBadgeMap.get(conv.id) || null,
      viaJourney: journeyConvIds.has(conv.id),
      viaForm: viaFormConvIds.has(conv.id),
      visitorLabel,
      subtitle,
      journeyName,
    });
  }
  return out;
}
