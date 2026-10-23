// Conversation list rows (business account and group admin): who the visitor is, what they're
// after, and the lead / journey / form badges.
import { db } from "../db";
import { leads, leadConversations, conversations, journeySessions, conversationJourneys, journeyResponses, messages } from "@shared/schema";
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
  /** The lead this chat belongs to (directly, or an earlier chat of a returning visitor). */
  leadId: string | null;
  /** Which of the person's enquiries this chat is ("2 of 2"); null without a lead or with only one chat. */
  enquiry: { number: number; count: number } | null;
  /** The same person's other chats, oldest first. */
  relatedChats: Array<{ id: string; createdAt: string }>;
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
  const leadIdByConv = new Map<string, string>();
  const chatsByLead = new Map<string, Array<{ id: string; createdAt: Date }>>();
  const enquiryCountByLead = new Map<string, number>();
  const journeyNameByConv = new Map<string, string>();
  const answersByConv = new Map<string, string[]>();
  const lastMessageByConv = new Map<string, { role: string; content: string }>();
  if (conversationIds.length > 0 && accountIds.length > 0) {
    const leadCols = { id: leads.id, topicsOfInterest: leads.topicsOfInterest, name: leads.name, phone: leads.phone, email: leads.email, enquiryCount: leads.enquiryCount };
    const [directLeadRows, linkedLeadRows, journeyRows, answerRows, lastMessageRows] = await Promise.all([
      db.select({ conversationId: leads.conversationId, ...leadCols })
        .from(leads)
        .where(and(inArray(leads.businessAccountId, accountIds), inArray(leads.conversationId, conversationIds)))
        .orderBy(asc(leads.createdAt)),
      // A returning visitor's lead moved on to their latest chat; their earlier chats are linked here.
      db.select({ conversationId: leadConversations.conversationId, ...leadCols })
        .from(leadConversations)
        .innerJoin(leads, eq(leads.id, leadConversations.leadId))
        .where(and(inArray(leadConversations.businessAccountId, accountIds), inArray(leadConversations.conversationId, conversationIds)))
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
    const leadRows = [...directLeadRows, ...linkedLeadRows];
    for (const row of leadRows) {
      if (row.conversationId) {
        if (!leadIdByConv.has(row.conversationId)) leadIdByConv.set(row.conversationId, row.id);
        enquiryCountByLead.set(row.id, row.enquiryCount ?? 1);
        const topics = (row.topicsOfInterest as string[]) || [];
        const badge = topics.includes('Discount Availed') ? 'Discount Availed' : 'Lead Captured';
        leadBadgeMap.set(row.conversationId, badge);
        if (topics.includes('Via Form')) viaFormConvIds.add(row.conversationId);
        if (!leadContact.has(row.conversationId)) {
          leadContact.set(row.conversationId, { name: row.name, phone: row.phone, email: row.email });
        }
      }
    }
    // Every chat of these leads (the lead's own + linked ones), to link them to each other.
    const leadIds = Array.from(new Set(leadIdByConv.values()));
    if (leadIds.length > 0) {
      const [own, linked] = await Promise.all([
        db.select({ leadId: leads.id, id: conversations.id, createdAt: conversations.createdAt })
          .from(leads).innerJoin(conversations, eq(conversations.id, leads.conversationId))
          .where(inArray(leads.id, leadIds)),
        db.select({ leadId: leadConversations.leadId, id: conversations.id, createdAt: conversations.createdAt })
          .from(leadConversations).innerJoin(conversations, eq(conversations.id, leadConversations.conversationId))
          .where(inArray(leadConversations.leadId, leadIds)),
      ]);
      for (const row of [...own, ...linked]) {
        const list = chatsByLead.get(row.leadId) || [];
        if (!list.some(c => c.id === row.id)) list.push({ id: row.id, createdAt: row.createdAt });
        chatsByLead.set(row.leadId, list);
      }
      chatsByLead.forEach(list => list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()));
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
    const leadId = leadIdByConv.get(conv.id) || null;
    const chats = leadId ? chatsByLead.get(leadId) || [] : [];
    const position = chats.findIndex(c => c.id === conv.id);
    const count = Math.max(leadId ? enquiryCountByLead.get(leadId) ?? 1 : 1, chats.length);
    out.set(conv.id, {
      leadId,
      enquiry: leadId && count > 1 ? { number: position >= 0 ? position + 1 : count, count } : null,
      relatedChats: chats.filter(c => c.id !== conv.id).map(c => ({ id: c.id, createdAt: c.createdAt.toISOString() })),
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
