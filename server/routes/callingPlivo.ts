/**
 * AI Calling — Plivo call instructions (no session; Plivo fetches these and runs the returned XML).
 *
 *   POST|GET /api/calling/plivo/answer/:token        outbound call answered → Stream XML (signed call token)
 *   POST|GET /api/calling/plivo/inbound/:inboundKey  incoming call (the Plivo Application's Answer URL) → Stream XML
 *   POST|GET /api/calling/plivo/transfer/:token      transfer of a live call → Dial XML to the business's team number
 *
 * Every request is also checked against X-Plivo-Signature-V3 with the business's Auth Token:
 * a mismatch is logged, and refused when PLIVO_SIGNATURE_ENFORCE=1 (the signed URLs above already
 * identify the call / business).
 *
 * The media WebSockets (/api/calling/plivo/stream/…, /api/calling/plivo/inbound-stream/…) are in
 * callingMedia.ts. Status webhooks (ring / hangup) go to callingWebhooks.ts.
 */
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { aiCalls, type AiCallingSettingsRow } from "@shared/schema";
import { TERMINAL_CALL_STATUSES, type CallStatus } from "@shared/aiCalling";
import { isAiCallingEnabled } from "./aiCallingGate";
import {
  buildPlivoInboundStreamUrl,
  buildPlivoStreamUrl,
  resolvePublicBaseUrl,
  verifyCallToken,
} from "../services/calling/streamToken";
import { effectiveMinuteLimit, getCallingSettings, getSettingsByInboundKey, minutesThisMonth } from "../services/calling/settingsService";
import { openSecret } from "../services/calling/credentials";
import {
  plivoDialXml,
  plivoHangupXml,
  plivoRefuseXml,
  plivoStreamXml,
  verifyPlivoSignatureV3,
} from "../services/calling/providers/plivo";

const router = Router();
const LOG = "[Calling]";

const NOT_TAKING_CALLS = "Sorry, this line is not taking calls right now. Please try again later.";

function sendXml(res: Response, xml: string, status = 200): void {
  res.status(status).type("application/xml").send(xml);
}

function params(req: Request): Record<string, unknown> {
  const src = req.method === "GET" ? req.query : req.body;
  return src && typeof src === "object" ? (src as Record<string, unknown>) : {};
}

function str(v: unknown, max = 64): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  const s = typeof x === "string" ? x.trim() : "";
  return s ? s.slice(0, max) : null;
}

/** https base this request reached us on (Plivo always uses the URL we gave it). */
function requestBase(req: Request): string | null {
  const host = req.get("x-forwarded-host") || req.get("host");
  return host ? `https://${host.split(",")[0].trim()}` : null;
}

/**
 * X-Plivo-Signature-V3 check with the business's Auth Token. Returns false only when the request
 * must be refused (PLIVO_SIGNATURE_ENFORCE=1 and no match).
 */
export function plivoSignatureOk(req: Request, settings: Pick<AiCallingSettingsRow, "plivoAuthToken" | "publicBaseUrl" | "businessAccountId">): boolean {
  const authToken = openSecret(settings.plivoAuthToken);
  const enforce = process.env.PLIVO_SIGNATURE_ENFORCE === "1";
  if (!authToken) {
    if (enforce) console.warn(`${LOG} Plivo request for business ${settings.businessAccountId} refused: no Plivo Auth Token saved`);
    return !enforce;
  }
  const path = req.originalUrl;
  const host = req.get("host");
  const urls = [
    resolvePublicBaseUrl(settings.publicBaseUrl) ? `${resolvePublicBaseUrl(settings.publicBaseUrl)}${path}` : "",
    requestBase(req) ? `${requestBase(req)}${path}` : "",
    host ? `${req.protocol}://${host}${path}` : "",
  ];
  const ok = verifyPlivoSignatureV3({
    authToken,
    method: req.method,
    urls,
    nonce: req.get("x-plivo-signature-v3-nonce") || undefined,
    signature: req.get("x-plivo-signature-v3") || undefined,
    params: req.method === "POST" ? params(req) : {},
  });
  if (!ok) console.warn(`${LOG} Plivo signature did not match for ${req.method} ${req.path.replace(/\/[^/]{16,}$/, "/…")} (business ${settings.businessAccountId})${enforce ? " — refused" : ""}`);
  return ok || !enforce;
}

// ── outbound: the customer answered ──────────────────────────────────────────

router.all("/api/calling/plivo/answer/:token", async (req, res) => {
  try {
    const callId = verifyCallToken(req.params.token, "answer");
    if (!callId) return sendXml(res, plivoHangupXml(), 403);
    const [call] = await db.select().from(aiCalls).where(eq(aiCalls.id, callId)).limit(1);
    if (!call || call.provider !== "plivo" || TERMINAL_CALL_STATUSES.includes(call.status as CallStatus)) return sendXml(res, plivoHangupXml());
    const settings = await getCallingSettings(call.businessAccountId);
    if (!plivoSignatureOk(req, settings)) return sendXml(res, plivoHangupXml(), 403);
    if (!(await isAiCallingEnabled(call.businessAccountId))) return sendXml(res, plivoHangupXml());
    const base = resolvePublicBaseUrl(settings.publicBaseUrl) ?? requestBase(req);
    if (!base) return sendXml(res, plivoHangupXml());
    const p = params(req);
    const callUuid = str(p.CallUUID);
    if (callUuid) {
      await db.update(aiCalls).set({ metadata: { ...(call.metadata || {}), plivoCallUuid: callUuid }, updatedAt: new Date() }).where(eq(aiCalls.id, call.id));
    }
    sendXml(res, plivoStreamXml({ streamUrl: buildPlivoStreamUrl(base, call.id), timeLimitSec: settings.maxCallMinutes * 60 }));
  } catch (err) {
    console.error(`${LOG} Plivo answer failed:`, err instanceof Error ? err.message : err);
    sendXml(res, plivoHangupXml(), 500);
  }
});

// ── inbound: someone called the business's Plivo number ──────────────────────

router.all("/api/calling/plivo/inbound/:inboundKey", async (req, res) => {
  try {
    const key = req.params.inboundKey;
    if (!key || key.length < 16 || key.length > 64) return sendXml(res, plivoHangupXml(), 404);
    const settings = await getSettingsByInboundKey(key);
    if (!settings) return sendXml(res, plivoHangupXml(), 404);
    if (!plivoSignatureOk(req, settings)) return sendXml(res, plivoHangupXml(), 403);
    if (!settings.enabled || settings.provider !== "plivo" || !(await isAiCallingEnabled(settings.businessAccountId))) {
      return sendXml(res, plivoRefuseXml(NOT_TAKING_CALLS));
    }
    const { limit } = await effectiveMinuteLimit(settings);
    if (limit !== null && (await minutesThisMonth(settings.businessAccountId)) >= limit) {
      console.warn(`${LOG} Inbound Plivo call not answered by the AI: monthly minutes used up (business ${settings.businessAccountId})`);
      return sendXml(res, settings.transferNumber
        ? plivoDialXml({ number: settings.transferNumber, callerId: settings.plivoNumber })
        : plivoRefuseXml(NOT_TAKING_CALLS));
    }
    const base = resolvePublicBaseUrl(settings.publicBaseUrl) ?? requestBase(req);
    if (!base) return sendXml(res, plivoRefuseXml(NOT_TAKING_CALLS));
    const p = params(req);
    const streamUrl = buildPlivoInboundStreamUrl(base, {
      businessAccountId: settings.businessAccountId,
      callUuid: str(p.CallUUID),
      from: str(p.From, 32),
      to: str(p.To, 32),
    });
    sendXml(res, plivoStreamXml({ streamUrl, timeLimitSec: settings.maxCallMinutes * 60 }));
  } catch (err) {
    console.error(`${LOG} Plivo inbound answer failed:`, err instanceof Error ? err.message : err);
    sendXml(res, plivoRefuseXml(NOT_TAKING_CALLS), 500);
  }
});

// ── transfer: hand the caller to the business's team ─────────────────────────

router.all("/api/calling/plivo/transfer/:token", async (req, res) => {
  try {
    const callId = verifyCallToken(req.params.token, "transfer");
    if (!callId) return sendXml(res, plivoHangupXml(), 403);
    const [call] = await db.select().from(aiCalls).where(eq(aiCalls.id, callId)).limit(1);
    if (!call || call.provider !== "plivo") return sendXml(res, plivoHangupXml(), 404);
    const settings = await getCallingSettings(call.businessAccountId);
    if (!plivoSignatureOk(req, settings)) return sendXml(res, plivoHangupXml(), 403);
    if (!settings.transferNumber) return sendXml(res, plivoHangupXml());
    sendXml(res, plivoDialXml({ number: settings.transferNumber, callerId: settings.plivoNumber }));
  } catch (err) {
    console.error(`${LOG} Plivo transfer instructions failed:`, err instanceof Error ? err.message : err);
    sendXml(res, plivoHangupXml(), 500);
  }
});

export default router;
