/**
 * Channel tags for training items (FAQs, documents, website pages, trained URLs and Train Chroney
 * instructions). An item with no tag (NULL / empty list) is used on every channel — that is the
 * default, so accounts that never tag anything behave exactly as before. A tagged item is used
 * only on the listed channels.
 *
 * Shared by the server (knowledge selection, API validation) and the client (pickers, badges).
 */

export const KNOWLEDGE_CHANNELS = ["website", "whatsapp", "instagram", "facebook"] as const;
export type KnowledgeChannel = (typeof KNOWLEDGE_CHANNELS)[number];

export const KNOWLEDGE_CHANNEL_LABELS: Record<KnowledgeChannel, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

export function isKnowledgeChannel(value: unknown): value is KnowledgeChannel {
  return typeof value === "string" && (KNOWLEDGE_CHANNELS as readonly string[]).includes(value);
}

export type ChannelsParseResult =
  | { ok: true; channels: KnowledgeChannel[] | null }
  | { ok: false; error: string };

/**
 * Validate a `channels` value from an API request.
 *   null / [] / every channel  → null (= all channels)
 *   a subset of the 4 channels → that subset (deduplicated, canonical order)
 *   anything else              → error
 * A comma-separated string ("website,whatsapp") or a JSON array string is accepted too, for
 * multipart form uploads.
 */
export function parseChannelsInput(input: unknown): ChannelsParseResult {
  if (input === null || input === undefined || input === "") return { ok: true, channels: null };
  let list: unknown = input;
  if (typeof input === "string") {
    const s = input.trim();
    if (s === "" || s === "all") return { ok: true, channels: null };
    if (s.startsWith("[")) {
      try { list = JSON.parse(s); } catch { return { ok: false, error: "channels must be a list of channels" }; }
    } else {
      list = s.split(",").map(x => x.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(list)) return { ok: false, error: "channels must be a list of channels" };
  const picked = new Set<KnowledgeChannel>();
  for (const v of list) {
    if (!isKnowledgeChannel(v)) {
      return { ok: false, error: `Unknown channel "${String(v)}". Allowed: ${KNOWLEDGE_CHANNELS.join(", ")}` };
    }
    picked.add(v);
  }
  if (picked.size === 0 || picked.size === KNOWLEDGE_CHANNELS.length) return { ok: true, channels: null };
  return { ok: true, channels: KNOWLEDGE_CHANNELS.filter(c => picked.has(c)) };
}

/** Lenient clean-up for stored data (drops unknown values instead of failing). */
export function sanitizeChannels(input: unknown): KnowledgeChannel[] | null {
  if (!Array.isArray(input)) return null;
  const picked = new Set(input.filter(isKnowledgeChannel));
  if (picked.size === 0 || picked.size === KNOWLEDGE_CHANNELS.length) return null;
  return KNOWLEDGE_CHANNELS.filter(c => picked.has(c));
}

/**
 * Does an item tagged `channels` apply on `channel`? Untagged items apply everywhere; when no
 * channel is given (a caller that is not channel-aware) everything applies, as before.
 */
export function appliesToChannel(
  channels: readonly string[] | null | undefined,
  channel: KnowledgeChannel | null | undefined,
): boolean {
  if (!channel) return true;
  if (!channels || !Array.isArray(channels) || channels.length === 0) return true;
  return channels.includes(channel);
}

/** True when the item is limited to some channels (shown as a badge in the UI). */
export function isChannelRestricted(channels: readonly string[] | null | undefined): boolean {
  return sanitizeChannels(channels as unknown) !== null;
}

/** "All channels" or "Website, WhatsApp". */
export function describeChannels(channels: readonly string[] | null | undefined): string {
  const clean = sanitizeChannels(channels as unknown);
  if (!clean) return "All channels";
  return clean.map(c => KNOWLEDGE_CHANNEL_LABELS[c]).join(", ");
}
