/**
 * Live AI avatar — browser-side pure helpers (no DOM):
 *   - Pcm16Resampler (24 kHz → 16 kHz for Anam passthrough): length ratio,
 *     chunk-boundary continuity, frequency preservation, odd-byte carry, clamping
 *   - avatar call state machine (tap → requesting → connecting → live, fallbacks)
 *   - live caption picker
 *
 *   npx tsx server/services/__tests__/liveAvatarClient.test.ts
 */
import { Pcm16Resampler, bytesToBase64 } from "../../../client/src/lib/liveAvatar/resample";
import { avatarReducer, initialAvatarState, isAvatarCallActive, connectTimeRemaining, type AvatarMachineEvent, type AvatarMachineState } from "../../../client/src/lib/liveAvatar/stateMachine";
import { captionAt } from "../../../client/src/lib/liveAvatar/captions";
import { Pcm16Decoder } from "../../../client/src/lib/liveAvatar/pcm";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

// ── resampler ────────────────────────────────────────────────────────────────
function sine(freq: number, rate: number, n: number, amp = 12000): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / rate));
  return out;
}
function zeroCrossings(x: Int16Array): number {
  let c = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0 && x[i] >= 0) || (x[i - 1] >= 0 && x[i] < 0)) c++;
  return c;
}
{
  const input = sine(440, 24000, 24000);
  const whole = new Pcm16Resampler(24000, 16000).process(input);
  expect(Math.abs(whole.length - 16000) <= 1, "1 s at 24 kHz → ~16000 samples at 16 kHz", whole.length);

  // Chunked == single shot (no boundary clicks / drift).
  const r = new Pcm16Resampler(24000, 16000);
  const parts: number[] = [];
  const sizes = [1, 7, 480, 999, 2400, 3, 5000];
  let off = 0, k = 0;
  while (off < input.length) {
    const n = Math.min(sizes[k++ % sizes.length], input.length - off);
    parts.push(...Array.from(r.process(input.subarray(off, off + n))));
    off += n;
  }
  expect(parts.length === whole.length, "chunked output has the same length as single-shot", { chunked: parts.length, whole: whole.length });
  let maxDiff = 0;
  for (let i = 0; i < whole.length; i++) maxDiff = Math.max(maxDiff, Math.abs(whole[i] - parts[i]));
  expect(maxDiff === 0, "chunked output is sample-identical to single-shot", maxDiff);

  // 440 Hz stays 440 Hz: ~880 zero crossings per second.
  const zc = zeroCrossings(whole);
  expect(Math.abs(zc - 880) <= 4, "a 440 Hz tone keeps its frequency after resampling", zc);
  // Amplitude preserved (low-pass barely touches 440 Hz).
  const peak = whole.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  expect(peak > 11000 && peak <= 12100, "amplitude of a low tone is preserved", peak);

  // A 10 kHz tone (above the new 8 kHz Nyquist) is attenuated by the pre-filter.
  const hi = new Pcm16Resampler(24000, 16000).process(sine(10000, 24000, 24000));
  const hiPeak = hi.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  expect(hiPeak < 12000 * 0.4, "content above 8 kHz is attenuated (anti-alias)", hiPeak);

  // DC passes, clamping never overflows.
  const dc = new Pcm16Resampler(24000, 16000).process(new Int16Array(300).fill(32767));
  expect(dc.length === 200 && dc.slice(2).every((v) => v === 32767), "full-scale DC survives without overflow", Array.from(dc.slice(0, 4)));

  // Bytes API: little-endian, odd byte carried across calls.
  const bytesIn = new Uint8Array(new Int16Array([1000, -1000, 2000, -2000, 3000, -3000]).buffer);
  const rb = new Pcm16Resampler(24000, 16000);
  const a = rb.processBytes(bytesIn.subarray(0, 5));
  const b = rb.processBytes(bytesIn.subarray(5));
  const ref = new Pcm16Resampler(24000, 16000).processBytes(bytesIn);
  expect(a.length + b.length === ref.length && a.length % 2 === 0 && b.length % 2 === 0, "odd byte is carried over; outputs stay sample-aligned", { a: a.length, b: b.length, ref: ref.length });
  expect(bytesToBase64(new Uint8Array([0, 1, 2, 250])) === "AAEC+g==", "base64 helper matches Buffer encoding");

  const same = new Pcm16Resampler(16000, 16000).process(new Int16Array([1, 2, 3]));
  expect(same.length === 3 && same[2] === 3, "same-rate is a pass-through");
}

// ── PCM16 decode (fake adapter playback): byte order + odd-length chunk carry ──
{
  const d = new Pcm16Decoder();
  const known = d.push(new Uint8Array([0x01, 0x00, 0xff, 0x7f, 0x00, 0x80, 0xff, 0xff]));
  expect(known.length === 4 && known[0] === 1 / 32768 && known[1] === 32767 / 32768 && known[2] === -1 && known[3] === -1 / 32768, "little-endian PCM16 decodes to the right sample values", Array.from(known));
  const speech = sine(220, 24000, 4800);
  const bytes = new Uint8Array(speech.buffer.slice(0));
  const whole = new Pcm16Decoder().push(bytes);
  const split = new Pcm16Decoder();
  const parts: number[] = [];
  const sizes = [1, 3, 7, 1000, 1, 2, 999, 4097];
  let off = 0, k = 0;
  while (off < bytes.length) {
    const n = Math.min(sizes[k++ % sizes.length], bytes.length - off);
    parts.push(...Array.from(split.push(bytes.subarray(off, off + n))));
    off += n;
  }
  let maxErr = 0;
  for (let i = 0; i < whole.length; i++) maxErr = Math.max(maxErr, Math.abs(whole[i] - parts[i]));
  expect(parts.length === whole.length && maxErr === 0, "odd-length chunk splits decode to exactly the same samples (no byte-shift static)", { parts: parts.length, whole: whole.length, maxErr });
  expect(Math.abs(whole[100] - speech[100] / 32768) < 1e-9, "decoded samples equal the source PCM");

  // Resampler bytes path with odd splits == single shot.
  const rs = new Pcm16Resampler(24000, 16000);
  const out: number[] = [];
  off = 0; k = 0;
  while (off < bytes.length) {
    const n = Math.min(sizes[k++ % sizes.length], bytes.length - off);
    out.push(...Array.from(rs.processBytes(bytes.subarray(off, off + n))));
    off += n;
  }
  const ref = Array.from(new Pcm16Resampler(24000, 16000).processBytes(bytes));
  expect(out.length === ref.length && out.every((v, i) => v === ref[i]), "24k→16k bytes path is identical under odd-length splits", { out: out.length, ref: ref.length });
}

// ── state machine ────────────────────────────────────────────────────────────
{
  const run = (events: AvatarMachineEvent[], from: AvatarMachineState = initialAvatarState) => events.reduce(avatarReducer, from);
  const happy = run([{ type: "tap", at: 1000 }, { type: "session_created", sessionId: "s1" }, { type: "connected", at: 4000 }]);
  expect(happy.phase === "live" && happy.sessionId === "s1" && happy.connectedAt === 4000, "tap → requesting → connecting → live", happy);
  expect(isAvatarCallActive("requesting") && isAvatarCallActive("live") && !isAvatarCallActive("fallback") && !isAvatarCallActive("idle"), "active phases");

  const doubleTap = run([{ type: "tap", at: 1 }, { type: "tap", at: 2 }]);
  expect(doubleTap.tappedAt === 1, "a second tap while connecting is ignored (no second paid session)");

  const refused = run([{ type: "tap", at: 1 }, { type: "session_refused", code: "monthly_cap_reached" }]);
  expect(refused.phase === "fallback" && refused.reason === "monthly_cap_reached" && !!refused.notice, "server refusal → fallback with a visitor notice", refused);

  const timeout = run([{ type: "tap", at: 1 }, { type: "session_created", sessionId: "s" }, { type: "connect_timeout" }]);
  expect(timeout.phase === "fallback" && timeout.reason === "connect_timeout", "slow provider → fallback (voice continues)", timeout);

  const connectErr = run([{ type: "tap", at: 1 }, { type: "session_created", sessionId: "s" }, { type: "provider_error" }]);
  expect(connectErr.reason === "connect_failed", "error while connecting → connect_failed", connectErr.reason);

  const drop = run([{ type: "provider_disconnected" }], happy);
  expect(drop.phase === "fallback" && drop.reason === "provider_disconnected", "mid-session drop → fallback", drop);

  const serverEnd = run([{ type: "server_ended", reason: "cap_reached" }], happy);
  expect(serverEnd.phase === "fallback" && /minutes/i.test(serverEnd.notice || ""), "cap reached mid-session → fallback with a message", serverEnd.notice);

  const ended = run([{ type: "end", reason: "visitor_closed" }, { type: "closed" }], happy);
  expect(ended.phase === "ended" && ended.notice === null, "visitor end → ending → ended (no fallback notice)", ended);
  const lateDrop = run([{ type: "end", reason: "switched_to_text" }, { type: "provider_disconnected" }], happy);
  expect(lateDrop.phase === "ending", "a drop while ending is not a fallback", lateDrop.phase);

  const speaking = run([{ type: "speaking", speaking: true }], happy);
  expect(speaking.speaking, "speaking flag while live");
  const notLive = run([{ type: "speaking", speaking: true }]);
  expect(!notLive.speaking, "speaking ignored when not live");
  const muted = run([{ type: "mute", muted: true }, { type: "reset" }]);
  expect(muted.muted && muted.phase === "idle", "mute survives a reset");
  const retry = run([{ type: "tap", at: 50 }], refused);
  expect(retry.phase === "requesting", "after a fallback the visitor can tap again");

  const connecting = run([{ type: "tap", at: 1000 }, { type: "session_created", sessionId: "s" }]);
  expect(connectTimeRemaining(connecting, 8000, 5000) === 4000 && connectTimeRemaining(connecting, 8000, 20000) === 0, "connect deadline counts from the tap");
}

// ── captions ─────────────────────────────────────────────────────────────────
{
  const text = "Hello there! I found three options for you. The first is a gold ring.";
  expect(captionAt(text, 0) === "Hello there!", "caption at the start = first sentence", captionAt(text, 0));
  expect(captionAt(text, 20) === "I found three options for you.", "caption follows the playback offset", captionAt(text, 20));
  expect(captionAt(text, text.length) === "The first is a gold ring.", "caption at the end = last sentence", captionAt(text, text.length));
  expect(captionAt("नमस्ते। आज हम पढ़ेंगे।", 9) === "आज हम पढ़ेंगे।", "Devanagari danda ends a sentence", captionAt("नमस्ते। आज हम पढ़ेंगे।", 9));
  const long = "word ".repeat(100).trim();
  const c = captionAt(long, 250, 60);
  expect(c.length <= 62 && c.startsWith("…"), "very long sentences are windowed around the playback position", c);
  expect(captionAt("", 5) === "", "empty text → empty caption");
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll live avatar client helper checks passed.");
