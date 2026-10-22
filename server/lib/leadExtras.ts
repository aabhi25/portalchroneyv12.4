// Extra fields for website leads in the Leads tables (business account and group admin).
import { db } from "../db";
import { journeyResponses, journeySteps, journeySessions, conversationJourneys } from "@shared/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

/** Internal markers kept in topicsOfInterest (funnel source), not interests. */
export const FUNNEL_MARKERS = new Set(["Via Form", "Via Journey Form", "Discount Availed"]);

/**
 * Adds to each website lead (a leads row: conversationId, businessAccountId, topicsOfInterest):
 * - `interestTopics`: the topics that are real interests. Journeys also store their answers in
 *   topicsOfInterest (other features rely on that), so the lead's own journey answers and the
 *   funnel markers are left out; the answers are shown with their questions instead.
 * - `hasJourneyAnswers`, `journeyName` (the Journey column).
 */
export async function addWebsiteLeadExtras(leadRows: Array<Record<string, any>>, maskedAccountIds: Set<string>): Promise<void> {
  if (leadRows.length === 0) return;
  // Exports can hold thousands of leads: look them up in batches (query parameter limit).
  const BATCH = 2000;
  if (leadRows.length > BATCH) {
    for (let i = 0; i < leadRows.length; i += BATCH) await addWebsiteLeadExtras(leadRows.slice(i, i + BATCH), maskedAccountIds);
    return;
  }
  const conversationIds = Array.from(new Set(leadRows.map(r => r.conversationId).filter((v): v is string => typeof v === "string" && !!v)));
  const accountIds = Array.from(new Set(leadRows.map(r => r.businessAccountId).filter((v): v is string => typeof v === "string" && !!v)));
  const answersByConv = new Map<string, Array<{ question: string; answer: string }>>();
  const journeyNameByConv = new Map<string, string>();
  if (conversationIds.length > 0 && accountIds.length > 0) {
    const [answers, sessions] = await Promise.all([
      db.select({ conversationId: journeyResponses.conversationId, response: journeyResponses.response, question: journeySteps.questionText })
        .from(journeyResponses)
        .leftJoin(journeySteps, eq(journeySteps.id, journeyResponses.stepId))
        .where(inArray(journeyResponses.conversationId, conversationIds))
        .orderBy(asc(journeyResponses.createdAt)),
      db.select({ conversationId: journeySessions.conversationId, name: conversationJourneys.name })
        .from(journeySessions)
        .leftJoin(conversationJourneys, eq(conversationJourneys.id, journeySessions.journeyId))
        .where(and(inArray(journeySessions.businessAccountId, accountIds), inArray(journeySessions.conversationId, conversationIds)))
        .orderBy(asc(journeySessions.createdAt)),
    ]);
    for (const a of answers) {
      const list = answersByConv.get(a.conversationId) || [];
      list.push({ question: (a.question || "").trim(), answer: a.response });
      answersByConv.set(a.conversationId, list);
    }
    for (const s of sessions) {
      if (s.name && !journeyNameByConv.has(s.conversationId)) journeyNameByConv.set(s.conversationId, s.name);
    }
  }
  for (const lead of leadRows) {
    const topics: string[] = Array.isArray(lead.topicsOfInterest) ? lead.topicsOfInterest : [];
    const answers: Array<{ question: string; answer: string }> = (lead.conversationId && answersByConv.get(lead.conversationId)) || [];
    const answerTexts = new Set(answers.map(a => a.answer.trim().toLowerCase()));
    lead.interestTopics = topics.filter(t => typeof t === "string" && !FUNNEL_MARKERS.has(t) && !answerTexts.has(t.trim().toLowerCase()));
    lead.hasJourneyAnswers = answers.length > 0;
    lead.journeyName = (lead.conversationId && journeyNameByConv.get(lead.conversationId)) || null;
  }
}
