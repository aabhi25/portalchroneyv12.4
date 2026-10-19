/**
 * AI Tutor — what the voice says for one lesson line. The board shows "a² + b² = c²"; the voice
 * must say "a squared plus b squared…", never "a two" or a symbol name. Roman-letter Hindi is
 * written in Devanagari before it is spoken (an English-trained voice reads it with an accent).
 */
import { markdownToSpeech } from "../voice/speechText";
import { hinglishToDevanagari } from "../voice/hinglishToDevanagari";
import type { TutorLanguage } from "./lessonPlanner";

const WORDS: Record<TutorLanguage, Record<string, string>> = {
  en: { "²": " squared", "³": " cubed", "√": "square root of ", "π": "pi", "θ": "theta", "°": " degrees", "×": " times ", "÷": " divided by ", "≠": " is not equal to ", "≤": " is less than or equal to ", "≥": " is greater than or equal to ", "∠": "angle ", "△": "triangle ", "∆": "triangle ", "⊥": " is perpendicular to ", "∥": " is parallel to ", "≅": " is congruent to ", "~": " is similar to " },
  hinglish: { "²": " square", "³": " cube", "√": "square root of ", "π": "pi", "θ": "theta", "°": " degree", "×": " into ", "÷": " divided by ", "≠": " not equal to ", "≤": " less than or equal to ", "≥": " greater than or equal to ", "∠": "angle ", "△": "triangle ", "∆": "triangle ", "⊥": " perpendicular to ", "∥": " parallel to ", "≅": " congruent to ", "~": " similar to " },
  hi: { "²": " का वर्ग", "³": " का घन", "√": "वर्गमूल ", "π": "पाई", "θ": "थीटा", "°": " डिग्री", "×": " गुणा ", "÷": " भाग ", "≠": " बराबर नहीं ", "≤": " से कम या बराबर ", "≥": " से अधिक या बराबर ", "∠": "कोण ", "△": "त्रिभुज ", "∆": "त्रिभुज ", "⊥": " लंब ", "∥": " समांतर ", "≅": " सर्वांगसम ", "~": " समरूप " },
};

/** One lesson line → the text to synthesise. */
export function tutorSpeech(say: string, language: TutorLanguage): string {
  let s = markdownToSpeech(String(say || ""));
  const words = WORDS[language] ?? WORDS.en;
  // "√(a+b)" / "√2": the operand follows the words.
  s = s.replace(/√\s*\(([^)]{1,40})\)/g, (_, inner) => `${words["√"]}${inner}`);
  s = s.replace(/[²³√πθ°×÷≠≤≥∠△∆⊥∥≅]/g, (c) => words[c] ?? c);
  // "x ~ y" only between terms (never a stray tilde in prose).
  s = s.replace(/(\w)\s*~\s*(\w)/g, (_, a, b) => `${a}${words["~"]}${b}`);
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([,.?!।])/g, "$1").trim();
  if (language !== "en") s = hinglishToDevanagari(s);
  return s;
}
