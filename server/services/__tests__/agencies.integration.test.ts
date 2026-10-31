/**
 * Agencies (resellers), through the REAL registerRoutes() app over HTTP with real SQL.
 *
 * Covers: statement maths and catalogue helpers; super admin creating and configuring an agency
 * with an owner login; agency login, /api/auth/me; creating clients within the plan (allowed
 * features, account limit, limit under the cap); feature changes only from the plan; agencies
 * kept apart (another agency's client is invisible); opening a client's portal (acts as the
 * client, super admin routes still refused) and going back; permission switches (open portal,
 * stale sessions ignored); the agency AI cap blocking all its clients but not others; the
 * statement; the widget footer; the LeadSquared source name; team logins; pausing and
 * deleting an agency (clients stay as direct customers).
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at localhost AND
 * AGENCY_TEST_DB=1 is set. Never calls real OpenAI.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55610/postgres?sslmode=disable \
 *   AGENCY_TEST_DB=1 DISABLE_BACKGROUND_JOBS=1 npx tsx server/services/__tests__/agencies.integration.test.ts
 */
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.AGENCY_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set AGENCY_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.OPENAI_API_KEY = "sk-test-not-real";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

async function main() {
  const shared = await import("@shared/agency");

  // ── 1. Pure helpers ─────────────────────────────────────────────────────
  {
    const billing = shared.resolveAgencyBilling({ model: "per_account", currency: "INR", pricePerAccount: 1000, includedAiPerAccount: 100, aiMarkupPercent: 20, monthlyFee: 500 });
    const st = shared.computeAgencyStatement({
      month: "2026-10", billing, usdToInr: 84,
      accounts: [
        { businessAccountId: "a", name: "A", status: "active", aiCostUsd: 2 },      // ₹168 → ₹68 over → ₹81.6
        { businessAccountId: "b", name: "B", status: "active", aiCostUsd: 0.5 },    // ₹42 → within allowance
        { businessAccountId: "c", name: "C", status: "suspended", aiCostUsd: 1 },   // no fee; ₹84 → within allowance
      ],
    });
    expect(st.accounts === 2 && st.accountFees === 2000, "statement: fee only for active accounts", st);
    expect(Math.abs(st.aiCharges - 81.6) < 0.01, "statement: AI above the allowance with markup, in rupees", st.aiCharges);
    expect(Math.abs(st.total - 2581.6) < 0.01, "statement: total = fees + AI + monthly fee", st.total);
    expect(st.lines.find(l => l.businessAccountId === "c")!.amount === 0, "statement: paused account adds nothing within allowance");
    const usage = shared.computeAgencyStatement({ month: "2026-10", billing: { ...billing, model: "usage", pricePerAccount: 0, monthlyFee: 0 }, usdToInr: 84, accounts: [{ businessAccountId: "a", name: "A", status: "active", aiCostUsd: 1 }] });
    expect(Math.abs(usage.total - 84 * 1.2) < 0.01, "statement: usage model has no allowance", usage.total);
    const custom = shared.computeAgencyStatement({ month: "2026-10", billing: { ...billing, model: "custom" }, usdToInr: 84, accounts: [{ businessAccountId: "a", name: "A", status: "active", aiCostUsd: 5 }] });
    expect(custom.total === 500 && custom.lines[0].aiCost === 420, "statement: custom charges only the fixed fee but lists AI", custom);
    const usd = shared.computeAgencyStatement({ month: "2026-10", billing: { ...billing, currency: "USD", includedAiPerAccount: 0, aiMarkupPercent: 0, monthlyFee: 0, pricePerAccount: 10 }, usdToInr: 84, accounts: [{ businessAccountId: "a", name: "A", status: "active", aiCostUsd: 1.5 }] });
    expect(usd.total === 11.5, "statement: USD agencies are not converted", usd.total);

    const perms = shared.resolveAgencyPermissions({ seeCosts: false, bogus: true });
    expect(perms.seeCosts === false && perms.createAccounts === true && perms.setupConnectedApps === false && !("bogus" in perms), "permissions: stored values over defaults, unknown dropped", perms);
    expect(JSON.stringify(shared.cleanFeatureList(["whatsappEnabled", "nope", "chroneyEnabled", "chroneyEnabled"])) === JSON.stringify(["chroneyEnabled", "whatsappEnabled"]), "features: cleaned, unique, catalogue order");
    expect(JSON.stringify(shared.agencyWidgetFooter(shared.resolveAgencyBranding({ widgetFooter: "agency", footerUrl: "javascript:alert(1)" }, "Acme"))) === JSON.stringify({ hidden: false, text: "Acme", url: "" }), "footer: agency name, unsafe link dropped");
    expect(shared.agencyWidgetFooter(shared.resolveAgencyBranding({ widgetFooter: "platform" }, "Acme")) === null, "footer: platform keeps the account's own setting");
  }

  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  const { registerRoutes } = await import("../../routes");
  const { hashPassword, createSession } = await import("../../auth");
  const { aiBudgetService } = await import("../aiBudgetService");
  const { storage } = await import("../../storage");
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;

  const stamp = Date.now();
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser(process.env.SESSION_SECRET));
  const server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, cookie?: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
  }
  async function login(username: string, password: string) {
    const r = await call("POST", "/api/auth/login", undefined, { username, password });
    const m = /session=([^;]+)/.exec(r.setCookie || "");
    return { status: r.status, json: r.json, cookie: m ? `session=${m[1]}` : "" };
  }

  // Super admin session.
  const [sa] = await db.insert(schema.users).values({ username: `sa-${stamp}@test.local`, passwordHash: await hashPassword("x-unused-1"), role: "super_admin" } as any).returning();
  const SA = `session=${await createSession(sa.id)}`;

  // A direct customer that must never be affected.
  const [direct] = await db.insert(schema.businessAccounts).values({ name: `Direct ${stamp}`, website: "https://direct.example.com" } as any).returning();

  // ── 2. Super admin creates and configures an agency ─────────────────────
  const ownerEmail = `owner-${stamp}@agency.test`;
  const created = await call("POST", "/api/super-admin/agencies", SA, { name: `BrightLeaf ${stamp}`, ownerEmail });
  expect(created.status === 200 && created.json.credentials?.tempPassword, "super admin: agency created with an owner login", created);
  const agencyId: string = created.json.agency.id;
  expect(JSON.stringify(created.json.agency.allowedFeatures) === JSON.stringify(shared.DEFAULT_AGENCY_FEATURES), "new agency: default resellable features");
  const dupe = await call("POST", "/api/super-admin/agencies", SA, { name: "Other", ownerEmail });
  expect(dupe.status === 409, "super admin: owner email already used → refused", dupe.status);
  const biz = await call("POST", "/api/agency/clients", SA, {});
  expect(biz.status === 403, "agency routes refuse super admins", biz.status);

  const patched = await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, {
    maxAccounts: 2, allowedFeatures: ["chroneyEnabled", "whatsappEnabled", "bogusFeature"], monthlyAiCapUsd: 10, aiCapAction: "block",
    permissions: { setupConnectedApps: false }, billing: { model: "per_account", currency: "INR", pricePerAccount: 1000, includedAiPerAccount: 100, aiMarkupPercent: 20 },
    branding: { brandName: "LeafBot", widgetFooter: "agency", footerUrl: "https://brightleaf.test" },
  });
  expect(patched.status === 200 && patched.json.agency.maxAccounts === 2 && patched.json.agency.monthlyAiCapUsd === 10, "super admin: plan saved", patched.json);
  expect(JSON.stringify(patched.json.agency.allowedFeatures) === JSON.stringify(["chroneyEnabled", "whatsappEnabled"]), "super admin: unknown features dropped");

  // ── 3. Agency login ─────────────────────────────────────────────────────
  const owner = await login(ownerEmail, created.json.credentials.tempPassword);
  expect(owner.status === 200 && owner.cookie, "agency owner logs in with the temporary password", owner.json);
  const OW = owner.cookie;
  let me = await call("GET", "/api/auth/me", OW);
  expect(me.json.role === "agency_admin" && me.json.agency?.brandName === "LeafBot" && me.json.agency.viewingClient === null && !me.json.businessAccount, "me: agency login, its brand, no client open", me.json);
  const saFromAgency = await call("GET", "/api/super-admin/agencies", OW);
  expect(saFromAgency.status === 403, "agency login can't reach super admin routes", saFromAgency.status);

  // ── 4. Creating clients within the plan ────────────────────────────────
  const notAllowed = await call("POST", "/api/agency/clients", OW, { name: "X", website: "https://x.test", username: `x-${stamp}@c.test`, features: ["instagramEnabled"] });
  expect(notAllowed.status === 400, "client with a feature outside the plan → refused", notAllowed);
  const overCap = await call("POST", "/api/agency/clients", OW, { name: "X", website: "https://x.test", username: `x-${stamp}@c.test`, features: [], monthlyLimitUsd: 50 });
  expect(overCap.status === 400, "client limit above the agency cap → refused", overCap.status);
  const c1 = await call("POST", "/api/agency/clients", OW, { name: `Client One ${stamp}`, website: "https://one.test", username: `one-${stamp}@c.test`, features: ["chroneyEnabled", "whatsappEnabled"], monthlyLimitUsd: 8 });
  expect(c1.status === 200 && c1.json.credentials?.tempPassword, "agency creates a client with its login", c1);
  const c1Id: string = c1.json.client.id;
  const [c1Row] = await db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, c1Id));
  expect(c1Row.agencyId === agencyId && c1Row.whatsappEnabled === "true" && c1Row.instagramEnabled === "false" && c1Row.voiceModeEnabled === "false", "client: belongs to the agency, only chosen features on", c1Row);
  const [lim] = await db.select().from(schema.aiUsageLimits).where(eq(schema.aiUsageLimits.businessAccountId, c1Id));
  expect(lim && Number(lim.monthlyLimitUsd) === 8 && lim.action === "block", "client: monthly AI limit set", lim);
  const c2 = await call("POST", "/api/agency/clients", OW, { name: `Client Two ${stamp}`, website: "https://two.test", username: `two-${stamp}@c.test`, features: ["chroneyEnabled"] });
  expect(c2.status === 200, "second client created", c2.status);
  const c2Id: string = c2.json.client.id;
  const c3 = await call("POST", "/api/agency/clients", OW, { name: "Three", website: "https://three.test", username: `three-${stamp}@c.test`, features: [] });
  expect(c3.status === 403, "third client over the plan's account limit → refused", c3);

  // Client's own login works and knows nothing about the agency side.
  const clientLogin = await login(`one-${stamp}@c.test`, c1.json.credentials.tempPassword);
  expect(clientLogin.status === 200, "client logs in");
  const clientMe = await call("GET", "/api/auth/me", clientLogin.cookie);
  expect(clientMe.json.role === "business_user" && clientMe.json.businessAccount?.id === c1Id && !clientMe.json.agency, "client me: plain business login", clientMe.json);
  const clientAgency = await call("GET", "/api/agency/clients", clientLogin.cookie);
  expect(clientAgency.status === 403, "client can't reach agency routes", clientAgency.status);

  // ── 5. Features only from the plan ─────────────────────────────────────
  const featOut = await call("PATCH", `/api/agency/clients/${c1Id}/features`, OW, { features: { instagramEnabled: true } });
  expect(featOut.status === 403, "agency can't switch on a feature outside its plan", featOut.status);
  const featIn = await call("PATCH", `/api/agency/clients/${c1Id}/features`, OW, { features: { whatsappEnabled: false } });
  expect(featIn.status === 200 && featIn.json.features.whatsappEnabled === false, "agency switches a plan feature off", featIn.json);

  // ── 6. Agencies are kept apart ─────────────────────────────────────────
  const other = await call("POST", "/api/super-admin/agencies", SA, { name: `Other ${stamp}`, ownerEmail: `owner2-${stamp}@agency.test` });
  const otherId: string = other.json.agency.id;
  const OW2 = (await login(`owner2-${stamp}@agency.test`, other.json.credentials.tempPassword)).cookie;
  const oc = await call("POST", "/api/agency/clients", OW2, { name: `Other Client ${stamp}`, website: "https://oc.test", username: `oc-${stamp}@c.test`, features: ["chroneyEnabled"] });
  const ocId: string = oc.json.client.id;
  const list1 = await call("GET", "/api/agency/clients", OW);
  expect(list1.json.clients.length === 2 && !list1.json.clients.some((c: any) => c.id === ocId || c.id === direct.id), "agency sees only its own clients", list1.json.clients.map((c: any) => c.name));
  for (const [m, p, b] of [["GET", `/api/agency/clients/${ocId}`], ["PATCH", `/api/agency/clients/${ocId}/status`, { status: "suspended" }], ["POST", `/api/agency/clients/${ocId}/open`], ["POST", `/api/agency/clients/${direct.id}/reset-password`], ["PUT", `/api/agency/clients/${direct.id}/limit`, { monthlyLimitUsd: 1 }]] as const) {
    const r = await call(m, p, OW, b);
    expect(r.status === 404, `other agency's / direct client not reachable: ${m} ${p.replace(/[0-9a-f-]{36}/, ":id")}`, r.status);
  }

  // ── 7. Opening a client's portal ────────────────────────────────────────
  const opened = await call("POST", `/api/agency/clients/${c1Id}/open`, OW);
  expect(opened.status === 200, "agency opens its client's portal");
  me = await call("GET", "/api/auth/me", OW);
  expect(me.json.role === "business_user" && me.json.businessAccount?.id === c1Id && me.json.agency?.viewingClient?.businessAccountId === c1Id, "me while viewing: acts as the client", { role: me.json.role, ba: me.json.businessAccount?.id, v: me.json.agency?.viewingClient });
  const ws = await call("GET", "/api/widget-settings", OW);
  expect(ws.status === 200 && ws.json.businessAccountId === c1Id, "business route answers for the open client", { s: ws.status, id: ws.json?.businessAccountId });
  const leads = await call("GET", "/api/leads?limit=5", OW);
  expect(leads.status === 200, "client's leads page works while viewing", leads.status);
  const saWhileViewing = await call("GET", `/api/business-accounts/${c1Id}`, OW);
  expect(saWhileViewing.status === 403, "super admin routes still refused while viewing", saWhileViewing.status);
  const crm = await call("POST", "/api/leadsquared/settings", OW, {});
  expect(crm.status === 403, "connected apps refused without the permission", crm.status);
  const stillAgency = await call("GET", "/api/agency/overview", OW);
  expect(stillAgency.status === 200, "agency routes still work while viewing (to go back)");
  await call("POST", "/api/agency/exit-client", OW);
  me = await call("GET", "/api/auth/me", OW);
  expect(me.json.role === "agency_admin" && me.json.agency.viewingClient === null, "back on the agency side", me.json.role);

  // A session pointing at another agency's client is ignored.
  const sess = OW.replace("session=", "");
  await db.update(schema.sessions).set({ activeBusinessAccountId: ocId }).where(eq(schema.sessions.sessionToken, sess));
  me = await call("GET", "/api/auth/me", OW);
  expect(me.json.role === "agency_admin" && !me.json.businessAccount, "stale session on another agency's client is ignored", { role: me.json.role, ba: me.json.businessAccount?.id });
  const wsStale = await call("GET", "/api/widget-settings", OW);
  expect(wsStale.status !== 200 || wsStale.json?.businessAccountId !== ocId, "…and its data is not served", wsStale.status);
  await db.update(schema.sessions).set({ activeBusinessAccountId: null }).where(eq(schema.sessions.sessionToken, sess));

  // Permission off → can't open.
  await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { permissions: { openClientPortal: false } });
  const noOpen = await call("POST", `/api/agency/clients/${c1Id}/open`, OW);
  expect(noOpen.status === 403, "open portal refused when the plan doesn't include it", noOpen.status);
  await db.update(schema.sessions).set({ activeBusinessAccountId: c1Id }).where(eq(schema.sessions.sessionToken, sess));
  me = await call("GET", "/api/auth/me", OW);
  expect(me.json.role === "agency_admin", "an already-open client closes when the permission is removed", me.json.role);
  await db.update(schema.sessions).set({ activeBusinessAccountId: null }).where(eq(schema.sessions.sessionToken, sess));
  await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { permissions: { openClientPortal: true, seeCosts: false } });
  const noCost = await call("GET", "/api/agency/clients", OW);
  expect(noCost.json.clients.every((c: any) => c.spentUsd === null && (c.limit === null || c.limit.monthlyLimitUsd === null)), "costs hidden when seeCosts is off", noCost.json.clients);
  await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { permissions: { seeCosts: true } });

  // ── 8. Agency AI cap ────────────────────────────────────────────────────
  const ev = (id: string, cost: number) => ({ businessAccountId: id, category: "chat", model: "gpt-4o-mini", costUsd: cost.toFixed(6) });
  await db.insert(schema.aiUsageEvents).values([ev(c2Id, 6), ev(ocId, 50), ev(direct.id, 50)] as any);
  await aiBudgetService.refresh();
  expect(!(await aiBudgetService.check(c2Id)).blocked, "under the cap: not blocked");
  await db.insert(schema.aiUsageEvents).values([ev(c1Id, 5)] as any); // total 11 ≥ 10 (and client 1's own 8 limit not reached)
  await aiBudgetService.refresh();
  const b1 = await aiBudgetService.check(c1Id);
  const b2 = await aiBudgetService.check(c2Id);
  expect(b1.blocked && b2.blocked, "agency cap reached: every client of the agency is blocked", { b1, b2 });
  expect(!(await aiBudgetService.check(ocId)).blocked && !(await aiBudgetService.check(direct.id)).blocked, "other agency and direct customer are not blocked");
  aiBudgetService.recordSpend(c2Id, 0.01);
  const status = await call("GET", "/api/usage/limit-status", clientLogin.cookie);
  expect(status.json.aiPaused === true && status.json.limit === null, "client sees AI paused, not the numbers", status.json);
  const [capRow] = await db.select().from(schema.agencies).where(eq(schema.agencies.id, agencyId));
  expect(capRow.aiCapLimitNotifiedMonth && capRow.aiCapWarnNotifiedMonth, "cap thresholds recorded once for the month", capRow);
  await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { aiCapAction: "warn" });
  expect(!(await aiBudgetService.check(c2Id)).blocked, "warn-only cap doesn't block");
  const ov = await call("GET", "/api/agency/overview", OW);
  expect(ov.json.agency.aiCap.percentUsed >= 110 && Math.abs(ov.json.spentUsd - 11) < 0.001, "overview: cap percentage and spend", ov.json.agency.aiCap);

  // ── 9. Statement ────────────────────────────────────────────────────────
  const st = await call("GET", "/api/agency/statement", OW);
  // 2 active × ₹1000; AI: c1 $5 = ₹420 → ₹320 over; c2 $6 = ₹504 → ₹404 over; ×1.2 = ₹868.8 (at the default rate 84).
  const rate = Number(process.env.USD_INR_RATE) || 84;
  const expectedAi = ((5 * rate - 100) + (6 * rate - 100)) * 1.2;
  expect(st.status === 200 && st.json.accountFees === 2000 && Math.abs(st.json.aiCharges - expectedAi) < 0.05, "agency statement adds up", { fees: st.json.accountFees, ai: st.json.aiCharges, expectedAi });
  const saSt = await call("GET", `/api/super-admin/agencies/${agencyId}/statement`, SA);
  expect(saSt.json.total === st.json.total, "super admin sees the same statement");

  // ── 10. Widget footer and lead source ──────────────────────────────────
  let pub = await call("GET", `/api/widget-settings/public?businessAccountId=${c1Id}`);
  expect(pub.json.poweredByText === "LeafBot" && pub.json.poweredByUrl === "https://brightleaf.test", "widget: footer shows the agency's brand", { t: pub.json.poweredByText, u: pub.json.poweredByUrl });
  const pubDirect = await call("GET", `/api/widget-settings/public?businessAccountId=${direct.id}`);
  expect(!pubDirect.json.poweredByText && pubDirect.json.poweredByEnabled === "true", "widget: direct customer unchanged", pubDirect.json.poweredByEnabled);
  const brand = await call("PUT", "/api/agency/branding", OW, { widgetFooter: "hidden" });
  expect(brand.status === 200, "agency changes its footer");
  pub = await call("GET", `/api/widget-settings/public?businessAccountId=${c1Id}`);
  expect(pub.json.poweredByEnabled === "false" && !pub.json.poweredByText, "widget: footer hidden", pub.json.poweredByEnabled);
  await storage.seedDefaultLeadsquaredFieldMappings(c2Id);
  const maps = await storage.getLeadsquaredFieldMappings(c2Id);
  expect(maps.find((m: any) => m.leadsquaredField === "Source")?.customValue === "LeafBot", "LeadSquared source: the agency's brand", maps.find((m: any) => m.leadsquaredField === "Source"));
  await storage.seedDefaultLeadsquaredFieldMappings(direct.id);
  expect((await storage.getLeadsquaredFieldMappings(direct.id)).find((m: any) => m.leadsquaredField === "Source")?.customValue === "AI Chroney", "LeadSquared source: direct customer unchanged");

  // ── 11. Team ────────────────────────────────────────────────────────────
  const staff = await call("POST", "/api/agency/team", OW, { username: `staff-${stamp}@agency.test` });
  expect(staff.status === 200, "owner adds a staff login");
  const ST = (await login(`staff-${stamp}@agency.test`, staff.json.credentials.tempPassword)).cookie;
  const staffAdd = await call("POST", "/api/agency/team", ST, { username: `x2-${stamp}@agency.test` });
  expect(staffAdd.status === 403, "staff can't add logins", staffAdd.status);
  const staffClients = await call("GET", "/api/agency/clients", ST);
  expect(staffClients.status === 200 && staffClients.json.clients.length === 2, "staff sees the agency's clients");
  const staffId = (await call("GET", "/api/agency/team", OW)).json.logins.find((l: any) => l.role === "staff").userId;
  expect((await call("DELETE", `/api/agency/team/${staffId}`, OW)).status === 200, "owner removes the staff login");
  expect((await call("GET", "/api/agency/clients", ST)).status === 401, "removed login's session ends");

  // ── 12. Pause and delete ───────────────────────────────────────────────
  const pauseClient = await call("PATCH", `/api/agency/clients/${c2Id}/status`, OW, { status: "suspended" });
  expect(pauseClient.status === 200, "agency pauses a client");
  await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { status: "suspended" });
  expect((await call("GET", "/api/agency/overview", OW)).status === 403, "paused agency: existing session refused");
  expect((await login(ownerEmail, created.json.credentials.tempPassword)).status === 403, "paused agency: login refused");
  expect((await login(`one-${stamp}@c.test`, c1.json.credentials.tempPassword)).status === 200, "paused agency: its clients still log in");
  const delBad = await call("DELETE", `/api/super-admin/agencies/${agencyId}`, SA, { confirmName: "wrong" });
  expect(delBad.status === 400, "delete needs the agency's name");
  const del = await call("DELETE", `/api/super-admin/agencies/${agencyId}`, SA, { confirmName: `BrightLeaf ${stamp}` });
  expect(del.status === 200, "agency deleted");
  const after = await db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, c1Id));
  const ownerLeft = await db.select().from(schema.users).where(eq(schema.users.username, ownerEmail));
  expect(after.length === 1 && after[0].agencyId === null && ownerLeft.length === 0, "clients stay as direct customers; agency logins removed", { after: after[0]?.agencyId, ownerLeft: ownerLeft.length });
  await aiBudgetService.refresh();
  expect(!(await aiBudgetService.check(c2Id)).blocked, "deleted agency's cap no longer applies");

  // Clean up the other agency too.
  await call("DELETE", `/api/super-admin/agencies/${otherId}`, SA, { confirmName: `Other ${stamp}` });
  void and;

  server.close();
  if (failed > 0) { console.error(`\n${failed} agency test(s) failed.`); process.exit(1); }
  console.log("\nAll agency tests passed.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
