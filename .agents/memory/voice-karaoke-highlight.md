---
name: Voice karaoke highlight
description: Why spoken-text highlighting must be clocked off Web Audio scheduling, keyed to the bubble, and torn down on every terminal path.
---

**Rule:** Highlight-as-spoken must be driven by a *speaking-rate model* off the Web Audio clock: rate ≈ chars-received ÷ audio-seconds-received, offset ≈ rate × seconds-actually-played (played = totalScheduled − (scheduledEnd − now), valid because scheduled audio is contiguous at the tail). Never advance it on transcript-delta arrival, and don't use watermark pairing ("all text received is heard when all audio received drains") — that carries the full text-vs-audio gap into the highlight and runs a sentence ahead. Add a fixed trailing lag (~0.45s), monotonic forward-only movement with eased catch-up, and word snapping.

**ElevenLabs corollary:** the server must not send `ai_done` while any TTS producer (sentence queue OR direct whole-transcript synth) can still emit PCM for that response — the client finalizes the bubble on drain-after-done, so late PCM would arrive against a finalized bubble. Defer `ai_done` (bound to the responseId, cleared on barge-in) until all producers are idle. Producers register their abort controller synchronously before any await, which is what makes the "registered before response.done's handler runs" ordering sound.

**Why:** Realtime API transcript deltas arrive far ahead of the audio (whole answer text can land seconds before it's heard) and provide no word timestamps. Delta-driven highlighting races to 100% immediately. Accuracy ceiling is phrase-level (transcript leads audio by up to a phrase).

**How to apply:**
- Key the timeline to the *bubble* (messageId), not the responseId — a continuation response appends to the same bubble and schedules audio after the draining tail, so text/breakpoints stay monotonic. Reset only when the bubble changes or playback ends.
- Highlight the raw spoken transcript, never Markdown; the background formatter can replace bubble content mid-playback, so keep the raw text in a separate map.
- Tear down (stop rAF, emit done, clear maps) on EVERY terminal path: ai-done drain, barge-in, response_cancelled, busy/session_closed/error, ws onclose/onerror, unmount. A missed path leaves a stuck highlight and a leaked rAF loop.
