import OpenAI from 'openai';
import { aiUsageLogger } from './aiUsageLogger';

export type StemSubject = 'math' | 'physics' | 'chemistry' | 'biology' | 'cs' | 'other';

/**
 * A curriculum diagram retrieved for the turn, offered to this pass as a
 * candidate. The speaking model never sees these — it would read the URL out
 * loud — so choosing which (if any) belong on screen happens here instead.
 */
export interface VoiceDiagramCandidate {
  url: string;
  topic: string;
  chapter: string;
  subject: string;
}

export interface VoiceFormatResult {
  isStem: boolean;
  subject: StemSubject;
  /**
   * What to show on screen in place of the raw transcript. Already has any
   * chosen diagrams substituted in as Markdown at the point they belong.
   * Absent when there is nothing to improve on the raw transcript.
   */
  formattedMarkdown?: string;
  /** Diagrams actually placed, in the order they appear. */
  imageUrls?: string[];
}

const FORMAT_TIMEOUT_MS = 8000;

/** Never show more than this many diagrams on one answer, whatever the model says. */
const MAX_DIAGRAMS = 2;

const SYSTEM_PROMPT = `You post-process a spoken answer from a K12 voice tutor for on-screen display. The student HEARS the original audio; you only decide what is SHOWN alongside it.

You have two jobs.

JOB 1 — NOTATION
Decide if the answer's subject is STEM (math, physics, chemistry, biology, computer science).
If STEM, rewrite the answer as Markdown with proper notation:
 - Inline math in single dollar signs: $W = m \\\\times g$
 - Display math in double dollar signs on their own lines: $$\\\\frac{AE}{AC} = \\\\frac{3x}{8x} = \\\\frac{3}{8}$$
 - Use \\\\frac{}{} for fractions, ^{} for superscripts, _{} for subscripts, \\\\times for multiplication, \\\\div for division, \\\\le \\\\ge \\\\ne for inequalities, \\\\sqrt{} for square roots, \\\\pi \\\\theta \\\\alpha for Greek letters, \\\\rightarrow for arrows.
 - Use **bold** for key terms (e.g. **Weight on Earth**).
 - Convert "AE plus EC equals 3x plus 5x" into "$AE + EC = 3x + 5x$", and "9.8 meters per second squared" into "$9.8 \\\\, m/s^{2}$".
LAYOUT — make it read like a textbook page, not a wall of speech:
 - Break the flowing speech into SHORT paragraphs (1-3 sentences each), one idea per paragraph, separated by blank lines.
 - When the answer works through a calculation, derivation or multi-part reasoning, lay those parts out as a numbered Markdown list — one step per item — even when the tutor never literally said "Step 1" or "First". Spoken cues like "First / Second / Next / Then / Step 1" ALWAYS become numbered list items. Each item begins with the tutor's own sentence; you may bold the opening words of that sentence to act as its label, but NEVER write a label the tutor did not speak.
 - Promote each key equation or worked computation onto its own line as display math ($$ ... $$) instead of leaving it buried inline mid-sentence. The equation must be the notation form of words the tutor actually spoke, and the surrounding sentence text stays exactly where it was, in its original order.
 - Layout freedom is STRUCTURE ONLY: you may insert blank lines, list markers, and bolding of EXISTING words, and move an equation onto its own line. You may NOT reword, reorder, merge or split the tutor's sentences, and you may NOT add headings, labels or words the tutor did not speak.
STRICTLY transform-only on the words: never add, remove, change or paraphrase any fact, example, number or step, and never invent an equation the spoken text did not contain. Every spoken sentence must appear, in its original order, in the tutor's own words.
COMPLETE, ALWAYS: formattedMarkdown must contain the ENTIRE spoken answer from its first sentence to its last, including greetings, closing remarks and any question the tutor asked the student at the end. Never summarize, never stop early, never drop the tail. A partial rewrite is invalid output.

JOB 2 — DIAGRAMS
This job applies to EVERY answer, whether or not it is STEM. An English, History, geography or grammar answer earns its diagram on exactly the same terms as a maths one — never skip this job just because isStem is false.
You may be given a numbered list of curriculum diagrams available for this turn. Each label names the lesson that diagram was taken from. Decide which, if any, belong on screen, in two steps.

STEP 1 — Did this answer TEACH something?
A teaching answer explains a concept, gives a definition, works an example, or walks through steps.
A non-teaching answer is: filler or stalling ("let me pull that up for you"), a refusal or "that isn't in your syllabus", a clarifying question, a greeting, small talk, an acknowledgement, or a reply to the student saying stop / I understand.
If the answer did NOT teach, choose no diagrams and stop. Nothing else matters.

STEP 2 — If it DID teach, pick the diagram that illustrates what it taught.
 - Choose the single best match. An exact title match is not required: judge whether the lesson that diagram came from is what this answer was explaining.
 - When the answer taught the topic these diagrams belong to, showing none is a miss — the student loses the figure that goes with the lesson.
 - Choose a SECOND one only when the answer taught two clearly distinct things and a different diagram illustrates each. Never more than 2.
 - Choose none if the answer taught something but every diagram comes from an unrelated chapter. An unrelated diagram is worse than no diagram.
 - Place each chosen diagram by writing its marker [[IMAGE:n]] on its own line, at the exact point in the answer where that thing is being explained — the way a textbook puts the figure beside the paragraph about it. Not all at the end.
 - NEVER write a URL or a Markdown image tag yourself. The marker is the only way to show a diagram.

OUTPUT — strict JSON only, no prose outside it, with the keys in EXACTLY this order:
{"isStem": boolean, "subject": "math"|"physics"|"chemistry"|"biology"|"cs"|"other", "imageIndexes": number[], "formattedMarkdown"?: string}
 - imageIndexes comes BEFORE formattedMarkdown deliberately: commit to your diagrams first, then write the answer and drop each chosen marker in as you reach the point it illustrates. Use [] when you are placing none.
 - Include formattedMarkdown whenever isStem is true OR imageIndexes is non-empty.
 - EVERY index in imageIndexes MUST also appear as its [[IMAGE:n]] marker inside formattedMarkdown. Listing an index without writing its marker is invalid output — the diagram then has nowhere to go and gets dumped at the bottom of the answer.
 - Correct example, marker sitting inside the text rather than at the end:
   {"isStem":true,"subject":"math","imageIndexes":[2],"formattedMarkdown":"Two triangles are **similar** when their corresponding angles are equal.\\n\\n[[IMAGE:2]]\\n\\nFor example, if $AB = 3$ and $PQ = 6$, the ratio is $1:2$."}
 - If isStem is false and you are placing diagrams, reproduce the spoken answer WORD FOR WORD and insert only the markers — no rewording, no reformatting.
 - If isStem is false and you place no diagrams, return {"isStem": false, "subject": "other"} and nothing else.`;

/**
 * Tokenise for the fidelity check. Splits on punctuation and whitespace while
 * keeping non-Latin letters intact, so a Hindi or Marathi answer is compared
 * word-by-word rather than collapsing to nothing. (Written without the `u` flag
 * and \p{L}, which this build target rejects.)
 */
const TOKEN_SEPARATORS = /[^0-9a-z\u00C0-\u0963\u0966-\u1FFF\u2C00-\uD7FF]+/;
function tokenize(text: string): string[] {
  return text.toLowerCase().split(TOKEN_SEPARATORS).filter(Boolean);
}

/**
 * Guard against the pass quietly rewriting what the tutor said — the student
 * heard the original, so the screen must not disagree with their ears.
 *
 * The bar is lower for STEM because a maths answer legitimately loses spoken
 * words when they become notation ("nine point eight" → "9.8"). It is not
 * skipped entirely though: claiming STEM would otherwise be a way around the
 * check, and this pass decides that flag itself.
 */
export function looksFaithful(original: string, produced: string, isStem: boolean): boolean {
  const originalTokens = tokenize(original);
  if (originalTokens.length === 0) return true;
  const producedSet = new Set(tokenize(produced));
  const unique = Array.from(new Set(originalTokens));

  // Growth applies to both: whatever the notation, a faithful transform does not
  // arrive with a pile of vocabulary the tutor never used.
  const growth = producedSet.size / Math.max(1, unique.length);
  if (growth > 1.6) return false;

  // Word overlap is only meaningful when no notation conversion was expected.
  // A STEM answer legitimately shares almost no tokens with its spoken form —
  // "nine point eight meters per second squared" becomes "$9.8 \, m/s^{2}$" —
  // so a per-word coverage floor there would suppress correct formatting. But
  // skipping ALL completeness checks for STEM let a silently truncated rewrite
  // become the on-screen answer (a fraction of the transcript, missing its
  // tail), so STEM gets bulk + tail checks instead of word coverage.
  if (isStem) {
    // Bulk check: notation compresses ("nine point eight meters per second
    // squared" → "$9.8\,m/s^{2}$"), but a faithful transform of the WHOLE
    // answer never shrinks to less than half the spoken token count.
    const producedTokens = tokenize(produced);
    if (producedTokens.length / originalTokens.length < 0.5) return false;

    // Tail check: truncation eats the END of the answer (closing remarks,
    // the final step, the follow-up question). The tail is usually prose that
    // notation conversion keeps, so require some of its words to survive.
    const tail = Array.from(new Set(originalTokens.slice(-25)));
    const tailKept = tail.filter(t => producedSet.has(t)).length;
    return tail.length === 0 || tailKept / tail.length >= 0.4;
  }

  const kept = unique.filter(t => producedSet.has(t)).length;
  return kept / unique.length >= 0.7;
}

/**
 * Substitute [[IMAGE:n]] markers for real Markdown image tags.
 *
 * The model is never given the URLs, only indexes, so it cannot mangle or
 * invent one. Anything image-shaped it produced on its own is stripped first.
 */
// Exported for the smoke tests in __tests__/voiceDiagramPlacement.test.ts —
// this is where the "no wall of diagrams" guarantee is actually enforced.
export function placeDiagrams(
  markdown: string,
  indexes: number[],
  candidates: VoiceDiagramCandidate[]
): { markdown: string; urls: string[] } {
  // Drop any image tag the model wrote itself — the marker is the only
  // sanctioned route, and a self-written URL is either a hallucination or a
  // candidate it was told not to inline.
  let out = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  const urls: string[] = [];
  const seenUrl = new Set<string>();
  const unplaced: VoiceDiagramCandidate[] = [];
  for (const idx of indexes) {
    const candidate = candidates[idx - 1];
    if (!candidate || seenUrl.has(candidate.url)) {
      if (candidate) out = out.split(`[[IMAGE:${idx}]]`).join('');
      continue;
    }
    const marker = `[[IMAGE:${idx}]]`;
    const alt = (candidate.topic || 'curriculum diagram').replace(/[[\]]/g, '');
    const tag = `![${alt}](${candidate.url})`;
    if (!out.includes(marker)) {
      // The diagram was chosen but the model forgot to write its marker. The
      // selection itself is still valid — an in-range index it picked on
      // purpose — so keep ONE and settle for the end of the answer rather than
      // dropping the figure. Only one: several unplaced diagrams landing
      // together is the gallery this change exists to remove.
      if (unplaced.length === 0) {
        unplaced.push(candidate);
        seenUrl.add(candidate.url);
        urls.push(candidate.url);
      }
      continue;
    }
    seenUrl.add(candidate.url);
    urls.push(candidate.url);
    // FIRST occurrence only. Nothing stops the model from repeating a marker,
    // and substituting every one of them would put the same diagram on screen
    // several times — the cap counts selections, so it would not notice. Any
    // repeat is left as a marker and swept up by the cleanup below.
    out = out.replace(marker, () => `\n\n${tag}\n\n`);
  }
  for (const candidate of unplaced) {
    const alt = (candidate.topic || 'curriculum diagram').replace(/[[\]]/g, '');
    out = `${out}\n\n![${alt}](${candidate.url})`;
  }

  // Any marker left over (unchosen, out of range, duplicated) must not reach
  // the student as literal text.
  out = out.replace(/\[\[IMAGE:\s*\d+\s*\]\]/g, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();

  return { markdown: out, urls };
}

export async function formatVoiceTranscript(
  transcript: string,
  apiKey: string,
  businessAccountId?: string,
  conversationId?: string,
  diagramCandidates: VoiceDiagramCandidate[] = []
): Promise<VoiceFormatResult | null> {
  if (!transcript || transcript.trim().length < 10) return null;

  const client = new OpenAI({ apiKey });

  const candidates = diagramCandidates.filter(c => c && /^https?:\/\//i.test(c.url));
  const candidateBlock = candidates.length > 0
    ? '\n\nAvailable diagrams for this turn:\n' + candidates
        .map((c, i) => `${i + 1}. topic "${c.topic || 'untitled'}" — chapter "${c.chapter || 'unknown'}", subject "${c.subject || 'unknown'}"`)
        .join('\n')
    : '\n\nNo diagrams are available for this turn. Do not use any image markers.';

  try {
    const completion = await Promise.race([
      client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Spoken answer to process:\n\n${transcript}${candidateBlock}` }
        ]
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('voice formatter timeout')), FORMAT_TIMEOUT_MS)
      )
    ]);

    const raw = completion.choices?.[0]?.message?.content || '';
    if (process.env.VOICE_FORMATTER_DEBUG === '1') console.log('[VoiceFormatter][debug] raw:', raw.slice(0, 900));
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[VoiceFormatter] Could not parse JSON response:', raw.slice(0, 200));
      return null;
    }

    if (typeof parsed.isStem !== 'boolean') return null;
    const subject: StemSubject = parsed.isStem ? (parsed.subject || 'other') : 'other';

    // Best-effort usage logging, before any early return so a "nothing to do"
    // decision is still billed.
    try {
      if (businessAccountId) {
        await aiUsageLogger.logUsage({
          businessAccountId,
          category: 'voice_mode',
          model: 'gpt-4o-mini',
          tokensInput: completion.usage?.prompt_tokens || 0,
          tokensOutput: completion.usage?.completion_tokens || 0,
          metadata: {
            feature: 'voice_stem_formatter',
            conversationId,
            isStem: parsed.isStem,
            diagramCandidates: candidates.length,
          }
        });
      }
    } catch {
      // non-fatal
    }

    const rawIndexes: number[] = Array.isArray(parsed.imageIndexes) ? parsed.imageIndexes : [];
    const indexes = Array.from(new Set(
      rawIndexes
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= candidates.length)
    )).slice(0, MAX_DIAGRAMS);

    const hasMarkdown = typeof parsed.formattedMarkdown === 'string' && parsed.formattedMarkdown.trim().length > 0;

    // Nothing to improve: not STEM and no diagram earned its place.
    if (!parsed.isStem && indexes.length === 0) {
      return { isStem: false, subject: 'other' };
    }
    // It asked for something but gave us nothing to show it in. Fail closed
    // rather than falling back to appending diagrams blindly.
    if (!hasMarkdown) return null;

    const produced = parsed.formattedMarkdown as string;

    // The student heard the spoken answer; the screen must not contradict it.
    if (!looksFaithful(transcript, produced, parsed.isStem)) {
      console.warn('[VoiceFormatter] Rejected result — on-screen text diverged from the spoken answer');
      return null;
    }

    const { markdown, urls } = placeDiagrams(produced, indexes, candidates);
    if (!markdown) return null;

    // Diagram placement was the only reason to replace the bubble, and it
    // produced no diagram — leave the spoken transcript alone.
    if (!parsed.isStem && urls.length === 0) {
      return { isStem: false, subject: 'other' };
    }

    return {
      isStem: parsed.isStem,
      subject,
      formattedMarkdown: markdown,
      imageUrls: urls,
    };
  } catch (err) {
    console.warn('[VoiceFormatter] Failed:', (err as Error).message);
    return null;
  }
}
