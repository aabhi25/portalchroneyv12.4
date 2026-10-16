/**
 * AI Calling — media WebSocket endpoints (HTTP upgrade), wired into the server's single
 * `upgrade` handler in routes.ts.
 *
 *   /api/calling/stream/<token>         Exotel outbound stream — signed call token, no session.
 *   /api/calling/inbound/<inboundKey>   Exotel inbound stream — the business's secret inbound key.
 *   /api/calling/simulate/<callId>      Portal simulator for a ringing simulator call (session cookie).
 *   /api/calling/simulate-inbound       Portal simulator for an inbound call (session cookie; ?from=).
 *   /api/calling/plivo/stream/<token>          Plivo outbound stream — signed call token.
 *   /api/calling/plivo/inbound-stream/<token>  Plivo inbound stream — signed token from the inbound answer URL.
 *
 * All of them run the same handler (mediaStream.ts) in the Exotel AgentStream protocol; Plivo
 * sockets are wrapped in PlivoStreamSocket, which translates Plivo's stream protocol.
 * Anything that fails a check is refused at the HTTP level (no WebSocket is opened).
 */
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import type { WebSocketServer } from "ws";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { validateSession } from "../auth";
import { aiCalls } from "@shared/schema";
import { isAiCallingEnabled } from "./aiCallingGate";
import { getSettingsByInboundKey } from "../services/calling/settingsService";
import { normalizeCallPhone, TERMINAL_CALL_STATUSES, type CallStatus } from "@shared/aiCalling";
import { verifyCallToken, verifyPlivoInboundStreamToken, STREAM_SAMPLE_RATE } from "../services/calling/streamToken";
import { PlivoStreamSocket, type PlivoStreamMeta } from "../services/calling/providers/plivoStream";
import { parseSampleRate } from "../services/calling/audio";
import { CallMediaSession, loadCallStreamDeps, type CallStreamInit } from "../services/calling/mediaStream";

const LOG = "[Calling]";
const PREFIX = "/api/calling/";

function reject(socket: Duplex, status: number, text: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    // socket already gone
  }
  socket.destroy();
}

function sessionCookie(header?: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === "session") return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const aiCallingAllowed = isAiCallingEnabled;

/** Signed-in portal user and the business they're working in (null = not signed in). */
async function portalUser(request: IncomingMessage): Promise<{ id: string; role: string; businessAccountId: string | null } | null> {
  const token = sessionCookie(request.headers.cookie);
  if (!token) return null;
  const user = await validateSession(token);
  if (!user) return null;
  return { id: user.id, role: user.role, businessAccountId: (user as any).activeBusinessAccountId || user.businessAccountId || null };
}

/**
 * Handles `/api/calling/...` upgrades. Returns false when the path is not ours (the caller
 * then leaves the socket alone), true when it was handled (accepted or refused).
 */
export async function handleCallingUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, wss: WebSocketServer): Promise<boolean> {
  const url = new URL(request.url || "", "http://localhost");
  if (!url.pathname.startsWith(PREFIX)) return false;
  const rest = url.pathname.slice(PREFIX.length).replace(/\/+$/, "");
  const [kind, param, extra] = rest.split("/");
  const urlSampleRate = parseSampleRate(url.searchParams.get("sample-rate"), STREAM_SAMPLE_RATE);

  let init: CallStreamInit | null = null;
  let plivoMeta: PlivoStreamMeta | null = null;
  try {
    if (kind === "plivo" && param === "stream" && extra) {
      const callId = verifyCallToken(extra, "stream");
      if (!callId) return reject(socket, 401, "Unauthorized"), true;
      const [call] = await db.select().from(aiCalls).where(eq(aiCalls.id, callId)).limit(1);
      if (!call || call.provider !== "plivo" || TERMINAL_CALL_STATUSES.includes(call.status as CallStatus)) return reject(socket, 410, "Gone"), true;
      if (!(await aiCallingAllowed(call.businessAccountId))) return reject(socket, 403, "Forbidden"), true;
      const meta = (call.metadata || {}) as Record<string, unknown>;
      plivoMeta = { callUuid: typeof meta.plivoCallUuid === "string" ? meta.plivoCallUuid : null };
      init = { kind: "plivo_outbound", businessAccountId: call.businessAccountId, callId: call.id, urlSampleRate: 8000 };
    } else if (kind === "plivo" && param === "inbound-stream" && extra) {
      const data = verifyPlivoInboundStreamToken(extra);
      if (!data) return reject(socket, 401, "Unauthorized"), true;
      const { getCallingSettings } = await import("../services/calling/settingsService");
      const settings = await getCallingSettings(data.businessAccountId);
      if (!settings.exists || !settings.enabled || settings.provider !== "plivo" || !(await aiCallingAllowed(data.businessAccountId))) {
        return reject(socket, 403, "Forbidden"), true;
      }
      plivoMeta = { callUuid: data.callUuid, from: data.from, to: data.to };
      init = { kind: "plivo_inbound", businessAccountId: data.businessAccountId, urlSampleRate: 8000 };
    } else if (kind === "stream" && param && !extra) {
      const callId = verifyCallToken(param, "stream");
      if (!callId) return reject(socket, 401, "Unauthorized"), true;
      const [call] = await db.select().from(aiCalls).where(eq(aiCalls.id, callId)).limit(1);
      if (!call || TERMINAL_CALL_STATUSES.includes(call.status as CallStatus)) return reject(socket, 410, "Gone"), true;
      if (!(await aiCallingAllowed(call.businessAccountId))) return reject(socket, 403, "Forbidden"), true;
      init = { kind: "exotel_outbound", businessAccountId: call.businessAccountId, callId: call.id, urlSampleRate };
    } else if (kind === "inbound" && param && !extra) {
      if (param.length < 16 || param.length > 64) return reject(socket, 404, "Not Found"), true;
      const settings = await getSettingsByInboundKey(param);
      if (!settings) return reject(socket, 404, "Not Found"), true;
      if (!settings.enabled || !(await aiCallingAllowed(settings.businessAccountId))) return reject(socket, 403, "Forbidden"), true;
      // Monthly minutes used up → refuse; the Exotel flow moves on to its next applet (e.g. the business's own line).
      {
        const { effectiveMinuteLimit, minutesThisMonth } = await import("../services/calling/settingsService");
        const { limit } = await effectiveMinuteLimit(settings);
        if (limit !== null && (await minutesThisMonth(settings.businessAccountId)) >= limit) {
          console.warn(`[Calling] Inbound call refused: monthly minutes used up (business ${settings.businessAccountId})`);
          return reject(socket, 403, "Forbidden"), true;
        }
      }
      init = { kind: "exotel_inbound", businessAccountId: settings.businessAccountId, urlSampleRate };
    } else if (kind === "simulate" && param && !extra) {
      const user = await portalUser(request);
      if (!user) return reject(socket, 401, "Unauthorized"), true;
      const [call] = await db.select().from(aiCalls).where(eq(aiCalls.id, param)).limit(1);
      if (!call || (user.role !== "super_admin" && call.businessAccountId !== user.businessAccountId)) return reject(socket, 404, "Not Found"), true;
      if (call.provider !== "simulator" || !["ringing", "dialing"].includes(call.status)) return reject(socket, 409, "Conflict"), true;
      if (!(await aiCallingAllowed(call.businessAccountId))) return reject(socket, 403, "Forbidden"), true;
      init = { kind: "simulator_outbound", businessAccountId: call.businessAccountId, callId: call.id, urlSampleRate, userId: user.id };
    } else if (kind === "simulate-inbound" && !param) {
      const user = await portalUser(request);
      if (!user) return reject(socket, 401, "Unauthorized"), true;
      if (!user.businessAccountId) return reject(socket, 400, "Bad Request"), true;
      if (!(await aiCallingAllowed(user.businessAccountId))) return reject(socket, 403, "Forbidden"), true;
      const from = normalizeCallPhone(url.searchParams.get("from") || "") ?? "+910000000000";
      init = { kind: "simulator_inbound", businessAccountId: user.businessAccountId, urlSampleRate, simulatorFrom: from, userId: user.id };
    } else {
      return reject(socket, 404, "Not Found"), true;
    }
  } catch (err) {
    console.error(`${LOG} upgrade check failed:`, err instanceof Error ? err.message : err);
    return reject(socket, 500, "Internal Server Error"), true;
  }

  const accepted = init;
  // Loaded before the upgrade so the session listens from the very first frame.
  const deps = await loadCallStreamDeps();
  const meta = plivoMeta;
  wss.handleUpgrade(request, socket, head, (ws) => {
    new CallMediaSession(meta ? new PlivoStreamSocket(ws as any, meta) : (ws as any), accepted, deps);
  });
  return true;
}
