/**
 * Phone calls: what the caller HEARS is kept short and said like a person would say it.
 *
 * The model is told "at most 2 short sentences, never a list" (calling/phonePrompt.ts) but still
 * writes written-style answers — live call 2026-10-16: a 3-item bulleted list read out for 21 s.
 * So, segment by segment as the answer streams (sentenceSplitter.ts):
 *   - a list ("- Third party liability: covers others' losses") becomes ONE sentence of its item
 *     names: "Third party liability, own damage and personal accident cover." — the details are
 *     for when they ask;
 *   - after ~PHONE_MAX_WORDS words (or PHONE_MAX_SENTENCES sentences) the rest is not spoken,
 *     except the answer's last question ("Which one do you want to know about?"), so the turn
 *     still ends by handing it back to them.
 * The kept segments are also what is saved, so the conversation history matches what was said.
 */

export const PHONE_MAX_WORDS = 30;
export const PHONE_MAX_SENTENCES = 2;

const LIST_ITEM = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;
const DEVANAGARI = /[ऀ-ॿ]/;

function words(text: string): number {
  return text.replace(/[*_#>`]/g, " ").split(/\s+/).filter(Boolean).length;
}

/** "**Third Party Liability**: Covers damages to others." → "Third Party Liability" */
function itemName(item: string): string {
  const plain = item.replace(LIST_ITEM, "").replace(/\*\*|__|`/g, "").trim();
  const head = plain.split(/\s*(?::|：|\s[–—-]\s)\s*/)[0].trim();
  const name = head && words(head) <= 7 ? head : plain;
  return name.replace(/[\s.,;:!?।]+$/, "");
}

/** The splitter flushes a very long clause at a comma: the next segment finishes that sentence. */
function endsSentence(segment: string): boolean {
  return /[.!?？…।॥]\s*["'”’)*_]*\s*$/.test(segment.trim());
}

function isQuestion(segment: string): boolean {
  return /[?？]\s*["'”’)*_]*\s*$/.test(segment.trim());
}

export class PhoneAnswerShaper {
  constructor(private readonly opts: { noQuestions?: boolean } = {}) {}
  private listItems: string[] = [];
  private spokenWords = 0;
  private sentences = 0;
  private full = false;
  private midSentence = false;
  private heldQuestion: string | null = null;
  private devanagari = false;
  /** The segments actually passed on (what is spoken and saved). */
  readonly kept: string[] = [];
  /** True when anything was dropped or rewritten. */
  changed = false;

  /** The next streamed segment; returns the segments to speak now. */
  push(segment: string): string[] {
    if (!segment || !segment.trim()) return [];
    if (DEVANAGARI.test(segment)) this.devanagari = true;
    if (LIST_ITEM.test(segment)) {
      this.listItems.push(segment);
      this.changed = true;
      return [];
    }
    return [...this.closeList(), ...this.take(segment)];
  }

  /** End of the answer: a pending list, then the held-back closing question. */
  flush(): string[] {
    const out = this.closeList();
    // The closing question — unless a question was already said (two in a row sounds like a form).
    if (this.heldQuestion && !this.kept.some(isQuestion)) {
      out.push(this.heldQuestion);
      this.kept.push(this.heldQuestion);
    }
    this.heldQuestion = null;
    return out;
  }

  /** What was spoken, as one Markdown text (saved instead of the model's full answer when changed). */
  get spokenMarkdown(): string {
    return this.kept.map((s) => s.trim()).join(" ").trim();
  }

  private closeList(): string[] {
    if (!this.listItems.length) return [];
    const names = this.listItems.map(itemName).filter(Boolean);
    this.listItems = [];
    if (!names.length) return [];
    const and = this.devanagari ? " और " : " and ";
    const sentence = names.length === 1 ? `${names[0]}. ` : `${names.slice(0, -1).join(", ")}${and}${names[names.length - 1]}. `;
    return this.take(sentence);
  }

  private take(segment: string): string[] {
    // A closing reply (refusal / goodbye) asks nothing — the core rules want every reply to end
    // with a question, which after "not interested" sounds like not listening.
    if (this.opts.noQuestions && isQuestion(segment) && this.kept.length) { this.changed = true; return []; }
    if (this.full) {
      if (isQuestion(segment)) this.heldQuestion = segment;
      this.changed = true;
      return [];
    }
    const n = words(segment);
    // Always say the first sentence and finish any sentence begun; stop before a new one that
    // would run past the limits.
    if (!this.midSentence && this.sentences > 0 && (this.sentences >= PHONE_MAX_SENTENCES || this.spokenWords + n > PHONE_MAX_WORDS)) {
      this.full = true;
      return this.take(segment);
    }
    if (!this.midSentence) this.sentences++;
    this.midSentence = !endsSentence(segment);
    this.spokenWords += n;
    this.kept.push(segment);
    return [segment];
  }
}
