/**
 * AI Calling — media WebSocket endpoints (HTTP upgrade), wired into the server's single
 * `upgrade` handler in routes.ts.
 *
 *   /api/calling/stream/<token>         Exotel outbound stream — signed call token, no session.
 *   /api/calling/inbound/<inboundKey>   Exotel inbound stream — the business's secret inbound key.
 *   /api/calling/simulate/<callId>      Portal simulator for a ringing simulator call (session cookie).
 *   /api/calling/simulate-inbound       Portal simulator for an inbound call (session cookie; ?from=).
 *
 * All four speak the Exotel AgentStream protocol and run the same handler (mediaStream.ts).
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
import { verifyCallToken, STREAM_SAMPLE_RATE } from "../services/calling/streamToken";
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
  try {
    if (kind === "stream" && param && !extra) {
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
  wss.handleUpgrade(request, socket, head, (ws) => {
    new CallMediaSession(ws as any, accepted, deps);
  });
  return true;
}
