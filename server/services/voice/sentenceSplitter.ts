/**
 * Incremental sentence splitter for "speak while writing".
 *
 * The chat pipeline streams the answer as small text deltas. Voice mode wants
 * to hand each COMPLETE sentence to text-to-speech the moment it exists, so
 * the student hears the first sentence while the rest is still being written.
 *
 * `push(delta)` returns zero or more finished segments; `flush()` returns the
 * remainder at the end of the answer. Segments are exact substrings of the
 * input (trailing whitespace included), so joining every segment reproduces
 * the streamed Markdown byte for byte — the display text and the spoken text
 * can be sent to the client together, segment by segment.
 *
 * A boundary is:
 *   - ". ", "! ", "? ", "… ", "। ", "॥ " (optionally after a closing quote,
 *     bracket or Markdown emphasis marker), or a line break;
 *   - but NOT a decimal ("3.14"), an abbreviation ("e.g.", "Dr.", "Fig."), an
 *     initial ("A. P. J."), a numbered-list marker ("1. "), or anything inside
 *     inline/display maths ($…$, $$…$$) or a code fence;
 *   - and a clause longer than ~180 characters with no sentence end is flushed
 *     at its last comma/semicolon/colon (or, past a hard cap, its last space),
 *     so a run-on sentence never delays speech indefinitely.
 *
 * A boundary is only taken once the segment has at least `minChars` of text,
 * so "Yes." or a short heading is merged with what follows instead of
 * becoming its own tiny clip.
 */

const ABBREVIATIONS = new Set([
  'eg', 'ie', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'no', 'nos', 'fig', 'figs',
  'eq', 'eqn', 'approx', 'sr', 'jr', 'viz', 'ch', 'pg', 'pp', 'cf', 'al', 'inc', 'ltd',
  'co', 'dept', 'govt', 'max', 'min', 'avg', 'ex', 'vol', 'sec', 'ref', 'resp', 'smt', 'shri',
]);

const SENTENCE_END = '.!?…।॥';
const CLOSERS = '"\'”’)]*_';

export interface SentenceSplitterOptions {
  /** Minimum trimmed length before a sentence boundary is taken. */
  minChars?: number;
  /** A clause longer than this is flushed at its last comma. */
  maxClauseChars?: number;
  /** Beyond this, flush at the last space even without a comma. */
  hardCapChars?: number;
}

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === ' ';
}

function isLetter(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z]/.test(ch);
}

export class SentenceStreamSplitter {
  private buffer = '';
  private readonly minChars: number;
  private readonly maxClauseChars: number;
  private readonly hardCapChars: number;

  constructor(options: SentenceSplitterOptions = {}) {
    this.minChars = options.minChars ?? 12;
    this.maxClauseChars = options.maxClauseChars ?? 180;
    this.hardCapChars = options.hardCapChars ?? 320;
  }

  /** Feed the next streamed delta; returns any segments it completed. */
  push(delta: string): string[] {
    if (delta) this.buffer += delta;
    return this.drain(false);
  }

  /** End of stream: returns every remaining segment (possibly one). */
  flush(): string[] {
    const out = this.drain(true);
    if (this.buffer.length > 0) {
      if (this.buffer.trim()) out.push(this.buffer);
      else if (out.length > 0) out[out.length - 1] += this.buffer;
      this.buffer = '';
    }
    return out;
  }

  /** Text received but not yet emitted. */
  get pending(): string {
    return this.buffer;
  }

  private drain(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const end = this.findBoundary(this.buffer, final);
      if (end <= 0) break;
      out.push(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end);
    }
    return out;
  }

  /**
   * Index just past the first acceptable segment in `buf`, or -1 when none is
   * complete yet. `buf` always starts outside maths/code (segments never end
   * inside them), so that state is tracked from zero on each scan.
   */
  private findBoundary(buf: string, final: boolean): number {
    let inCode = false;
    let inDisplayMath = false;
    let inInlineMath = false;
    let lineStart = 0;
    let lastClauseBreak = -1;
    let lastSpace = -1;

    const extendWhitespace = (from: number): number => {
      let j = from;
      while (j < buf.length && isSpace(buf[j])) j++;
      return j;
    };
    const longEnough = (end: number) => buf.slice(0, end).trim().length >= this.minChars;

    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i];

      if (ch === '`' && buf.startsWith('```', i)) {
        inCode = !inCode;
        i += 2;
        continue;
      }
      if (inCode) {
        if (ch === '\n') lineStart = i + 1;
        continue;
      }
      if (ch === '$' && buf[i - 1] !== '\\') {
        if (buf[i + 1] === '$') {
          inDisplayMath = !inDisplayMath;
          i += 1;
        } else if (!inDisplayMath) {
          inInlineMath = !inInlineMath;
        }
        continue;
      }
      if (inDisplayMath) continue;

      if (ch === '\n') {
        inInlineMath = false; // inline maths never spans lines
        lineStart = i + 1;
        const end = extendWhitespace(i + 1);
        if (longEnough(end)) return end;
        continue;
      }
      if (inInlineMath) continue;

      if (isSpace(ch)) lastSpace = i;
      if ((ch === ',' || ch === ';' || ch === ':') && isSpace(buf[i + 1])) lastClauseBreak = i + 1;

      if (SENTENCE_END.indexOf(ch) !== -1) {
        let j = i + 1;
        while (j < buf.length && CLOSERS.indexOf(buf[j]) !== -1) j++;
        if (j >= buf.length) {
          if (!final) return -1; // can't tell yet whether this ends a sentence
        } else if (!isSpace(buf[j])) {
          continue; // "3.14", "e.g.x", "?!" … not a boundary
        }
        if (ch === '.' && !this.isSentencePeriod(buf, i, lineStart, j)) continue;
        // Punctuation + whitespace is a boundary right away (the first sentence
        // must not wait for the model's next token). A following whitespace
        // run that arrives later simply leads the next segment.
        const end = extendWhitespace(j);
        if (longEnough(end)) return end;
        continue;
      }

      // Long clause without a sentence end: break at the last comma, or past
      // the hard cap at the last space.
      if (i >= this.maxClauseChars && lastClauseBreak >= 40) {
        return extendWhitespace(lastClauseBreak);
      }
      if (i >= this.hardCapChars && lastSpace > 0) {
        return extendWhitespace(lastSpace);
      }
    }
    return -1;
  }

  /** Decide whether the '.' at `i` ends a sentence. `next` = first char after closers. */
  private isSentencePeriod(buf: string, i: number, lineStart: number, next: number): boolean {
    // Numbered list marker: the line so far is only digits (and markdown).
    const linePrefix = buf.slice(lineStart, i).replace(/[*_#>\s]/g, '');
    if (/^\d{1,3}$/.test(linePrefix)) return false;
    if (/^[a-z]$/i.test(linePrefix) && /^\s*[a-z]$/i.test(buf.slice(lineStart, i))) return false;

    // Preceding token (letters and inner dots): "e.g", "Dr", "A".
    let k = i - 1;
    while (k >= 0 && (isLetter(buf[k]) || buf[k] === '.')) k--;
    const token = buf.slice(k + 1, i);
    if (!token) return true; // after a digit / symbol: "x = 5."
    const bare = token.replace(/\./g, '').toLowerCase();
    if (token.length === 1 && /[A-Z]/.test(token) && (k < 0 || isSpace(buf[k]))) {
      // An initial ("A. P. J. Kalam") — unless it plainly ends a sentence
      // ("… Vitamin C. Next …" can't be told apart; keep them together).
      return false;
    }
    if (token.indexOf('.') !== -1 && bare.length <= 3) return false; // "e.g", "i.e", "a.m"
    if (bare === 'etc') {
      const after = buf.slice(next).replace(/^\s+/, '');
      return /^[A-Zऀ-ॿ]/.test(after);
    }
    if (ABBREVIATIONS.has(bare)) return false;
    return true;
  }
}

/** Convenience for tests and one-shot use: split a complete text. */
export function splitIntoSpeechSegments(text: string, options?: SentenceSplitterOptions): string[] {
  const splitter = new SentenceStreamSplitter(options);
  return [...splitter.push(text), ...splitter.flush()];
}
