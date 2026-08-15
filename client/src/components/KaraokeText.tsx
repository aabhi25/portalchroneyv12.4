/**
 * Karaoke-style rendering of an AI answer while it is being spoken aloud.
 *
 * Renders the raw spoken transcript as plain text split at a character
 * offset: everything before the offset ("already spoken") is shown in the
 * brand color, everything after is dimmed. The offset is driven by the
 * voice player's audio clock (see InlineVoiceMode), NOT by transcript
 * arrival — transcript deltas arrive far ahead of the audio, so splitting
 * on arrival would highlight the whole answer before it is heard.
 *
 * Deliberately plain text, not Markdown: the highlight boundary is a raw
 * character offset into the spoken transcript, and mapping that through a
 * Markdown renderer is not meaningful. The bubble swaps back to normal
 * Markdown rendering the moment playback finishes.
 */
export function KaraokeText({
  text,
  offset,
  fontSize,
  highlightColor = "#9333ea",
}: {
  text: string;
  /** Characters spoken so far (word-snapped by the caller). */
  offset: number;
  fontSize?: string | number;
  highlightColor?: string;
}) {
  const bounded = Math.max(0, Math.min(offset, text.length));
  const spoken = text.slice(0, bounded);
  const unspoken = text.slice(bounded);
  return (
    <p
      className="font-medium leading-relaxed whitespace-pre-wrap break-words mb-0"
      style={{ fontSize }}
      data-testid="karaoke-text"
    >
      <span
        style={{
          color: highlightColor,
          backgroundColor: `${highlightColor}1a`,
          borderRadius: "3px",
          transition: "background-color 120ms linear",
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {spoken}
      </span>
      <span style={{ opacity: 0.45 }}>{unspoken}</span>
    </p>
  );
}
