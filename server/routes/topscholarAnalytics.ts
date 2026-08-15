import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireBusinessAccount, requireRole } from "../auth";
import {
  isTopscholarAccount,
  getTopscholarConfig,
  TOPSCHOLAR_ACCOUNT_ID,
} from "../services/topscholar/config";
import { verifyLaunchToken } from "../services/topscholar/tokenService";
import {
  getOverview,
  getTopQuestions,
  getCurriculumBreakdown,
  getEngagementTrends,
  getAdoption,
  getDoubtsExport,
  getStudentRoster,
  getStudentRosterPage,
  getStudentReport,
  getStudentConversations,
  getConversationTranscript,
  decodePortalCursor,
  PortalCursorError,
  DOUBT_EXPORT_MAX_ROWS,
  type AnalyticsFilters,
  type TrendBucket,
} from "../services/topscholar/analyticsService";
import { triggerSentimentEnrichment } from "../services/topscholar/sentimentEnrichment";
import type { StudentScope } from "../services/topscholar/scopeResolver";

const router = Router();

// ---- Admin guard stack (school/server-to-server, account-scoped) ----------
const requireTopscholarAccount = (req: Request, res: Response, next: Function) => {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId || !isTopscholarAccount(businessAccountId)) {
    return res.status(403).json({ error: "TopScholar curriculum mode is not available for this account." });
  }
  next();
};

const adminGuards = [
  requireAuth,
  requireBusinessAccount,
  requireRole("business_user", "super_admin"),
  requireTopscholarAccount,
] as const;

function getBusinessAccountId(req: Request): string | null {
  const user = (req as any).user;
  return user?.businessAccountId || null;
}

/** Parse ISO date query params into a filter window (inclusive). Invalid => omitted. */
function parseDate(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseScope(req: Request): StudentScope {
  const q = req.query;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    board: str(q.board),
    medium: str(q.medium),
    grade: str(q.grade),
    subject: str(q.subject),
  };
}

function parseFilters(req: Request): AnalyticsFilters {
  return {
    from: parseDate(req.query.from),
    to: parseDate(req.query.to),
    scope: parseScope(req),
  };
}

function parseLimit(raw: unknown, def: number, max: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def;
}

// ---- CSV export helpers ----------------------------------------------------

/**
 * Escape one CSV cell.
 *
 * Beyond normal RFC4180 quoting, this neutralises spreadsheet formula
 * injection: a cell starting with = + - @ (or tab/CR, which Excel strips before
 * evaluating) is prefixed with a single quote. Student names and doubt text are
 * attacker-influenced free text and land straight in an admin's Excel, so an
 * unescaped `=HYPERLINK(...)` payload would execute on open.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  // Leading BOM so Excel opens UTF-8 (student names are frequently non-ASCII)
  // in the correct encoding instead of mojibake.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function sendCsv(res: Response, filename: string, body: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
}

/** `topscholar-doubts-2026-08-09.csv` */
function exportFilename(kind: string): string {
  return `topscholar-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}

// ---- Admin analytics endpoints --------------------------------------------

router.get("/api/topscholar/analytics/overview", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  triggerSentimentEnrichment(businessAccountId); // best-effort backfill, non-blocking
  const data = await getOverview(businessAccountId, parseFilters(req));
  res.json(data);
});

router.get("/api/topscholar/analytics/top-questions", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  const limit = parseLimit(req.query.limit, 10, 50);
  res.json(await getTopQuestions(businessAccountId, parseFilters(req), limit));
});

router.get("/api/topscholar/analytics/curriculum", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  res.json(await getCurriculumBreakdown(businessAccountId, parseFilters(req)));
});

router.get("/api/topscholar/analytics/trends", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  const raw = req.query.bucket;
  const bucket: TrendBucket = raw === "week" ? "week" : raw === "month" ? "month" : "day";
  res.json(await getEngagementTrends(businessAccountId, parseFilters(req), bucket));
});

router.get("/api/topscholar/analytics/adoption", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  res.json(await getAdoption(businessAccountId, parseFilters(req)));
});

router.get("/api/topscholar/analytics/students", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  const search = typeof req.query.q === "string" ? req.query.q : null;
  const limit = parseLimit(req.query.limit, 200, 500);
  res.json(await getStudentRoster(businessAccountId, parseFilters(req), { search, limit }));
});

// ---- CSV exports -----------------------------------------------------------
// Registered BEFORE `/students/:studentId` so "export" is never swallowed as a
// studentId by the parameterised route.

router.get("/api/topscholar/analytics/students/export", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  const search = typeof req.query.q === "string" ? req.query.q : null;
  const rows = await getStudentRoster(businessAccountId, parseFilters(req), { search, limit: 5000 });
  sendCsv(
    res,
    exportFilename("students"),
    toCsv(
      ["Student ID", "Student Name", "Curriculum", "Grade", "Chat Sessions", "Doubts Asked", "Last Active"],
      rows.map((r) => [
        r.studentId,
        r.studentName,
        r.curriculumLabel,
        r.grade,
        r.conversationCount,
        r.questionCount,
        r.lastActive,
      ]),
    ),
  );
});

router.get("/api/topscholar/analytics/doubts/export", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  const rows = await getDoubtsExport(businessAccountId, parseFilters(req), DOUBT_EXPORT_MAX_ROWS);
  sendCsv(
    res,
    exportFilename("doubts"),
    toCsv(
      [
        "Asked At",
        "Student ID",
        "Student Name",
        "Curriculum",
        "Board",
        "Medium",
        "Grade",
        "Subject",
        "Topic",
        "Subtopic",
        "Sentiment",
        "Session Resolution Status",
        "Chat Session ID",
        "Doubt",
      ],
      rows.map((r) => [
        r.askedAt,
        r.studentId,
        r.studentName,
        r.curriculumLabel,
        r.board,
        r.medium,
        r.grade,
        r.subject,
        r.topic,
        r.subtopic,
        r.sentiment,
        r.resolutionStatus,
        r.conversationId,
        r.doubtText,
      ]),
    ),
  );
});

router.get("/api/topscholar/analytics/students/:studentId", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  const report = await getStudentReport(businessAccountId, req.params.studentId, parseFilters(req));
  if (!report) return res.status(404).json({ error: "No activity found for this student." });
  res.json(report);
});

// ---- Parent-facing single-student report (signed student token) -----------
// Auth is the signed TopScholar launch token (NOT an admin session). The token
// carries the studentId; the report is hard-scoped to THAT student only, so a
// parent can never read another child's data. Fails closed on any token problem.
router.get("/api/topscholar/analytics/student-report", async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) return res.status(401).json({ error: "A student report token is required." });

  const [account] = await db
    .select()
    .from(businessAccounts)
    .where(eq(businessAccounts.id, TOPSCHOLAR_ACCOUNT_ID));
  if (!account) return res.status(403).json({ error: "TopScholar is not configured." });

  const cfg = getTopscholarConfig(account);
  if (!cfg.tokenSecret) return res.status(403).json({ error: "Student reports are not enabled." });

  const payload = verifyLaunchToken(cfg.tokenSecret, token);
  if (!payload || !payload.studentId || !payload.cpId) {
    return res.status(401).json({ error: "Invalid or expired student report token." });
  }

  // Bind the report to BOTH the token's studentId and its cp_id so a token can
  // never read another student's data even if a studentId collided across packs.
  const report = await getStudentReport(TOPSCHOLAR_ACCOUNT_ID, payload.studentId, parseFilters(req), {
    cpIds: [payload.cpId],
  });
  if (!report) return res.status(404).json({ error: "No activity found for this student." });
  res.json(report);
});

// ---- Client portal pull API (server-to-server, shared-secret auth) --------
// The client portal calls these from its OWN backend to pull a student's past
// conversations and insights on demand. Auth is the account's shared secret
// (the same Launch Token Secret) presented as a Bearer credential. It resolves
// to exactly ONE TopScholar account; every response is hard-scoped to it, so
// one client can never read another account's data. The secret must only be
// sent server-to-server over HTTPS — never from a browser.

function extractPortalSecret(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) {
    const v = auth.replace(/^Bearer\s+/i, "").trim();
    if (v) return v;
  }
  const h = req.headers["x-topscholar-secret"];
  if (typeof h === "string" && h.trim()) return h.trim();
  return null;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function requirePortalAuth(req: Request, res: Response, next: Function) {
  const provided = extractPortalSecret(req);
  if (!provided) {
    return res.status(401).json({ error: "Missing portal API credential." });
  }
  const [account] = await db
    .select()
    .from(businessAccounts)
    .where(eq(businessAccounts.id, TOPSCHOLAR_ACCOUNT_ID));
  if (!account) return res.status(403).json({ error: "TopScholar is not configured." });

  const cfg = getTopscholarConfig(account);
  if (!cfg.tokenSecret) {
    return res.status(403).json({ error: "Portal API access is not enabled." });
  }
  if (!timingSafeEqualStr(provided, cfg.tokenSecret)) {
    return res.status(401).json({ error: "Invalid portal API credential." });
  }
  (req as any).portalAccountId = TOPSCHOLAR_ACCOUNT_ID;
  next();
}

// Admin self-test: confirms the portal API is wired and shows admins how the
// client should call it. Uses the admin session (NOT the shared secret) so it
// can be run from the dashboard without exposing the secret.
router.get("/api/topscholar/portal/self-test", ...adminGuards, async (req: Request, res: Response) => {
  const businessAccountId = getBusinessAccountId(req)!;
  const [account] = await db
    .select()
    .from(businessAccounts)
    .where(eq(businessAccounts.id, businessAccountId));
  const cfg = account ? getTopscholarConfig(account) : null;
  if (!cfg?.tokenSecret) {
    return res.json({
      ok: false,
      configured: false,
      message: "Set and save a Launch Token Secret first, then test portal access.",
    });
  }
  const overview = await getOverview(businessAccountId, {});
  res.json({
    ok: true,
    configured: true,
    basePath: "/api/topscholar/portal",
    authHeader: "Authorization: Bearer <shared secret>",
    sample: {
      totalStudents: overview.totalStudents,
      totalConversations: overview.totalConversations,
    },
  });
});

// Roster of the account's students with summary insights. Cursor-paginated:
// follow `nextCursor` until it is null to retrieve every student. Optional
// `updatedAfter` (ISO-8601) returns only students active since then for
// incremental cron syncs. Optional `q` searches name/studentId.
router.get("/api/topscholar/portal/students", requirePortalAuth, async (req: Request, res: Response) => {
  const businessAccountId = (req as any).portalAccountId as string;
  const search = typeof req.query.q === "string" ? req.query.q : null;
  let cursor;
  try {
    cursor = decodePortalCursor(req.query.cursor);
  } catch (err) {
    if (err instanceof PortalCursorError) return res.status(400).json({ error: "Invalid cursor." });
    throw err;
  }
  const result = await getStudentRosterPage(businessAccountId, parseFilters(req), {
    search,
    cursor,
    updatedAfter: parseDate(req.query.updatedAfter) ?? null,
  });
  res.json({ items: result.items, nextCursor: result.nextCursor });
});

// Single student's insights (sentiment, subjects, counts, recent questions).
router.get("/api/topscholar/portal/students/:studentId", requirePortalAuth, async (req: Request, res: Response) => {
  const businessAccountId = (req as any).portalAccountId as string;
  const report = await getStudentReport(businessAccountId, req.params.studentId, parseFilters(req));
  if (!report) return res.status(404).json({ error: "No activity found for this student." });
  res.json(report);
});

// One student's past conversations (cursor-paginated, newest first). Follow
// `nextCursor` until it is null to retrieve every conversation. Optional
// `updatedAfter` (ISO-8601) limits to conversations active since then.
router.get("/api/topscholar/portal/students/:studentId/conversations", requirePortalAuth, async (req: Request, res: Response) => {
  const businessAccountId = (req as any).portalAccountId as string;
  let cursor;
  try {
    cursor = decodePortalCursor(req.query.cursor);
  } catch (err) {
    if (err instanceof PortalCursorError) return res.status(400).json({ error: "Invalid cursor." });
    throw err;
  }
  const result = await getStudentConversations(businessAccountId, req.params.studentId, parseFilters(req), {
    cursor,
    updatedAfter: parseDate(req.query.updatedAfter) ?? null,
  });
  res.json({ items: result.items, nextCursor: result.nextCursor });
});

// Full transcript of one conversation belonging to that student.
router.get("/api/topscholar/portal/students/:studentId/conversations/:conversationId", requirePortalAuth, async (req: Request, res: Response) => {
  const businessAccountId = (req as any).portalAccountId as string;
  const transcript = await getConversationTranscript(
    businessAccountId,
    req.params.studentId,
    req.params.conversationId,
    parseFilters(req),
  );
  if (!transcript) return res.status(404).json({ error: "Conversation not found for this student." });
  res.json(transcript);
});

export default router;
