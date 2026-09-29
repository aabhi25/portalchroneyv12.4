/**
 * Integration tests for AI usage reporting and monthly AI spend limits.
 *
 * Covers: IST month/day boundaries, channel classification (SQL == JS),
 * per-account month aggregation and all-accounts summary, endpoint auth
 * (business user / group admin / super admin) with audit rows, warn thresholds
 * firing once per month, block mode refusing calls before they reach (a fake)
 * OpenAI, local spend increments, the 60s cache refresh, and the WhatsApp
 * auto-reply path under a blocked budget.
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at
 * localhost AND AI_USAGE_LIMITS_TEST_DB=1 is set. Never calls real OpenAI.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55484/postgres?sslmode=disable \
 *   AI_USAGE_LIMITS_TEST_DB=1 npx tsx server/services/__tests__/aiUsageLimits.integration.test.ts
 */
import http from "http";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.AI_USAGE_LIMITS_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set AI_USAGE_LIMITS_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
// Never let anything reach the real API.
process.env.OPENAI_API_KEY = "sk-test-not-real";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<boolean> | boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(25); }
  return fn();
}

// ── fake OpenAI ────────────────────────────────────────────────────────────
let openaiHits = 0;
function startFakeOpenAI(): Promise<{ baseURL: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      openaiHits++;
      const body = raw ? JSON.parse(raw) : {};
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-x", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 },
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as AddressInfo).port;
    resolve({ baseURL: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
  }));
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const budget = await import("../aiBudgetService");
  const report = await import("../aiUsageReportService");
  const { createOpenAI, flushUsageRecords, isAiBudgetExceededError, AiBudgetExceededError } = await import("../../lib/openaiClient");
  const { runWithContext } = await import("../../lib/requestContext");
  const { createSession, hashPassword } = await import("../../auth");
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const aiUsageRoutes = (await import("../../routes/aiUsage")).default;
  const svc = budget.aiBudgetService;

  const fake = await startFakeOpenAI();
  const stamp = Date.now();
  const mkAccount = async (name: string) => (await db.insert(schema.businessAccounts).values({ name: `${name} ${stamp}`, website: "https://x.example.com" } as any).returning())[0].id as string;
  const addEvent = async (accountId: string, at: string, costUsd: number, opts: { category?: string; feature?: string; route?: string; requestId?: string } = {}) => {
    const metadata: Record<string, unknown> = {};
    if (opts.feature) metadata.feature = opts.feature;
    if (opts.route) metadata.route = opts.route;
    if (opts.requestId) metadata.requestId = opts.requestId;
    await db.insert(schema.aiUsageEvents).values({
      businessAccountId: accountId,
      category: opts.category || "chat",
      model: "gpt-4o-mini",
      tokensInput: "100",
      tokensOutput: "20",
      costUsd: costUsd.toFixed(6),
      metadata,
      occurredAt: new Date(at),
    });
  };
  const auditCount = async (accountId: string, action: string) =>
    (await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.businessAccountId, accountId), eq(schema.auditEvents.action, action)))).length;
  const nowMonth = budget.istMonthKey();

  try {
    // ── 1. IST month boundaries (explicit: months are Asia/Kolkata calendar months) ──
    {
      expect(budget.istMonthKey(new Date("2026-09-30T18:29:59Z")) === "2026-09", "18:29:59Z on 30 Sep = 23:59 IST → September");
      expect(budget.istMonthKey(new Date("2026-09-30T18:30:00Z")) === "2026-10", "18:30Z on 30 Sep = 00:00 IST 1 Oct → October");
      const r = budget.istMonthRange("2026-10");
      expect(r.start.toISOString() === "2026-09-30T18:30:00.000Z" && r.end.toISOString() === "2026-10-31T18:30:00.000Z", "IST month range in UTC", r);
      expect(budget.istMonthRange("2026-01").start.toISOString() === "2025-12-31T18:30:00.000Z", "January starts 31 Dec 18:30Z (year boundary)");
      expect(budget.istDateKey(new Date("2026-09-14T19:00:00Z")) === "2026-09-15", "IST day key");
      expect(budget.shiftMonthKey("2026-01", -1) === "2025-12", "shiftMonthKey across a year");
    }

    // ── 2. channel classification ──
    {
      const cases: Array<[string, string, string, string]> = [
        ["chat", "unlabeled:server/services/whatsappAutoReplyService.ts:X", "POST /api/webhook/msg91/:businessId", "whatsapp"],
        ["chat", "instagram_webhook", "", "instagram"],
        ["chat", "facebook_webhook", "", "facebook"],
        ["voice_mode", "voice_intent_router", "", "voice"],
        ["chat", "unlabeled:server/chatService.ts:ChatService.streamMessage", "POST /api/chat/widget/stream", "website"],
        ["rag_embeddings", "unlabeled:server/services/embeddingService.ts", "POST /api/public-chat/:token/stream", "website"],
        ["document_analysis", "", "", "training"],
        ["rag_embeddings", "unlabeled:server/services/pdfProcessingService.ts", "POST /api/training/documents", "training"],
        ["chat", "conversation_summary_sweep", "", "other"],
      ];
      for (const [cat, feature, route, want] of cases) {
        expect(report.classifyChannel(cat, feature, route) === want, `classify ${cat}/${feature || route || "-"} → ${want}`, report.classifyChannel(cat, feature, route));
      }
    }

    // ── 3. aggregation by channel / day / month incl. IST boundaries ──
    const A = await mkAccount("Usage agg");
    {
      await addEvent(A, "2026-08-31T18:29:00Z", 1.0, { route: "POST /api/chat/widget", requestId: "aug" });                  // 31 Aug IST → August
      await addEvent(A, "2026-08-31T18:31:00Z", 0.5, { route: "POST /api/webhook/msg91/:businessId", requestId: "w1" });      // 1 Sep 00:01 IST
      await addEvent(A, "2026-09-15T06:00:00Z", 0.2, { route: "POST /api/chat/widget/stream", requestId: "r1" });
      await addEvent(A, "2026-09-15T06:00:01Z", 0.1, { route: "POST /api/chat/widget/stream", requestId: "r1" });             // same reply, 2nd call
      await addEvent(A, "2026-09-15T07:00:00Z", 0.05, { category: "rag_embeddings", route: "POST /api/chat/widget/stream", requestId: "r2" }); // embedding: not a reply
      await addEvent(A, "2026-09-16T10:00:00Z", 0.3, { feature: "instagram_webhook" });                                      // no request id → 1 reply
      await addEvent(A, "2026-09-16T11:00:00Z", 0.4, { category: "voice_mode", feature: "voice_realtime" });
      await addEvent(A, "2026-09-17T11:00:00Z", 0.25, { category: "document_analysis" });
      await addEvent(A, "2026-09-18T11:00:00Z", 0.02, { feature: "conversation_summary_sweep" });
      await addEvent(A, "2026-09-30T18:31:00Z", 9.0, { route: "POST /api/chat/widget" });                                   // 1 Oct IST → excluded

      const u = await report.getAccountMonthUsage(A, "2026-09", Date.parse("2026-09-20T12:00:00Z"));
      expect(near(u.totals.costUsd, 0.5 + 0.2 + 0.1 + 0.05 + 0.3 + 0.4 + 0.25 + 0.02), "September total excludes 31 Aug IST and 1 Oct IST", u.totals.costUsd);
      expect(u.totals.aiCalls === 8, "8 AI calls in September", u.totals.aiCalls);
      expect(u.totals.aiReplies === 3, "replies: whatsapp w1 + website r1 (2 calls) + instagram (no id) = 3", u.totals.aiReplies);
      expect(u.totals.tokens === 8 * 120, "tokens summed", u.totals.tokens);
      const ch = Object.fromEntries(u.byChannel.map((c) => [c.channel, c]));
      expect(near(ch.website?.costUsd, 0.35) && ch.website?.aiReplies === 1, "website channel: $0.35, 1 reply", ch.website);
      expect(near(ch.whatsapp?.costUsd, 0.5), "whatsapp channel", ch.whatsapp);
      expect(near(ch.instagram?.costUsd, 0.3), "instagram channel", ch.instagram);
      expect(near(ch.voice?.costUsd, 0.4) && ch.voice?.aiReplies === 0, "voice channel", ch.voice);
      expect(near(ch.training?.costUsd, 0.25), "training channel", ch.training);
      expect(near(ch.other?.costUsd, 0.02), "other channel", ch.other);
      expect(u.daily.length === 20 && u.daily[0].date === "2026-09-01", "daily series 1..20 Sep (days elapsed)", u.daily.length);
      expect(near(u.daily[0].costUsd, 0.5) && near(u.daily[0].byChannel.whatsapp ?? 0, 0.5), "event at 18:31Z 31 Aug lands on 1 Sep IST");
      expect(near(u.daily[14].costUsd, 0.35), "15 Sep total", u.daily[14]);
      expect(near(u.previousMonth.costUsd, 1.0) && u.previousMonth.month === "2026-08", "previous month (August) = $1.00", u.previousMonth);
      expect(near(u.previousMonth.sameDaysCostUsd, 0), "same-days comparison uses first 20 days of August", u.previousMonth.sameDaysCostUsd);
      expect(u.changePercent === null, "no % change when last month's same days were $0");
      expect(u.timezone === "Asia/Kolkata" && u.usdInrRate === 84, "timezone + default INR rate", { tz: u.timezone, r: u.usdInrRate });
      expect(near(u.totals.costInr, u.totals.costUsd * 84), "₹ conversion");
      expect(u.limit === null, "no limit by default");
      const oct = await report.getAccountMonthUsage(A, "2026-10", Date.parse("2026-10-02T00:00:00Z"));
      expect(near(oct.totals.costUsd, 9.0) && near(oct.previousMonth.sameDaysCostUsd, 0.5), "October: 1 Oct IST event, vs first 2 days of Sept ($0.50)", { t: oct.totals.costUsd, p: oct.previousMonth.sameDaysCostUsd });
      expect(near(oct.changePercent ?? 0, 1700), "October +1700% vs same days", oct.changePercent);

      // SQL classifier == JS classifier for every row
      const rows: any = await db.execute(sql`SELECT category, metadata->>'feature' AS f, metadata->>'route' AS r, ${report.channelSql()} AS ch FROM ai_usage_events WHERE business_account_id = ${A}`);
      const mism = (rows.rows ?? rows).filter((r: any) => report.classifyChannel(r.category, r.f, r.r) !== r.ch);
      expect(mism.length === 0, "SQL channel CASE agrees with JS classifier", mism);

      const all = await report.getAllAccountsSummary("2026-09");
      const rowA = all.accounts.find((r) => r.businessAccountId === A);
      expect(rowA && near(rowA.costUsd, u.totals.costUsd) && near(rowA.previousCostUsd, 1.0) && rowA.limit === null, "all-accounts summary row", rowA);
      expect(rowA && near(rowA.trendPercent ?? 0, (u.totals.costUsd - 1) * 100), "trend vs previous month", rowA?.trendPercent);
    }

    // ── 4. endpoints: auth + audit ──
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(aiUsageRoutes);
    const srv = await new Promise<http.Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const G1 = await mkAccount("Group member");
    const OTHER = await mkAccount("Other");
    try {
      const pw = await hashPassword("x-test-password");
      const mkUser = async (role: string, businessAccountId: string | null) =>
        (await db.insert(schema.users).values({ username: `${role}_${stamp}_${Math.random()}`, passwordHash: pw, role, businessAccountId } as any).returning())[0];
      const biz = await mkUser("business_user", A);
      const sup = await mkUser("super_admin", null);
      const grp = await mkUser("account_group_admin", null);
      const [group] = await db.insert(schema.accountGroups).values({ name: `G ${stamp}`, ownerUserId: sup.id } as any).returning();
      await db.insert(schema.accountGroupMembers).values({ groupId: group.id, businessAccountId: G1 } as any);
      await db.insert(schema.accountGroupAdmins).values({ groupId: group.id, userId: grp.id, canViewAnalytics: "true" } as any);
      const cookie = async (u: any) => `session=${await createSession(u.id)}`;
      const [cBiz, cSup, cGrp] = [await cookie(biz), await cookie(sup), await cookie(grp)];
      const call = (method: string, path: string, c: string, body?: unknown) =>
        fetch(base + path, { method, headers: { cookie: c, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

      let r = await call("PUT", `/api/super-admin/usage/limits/${A}`, cBiz, { monthlyLimitUsd: 5, action: "block" });
      expect(r.status === 403, "business user cannot set a limit (403)", r.status);
      expect((await budget.getLimit(A)) === null, "…and no limit row was written");
      r = await call("DELETE", `/api/super-admin/usage/limits/${A}`, cGrp);
      expect(r.status === 403, "group admin cannot remove a limit (403)", r.status);
      r = await call("GET", `/api/super-admin/usage`, cBiz);
      expect(r.status === 403, "business user cannot read the all-accounts summary", r.status);

      r = await call("PUT", `/api/super-admin/usage/limits/${A}`, cSup, { monthlyLimitUsd: 0 });
      expect(r.status === 400, "invalid limit rejected (400)", r.status);
      r = await call("PUT", `/api/super-admin/usage/limits/${A}`, cSup, { monthlyLimitUsd: 50, warnAtPercent: 75, action: "warn" });
      const setBody: any = await r.json();
      expect(r.status === 200 && setBody.limit?.monthlyLimitUsd === "50.00" && setBody.limit?.warnAtPercent === 75, "super admin sets a limit", setBody);
      expect(await auditCount(A, "ai_usage.limit_set") === 1, "limit change audit-logged");
      const [audit] = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.businessAccountId, A), eq(schema.auditEvents.action, "ai_usage.limit_set")));
      expect(audit.actorUserId === sup.id && (audit.metadata as any)?.newLimitUsd === 50 && (audit.metadata as any)?.previousLimitUsd === null, "audit has actor + before/after", audit.metadata);

      r = await call("GET", `/api/usage/summary?month=2026-09`, cBiz);
      const own: any = await r.json();
      expect(r.status === 200 && own.businessAccountId === A && own.limit?.monthlyLimitUsd === 50, "business user reads own usage incl. limit", { s: r.status, id: own.businessAccountId });
      r = await call("GET", `/api/usage/summary?businessAccountId=${OTHER}`, cBiz);
      expect(r.status === 403, "business user cannot read another account", r.status);
      r = await call("GET", `/api/usage/summary?month=2026-13`, cBiz);
      expect(r.status === 400, "bad month rejected", r.status);
      r = await call("GET", `/api/usage/summary?businessAccountId=${G1}`, cGrp);
      expect(r.status === 200, "group admin reads an account in their group", r.status);
      r = await call("GET", `/api/usage/summary?businessAccountId=${OTHER}`, cGrp);
      expect(r.status === 403, "group admin cannot read an account outside their groups", r.status);
      r = await call("GET", `/api/group-admin/usage/accounts`, cGrp);
      const ga: any = await r.json();
      expect(r.status === 200 && ga.accounts.length === 1 && ga.accounts[0].id === G1, "group admin account list", ga);
      r = await call("GET", `/api/usage/summary?businessAccountId=${OTHER}`, cSup);
      expect(r.status === 200, "super admin reads any account", r.status);
      r = await call("GET", `/api/usage/summary`, cSup);
      expect(r.status === 400, "super admin not viewing-as must name an account", r.status);
      r = await call("GET", `/api/super-admin/usage?month=2026-09`, cSup);
      const sum: any = await r.json();
      expect(r.status === 200 && sum.accounts.some((x: any) => x.businessAccountId === A && x.limit?.monthlyLimitUsd === 50), "super admin all-accounts summary incl. limit", r.status);
      r = await call("GET", `/api/usage/limit-status`, cBiz);
      const ls: any = await r.json();
      expect(r.status === 200 && ls.limit?.level === "ok" && ls.month === nowMonth, "limit-status for the banner", ls);

      r = await call("DELETE", `/api/super-admin/usage/limits/${A}`, cSup);
      expect(r.status === 200 && (await r.json()).removed === true && (await budget.getLimit(A)) === null, "super admin removes the limit");
      expect(await auditCount(A, "ai_usage.limit_removed") === 1, "removal audit-logged");
    } finally {
      srv.close();
    }

    // ── 5. warn thresholds fire once per threshold per month ──
    const W = await mkAccount("Warn mode");
    {
      await budget.upsertLimit({ businessAccountId: W, monthlyLimitUsd: 1, warnAtPercent: 80, action: "warn", updatedBy: null });
      const now = new Date().toISOString();
      await addEvent(W, now, 0.5);
      svc.recordSpend(W, 0.5);
      await sleep(150);
      expect(await auditCount(W, "ai_usage.warn_threshold_reached") === 0, "50% → no warning yet");
      await addEvent(W, now, 0.35);
      svc.recordSpend(W, 0.35);
      expect(await until(async () => (await auditCount(W, "ai_usage.warn_threshold_reached")) === 1), "85% → one warn event");
      svc.recordSpend(W, 0.01);
      await svc.refresh();
      await sleep(150);
      expect(await auditCount(W, "ai_usage.warn_threshold_reached") === 1, "…still exactly one after more spend + refresh");
      svc.reset(); // simulate a restart / another process
      await svc.refresh();
      await sleep(150);
      expect(await auditCount(W, "ai_usage.warn_threshold_reached") === 1, "…and after a restart (DB claim)");
      await addEvent(W, now, 0.2);
      svc.recordSpend(W, 0.2);
      expect(await until(async () => (await auditCount(W, "ai_usage.limit_reached")) === 1), "100% → one limit event");
      svc.recordSpend(W, 0.2);
      await sleep(150);
      expect(await auditCount(W, "ai_usage.limit_reached") === 1 && await auditCount(W, "ai_usage.warn_threshold_reached") === 1, "each threshold fired exactly once this month");
      const [sysAudit] = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.businessAccountId, W), eq(schema.auditEvents.action, "ai_usage.limit_reached")));
      expect(sysAudit.actorRole === "system" && (sysAudit.metadata as any)?.month === nowMonth && (sysAudit.metadata as any)?.limitAction === "warn", "limit event is a system audit row with month", sysAudit.metadata);
      const d = svc.check(W) as any;
      expect(d.blocked === false, "warn mode never blocks, even over 100%", d);
      const st = await budget.getLimitStatus(W);
      expect(st.limit?.level === "exceeded", "banner status: exceeded", st.limit);
      await budget.upsertLimit({ businessAccountId: W, monthlyLimitUsd: 10, warnAtPercent: 80, action: "warn", updatedBy: null });
      const lim = await budget.getLimit(W);
      expect(lim?.warnNotifiedMonth === null && lim?.limitNotifiedMonth === null, "raising the limit re-arms the thresholds");
      await budget.upsertLimit({ businessAccountId: W, monthlyLimitUsd: 1.2, warnAtPercent: 80, action: "warn", updatedBy: null });
      expect(await until(async () => (await auditCount(W, "ai_usage.warn_threshold_reached")) === 2), "…so a lowered limit fires its warning again this month");
    }

    // ── 6. block mode refuses before contacting OpenAI ──
    const B = await mkAccount("Block mode");
    const U = await mkAccount("Unlimited");
    {
      await budget.upsertLimit({ businessAccountId: B, monthlyLimitUsd: 0.5, warnAtPercent: 80, action: "block", updatedBy: null });
      await addEvent(B, new Date().toISOString(), 0.6);
      await svc.refresh();
      expect(svc.isBlocked(B) === true, "B is over its block limit");
      const client = createOpenAI({ apiKey: "sk-test", baseURL: fake.baseURL, maxRetries: 0, businessAccountId: B });
      const hits0 = openaiHits;
      let err: any = null;
      try { await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }); } catch (e) { err = e; }
      expect(err instanceof AiBudgetExceededError && isAiBudgetExceededError(err) && err.businessAccountId === B, "call refused with AiBudgetExceededError", err?.message);
      expect(openaiHits === hits0, "fake OpenAI was not contacted", openaiHits - hits0);
      // Account from the request context, embeddings, and opted-out clients are covered too.
      const ctxClient = createOpenAI({ apiKey: "sk-test", baseURL: fake.baseURL, maxRetries: 0 });
      err = null;
      try { await runWithContext({ businessAccountId: B }, () => ctxClient.embeddings.create({ model: "text-embedding-3-small", input: "x" })); } catch (e) { err = e; }
      expect(isAiBudgetExceededError(err), "context-attributed embeddings call refused", err?.message);
      const untracked = createOpenAI({ apiKey: "sk-test", baseURL: fake.baseURL, maxRetries: 0, trackUsage: false, businessAccountId: B });
      err = null;
      try { await untracked.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }); } catch (e) { err = e; }
      expect(isAiBudgetExceededError(err), "usage-opted-out client is still budget-checked", err?.message);
      expect(openaiHits === hits0, "still no request reached OpenAI", openaiHits - hits0);

      // Unlimited account and unknown account are unaffected.
      const res = await createOpenAI({ apiKey: "sk-test", baseURL: fake.baseURL, maxRetries: 0, businessAccountId: U })
        .chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] });
      expect(res.choices[0].message.content === "hi" && openaiHits === hits0 + 1, "unlimited account calls go through");
      const res2 = await ctxClient.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] });
      expect(res2.choices[0].message.content === "hi", "call with no known account is never blocked");

      // Cold cache (first call after start) waits for the load, then refuses.
      svc.reset();
      err = null;
      try { await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }); } catch (e) { err = e; }
      expect(isAiBudgetExceededError(err) && openaiHits === hits0 + 2, "cold cache: loads then refuses", { m: err?.message, h: openaiHits - hits0 });
    }

    // ── 7. local increments + cache refresh ──
    {
      const L = await mkAccount("Local increment");
      await budget.upsertLimit({ businessAccountId: L, monthlyLimitUsd: 0.01, warnAtPercent: 90, action: "block", updatedBy: null });
      await addEvent(L, new Date().toISOString(), 0.009998);
      await svc.refresh();
      const client = createOpenAI({ apiKey: "sk-test", baseURL: fake.baseURL, maxRetries: 0, businessAccountId: L });
      const h0 = openaiHits;
      await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] });
      await flushUsageRecords();
      const refreshes = svc.stats.refreshes;
      let err: any = null;
      try { await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }); } catch (e) { err = e; }
      expect(openaiHits === h0 + 1 && isAiBudgetExceededError(err), "recorded usage pushes spend over the limit locally → next call refused", { h: openaiHits - h0, m: err?.message });
      expect(svc.stats.refreshes === refreshes, "…without a DB refresh");

      const C = await mkAccount("Cache refresh");
      await budget.upsertLimit({ businessAccountId: C, monthlyLimitUsd: 0.5, warnAtPercent: 80, action: "block", updatedBy: null });
      expect(svc.isBlocked(C) === false, "C starts under its limit");
      await addEvent(C, new Date().toISOString(), 1.0); // written by "another process": no local increment
      expect(svc.isBlocked(C) === false, "cache not refreshed yet (< 60s) → still allowed");
      const realNow = svc.now;
      svc.now = () => Date.now() + budget.BUDGET_REFRESH_MS + 1000;
      svc.isBlocked(C); // stale → triggers a background refresh
      expect(await until(() => svc.isBlocked(C) === true), "after 60s the cache refreshes from the DB → blocked");
      // Month rollover: last month's spend no longer counts.
      svc.now = () => Date.parse(budget.istMonthRange(budget.shiftMonthKey(nowMonth, 1)).start.toISOString()) + 1000;
      expect((svc.check(C) as any).blocked === false, "new IST month → spend resets, calls allowed again");
      svc.now = realNow;
      await svc.refresh(); // joins any refresh started under the fake clock…
      await svc.refresh(); // …then reloads with the real one
    }

    // ── 8. WhatsApp auto-reply under a blocked budget ──
    {
      const { whatsappAutoReplyService } = await import("../whatsappAutoReplyService");
      await db.insert(schema.whatsappSettings).values({ businessAccountId: B, autoReplyEnabled: "true" } as any);
      const sent: string[] = [];
      (whatsappAutoReplyService as any).sendSessionAwareMessage = async (_s: any, _to: string, text: string) => { sent.push(text); return { success: true }; };
      const h0 = openaiHits;
      const phone = `9199${String(stamp).slice(-8)}`;
      const r1 = await whatsappAutoReplyService.generateAndSendReply(B, phone, "What are your prices?");
      expect(r1.success === false && /limit/i.test(r1.error || ""), "WhatsApp reply refused without crashing", r1);
      expect(sent.length === 1 && /having trouble answering/.test(sent[0]), "existing AI-failure notice sent once", sent);
      expect(openaiHits === h0, "no OpenAI request made for the WhatsApp message");
      const r2 = await whatsappAutoReplyService.generateAndSendReply(B, phone, "Hello?");
      expect(r2.success === false && sent.length === 1, "second message within 5 min: no repeated notice", sent.length);
    }
  } finally {
    fake.close();
    svc.stop();
  }

  console.log(failed ? `\n${failed} FAILED` : "\nAll AI usage/limit tests passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
