/**
 * Live AI avatar — browser entry points. Everything heavy (provider SDKs,
 * adapters) loads lazily when the visitor taps the avatar button.
 */
import type { AvatarClientAdapter, AvatarSessionInfo } from "./types";

export type { AvatarClientAdapter, AvatarSessionInfo } from "./types";

export async function loadAvatarAdapter(provider: string): Promise<AvatarClientAdapter> {
  switch (provider) {
    case "heygen_liveavatar":
      return (await import("./adapters/heygen")).createHeygenAdapter();
    case "anam":
      return (await import("./adapters/anam")).createAnamAdapter();
    case "fake":
      return (await import("./adapters/fake")).createFakeAdapter();
    default:
      throw new Error(`Unsupported avatar provider: ${provider}`);
  }
}

export interface AvatarApiError {
  code: string;
  message: string;
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Visitor tapped "Talk to …": the server checks limits and mints a provider session. */
export async function startAvatarSession(input: { businessAccountId: string; userId: string; conversationId?: string | null }, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; session: AvatarSessionInfo } | { ok: false; error: AvatarApiError }> {
  try {
    const res = await fetchImpl("/api/chat/widget/avatar/session", json(input));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: { code: String(data?.code || "provider_error"), message: String(data?.message || data?.error || "Avatar unavailable") } };
    return { ok: true, session: data as AvatarSessionInfo };
  } catch {
    return { ok: false, error: { code: "network", message: "The video assistant couldn't start — continuing with voice." } };
  }
}

export async function reportAvatarConnected(sessionId: string, input: { businessAccountId: string; userId: string; providerSessionId?: string | null; firstFrameMs?: number }, fetchImpl: typeof fetch = fetch): Promise<void> {
  try { await fetchImpl(`/api/chat/widget/avatar/session/${encodeURIComponent(sessionId)}/connected`, json(input)); } catch { /* best effort */ }
}

export async function avatarHeartbeat(sessionId: string, input: { businessAccountId: string; userId: string }, fetchImpl: typeof fetch = fetch): Promise<{ active: boolean; endReason?: string | null }> {
  try {
    const res = await fetchImpl(`/api/chat/widget/avatar/session/${encodeURIComponent(sessionId)}/heartbeat`, json(input));
    if (!res.ok) return { active: true };
    return await res.json();
  } catch {
    // A network blip is not an end; the server's own heartbeat timeout decides.
    return { active: true };
  }
}

/** End the avatar session. `beacon` for page unload (survives the tab closing). */
export function endAvatarSession(sessionId: string, input: { businessAccountId: string; userId: string; reason: string }, opts: { beacon?: boolean } = {}): void {
  const url = `/api/chat/widget/avatar/session/${encodeURIComponent(sessionId)}/end`;
  const body = JSON.stringify(input);
  if (opts.beacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      if (navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
    } catch { /* fall through */ }
  }
  void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}
