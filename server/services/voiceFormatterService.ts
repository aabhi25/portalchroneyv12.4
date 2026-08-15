import OpenAI from 'openai';
import { aiUsageLogger } from './aiUsageLogger';

export type StemSubject = 'math' | 'physics' | 'chemistry' | 'biology' | 'cs' | 'other';

export interface VoiceFormatResult {
  isStem: boolean;
  subject: StemSubject;
  formattedMarkdown?: string;
}

const FORMAT_TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You convert spoken-style answers from a K12 voice tutor into properly formatted on-screen Markdown for visual display. The user will see the formatted version on screen while they hear the original spoken audio.

CRITICAL RULES:
1. STRICTLY transform-only. Do NOT add, remove, change, or paraphrase any facts, examples, numbers, or steps. Convert notation only.
2. First decide if the answer's subject is STEM (math, physics, chemistry, biology, computer science). If NOT STEM, return {"isStem": false, "subject": "other"} with no formatted markdown.
3. If STEM, return formatted Markdown with:
   - Inline math wrapped in single dollar signs: $W = m \\\\times g$
   - Display math wrapped in double dollar signs on their own lines: $$\\\\frac{AE}{AC} = \\\\frac{3x}{8x} = \\\\frac{3}{8}$$
   - Use \\\\frac{}{} for fractions, ^{} for superscripts, _{} for subscripts, \\\\times for multiplication, \\\\div for division, \\\\le \\\\ge \\\\ne for inequalities, \\\\sqrt{} for square roots, \\\\pi \\\\theta \\\\alpha for Greek letters, \\\\rightarrow for arrows.
   - Use **bold** for emphasis on key terms (e.g. **Weight on Earth**).
   - Convert "First / Second / Third" or "Step 1 / Step 2" into proper numbered Markdown lists.
   - Convert spoken phrases like "AE plus EC equals 3x plus 5x" into "$AE + EC = 3x + 5x$".
   - Convert "9.8 meters per second squared" into "$9.8 \\\\, m/s^{2}$".
   - Keep paragraph structure readable. Preserve the original wording wherever possible — only re-flow when needed for clear math display.
4. NEVER invent equations the spoken text didn't contain. If the spoken text said only "the ratio is 3 to 5", do not derive new equations.
5. Output STRICT JSON only: {"isStem": boolean, "subject": "math"|"physics"|"chemistry"|"biology"|"cs"|"other", "formattedMarkdown"?: string}. No prose outside the JSON.`;

export async function formatVoiceTranscript(
  transcript: string,
  apiKey: string,
  businessAccountId?: string,
  conversationId?: string
): Promise<VoiceFormatResult | null> {
  if (!transcript || transcript.trim().length < 10) return null;

  const client = new OpenAI({ apiKey });

  try {
    const completion = await Promise.race([
      client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Spoken answer to format:\n\n${transcript}` }
        ]
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('voice formatter timeout')), FORMAT_TIMEOUT_MS)
      )
    ]);

    const raw = completion.choices?.[0]?.message?.content || '';
    let parsed: VoiceFormatResult;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[VoiceFormatter] Could not parse JSON response:', raw.slice(0, 200));
      return null;
    }

    if (typeof parsed.isStem !== 'boolean') return null;
    if (!parsed.isStem) {
      return { isStem: false, subject: 'other' };
    }
    if (!parsed.formattedMarkdown || typeof parsed.formattedMarkdown !== 'string') {
      return null;
    }

    // Best-effort usage logging
    try {
      if (businessAccountId) {
        await aiUsageLogger.logUsage({
          businessAccountId,
          category: 'voice_mode',
          model: 'gpt-4o-mini',
          tokensInput: completion.usage?.prompt_tokens || 0,
          tokensOutput: completion.usage?.completion_tokens || 0,
          metadata: { feature: 'voice_stem_formatter', conversationId, isStem: parsed.isStem }
        });
      }
    } catch {
      // non-fatal
    }

    return parsed;
  } catch (err) {
    console.warn('[VoiceFormatter] Failed:', (err as Error).message);
    return null;
  }
}
