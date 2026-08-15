---
name: Voice karaoke highlight
description: Why spoken-text highlighting must be clocked off Web Audio scheduling, keyed to the bubble, and torn down on every terminal path.
---

**Rule:** Highlight-as-spoken must interpolate `AudioContext.currentTime` against breakpoints recorded at *audio-chunk scheduling* time (scheduled end time ↔ transcript chars received so far). Never advance it on transcript-delta arrival.

**Why:** Realtime API transcript deltas arrive far ahead of the audio (whole answer text can land seconds before it's heard) and provide no word timestamps. Delta-driven highlighting races to 100% immediately. Accuracy ceiling is phrase-level (transcript leads audio by up to a phrase).

**How to apply:**
- Key the timeline to the *bubble* (messageId), not the responseId — a continuation response appends to the same bubble and schedules audio after the draining tail, so text/breakpoints stay monotonic. Reset only when the bubble changes or playback ends.
- Highlight the raw spoken transcript, never Markdown; the background formatter can replace bubble content mid-playback, so keep the raw text in a separate map.
- Tear down (stop rAF, emit done, clear maps) on EVERY terminal path: ai-done drain, barge-in, response_cancelled, busy/session_closed/error, ws onclose/onerror, unmount. A missed path leaves a stuck highlight and a leaked rAF loop.
