/**
 * Meta (Facebook / Instagram) webhook signature verification — pure verifier + the Express guard
 * mounted on a tiny app with the same raw-body capture as server/index.ts. No DB, no network.
 * Run: `npx tsx server/services/__tests__/metaWebhookSignature.test.ts`
 */
import crypto from "crypto";
import http from "http";
import express from "express";
import type { AddressInfo } from "net";

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
delete process.env.META_APP_SECRET;
delete process.env.FACEBOOK_APP_SECRET;
delete process.env.INSTAGRAM_APP_SECRET;
delete process.env.META_WEBHOOK_REQUIRE_SIGNATURE;

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

async function main() {
  const m = await import("../metaWebhookSignature");
  const { encrypt } = await import("../encryptionService");

  // ── Verifier ───────────────────────────────────────────────────────────────
  const secret = "app-secret-123";
  const body = Buffer.from(JSON.stringify({ object: "page", entry: [{ id: "PAGE1" }] }));
  const sig = m.computeMetaSignature(body, secret);
  expect(/^sha256=[0-9a-f]{64}$/.test(sig), "signature has sha256=<hex> format");
  expect(m.verifyMetaSignature(body, sig, [secret]).valid, "valid signature accepted");
  expect(m.verifyMetaSignature(body, sig.toUpperCase().replace("SHA256=", "sha256="), [secret]).valid, "hex case-insensitive");
  const tampered = Buffer.from(body.toString().replace("PAGE1", "PAGE2"));
  expect(m.verifyMetaSignature(tampered, sig, [secret]).reason === "mismatch", "tampered body rejected");
  expect(m.verifyMetaSignature(body, sig, ["wrong"]).reason === "mismatch", "wrong secret rejected");
  expect(m.verifyMetaSignature(body, undefined, [secret]).reason === "missing_header", "missing header rejected");
  expect(m.verifyMetaSignature(body, "", [secret]).reason === "missing_header", "empty header rejected");
  expect(m.verifyMetaSignature(body, "sha1=abc", [secret]).reason === "malformed_header", "sha1/other scheme rejected");
  expect(m.verifyMetaSignature(body, "sha256=abcd", [secret]).reason === "malformed_header", "short digest rejected without throwing");
  expect(m.verifyMetaSignature(body, sig, []).reason === "no_secret", "no secret → no_secret");
  expect(m.verifyMetaSignature(undefined, sig, [secret]).reason === "no_raw_body", "no raw body → cannot verify");
  const multi = m.verifyMetaSignature(body, sig, ["other-1", null, secret, "other-2"]);
  expect(multi.valid && multi.matchedIndex === 2, "multiple candidate secrets: second real one matches", multi);
  expect(m.verifyMetaSignature(body.toString(), sig, [secret]).valid, "string raw body works too");

  // ── Stored secret resolution ──────────────────────────────────────────────
  expect(m.resolveStoredAppSecret(encrypt(secret)) === secret, "encrypted stored secret decrypted");
  expect(m.resolveStoredAppSecret("legacy-plain-secret") === "legacy-plain-secret", "legacy plaintext secret used as-is");
  expect(m.resolveStoredAppSecret("aa:bb:cc") === null, "undecryptable ciphertext is not used verbatim");
  expect(m.resolveStoredAppSecret(null) === null && m.resolveStoredAppSecret("  ") === null, "empty → null");
  expect(m.verifyMetaSignature(body, sig, [m.resolveStoredAppSecret(encrypt(secret))]).valid, "encrypted stored secret verifies signature");

  // ── Platform env secrets / flags ──────────────────────────────────────────
  process.env.META_APP_SECRET = "p1, p2";
  process.env.INSTAGRAM_APP_SECRET = "ig1";
  expect(JSON.stringify(m.getPlatformMetaAppSecrets("facebook")) === JSON.stringify(["p1", "p2"]), "facebook platform secrets", m.getPlatformMetaAppSecrets("facebook"));
  expect(JSON.stringify(m.getPlatformMetaAppSecrets("instagram")) === JSON.stringify(["p1", "p2", "ig1"]), "instagram platform secrets");
  delete process.env.META_APP_SECRET; delete process.env.INSTAGRAM_APP_SECRET;
  expect(!m.isMetaSignatureRequired(), "require-signature off by default");

  // ── timing-safe string compare (MSG91) ────────────────────────────────────
  expect(m.timingSafeEqualStrings("abc", "abc"), "equal strings");
  expect(!m.timingSafeEqualStrings("abc", "abd") && !m.timingSafeEqualStrings("abc", "abcd"), "different / different-length strings");
  expect(!m.timingSafeEqualStrings(undefined, "abc") && !m.timingSafeEqualStrings("abc", null), "missing values never equal");

  // ── Guard over HTTP ───────────────────────────────────────────────────────
  // Accounts as they would come back from facebook_settings / instagram_settings.
  const accounts: Record<string, { businessAccountId: string; appSecret: string | null }> = {
    PAGE_SECURE: { businessAccountId: "biz-fb-secure", appSecret: encrypt("fb-secret") },
    PAGE_LEGACY: { businessAccountId: "biz-fb-legacy", appSecret: null },
    IG_SECURE: { businessAccountId: "biz-ig-secure", appSecret: encrypt("ig-secret") },
    IG_LEGACY: { businessAccountId: "biz-ig-legacy", appSecret: null },
  };
  const warnings: string[] = [];
  const logger = { warn: (msg: string) => warnings.push(msg), error: (..._a: any[]) => {} };
  const processed: Array<{ platform: string; body: any; verified: boolean }> = [];
  let requireSig = false;

  const app = express();
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  for (const [platform, object] of [["facebook", "page"], ["instagram", "instagram"]] as const) {
    const guard = m.createMetaWebhookSignatureGuard({
      platform, expectedObject: object, logger,
      lookupAccount: async (id) => accounts[id] || null,
      getPlatformSecrets: () => [],
      requireSignature: () => requireSig,
    });
    app.get(`/api/${platform}/webhook`, (req, res) => {
      if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === "vt") return res.status(200).send(req.query["hub.challenge"]);
      return res.sendStatus(403);
    });
    app.post(`/api/${platform}/webhook`, guard, (req, res) => {
      res.status(200).send("EVENT_RECEIVED");
      processed.push({ platform, body: req.body, verified: res.locals.metaWebhook?.verified });
    });
  }
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function post(path: string, payload: any, signWith?: string, headerOverride?: string) {
    const raw = JSON.stringify(payload);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (headerOverride !== undefined) headers["x-hub-signature-256"] = headerOverride;
    else if (signWith) headers["x-hub-signature-256"] = m.computeMetaSignature(raw, signWith);
    const r = await fetch(base + path, { method: "POST", headers, body: raw });
    return { status: r.status, text: await r.text() };
  }
  const fbDm = (pageId: string, text: string) => ({ object: "page", entry: [{ id: pageId, messaging: [{ sender: { id: "U1" }, recipient: { id: pageId }, message: { mid: "m1", text } }] }] });
  const igComment = (igId: string, text: string) => ({ object: "instagram", entry: [{ id: igId, changes: [{ field: "comments", value: { id: "c1", text, from: { id: "U2" }, media: { id: "P1" } } }] }] });

  let n = processed.length;
  let r = await post("/api/facebook/webhook", fbDm("PAGE_SECURE", "forged"), "attacker-guess");
  expect(r.status === 403 && processed.length === n, "forged FB DM (wrong secret) rejected with 403, not processed", r);
  r = await post("/api/facebook/webhook", fbDm("PAGE_SECURE", "forged"));
  expect(r.status === 401 && processed.length === n, "FB DM without signature rejected with 401 when secret set", r);
  r = await post("/api/facebook/webhook", fbDm("PAGE_SECURE", "hello"), "fb-secret");
  expect(r.status === 200 && processed.length === n + 1 && processed[n].verified === true, "validly signed FB DM accepted", r);

  n = processed.length;
  r = await post("/api/instagram/webhook", igComment("IG_SECURE", "forged comment"), "nope");
  expect(r.status === 403 && processed.length === n, "forged IG comment rejected before processing", r);
  r = await post("/api/instagram/webhook", igComment("IG_SECURE", "forged comment"));
  expect(r.status === 401 && processed.length === n, "unsigned IG comment rejected when secret set", r);
  r = await post("/api/instagram/webhook", igComment("IG_SECURE", "nice post"), "ig-secret");
  expect(r.status === 200 && processed.length === n + 1 && processed[n].verified, "validly signed IG comment accepted", r);
  r = await post("/api/instagram/webhook", igComment("IG_SECURE", "nice post"), "fb-secret");
  expect(r.status === 403, "IG event signed with another account's secret rejected", r);

  // Forged payload that claims a secured account plus a legacy one is still rejected.
  n = processed.length;
  const mixed = { object: "page", entry: [fbDm("PAGE_LEGACY", "x").entry[0], fbDm("PAGE_SECURE", "x").entry[0]] };
  r = await post("/api/facebook/webhook", mixed, "attacker");
  expect(r.status === 403 && processed.length === n, "batch touching a secured page must be signed", r);

  // Legacy account without secret keeps working, with a (rate-limited) warning.
  warnings.length = 0;
  n = processed.length;
  r = await post("/api/facebook/webhook", fbDm("PAGE_LEGACY", "hi"));
  const r2 = await post("/api/facebook/webhook", fbDm("PAGE_LEGACY", "hi again"));
  expect(r.status === 200 && r2.status === 200 && processed.length === n + 2 && processed[n].verified === false, "no-secret FB page still processed", { r, r2 });
  const unsignedWarnings = warnings.filter((w) => w.includes("UNVERIFIED") && w.includes("PAGE_LEGACY") && w.includes("biz-fb-legacy"));
  expect(unsignedWarnings.length === 1, "warning logged once (rate-limited) with page + business id", warnings);
  r = await post("/api/instagram/webhook", igComment("IG_LEGACY", "hey"));
  expect(r.status === 200 && processed.length === n + 3, "no-secret IG account still processed", r);

  const status = m.describeMetaWebhookSignature("facebook", "biz-fb-legacy", null);
  expect(status.needsAppSecret === true && status.webhookSignatureVerified === false, "settings flags: legacy page needs app secret", status);
  await new Promise((res) => setTimeout(res, 5));
  await post("/api/facebook/webhook", fbDm("PAGE_SECURE", "fresh valid event"), "fb-secret");
  const okStatus = m.describeMetaWebhookSignature("facebook", "biz-fb-secure", accounts.PAGE_SECURE.appSecret);
  expect(okStatus.needsAppSecret === false && okStatus.webhookSignatureVerified === true, "settings flags: secured page verified (a later valid event clears an earlier failure)", okStatus);
  await new Promise((res) => setTimeout(res, 5));

  // A secured account whose recent webhooks failed is flagged for the UI.
  await post("/api/facebook/webhook", fbDm("PAGE_SECURE", "bad"), "wrong");
  const failing = m.describeMetaWebhookSignature("facebook", "biz-fb-secure", accounts.PAGE_SECURE.appSecret);
  expect(failing.webhookSignature.failingRecently === true && failing.webhookSignatureVerified === false, "recent signature failures surfaced", failing);

  // META_WEBHOOK_REQUIRE_SIGNATURE=true → missing secret becomes a hard reject.
  requireSig = true;
  n = processed.length;
  r = await post("/api/facebook/webhook", fbDm("PAGE_LEGACY", "hi"));
  expect(r.status === 403 && processed.length === n, "require-signature mode rejects page without secret", r);
  r = await post("/api/facebook/webhook", fbDm("PAGE_SECURE", "hello"), "fb-secret");
  expect(r.status === 200 && processed.length === n + 1, "require-signature mode still accepts valid signed events", r);
  requireSig = false;

  // Unknown page: nothing to verify against, handler ignores it (as before).
  r = await post("/api/facebook/webhook", fbDm("UNKNOWN", "x"));
  expect(r.status === 200, "unknown page passes through (handler finds no business)", r);

  // GET verification challenge unaffected.
  const g = await fetch(`${base}/api/facebook/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=12345`);
  expect(g.status === 200 && (await g.text()) === "12345", "GET hub.challenge still answered");

  server.close();
}

main().then(() => {
  if (failed > 0) { console.error(`\n${failed} meta webhook signature test(s) failed.`); process.exit(1); }
  console.log("\nAll meta webhook signature tests passed.");
}).catch((e) => { console.error(e); process.exit(1); });
