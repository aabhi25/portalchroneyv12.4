/**
 * AI Calling — provider status webhooks (no session; the signed token in the path identifies the call).
 *
 *   POST /api/calling/webhooks/:provider/status/:token     (form-encoded or JSON)
 *
 * Token = signCallToken(callId, "status") (see streamToken.ts); a bad / expired token → 403.
 * The update only moves a call forward (dialing → ringing → in_progress → terminal). A terminal update
 * on a call that already ended (e.g. the media stream closed first) only fills in the recording URL /
 * duration. Terminal → processFinishedCall (idempotent), so repeated webhooks are harmless.
 */
import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { aiCalls } from "@shared/schema";
import { LIVE_CALL_STATUSES, TERMINAL_CALL_STATUSES, type CallStatus } from "@shared/aiCalling";
import { verifyCallToken } from "../services/calling/streamToken";
import { getCallingProvider } from "../services/calling/providers";

const router = Router();

const RANK: Record<string, number> = { queued: 0, dialing: 1, ringing: 2, in_progress: 3 };

router.post("/api/calling/webhooks/:provider/status/:token", async (req, res) => {
  try {
    const providerId = req.params.provider;
    if (providerId !== "exotel") return res.status(404).json({ error: "Unknown provider" });
    const callId = verifyCallToken(req.params.token, "status");
    if (!callId) return res.status(403).json({ error: "Invalid or expired link" });
    const [call] = await db.select().from(aiCalls).where(eq(aiCalls.id, callId)).limit(1);
    if (!call || call.provider !== providerId) return res.status(404).json({ error: "Call not found" });

    const provider = getCallingProvider(providerId);
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const update = provider.parseStatusWebhook?.(body) ?? null;
    if (!update) return res.json({ ok: true, ignored: true });
    if (call.providerCallSid && update.providerCallSid !== call.providerCallSid) {
      return res.json({ ok: true, ignored: true, reason: "different call" });
    }

    const now = new Date();
    const isTerminal = (TERMINAL_CALL_STATUSES as string[]).includes(update.status);
    const alreadyEnded = (TERMINAL_CALL_STATUSES as string[]).includes(call.status);
    const patch: Record<string, unknown> = { updatedAt: now };
    if (!call.providerCallSid) patch.providerCallSid = update.providerCallSid;
    if (update.recordingUrl && !call.recordingUrl) patch.recordingUrl = update.recordingUrl;
    const meta = { ...(call.metadata || {}), providerStatus: update.status, ...(update.durationSec != null ? { providerDurationSec: update.durationSec } : {}) };
    patch.metadata = meta;

    let finished = false;
    if (alreadyEnded) {
      if (update.durationSec != null && call.durationSec == null && call.answeredAt) patch.durationSec = update.durationSec;
      await db.update(aiCalls).set(patch).where(eq(aiCalls.id, call.id));
    } else if (!isTerminal) {
      const forward = (RANK[update.status] ?? 0) > (RANK[call.status] ?? 0);
      if (forward) {
        patch.status = update.status;
        if (update.status === "in_progress" && !call.answeredAt) patch.answeredAt = update.answeredAt ?? now;
      }
      await db.update(aiCalls).set(patch)
        .where(and(eq(aiCalls.id, call.id), inArray(aiCalls.status, ["queued", ...LIVE_CALL_STATUSES])));
    } else {
      const endedAt = update.endedAt ?? now;
      patch.status = update.status as CallStatus;
      patch.endedAt = call.endedAt ?? endedAt;
      patch.endReason = call.endReason ?? (update.status === "completed" ? "call_ended" : update.status);
      if (update.durationSec != null && call.durationSec == null) patch.durationSec = update.durationSec;
      if (update.status === "completed" && !call.answeredAt) {
        const dur = update.durationSec ?? 0;
        patch.answeredAt = new Date(new Date(patch.endedAt as Date).getTime() - dur * 1000);
      }
      const rows = await db.update(aiCalls).set(patch)
        .where(and(eq(aiCalls.id, call.id), inArray(aiCalls.status, ["queued", ...LIVE_CALL_STATUSES])))
        .returning({ id: aiCalls.id });
      finished = rows.length > 0;
    }
    if (finished || alreadyEnded) {
      const { processFinishedCall } = await import("../services/calling/callLifecycle");
      await processFinishedCall(call.id);
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Calling] status webhook failed:", err?.message || err);
    res.status(500).json({ error: "Could not process the status update" });
  }
});

export default router;
