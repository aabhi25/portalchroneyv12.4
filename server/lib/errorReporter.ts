/**
 * Minimal Sentry-compatible error reporter (no SDK dependency).
 *
 * Enabled only when SENTRY_DSN is set; otherwise every call is a cheap no-op.
 * Events are POSTed to the project's envelope endpoint derived from the DSN
 * (https://<key>@<host>[/<path>]/<projectId> → https://<host>[/<path>]/api/<projectId>/envelope/)
 * with fetchWithTimeout, fire-and-forget.
 *
 * Privacy: the message, stack and every tag/extra value go through redactPII
 * (the same masking the console uses). Keys that look like request bodies,
 * headers, cookies, credentials or env are dropped entirely. Nothing reads
 * req.body / req.headers / process.env into an event.
 *
 * Volume control: at most SENTRY_MAX_EVENTS_PER_MIN (default 30) events per
 * rolling minute, identical errors (type + message + top frame) are sent once
 * per 60s, and a 429 from Sentry pauses sending for its Retry-After.
 *
 * Env: SENTRY_DSN, SENTRY_ENVIRONMENT (default NODE_ENV), APP_VERSION /
 * BUILD_COMMIT (release), SENTRY_MAX_EVENTS_PER_MIN.
 */
import crypto from "crypto";
import { redactPII } from "../logRedaction";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { getRequestContext, currentBusinessAccountId, currentRoute } from "./requestContext";

export type ErrorLevel = "fatal" | "error" | "warning";

export interface ErrorContext {
  /** Short origin label, becomes the `source` tag (e.g. "worker:crm-sync-recovery"). */
  source?: string;
  level?: ErrorLevel;
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
}

export interface ParsedDsn {
  publicKey: string;
  envelopeUrl: string;
}

export type Transport = (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number; retryAfterSec?: number }>;

export interface ReporterOptions {
  dsn?: string | null;
  environment?: string;
  release?: string;
  maxPerMinute?: number;
  dedupeWindowMs?: number;
  transport?: Transport;
  now?: () => number;
}

export interface ReporterStats {
  sent: number;
  droppedRateLimited: number;
  droppedDuplicate: number;
  failed: number;
}

export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const publicKey = decodeURIComponent(u.username);
    const parts = u.pathname.split("/").filter(Boolean);
    const projectId = parts.pop();
    if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = parts.length ? `/${parts.join("/")}` : "";
    return { publicKey, envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/` };
  } catch {
    return null;
  }
}

// Keys never forwarded, whatever their value.
const FORBIDDEN_SUBSTRINGS = ["body", "header", "cookie", "authorization", "password", "passwd", "secret", "token", "apikey", "session", "credential"];
export function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return k === "auth" || k === "env" || k.startsWith("env") && k !== "environment" || FORBIDDEN_SUBSTRINGS.some((f) => k.includes(f));
}

function scrubValue(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return redactPII(v).slice(0, 2000);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Error) return redactPII(`${v.name}: ${v.message}`).slice(0, 2000);
  if (depth >= 3) return "[truncated]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrubValue(x, depth + 1));
  if (typeof v === "object") return scrubObject(v as Record<string, unknown>, depth + 1);
  return String(v);
}

export function scrubObject(obj: Record<string, unknown> | undefined, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj).slice(0, 50)) {
    if (isForbiddenKey(k)) continue;
    out[k] = scrubValue(v, depth);
  }
  return out;
}

interface Frame { filename: string; function: string; lineno?: number; colno?: number; in_app: boolean }

function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(1, 40)) {
    const m = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const filename = m[2].replace(process.cwd() + "/", "");
    frames.push({
      function: m[1] || "?",
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
  }
  return frames.reverse(); // Sentry wants oldest call first
}

function toError(err: unknown): { type: string; message: string; stack?: string } {
  if (err instanceof Error) return { type: err.name || "Error", message: err.message || String(err), stack: err.stack };
  if (typeof err === "string") return { type: "Error", message: err };
  try {
    return { type: "NonErrorThrown", message: JSON.stringify(err) ?? String(err) };
  } catch {
    return { type: "NonErrorThrown", message: String(err) };
  }
}

export class ErrorReporter {
  readonly enabled: boolean;
  private readonly dsn: ParsedDsn | null;
  private readonly maxPerMinute: number;
  private readonly dedupeWindowMs: number;
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly environment: string;
  private readonly release?: string;
  private sentTimes: number[] = [];
  private lastSeen = new Map<string, number>();
  private pausedUntil = 0;
  private inFlight = new Set<Promise<void>>();
  readonly stats: ReporterStats = { sent: 0, droppedRateLimited: 0, droppedDuplicate: 0, failed: 0 };

  constructor(opts: ReporterOptions = {}) {
    this.dsn = opts.dsn ? parseDsn(opts.dsn) : null;
    if (opts.dsn && !this.dsn) console.warn("[ErrorReporter] SENTRY_DSN is not a valid DSN — error reporting disabled");
    this.enabled = !!this.dsn;
    this.maxPerMinute = opts.maxPerMinute ?? 30;
    this.dedupeWindowMs = opts.dedupeWindowMs ?? 60_000;
    this.transport = opts.transport ?? defaultTransport;
    this.now = opts.now ?? Date.now;
    this.environment = opts.environment || "development";
    this.release = opts.release || undefined;
  }

  /** Builds the (already scrubbed) Sentry event. Exported for tests via buildEvent. */
  buildEvent(err: unknown, ctx: ErrorContext = {}) {
    const e = toError(err);
    const reqCtx = getRequestContext();
    const tags: Record<string, string> = {};
    const addTag = (k: string, v: unknown) => {
      if (v === undefined || v === null || v === "" || isForbiddenKey(k)) return;
      tags[k] = redactPII(String(v)).slice(0, 200);
    };
    addTag("source", ctx.source);
    addTag("request_id", reqCtx?.requestId);
    addTag("route", currentRoute());
    addTag("business_account_id", currentBusinessAccountId());
    for (const [k, v] of Object.entries(ctx.tags || {})) addTag(k, v);

    const message = redactPII(e.message).slice(0, 4000);
    const frames = parseStack(e.stack ? redactPII(e.stack) : undefined);
    return {
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: this.now() / 1000,
      platform: "node",
      level: ctx.level || "error",
      logger: "chroney",
      environment: this.environment,
      ...(this.release ? { release: this.release } : {}),
      exception: {
        values: [{ type: e.type, value: message, ...(frames.length ? { stacktrace: { frames } } : {}) }],
      },
      tags,
      extra: scrubObject(ctx.extra),
      contexts: { runtime: { name: "node", version: process.version } },
    };
  }

  /** Returns true when the event was accepted for sending. */
  report(err: unknown, ctx: ErrorContext = {}): boolean {
    if (!this.enabled || !this.dsn) return false;
    try {
      const now = this.now();
      if (now < this.pausedUntil) { this.stats.droppedRateLimited++; return false; }

      const e = toError(err);
      const topFrame = (e.stack || "").split("\n").find((l) => /^\s*at /.test(l))?.trim() || "";
      const key = `${e.type}|${redactPII(e.message).replace(/\d+/g, "#").slice(0, 300)}|${topFrame}|${ctx.source || ""}`;
      const last = this.lastSeen.get(key);
      if (last !== undefined && now - last < this.dedupeWindowMs) { this.stats.droppedDuplicate++; return false; }

      this.sentTimes = this.sentTimes.filter((t) => now - t < 60_000);
      if (this.sentTimes.length >= this.maxPerMinute) { this.stats.droppedRateLimited++; return false; }

      this.sentTimes.push(now);
      this.lastSeen.set(key, now);
      if (this.lastSeen.size > 500) {
        for (const [k, t] of Array.from(this.lastSeen)) if (now - t >= this.dedupeWindowMs) this.lastSeen.delete(k);
      }

      const event = this.buildEvent(err, ctx);
      const body =
        JSON.stringify({ event_id: event.event_id, sent_at: new Date(now).toISOString() }) + "\n" +
        JSON.stringify({ type: "event" }) + "\n" +
        JSON.stringify(event) + "\n";
      const headers = {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${this.dsn.publicKey}, sentry_client=chroney-reporter/1.0`,
      };
      const p = this.transport(this.dsn.envelopeUrl, body, headers)
        .then((res) => {
          if (res.status === 429) {
            this.pausedUntil = this.now() + (res.retryAfterSec ?? 60) * 1000;
            this.stats.failed++;
          } else if (res.status >= 400) {
            this.stats.failed++;
          } else {
            this.stats.sent++;
          }
        })
        .catch(() => { this.stats.failed++; })
        .finally(() => { this.inFlight.delete(p); });
      this.inFlight.add(p);
      return true;
    } catch {
      return false; // reporting must never throw into the caller
    }
  }

  /** Waits (bounded) for in-flight sends — used at shutdown. */
  async flush(timeoutMs = 2_000): Promise<void> {
    if (this.inFlight.size === 0) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(Array.from(this.inFlight)),
      new Promise<void>((resolve) => { t = setTimeout(resolve, timeoutMs); }), // not unref(d): cleared below
    ]);
    if (t) clearTimeout(t);
  }
}

const defaultTransport: Transport = async (url, body, headers) => {
  const res = await fetchWithTimeout(url, { method: "POST", body, headers }, 5_000);
  const ra = Number(res.headers.get("retry-after"));
  // Drain the body so the socket is released.
  await res.text().catch(() => "");
  return { status: res.status, retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : undefined };
};

let singleton: ErrorReporter | null = null;

export function getErrorReporter(): ErrorReporter {
  if (!singleton) {
    const max = Number(process.env.SENTRY_MAX_EVENTS_PER_MIN);
    singleton = new ErrorReporter({
      dsn: process.env.SENTRY_DSN || null,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      release: process.env.APP_VERSION || process.env.BUILD_COMMIT || undefined,
      maxPerMinute: Number.isFinite(max) && max > 0 ? max : undefined,
    });
  }
  return singleton;
}

/** Test hook: replace (or reset with null) the process-wide reporter. */
export function __setErrorReporterForTests(r: ErrorReporter | null): void {
  singleton = r;
}

/**
 * Report an error to Sentry (no-op without SENTRY_DSN). Never throws. Call it
 * from central catch points next to the existing console.error — not from
 * every call site.
 */
export function reportError(err: unknown, ctx: ErrorContext = {}): void {
  try {
    getErrorReporter().report(err, ctx);
  } catch {
    /* never let reporting break the caller */
  }
}

export function flushErrorReports(timeoutMs?: number): Promise<void> {
  return singleton ? singleton.flush(timeoutMs) : Promise.resolve();
}
