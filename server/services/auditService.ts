import crypto from "crypto";
import type { Request } from "express";
import { db } from "../db";
import { auditEvents } from "@shared/schema";

type AuditOutcome = "success" | "failure" | "denied";

interface AuditEventInput {
  action: string;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  actorUsername?: string | null;
  actorRole?: string | null;
  businessAccountId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

const BLOCKED_METADATA_KEYS = /password|secret|token|cookie|authorization|phone|email|message|leadData/i;

function sanitizeMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (BLOCKED_METADATA_KEYS.test(key) || value === undefined) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 500);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) safe[key] = value;
    else if (Array.isArray(value)) safe[key] = value.slice(0, 50).map(item => String(item).slice(0, 100));
  }
  return safe;
}

function sessionFingerprint(sessionToken?: string): string | null {
  if (!sessionToken) return null;
  return crypto.createHash("sha256").update(sessionToken).digest("hex");
}

export function getRequestId(req: Request): string {
  const existing = req.headers["x-request-id"];
  return (Array.isArray(existing) ? existing[0] : existing)?.slice(0, 255) || crypto.randomUUID();
}

export async function recordAuditEvent(req: Request, input: AuditEventInput): Promise<string> {
  const user = req.user;
  const [event] = await db.insert(auditEvents).values({
    actorUserId: input.actorUserId ?? user?.id ?? null,
    actorUsername: input.actorUsername ?? user?.username ?? null,
    actorRole: input.actorRole ?? user?.role ?? null,
    businessAccountId: input.businessAccountId ?? user?.businessAccountId ?? null,
    sessionFingerprint: sessionFingerprint(req.sessionToken || req.cookies?.session),
    action: input.action,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome,
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get("user-agent")?.slice(0, 1000) || null,
    requestId: getRequestId(req),
    metadata: sanitizeMetadata(input.metadata),
  }).returning({ id: auditEvents.id });
  return event.id;
}

export async function recordAuditEventSafely(req: Request, input: AuditEventInput): Promise<void> {
  try {
    await recordAuditEvent(req, input);
  } catch (error) {
    console.error("[Audit] Failed to persist audit event", input.action, error);
  }
}