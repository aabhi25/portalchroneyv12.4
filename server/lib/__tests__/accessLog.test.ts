/**
 * Tests for request ids, the request context and the one-line access log.
 * Run manually: `npx tsx server/lib/__tests__/accessLog.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import express from "express";
import type { AddressInfo } from "net";
import { requestContextMiddleware, pickRequestId, formatAccessLine, defaultShouldLog } from "../accessLog";
import { getRequestContext, currentBusinessAccountId, currentRoute, setContextBusinessAccount } from "../requestContext";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function main() {
  // ── unit ────────────────────────────────────────────────────────────────
  expect(pickRequestId("abc-12345678") === "abc-12345678", "sane incoming id reused");
  expect(UUID_RE.test(pickRequestId("short")), "too-short incoming id replaced");
  expect(UUID_RE.test(pickRequestId("bad id\nwith newline")), "id with unsafe characters replaced");
  expect(UUID_RE.test(pickRequestId("x".repeat(200))), "overlong id replaced");
  expect(UUID_RE.test(pickRequestId(undefined)), "missing id generated");
  expect(defaultShouldLog("/api/x", 200, true) && defaultShouldLog("/health", 503, true) && !defaultShouldLog("/health", 200, true) && defaultShouldLog("/health", 200, false), "shouldLog: /api always, /health only failing in production");
  expect(!defaultShouldLog("/assets/app.js", 200, true) && defaultShouldLog("/whatever", 500, true), "static 200s skipped, any 5xx logged");
  {
    const line = formatAccessLine({ method: "GET", path: "/api/x", status: 200, ms: 12.3, requestId: "rid-1234567890" }, false);
    const o = JSON.parse(line);
    expect(o.type === "access" && o.method === "GET" && o.path === "/api/x" && o.status === 200 && o.ms === 12.3 && o.requestId === "rid-1234567890", "production line is one JSON object", o);
    const pretty = formatAccessLine({ method: "POST", path: "/api/y", status: 404, ms: 3.6, requestId: "abcdef0123456789", businessAccountId: "biz-9" }, true);
    expect(pretty === "POST /api/y 404 4ms rid=abcdef01 biz=biz-9", "development line is short and readable", pretty);
  }

  // ── through Express ─────────────────────────────────────────────────────
  const lines: string[] = [];
  const seen: Record<string, any> = {};
  const app = express();
  app.use(requestContextMiddleware({ pretty: false, log: (l) => lines.push(l) }));
  app.use(express.json());
  app.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  // Simulates requireAuth attaching the signed-in user.
  app.get("/api/me/thing", (req, _res, next) => { (req as any).user = { businessAccountId: "biz-user", activeBusinessAccountId: "biz-active" }; next(); }, async (_req, res) => {
    await new Promise((r) => setTimeout(r, 5));
    seen.me = { biz: currentBusinessAccountId(), route: currentRoute(), rid: getRequestContext()?.requestId };
    res.json({ secretResponse: "never logged" });
  });
  app.post("/api/webhook/msg91/:businessId", async (req, res) => {
    await Promise.resolve();
    seen.webhook = { biz: currentBusinessAccountId(), route: currentRoute() };
    res.status(200).json({ ok: true, echo: req.body });
  });
  app.post("/api/chat/widget", (req, res) => {
    setTimeout(() => { seen.widget = { biz: currentBusinessAccountId() }; res.json({ ok: true }); }, 1);
  });
  app.get("/api/explicit", (_req, res) => {
    setContextBusinessAccount("biz-explicit");
    res.json({ ok: true });
  });
  app.get("/api/boom", () => { throw new Error("boom"); });
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ message: err.message }); });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const r1 = await fetch(`${base}/api/me/thing?email=jane@example.com&token=abc`);
    const rid1 = r1.headers.get("x-request-id") || "";
    expect(UUID_RE.test(rid1), "X-Request-Id generated", rid1);
    expect(seen.me?.biz === "biz-active" && seen.me?.rid === rid1, "context sees request id + active account after auth", seen.me);
    expect(seen.me?.route === "GET /api/me/thing", "matched route pattern available", seen.me);

    const r2 = await fetch(`${base}/api/webhook/msg91/biz-webhook?secret=s3cr3t`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "upstream-req-0001" },
      body: JSON.stringify({ phone: "9876543210", text: "hello" }),
    });
    expect(r2.headers.get("x-request-id") === "upstream-req-0001", "incoming X-Request-Id reused");
    expect(seen.webhook?.biz === "biz-webhook" && seen.webhook?.route === "POST /api/webhook/msg91/:businessId", "webhook route param resolves the account", seen.webhook);

    await fetch(`${base}/api/chat/widget`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessAccountId: "biz-widget", message: "hi" }) });
    expect(seen.widget?.biz === "biz-widget", "widget body businessAccountId resolves the account (after a timer)", seen.widget);

    await fetch(`${base}/api/explicit`);
    await fetch(`${base}/api/boom`);
    await fetch(`${base}/health`);
    const r404 = await fetch(`${base}/api/does-not-exist`);
    expect(r404.status === 404 && !!r404.headers.get("x-request-id"), "404s get a request id too");
    await new Promise((r) => setTimeout(r, 20));

    const parsed = lines.map((l) => JSON.parse(l));
    expect(lines.every((l) => !l.includes("\n")), "every access entry is a single line");
    const me = parsed.find((p) => p.path === "/api/me/thing");
    expect(me && me.method === "GET" && me.status === 200 && typeof me.ms === "number" && me.requestId === rid1 && me.businessAccountId === "biz-active", "access line fields", me);
    expect(!lines.join("\n").includes("jane@example.com") && !lines.join("\n").includes("token=abc") && !lines.join("\n").includes("?"), "no query string logged");
    expect(!lines.join("\n").includes("never logged") && !lines.join("\n").includes("9876543210") && !lines.join("\n").includes("hello"), "no request/response bodies logged");
    const wh = parsed.find((p) => p.path === "/api/webhook/msg91/biz-webhook");
    expect(wh?.requestId === "upstream-req-0001" && wh?.businessAccountId === "biz-webhook", "webhook line carries upstream id + account", wh);
    expect(parsed.find((p) => p.path === "/api/explicit")?.businessAccountId === "biz-explicit", "setContextBusinessAccount shows in the access line");
    expect(parsed.find((p) => p.path === "/api/boom")?.status === 500, "errors logged with their status");
    expect(parsed.find((p) => p.path === "/api/does-not-exist")?.status === 404, "404 API route logged");
    const nonProd = process.env.NODE_ENV !== "production";
    expect(!!parsed.find((p) => p.path === "/health") === nonProd, "/health logged outside production only");

    // Concurrency: contexts never bleed between overlapping requests.
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      fetch(`${base}/api/webhook/msg91/biz-${i}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
        .then(() => null)));
    expect(results.length === 20, "20 concurrent requests completed");
    const concurrent = lines.map((l) => JSON.parse(l)).filter((p) => /^\/api\/webhook\/msg91\/biz-\d+$/.test(p.path));
    expect(concurrent.length === 20 && concurrent.every((p) => p.businessAccountId === p.path.split("/").pop()), "each concurrent request attributed to its own account");
  } finally {
    server.close();
  }

  if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log("\nAll accessLog tests passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
