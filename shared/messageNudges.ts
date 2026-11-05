/**
 * Message nudges: up to 3 messages shown one after another above the closed chat button. The ones a
 * visitor saw open as the chat's first messages, and are saved when the visitor first replies.
 */
export const MESSAGE_NUDGE_SLOTS = 3;
export const MESSAGE_NUDGE_MAX_CHARS = 500;
export const MESSAGE_NUDGE_MIN_DELAY = 5;
export const MESSAGE_NUDGE_MAX_DELAY = 120;
export const MESSAGE_NUDGE_DEFAULT_DELAY = 20;

export type MessageNudgeItem = { message: string; delay: number };

/**
 * Always exactly 3 slots, so a message keeps its number when another is left empty. The text is not
 * trimmed: the settings screen saves while the business is still typing.
 */
export function normalizeMessageNudgeItems(raw: unknown): MessageNudgeItem[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: MESSAGE_NUDGE_SLOTS }, (_, i) => {
    const item = list[i] && typeof list[i] === "object" ? (list[i] as Record<string, unknown>) : {};
    const delay = Math.round(Number(item.delay));
    return {
      message: typeof item.message === "string" ? item.message.slice(0, MESSAGE_NUDGE_MAX_CHARS) : "",
      delay: Number.isFinite(delay)
        ? Math.min(MESSAGE_NUDGE_MAX_DELAY, Math.max(MESSAGE_NUDGE_MIN_DELAY, delay))
        : MESSAGE_NUDGE_DEFAULT_DELAY,
    };
  });
}

/** The text of the messages at these numbers, in order; unknown numbers and empty slots are dropped. */
export function shownMessageNudges(raw: unknown, indexes: unknown): { index: number; text: string }[] {
  if (!Array.isArray(indexes)) return [];
  const items = normalizeMessageNudgeItems(raw);
  return items
    .map((item, index) => ({ index, text: item.message.trim() }))
    .filter(({ index, text }) => text && indexes.includes(index));
}
