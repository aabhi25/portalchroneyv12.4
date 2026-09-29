/**
 * Facebook / Instagram webhook routes — the REAL registerRoutes() app over HTTP, real SQL,
 * same raw-body capture as server/index.ts. Outbound network is blocked (fetch stubbed).
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55451/postgres?sslmode=disable \
 *   META_WEBHOOK_TEST_DB=1 npx tsx server/services/__tests__/metaWebhookRoutes.integration.test.ts
 */
import crypto from "crypto";
import express from "express";
import type { AddressInfo } from "net";

const url = process.env.DATABASE_URL || "";
if (process.env.META_WEBHOOK_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set META_WEBHOOK_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
for (const k of ["META_APP_SECRET", "FACEBOOK_APP_SECRET", "INSTAGRAM_APP_SECRET", "META_WEBHOOK_REQUIRE_SIGNATURE"]) delete process.env[k];

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

// Never reach real external services: only our own loopback server is allowed.
const realFetch = globalThis.fetch;
const blockedCalls: string[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const target = typeof input === "string" ? input : input?.url || String(input);
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) return realFetch(input, init);
  blockedCalls.push(target);
  throw new Error(`blocked outbound fetch in test: ${target}`);
}) as typeof fetch;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { encrypt } = await import("../encryptionService");
  const { computeMetaSignature } = await import("../metaWebhookSignature");
  const { registerRoutes } = await import("../../routes");

  const tag = crypto.randomBytes(4).toString("hex");
  const mkBiz = async (name: string, enabled: boolean) => {
    const [b] = await db.insert(schema.businessAccounts).values({
      name: `${name} ${tag}`, website: "https://example.com",
      facebookEnabled: enabled ? "true" : "false", instagramEnabled: enabled ? "true" : "false",
    } as any).returning();
    return b;
  };
  const bizSecure = await mkBiz("Meta Secure", true);
  const bizLegacy = await mkBiz("Meta Legacy", true);
  const bizOff = await mkBiz("Meta Disabled", false);

  const PAGE_SECURE = `P1${tag}`, PAGE_LEGACY = `P2${tag}`;
  const IG_SECURE = `I1${tag}`, IG_LEGACY = `I2${tag}`, IG_OFF = `I3${tag}`;
  const common = { autoReplyEnabled: "false", commentAutoReplyEnabled: "false", leadCaptureEnabled: "false" };
  await db.insert(schema.facebookSettings).values([
    { businessAccountId: bizSecure.id, pageId: PAGE_SECURE, appSecret: encrypt("fb-secret"), webhookVerifyToken: `vt-fb-${tag}`, ...common },
    { businessAccountId: bizLegacy.id, pageId: PAGE_LEGACY, appSecret: null, ...common },
  ] as any);
  await db.insert(schema.instagramSettings).values([
    { businessAccountId: bizSecure.id, igAccountId: IG_SECURE, appSecret: encrypt("ig-secret"), webhookVerifyToken: `vt-ig-${tag}`, ...common },
    { businessAccountId: bizLegacy.id, igAccountId: IG_LEGACY, appSecret: null, ...common },
    { businessAccountId: bizOff.id, igAccountId: IG_OFF, appSecret: null, ...common },
  ] as any);

  const app = express();
  app.use(express.json({ limit: "50mb", verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(express.urlencoded({ extended: false }));
  const server = await registerRoutes(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function post(path: string, payload: any, signWith?: string) {
    const raw = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (signWith) headers["x-hub-signature-256"] = computeMetaSignature(raw, signWith);
    const r = await fetch(base + path, { method: "POST", headers, body: raw });
    return { status: r.status, text: await r.text() };
  }
  const fbMessages = async (bizId: string) => (await db.select().from(schema.facebookMessages).where(eq(schema.facebookMessages.businessAccountId, bizId))).length;
  const igComments = async (bizId: string) => (await db.select().from(schema.instagramComments).where(eq(schema.instagramComments.businessAccountId, bizId))).length;
  const igMessages = async (bizId: string) => (await db.select().from(schema.instagramMessages).where(eq(schema.instagramMessages.businessAccountId, bizId))).length;
  async function waitFor(fn: () => Promise<number>, want: number) {
    for (let i = 0; i < 40; i++) { const v = await fn(); if (v >= want) return v; await sleep(100); }
    return fn();
  }
  const fbDm = (pageId: string, mid: string, text: string) => ({ object: "page", entry: [{ id: pageId, time: Date.now(), messaging: [{ sender: { id: "USER1" }, recipient: { id: pageId }, timestamp: Date.now(), message: { mid, text } }] }] });
  const igComment = (igId: string, cid: string, text: string) => ({ object: "instagram", entry: [{ id: igId, time: Date.now(), changes: [{ field: "comments", value: { id: cid, text, from: { id: "USER2", username: "someone" }, media: { id: "MEDIA1" } } }] }] });
  const igDm = (igId: string, mid: string, text: string) => ({ object: "instagram", entry: [{ id: igId, time: Date.now(), messaging: [{ sender: { id: "USER3" }, recipient: { id: igId }, message: { mid, text } }] }] });

  // ── Facebook DMs ──────────────────────────────────────────────────────────
  let r = await post("/api/facebook/webhook", fbDm(PAGE_SECURE, `mid-forged-${tag}`, "forged"), "attacker-secret");
  await sleep(300);
  expect(r.status === 403 && (await fbMessages(bizSecure.id)) === 0, "forged FB DM rejected (403) and nothing stored", r);
  r = await post("/api/facebook/webhook", fbDm(PAGE_SECURE, `mid-nosig-${tag}`, "unsigned"));
  await sleep(300);
  expect(r.status === 401 && (await fbMessages(bizSecure.id)) === 0, "unsigned FB DM rejected (401) when page has an App Secret", r);
  r = await post("/api/facebook/webhook", fbDm(PAGE_SECURE, `mid-ok-${tag}`, "hello"), "fb-secret");
  expect(r.status === 200 && (await waitFor(() => fbMessages(bizSecure.id), 1)) === 1, "validly signed FB DM accepted and stored", r);
  r = await post("/api/facebook/webhook", fbDm(PAGE_LEGACY, `mid-legacy-${tag}`, "hi"));
  expect(r.status === 200 && (await waitFor(() => fbMessages(bizLegacy.id), 1)) === 1, "FB page with no App Secret still processed (legacy behaviour)", r);

  // ── Instagram comments ────────────────────────────────────────────────────
  r = await post("/api/instagram/webhook", igComment(IG_SECURE, `c-forged-${tag}`, "forged"), "attacker-secret");
  await sleep(300);
  expect(r.status === 403 && (await igComments(bizSecure.id)) === 0, "forged IG comment rejected before processing", r);
  r = await post("/api/instagram/webhook", igComment(IG_SECURE, `c-ok-${tag}`, "nice"), "ig-secret");
  expect(r.status === 200 && (await waitFor(() => igComments(bizSecure.id), 1)) === 1, "validly signed IG comment accepted and processed", r);
  r = await post("/api/instagram/webhook", igComment(IG_LEGACY, `c-legacy-${tag}`, "hey"));
  expect(r.status === 200 && (await waitFor(() => igComments(bizLegacy.id), 1)) === 1, "IG account with no App Secret still processed (legacy behaviour)", r);
  r = await post("/api/instagram/webhook", igComment(IG_OFF, `c-off-${tag}`, "hey"));
  await sleep(500);
  expect(r.status === 200 && (await igComments(bizOff.id)) === 0, "comment for business with Instagram disabled is not processed", r);

  // ── Instagram DMs ─────────────────────────────────────────────────────────
  r = await post("/api/instagram/webhook", igDm(IG_SECURE, `igm-forged-${tag}`, "forged"), "attacker-secret");
  await sleep(300);
  expect(r.status === 403 && (await igMessages(bizSecure.id)) === 0, "forged IG DM rejected", r);
  r = await post("/api/instagram/webhook", igDm(IG_SECURE, `igm-ok-${tag}`, "hello"), "ig-secret");
  expect(r.status === 200 && (await waitFor(() => igMessages(bizSecure.id), 1)) === 1, "validly signed IG DM accepted", r);

  // ── Require-signature switch ──────────────────────────────────────────────
  process.env.META_WEBHOOK_REQUIRE_SIGNATURE = "true";
  r = await post("/api/facebook/webhook", fbDm(PAGE_LEGACY, `mid-legacy2-${tag}`, "hi again"));
  await sleep(300);
  expect(r.status === 403 && (await fbMessages(bizLegacy.id)) === 1, "META_WEBHOOK_REQUIRE_SIGNATURE=true rejects page without App Secret", r);
  delete process.env.META_WEBHOOK_REQUIRE_SIGNATURE;

  // ── GET verification challenge ────────────────────────────────────────────
  let g = await fetch(`${base}/api/facebook/webhook?hub.mode=subscribe&hub.verify_token=vt-fb-${tag}&hub.challenge=987`);
  expect(g.status === 200 && (await g.text()) === "987", "FB GET hub.challenge still works");
  g = await fetch(`${base}/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=vt-ig-${tag}&hub.challenge=654`);
  expect(g.status === 200 && (await g.text()) === "654", "IG GET hub.challenge still works");
  g = await fetch(`${base}/api/facebook/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
  expect(g.status === 403, "GET with wrong verify token still 403");

  await sleep(300);
  expect(blockedCalls.every((u) => /graph\.(facebook|instagram)\.com/.test(u)), "only Meta Graph calls were attempted (and blocked)", blockedCalls);
  server.close();
}

main().then(() => {
  if (failed > 0) { console.error(`\n${failed} meta webhook route test(s) failed.`); process.exit(1); }
  console.log("\nAll meta webhook route tests passed.");
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
