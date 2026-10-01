/**
 * Helpers for the WhatsApp AI reply (whatsappAutoReplyService): model choice, the appointment /
 * order tools as WhatsApp text, and WhatsApp-safe formatting. Pure except resolveWhatsappModel.
 */
import { format, parseISO } from "date-fns";
import { storage } from "../../storage";

/** History sent to the model: the website's conversation window (conversationWindow.ts). */
export const WHATSAPP_HISTORY_LIMITS = {
  /** Rows read from whatsapp_leads (within the 48 h window). */
  fetch: 40,
  maxMessages: 20,
  maxTokens: 3000,
} as const;

export const WHATSAPP_DEFAULT_MODEL = "gpt-4o-mini";

let modelCache: { model: string; expires: number } | null = null;

/**
 * Same model setting as the website chat: Master AI Settings' primary model when master AI is
 * on, else gpt-4o-mini. WhatsApp keeps calling OpenAI with the business's own key (or the
 * server key), so a non-OpenAI master provider (e.g. Gemini) falls back to gpt-4o-mini.
 */
export async function resolveWhatsappModel(): Promise<string> {
  const now = Date.now();
  if (modelCache && modelCache.expires > now) return modelCache.model;
  let model = WHATSAPP_DEFAULT_MODEL;
  try {
    const master = await storage.getMasterAiSettings();
    const provider = (master?.primaryProvider || "openai").toLowerCase();
    if (master?.masterEnabled && master.primaryApiKey && provider === "openai" && master.primaryModel) {
      model = master.primaryModel;
    }
  } catch (err) {
    console.warn("[WhatsApp Auto-Reply] Master AI settings unreadable — using gpt-4o-mini:", (err as Error)?.message);
  }
  modelCache = { model, expires: now + 30_000 };
  return model;
}

/** Tests only. */
export function clearWhatsappModelCache(): void {
  modelCache = null;
}

/** A model the account's key can't use (renamed / not enabled) → retry with gpt-4o-mini. */
export function isModelUnavailableError(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  const msg = String(err?.message || err?.error?.message || "");
  return (status === 404 || status === 400) && /model/i.test(msg);
}

export const WHATSAPP_EXTRA_TOOL_NAMES = new Set(["list_available_slots", "book_appointment", "track_order", "initiate_return"]);

/**
 * The website's appointment tool definitions, adjusted for WhatsApp: no visual calendar, and the
 * phone defaults to the customer's WhatsApp number (we never ask for it on WhatsApp).
 */
export function whatsappAppointmentTools(selected: any[]): any[] {
  return selected.map(tool => {
    const name = tool?.function?.name;
    if (name !== "list_available_slots" && name !== "book_appointment") return tool;
    const t = JSON.parse(JSON.stringify(tool));
    if (name === "list_available_slots") {
      t.function.description = t.function.description.replace(
        /Show visual calendar for BROWSING availability\.[^]*?(?=Use when:)/,
        "List open appointment slots for BROWSING availability (sent to the customer as a short numbered WhatsApp list). Start from TODAY unless the customer asks for another date. ",
      );
    } else {
      t.function.description += " On WhatsApp the customer's phone number is already known: never ask for it; omit patient_phone unless the customer gives a different number. Ask only for their name if you don't have it.";
      const req: string[] = t.function.parameters.required || [];
      t.function.parameters.required = req.filter((r: string) => r !== "patient_phone");
      t.function.parameters.properties.patient_phone.description = "Optional on WhatsApp — defaults to the customer's WhatsApp number.";
    }
    return t;
  });
}

function to12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * list_available_slots result → a numbered list the model repeats as-is. At most 3 days and 10
 * slots in total so it fits one WhatsApp message.
 */
export function formatSlotsForWhatsapp(result: { success?: boolean; data?: any; message?: string }, opts: { maxDays?: number; maxPerDay?: number; maxTotal?: number } = {}): { text: string; count: number } {
  const slots: Record<string, string[]> = result?.data?.slots || {};
  const days = Object.keys(slots).sort();
  if (!result?.success || days.length === 0) {
    return { text: result?.message || "No available slots were found.", count: 0 };
  }
  const maxDays = opts.maxDays ?? 3;
  const maxPerDay = opts.maxPerDay ?? 4;
  const maxTotal = opts.maxTotal ?? 10;
  const lines: string[] = [];
  let n = 0;
  for (const day of days.slice(0, maxDays)) {
    let label = day;
    try { label = format(parseISO(day), "EEE d MMM"); } catch { /* keep ISO */ }
    for (const time of slots[day].slice(0, maxPerDay)) {
      if (n >= maxTotal) break;
      n++;
      lines.push(`${n}. ${label}, ${to12h(time)}  [book with appointment_date=${day} appointment_time=${time}]`);
    }
  }
  return {
    text: `Open slots (numbered; the customer can reply with a number):\n${lines.join("\n")}`,
    count: n,
  };
}

/** track_order result → plain lines (no cards on WhatsApp). */
export function formatOrdersForWhatsapp(result: { success?: boolean; data?: any; message?: string; error?: string }): string {
  if (!result?.success) return result?.error || result?.message || "Order lookup is not available right now.";
  const orders: any[] = result?.data?.orders || [];
  if (!orders.length) return result?.message || "No order found.";
  const lines = orders.map((o, i) => {
    const parts = [`${i + 1}. Order ${o.orderId}: ${o.statusLabel || o.status}`];
    if (o.product) parts.push(`item: ${o.product}`);
    if (o.amount) parts.push(`amount: ${o.amount}`);
    if (o.courier) parts.push(`courier: ${o.courier}`);
    if (o.trackingNumber) parts.push(`tracking no.: ${o.trackingNumber}`);
    if (o.estimatedDelivery) parts.push(`expected: ${o.estimatedDelivery}`);
    return parts.join(" | ");
  });
  return `${result.message || "Order details"}\n${lines.join("\n")}`;
}

/**
 * Make a reply safe for WhatsApp text: no HTML, no markdown tables / headers / links,
 * **bold** → *bold*. Used on replies produced after the appointment / order tools.
 */
export function toWhatsAppText(text: string): string {
  if (!text) return text;
  let out = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, "");
  // Markdown tables → "a — b — c" lines (separator rows dropped).
  out = out
    .split("\n")
    .filter(line => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line))
    .map(line => (/^\s*\|.*\|\s*$/.test(line) ? line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()).filter(Boolean).join(" — ") : line))
    .join("\n");
  out = out.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "*$1*");
  out = out.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/__(.+?)__/g, "_$1_");
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$2").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A Train Chroney fallback template for WhatsApp: the phone is always known there, name and email
 * are treated as not yet known ({{if_missing_name}}…{{/if_missing_name}} kept).
 */
export function processWhatsappFallbackTemplate(template: string): string {
  let out = template;
  const known: Record<string, boolean> = { phone: true, mobile: true, whatsapp: true, email: false, name: false };
  for (const [field, has] of Object.entries(known)) {
    const missing = new RegExp(`\\{\\{if_missing_${field}\\}\\}([\\s\\S]*?)\\{\\{\\/if_missing_${field}\\}\\}`, "gi");
    const present = new RegExp(`\\{\\{if_has_${field}\\}\\}([\\s\\S]*?)\\{\\{\\/if_has_${field}\\}\\}`, "gi");
    out = has ? out.replace(missing, "").replace(present, "$1") : out.replace(missing, "$1").replace(present, "");
  }
  return out.replace(/\n\s*\n\s*\n/g, "\n\n").replace(/\s{2,}/g, " ").trim();
}
