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
 *     still ends by handing it back to them;
 *   - the whole turn, question included, stays near PHONE_MAX_WORDS: the second sentence waits
 *     for what follows it, and when a question follows and all three would run long, the second
 *     sentence is the one left out (real call 2026-11-23: two sentences + a question = 49 words,
 *     19 seconds of talking) — unless the caller had asked something (`callerAsked`): then the
 *     answer is kept and the question is what goes. A bare reaction ("Great!", "अच्छा, ठीक है।") is not counted as a
 *     sentence. A caller who asks for details gets more room (`relaxed`).
 * The kept segments are also what is saved, so the conversation history matches what was said.
 */

export const PHONE_MAX_WORDS = 30;
export const PHONE_MAX_SENTENCES = 2;
/** The closing question may take the turn this far past PHONE_MAX_WORDS, no further. */
const QUESTION_OVERRUN_WORDS = 6;
/** When the caller asked for details ("explain", "विस्तार से"): words and sentences allowed. */
const RELAXED_MAX_WORDS = 55;
const RELAXED_MAX_SENTENCES = 4;
const REACTION_MAX_WORDS = 3;

const WANTS_DETAIL = /\b(details?|in detail|explain|elaborate|tell me more|more about|everything about|step by step|vistaar|vistar|detail mein|samjha(o|iye|ie|do)?|poora batao|pura batao)\b|विस्तार|डिटेल|समझा(ओ|इए|इये|दो|ना)|पूरा बता/i;
const ASKS = /[?？]|^\s*(?:(?:achha|accha|ok|okay|and|aur|so|toh|to|par|but|ji|haan|अच्छा|और|तो|पर|जी|हाँ|हां)[\s,]+)*(?:what|how|when|which|who|where|why|is|are|do|does|can|could|will|kya|kitn[aie]|kab|kaise|kaun|kahan|kyun|kyon|क्या|कितन[ाीे]|कब|कैसे|कौन|कहाँ|कहां|क्यों)\b/i;
/** The caller's turn was a question (so the reply's answer matters more than its own question). */
export function callerAsked(callerText: string): boolean {
  return ASKS.test(String(callerText || ""));
}

/** The caller asked for a fuller answer. */
export function wantsDetail(callerText: string): boolean {
  return WANTS_DETAIL.test(String(callerText || ""));
}

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
  constructor(private readonly opts: { noQuestions?: boolean; relaxed?: boolean; callerAsked?: boolean } = {}) {}
  private readonly maxWords = this.opts.relaxed ? RELAXED_MAX_WORDS : PHONE_MAX_WORDS;
  private readonly maxSentences = this.opts.relaxed ? RELAXED_MAX_SENTENCES : PHONE_MAX_SENTENCES;
  private listItems: string[] = [];
  private spokenWords = 0;
  private sentences = 0;
  private full = false;
  private midSentence = false;
  private heldQuestion: string | null = null;
  /** The last allowed sentence, waiting to see whether a question follows it. */
  private pending: string[] = [];
  private pendingWords = 0;
  private pendingOpen = false;
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
    const question = this.heldQuestion && !this.kept.some(isQuestion) && !this.pending.some(isQuestion) ? this.heldQuestion : null;
    this.heldQuestion = null;
    out.push(...this.releasePending(question));
    if (question) {
      if (this.spokenWords + words(question) <= this.maxWords + QUESTION_OVERRUN_WORDS || !this.kept.length) {
        out.push(question);
        this.kept.push(question);
      } else this.changed = true;
    }
    return out;
  }

  /** Say the waiting sentence — or leave it out when it and the question after it would run long. */
  private releasePending(nextQuestion: string | null): string[] {
    if (!this.pending.length) return [];
    const held = this.pending;
    const n = this.pendingWords;
    this.pending = [];
    this.pendingWords = 0;
    this.pendingOpen = false;
    const total = this.spokenWords + n + (nextQuestion ? words(nextQuestion) : 0);
    // Too long with the question after it: they asked something → the answer stays (the question
    // then no longer fits); otherwise the question matters more than a second statement.
    const fits = nextQuestion && this.opts.callerAsked ? this.spokenWords + n <= this.maxWords + QUESTION_OVERRUN_WORDS : total <= this.maxWords + (nextQuestion ? QUESTION_OVERRUN_WORDS : 0);
    if (!fits) { this.changed = true; return []; }
    this.spokenWords += n;
    this.kept.push(...held);
    return held;
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
    // The rest of the sentence that is waiting.
    if (this.pendingOpen) {
      this.pending.push(segment);
      this.pendingWords += n;
      this.pendingOpen = !endsSentence(segment);
      return [];
    }
    // A sentence is waiting and this one starts the next.
    if (this.pending.length) {
      if (isQuestion(segment) && endsSentence(segment)) {
        const out = this.releasePending(segment);
        this.full = true;
        if (this.spokenWords + n > this.maxWords + QUESTION_OVERRUN_WORDS) { this.changed = true; return out; }
        this.spokenWords += n;
        this.kept.push(segment);
        return [...out, segment];
      }
      const out = this.releasePending(null);
      this.full = true;
      return [...out, ...this.take(segment)];
    }
    // Always say the first sentence and finish any sentence begun; stop before a new one that
    // would run past the limits.
    if (!this.midSentence && this.sentences > 0 && (this.sentences >= this.maxSentences || this.spokenWords + n > this.maxWords + (this.opts.callerAsked ? QUESTION_OVERRUN_WORDS : 0))) {
      this.full = true;
      return this.take(segment);
    }
    // "Great!" / "अच्छा, ठीक है।" before the answer is a reaction, not one of the sentences.
    const reaction = !this.midSentence && !this.kept.length && n <= REACTION_MAX_WORDS && endsSentence(segment) && !isQuestion(segment);
    // The last sentence allowed waits for what follows it (see releasePending).
    if (!this.midSentence && !reaction && this.sentences === this.maxSentences - 1 && !isQuestion(segment)) {
      this.sentences++;
      this.pending = [segment];
      this.pendingWords = n;
      this.pendingOpen = !endsSentence(segment);
      return [];
    }
    if (!this.midSentence && !reaction) this.sentences++;
    this.midSentence = !endsSentence(segment);
    this.spokenWords += n;
    this.kept.push(segment);
    return [segment];
  }
}
