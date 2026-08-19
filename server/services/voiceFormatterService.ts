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

/**
 * Last-resort display text for a voice answer when the richer formatter is
 * unavailable. Voice transcripts occasionally contain unwrapped TeX commands
 * (for example `\frac{3}{2}`); ReactMarkdown deliberately treats those as
 * ordinary text. Keep the answer readable without asking the TTS model to
 * pronounce display-only syntax.
 */
export function createVoiceDisplayFallback(transcript: string): string {
  let output = transcript.trim();

  // Resolve innermost fractions repeatedly so a simple nested fraction does not
  // leave brace syntax behind in the final on-screen answer.
  for (let i = 0; i < 4; i++) {
    const next = output.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1/$2');
    if (next === output) break;
    output = next;
  }

  return output
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\leq?|\\le/g, '≤')
    .replace(/\\geq?|\\ge/g, '≥')
    .replace(/\\neq?|\\ne/g, '≠')
    .replace(/\\pm/g, '±')
    .replace(/\\pi/g, 'π')
    .replace(/\\theta/g, 'θ')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    // Preserve the content of common display wrappers while removing their
    // non-speakable command names.
    .replace(/\\(?:text|mathrm|mathbf|left|right)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\([A-Za-z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\$+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const FORMAT_TIMEOUT_MS = 8000;
const SPEECH_TIMEOUT_MS = 8000;

/**
 * Deterministic fallback for speaking the canonical Markdown answer. The
 * displayed/stored Markdown remains untouched; this representation exists only
 * for TTS and karaoke timing.
 */
export function createVoiceSpeechFallback(markdown: string): string {
  let output = markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[^\n]*\n?/g, ''))
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~`>]/g, '')
    .replace(/\$\$?([\s\S]*?)\$\$?/g, '$1');

  for (let i = 0; i < 4; i++) {
    const next = output.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '$1 over $2');
    if (next === output) break;
    output = next;
  }

  return output
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'the square root of $1')
    .replace(/\\times/g, ' times ')
    .replace(/\\div/g, ' divided by ')
    .replace(/\\leq?|\\le/g, ' less than or equal to ')
    .replace(/\\geq?|\\ge/g, ' greater than or equal to ')
    .replace(/\\neq?|\\ne/g, ' not equal to ')
    .replace(/\\rightarrow/g, ' leads to ')
    .replace(/\\pm/g, ' plus or minus ')
    .replace(/\\pi/g, ' pi ')
    .replace(/\\theta/g, ' theta ')
    .replace(/\\alpha/g, ' alpha ')
    .replace(/\\beta/g, ' beta ')
    .replace(/\\(?:text|mathrm|mathbf|left|right)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\b(\d+)\s*:\s*(\d+)\b/g, '$1 to $2')
    .replace(/\s*=\s*/g, ' equals ')
    .replace(/[{}\\]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Derive a natural speech script from the canonical text-chat Markdown.
 * The model may verbalize notation but must not change, add, or omit content.
 */
export async function createVoiceSpeechText(
  displayMarkdown: string,
  apiKey: string,
  businessAccountId?: string,
  conversationId?: string,
): Promise<string> {
  const fallback = createVoiceSpeechFallback(displayMarkdown);
  if (!displayMarkdown.trim() || !apiKey) return fallback;

  const client = new OpenAI({ apiKey });
  try {
    const completion = await Promise.race([
      client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `Convert the supplied Markdown answer into a natural voice script.
Preserve every fact, sentence, step, number, and their order. Do not summarize,
explain further, add labels, or answer again. Read mathematical notation in
natural words. Omit Markdown symbols, image URLs, and formatting syntax.
Return only the complete plain-text speech script.`,
          },
          { role: 'user', content: displayMarkdown },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('voice speech conversion timeout')), SPEECH_TIMEOUT_MS)
      ),
    ]);
    const speechText = completion.choices?.[0]?.message?.content?.trim() || '';

    if (businessAccountId) {
      void aiUsageLogger.logUsage({
        businessAccountId,
        category: 'voice_mode',
        model: 'gpt-4o-mini',
        tokensInput: completion.usage?.prompt_tokens || 0,
        tokensOutput: completion.usage?.completion_tokens || 0,
        metadata: {
          feature: 'canonical_answer_speech',
          conversationId,
        },
      }).catch(() => {});
    }

    return speechText || fallback;
  } catch (err) {
    console.warn('[VoiceFormatter] Speech conversion failed, using deterministic fallback:', (err as Error).message);
    return fallback;
  }
}

/** Never show more than this many diagrams on one answer, whatever the model says. */
const MAX_DIAGRAMS = 2;

const SYSTEM_PROMPT = `You post-process a spoken answer from a K12 voice tutor for on-screen display. The student HEARS the original audio; you only decide what is SHOWN alongside it.

You have two jobs.

JOB 1 — DISPLAY FORMAT
Decide if the answer's subject is STEM (math, physics, chemistry, biology, computer science).
For EVERY answer, produce formatted Markdown that preserves every fact and the
original sentence order. If STEM, also rewrite notation correctly:
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
For non-STEM answers, use the same short paragraphs and Markdown lists where the
spoken answer contains clear steps. Do not invent headings or labels.
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
 - Include formattedMarkdown for EVERY non-empty spoken answer.
 - EVERY index in imageIndexes MUST also appear as its [[IMAGE:n]] marker inside formattedMarkdown. Listing an index without writing its marker is invalid output — the diagram then has nowhere to go and gets dumped at the bottom of the answer.
 - Correct example, marker sitting inside the text rather than at the end:
   {"isStem":true,"subject":"math","imageIndexes":[2],"formattedMarkdown":"Two triangles are **similar** when their corresponding angles are equal.\\n\\n[[IMAGE:2]]\\n\\nFor example, if $AB = 3$ and $PQ = 6$, the ratio is $1:2$."}
 - If isStem is false and you are placing diagrams, reproduce the spoken answer WORD FOR WORD and insert only the markers — no rewording, no reformatting.
 - If isStem is false and you place no diagrams, still return the complete
   formattedMarkdown with only structure added.`;

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
      // Relevance without placement evidence is not enough. Showing an asset
      // that the formatter could not attach to the explanation is worse than
      // showing no asset at all.
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

    // Every voice response needs a display-ready answer. If the formatting model
    // does not return one, the caller uses a safe readable fallback instead.
    if (!hasMarkdown) return null;

    const produced = parsed.formattedMarkdown as string;

    // The student heard the spoken answer; the screen must not contradict it.
    if (!looksFaithful(transcript, produced, parsed.isStem)) {
      console.warn('[VoiceFormatter] Rejected result — on-screen text diverged from the spoken answer');
      return null;
    }

    const { markdown, urls } = placeDiagrams(produced, indexes, candidates);
    if (!markdown) return null;

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
