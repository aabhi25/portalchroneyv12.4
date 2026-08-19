/**
 * TopScholar doubt-sync service.
 *
 * Mirrors every message exchanged in an AI tutor session back to the client's
 * platform, and closes the doubt when the session ends. This is STRICTLY scoped
 * to the single TopScholar account — every caller must already be gated on
 * isTopscholarAccount()/getTopscholarConfig().ragEnabled before invoking these.
 *
 * All calls here are best-effort / fire-and-forget: a failure to mirror a message
 * or close a doubt must never break the student's chat experience. Errors are
 * logged and swallowed.
 *
 * Client API contract (per the client's official integration doc — PDF + email):
 *   1. Conversation sync
 *      POST {baseUrl}/api/conversation/save-message-ai-bot   (multipart/form-data)
 *        - doubt:     <doubtId>
 *        - from_user: 'sme' (AI bot) | 'student'   (client confirmed the field name
 *                     is `from_user`, matching their Postman collections; the PDF's
 *                     `from` was outdated)
 *        - messages:  <text>            (text-only messages)
 *        - file:      <binary>          (attachments; never together with messages)
 *   2. Doubt close
 *      PUT {baseUrl}/api/doubt/close/{doubtId}   (application/json)
 *        - { "status": "resolved" | "closed" }
 *   3. Image upload (S3)
 *      POST https://api.toppscholars.com/cp/api/ai-bot/upload-img   (multipart/form-data)
 *        - file: <binary>
 *        - response: { result: [{ imageUrl }] }
 *   4. Escalation email (bot → human support handoff)
 *      POST {baseUrl}/api/doubt/trigger-escalation-email   (application/json)
 *        - { query_details, conversation_summary, plan_id, student_id, doubt_id }
 *
 * Message rendering:
 *   AI (sme) messages are converted from Markdown+LaTeX to HTML with MathML math
 *   before being pushed to the client's API, so their WebApp can render equations
 *   and rich content directly without additional parsing. Student messages are sent
 *   as-is (plain text). Our own database is never affected — the conversion is
 *   purely in-flight, just before the POST.
 */

// ---------------------------------------------------------------------------
// Markdown → HTML (MathML) renderer
// ---------------------------------------------------------------------------
// Lazy-initialised pipeline: built once on first call, reused for all pushes.
// Uses the unified ecosystem packages that are already in this project's
// dependencies (remark-gfm, remark-math, rehype-katex) plus the pipeline
// glue packages (unified, remark, remark-rehype, rehype-raw, rehype-stringify)
// that were added alongside this feature.
//
// KaTeX is configured with output:'mathml' so every $ … $ / $$ … $$ block
// becomes a <math> element instead of KaTeX's default HTML+CSS span soup.
// That makes the stored content portable across rendering engines and readable
// by screen readers without any client-side JS dependency.
// ---------------------------------------------------------------------------

type ProcessorFn = (md: string) => Promise<string>;
let _rendererPromise: Promise<ProcessorFn> | null = null;

function getRenderer(): Promise<ProcessorFn> {
  if (_rendererPromise) return _rendererPromise;
  _rendererPromise = (async (): Promise<ProcessorFn> => {
    // `remark` is a unified() processor with remark-parse already attached —
    // use it as the base instead of unified() + a separate remark-parse plugin.
    const { remark } = await import('remark');
    const { default: remarkGfm } = await import('remark-gfm');
    const { default: remarkMath } = await import('remark-math');
    const { default: remarkRehype } = await import('remark-rehype');
    const { default: rehypeRaw } = await import('rehype-raw');
    const { default: rehypeKatex } = await import('rehype-katex');
    const { default: rehypeStringify } = await import('rehype-stringify');

    const processor = remark()
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeKatex, { output: 'mathml' as const })
      .use(rehypeStringify);

    return async (md: string) => {
      const result = await processor.process(md);
      return String(result);
    };
  })().catch((err) => {
    // If the pipeline fails to initialise (missing package, bad import), fall
    // back gracefully so the sync path is never blocked.
    console.warn('[DoubtSync] renderer init failed, falling back to plain text:', err instanceof Error ? err.message : err);
    _rendererPromise = null; // allow a retry next call
    return (md: string) => Promise.resolve(md);
  });
  return _rendererPromise;
}

/**
 * Convert a Markdown+LaTeX AI answer to HTML with MathML equations for
 * storage in the client's database via the doubt-sync API.
 *
 * - Math blocks ($…$ and $$…$$) become <math> MathML elements.
 * - Tables, bold, italic, lists, code blocks → standard HTML.
 * - Images: ![alt](url) → <img> tags (client renders them inline).
 * - Falls back to the original text on any conversion error so the
 *   doubt-sync push is never blocked by a rendering failure.
 */
async function toRenderable(markdown: string): Promise<string> {
  try {
    const render = await getRenderer();
    return await render(markdown);
  } catch (err) {
    console.warn('[DoubtSync] toRenderable failed, using plain text:', err instanceof Error ? err.message : err);
    return markdown;
  }
}

// Fixed S3 upload endpoint (per the client's Image Upload API doc). Not tenant
// configurable — the client hosts a single AI-bot upload bucket.
const IMAGE_UPLOAD_URL = 'https://api.toppscholars.com/cp/api/ai-bot/upload-img';

// Guard rails so a mis-set base URL can't cause the server to fetch internal hosts.
function assertSafeBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Doubt-sync base URL is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Doubt-sync base URL must use http(s).');
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80');
  if (blocked) {
    throw new Error('Doubt-sync base URL must point to a public host.');
  }
  return url;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return `${base}/${suffix}`;
}

const REQUEST_TIMEOUT_MS = 10_000;

// ---- Sync-event recorder (admin Tester verification aid) -------------------
// A small in-memory ring buffer of the most recent outbound doubt-sync calls so
// the admin Widget Tester can confirm end-to-end delivery without reading server
// logs. Purely observational — never affects the sync path. Process-local only
// (resets on restart), which is fine for a live-test readout.
export interface DoubtSyncEvent {
  at: string; // ISO timestamp
  kind: 'message' | 'attachment' | 'close' | 'escalation_email';
  doubtId: string;
  ok: boolean;
  detail: string; // e.g. "from=student", "status=resolved", "HTTP 500", error text
}

const MAX_SYNC_EVENTS = 200;
const syncEvents: DoubtSyncEvent[] = [];

function recordSyncEvent(kind: DoubtSyncEvent['kind'], doubtId: string, ok: boolean, detail: string) {
  syncEvents.push({ at: new Date().toISOString(), kind, doubtId, ok, detail });
  if (syncEvents.length > MAX_SYNC_EVENTS) syncEvents.splice(0, syncEvents.length - MAX_SYNC_EVENTS);
  // Mirror into the Debug Dashboard's live request log (best-effort).
  import('./debugLogger')
    .then(({ logDebugEvent }) => logDebugEvent('sync_result', { syncKind: kind, ok, detail }, { doubtId }))
    .catch(() => {});
}

/** Most-recent-first sync events, optionally filtered to one doubtId. */
export function getRecentDoubtSyncEvents(doubtId?: string | null, limit = 50): DoubtSyncEvent[] {
  const filtered = doubtId ? syncEvents.filter((e) => e.doubtId === doubtId) : syncEvents;
  return filtered.slice(-Math.max(1, Math.min(limit, MAX_SYNC_EVENTS))).reverse();
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export type DoubtSyncSender = 'sme' | 'student';

// ---- Detailed sync test (Debug Dashboard) -----------------------------------
// Fires a real save-message POST and returns the FULL HTTP exchange so the admin
// can see exactly what the client's server replied. Never used on the chat path.

export interface DetailedSyncResult {
  ok: boolean;
  request: { url: string; method: string; fields: Record<string, string> };
  response: { status: number; statusText: string; bodySnippet: string } | null;
  latencyMs: number;
  error: string | null;
}

export async function pushTextMessageDetailed(
  baseUrl: string,
  doubtId: string,
  from: DoubtSyncSender,
  text: string,
): Promise<DetailedSyncResult> {
  const trimmed = String(text || '').trim();
  const started = Date.now();
  const url = baseUrl ? joinUrl(baseUrl, '/api/conversation/save-message-ai-bot') : '(no base URL configured)';
  const request = { url, method: 'POST', fields: { doubt: doubtId, from_user: from, messages: trimmed.slice(0, 200) } };

  if (!baseUrl) return { ok: false, request, response: null, latencyMs: 0, error: 'Doubt-sync base URL is not configured on this account.' };
  if (!doubtId || !trimmed) return { ok: false, request, response: null, latencyMs: 0, error: 'doubtId and a non-empty message are both required.' };

  try {
    assertSafeBaseUrl(baseUrl);
    // AI answers are converted to HTML+MathML so the client's WebApp can render
    // equations and rich content without additional parsing. Student messages are
    // plain text and sent as-is.
    const payload = from === 'sme' ? await toRenderable(trimmed) : trimmed;
    const form = new FormData();
    form.append('doubt', doubtId);
    form.append('from_user', from);
    form.append('messages', payload);
    const res = await withTimeout((signal) => fetch(url, { method: 'POST', body: form, signal }));
    const bodyText = await res.text().catch(() => '');
    const latencyMs = Date.now() - started;
    recordSyncEvent('message', doubtId, res.ok, `from=${from} (debug test) HTTP ${res.status}`);
    return {
      ok: res.ok,
      request,
      response: { status: res.status, statusText: res.statusText, bodySnippet: bodyText.slice(0, 2000) },
      latencyMs,
      error: res.ok ? null : `Client server responded HTTP ${res.status}.`,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    recordSyncEvent('message', doubtId, false, `from=${from} (debug test) ${msg}`);
    return { ok: false, request, response: null, latencyMs, error: msg.includes('abort') ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s — client server did not respond.` : msg };
  }
}

/**
 * Mirror a text message to the client's conversation-sync API. Fire-and-forget:
 * resolves to true on a 2xx, false otherwise (never throws).
 */
export async function pushTextMessage(
  baseUrl: string,
  doubtId: string,
  from: DoubtSyncSender,
  text: string,
): Promise<boolean> {
  const trimmed = String(text || '').trim();
  if (!baseUrl || !doubtId || !trimmed) return false;
  try {
    assertSafeBaseUrl(baseUrl);
    // AI answers are converted to HTML+MathML for rich rendering on the client's
    // WebApp. Student messages are plain text and sent as-is.
    const payload = from === 'sme' ? await toRenderable(trimmed) : trimmed;
    const url = joinUrl(baseUrl, '/api/conversation/save-message-ai-bot');
    const form = new FormData();
    form.append('doubt', doubtId);
    form.append('from_user', from);
    form.append('messages', payload);
    const res = await withTimeout((signal) =>
      fetch(url, { method: 'POST', body: form, signal }),
    );
    if (!res.ok) {
      console.warn(`[DoubtSync] pushTextMessage non-2xx (${res.status}) doubt=${doubtId} from=${from}`);
      recordSyncEvent('message', doubtId, false, `from=${from} HTTP ${res.status}`);
      return false;
    }
    recordSyncEvent('message', doubtId, true, `from=${from}`);
    return true;
  } catch (err) {
    console.warn(`[DoubtSync] pushTextMessage failed doubt=${doubtId} from=${from}:`, err instanceof Error ? err.message : err);
    recordSyncEvent('message', doubtId, false, `from=${from} ${err instanceof Error ? err.message : 'error'}`);
    return false;
  }
}

/**
 * Mirror a binary attachment to the client's conversation-sync API. Fire-and-forget.
 * Per the client contract, `file` and `messages` are never sent together, so this
 * only ever sends the file.
 */
export async function pushAttachment(
  baseUrl: string,
  doubtId: string,
  from: DoubtSyncSender,
  file: Buffer | Uint8Array,
  filename: string,
  contentType: string,
): Promise<boolean> {
  if (!baseUrl || !doubtId || !file || file.length === 0) return false;
  try {
    assertSafeBaseUrl(baseUrl);
    const url = joinUrl(baseUrl, '/api/conversation/save-message-ai-bot');
    const form = new FormData();
    form.append('doubt', doubtId);
    form.append('from_user', from);
    const blob = new Blob([file as any], { type: contentType || 'application/octet-stream' });
    form.append('file', blob, filename || 'attachment');
    const res = await withTimeout((signal) =>
      fetch(url, { method: 'POST', body: form, signal }),
    );
    if (!res.ok) {
      console.warn(`[DoubtSync] pushAttachment non-2xx (${res.status}) doubt=${doubtId} from=${from}`);
      recordSyncEvent('attachment', doubtId, false, `from=${from} HTTP ${res.status}`);
      return false;
    }
    recordSyncEvent('attachment', doubtId, true, `from=${from}`);
    return true;
  } catch (err) {
    console.warn(`[DoubtSync] pushAttachment failed doubt=${doubtId} from=${from}:`, err instanceof Error ? err.message : err);
    recordSyncEvent('attachment', doubtId, false, `from=${from} ${err instanceof Error ? err.message : 'error'}`);
    return false;
  }
}

/**
 * Close a doubt after session completion. `status` is 'resolved' when the student
 * confirmed their doubt was answered, or 'closed' on session end / 24h expiry.
 * Fire-and-forget; resolves true on 2xx.
 */
export async function closeDoubt(
  baseUrl: string,
  doubtId: string,
  status: 'resolved' | 'closed',
): Promise<boolean> {
  if (!baseUrl || !doubtId) return false;
  try {
    assertSafeBaseUrl(baseUrl);
    const url = joinUrl(baseUrl, `/api/doubt/close/${encodeURIComponent(doubtId)}`);
    const res = await withTimeout((signal) =>
      fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
        signal,
      }),
    );
    if (!res.ok) {
      console.warn(`[DoubtSync] closeDoubt non-2xx (${res.status}) doubt=${doubtId} status=${status}`);
      recordSyncEvent('close', doubtId, false, `status=${status} HTTP ${res.status}`);
      return false;
    }
    recordSyncEvent('close', doubtId, true, `status=${status}`);
    return true;
  } catch (err) {
    console.warn(`[DoubtSync] closeDoubt failed doubt=${doubtId} status=${status}:`, err instanceof Error ? err.message : err);
    recordSyncEvent('close', doubtId, false, `status=${status} ${err instanceof Error ? err.message : 'error'}`);
    return false;
  }
}

/**
 * Trigger the client's bot-escalation email after the retry-once flow is
 * exhausted. The client's API sends the actual email to their support team —
 * we only deliver the payload. Fire-and-forget; resolves true on 2xx.
 *
 * Contract (client Postman collection "Bot Email Escalation APIs"):
 *   POST {baseUrl}/api/doubt/trigger-escalation-email
 *   { query_details, conversation_summary, plan_id, student_id, doubt_id }
 */
export async function triggerEscalationEmail(
  baseUrl: string,
  params: {
    doubtId: string;
    queryDetails: string;
    conversationSummary: string;
    planId?: string | null;
    studentId?: string | null;
  },
): Promise<boolean> {
  const { doubtId, queryDetails, conversationSummary, planId, studentId } = params;
  if (!baseUrl || !doubtId) return false;
  try {
    assertSafeBaseUrl(baseUrl);
    const url = joinUrl(baseUrl, '/api/doubt/trigger-escalation-email');
    const res = await withTimeout((signal) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query_details: queryDetails,
          conversation_summary: conversationSummary,
          plan_id: planId || '',
          student_id: studentId || '',
          doubt_id: doubtId,
        }),
        signal,
      }),
    );
    if (!res.ok) {
      console.warn(`[DoubtSync] triggerEscalationEmail non-2xx (${res.status}) doubt=${doubtId}`);
      recordSyncEvent('escalation_email', doubtId, false, `HTTP ${res.status}`);
      return false;
    }
    recordSyncEvent('escalation_email', doubtId, true, 'sent');
    return true;
  } catch (err) {
    console.warn(`[DoubtSync] triggerEscalationEmail failed doubt=${doubtId}:`, err instanceof Error ? err.message : err);
    recordSyncEvent('escalation_email', doubtId, false, err instanceof Error ? err.message : 'error');
    return false;
  }
}

/**
 * Upload an image to the client's S3-backed AI-bot upload endpoint. Returns the
 * hosted imageUrl on success, or null on any failure. Used to route AI-produced
 * image attachments through the client's storage before they are referenced in a
 * synced message. The endpoint is fixed (not tenant configurable).
 */
export async function uploadImage(
  file: Buffer | Uint8Array,
  filename: string,
  contentType: string,
): Promise<string | null> {
  if (!file || file.length === 0) return null;
  try {
    const form = new FormData();
    const blob = new Blob([file as any], { type: contentType || 'application/octet-stream' });
    form.append('file', blob, filename || 'image');
    const res = await withTimeout((signal) =>
      fetch(IMAGE_UPLOAD_URL, { method: 'POST', body: form, signal }),
    );
    if (!res.ok) {
      console.warn(`[DoubtSync] uploadImage non-2xx (${res.status})`);
      return null;
    }
    const json: any = await res.json().catch(() => null);
    const imageUrl = json?.result?.[0]?.imageUrl;
    if (typeof imageUrl === 'string' && imageUrl.trim()) {
      return imageUrl.trim();
    }
    console.warn('[DoubtSync] uploadImage response missing result[0].imageUrl');
    return null;
  } catch (err) {
    console.warn('[DoubtSync] uploadImage failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
