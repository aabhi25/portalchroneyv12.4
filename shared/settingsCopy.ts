/**
 * "Copy settings" on an account group's page: what can be copied from one account to others, and
 * the pure rules for comparing and merging. Passwords, API keys, CRM logins, WhatsApp and phone
 * numbers, products, knowledge, leads and chats are deliberately not in this list.
 */
export type CopyItemKind = "fields" | "avatar" | "lead" | "instructions" | "journeys" | "menu";

export interface CopyItem {
  key: string;
  group: string;
  label: string;
  description: string;
  kind: CopyItemKind;
  /** widget_settings fields, for "fields" and "avatar". */
  fields?: string[];
}

export const COPY_ITEMS: CopyItem[] = [
  { key: "chat-colours", group: "Appearance", label: "Chat colours", description: "The chat's main colours", kind: "fields", fields: ["chatColor", "chatColorEnd"] },
  { key: "header-text", group: "Appearance", label: "Chat title", description: "The name at the top of the chat", kind: "fields", fields: ["widgetHeaderText"] },
  { key: "chat-button", group: "Appearance", label: "Chat button style", description: "How the chat button looks and moves", kind: "fields", fields: ["buttonStyle", "buttonAnimation"] },
  { key: "chat-size", group: "Appearance", label: "Size and position", description: "Chat size, button position and text size", kind: "fields", fields: ["sizePreset", "widgetWidth", "widgetHeight", "widgetPosition", "bubbleSize", "pillBottomOffset", "pillSideOffset", "panelTopOffset", "chatFontSize"] },
  { key: "footer", group: "Appearance", label: "Footer text", description: "The line under the chat box", kind: "fields", fields: ["footerLabelEnabled", "footerLabelText"] },
  { key: "assistant-picture", group: "Appearance", label: "Assistant picture", description: "The picture shown next to messages", kind: "avatar", fields: ["avatarType", "avatarUrl"] },

  { key: "welcome", group: "Welcome & behaviour", label: "Welcome message", description: "The first message in a chat", kind: "fields", fields: ["welcomeMessageType", "welcomeMessage"] },
  { key: "tone", group: "Welcome & behaviour", label: "Tone and reply length", description: "Personality and how long replies are", kind: "fields", fields: ["personality", "responseLength"] },
  { key: "auto-open", group: "Welcome & behaviour", label: "Auto-open and opening sound", description: "Whether the chat opens by itself, and its sound", kind: "fields", fields: ["autoOpenChat", "autoOpenFrequency", "openingSoundEnabled", "openingSoundStyle"] },
  { key: "languages", group: "Welcome & behaviour", label: "Language choice", description: "The language picker in the chat", kind: "fields", fields: ["languageSelectorEnabled", "availableLanguages"] },
  { key: "starters", group: "Welcome & behaviour", label: "Starter questions", description: "Suggested questions at the start of a chat", kind: "fields", fields: ["conversationStarters", "conversationStartersEnabled", "showStartersOnPill"] },

  { key: "message-nudges", group: "Nudges & banners", label: "Message nudges", description: "Timed messages that continue in the chat", kind: "fields", fields: ["messageNudgeEnabled", "messageNudgeItems"] },
  { key: "proactive", group: "Nudges & banners", label: "Proactive bubble", description: "The bubble next to the chat button", kind: "fields", fields: ["proactiveNudgeEnabled", "proactiveNudgeDelay", "proactiveNudgeMessage", "proactiveNudgeMessages", "proactiveNudgeRepeat", "proactiveNudgeBgColor", "proactiveNudgeBgColorEnd", "proactiveNudgeTextColor"] },
  { key: "inactivity", group: "Nudges & banners", label: "Inactivity nudge", description: "The \"Still there?\" message inside the chat", kind: "fields", fields: ["inactivityNudgeEnabled", "inactivityNudgeDelay", "inactivityNudgeMessage", "inactivityNudgeMessages", "smartNudgeEnabled"] },
  { key: "center-banner", group: "Nudges & banners", label: "Center banner", description: "The pop-up in the middle of the page", kind: "fields", fields: ["centerBannerEnabled", "centerBannerDelay", "centerBannerTitle", "centerBannerDescription", "centerBannerButtonText", "centerBannerShowOnce", "centerBannerBackgroundStyle", "centerBannerStartColor", "centerBannerEndColor", "centerBannerTextColor", "centerBannerImageUrl"] },
  { key: "reengagement-banner", group: "Nudges & banners", label: "Re-engagement banner", description: "Shown after the center banner is closed", kind: "fields", fields: ["reengagementBannerEnabled", "reengagementBannerDelay", "reengagementBannerTitle", "reengagementBannerDescription", "reengagementBannerButtonText"] },

  { key: "lead-training", group: "Training", label: "Lead training", description: "Which details to ask for, and when. Phone verification, CAPTCHA and the conversion page stay on each account", kind: "lead" },
  { key: "instructions", group: "Training", label: "Instructions", description: "How the assistant should respond", kind: "instructions" },
  { key: "journeys", group: "Training", label: "Journeys", description: "Forms and guided conversations. Pick which ones below", kind: "journeys" },
  { key: "menu", group: "Training", label: "Chat menu & forms", description: "The menu start screen and its buttons", kind: "menu" },
];

export const COPY_ITEM_GROUPS = ["Appearance", "Welcome & behaviour", "Nudges & banners", "Training"];

export const copyItem = (key: string) => COPY_ITEMS.find((item) => item.key === key);

/** Same text for the same value, whatever order the keys are in. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((k) => record[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Empty text and no value count as the same. */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === "" || v === undefined ? null : v);
  return stableStringify(norm(a)) === stableStringify(norm(b));
}

/** "proactiveNudgeDelay" → "Proactive nudge delay". */
export function humanizeField(field: string): string {
  const words = field.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FIELD_LABELS: Record<string, string> = {
  chatColor: "Main colour",
  chatColorEnd: "Second colour",
  widgetHeaderText: "Chat title",
  buttonStyle: "Button style",
  buttonAnimation: "Button animation",
  sizePreset: "Size",
  widgetWidth: "Chat width",
  widgetHeight: "Chat height",
  widgetPosition: "Position",
  bubbleSize: "Button size",
  pillBottomOffset: "Distance from the bottom",
  pillSideOffset: "Distance from the side",
  panelTopOffset: "Distance from the top",
  chatFontSize: "Text size",
  footerLabelEnabled: "Footer text shown",
  footerLabelText: "Footer text",
  avatarType: "Picture type",
  avatarUrl: "Picture",
  welcomeMessageType: "Welcome type",
  responseLength: "Reply length",
  autoOpenChat: "Opens by itself",
  languageSelectorEnabled: "Language picker shown",
  availableLanguages: "Languages offered",
  conversationStarters: "Questions",
  conversationStartersEnabled: "Starter questions shown",
  showStartersOnPill: "Also shown on the chat button",
  messageNudgeEnabled: "Message nudges",
  messageNudgeItems: "Messages",
  proactiveNudgeMessage: "First message",
  proactiveNudgeDelay: "First message after",
  proactiveNudgeMessages: "Follow-up messages",
  proactiveNudgeRepeat: "On every page load",
  inactivityNudgeMessage: "Message",
  inactivityNudgeDelay: "After",
  inactivityNudgeMessages: "Follow-up messages",
  smartNudgeEnabled: "AI writes the follow-up",
};

/** The name of a setting as people know it. */
export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? humanizeField(field);

/** One line of the details panel. */
export interface DetailRow {
  label: string;
  value: string;
  kind?: "color" | "image";
}

export interface DetailSection {
  title?: string;
  rows: DetailRow[];
}

function languageName(code: string): string {
  if (code === "auto") return "Detect automatically";
  if (code === "hinglish") return "Hinglish";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const seconds = (value: unknown) => `${value} second${Number(value) === 1 ? "" : "s"}`;

function plainValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (value === "true") return "On";
  if (value === "false") return "Off";
  return typeof value === "string" ? value : stableStringify(value);
}

function asList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* plain text */ }
  }
  return null;
}

/** The complete value of one setting, as lines for the details panel. */
export function fieldDetailRows(field: string, value: unknown): DetailRow[] {
  const label = fieldLabel(field);
  if (field === "availableLanguages") {
    const list = asList(value) ?? [];
    return [{ label, value: list.length ? list.map((code) => languageName(String(code))).join(", ") : "(empty)" }];
  }
  const list = asList(value);
  if (list) {
    if (list.length === 0) return [{ label, value: "(none)" }];
    const rows: DetailRow[] = [];
    list.forEach((entry, index) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
      if (record && "delay" in record && "message" in record) {
        const text = String(record.message ?? "").trim();
        if (text) rows.push({ label: `Message ${index + 1}, after ${seconds(record.delay)}`, value: text });
        return;
      }
      const text = record ? record.question ?? record.text ?? record.label ?? record.message ?? stableStringify(record) : entry;
      rows.push({ label: label === "Questions" ? `Question ${index + 1}` : `${label} ${index + 1}`, value: String(text) });
    });
    return rows.length ? rows : [{ label, value: "(none written)" }];
  }
  if (/color/i.test(field) && typeof value === "string" && value.trim()) return [{ label, value, kind: "color" }];
  if (/(imageUrl|avatarUrl)$/.test(field) && typeof value === "string" && value.trim()) return [{ label, value, kind: "image" }];
  if (/delay/i.test(field) && value !== null && value !== undefined && value !== "") return [{ label, value: seconds(value) }];
  return [{ label, value: plainValue(value) }];
}

/** A short version of a value for the review screen. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (value === "true") return "On";
  if (value === "false") return "Off";
  if (typeof value === "string") {
    if (/^\[[\s\S]*\]$/.test(value.trim())) {
      try {
        const list = JSON.parse(value);
        if (Array.isArray(list)) return `${list.length} item${list.length === 1 ? "" : "s"}`;
      } catch { /* plain text */ }
    }
    return value.length > 70 ? `${value.slice(0, 70)}…` : value;
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "Custom";
  return String(value);
}

type InstructionItem = { id?: string; text?: string; [key: string]: unknown };

/** The instructions in a stored value: a JSON list, or older free text as one instruction. */
export function parseInstructionList(raw: string | null | undefined): InstructionItem[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === "object");
    return [];
  } catch {
    return [{ text: raw, type: "always" }];
  }
}

const instructionText = (item: InstructionItem) => String(item.text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * "add": the target keeps its own and gets the source's it doesn't have yet (same text = same).
 * "replace": the target gets exactly the source's. `added` counts the ones new to the target.
 */
export function mergeInstructions(
  targetRaw: string | null | undefined,
  sourceRaw: string | null | undefined,
  mode: "add" | "replace",
  newId: () => string,
): { value: string; added: number; removed: number } {
  const target = parseInstructionList(targetRaw);
  const source = parseInstructionList(sourceRaw);
  const targetTexts = new Set(target.map(instructionText));
  const sourceTexts = new Set(source.map(instructionText));
  const fresh = source.filter((item) => !targetTexts.has(instructionText(item)));
  if (mode === "replace") {
    return {
      value: JSON.stringify(source),
      added: fresh.length,
      removed: target.filter((item) => !sourceTexts.has(instructionText(item))).length,
    };
  }
  const ids = new Set(target.map((item) => item.id));
  const seen = new Set<string>();
  const additions = fresh
    .filter((item) => {
      const text = instructionText(item);
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .map((item) => (item.id && !ids.has(item.id) ? item : { ...item, id: newId() }));
  return { value: JSON.stringify([...target, ...additions]), added: additions.length, removed: 0 };
}

/** The source account's names and web address that appear in the text, unless the target shares them. */
export function mentionedNames(text: string, names: (string | null | undefined)[], targetName: string): string[] {
  const haystack = text.toLowerCase();
  const target = targetName.toLowerCase();
  const found = new Set<string>();
  for (const name of names) {
    const phrase = (name || "").trim();
    if (phrase.length < 4) continue;
    const lower = phrase.toLowerCase();
    if (target.includes(lower)) continue;
    if (haystack.includes(lower)) found.add(phrase);
  }
  return Array.from(found);
}

/** "https://www.jaro.in/mba" → "jaro.in". */
export function websiteHost(website: string | null | undefined): string | null {
  if (!website || !website.trim()) return null;
  try {
    const url = new URL(website.includes("://") ? website.trim() : `https://${website.trim()}`);
    return url.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export interface CopyRequest {
  sourceAccountId: string;
  targetIds: string[];
  items: string[];
  instructionsMode: "add" | "replace";
  /** Which of the source's journeys, when "journeys" is ticked. */
  journeyIds: string[];
}

export interface CopyChange {
  key: string;
  label: string;
  details: { field: string; from: string; to: string }[];
}

export interface CopyWarning {
  key: string;
  label: string;
  message: string;
}

export interface CopyPreviewTarget {
  businessAccountId: string;
  name: string;
  changes: CopyChange[];
  warnings: CopyWarning[];
}

export interface CopyResultTarget {
  businessAccountId: string;
  name: string;
  ok: boolean;
  /** Labels of the items that changed; empty when the account already matched. */
  changed: string[];
  warnings: CopyWarning[];
  error?: string;
}
