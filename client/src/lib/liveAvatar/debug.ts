/**
 * Live AI avatar debug trail (local testing only). When the server runs with
 * AVATAR_DEBUG=1 the session-start response says `debug: true`; the browser then batches
 * what happens on its side (provider SDK events, audio sent to the avatar, whether the
 * avatar's audio is actually playing, interruptions) and posts it to the server log next
 * to [VoiceTiming]. Off in production: nothing is collected or sent.
 */
type DebugEvent = { t: number; e: string; d?: string };

let target: { sessionId: string; businessAccountId: string; userId: string } | null = null;
let queue: DebugEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let startedAt = 0;

function flush(): void {
  timer = null;
  if (!target || queue.length === 0) return;
  const events = queue.slice(0, 50);
  queue = queue.slice(50);
  const { sessionId, businessAccountId, userId } = target;
  void fetch(`/api/chat/widget/avatar/session/${encodeURIComponent(sessionId)}/debug`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessAccountId, userId, events }),
    keepalive: true,
  }).catch(() => undefined);
  if (queue.length) timer = setTimeout(flush, 200);
}

export function startAvatarDebug(sessionId: string, auth: { businessAccountId: string; userId: string }): void {
  target = { sessionId, ...auth };
  queue = [];
  startedAt = performance.now();
}

export function stopAvatarDebug(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  flush();
  target = null;
}

export function avatarDebugOn(): boolean {
  return target !== null;
}

/** Record one event (no-op unless debugging is on for this call). */
export function avatarDebug(event: string, detail?: unknown): void {
  if (!target) return;
  let d: string | undefined;
  if (detail !== undefined) {
    try { d = typeof detail === "string" ? detail : JSON.stringify(detail); } catch { d = String(detail); }
    if (d && d.length > 300) d = `${d.slice(0, 300)}…`;
  }
  queue.push({ t: Math.round(performance.now() - startedAt), e: event, d });
  if (queue.length > 400) queue = queue.slice(-400);
  if (!timer) timer = setTimeout(flush, 700);
}
