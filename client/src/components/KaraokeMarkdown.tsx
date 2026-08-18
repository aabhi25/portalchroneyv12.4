import { useMemo, type ReactNode } from "react";

/**
 * Block-level karaoke over a FORMATTED Markdown answer while it is spoken.
 *
 * The word-level highlight (KaraokeText) needs a raw character offset, which
 * has no meaning inside rendered LaTeX or images. So once the formatted
 * version of a spoken answer is available, we degrade gracefully to coarser
 * granularity: split the Markdown into highlight UNITS, estimate how far
 * through the answer the voice is as a FRACTION of the raw spoken transcript,
 * and map that fraction onto the units by their approximate spoken length:
 *   - units already spoken render normally,
 *   - the unit being spoken right now gets a tinted background,
 *   - units not yet reached are dimmed.
 *
 * Units are finer than blocks: a long paragraph is split into SENTENCES that
 * render inline inside one flowing paragraph (via `renderInline`), so the
 * highlight advances sentence by sentence instead of tinting the whole
 * paragraph at once. List items, headings, display math and code fences stay
 * atomic — splitting them would break their Markdown grammar.
 *
 * Images get zero spoken weight (the voice never reads a diagram aloud);
 * they reveal together with the unit right before them.
 *
 * Rendering is delegated to `renderBlock` / `renderInline` so the host page's
 * exact ReactMarkdown configuration (KaTeX, link handling, image styling)
 * is reused instead of duplicated.
 */

interface Unit {
  md: string;
  /** Approximate number of characters the voice spends on this unit. */
  weight: number;
  isImageOnly: boolean;
}

interface RenderGroup {
  /** One flowing paragraph made of inline sentence units. */
  kind: "sentences" | "block";
  /** Indexes into the flat unit list. `block` groups have exactly one. */
  unitIdxs: number[];
}

/**
 * Split Markdown source into segments: paragraphs and single list items.
 *
 * Structure-preserving: fenced code blocks and display-math ($$ … $$) regions
 * are atomic — a blank line inside them does NOT end the block, so each block
 * is always a complete, independently parseable Markdown fragment. Lists are
 * split per item only when they are flat (no indented continuation/nested
 * lines); nested lists stay one block so their grammar survives.
 */
function splitSegments(markdown: string): string[] {
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
  return segments;
}

/**
 * Split a plain paragraph into sentences WITHOUT cutting inside inline math
 * ($…$), inline code (`…`) or bold/emphasis runs. A boundary is
 * [.!?] (+ closing quotes/brackets) followed by whitespace. Decimals like
 * "9.8" never match (no whitespace after the dot); short fragments merge
 * into their neighbour so "e.g. " style splits don't create confetti.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inMath = false;
  let inCode = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "`") inCode = !inCode;
    else if (c === "$" && !inCode) inMath = !inMath;
    else if (!inMath && !inCode && /[.!?]/.test(c)) {
      // absorb closing quotes/brackets and repeated punctuation
      let j = i + 1;
      while (j < text.length && /[.!?)"'\u201D\u2019\]]/.test(text[j])) j++;
      if (j >= text.length || /\s/.test(text[j])) {
        const s = text.slice(start, j).trim();
        if (s) out.push(s);
        while (j < text.length && /\s/.test(text[j])) j++;
        start = j;
        i = j - 1;
      }
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);

  // Merge fragments too short to be a real sentence ("e.g.", "Dr.", "1.")
  // into the following piece — they are almost always abbreviations.
  const merged: string[] = [];
  for (const s of out) {
    if (merged.length > 0 && (merged[merged.length - 1].length < 20 || s.length < 12)) {
      merged[merged.length - 1] += " " + s;
    } else {
      merged.push(s);
    }
  }
  return merged;
}

function makeUnit(md: string): Unit {
  const isImageOnly = /^!\[[^\]]*\]\([^)]*\)$/.test(md.trim());
  return { md, weight: isImageOnly ? 0 : spokenWeight(md), isImageOnly };
}

/** True when a segment is a plain flowing paragraph safe to sentence-split:
 *  not a heading, list, blockquote, fence, table, display math or image. */
function isPlainParagraph(seg: string): boolean {
  if (seg.includes("\n")) return false;
  const t = seg.trim();
  if (/^(#{1,6}\s|>|```|~~~|\||!\[)/.test(t)) return false;
  if (/^([-*+]|\d+[.)])\s/.test(t)) return false;
  if (t.includes("$$")) return false;
  return true;
}

export function buildUnits(markdown: string): { units: Unit[]; groups: RenderGroup[] } {
  const units: Unit[] = [];
  const groups: RenderGroup[] = [];
  const pushBlock = (md: string) => {
    units.push(makeUnit(md));
    groups.push({ kind: "block", unitIdxs: [units.length - 1] });
  };

  for (const seg of splitSegments(markdown)) {
    const lines = seg.split("\n");
    const flatList =
      lines.length > 1 &&
      lines.every((l) => /^([-*+]|\d+[.)])\s/.test(l)); // no indentation ⇒ flat
    if (flatList) {
      for (const line of lines) pushBlock(line);
      continue;
    }
    if (isPlainParagraph(seg)) {
      const sentences = splitSentences(seg);
      if (sentences.length > 1) {
        const idxs: number[] = [];
        for (const s of sentences) {
          units.push(makeUnit(s));
          idxs.push(units.length - 1);
        }
        groups.push({ kind: "sentences", unitIdxs: idxs });
        continue;
      }
    }
    pushBlock(seg);
  }
  return { units, groups };
}

/**
 * Rough estimate of how many spoken-transcript characters correspond to this
 * unit. Markdown/LaTeX syntax doesn't get spoken, and a compact formula like
 * \frac{3}{5} is verbalized ("three fifths"), so math spans get a flat weight.
 */
function spokenWeight(md: string): number {
  const MATH_SPOKEN_WEIGHT = 14;
  let t = md;
  // Math spans → flat weight placeholder
  // Non-space placeholder: a space run would be trimmed away for a
  // display-math-only block, collapsing its weight to 1.
  t = t.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g,
    "M".repeat(MATH_SPOKEN_WEIGHT));
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
  renderInline,
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
  /**
   * Host-provided INLINE renderer (paragraphs → spans) used for sentence
   * units, so a split paragraph still flows as one paragraph. When absent,
   * paragraphs are not sentence-split and highlight at block granularity.
   */
  renderInline?: (md: string) => ReactNode;
}) {
  const { units, groups } = useMemo(() => {
    if (renderInline) return buildUnits(markdown);
    // No inline renderer → legacy block-only behaviour (no sentence-splitting).
    const u: Unit[] = [];
    const g: RenderGroup[] = [];
    const segments = splitSegments(markdown);
    for (const seg of segments) {
      const lines = seg.split("\n");
      const flatList = lines.length > 1 && lines.every((l) => /^([-*+]|\d+[.)])\s/.test(l));
      const parts = flatList ? lines : [seg];
      for (const p of parts) {
        u.push(makeUnit(p));
        g.push({ kind: "block", unitIdxs: [u.length - 1] });
      }
    }
    return { units: u, groups: g };
  }, [markdown, !!renderInline]);

  const totalWeight = units.reduce((s, b) => s + b.weight, 0);
  const fraction = rawTextLength > 0 ? Math.min(1, Math.max(0, offset / rawTextLength)) : 0;
  const target = fraction * totalWeight;

  // Find the unit currently being spoken: first unit whose cumulative
  // weight range contains `target`. Image-only units are never "current" —
  // they inherit the state of the unit before them.
  let cum = 0;
  let currentIdx = units.length; // past the end ⇒ everything spoken
  for (let i = 0; i < units.length; i++) {
    if (units[i].weight === 0) continue;
    if (target < cum + units[i].weight) {
      currentIdx = i;
      break;
    }
    cum += units[i].weight;
  }

  // An image unit reveals with the unit before it: treat it as spoken as
  // soon as its predecessor is spoken or current.
  const stateOf = (i: number): "spoken" | "current" | "upcoming" => {
    if (units[i].isImageOnly) {
      // find previous non-image unit
      let p = i - 1;
      while (p >= 0 && units[p].isImageOnly) p--;
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
      {groups.map((grp, gi) => {
        if (grp.kind === "sentences" && renderInline) {
          // One flowing paragraph; each sentence is an inline span with its
          // own highlight state, wrapping across lines like normal prose.
          return (
            <div key={gi} style={{ margin: "0 0 0.5rem 0" }}>
              {grp.unitIdxs.map((ui, si) => {
                const state = stateOf(ui);
                return (
                  <span
                    key={si}
                    style={{
                      opacity: state === "upcoming" ? 0.4 : 1,
                      backgroundColor: state === "current" ? `${highlightColor}1a` : undefined,
                      borderRadius: state === "current" ? "4px" : undefined,
                      boxDecorationBreak: "clone",
                      WebkitBoxDecorationBreak: "clone",
                      transition: "opacity 240ms ease, background-color 240ms ease",
                    }}
                  >
                    {renderInline(units[ui].md)}
                    {si < grp.unitIdxs.length - 1 ? " " : null}
                  </span>
                );
              })}
            </div>
          );
        }
        const ui = grp.unitIdxs[0];
        const state = stateOf(ui);
        return (
          <div
            key={gi}
            style={{
              opacity: state === "upcoming" ? 0.4 : 1,
              backgroundColor: state === "current" ? `${highlightColor}1a` : undefined,
              borderRadius: state === "current" ? "6px" : undefined,
              padding: "2px 6px",
              margin: "0 -6px",
              transition: "opacity 240ms ease, background-color 240ms ease",
            }}
          >
            {renderBlock(units[ui].md)}
          </div>
        );
      })}
    </div>
  );
}
