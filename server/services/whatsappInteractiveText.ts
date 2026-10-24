/**
 * The text of a WhatsApp button / list tap, for the chat history and the replies. MSG91 sends a
 * tap with an empty `text` and the choice in `button` (a template's quick-reply button:
 * { text, payload }) or `interactive` (a reply button / list: { button_reply: { title } } or
 * { list_reply: { title } }), either as an object or a JSON string. The chat used to show only
 * "[Interactive message]" (2026-10-24).
 */
function parse(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return null;
  if (s.startsWith("{") || s.startsWith("[")) {
    try { return JSON.parse(s); } catch { /* plain text */ }
  }
  return s;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function interactiveReplyText(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return "";
  const button = parse(payload.button);
  if (typeof button === "string") return button;
  if (button && typeof button === "object") {
    const b = button as Record<string, unknown>;
    const t = str(b.text) || str(b.title) || str(b.payload);
    if (t) return t;
  }
  const interactive = parse(payload.interactive);
  if (typeof interactive === "string") return interactive;
  if (interactive && typeof interactive === "object") {
    const i = interactive as Record<string, any>;
    const t = str(i.button_reply?.title) || str(i.list_reply?.title) || str(i.title) || str(i.text);
    if (t) return t;
    if (i.nfm_reply || i.type === "nfm_reply") return "[Form submitted]";
  }
  return "";
}

/** Shape only (field types / keys, never values) of the tap fields, for the log. */
export function interactiveShape(payload: Record<string, unknown> | null | undefined): string {
  const shape = (v: unknown) => {
    const p = parse(v);
    if (p === null || p === undefined || p === "") return "empty";
    if (typeof p === "object") return `{${Object.keys(p as object).slice(0, 8).join(",")}}`;
    return typeof p;
  };
  return `button=${shape(payload?.button)} interactive=${shape(payload?.interactive)}`;
}

/** Chat history text for rows stored before the real text was kept. */
export function readableChatText(raw: string | null, templateText: Map<string, string>): string | null {
  if (!raw) return raw;
  const tpl = /^\[Template: (.+)\]$/.exec(raw);
  if (tpl) return templateText.get(tpl[1]) ?? raw;
  if (raw === "[Interactive message]") return "Tapped a button in your message";
  return raw;
}
