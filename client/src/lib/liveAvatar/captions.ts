/**
 * Live captions for the avatar panel: the sentence of the spoken answer that
 * the playback clock says is being heard right now.
 */
const SENTENCE_END = /[.!?।]+["')\]]*\s+/g;

export function captionAt(spokenText: string, offset: number, maxChars = 160): string {
  const text = (spokenText || "").replace(/\s+/g, " ");
  if (!text.trim()) return "";
  const at = Math.max(0, Math.min(text.length, Math.floor(offset)));
  // Sentence boundaries (end index of each sentence including trailing space).
  let start = 0;
  let end = text.length;
  SENTENCE_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(text))) {
    const boundary = m.index + m[0].length;
    if (boundary <= at) {
      start = boundary;
    } else {
      end = m.index + m[0].trimEnd().length;
      break;
    }
  }
  // At the very start nothing has been heard yet: show the first sentence.
  let caption = text.slice(start, end).trim();
  if (!caption && start > 0) caption = text.slice(0, start).trim();
  if (caption.length > maxChars) {
    // Keep the part around the playback position.
    const rel = Math.max(0, at - start);
    const from = Math.max(0, Math.min(caption.length - maxChars, rel - Math.floor(maxChars / 2)));
    caption = `${from > 0 ? "…" : ""}${caption.slice(from, from + maxChars).trim()}${from + maxChars < caption.length ? "…" : ""}`;
  }
  return caption;
}
