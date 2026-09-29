/**
 * Tests for the Sentry-compatible error reporter.
 * Run manually: `npx tsx server/lib/__tests__/errorReporter.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { ErrorReporter, parseDsn, scrubObject, isForbiddenKey, reportError, getErrorReporter, __setErrorReporterForTests } from "../errorReporter";
import { runWithContext } from "../requestContext";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

const DSN = "https://abc123@o42.ingest.sentry.io/4507";

function fakeTransport(status = 200, retryAfterSec?: number) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const transport = async (url: string, body: string, headers: Record<string, string>) => {
    calls.push({ url, body, headers });
    return { status, retryAfterSec };
  };
  return { calls, transport };
}

function eventOf(body: string): any {
  const lines = body.trim().split("\n");
  return JSON.parse(lines[2]);
}

async function main() {
  // ── DSN parsing ──────────────────────────────────────────────────────────
  {
    const d = parseDsn(DSN);
    expect(d?.publicKey === "abc123" && d?.envelopeUrl === "https://o42.ingest.sentry.io/api/4507/envelope/", "DSN → envelope URL + key", d);
    const p = parseDsn("https://k@sentry.example.com/prefix/path/12");
    expect(p?.envelopeUrl === "https://sentry.example.com/prefix/path/api/12/envelope/", "DSN with path prefix", p);
    expect(parseDsn("not a dsn") === null && parseDsn("https://sentry.io/12") === null, "invalid DSNs rejected");
  }

  // ── no-op without DSN ────────────────────────────────────────────────────
  {
    const { calls, transport } = fakeTransport();
    const r = new ErrorReporter({ dsn: null, transport });
    expect(r.enabled === false, "disabled when SENTRY_DSN is unset");
    expect(r.report(new Error("x")) === false && calls.length === 0, "report() is a no-op (nothing sent)");
    const saved = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    __setErrorReporterForTests(null);
    expect(getErrorReporter().enabled === false, "process reporter disabled without env");
    reportError(new Error("ignored")); // must not throw
    expect(true, "reportError() never throws when disabled");
    if (saved) process.env.SENTRY_DSN = saved;
  }

  // ── redaction ────────────────────────────────────────────────────────────
  {
    const { calls, transport } = fakeTransport();
    const r = new ErrorReporter({ dsn: DSN, transport, environment: "production", release: "abc1234" });
    const err = new Error("Failed to send to jane.doe@example.com at 9876543210 with password=hunter2");
    await runWithContext({ requestId: "req-12345678", businessAccountId: "biz-1", route: "POST /api/x" }, async () => {
      r.report(err, {
        source: "express",
        tags: { status: 500, phone: "+919876543210" },
        extra: {
          customerEmail: "bob@example.org",
          body: { secret: "should not appear" },
          headers: { cookie: "session=abc" },
          authorization: "Bearer xyz",
          sessionToken: "tok",
          env: { DATABASE_URL: "postgres://..." },
          nested: { note: "call 9123456789", apiKey: "sk-live-123" },
          count: 3,
        },
      });
    });
    await r.flush();
    expect(calls.length === 1, "one envelope sent", calls.length);
    const c = calls[0];
    expect(c.url === "https://o42.ingest.sentry.io/api/4507/envelope/", "posted to envelope endpoint");
    expect(c.headers["X-Sentry-Auth"].includes("sentry_key=abc123"), "auth header carries the public key");
    const raw = c.body;
    const ev = eventOf(raw);
    const value = ev.exception.values[0].value;
    expect(!raw.includes("jane.doe@example.com") && value.includes("j***@example.com"), "email masked in message", value);
    expect(!raw.includes("9876543210") && value.includes("******3210"), "phone masked in message and tags", value);
    expect(!raw.includes("hunter2"), "password value redacted");
    expect(!raw.includes("bob@example.org"), "email masked in extra");
    expect(!raw.includes("9123456789"), "phone masked in nested extra");
    expect(ev.extra.body === undefined && ev.extra.headers === undefined && ev.extra.authorization === undefined && ev.extra.sessionToken === undefined && ev.extra.env === undefined, "body/headers/auth/session/env keys dropped", Object.keys(ev.extra));
    expect(ev.extra.nested.apiKey === undefined && ev.extra.count === 3, "nested secret key dropped, plain values kept", ev.extra);
    expect(!raw.includes("should not appear") && !raw.includes("sk-live-123") && !raw.includes("session=abc"), "no forbidden values anywhere in the envelope");
    expect(ev.environment === "production" && ev.release === "abc1234", "environment + release set", { e: ev.environment, r: ev.release });
    expect(ev.tags.request_id === "req-12345678" && ev.tags.business_account_id === "biz-1" && ev.tags.source === "express" && ev.tags.route === "POST /api/x", "request context attached as tags", ev.tags);
    expect(Array.isArray(ev.exception.values[0].stacktrace?.frames) && ev.exception.values[0].stacktrace.frames.length > 0, "stack frames included");
    expect(!JSON.stringify(ev.exception.values[0].stacktrace).includes("example.com"), "stack is redacted too");
  }
  {
    expect(isForbiddenKey("x-api-key") && isForbiddenKey("Cookie") && isForbiddenKey("rawBody") && isForbiddenKey("ENV") && !isForbiddenKey("environment") && !isForbiddenKey("conversationId"), "forbidden-key matcher");
    const s = scrubObject({ a: "x@y.com", deep: { deeper: { deepest: { v: 1 } } } });
    expect(s.a === "x***@y.com", "scrubObject masks strings", s);
  }

  // ── dedupe + rate limit ──────────────────────────────────────────────────
  {
    let now = 1_000_000;
    const { calls, transport } = fakeTransport();
    const r = new ErrorReporter({ dsn: DSN, transport, now: () => now });
    const same = (ms = 5000) => new Error(`DB timeout after ${ms}ms`);
    expect(r.report(same(), { source: "worker:x" }) === true, "first occurrence sent");
    expect(r.report(same(), { source: "worker:x" }) === false, "identical error within 60s deduped");
    now += 30_000;
    expect(r.report(same(7000), { source: "worker:x" }) === false, "same error with different numbers still deduped");
    now += 31_000;
    expect(r.report(same(), { source: "worker:x" }) === true, "sent again after the 60s window");
    await r.flush();
    expect(calls.length === 2 && r.stats.droppedDuplicate === 2, "2 sent, 2 deduped", r.stats);
  }
  {
    let now = 5_000_000;
    const { calls, transport } = fakeTransport();
    const r = new ErrorReporter({ dsn: DSN, transport, now: () => now, maxPerMinute: 30 });
    let accepted = 0;
    for (let i = 0; i < 50; i++) if (r.report(new Error(`distinct failure kind ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`))) accepted++;
    expect(accepted === 30, "max 30 events per minute", accepted);
    expect(r.stats.droppedRateLimited === 20, "20 dropped by the rate limit", r.stats);
    now += 61_000;
    expect(r.report(new Error("fresh after a minute")) === true, "budget refills after a minute");
    await r.flush();
    expect(calls.length === 31, "31 envelopes sent", calls.length);
  }
  {
    let now = 9_000_000;
    const { transport } = fakeTransport(429, 120);
    const r = new ErrorReporter({ dsn: DSN, transport, now: () => now });
    r.report(new Error("first"));
    await r.flush();
    expect(r.report(new Error("second")) === false, "429 from Sentry pauses sending (Retry-After)");
    now += 121_000;
    expect(r.report(new Error("third")) === true, "resumes after Retry-After");
  }
  {
    const r = new ErrorReporter({ dsn: DSN, transport: async () => { throw new Error("network down"); } });
    expect(r.report(new Error("x")) === true, "transport failure does not throw");
    await r.flush();
    expect(r.stats.failed === 1, "transport failure counted", r.stats);
    const r2 = new ErrorReporter({ dsn: DSN, transport: () => new Promise(() => {}) });
    r2.report(new Error("hang"));
    const t0 = Date.now();
    await r2.flush(200);
    expect(Date.now() - t0 < 1_000, "flush() is bounded even if a send hangs");
  }
  {
    const { calls, transport } = fakeTransport();
    const r = new ErrorReporter({ dsn: DSN, transport });
    r.report("plain string rejection");
    r.report({ weird: "object", email: "a@b.co" });
    await r.flush();
    const e1 = eventOf(calls[0].body), e2 = eventOf(calls[1].body);
    expect(e1.exception.values[0].value === "plain string rejection", "non-Error string reported");
    expect(e2.exception.values[0].type === "NonErrorThrown" && !calls[1].body.includes("a@b.co"), "non-Error object reported and redacted", e2.exception.values[0]);
  }

  // ── process handlers forward crashes to the reporter ─────────────────────
  {
    const { installProcessHandlers } = await import("../gracefulShutdown");
    const reported: { err: unknown; ctx: any }[] = [];
    const shutdowns: [string, number | undefined][] = [];
    installProcessHandlers(async (reason, code) => { shutdowns.push([reason, code]); }, () => {}, (err, ctx) => {
      reported.push({ err, ctx });
      throw new Error("a throwing reporter must not break crash handling");
    });
    process.emit("unhandledRejection", new Error("rejected"), Promise.resolve());
    process.emit("uncaughtException", new Error("crashed"), "uncaughtException");
    expect(reported.length === 2 && reported[0].ctx.source === "unhandledRejection" && reported[1].ctx.level === "fatal", "unhandledRejection + uncaughtException reported", reported.map((r) => r.ctx));
    expect(shutdowns.length === 1 && shutdowns[0][0] === "uncaughtException" && shutdowns[0][1] === 1, "uncaughtException still triggers shutdown(1) even if reporting throws", shutdowns);
  }

  if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log("\nAll errorReporter tests passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
