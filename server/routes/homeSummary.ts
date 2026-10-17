// Home dashboard: what each AI agent did since a given moment (the viewer's midnight), and the
// things that need someone's attention. Counts only; no lead details or credentials.
import { Router } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, requireBusinessAccount } from "../auth";
import { db } from "../db";
import { resolveAuthorizedLeadAccountId } from "../lib/leadAccess";

const router = Router();

/** Failed sync states a person should look at (pending/synced/not-qualified are fine). */
const FAILED = sql`('failed', 'permanently_failed', 'needs_attention')`;

async function count(query: ReturnType<typeof sql>): Promise<number> {
  try {
    const result: any = await db.execute(query);
    return Number(result.rows?.[0]?.n ?? 0);
  } catch (error: any) {
    // A channel's tables may not exist on an old database; that channel simply shows 0.
    console.warn("[HomeSummary] count failed:", error?.message);
    return 0;
  }
}

/**
 * GET /api/home/summary?since=<ISO time>
 * `since` is the start of "today" in the viewer's own time zone (defaults to 24 hours ago).
 */
router.get("/api/home/summary", requireAuth, requireBusinessAccount, async (req, res) => {
  try {
    const accountId = req.user ? await resolveAuthorizedLeadAccountId(req.user) : null;
    if (!accountId) return res.status(403).json({ error: "Business account access is no longer authorized" });

    const parsed = typeof req.query.since === "string" ? new Date(req.query.since) : null;
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Never look back more than two days, whatever the client sends.
    const since = parsed && !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now() - 48 * 60 * 60 * 1000 ? parsed : dayAgo;
    const s = since.toISOString();

    const [
      webPeople, webLeads,
      waPeople, waLeads,
      igPeople, igLeads,
      fbPeople, fbLeads,
      callsMade, callsAnswered,
      unanswered,
      webCrmFailed, waCrmFailed, igCrmFailed, fbCrmFailed,
    ] = await Promise.all([
      count(sql`SELECT count(*)::int AS n FROM conversations WHERE business_account_id = ${accountId} AND created_at >= ${s} AND is_internal_test = 'false'`),
      count(sql`SELECT count(*)::int AS n FROM leads WHERE business_account_id = ${accountId} AND created_at >= ${s}`),
      count(sql`SELECT count(*)::int AS n FROM whatsapp_sessions WHERE business_account_id = ${accountId} AND last_user_message_at >= ${s}`),
      count(sql`SELECT count(*)::int AS n FROM whatsapp_leads WHERE business_account_id = ${accountId} AND created_at >= ${s}`),
      count(sql`SELECT count(DISTINCT sender_id)::int AS n FROM instagram_messages WHERE business_account_id = ${accountId} AND direction = 'incoming' AND created_at >= ${s}`),
      count(sql`SELECT count(*)::int AS n FROM instagram_leads WHERE business_account_id = ${accountId} AND created_at >= ${s}`),
      count(sql`SELECT count(DISTINCT sender_id)::int AS n FROM facebook_messages WHERE business_account_id = ${accountId} AND direction = 'incoming' AND created_at >= ${s}`),
      count(sql`SELECT count(*)::int AS n FROM facebook_leads WHERE business_account_id = ${accountId} AND created_at >= ${s}`),
      count(sql`SELECT count(*)::int AS n FROM ai_calls WHERE business_account_id = ${accountId} AND started_at >= ${s}`),
      count(sql`SELECT count(*)::int AS n FROM ai_calls WHERE business_account_id = ${accountId} AND answered_at >= ${s}`),
      count(sql`SELECT count(*)::int AS n FROM question_bank_entries WHERE business_account_id = ${accountId} AND status = 'new'`),
      count(sql`SELECT count(*)::int AS n FROM leads WHERE business_account_id = ${accountId} AND (leadsquared_sync_status IN ${FAILED} OR salesforce_sync_status IN ${FAILED} OR custom_crm_sync_status IN ${FAILED})`),
      count(sql`SELECT count(*)::int AS n FROM whatsapp_leads WHERE business_account_id = ${accountId} AND (leadsquared_sync_status IN ${FAILED} OR custom_crm_sync_status IN ${FAILED})`),
      count(sql`SELECT count(*)::int AS n FROM instagram_leads WHERE business_account_id = ${accountId} AND (leadsquared_sync_status IN ${FAILED} OR salesforce_sync_status IN ${FAILED} OR custom_crm_sync_status IN ${FAILED})`),
      count(sql`SELECT count(*)::int AS n FROM facebook_leads WHERE business_account_id = ${accountId} AND (leadsquared_sync_status IN ${FAILED} OR salesforce_sync_status IN ${FAILED} OR custom_crm_sync_status IN ${FAILED})`),
    ]);

    res.json({
      since: s,
      agents: {
        website: { people: webPeople, leads: webLeads },
        whatsapp: { people: waPeople, leads: waLeads },
        instagram: { people: igPeople, leads: igLeads },
        facebook: { people: fbPeople, leads: fbLeads },
        calls: { calls: callsMade, answered: callsAnswered },
      },
      attention: {
        unansweredQuestions: unanswered,
        crmSyncProblems: webCrmFailed + waCrmFailed + igCrmFailed + fbCrmFailed,
      },
    });
  } catch (error: any) {
    console.error("[HomeSummary] failed:", error?.message);
    res.status(500).json({ error: "Failed to load the summary" });
  }
});

export default router;
