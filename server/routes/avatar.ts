import express, { Router, type Request, type Response } from "express";
import { existsSync } from "fs";
import path from "path";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth";
import { storage } from "../storage";
import { resolveAuthorizedLeadAccountId } from "../lib/leadAccess";
import { recordAuditEventSafely } from "../services/auditService";
import {
  deletePlatformKey,
  describePlatformKey,
  getPlatformKey,
  getRates,
  keyAvailability,
  normalizeApiKey,
  setPlatformKey,
  setRates,
} from "../services/avatar/credentials";
import {
  AVATAR_LIMITS,
  AvatarSettingsError,
  assertKeyProvider,
  describeBusinessKeys,
  getBusinessApiKey,
  getEffectiveSettings,
  getPublicAvatarConfig,
  isChildrensAccount,
  isProviderSelectable,
  providerLabel,
  removeBusinessApiKey,
  selectableProviders,
  setBusinessApiKey,
  updateAvatarSettings,
} from "../services/avatar/settingsService";
import { avatarSessionManager, AvatarGateError, VISITOR_FALLBACK_MESSAGES } from "../services/avatar/sessionManager";
import { getAvatarProvider } from "../services/avatar/registry";
import { isFakeProviderAllowed } from "../services/avatar/providers/fake";
import { AvatarProviderError, CLIENT_END_REASONS, type AvatarEndReason, type AvatarProviderId } from "../services/avatar/types";

/**
 * Live AI avatar API.
 *
 * Super admin only (business users get 403):
 *   GET    /api/super-admin/avatar/platform                         platform keys (masked) + cost rates
 *   PUT    /api/super-admin/avatar/platform/keys/:provider          set platform key           (audited)
 *   DELETE /api/super-admin/avatar/platform/keys/:provider          remove platform key        (audited)
 *   POST   /api/super-admin/avatar/platform/keys/:provider/test     validate platform key
 *   PUT    /api/super-admin/avatar/platform/rates                   USD/min cost estimates     (audited)
 *   GET    /api/super-admin/avatar/accounts/:id                     account settings + key status + usage
 *   PUT    /api/super-admin/avatar/accounts/:id                     update settings            (audited)
 *   PUT    /api/super-admin/avatar/accounts/:id/keys/:provider      set the business's own key (audited)
 *   DELETE /api/super-admin/avatar/accounts/:id/keys/:provider      remove it                  (audited)
 *   POST   /api/super-admin/avatar/accounts/:id/keys/:provider/test validate (typed or stored) key
 * Business users (read-only):
 *   GET    /api/avatar/status                                       enabled / key set / minutes used
 * Widget (public, CORS like other /api/chat/widget routes, rate-limited):
 *   GET    /api/chat/widget/avatar/config?businessAccountId=
 *   POST   /api/chat/widget/avatar/session                          start (visitor tapped the button)
 *   POST   /api/chat/widget/avatar/session/:id/connected            first video frame
 *   POST   /api/chat/widget/avatar/session/:id/heartbeat
 *   POST   /api/chat/widget/avatar/session/:id/end
 * Raw API keys are never returned by any endpoint.
 */
const router = Router();

// The widget loads these browser SDKs only when a visitor taps the avatar. If a checkout
// skipped `npm install` after they were added, every call fails to connect — say so loudly.
for (const sdk of ["livekit-client", "@anam-ai/js-sdk"]) {
  if (!existsSync(path.resolve(process.cwd(), "node_modules", sdk, "package.json"))) {
    console.warn(`[Avatar] ${sdk} is not installed — Live AI avatar calls will fail to connect. Run npm install and restart.`);
  }
}

// ── small in-memory rate limiter (single-instance deployment) ────────────────
const buckets = new Map<string, number[]>();
export function rateLimitHit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 20_000) {
    for (const [k, v] of Array.from(buckets.entries())) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return false;
}
export function resetAvatarRateLimitsForTesting(): void {
  buckets.clear();
}

function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").slice(0, 64);
}

function sendSettingsError(res: Response, error: unknown, fallback: string) {
  if (error instanceof AvatarSettingsError) return res.status(error.status).json({ error: error.message });
  console.error(`[Avatar] ${fallback}:`, (error as Error)?.message || error);
  return res.status(500).json({ error: fallback });
}

function providerParam(req: Request, res: Response): AvatarProviderId | null {
  const provider = String(req.params.provider || "");
  if (!isProviderSelectable(provider)) {
    res.status(400).json({ error: `Unknown provider '${provider}'` });
    return null;
  }
  return provider;
}

async function runKeyTest(provider: AvatarProviderId, apiKey: string): Promise<{ ok: boolean; detail?: string; error?: string; code?: string }> {
  try {
    const result = await getAvatarProvider(provider).validateKey(apiKey);
    return { ok: true, detail: result.detail };
  } catch (error) {
    if (error instanceof AvatarProviderError) {
      const message = error.code === "auth"
        ? provider === "heygen_liveavatar"
          ? "LiveAvatar rejected this key. Use the API key from app.liveavatar.com/developers (a HeyGen key from app.heygen.com will not work)."
          : provider === "anam"
            ? "Anam rejected this key. Use the API key from lab.anam.ai (API keys page)."
            : "The provider rejected this key"
        : `Could not verify the key (${error.code})`;
      return { ok: false, code: error.code, error: message };
    }
    return { ok: false, code: "unknown", error: "Could not verify the key" };
  }
}

// ── super admin: platform ────────────────────────────────────────────────────

router.get("/api/super-admin/avatar/platform", requireAuth, requireRole("super_admin"), async (_req, res) => {
  try {
    const providers = await Promise.all(selectableProviders().map(async (id) => ({
      id,
      label: providerLabel(id),
      ...(await describePlatformKey(id)),
    })));
    res.json({ providers, rates: await getRates(), fakeAvailable: isFakeProviderAllowed() });
  } catch (error) {
    sendSettingsError(res, error, "Failed to load avatar platform settings");
  }
});

router.put("/api/super-admin/avatar/platform/keys/:provider", requireAuth, requireRole("super_admin"), async (req, res) => {
  const provider = providerParam(req, res);
  if (!provider) return;
  const key = normalizeApiKey(req.body?.apiKey);
  if (!key) return res.status(400).json({ error: "API key must be 8–512 characters with no spaces" });
  const existed = !!(await getPlatformKey(provider).catch(() => null));
  const ok = await setPlatformKey(provider, key);
  if (!ok) return res.status(500).json({ error: "Failed to save key" });
  await recordAuditEventSafely(req, {
    action: "avatar.platform_key_set",
    outcome: "success",
    resourceType: "avatar_platform_key",
    resourceId: provider,
    metadata: { provider, replaced: existed },
  });
  res.json(await describePlatformKey(provider));
});

router.delete("/api/super-admin/avatar/platform/keys/:provider", requireAuth, requireRole("super_admin"), async (req, res) => {
  const provider = providerParam(req, res);
  if (!provider) return;
  await deletePlatformKey(provider);
  await recordAuditEventSafely(req, {
    action: "avatar.platform_key_removed",
    outcome: "success",
    resourceType: "avatar_platform_key",
    resourceId: provider,
    metadata: { provider },
  });
  res.json(await describePlatformKey(provider));
});

router.post("/api/super-admin/avatar/platform/keys/:provider/test", requireAuth, requireRole("super_admin"), async (req, res) => {
  const provider = providerParam(req, res);
  if (!provider) return;
  const typed = req.body?.apiKey !== undefined ? normalizeApiKey(req.body.apiKey) : null;
  if (req.body?.apiKey !== undefined && !typed) return res.status(400).json({ error: "API key must be 8–512 characters with no spaces" });
  const key = typed || (await getPlatformKey(provider))?.key;
  if (!key) return res.status(400).json({ ok: false, error: `No platform key for ${providerLabel(provider)}` });
  const result = await runKeyTest(provider, key);
  await recordAuditEventSafely(req, {
    action: "avatar.platform_key_tested",
    outcome: result.ok ? "success" : "failure",
    resourceType: "avatar_platform_key",
    resourceId: provider,
    metadata: { provider, typed: !!typed, resultCode: result.code ?? "ok" },
  });
  res.json(result);
});

const ratesBody = z.object({
  heygen_liveavatar: z.coerce.number().finite().min(0).max(100).optional(),
  anam: z.coerce.number().finite().min(0).max(100).optional(),
}).strict();

router.put("/api/super-admin/avatar/platform/rates", requireAuth, requireRole("super_admin"), async (req, res) => {
  const parsed = ratesBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Rates must be numbers between 0 and 100 (USD per minute)" });
  try {
    const before = await getRates();
    const after = await setRates(parsed.data);
    await recordAuditEventSafely(req, {
      action: "avatar.rates_updated",
      outcome: "success",
      resourceType: "avatar_rates",
      metadata: { previousHeygen: before.heygen_liveavatar, previousAnam: before.anam, newHeygen: after.heygen_liveavatar, newAnam: after.anam },
    });
    res.json({ rates: after });
  } catch (error) {
    sendSettingsError(res, error, "Failed to save rates");
  }
});

// ── super admin: per business ────────────────────────────────────────────────

async function adminView(businessAccountId: string) {
  const account = await storage.getBusinessAccount(businessAccountId);
  if (!account) return null;
  const settings = await getEffectiveSettings(businessAccountId, account);
  const providers = selectableProviders();
  const platform = Object.fromEntries(await Promise.all(providers.map(async (id) => [id, (await describePlatformKey(id)).configured] as const)));
  const keySource = isProviderSelectable(settings.provider) ? await keyAvailability(settings.provider, settings) : null;
  const usage = await avatarSessionManager.monthUsage(businessAccountId);
  const children = isChildrensAccount(account);
  const warnings: string[] = [];
  if (!keySource) warnings.push(`No API key for ${providerLabel(settings.provider)}`);
  if (settings.provider !== "fake" && !settings.avatarId) warnings.push("No avatar id set");
  if (children && !settings.parentalConsentConfirmed) warnings.push("Parental consent not confirmed (children's education account)");
  if (account.voiceModeEnabled !== "true") warnings.push("Voice mode is off for this account — the avatar needs voice mode");
  if (usage.seconds >= settings.monthlyMinuteCap * 60) warnings.push("Monthly avatar minutes are used up");
  const { apiKeys, exists: _exists, ...rest } = settings;
  return {
    businessAccountId,
    businessName: account.name,
    settings: {
      ...rest,
      parentalConsentConfirmedAt: rest.parentalConsentConfirmedAt ? new Date(rest.parentalConsentConfirmedAt).toISOString() : null,
    },
    keys: describeBusinessKeys(apiKeys),
    platformKeys: platform,
    effectiveKeySource: keySource,
    canStart: warnings.length === 0 && settings.enabled,
    warnings,
    childrensAccount: children,
    voiceModeEnabled: account.voiceModeEnabled === "true",
    providers: providers.map((id) => ({ id, label: providerLabel(id) })),
    limits: AVATAR_LIMITS,
    usage,
    recentSessions: await avatarSessionManager.recentSessions(businessAccountId, 10),
  };
}

router.get("/api/super-admin/avatar/accounts/:businessAccountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const view = await adminView(req.params.businessAccountId);
    if (!view) return res.status(404).json({ error: "Business account not found" });
    res.json(view);
  } catch (error) {
    sendSettingsError(res, error, "Failed to load avatar settings");
  }
});

router.put("/api/super-admin/avatar/accounts/:businessAccountId", requireAuth, requireRole("super_admin"), async (req, res) => {
  const { businessAccountId } = req.params;
  try {
    const result = await updateAvatarSettings(businessAccountId, req.body, req.user!.id);
    if (result.changed.length > 0) {
      await recordAuditEventSafely(req, {
        action: "avatar.settings_updated",
        outcome: "success",
        businessAccountId,
        resourceType: "avatar_settings",
        resourceId: businessAccountId,
        metadata: {
          changedFields: result.changed,
          ...Object.fromEntries(Object.entries(result.after).map(([k, v]) => [`new_${k}`, v])),
          ...Object.fromEntries(Object.entries(result.before).map(([k, v]) => [`previous_${k}`, v])),
        },
      });
    }
    // Disabling the add-on ends live sessions for this account.
    if (result.changed.includes("enabled") && !result.settings.enabled) {
      await Promise.allSettled(avatarSessionManager.liveSessionIds(businessAccountId).map((id) => avatarSessionManager.endSession(id, "disabled")));
    }
    res.json(await adminView(businessAccountId));
  } catch (error) {
    sendSettingsError(res, error, "Failed to save avatar settings");
  }
});

router.put("/api/super-admin/avatar/accounts/:businessAccountId/keys/:provider", requireAuth, requireRole("super_admin"), async (req, res) => {
  const { businessAccountId } = req.params;
  try {
    const provider = assertKeyProvider(String(req.params.provider || ""));
    const result = await setBusinessApiKey(businessAccountId, provider, req.body?.apiKey, req.user!.id);
    await recordAuditEventSafely(req, {
      action: "avatar.business_key_set",
      outcome: "success",
      businessAccountId,
      resourceType: "avatar_business_key",
      resourceId: `${businessAccountId}:${provider}`,
      metadata: { provider, replaced: result.replaced },
    });
    res.json({ provider, set: true, masked: result.masked });
  } catch (error) {
    sendSettingsError(res, error, "Failed to save key");
  }
});

router.delete("/api/super-admin/avatar/accounts/:businessAccountId/keys/:provider", requireAuth, requireRole("super_admin"), async (req, res) => {
  const { businessAccountId } = req.params;
  try {
    const provider = assertKeyProvider(String(req.params.provider || ""));
    const removed = await removeBusinessApiKey(businessAccountId, provider, req.user!.id);
    if (removed) {
      await recordAuditEventSafely(req, {
        action: "avatar.business_key_removed",
        outcome: "success",
        businessAccountId,
        resourceType: "avatar_business_key",
        resourceId: `${businessAccountId}:${provider}`,
        metadata: { provider },
      });
    }
    res.json({ provider, set: false, removed });
  } catch (error) {
    sendSettingsError(res, error, "Failed to remove key");
  }
});

router.post("/api/super-admin/avatar/accounts/:businessAccountId/keys/:provider/test", requireAuth, requireRole("super_admin"), async (req, res) => {
  const { businessAccountId } = req.params;
  try {
    const provider = assertKeyProvider(String(req.params.provider || ""));
    const account = await storage.getBusinessAccount(businessAccountId);
    if (!account) return res.status(404).json({ error: "Business account not found" });
    const typed = req.body?.apiKey !== undefined ? normalizeApiKey(req.body.apiKey) : null;
    if (req.body?.apiKey !== undefined && !typed) return res.status(400).json({ ok: false, error: "API key must be 8–512 characters with no spaces" });
    const key = typed || (await getBusinessApiKey(businessAccountId, provider));
    if (!key) return res.status(400).json({ ok: false, error: `No API key for ${providerLabel(provider)} on this account` });
    const result = await runKeyTest(provider, key);
    await recordAuditEventSafely(req, {
      action: "avatar.business_key_tested",
      outcome: result.ok ? "success" : "failure",
      businessAccountId,
      resourceType: "avatar_business_key",
      resourceId: `${businessAccountId}:${provider}`,
      metadata: { provider, typed: !!typed, resultCode: result.code ?? "ok" },
    });
    res.json(result);
  } catch (error) {
    sendSettingsError(res, error, "Failed to test key");
  }
});

// ── business user: read-only status ──────────────────────────────────────────

router.get("/api/avatar/status", requireAuth, async (req, res) => {
  try {
    const accountId = await resolveAuthorizedLeadAccountId(req.user!);
    if (!accountId) return res.json({ enabled: false });
    const settings = await getEffectiveSettings(accountId);
    const usage = await avatarSessionManager.monthUsage(accountId);
    const keySource = isProviderSelectable(settings.provider) ? await keyAvailability(settings.provider, settings) : null;
    res.json({
      enabled: settings.enabled,
      provider: providerLabel(settings.provider),
      displayName: settings.displayName,
      styleHint: settings.styleHint,
      key: keySource ? "set" : "not set",
      minutesUsed: usage.minutes,
      monthlyMinuteCap: settings.monthlyMinuteCap,
      maxSessionMinutes: settings.maxSessionMinutes,
    });
  } catch (error) {
    sendSettingsError(res, error, "Failed to load avatar status");
  }
});

// ── widget (public) ──────────────────────────────────────────────────────────

/** sendBeacon on page close posts text/plain; accept it alongside JSON. */
const textBody = express.text({ type: ["text/plain"], limit: "4kb" });
function bodyOf(req: Request): Record<string, any> {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body) || {}; } catch { return {}; }
  }
  return req.body && typeof req.body === "object" ? req.body : {};
}

function visitorAuth(req: Request, res: Response): { businessAccountId: string; visitorId: string } | null {
  const body = bodyOf(req);
  const businessAccountId = typeof body.businessAccountId === "string" ? body.businessAccountId.slice(0, 64) : "";
  const visitorId = typeof body.userId === "string" ? body.userId.slice(0, 255) : "";
  if (!businessAccountId || !visitorId) {
    res.status(400).json({ error: "businessAccountId and userId are required" });
    return null;
  }
  return { businessAccountId, visitorId };
}

function sendGateError(res: Response, error: unknown) {
  if (error instanceof AvatarGateError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      fallback: "voice",
      message: VISITOR_FALLBACK_MESSAGES[error.code] || "The video assistant isn't available right now — let's continue by voice.",
    });
  }
  console.error("[Avatar] widget route error:", (error as Error)?.message || error);
  return res.status(500).json({ error: "Avatar unavailable", code: "provider_error", fallback: "voice" });
}

router.get("/api/chat/widget/avatar/config", async (req, res) => {
  const businessAccountId = typeof req.query.businessAccountId === "string" ? req.query.businessAccountId : "";
  if (!businessAccountId) return res.status(400).json({ error: "businessAccountId required" });
  res.json({ avatar: await getPublicAvatarConfig(businessAccountId) });
});

router.post("/api/chat/widget/avatar/session", async (req, res) => {
  const auth = visitorAuth(req, res);
  if (!auth) return;
  const body = bodyOf(req);
  // Each session start costs money: limit per IP, per visitor and per business.
  const ip = clientIp(req);
  if (
    rateLimitHit(`ip:${ip}`, 6, 60_000) ||
    rateLimitHit(`visitor:${auth.businessAccountId}:${auth.visitorId}`, 4, 60_000) ||
    rateLimitHit(`biz:${auth.businessAccountId}`, 60, 60_000)
  ) {
    return sendGateError(res, new AvatarGateError("rate_limited", 429, "Too many avatar starts — try again in a minute"));
  }
  try {
    const conversationId = typeof body.conversationId === "string" && body.conversationId ? body.conversationId.slice(0, 64) : null;
    const result = await avatarSessionManager.startSession({ ...auth, conversationId });
    res.json(result);
  } catch (error) {
    sendGateError(res, error);
  }
});

router.post("/api/chat/widget/avatar/session/:id/connected", async (req, res) => {
  const auth = visitorAuth(req, res);
  if (!auth) return;
  const body = bodyOf(req);
  try {
    const ok = await avatarSessionManager.markConnected(req.params.id, auth, {
      providerSessionId: typeof body.providerSessionId === "string" ? body.providerSessionId.slice(0, 128) : null,
      firstFrameMs: typeof body.firstFrameMs === "number" ? body.firstFrameMs : null,
    });
    res.json({ active: ok });
  } catch (error) {
    sendGateError(res, error);
  }
});

router.post("/api/chat/widget/avatar/session/:id/heartbeat", async (req, res) => {
  const auth = visitorAuth(req, res);
  if (!auth) return;
  try {
    res.json(await avatarSessionManager.heartbeat(req.params.id, auth));
  } catch (error) {
    sendGateError(res, error);
  }
});

router.post("/api/chat/widget/avatar/session/:id/end", textBody, async (req, res) => {
  const auth = visitorAuth(req, res);
  if (!auth) return;
  const body = bodyOf(req);
  const reason: AvatarEndReason = (CLIENT_END_REASONS as string[]).includes(body.reason) ? body.reason : "visitor_closed";
  try {
    const ended = await avatarSessionManager.endFromClient(req.params.id, auth, reason, body.detail);
    res.json({ ended });
  } catch (error) {
    sendGateError(res, error);
  }
});

export default router;
