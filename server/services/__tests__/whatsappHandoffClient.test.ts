/**
 * The chat widget's WhatsApp button helper (client/src/lib/whatsappHandoff.ts): opens a tab inside
 * the click, points it at the hand-off link, and falls back to the plain wa.me link whenever the
 * endpoint fails, is slow or answers oddly — the button must never break.
 *
 *   npx tsx server/services/__tests__/whatsappHandoffClient.test.ts
 */
import { openWhatsappHandoff, setWhatsappHandoffContext, type HandoffEnv } from "../../../client/src/lib/whatsappHandoff";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

const FALLBACK = "https://wa.me/919000011111?text=Hi";
const LINK = "https://wa.me/919000011111?text=Hi%20(Ref%3A%20K7Q2MX)";

function env(fetchImpl: (url: string, init: any) => Promise<any>, opts: { blocked?: boolean } = {}) {
  const opened: Array<{ url: string; features?: string }> = [];
  const tab = { location: { href: "" }, opener: {} as unknown, closed: false };
  const requests: any[] = [];
  const e: HandoffEnv = {
    open: (url, _target, features) => {
      opened.push({ url, features });
      if (url === "" && opts.blocked) return null;
      return url === "" ? tab : null;
    },
    fetch: (async (url: string, init: any) => { requests.push({ url, body: JSON.parse(init.body) }); return fetchImpl(url, init); }) as any,
  };
  return { e, opened, tab, requests };
}
const ok = (body: any) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

async function main() {
  const ctx = { businessAccountId: "biz-1", getConversationId: () => "conv-1", getVisitorToken: () => "vt-1" };

  {
    const t = env(() => ok({ url: LINK, code: "K7Q2MX" }));
    const r = await openWhatsappHandoff({ source: "header", fallbackUrl: FALLBACK, context: ctx }, t.e);
    expect(r === "handoff" && t.tab.location.href === LINK, "success: the tab opened in the click goes to the hand-off link", { r, href: t.tab.location.href });
    expect(t.opened[0].url === "" && t.tab.opener === null, "tab opened synchronously, opener cleared", t.opened);
    expect(t.requests[0].url === "/api/chat/widget/whatsapp-handoff" && t.requests[0].body.conversationId === "conv-1" && t.requests[0].body.visitorToken === "vt-1" && t.requests[0].body.source === "header", "request carries the conversation, visitor and source", t.requests[0]);
  }
  {
    const t = env(() => Promise.reject(new Error("network down")));
    const r = await openWhatsappHandoff({ source: "menu", fallbackUrl: FALLBACK, context: ctx }, t.e);
    expect(r === "fallback" && t.tab.location.href === FALLBACK, "endpoint failure → the plain link", t.tab.location.href);
  }
  {
    const t = env(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    const r = await openWhatsappHandoff({ source: "menu", fallbackUrl: FALLBACK, context: ctx }, t.e);
    expect(r === "fallback" && t.tab.location.href === FALLBACK, "HTTP error → the plain link", t.tab.location.href);
  }
  {
    const t = env(() => ok({ url: "https://evil.example/phish" }));
    const r = await openWhatsappHandoff({ source: "header", fallbackUrl: FALLBACK, context: ctx }, t.e);
    expect(r === "fallback" && t.tab.location.href === FALLBACK, "a non-WhatsApp URL is never opened", t.tab.location.href);
  }
  {
    const t = env(() => new Promise(() => { /* never answers */ }));
    const r = await openWhatsappHandoff({ source: "header", fallbackUrl: FALLBACK, context: ctx, timeoutMs: 50 }, {
      ...t.e,
      fetch: ((_u: string, init: any) => new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as any,
    });
    expect(r === "fallback" && t.tab.location.href === FALLBACK, "slow endpoint → the plain link after the timeout", t.tab.location.href);
  }
  {
    const t = env(() => ok({ url: LINK }), { blocked: true });
    const r = await openWhatsappHandoff({ source: "header", fallbackUrl: FALLBACK, context: ctx }, t.e);
    expect(r === "handoff" && t.opened.some(o => o.url === LINK && /noopener/.test(o.features || "")), "popup blocked for the blank tab → opens the link directly", t.opened);
  }
  {
    const t = env(() => ok({ url: LINK }));
    const r = await openWhatsappHandoff({ source: "product", fallbackUrl: FALLBACK }, t.e);
    expect(r === "fallback" && t.requests.length === 0 && t.opened[0].url === FALLBACK, "no chat context registered (other pages) → plain link, no request", t.opened);
  }
  {
    setWhatsappHandoffContext(ctx);
    const t = env(() => ok({ url: LINK }));
    const r = await openWhatsappHandoff({ source: "product", fallbackUrl: FALLBACK, productId: "p1", productName: "Silk Saree", message: "Hi! order" }, t.e);
    expect(r === "handoff" && t.requests[0].body.productId === "p1" && t.requests[0].body.message === "Hi! order", "registered context used by product buttons", t.requests[0]?.body);
    setWhatsappHandoffContext(null);
  }

  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log("\nAll WhatsApp hand-off client checks passed.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
