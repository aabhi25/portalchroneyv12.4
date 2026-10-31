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

  // ── 12. Own web address, logo and brand (phase 2) ──────────────────────
  {
    const brandSvc = await import("../agencyBrandService");
    const domain = `app.leaf-${stamp}.test`;
    const onHost = (h: string) => ({ "x-forwarded-host": h });
    async function hostCall(method: string, path: string, host: string, cookie?: string, body?: unknown) {
      const res = await fetch(base + path, {
        method,
        headers: { ...onHost(host), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let json: any = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
    }

    // DNS check rules, with a fake resolver.
    const target = brandSvc.domainTarget();
    const fake = (cname: string[], a: Record<string, string[]>) => ({ resolveCname: async () => cname, resolve4: async (h: string) => a[h] ?? [] }) as any;
    expect((await brandSvc.checkDomainDns("app.x.test", fake([`${target}.`], {}))).ok, "DNS: CNAME to our address counts");
    expect((await brandSvc.checkDomainDns("app.x.test", fake([], { [target]: ["1.2.3.4"], "app.x.test": ["1.2.3.4"] }))).ok, "DNS: same server address counts");
    const missing = await brandSvc.checkDomainDns("app.x.test", fake([], {}));
    expect(!missing.ok && /No DNS record/.test(missing.message), "DNS: nothing yet → tells them what to add", missing.message);
    const wrong = await brandSvc.checkDomainDns("app.x.test", fake(["elsewhere.example.com"], {}));
    expect(!wrong.ok && /not to/.test(wrong.message), "DNS: wrong target → says so", wrong.message);
    expect(shared.normalizeDomain("https://App.Leaf.test/login") === "app.leaf.test" && shared.normalizeDomain("not a domain") === null, "domain input cleaned up");

    // Settings: domain and logo. Agencies need the permission to set the address.
    await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { status: "active", branding: { brandName: "LeafBot", widgetFooter: "agency", primaryColor: "#0F766E", loginTagline: "Your AI desk", supportEmail: "help@leaf.test" } });
    const noPerm = await call("PUT", "/api/agency/domain", OW, { domain });
    expect(noPerm.status === 403, "agency can't set its address without the permission", noPerm.status);
    expect((await call("PUT", `/api/super-admin/agencies/${agencyId}/domain`, SA, { domain: "nope" })).status === 400, "invalid address refused");
    expect((await call("PUT", `/api/super-admin/agencies/${agencyId}/domain`, SA, { domain: "clients.aichroney.com" })).status === 400, "our own domain refused");
    const setD = await call("PUT", `/api/super-admin/agencies/${agencyId}/domain`, SA, { domain: `https://${domain.toUpperCase()}/` });
    expect(setD.status === 200 && setD.json.agency.domain.name === domain && setD.json.agency.domain.status === "pending", "address saved, waiting for DNS", setD.json?.agency?.domain);
    expect((await call("PUT", `/api/super-admin/agencies/${otherId}/domain`, SA, { domain })).status === 400, "another agency can't take the same address");
    expect((await call("PUT", `/api/super-admin/agencies/${agencyId}/logo`, SA, { logo: "data:text/html;base64,PGgxPg==" })).status === 400, "logo must be an image");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const setL = await call("PUT", `/api/super-admin/agencies/${agencyId}/logo`, SA, { logo: png });
    expect(setL.status === 200 && setL.json.agency.logoUrl?.startsWith(`/api/brand/logo/${agencyId}`), "logo saved", setL.json?.agency?.logoUrl);
    const logoRes = await fetch(base + setL.json.agency.logoUrl);
    expect(logoRes.status === 200 && logoRes.headers.get("content-type") === "image/png" && /default-src 'none'/.test(logoRes.headers.get("content-security-policy") || ""), "logo served as an image, scripts blocked");

    // Brand by address.
    const plain = await call("GET", "/api/brand");
    expect(plain.json.isAgency === false && plain.json.name === "AI Chroney", "our address: our brand");
    const onAgency = await hostCall("GET", "/api/brand", domain);
    expect(onAgency.json.isAgency && onAgency.json.name === "LeafBot" && onAgency.json.primaryColor === "#0f766e" && onAgency.json.tagline === "Your AI desk" && onAgency.json.logoUrl.startsWith("/api/brand/logo/"), "agency address: agency brand", onAgency.json);
    expect((await fetch(`${base}/api/domains/tls-check?domain=${domain}`)).status === 200 && (await fetch(`${base}/api/domains/tls-check?domain=evil.test`)).status === 404, "certificate check: only agency addresses");
    const html = brandSvc.brandHtml('<head><title>Hi Chroney - AI Assistant</title><meta name="description" content="Chat with Hi Chroney" /><link rel="icon" href="/favicon.ico" /></head>', onAgency.json);
    expect(html.includes("<title>LeafBot</title>") && !html.includes("Chroney") && html.includes('rel="icon" href="/api/brand/logo/'), "page title and icon are the agency's", html);
    expect(brandSvc.brandHtml("<title>Hi Chroney</title>", shared.PLATFORM_BRAND) === "<title>Hi Chroney</title>", "our pages unchanged");

    // Logins on the agency's address: only its people (and super admins).
    const ocLoginElsewhere = await hostCall("POST", "/api/auth/login", domain, undefined, { username: `oc-${stamp}@c.test`, password: oc.json.credentials.tempPassword });
    expect(ocLoginElsewhere.status === 401, "another agency's client can't log in on this address", ocLoginElsewhere.status);
    const c1OnDomain = await hostCall("POST", "/api/auth/login", domain, undefined, { username: `one-${stamp}@c.test`, password: c1.json.credentials.tempPassword });
    expect(c1OnDomain.status === 200, "own client logs in on the agency address", c1OnDomain.status);
    const directUser = `direct-${stamp}@c.test`;
    await db.insert(schema.users).values({ username: directUser, passwordHash: await hashPassword("Direct-pass-1"), role: "business_user", businessAccountId: direct.id } as any);
    expect((await hostCall("POST", "/api/auth/login", domain, undefined, { username: directUser, password: "Direct-pass-1" })).status === 401, "our direct customer can't log in on an agency address");
    expect((await login(directUser, "Direct-pass-1")).status === 200, "…but still logs in on ours");

    // Client brand after login (anywhere), widget defaults, public link.
    const c1Me = await call("GET", "/api/auth/me", clientLogin.cookie);
    expect(c1Me.json.brand?.isAgency && c1Me.json.brand.name === "LeafBot" && c1Me.json.brand.domain === null, "client sees the agency brand (address not connected yet)", c1Me.json.brand);
    const directMe = await call("GET", "/api/auth/me", (await login(directUser, "Direct-pass-1")).cookie);
    expect(directMe.json.brand?.isAgency === false, "direct customer: our brand");
    await db.update(schema.agencies).set({ domainStatus: "verified", domainVerifiedAt: new Date() }).where(eq(schema.agencies.id, agencyId));
    brandSvc.clearAgencyHostCache();
    const c1Me2 = await call("GET", "/api/auth/me", clientLogin.cookie);
    expect(c1Me2.json.brand.domain === domain, "connected address reaches the client's portal (install codes)", c1Me2.json.brand.domain);
    const link = await call("GET", "/api/public-chat-link", clientLogin.cookie);
    expect(link.status === 200 && link.json.url.startsWith(`https://${domain}/public-chat/`), "public chat link uses the agency address", link.json?.url);
    pub = await call("GET", `/api/widget-settings/public?businessAccountId=${c1Id}`);
    expect(pub.json.widgetHeaderText === `Client One ${stamp}` && pub.json.defaultAvatarUrl?.startsWith("/api/brand/logo/"), "widget: business name as header, agency logo as picture", { h: pub.json.widgetHeaderText, a: pub.json.defaultAvatarUrl });
    await call("PUT", `/api/super-admin/agencies/${agencyId}/logo`, SA, { logo: null });
    pub = await call("GET", `/api/widget-settings/public?businessAccountId=${c1Id}`);
    expect(pub.json.defaultAvatarUrl === null, "widget: no agency logo → plain icon, never ours", pub.json.defaultAvatarUrl);
    const pubDirect2 = await call("GET", `/api/widget-settings/public?businessAccountId=${direct.id}`);
    expect(pubDirect2.json.widgetHeaderText === "Hi Chroney" && pubDirect2.json.defaultAvatarUrl === undefined, "widget: direct customer unchanged");

    // "Only at its own address": our address refuses them with a pointer.
    await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { branding: { brandName: "LeafBot", widgetFooter: "agency", clientLoginScope: "agency_domain" } });
    const refused = await login(`one-${stamp}@c.test`, c1.json.credentials.tempPassword);
    expect(refused.status === 403 && refused.json.error === `Please log in at https://${domain}`, "own-address-only: our address points them to theirs", refused.json);
    expect((await hostCall("POST", "/api/auth/login", domain, undefined, { username: `one-${stamp}@c.test`, password: c1.json.credentials.tempPassword })).status === 200, "own-address-only: their address works");
    expect((await login(`two-${stamp}@c.test`, c2.json.credentials.tempPassword)).status === 403, "own-address-only: applies to every client");
    await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { branding: { brandName: "LeafBot", widgetFooter: "agency", clientLoginScope: "anywhere" } });

    // Agency with the permission sets its own address.
    await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { permissions: { setCustomDomain: true } });
    const own = await call("PUT", "/api/agency/domain", OW, { domain: `portal.leaf-${stamp}.test` });
    expect(own.status === 200 && own.json.domain.name === `portal.leaf-${stamp}.test` && own.json.domain.status === "pending", "agency with the permission sets its address", own.json);
    expect((await hostCall("GET", "/api/brand", domain)).json.isAgency === false, "old address no longer branded");
  }

  // ── 13. Packages, client logins, prepaid credits, branded email (phase 3) ──
  {
    const http = await import("http");
    const directUser = `direct-${stamp}@c.test`; // created in section 12
    // Fake email service: records requests; can be told to refuse.
    const mails: { path: string; auth: string; body: any }[] = [];
    let refuse = false;
    const fake = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        mails.push({ path: req.url || "", auth: String(req.headers.authorization || req.headers["api-key"] || ""), body: raw ? JSON.parse(raw) : null });
        res.writeHead(refuse ? 401 : 200, { "content-type": "application/json" });
        res.end(refuse ? '{"message":"bad key"}' : '{"id":"m1"}');
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
    process.env.EMAIL_PROVIDER_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

    // Pure: statement with credits, credit usage, email view.
    const billing = shared.resolveAgencyBilling({ model: "per_account", currency: "INR", pricePerAccount: 1000, includedAiPerAccount: 100, aiMarkupPercent: 20 });
    const stc = shared.computeAgencyStatement({ month: "2026-10", billing, usdToInr: 84, creditsEnabled: true, accounts: [{ businessAccountId: "a", name: "A", status: "active", aiCostUsd: 2 }] });
    expect(stc.aiCharges === 0 && Math.abs(stc.aiFromCredits - 168 * 1.2) < 0.01 && stc.total === 1000, "statement with credits: AI paid from credits, not billed", stc);
    expect(Math.abs(shared.creditUsage(1, billing, 84) - 100.8) < 1e-9, "credit usage: converted plus markup");
    expect(shared.agencyEmailView({ provider: "resend", apiKeyEnc: "x", fromEmail: "a@b.co" }).ready && !shared.agencyEmailView({ provider: "resend", fromEmail: "a@b.co" }).ready, "email ready only with provider, key and sender");

    await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { maxAccounts: 6, maxLoginsPerClient: 3, permissions: { managePackages: true, manageClientLogins: true } });

    // Packages.
    expect((await call("POST", "/api/agency/packages", OW, { name: "Bad", features: ["instagramEnabled"] })).status === 400, "package with a feature outside the plan refused");
    expect((await call("POST", "/api/agency/packages", OW, { name: "Big", features: ["chroneyEnabled"], monthlyLimitUsd: 500 })).status === 400, "package AI limit above the agency cap refused");
    expect((await call("POST", "/api/agency/packages", OW, { name: "Many", features: [], maxLogins: 9 })).status === 400, "package logins above the plan refused");
    const starter = await call("POST", "/api/agency/packages", OW, { name: "Starter", features: ["chroneyEnabled"], monthlyLimitUsd: 3, maxLogins: 2, price: 1999 });
    expect(starter.status === 200, "package created", starter.json);
    const pkgId: string = starter.json.package.id;
    const pc = await call("POST", "/api/agency/clients", OW, { name: `Pkg Client ${stamp}`, website: "https://pkg.test", username: `pkg-${stamp}@c.test`, features: ["whatsappEnabled"], packageId: pkgId });
    expect(pc.status === 200, "client created on a package", pc.json);
    const pcId: string = pc.json.client.id;
    let [pcRow] = await db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, pcId));
    let [pcLim] = await db.select().from(schema.aiUsageLimits).where(eq(schema.aiUsageLimits.businessAccountId, pcId));
    expect(pcRow.agencyPackageId === pkgId && pcRow.chroneyEnabled === "true" && pcRow.whatsappEnabled === "false" && Number(pcLim?.monthlyLimitUsd) === 3, "package sets features and AI limit (overrides the form)", { pkg: pcRow.agencyPackageId, wa: pcRow.whatsappEnabled, lim: pcLim?.monthlyLimitUsd });
    const edit = await call("PUT", `/api/agency/packages/${pkgId}`, OW, { name: "Starter", features: ["chroneyEnabled", "whatsappEnabled"], monthlyLimitUsd: 4, maxLogins: 2, applyToClients: true });
    expect(edit.status === 200 && edit.json.updatedClients === 1, "package edit updates its clients", edit.json);
    [pcRow] = await db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, pcId));
    [pcLim] = await db.select().from(schema.aiUsageLimits).where(eq(schema.aiUsageLimits.businessAccountId, pcId));
    expect(pcRow.whatsappEnabled === "true" && Number(pcLim.monthlyLimitUsd) === 4, "client now has the package's new features and limit");
    const list = await call("GET", "/api/agency/packages", OW);
    expect(list.json.packages.find((p: any) => p.id === pkgId)?.clients === 1, "package shows its client count");
    expect((await call("PUT", `/api/agency/clients/${c1Id}/package`, OW, { packageId: pkgId })).status === 200, "package applied to an existing client");
    const [c1p] = await db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, c1Id));
    expect(c1p.agencyPackageId === pkgId && c1p.whatsappEnabled === "true", "existing client follows the package");
    expect((await call("GET", "/api/agency/packages", OW2)).json.packages.length === 0, "another agency doesn't see these packages");
    expect((await call("PUT", `/api/agency/clients/${c1Id}/package`, OW2, { packageId: pkgId })).status === 404, "another agency can't apply them");

    // Client logins: package allows 2 (main included).
    const l1 = await call("POST", `/api/agency/clients/${pcId}/logins`, OW, { username: `pkg2-${stamp}@c.test` });
    expect(l1.status === 200 && l1.json.credentials.tempPassword, "extra login added", l1.json);
    const l2 = await call("POST", `/api/agency/clients/${pcId}/logins`, OW, { username: `pkg3-${stamp}@c.test` });
    expect(l2.status === 403, "login limit from the package enforced", l2.json);
    const logins = (await call("GET", `/api/agency/clients/${pcId}/logins`, OW)).json;
    const main = logins.logins.find((l: any) => l.isMain);
    const member = logins.logins.find((l: any) => !l.isMain);
    expect(logins.logins.length === 2 && main.username === `pkg-${stamp}@c.test` && logins.max === 2, "logins listed, main login marked", logins);
    expect((await call("DELETE", `/api/agency/clients/${pcId}/logins/${main.userId}`, OW)).status === 400, "main login can't be removed");
    const memberLogin = await login(`pkg2-${stamp}@c.test`, l1.json.credentials.tempPassword);
    const memberMe = await call("GET", "/api/auth/me", memberLogin.cookie);
    expect(memberLogin.status === 200 && memberMe.json.businessAccount?.id === pcId && memberMe.json.accountRole === "member", "extra login opens the same account", { s: memberLogin.status, a: memberMe.json.businessAccount?.id });
    expect((await storage.getUserByBusinessAccountId(pcId))?.username === `pkg-${stamp}@c.test`, "the account's main login stays the main one");
    const reset2 = await call("POST", `/api/agency/clients/${pcId}/reset-password`, OW);
    expect(reset2.json.username === `pkg-${stamp}@c.test`, "client password reset targets the main login");

    // Clients managing their own logins (off by default).
    const mainLogin = await login(`pkg-${stamp}@c.test`, reset2.json.tempPassword);
    expect((await call("GET", "/api/account/logins", mainLogin.cookie)).status === 403, "self-service logins off by default");
    expect((await call("GET", "/api/auth/me", mainLogin.cookie)).json.canManageAccountLogins === false, "me: can't manage logins yet");
    await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { permissions: { clientsManageLogins: true } });
    const self = await call("GET", "/api/account/logins", mainLogin.cookie);
    expect(self.status === 200 && self.json.logins.length === 2, "client's main login sees its logins", self.status);
    expect((await call("GET", "/api/auth/me", mainLogin.cookie)).json.canManageAccountLogins === true, "me: main login can manage logins");
    expect((await call("GET", "/api/account/logins", memberLogin.cookie)).status === 403, "an extra login can't manage logins");
    expect((await call("GET", "/api/account/logins", (await login(directUser, "Direct-pass-1")).cookie)).status === 403, "direct customers can't use it");
    expect((await call("POST", "/api/account/logins", mainLogin.cookie, { username: `pkg4-${stamp}@c.test` })).status === 403, "self-service respects the login limit");
    expect((await call("DELETE", `/api/account/logins/${member.userId}`, mainLogin.cookie)).status === 200, "client removes its colleague");
    expect((await call("POST", "/api/account/logins", mainLogin.cookie, { username: `pkg4-${stamp}@c.test` })).status === 200, "…and adds another");

    // Prepaid credits.
    await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { creditsEnabled: true, creditLowThreshold: 200 });
    let cr = await call("GET", `/api/super-admin/agencies/${agencyId}/credits`, SA);
    expect(cr.json.enabled && cr.json.balance === 0 && cr.json.startedAt, "credits on, starting at zero", cr.json);
    expect((await aiBudgetService.check(c2Id)).blocked, "no credits → clients' AI paused");
    expect((await call("POST", `/api/super-admin/agencies/${agencyId}/credits`, SA, { amount: 0 })).status === 400, "zero top-up refused");
    cr = await call("POST", `/api/super-admin/agencies/${agencyId}/credits`, SA, { amount: 1000, note: "Payment 1" });
    expect(cr.json.balance === 1000 && cr.json.entries.length === 1, "top-up added", cr.json);
    expect(!(await aiBudgetService.check(c2Id)).blocked, "with credits → AI runs");
    await db.insert(schema.aiUsageEvents).values([{ businessAccountId: pcId, category: "chat", model: "gpt-4o-mini", costUsd: "5.000000" }] as any);
    aiBudgetService.recordSpend(pcId, 5);
    const rate = Number(process.env.USD_INR_RATE) || 84;
    cr = await call("GET", "/api/agency/credits", OW);
    expect(Math.abs(cr.json.used - 5 * rate * 1.2) < 0.02 && Math.abs(cr.json.balance - (1000 - 5 * rate * 1.2)) < 0.02, "AI use taken from credits with the markup", cr.json);
    expect(cr.json.low === false, "not low yet");
    await db.insert(schema.aiUsageEvents).values([{ businessAccountId: c1Id, category: "chat", model: "gpt-4o-mini", costUsd: "8.000000" }] as any);
    await aiBudgetService.refresh();
    expect((await aiBudgetService.check(c2Id)).blocked && (await aiBudgetService.check(pcId)).blocked, "credits used up → every client paused");
    expect(!(await aiBudgetService.check(ocId)).blocked && !(await aiBudgetService.check(direct.id)).blocked, "other agency and direct customer unaffected");
    const ovCredits = await call("GET", "/api/agency/overview", OW);
    expect(ovCredits.json.credits.balance < 0 && ovCredits.json.credits.low, "agency sees the balance and the warning", ovCredits.json.credits);
    const stCred = await call("GET", "/api/agency/statement", OW);
    expect(stCred.json.aiCharges === 0 && stCred.json.aiFromCredits > 0, "statement: AI paid from credits", { c: stCred.json.aiCharges, f: stCred.json.aiFromCredits });
    expect((await call("POST", `/api/super-admin/agencies/${agencyId}/credits`, OW, { amount: 99999 })).status === 403, "agencies can't top themselves up");
    await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { creditsEnabled: false });
    expect(!(await aiBudgetService.check(c2Id)).blocked, "credits off → AI back to normal billing");

    // Branded email.
    const before = await call("GET", "/api/agency/email", OW);
    expect(!before.json.ready, "email not set up at first");
    expect((await call("PUT", "/api/agency/email", OW, { provider: "resend", fromEmail: "not-an-email" })).status === 400, "bad sender refused");
    const saved = await call("PUT", "/api/agency/email", OW, { provider: "resend", apiKey: "re_test_secret_1234", fromEmail: "hello@leaf.test", fromName: "LeafBot", replyTo: "help@leaf.test" });
    expect(saved.status === 200 && saved.json.ready && saved.json.hasKey && saved.json.apiKeyLast4 === "1234", "email settings saved", saved.json);
    expect(!JSON.stringify(saved.json).includes("re_test_secret") && !JSON.stringify((await call("GET", `/api/super-admin/agencies/${agencyId}`, SA)).json).includes("re_test_secret"), "the API key never comes back");
    const [stored] = await db.select().from(schema.agencies).where(eq(schema.agencies.id, agencyId));
    expect(!JSON.stringify(stored.emailSettings).includes("re_test_secret"), "the API key is stored encrypted");
    const t = await call("POST", "/api/agency/email/test", OW, { to: "owner@leaf.test" });
    const tm = mails.at(-1)!;
    expect(t.json.ok && tm.path === "/emails" && tm.auth === "Bearer re_test_secret_1234" && tm.body.from === "LeafBot <hello@leaf.test>" && tm.body.reply_to === "help@leaf.test", "test email sent through Resend", { ok: t.json, tm });
    const ec = await call("POST", "/api/agency/clients", OW, { name: `Mail Client ${stamp}`, website: "https://mail.test", username: `mail-${stamp}@c.test`, features: [], sendEmail: true });
    const wm = mails.at(-1)!;
    expect(ec.json.email?.ok && wm.body.to[0] === `mail-${stamp}@c.test` && wm.body.text.includes(ec.json.credentials.tempPassword) && !wm.body.text.includes("Chroney"), "login details emailed in the agency's name", { e: ec.json.email, subj: wm.body.subject });
    const n0 = mails.length;
    await call("POST", "/api/auth/forgot-password", undefined, { email: `mail-${stamp}@c.test` });
    const rm = mails.at(-1)!;
    expect(mails.length === n0 + 1 && /\/reset-password\?token=/.test(rm.body.text) && rm.body.subject.includes("LeafBot"), "password reset emailed in the agency's name", rm.body.subject);
    const n1 = mails.length;
    await call("POST", "/api/auth/forgot-password", undefined, { email: directUser });
    expect(mails.length === n1, "direct customers: no email (unchanged)");
    await call("PUT", `/api/super-admin/agencies/${agencyId}/email`, SA, { provider: "sendgrid" });
    await call("POST", "/api/agency/email/test", OW, { to: "owner@leaf.test" });
    expect(mails.at(-1)!.path === "/v3/mail/send" && mails.at(-1)!.body.from.email === "hello@leaf.test", "SendGrid format");
    await call("PUT", `/api/super-admin/agencies/${agencyId}/email`, SA, { provider: "brevo" });
    await call("POST", "/api/agency/email/test", OW, { to: "owner@leaf.test" });
    expect(mails.at(-1)!.path === "/v3/smtp/email" && mails.at(-1)!.auth === "re_test_secret_1234", "Brevo format");
    refuse = true;
    const bad = await call("POST", "/api/agency/email/test", OW, { to: "owner@leaf.test" });
    expect(bad.json.ok === false && /refused/.test(bad.json.error), "a refusal is reported in plain words", bad.json);
    refuse = false;
    await call("PATCH", `/api/super-admin/agencies/${agencyId}`, SA, { permissions: { editEmail: false } });
    expect((await call("PUT", "/api/agency/email", OW, { fromName: "X" })).status === 403, "email settings follow the permission");

    // Package deleted: clients keep their settings.
    expect((await call("DELETE", `/api/agency/packages/${pkgId}`, OW)).status === 200, "package deleted");
    [pcRow] = await db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, pcId));
    expect(pcRow.agencyPackageId === null && pcRow.whatsappEnabled === "true", "client keeps its features after the package is deleted");
    fake.close();
    delete process.env.EMAIL_PROVIDER_BASE_URL;
  }

  // ── 14. Pause and delete ───────────────────────────────────────────────
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
