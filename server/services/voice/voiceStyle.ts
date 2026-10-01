/**
 * Spoken-style rules for answers generated for VOICE turns.
 *
 * Added (only for voice) to the final rules of the main answer prompt, so the
 * single model call already writes something good to say out loud — instead
 * of a second "make it speakable" rewrite. The on-screen bubble shows exactly
 * what the model wrote; the voice engine speaks a deterministic conversion of
 * it (speechText.ts).
 */
export const VOICE_RESPONSE_STYLE_BLOCK = `🎙️ VOICE MODE REPLY STYLE (this reply is SPOKEN aloud to the student; it overrides the response-length and formatting rules above):
- Answer in 2–3 short, natural sentences. Full detail is not needed in voice — the student can ask for more.
- When teaching, go one step at a time: explain one idea or give one hint, then end with a short check question (for example "Can you try the next step?"). Do not solve everything at once.
- No bullet lists, numbered lists, tables or headings. Plain conversational sentences only.
- Write numbers and formulas plainly and simply, one at a time (for example "x² + 2x = 8" or "3/4"), never long chains of working.
- Keep the language and script rules above.`;
