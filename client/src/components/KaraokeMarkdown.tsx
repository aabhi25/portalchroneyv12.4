import { useMemo, type ReactNode } from "react";

/**
 * Block-level karaoke over a FORMATTED Markdown answer while it is spoken.
 *
 * The word-level highlight (KaraokeText) needs a raw character offset, which
 * has no meaning inside rendered LaTeX or images. So once the formatted
 * version of a spoken answer is available, we degrade gracefully to block
 * granularity: split the Markdown into blocks (paragraphs / list items),
 * estimate how far through the answer the voice is as a FRACTION of the raw
 * spoken transcript, and map that fraction onto the blocks by their
 * approximate spoken length:
 *   - blocks already spoken render normally,
 *   - the block being spoken right now gets a tinted background,
 *   - blocks not yet reached are dimmed.
 *
 * Images get zero spoken weight (the voice never reads a diagram aloud);
 * they reveal together with the block right before them.
 *
 * Rendering of each block is delegated to `renderBlock` so the host page's
 * exact ReactMarkdown configuration (KaTeX, link handling, image styling)
 * is reused instead of duplicated.
 */

interface Block {
  md: string;
  /** Approximate number of characters the voice spends on this block. */
  weight: number;
  isImageOnly: boolean;
}

/**
 * Split Markdown source into visual blocks: paragraphs and single list items.
 *
 * Structure-preserving: fenced code blocks and display-math ($$ … $$) regions
 * are atomic — a blank line inside them does NOT end the block, so each block
 * is always a complete, independently parseable Markdown fragment. Lists are
 * split per item only when they are flat (no indented continuation/nested
 * lines); nested lists stay one block so their grammar survives.
 */
function splitBlocks(markdown: string): Block[] {
  // Phase 1: segment on blank lines, but never inside a fence or $$ block.
  const segments: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  let inMath = false;
  const flush = () => {
    const s = buf.join("\n").trim();
    if (s) segments.push(s);
    buf = [];
  };
  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (!inMath && /^(```|~~~)/.test(t)) inFence = !inFence;
    else if (!inFence) {
      // A line that both starts and ends a $$ block ("$$x$$" or a lone "$$")
      // toggles once; count occurrences to stay correct for "$$ ... $$" inline.
      const dd = (t.match(/\$\$/g) || []).length;
      if (dd % 2 === 1) inMath = !inMath;
    }
    if (t === "" && !inFence && !inMath) flush();
    else buf.push(line);
  }
  flush();

  // Phase 2: split flat lists into per-item blocks; keep everything else whole.
  const blocks: Block[] = [];
  for (const seg of segments) {
    const lines = seg.split("\n");
    const flatList =
      lines.length > 1 &&
      lines.every((l) => /^([-*+]|\d+[.)])\s/.test(l)); // no indentation ⇒ flat
    if (flatList) {
      for (const line of lines) blocks.push(makeBlock(line));
    } else {
      blocks.push(makeBlock(seg));
    }
  }
  return blocks;
}

function makeBlock(md: string): Block {
  const isImageOnly = /^!\[[^\]]*\]\([^)]*\)$/.test(md.trim());
  return { md, weight: isImageOnly ? 0 : spokenWeight(md), isImageOnly };
}

/**
 * Rough estimate of how many spoken-transcript characters correspond to this
 * block. Markdown/LaTeX syntax doesn't get spoken, and a compact formula like
 * \frac{3}{5} is verbalized ("three fifths"), so math spans get a flat weight.
 */
function spokenWeight(md: string): number {
  const MATH_SPOKEN_WEIGHT = 14;
  let t = md;
  // Math spans → flat weight placeholder
  t = t.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g,
    " ".repeat(MATH_SPOKEN_WEIGHT));
  // Images/links: keep alt/label text only
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // List markers, emphasis, headings, inline code fences
  t = t.replace(/^\s*([-*+]|\d+[.)])\s+/gm, "");
  t = t.replace(/[*_`#>~]/g, "");
  return Math.max(1, t.trim().length);
}

export function KaraokeMarkdown({
  markdown,
  rawTextLength,
  offset,
  highlightColor = "#9333ea",
  renderBlock,
}: {
  /** Formatted Markdown (LaTeX, diagrams) of the answer. */
  markdown: string;
  /** Length of the raw spoken transcript the offset refers to. */
  rawTextLength: number;
  /** Characters of the raw transcript spoken so far (audio-clocked). */
  offset: number;
  highlightColor?: string;
  /** Host-provided renderer so the page's exact Markdown config is reused. */
  renderBlock: (md: string) => ReactNode;
}) {
  const blocks = useMemo(() => splitBlocks(markdown), [markdown]);

  const totalWeight = blocks.reduce((s, b) => s + b.weight, 0);
  const fraction = rawTextLength > 0 ? Math.min(1, Math.max(0, offset / rawTextLength)) : 0;
  const target = fraction * totalWeight;

  // Find the block currently being spoken: first block whose cumulative
  // weight range contains `target`. Image-only blocks are never "current" —
  // they inherit the state of the block before them.
  let cum = 0;
  let currentIdx = blocks.length; // past the end ⇒ everything spoken
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].weight === 0) continue;
    if (target < cum + blocks[i].weight) {
      currentIdx = i;
      break;
    }
    cum += blocks[i].weight;
  }

  // An image block reveals with the block before it: treat it as spoken as
  // soon as its predecessor is spoken or current.
  const stateOf = (i: number): "spoken" | "current" | "upcoming" => {
    if (blocks[i].isImageOnly) {
      // find previous non-image block
      let p = i - 1;
      while (p >= 0 && blocks[p].isImageOnly) p--;
      if (p < 0) return "spoken";
      const prev = stateOf(p);
      return prev === "upcoming" ? "upcoming" : "spoken";
    }
    if (i < currentIdx) return "spoken";
    if (i === currentIdx) return "current";
    return "upcoming";
  };

  return (
    <div data-testid="karaoke-markdown">
      {blocks.map((b, i) => {
        const state = stateOf(i);
        return (
          <div
            key={i}
            style={{
              opacity: state === "upcoming" ? 0.4 : 1,
              backgroundColor: state === "current" ? `${highlightColor}1a` : undefined,
              borderRadius: state === "current" ? "6px" : undefined,
              padding: state === "current" ? "2px 6px" : "2px 6px",
              margin: "0 -6px",
              transition: "opacity 240ms ease, background-color 240ms ease",
            }}
          >
            {renderBlock(b.md)}
          </div>
        );
      })}
    </div>
  );
}
