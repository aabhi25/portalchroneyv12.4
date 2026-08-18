---
name: Voice karaoke highlight
description: Why spoken-text highlighting must be clocked off Web Audio scheduling, keyed to the bubble, and torn down on every terminal path.
---

**Rule:** Highlight-as-spoken must be driven by a *speaking-rate model* off the Web Audio clock: rate ≈ chars-received ÷ audio-seconds-received, offset ≈ rate × seconds-actually-played (played = totalScheduled − (scheduledEnd − now), valid because scheduled audio is contiguous at the tail). Never advance it on transcript-delta arrival, and don't use watermark pairing ("all text received is heard when all audio received drains") — that carries the full text-vs-audio gap into the highlight and runs a sentence ahead. Add a fixed trailing lag (~0.45s), monotonic forward-only movement with eased catch-up, and word snapping.

**Hybrid formatted karaoke:** when the formatted Markdown (LaTeX/diagrams) arrives mid-speech, upgrade to block-level karaoke: map spoken-char fraction onto blocks weighted by stripped plain-text length (math spans get a flat weight, images zero — they reveal with the preceding block). Block splitting must be structure-preserving (fences and $$-math atomic across blank lines; only flat lists split per item) or fragments parse as broken Markdown. Once formatted content replaces a bubble it is authoritative — late raw chunks must not overwrite it, though they still feed the offset denominator.

**ElevenLabs corollary:** the server must not send `ai_done` while any TTS producer (sentence queue OR direct whole-transcript synth) can still emit PCM for that response — the client finalizes the bubble on drain-after-done, so late PCM would arrive against a finalized bubble. Defer `ai_done` (bound to the responseId, cleared on barge-in) until all producers are idle. Producers register their abort controller synchronously before any await, which is what makes the "registered before response.done's handler runs" ordering sound.

**Why:** Realtime API transcript deltas arrive far ahead of the audio (whole answer text can land seconds before it's heard) and provide no word timestamps. Delta-driven highlighting races to 100% immediately. Accuracy ceiling is phrase-level (transcript leads audio by up to a phrase).

**How to apply:**
- Key the timeline to the *bubble* (messageId), not the responseId — a continuation response appends to the same bubble and schedules audio after the draining tail, so text/breakpoints stay monotonic. Reset only when the bubble changes or playback ends.
- Highlight the raw spoken transcript, never Markdown; the background formatter can replace bubble content mid-playback, so keep the raw text in a separate map.
- Tear down (stop rAF, emit done, clear maps) on EVERY terminal path: ai-done drain, barge-in, response_cancelled, busy/session_closed/error, ws onclose/onerror, unmount. A missed path leaves a stuck highlight and a leaked rAF loop.

## Show-then-speak (finalize content before speech)
- Curriculum voice answers now HOLD all incremental display + ElevenLabs TTS during generation and release at response.done: format → persist → one final ai_chunk (flagged `final:true`) → formatted_transcript → enqueue TTS. Greetings and OpenAI-voice sessions keep the streaming path.
- When the whole transcript arrives before any audio, chars-received ÷ audio-received is an upper bound, not a speaking rate — cap the karaoke rate at a typical prior (~14 chars/s) until the server-deferred ai_done says all PCM arrived, then the exact ratio takes over.
- Any await inside a response.done handler can lose ownership: snapshot transcript/responseId before the first await, re-check cancellation/ownership after every await, and never send/defer ai_done once a newer response owns the conversation.
- A barge-in after response.done (isProcessing already false) must still mark the releasing response cancelled — keep the hold id addressable during the release await so cancelResponse can find it.

## Sentence-level units over formatted markdown
- Block-level highlight degrades to "whole answer lights up" when the formatter emits one big paragraph. Fix on both sides: prompt the formatter to lay out chat-like structure (short paragraphs, numbered steps, display math on own lines — structure only, bold/labels must be the tutor's spoken words verbatim or the fidelity promise breaks), AND sentence-split plain paragraphs into inline span units (needs a p→span renderer so the paragraph still flows as one).
- spokenWeight gotcha: replacing math spans with a SPACE run collapses a display-math-only block's weight to 1 after trim — use a non-space placeholder.
