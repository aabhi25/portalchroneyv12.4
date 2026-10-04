/**
 * Exotel provider ("Connect Voice AI" / AgentStream).
 *
 * Outbound call:
 *   POST https://<subdomain>/v1/Accounts/<sid>/Calls/connect.json   (form-encoded, HTTP Basic auth key:token)
 *     From=<customer>  CallerId=<ExoPhone>  CustomField=aicall:<callId>
 *     StreamUrl=<our signed wss URL>  StreamType=bidirectional            ← no call flow configured
 *       or Url=http://my.exotel.com/<sid>/exoml/start_voice/<flowAppId>   ← business uses a call flow (transfer)
 *     Record=true RecordingChannels=dual   TimeLimit=<sec>  TimeOut=<ring sec>
 *     StatusCallback=<our signed https URL>  StatusCallbackContentType=application/json
 *     StatusCallbackEvents[0]=terminal  StatusCallbackEvents[1]=answered
 *   → { Call: { Sid, Status, ... } }   errors → { RestException: { Status, Code, Message } }
 *
 * CALL FLOW (flowAppId) RULE: with a flow, the stream URL lives in the flow's Voicebot applet,
 * so our per-call signed stream URL cannot be passed. The flow's Voicebot applet must point at the
 * business's INBOUND stream URL (settings → setup.inboundStreamUrl). The media handler recognises
 * the outbound call on that inbound socket by `start.call_sid` == ai_calls.provider_call_sid
 * (provider 'exotel', direction 'outbound'), falling back to a custom parameter / CustomField
 * value "aicall:<callId>" if Exotel forwards it (start.custom_parameters).
 *
 * Status webhook (JSON or form): CallSid, Status (queued|ringing|in-progress|completed|failed|busy|no-answer),
 * RecordingUrl, ConversationDuration / Duration, DateUpdated, EventType (answered|terminal).
 *
 * The network call goes through an injectable fetch (tests never reach Exotel).
 */
import type { CallStatus } from "@shared/aiCalling";
import type { PlaceCallInput, PlaceCallResult, ProviderCredentials, ProviderStatusUpdate, TelephonyProvider } from "../types";

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

export class ProviderError extends Error {
  constructor(message: string, public readonly permanent = false, public readonly httpStatus: number | null = null) {
    super(message);
    this.name = "ProviderError";
  }
}

const TIMEOUT_MS = 15_000;
const DEFAULT_RING_SEC = 30;

function exo(creds: ProviderCredentials) {
  if (creds.provider !== "exotel" || !creds.exotel) throw new ProviderError("Exotel is not set up for this business.", true);
  return creds.exotel;
}

function authHeader(key: string, token: string): string {
  return `Basic ${Buffer.from(`${key}:${token}`).toString("base64")}`;
}

function apiBase(subdomain: string, sid: string): string {
  const host = String(subdomain || "api.in.exotel.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/v1/Accounts/${encodeURIComponent(sid)}`;
}

/** Turn an Exotel error into plain words for a business user. */
export function explainExotelError(httpStatus: number, message: string): ProviderError {
  const m = (message || "").toLowerCase();
  if (httpStatus === 401 || /authenticat|unauthori[sz]ed|invalid (api )?(key|token)|credentials/.test(m)) {
    return new ProviderError("Exotel did not accept your API key or token. Copy them again from Exotel → Settings → API settings.", true, httpStatus);
  }
  if (/kyc/.test(m)) return new ProviderError("Your Exotel account's KYC is still pending, so Exotel won't place calls yet. Finish KYC in your Exotel dashboard.", true, httpStatus);
  if (/suspend|deactivat|blocked account|account (is )?(disabled|inactive)/.test(m)) {
    return new ProviderError("Your Exotel account is suspended or inactive. Please contact Exotel support.", true, httpStatus);
  }
  if (/\bn?dnd\b|ndnc|do not disturb|dnd registered/.test(m)) {
    return new ProviderError("This number is on India's Do-Not-Disturb (DND) list, so Exotel blocked the call.", true, httpStatus);
  }
  if (/balance|credit|recharge|insufficient fund/.test(m)) {
    return new ProviderError("Your Exotel balance is too low to place calls. Please recharge your Exotel account.", false, httpStatus);
  }
  if (/callerid|caller id|exophone|virtual number/.test(m) && /(not|invalid|unknown|verify|belong)/.test(m)) {
    return new ProviderError("Exotel did not accept your ExoPhone (caller number). Check it is a number from your Exotel account.", true, httpStatus);
  }
  if (/not verified|unverified|verify the number/.test(m)) {
    return new ProviderError("Exotel says this number is not verified for your account (trial accounts can only call verified numbers).", true, httpStatus);
  }
  if (/invalid.*(number|from|to\b)|not a valid (phone|mobile)|number.*invalid/.test(m)) {
    return new ProviderError("Exotel could not use this phone number. Check it has the right country code and digits.", true, httpStatus);
  }
  if (httpStatus === 403) return new ProviderError("Exotel refused the request for this account. Check your plan allows Voice AI calls (AgentStream).", true, httpStatus);
  if (httpStatus === 404) return new ProviderError("Exotel could not find this account. Check your account SID and region.", true, httpStatus);
  if (httpStatus === 429) return new ProviderError("Exotel is limiting how fast we can call. The call will be tried again.", false, httpStatus);
  if (httpStatus >= 500) return new ProviderError("Exotel had a problem on their side. The call will be tried again.", false, httpStatus);
  return new ProviderError(`Exotel could not place the call${message ? `: ${message.slice(0, 200)}` : "."}`, false, httpStatus);
}

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

function errorMessageOf(body: any, text: string): string {
  return String(body?.RestException?.Message || body?.RestException?.message || body?.message || body?.error || (typeof text === "string" ? text.slice(0, 300) : ""));
}

/** Map an Exotel call status to ours. */
export function mapExotelStatus(raw: unknown): CallStatus | null {
  const s = String(raw || "").trim().toLowerCase().replace(/_/g, "-");
  switch (s) {
    case "queued": return "dialing";
    case "ringing": return "ringing";
    case "in-progress": case "answered": return "in_progress";
    case "completed": return "completed";
    case "busy": return "busy";
    case "no-answer": case "noanswer": case "not-answered": return "no_answer";
    case "failed": case "canceled": case "cancelled": return "failed";
    default: return null;
  }
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  // Exotel uses "YYYY-MM-DD HH:MM:SS" in IST; ISO strings are also accepted.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 330 * 60_000);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseExotelStatusWebhook(body: Record<string, unknown>): ProviderStatusUpdate | null {
  if (!body || typeof body !== "object") return null;
  const b: Record<string, any> = body;
  const sid = String(b.CallSid ?? b.callSid ?? b.Sid ?? b.call_sid ?? "").trim();
  const status = mapExotelStatus(b.Status ?? b.CallStatus ?? b.status ?? (String(b.EventType || "").toLowerCase() === "answered" ? "in-progress" : ""));
  if (!sid || !status) return null;
  const duration = num(b.ConversationDuration ?? b.conversation_duration ?? b.DialCallDuration ?? b.Duration ?? b.duration);
  const recording = typeof b.RecordingUrl === "string" && b.RecordingUrl.trim() ? b.RecordingUrl.trim()
    : (typeof b.recording_url === "string" && b.recording_url.trim() ? b.recording_url.trim() : null);
  const updated = parseDate(b.DateUpdated ?? b.EndTime ?? b.date_updated);
  const terminal = !["dialing", "ringing", "in_progress"].includes(status);
  return {
    providerCallSid: sid,
    status,
    durationSec: duration,
    recordingUrl: recording,
    answeredAt: status === "in_progress" ? (parseDate(b.StartTime) ?? updated ?? new Date()) : null,
    endedAt: terminal ? (updated ?? new Date()) : null,
    raw: Object.fromEntries(Object.entries(b).filter(([k]) => !/token|key|auth/i.test(k)).slice(0, 40)),
  };
}

/** Recording URLs we are willing to fetch (SSRF guard): https on Exotel / S3 hosts only. */
export function isAllowedRecordingUrl(url: string): { ok: boolean; sendAuth: boolean } {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return { ok: false, sendAuth: false };
    const h = u.hostname.toLowerCase();
    const exotel = /(^|\.)exotel\.(com|in)$/.test(h);
    const s3 = /(^|\.)amazonaws\.com$/.test(h);
    return { ok: exotel || s3, sendAuth: exotel };
  } catch {
    return { ok: false, sendAuth: false };
  }
}

export function createExotelProvider(fetchImpl?: FetchLike): TelephonyProvider {
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init) as any);

  async function request(url: string, init: any): Promise<{ status: number; body: any; text: string }> {
    let res;
    try {
      res = await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err: any) {
      throw new ProviderError("Could not reach Exotel (network problem or timeout). The call will be tried again.", false, null);
    }
    const text = await res.text();
    return { status: res.status, body: parseJson(text), text };
  }

  return {
    id: "exotel",

    async verify(creds) {
      const e = exo(creds);
      const { status, body, text } = await request(`${apiBase(e.subdomain, e.accountSid)}/Calls.json?PageSize=1`, {
        method: "GET",
        headers: { authorization: authHeader(e.apiKey, e.apiToken), accept: "application/json" },
      });
      if (status < 200 || status >= 300) throw explainExotelError(status, errorMessageOf(body, text));
      return { ok: true, detail: `Connected to Exotel account ${e.accountSid}. Calls will show ${e.callerId} as the caller.` };
    },

    async placeCall(creds, input: PlaceCallInput): Promise<PlaceCallResult> {
      const e = exo(creds);
      const form = new URLSearchParams();
      form.set("From", input.to);
      form.set("CallerId", e.callerId);
      if (e.flowAppId) {
        form.set("Url", `http://my.exotel.com/${encodeURIComponent(e.accountSid)}/exoml/start_voice/${encodeURIComponent(e.flowAppId)}`);
      } else {
        if (!input.streamUrl) throw new ProviderError("The call audio address is missing (public address of the portal unknown).", true);
        form.set("StreamUrl", input.streamUrl);
        form.set("StreamType", "bidirectional");
      }
      form.set("CustomField", `aicall:${input.callId}`.slice(0, 128));
      if (input.record) {
        form.set("Record", "true");
        form.set("RecordingChannels", "dual");
      }
      form.set("TimeLimit", String(Math.max(30, Math.round(input.timeLimitSec))));
      form.set("TimeOut", String(Math.max(10, Math.round(input.ringTimeoutSec ?? DEFAULT_RING_SEC))));
      if (input.statusCallbackUrl) {
        form.set("StatusCallback", input.statusCallbackUrl);
        form.set("StatusCallbackContentType", "application/json");
        form.append("StatusCallbackEvents[0]", "terminal");
        form.append("StatusCallbackEvents[1]", "answered");
      }
      const { status, body, text } = await request(`${apiBase(e.subdomain, e.accountSid)}/Calls/connect.json`, {
        method: "POST",
        headers: {
          authorization: authHeader(e.apiKey, e.apiToken),
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: form.toString(),
      });
      if (status < 200 || status >= 300) throw explainExotelError(status, errorMessageOf(body, text));
      const call = body?.Call ?? body?.call;
      const sid = call?.Sid ?? call?.sid;
      if (!sid) throw new ProviderError("Exotel accepted the request but did not return a call id.", false, status);
      const mapped = mapExotelStatus(call?.Status);
      return { providerCallSid: String(sid), status: mapped === "ringing" || mapped === "in_progress" ? mapped : "dialing" };
    },

    // Exotel ends a Voice AI call when our media stream closes (A closes the socket); there is
    // no separate hang-up API for Calls/connect, so this is intentionally a no-op.
    async hangup() { /* closing the media WebSocket ends the call */ },

    parseStatusWebhook: parseExotelStatusWebhook,

    async fetchRecording(creds, recordingUrl) {
      const allowed = isAllowedRecordingUrl(recordingUrl);
      if (!allowed.ok) throw new ProviderError("This recording address is not allowed.", true);
      const headers: Record<string, string> = {};
      if (allowed.sendAuth) {
        const e = exo(creds);
        headers.authorization = authHeader(e.apiKey, e.apiToken);
      }
      let res;
      try {
        res = await doFetch(recordingUrl, { method: "GET", headers, signal: AbortSignal.timeout(30_000) });
      } catch {
        throw new ProviderError("Could not download the recording from Exotel.", false);
      }
      if (!res.ok) throw new ProviderError(res.status === 404 ? "The recording is not available (yet)." : "Exotel did not return the recording.", res.status === 404, res.status);
      const contentType = res.headers.get("content-type") || "audio/mpeg";
      return { contentType, body: Buffer.from(await res.arrayBuffer()) };
    },
  };
}

export const exotelProvider = createExotelProvider();
