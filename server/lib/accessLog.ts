/**
 * Request id + request context + one-line access log.
 *
 * - Every response carries `X-Request-Id`: the incoming header when it looks
 *   sane (8–128 chars of [A-Za-z0-9._:-], e.g. from the ALB / a client),
 *   otherwise a fresh UUID. Available as `req.requestId`.
 * - The rest of the request runs inside a requestContext (AsyncLocalStorage)
 *   carrying the request id, route and a lazy business-account resolver — used
 *   by OpenAI usage attribution and error reports.
 * - On finish, API/health requests are logged as ONE line:
 *     production:  {"type":"access","method":"GET","path":"/api/x","status":200,"ms":12.3,"requestId":"…","businessAccountId":"…"}
 *     development: GET /api/x 200 12ms rid=1a2b3c4d biz=…
 *   Never bodies, query strings or headers. The line goes through console.log,
 *   so the PII redaction in logRedaction.ts also applies to paths.
 */
import crypto from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { runWithContext, getRequestContext, sanitizeId, type RequestContext } from "./requestContext";

declare module "http" {
  interface IncomingMessage {
    requestId?: string;
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function pickRequestId(incoming: unknown): string {
  const v = Array.isArray(incoming) ? incoming[0] : incoming;
  return typeof v === "string" && REQUEST_ID_RE.test(v) ? v : crypto.randomUUID();
}

/** Best-effort account for this request: signed-in user, then route params, then widget body/query. */
export function resolveRequestBusinessAccountId(req: Request): string | null {
  const u = (req as any).user;
  return (
    sanitizeId(u?.activeBusinessAccountId) ||
    sanitizeId(u?.businessAccountId) ||
    sanitizeId(req.params?.businessAccountId) ||
    sanitizeId(req.params?.businessId) ||
    sanitizeId((req.body as any)?.businessAccountId) ||
    sanitizeId((req.query as any)?.businessAccountId) ||
    null
  );
}

function matchedRoute(req: Request): string | undefined {
  const p = (req as any).route?.path;
  return typeof p === "string" ? `${req.method} ${req.baseUrl || ""}${p}` : undefined;
}

export interface AccessLogEntry {
  method: string;
  path: string;
  status: number;
  ms: number;
  requestId: string;
  businessAccountId?: string;
}

export function formatAccessLine(e: AccessLogEntry, pretty: boolean): string {
  if (pretty) {
    return `${e.method} ${e.path} ${e.status} ${Math.round(e.ms)}ms rid=${e.requestId.slice(0, 8)}${e.businessAccountId ? ` biz=${e.businessAccountId}` : ""}`;
  }
  return JSON.stringify({ type: "access", ...e });
}

export interface AccessLogOptions {
  /** Pretty line instead of JSON (default: NODE_ENV !== 'production'). */
  pretty?: boolean;
  /** Sink for access lines (default console.log). */
  log?: (line: string) => void;
  /** Which requests get a line (default: /api/*, /health*, and any 5xx; successful /health only outside production). */
  shouldLog?: (path: string, status: number) => boolean;
}

export function defaultShouldLog(path: string, status: number, production = process.env.NODE_ENV === "production"): boolean {
  if (path.startsWith("/health")) return !production || status >= 400;
  return path.startsWith("/api") || status >= 500;
}

export function requestContextMiddleware(opts: AccessLogOptions = {}): RequestHandler {
  const pretty = opts.pretty ?? process.env.NODE_ENV !== "production";
  const log = opts.log ?? ((line: string) => console.log(line));
  const shouldLog = opts.shouldLog ?? ((p: string, s: number) => defaultShouldLog(p, s));

  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = pickRequestId(req.headers["x-request-id"]);
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    const start = process.hrtime.bigint();
    const path = req.path; // no query string

    const ctx: RequestContext = {
      requestId,
      route: `${req.method} ${path}`,
      resolveRoute: () => matchedRoute(req),
      resolveBusinessAccountId: () => resolveRequestBusinessAccountId(req),
    };

    res.on("finish", () => {
      try {
        if (!shouldLog(path, res.statusCode)) return;
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const biz = sanitizeId(live?.businessAccountId) || resolveRequestBusinessAccountId(req) || undefined;
        log(formatAccessLine({
          method: req.method,
          path,
          status: res.statusCode,
          ms: Math.round(ms * 10) / 10,
          requestId,
          ...(biz ? { businessAccountId: biz } : {}),
        }, pretty));
      } catch {
        /* logging must never break a response */
      }
    });

    // runWithContext copies ctx; keep the live store so an account set by a
    // handler (setContextBusinessAccount) shows up in the access line.
    let live: RequestContext | undefined;
    runWithContext(ctx, () => {
      live = getRequestContext();
      next();
    });
  };
}
