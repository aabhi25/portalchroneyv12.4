/**
 * Website → WhatsApp hand-off from the chat widget: a click on a WhatsApp button asks the server
 * for a link whose pre-filled text names what the visitor was asking about and carries a short ref
 * code (so the WhatsApp AI continues the conversation). The new tab is opened synchronously inside
 * the click (popup blockers allow it) and pointed at the link once it arrives. If the server can't
 * be reached, is slow or answers oddly, the plain wa.me link the button always had is opened
 * instead, so the button never breaks.
 */

export type WhatsappHandoffSource = "header" | "launcher" | "product" | "menu";

export interface WhatsappHandoffContext {
  businessAccountId: string;
  getConversationId?: () => string | null | undefined;
  getVisitorToken?: () => string | null | undefined;
  /** Prefix for the API path ('' = same origin). */
  apiBase?: string;
}

export interface OpenWhatsappHandoffOptions {
  source: WhatsappHandoffSource;
  /** The old wa.me link, opened when the hand-off link can't be had. */
  fallbackUrl: string;
  productId?: string | null;
  productName?: string | null;
  /** product source: the order message filled from the template. */
  message?: string | null;
  /** Defaults to the context registered by the chat widget (setWhatsappHandoffContext). */
  context?: WhatsappHandoffContext | null;
  timeoutMs?: number;
}

/** What the helper needs from the browser (injectable for tests). */
export interface HandoffEnv {
  open: (url: string, target: string, features?: string) => { location: { href: string }; opener: unknown; closed?: boolean } | null;
  fetch: typeof fetch;
}

let registered: WhatsappHandoffContext | null = null;

/** The chat widget registers who / which conversation the WhatsApp buttons belong to. */
export function setWhatsappHandoffContext(ctx: WhatsappHandoffContext | null): void {
  registered = ctx;
}

function browserEnv(): HandoffEnv {
  return {
    open: (url, target, features) => window.open(url, target, features) as any,
    fetch: (...args) => window.fetch(...args),
  };
}

const WA_LINK = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//;

export async function openWhatsappHandoff(opts: OpenWhatsappHandoffOptions, env: HandoffEnv = browserEnv()): Promise<"handoff" | "fallback"> {
  const ctx = opts.context === undefined ? registered : opts.context;
  if (!ctx?.businessAccountId) {
    env.open(opts.fallbackUrl, "_blank", "noopener,noreferrer");
    return "fallback";
  }

  // Synchronously, still inside the click: a blank tab we fill in below.
  let tab: ReturnType<HandoffEnv["open"]> = null;
  try { tab = env.open("", "_blank"); } catch { tab = null; }
  if (tab) { try { tab.opener = null; } catch { /* ignore */ } }
  const go = (url: string) => {
    if (tab && !tab.closed) {
      try { tab.location.href = url; return; } catch { /* fall through */ }
    }
    env.open(url, "_blank", "noopener,noreferrer");
  };

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), opts.timeoutMs ?? 4000);
  try {
    const res = await env.fetch(`${ctx.apiBase || ""}/api/chat/widget/whatsapp-handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessAccountId: ctx.businessAccountId,
        source: opts.source,
        conversationId: ctx.getConversationId?.() || null,
        visitorToken: ctx.getVisitorToken?.() || null,
        productId: opts.productId || null,
        productName: opts.productName || null,
        message: opts.message || null,
      }),
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (typeof data?.url !== "string" || !WA_LINK.test(data.url)) throw new Error("bad link");
    go(data.url);
    return "handoff";
  } catch {
    go(opts.fallbackUrl);
    return "fallback";
  } finally {
    clearTimeout(timer);
  }
}
