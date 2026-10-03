/**
 * Video-call acknowledgements ("Let me check that.") — spoken only while a real answer is
 * late, so the avatar reacts like a person instead of staring for 3-4 seconds.
 *
 * Rules (product decision, 2026-10-03):
 *   - live video-avatar calls only (text chat and plain voice mode are unchanged);
 *   - never for small talk ("how are you", "hi", "thanks", "ok"), very short replies
 *     ("yes", a name) or numbers — those answers are quick and a filler would sound odd;
 *   - only when nothing of the answer is ready FILLER_AFTER_STOP_MS after the end of the
 *     visitor's speech was detected;
 *   - short, neutral phrases that promise nothing ("I'll ask the team" could contradict
 *     the answer), in the visitor's language and the assistant's grammatical gender;
 *   - never on two turns in a row, and never the same phrase twice running.
 */
import { smallTalkKind } from "../chatContext/smallTalk";

export type FillerLanguage = "en" | "hi";
export type FillerGender = "female" | "male" | null;

/**
 * A filler is spoken if no answer sentence exists this long after the end of speech was
 * DETECTED (server VAD reports it ~0.8 s after the visitor actually went quiet, so the
 * filler is heard ~1.5 s + the avatar's ~0.6 s after they stop). Live Anam test 2026-10-03:
 * answers start 2.2–3.2 s after detection, so this only fills real waits.
 */
export const FILLER_AFTER_STOP_MS = 700;
/** …but never sooner than this after we start answering (lets a fast answer win). */
export const FILLER_MIN_DELAY_MS = 250;

const EN = ["Let me check that.", "Sure, one moment.", "Okay, let me see."];
// Romanised Hinglish: ElevenLabs reads it naturally, for Devanagari or Hinglish transcripts alike.
const HI_NEUTRAL = ["Achha, ek minute.", "Haan, bas ek second."];
const HI_FEMALE = ["Ek second, main dekhti hoon."];
const HI_MALE = ["Ek second, main dekhta hoon."];

const HINGLISH_MARKERS = /\b(kya|hai|hain|ho|mujhe|mera|meri|aap|aapka|aapki|kaise|kaisa|kitna|kitne|kitni|kab|kahan|kyun|nahi|nahin|chahiye|batao|bataiye|karna|karoge|sakte|milega|wala|wali|hoga|tha|thi|ka|ki|ke|ko|se|mein|bhi|aur)\b/gi;

/** Phrases for a language + gender (gendered Hindi first-person forms only when the gender is known). */
export function fillerPhrases(language: FillerLanguage, gender: FillerGender): string[] {
  if (language === "en") return [...EN];
  return [...HI_NEUTRAL, ...(gender === "female" ? HI_FEMALE : gender === "male" ? HI_MALE : [])];
}

/**
 * Which language to acknowledge in: Devanagari or a clearly Hinglish sentence → Hindi
 * phrases; plain English → English; anything else (Tamil, Arabic…) → none (no phrase set).
 * An explicit widget language wins.
 */
export function fillerLanguage(transcript: string, selectedLanguage?: string | null): FillerLanguage | null {
  const sel = String(selectedLanguage || "").toLowerCase();
  if (sel === "hi") return "hi";
  if (sel === "en") return "en";
  if (sel && sel !== "auto") return null;
  const text = String(transcript || "");
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/[^\u0000-ɏ\s\d.,!?'"()₹%&:;\-–—/@#+*]/.test(text)) return null;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  const markers = (text.match(HINGLISH_MARKERS) || []).length;
  return words.length > 0 && markers >= 2 && markers / words.length >= 0.2 ? "hi" : "en";
}

const ABOUT_THE_CALL = new RegExp([
  String.raw`\b(can|could|do) you (hear|listen to|understand) me\b`,
  String.raw`\b(am i|i'?m) (audible|clear|loud enough)\b`,
  String.raw`\bare you (there|listening|still there|real|human|a (bot|robot|human|real person))\b`,
  String.raw`\b(what'?s|what is|tell me) your name\b`,
  String.raw`\b(who|what) are you\b`,
  String.raw`\b(do you know|what'?s|what is) my name\b`,
  String.raw`\b(awaaz|aawaz|avaaz) (aa rahi|aa raha|sunai)\b`,
  String.raw`\b(sun|sunai de) (rahe|rahi|raha|sakte|sakti)\b`,
  String.raw`\b(aapka|tumhara|aap ka) naam\b`,
  String.raw`(आवाज़|आवाज) (आ रही|सुनाई)|सुन (रहे|रही|पा रहे)|आपका नाम|आप कौन`,
].join("|"), "i");

/** Should this turn get a filler if its answer is late? */
export function wantsFiller(input: { transcript: string; lastAssistantText?: string | null; lastTurnHadFiller?: boolean }): boolean {
  if (input.lastTurnHadFiller) return false;
  const text = String(input.transcript || "").trim();
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false; // "yes", "Rahul", "ok thanks"
  if (/^[\d\s+()-]+$/.test(text) || /\d{6,}/.test(text.replace(/\s+/g, ""))) return false; // phone numbers, codes
  if (smallTalkKind(text, input.lastAssistantText ?? null)) return false; // "how are you", "thank you so much"
  if (/^(how are you|how r u|how are u|kaise ho|kaise hain|kya haal|aap kaise|what'?s up|who are you|what is your name|aap kaun)/i.test(text)) return false;
  // About the assistant itself or the connection — "Let me check that." before "Yes, I can
  // hear you!" sounds absurd (seen in a live call, 2026-10-03).
  if (ABOUT_THE_CALL.test(text.replace(/[’']/g, "'"))) return false;
  return true;
}

/** A phrase that differs from the last one used (random among the rest). */
export function pickFiller(language: FillerLanguage, gender: FillerGender, lastText?: string | null, rand: () => number = Math.random): string {
  const all = fillerPhrases(language, gender);
  const choices = all.length > 1 ? all.filter((p) => p !== lastText) : all;
  return choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))];
}

/** How long to wait (from now) before speaking the filler. */
export function fillerDelayMs(stoppedAt: number | undefined, now: number = Date.now()): number {
  const due = (stoppedAt ?? now) + FILLER_AFTER_STOP_MS - now;
  return Math.max(FILLER_MIN_DELAY_MS, due);
}
