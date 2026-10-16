/**
 * Plivo provider (Voice API + bidirectional audio streaming).
 *
 * Outbound call:
 *   POST https://api.plivo.com/v1/Account/<authId>/Call/   (JSON, HTTP Basic auth authId:authToken)
 *     from=<Plivo number>  to=<customer>  answer_url=<our signed answer URL>
 *     ring_url / hangup_url=<our signed status URL>  time_limit  ring_timeout
 *   → { message: "call fired", request_uuid }            (request_uuid = our providerCallSid)
 *   When the customer answers, Plivo POSTs the answer URL (CallUUID, From, To…) and we return
 *   <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">wss://…</Stream>.
 *
 * Inbound call: the business's Plivo Application has our inbound answer URL
 *   (https://<base>/api/calling/plivo/inbound/<inboundKey>); we answer with the same Stream XML.
 *
 * Live call (CallUUID): hang up = DELETE …/Call/<uuid>/, transfer = POST …/Call/<uuid>/ {legs: aleg,
 * aleg_url}, record = POST …/Call/<uuid>/Record/ (returns the recording URL at once).
 *
 * Status webhook (form): Event (Ring | Hangup), CallStatus (ringing | completed | busy | failed |
 * timeout | no-answer | cancel), RequestUUID, CallUUID, Duration, BillDuration, HangupCause…
 *
 * Requests from Plivo carry X-Plivo-Signature-V3 (HMAC-SHA256 with the Auth Token, see
 * verifyPlivoSignatureV3). Our URLs are already signed per call / business; the Plivo signature is
 * checked on top (logged on mismatch; enforced when PLIVO_SIGNATURE_ENFORCE=1).
 *
 * The network call goes through an injectable fetch (tests never reach Plivo).
 */
import crypto from "crypto";
import type { CallStatus } from "@shared/aiCalling";
import type { PlaceCallInput, PlaceCallResult, ProviderCredentials, ProviderStatusUpdate, TelephonyProvider } from "../types";
import { ProviderError } from "./exotel";

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

const TIMEOUT_MS = 15_000;
const DEFAULT_RING_SEC = 30;
/** Extra seconds past the business's longest call so the AI's goodbye is never cut off. */
const TIME_LIMIT_GRACE_SEC = 30;

/** Plivo stream audio: G.711 μ-law at 8 kHz (the phone network's own format). */
export const PLIVO_STREAM_CONTENT_TYPE = "audio/x-mulaw;rate=8000";

function apiBase(): string {
  return (process.env.PLIVO_API_BASE?.trim() || "https://api.plivo.com/v1").replace(/\/+$/, "");
}

function plv(creds: ProviderCredentials) {
  if (creds.provider !== "plivo" || !creds.plivo) throw new ProviderError("Plivo is not set up for this business.", true);
  return creds.plivo;
}

function authHeader(authId: string, authToken: string): string {
  return `Basic ${Buffer.from(`${authId}:${authToken}`).toString("base64")}`;
}

/** "+91 80 1234 5678" → "918012345678" (Plivo numbers are digits with the country code). */
export function plivoDigits(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

/** Turn a Plivo error into plain words for a business user. */
export function explainPlivoError(httpStatus: number, message: string): ProviderError {
  const m = (message || "").toLowerCase();
  if (httpStatus === 401 || /authenticat|unauthori[sz]ed|invalid (auth|credentials)|auth[_ ]?(id|token)/.test(m)) {
    return new ProviderError("Plivo did not accept your Auth ID or Auth Token. Copy them again from the Plivo console (Overview page).", true, httpStatus);
  }
  if (/kyc|verification (is )?pending|compliance/.test(m)) return new ProviderError("Your Plivo account's KYC is still pending, so Plivo won't place calls yet. Finish KYC in the Plivo console.", true, httpStatus);
  if (/suspend|deactivat|account (is )?(disabled|inactive|blocked)/.test(m)) return new ProviderError("Your Plivo account is suspended or inactive. Please contact Plivo support.", true, httpStatus);
  if (/\bn?dnd\b|ndnc|do not disturb/.test(m)) return new ProviderError("This number is on India's Do-Not-Disturb (DND) list, so Plivo blocked the call.", true, httpStatus);
  if (httpStatus === 402 || /insufficient|balance|credit|recharge/.test(m)) return new ProviderError("Your Plivo balance is too low to place calls. Please recharge your Plivo account.", false, httpStatus);
  if (/trial|sandbox|verified (caller|number)|not verified/.test(m)) return new ProviderError("Plivo trial accounts can only call numbers you have verified in the Plivo console (Phone Numbers → Sandbox numbers).", true, httpStatus);
  if (/(from|caller|source).*(number|id)|not (a )?(rented|owned)|does not belong/.test(m) && /(not|invalid|unknown|belong)/.test(m)) {
    return new ProviderError("Plivo did not accept your Plivo number as the caller. Check it is a number in this Plivo account.", true, httpStatus);
  }
  if (/invalid.*(number|destination|\bto\b)|not a valid (phone|number)|number.*invalid/.test(m)) {
    return new ProviderError("Plivo could not use this phone number. Check it has the right country code and digits.", true, httpStatus);
  }
  if (httpStatus === 403) return new ProviderError("Plivo refused the request for this account. Check your plan allows calls to this country and audio streaming.", true, httpStatus);
  if (httpStatus === 404) return new ProviderError("Plivo could not find this account or number. Check your Auth ID and Plivo number.", true, httpStatus);
  if (httpStatus === 429) return new ProviderError("Plivo is limiting how fast we can call. The call will be tried again.", false, httpStatus);
  if (httpStatus >= 500) return new ProviderError("Plivo had a problem on their side. The call will be tried again.", false, httpStatus);
  return new ProviderError(`Plivo could not place the call${message ? `: ${message.slice(0, 200)}` : "."}`, false, httpStatus);
}

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

function errorMessageOf(body: any, text: string): string {
  return String(body?.error?.message || body?.error || body?.message || (typeof text === "string" ? text.slice(0, 300) : ""));
}

/** Map a Plivo CallStatus (+ hangup cause) to ours. */
export function mapPlivoStatus(rawStatus: unknown, hangupCause?: unknown): CallStatus | null {
  const s = String(rawStatus || "").trim().toLowerCase().replace(/_/g, "-");
  const cause = String(hangupCause || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  switch (s) {
    case "queued": return "dialing";
    case "ringing": case "early-media": return "ringing";
    case "in-progress": case "answered": return "in_progress";
    case "busy": return "busy";
    case "no-answer": case "noanswer": case "timeout": return "no_answer";
    case "failed": return /BUSY/.test(cause) ? "busy" : /NO_ANSWER|NO_USER_RESPONSE/.test(cause) ? "no_answer" : "failed";
    case "cancel": case "canceled": case "cancelled": return /NO_ANSWER|NO_USER_RESPONSE/.test(cause) ? "no_answer" : "failed";
    case "completed": return "completed";
    default: return null;
  }
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function first(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

export function parsePlivoStatusWebhook(body: Record<string, unknown>): ProviderStatusUpdate | null {
  if (!body || typeof body !== "object") return null;
  const b: Record<string, any> = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, first(v)]));
  const sid = String(b.RequestUUID ?? b.request_uuid ?? b.CallUUID ?? b.call_uuid ?? "").trim();
  const event = String(b.Event ?? b.event ?? "").trim().toLowerCase();
  const status = mapPlivoStatus(b.CallStatus ?? b.call_status ?? (event === "ring" ? "ringing" : ""), b.HangupCause ?? b.HangupCauseName ?? b.hangup_cause);
  if (!sid || !status) return null;
  const terminal = !["dialing", "ringing", "in_progress"].includes(status);
  return {
    providerCallSid: sid,
    status,
    durationSec: num(b.Duration ?? b.duration),
    recordingUrl: null,
    answeredAt: status === "in_progress" ? new Date() : null,
    endedAt: terminal ? new Date() : null,
    raw: Object.fromEntries(Object.entries(b).filter(([k]) => !/token|key|auth|signature/i.test(k)).slice(0, 40)),
  };
}

/** Recording URLs we are willing to fetch (SSRF guard): https on Plivo / S3 hosts only. */
export function isAllowedPlivoRecordingUrl(url: string): { ok: boolean; sendAuth: boolean } {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return { ok: false, sendAuth: false };
    const h = u.hostname.toLowerCase();
    const plivo = /(^|\.)plivo\.com$/.test(h);
    const s3 = /(^|\.)amazonaws\.com$/.test(h);
    return { ok: plivo || s3, sendAuth: plivo };
  } catch {
    return { ok: false, sendAuth: false };
  }
}

// ── call instructions (Plivo XML) ──────────────────────────────────────────────

function xmlEscape(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8"?>`;

/** Answer a call by streaming its audio (both ways) to our media WebSocket. */
export function plivoStreamXml(o: { streamUrl: string; timeLimitSec: number }): string {
  const streamTimeout = Math.max(60, Math.round(o.timeLimitSec) + 120);
  return `${XML_HEAD}<Response><Stream bidirectional="true" keepCallAlive="true" contentType="${PLIVO_STREAM_CONTENT_TYPE}" streamTimeout="${streamTimeout}">${xmlEscape(o.streamUrl)}</Stream></Response>`;
}

/** Connect the caller to a person (transfer). */
export function plivoDialXml(o: { number: string; callerId: string | null; timeoutSec?: number }): string {
  const caller = o.callerId ? ` callerId="${xmlEscape(plivoDigits(o.callerId))}"` : "";
  return `${XML_HEAD}<Response><Dial${caller} timeout="${Math.max(10, Math.round(o.timeoutSec ?? 30))}"><Number>${xmlEscape(plivoDigits(o.number))}</Number></Dial></Response>`;
}

/** Politely decline (calling off / minutes used up) and hang up. */
export function plivoRefuseXml(text: string): string {
  return `${XML_HEAD}<Response><Speak>${xmlEscape(text)}</Speak><Hangup/></Response>`;
}

export function plivoHangupXml(): string {
  return `${XML_HEAD}<Response><Hangup/></Response>`;
}

// ── X-Plivo-Signature-V3 (same algorithm as Plivo's SDKs, utils/v3Security) ─────

type Params = Record<string, unknown>;

function asList(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x));
}

function sortedQueryString(params: Record<string, string[]>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) for (const value of [...params[key]].sort()) parts.push(`${key}=${value}`);
  return parts.join("&");
}

function sortedParamsString(params: Params): string {
  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) for (const value of asList(params[key]).sort()) parts.push(`${key}${value}`);
  return parts.join("");
}

/** The string Plivo signs (before ".<nonce>"). */
export function plivoSignatureBase(method: string, uri: string, params: Params = {}): string {
  const u = new URL(uri);
  const base = `${u.protocol}//${u.host}${u.pathname}`;
  const query: Record<string, string[]> = {};
  u.searchParams.forEach((value, key) => { (query[key] ||= []).push(value); });
  if (method.toUpperCase() === "GET") {
    for (const [k, v] of Object.entries(params)) (query[k] ||= []).push(...asList(v));
    const q = sortedQueryString(query);
    return q ? `${base}?${q}` : base;
  }
  const hasParams = Object.keys(params).length > 0;
  const q = sortedQueryString(query);
  let url = base;
  if (q || hasParams) url += `?${q}`;
  if (q && hasParams) url += ".";
  return url + sortedParamsString(params);
}

export function plivoSignatureV3(authToken: string, method: string, uri: string, nonce: string, params: Params = {}): string {
  return crypto.createHmac("sha256", authToken).update(`${plivoSignatureBase(method, uri, params)}.${nonce}`).digest("base64");
}

/**
 * True when the X-Plivo-Signature-V3 header (comma-separated when the account has several
 * tokens) matches for any of the candidate URLs (the public address can differ from what the
 * proxy reports).
 */
export function verifyPlivoSignatureV3(o: { authToken: string; method: string; urls: string[]; nonce: string | undefined; signature: string | undefined; params?: Params }): boolean {
  if (!o.authToken || !o.nonce || !o.signature) return false;
  const given = o.signature.split(",").map((s) => s.trim()).filter(Boolean);
  for (const url of Array.from(new Set(o.urls.filter(Boolean)))) {
    let expected: string;
    try { expected = plivoSignatureV3(o.authToken, o.method, url, o.nonce, o.params ?? {}); } catch { continue; }
    const e = Buffer.from(expected);
    if (given.some((g) => { const b = Buffer.from(g); return b.length === e.length && crypto.timingSafeEqual(b, e); })) return true;
  }
  return false;
}

// ── provider ─────────────────────────────────────────────────────────────────

export function createPlivoProvider(fetchImpl?: FetchLike): TelephonyProvider {
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init) as any);

  async function request(p: { authId: string; authToken: string }, method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; body: any; text: string }> {
    let res;
    try {
      res = await doFetch(`${apiBase()}/Account/${encodeURIComponent(p.authId)}/${path}`, {
        method,
        headers: {
          authorization: authHeader(p.authId, p.authToken),
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ProviderError("Could not reach Plivo (network problem or timeout). The call will be tried again.", false, null);
    }
    const text = await res.text();
    return { status: res.status, body: parseJson(text), text };
  }

  return {
    id: "plivo",

    async verify(creds) {
      const p = plv(creds);
      const account = await request(p, "GET", "");
      if (account.status < 200 || account.status >= 300) throw explainPlivoError(account.status, errorMessageOf(account.body, account.text));
      const number = await request(p, "GET", `Number/${encodeURIComponent(plivoDigits(p.number))}/`);
      if (number.status === 404) {
        throw new ProviderError(`Connected to Plivo, but ${p.number} is not a number in this Plivo account. Check the Plivo number (Phone Numbers → Your Numbers).`, true, 404);
      }
      if (number.status < 200 || number.status >= 300) throw explainPlivoError(number.status, errorMessageOf(number.body, number.text));
      const name = typeof account.body?.name === "string" && account.body.name.trim() ? ` (${account.body.name.trim().slice(0, 80)})` : "";
      return { ok: true, detail: `Connected to Plivo account ${p.authId}${name}. Calls will show ${p.number} as the caller.` };
    },

    async placeCall(creds, input: PlaceCallInput): Promise<PlaceCallResult> {
      const p = plv(creds);
      if (!input.answerUrl) throw new ProviderError("The call's answer address is missing (public address of the portal unknown).", true);
      const { status, body, text } = await request(p, "POST", "Call/", {
        from: plivoDigits(p.number),
        to: plivoDigits(input.to),
        answer_url: input.answerUrl,
        answer_method: "POST",
        ...(input.statusCallbackUrl ? {
          ring_url: input.statusCallbackUrl,
          ring_method: "POST",
          hangup_url: input.statusCallbackUrl,
          hangup_method: "POST",
        } : {}),
        time_limit: Math.max(30, Math.round(input.timeLimitSec) + TIME_LIMIT_GRACE_SEC),
        ring_timeout: Math.max(10, Math.round(input.ringTimeoutSec ?? DEFAULT_RING_SEC)),
      });
      if (status < 200 || status >= 300) throw explainPlivoError(status, errorMessageOf(body, text));
      const uuid = first(body?.request_uuid);
      if (!uuid) throw new ProviderError("Plivo accepted the request but did not return a call id.", false, status);
      return { providerCallSid: String(uuid), status: "dialing" };
    },

    async hangup(creds, callUuid) {
      const p = plv(creds);
      const { status, body, text } = await request(p, "DELETE", `Call/${encodeURIComponent(callUuid)}/`);
      // 404 = the call has already ended.
      if (status !== 404 && (status < 200 || status >= 300)) throw explainPlivoError(status, errorMessageOf(body, text));
    },

    async transfer(creds, callUuid, url) {
      const p = plv(creds);
      const { status, body, text } = await request(p, "POST", `Call/${encodeURIComponent(callUuid)}/`, { legs: "aleg", aleg_url: url, aleg_method: "POST" });
      if (status < 200 || status >= 300) throw explainPlivoError(status, errorMessageOf(body, text));
    },

    async startRecording(creds, callUuid, opts) {
      const p = plv(creds);
      const { status, body, text } = await request(p, "POST", `Call/${encodeURIComponent(callUuid)}/Record/`, {
        time_limit: Math.max(60, Math.round(opts.timeLimitSec) + TIME_LIMIT_GRACE_SEC),
        file_format: "mp3",
      });
      if (status < 200 || status >= 300) throw explainPlivoError(status, errorMessageOf(body, text));
      const url = typeof body?.url === "string" && body.url.trim() ? body.url.trim() : null;
      return { recordingUrl: url && isAllowedPlivoRecordingUrl(url).ok ? url : null };
    },

    parseStatusWebhook: parsePlivoStatusWebhook,

    async fetchRecording(creds, recordingUrl) {
      const allowed = isAllowedPlivoRecordingUrl(recordingUrl);
      if (!allowed.ok) throw new ProviderError("This recording address is not allowed.", true);
      const headers: Record<string, string> = {};
      if (allowed.sendAuth) {
        const p = plv(creds);
        headers.authorization = authHeader(p.authId, p.authToken);
      }
      let res;
      try {
        res = await doFetch(recordingUrl, { method: "GET", headers, signal: AbortSignal.timeout(30_000) });
      } catch {
        throw new ProviderError("Could not download the recording from Plivo.", false);
      }
      if (!res.ok) throw new ProviderError(res.status === 404 ? "The recording is not available (yet)." : "Plivo did not return the recording.", res.status === 404, res.status);
      const contentType = res.headers.get("content-type") || "audio/mpeg";
      return { contentType, body: Buffer.from(await res.arrayBuffer()) };
    },
  };
}

export const plivoProvider = createPlivoProvider();
