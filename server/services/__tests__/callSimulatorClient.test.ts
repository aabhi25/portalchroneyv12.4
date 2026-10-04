/**
 * AI Calling — the portal's test-mode phone (client/src/lib/callSimulator.ts), pure parts only:
 * resampling to 16 kHz, PCM16 little-endian, exact 3,200-byte framing, base64, the Exotel-side
 * JSON events, and "echo a mark only after the audio queued before it has played".
 *
 *   AI_CALLING_TEST_DB=1 npx tsx server/services/__tests__/callSimulatorClient.test.ts
 *
 * No database or network is used; the env guard only keeps it in line with the other AI Calling tests.
 */
if (!process.env.AI_CALLING_TEST_DB) {
  console.log("AI_CALLING_TEST_DB not set — skipping callSimulatorClient test");
  process.exit(0);
}

import {
  Resampler,
  downsampleTo16k,
  floatToPcm16Bytes,
  pcm16BytesToFloat,
  Pcm16Framer,
  bytesToBase64,
  base64ToBytes,
  PlaybackQueue,
  SimEventBuilder,
  parseServerEvent,
  rmsLevel,
  SIM_FRAME_BYTES,
} from "../../../client/src/lib/callSimulator";

let failed = 0;
let passed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`);
  } else {
    passed++;
    console.log(`✓ ${label}`);
  }
}

function sine(rate: number, seconds: number, freq: number, amp = 0.5): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

/** Dominant frequency via zero crossings (good enough for a clean sine). */
function zeroCrossFreq(samples: Float32Array, rate: number): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings++;
  return (crossings / 2) / (samples.length / rate);
}

function main() {
  // ── Downsampling ─────────────────────────────────────────────────────────
  {
    const one = downsampleTo16k(sine(48000, 1, 440), 48000);
    expect(Math.abs(one.length - 16000) <= 1, "48 kHz → 16 kHz: one second gives 16,000 samples", one.length);
    const f = zeroCrossFreq(one, 16000);
    expect(Math.abs(f - 440) < 5, "48 kHz → 16 kHz keeps a 440 Hz tone at 440 Hz", f);
    expect(Math.abs(rmsLevel(one) - 0.5 / Math.SQRT2) < 0.02, "48 kHz → 16 kHz keeps the level", rmsLevel(one));
  }
  {
    const one = downsampleTo16k(sine(44100, 1, 300), 44100);
    expect(Math.abs(one.length - 16000) <= 1, "44.1 kHz → 16 kHz: one second gives ~16,000 samples", one.length);
    const f = zeroCrossFreq(one, 16000);
    expect(Math.abs(f - 300) < 5, "44.1 kHz → 16 kHz keeps a 300 Hz tone", f);
  }
  {
    // Streaming in odd-sized chunks must match one big call.
    const src = sine(48000, 0.5, 523);
    const whole = downsampleTo16k(src, 48000);
    const r = new Resampler(48000, 16000);
    const parts: number[] = [];
    let off = 0;
    const sizes = [128, 1000, 7, 2048, 333];
    let k = 0;
    while (off < src.length) {
      const n = Math.min(sizes[k++ % sizes.length], src.length - off);
      parts.push(...r.process(src.subarray(off, off + n)));
      off += n;
    }
    let maxDiff = 0;
    const n = Math.min(parts.length, whole.length);
    for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(parts[i] - whole[i]));
    expect(Math.abs(parts.length - whole.length) <= 1 && maxDiff < 1e-6, "streaming resample in odd chunks equals one-shot", { a: parts.length, b: whole.length, maxDiff });
  }
  {
    const same = downsampleTo16k(sine(16000, 0.1, 200), 16000);
    expect(same.length === 1600, "16 kHz input passes through unchanged", same.length);
    const up = new Resampler(16000, 48000).process(sine(16000, 1, 440));
    expect(Math.abs(up.length - 48000) <= 3, "16 kHz → 48 kHz (playback) gives ~48,000 samples", up.length);
    expect(Math.abs(zeroCrossFreq(up, 48000) - 440) < 5, "16 kHz → 48 kHz keeps 440 Hz", zeroCrossFreq(up, 48000));
  }

  // ── PCM16 little-endian ──────────────────────────────────────────────────
  {
    const bytes = floatToPcm16Bytes(Float32Array.from([0, 1, -1, 0.5, 2, -2, NaN]));
    const v = new DataView(bytes.buffer);
    expect(bytes.length === 14, "PCM16: two bytes per sample", bytes.length);
    expect(v.getInt16(2, true) === 32767 && v.getInt16(4, true) === -32768, "PCM16: full scale maps to 32767 / -32768");
    expect(bytes[2] === 0xff && bytes[3] === 0x7f, "PCM16 is little-endian (32767 → ff 7f)", [bytes[2], bytes[3]]);
    expect(v.getInt16(8, true) === 32767 && v.getInt16(10, true) === -32768 && v.getInt16(12, true) === 0, "PCM16: clips out-of-range and NaN");
    const back = pcm16BytesToFloat(bytes);
    expect(back.length === 7 && Math.abs(back[3] - 0.5) < 1e-3 && back[1] === 1 && back[2] === -1, "PCM16 round-trips", Array.from(back));
  }

  // ── 3,200-byte framing ───────────────────────────────────────────────────
  {
    const f = new Pcm16Framer();
    let frames: Uint8Array[] = [];
    // 2048 float samples at 16 kHz ≈ 4096 bytes per push, in uneven sizes.
    const pushes = [4096, 100, 3100, 1, 6399, 9600];
    let total = 0;
    let marker = 0;
    for (const n of pushes) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (marker++) & 0xff;
      total += n;
      frames = frames.concat(f.push(b));
    }
    expect(frames.every(fr => fr.length === SIM_FRAME_BYTES), "every frame is exactly 3,200 bytes", frames.map(fr => fr.length));
    expect(SIM_FRAME_BYTES % 320 === 0 && SIM_FRAME_BYTES >= 3200, "frame size meets Exotel's rule (≥3,200, multiple of 320)");
    expect(frames.length === Math.floor(total / 3200) && f.pending === total % 3200, "frames + leftover account for every byte", { frames: frames.length, pending: f.pending, total });
    const joined = new Uint8Array(frames.length * 3200);
    frames.forEach((fr, i) => joined.set(fr, i * 3200));
    let inOrder = true;
    for (let i = 0; i < joined.length; i++) if (joined[i] !== (i & 0xff)) { inOrder = false; break; }
    expect(inOrder, "frames keep the byte order with no gaps or repeats");
    const pendingBefore = f.pending;
    const last = f.flush();
    expect(last !== null && last.length === 3200 && last.subarray(pendingBefore).every(v => v === 0) && last[pendingBefore - 1] === ((total - 1) & 0xff), "flush pads the remainder with silence to a full frame");
    expect(f.flush() === null, "flush with nothing pending returns null");
  }

  // ── base64 ───────────────────────────────────────────────────────────────
  {
    const cases = [new Uint8Array([]), new Uint8Array([0]), new Uint8Array([1, 2]), new Uint8Array([255, 254, 253]), new Uint8Array(3200).map((_, i) => (i * 37) & 0xff)];
    for (const c of cases) {
      const ours = bytesToBase64(c);
      const node = Buffer.from(c).toString("base64");
      expect(ours === node, `base64 of ${c.length} bytes matches Node's encoder`);
      const back = base64ToBytes(ours);
      expect(back.length === c.length && back.every((v, i) => v === c[i]), `base64 of ${c.length} bytes decodes back`);
    }
    expect(bytesToBase64(new Uint8Array(3200)).length === 4268, "a 3,200-byte frame is 4,268 base64 characters");
  }

  // ── Events (the Exotel side) ─────────────────────────────────────────────
  {
    const b = new SimEventBuilder({ streamSid: "MZ1", callSid: "CA1", accountSid: "SIMULATOR" });
    expect(JSON.stringify(b.connected()) === '{"event":"connected"}', "connected event");
    const s: any = b.start({ from: "+919000000001", to: "+918000000002" });
    expect(s.event === "start" && s.stream_sid === "MZ1" && s.start.call_sid === "CA1" && s.start.media_format.sample_rate === "16000" && s.start.media_format.encoding === "audio/x-raw" && s.start.media_format.bit_rate === "16", "start event carries ids and 16 kHz PCM format", s);
    expect(s.start.from === "+919000000001" && s.start.to === "+918000000002" && JSON.stringify(s.start.custom_parameters) === "{}", "start event from/to and empty custom parameters");
    const frame = new Uint8Array(3200).fill(7);
    const m1: any = b.media(frame);
    const m2: any = b.media(frame);
    expect(m1.event === "media" && m1.stream_sid === "MZ1" && base64ToBytes(m1.media.payload).length === 3200, "media event carries a 3,200-byte payload");
    expect(m1.media.chunk === "1" && m2.media.chunk === "2" && m1.media.timestamp === "0" && m2.media.timestamp === "100", "media chunks count up, timestamps step 100 ms", [m1.media, m2.media].map(x => [x.chunk, x.timestamp]));
    expect(Number(m2.sequence_number) === Number(m1.sequence_number) + 1, "sequence numbers increase");
    const mk: any = b.mark("turn-3-end");
    expect(mk.event === "mark" && mk.mark.name === "turn-3-end" && mk.stream_sid === "MZ1", "mark echo keeps the name");
    const st: any = b.stop();
    expect(st.event === "stop" && st.stop.reason === "callended" && st.stop.call_sid === "CA1", "hang-up sends stop with reason callended");

    const pm = parseServerEvent(JSON.stringify({ event: "media", stream_sid: "MZ1", media: { payload: bytesToBase64(new Uint8Array([1, 0, 2, 0])) } }));
    expect(pm?.type === "media" && (pm as any).bytes.length === 4 && (pm as any).bytes[2] === 2, "parses server media");
    expect(parseServerEvent(JSON.stringify({ event: "mark", mark: { name: "x" } }))?.type === "mark", "parses server mark");
    expect(parseServerEvent(JSON.stringify({ event: "clear", stream_sid: "MZ1" }))?.type === "clear", "parses server clear");
    expect(parseServerEvent("not json") === null && parseServerEvent(new ArrayBuffer(2)) === null, "ignores non-JSON messages");
  }

  // ── Mark only after playback ─────────────────────────────────────────────
  {
    const q = new PlaybackQueue(0.04);
    // Two chunks of 0.5 s arrive at t=0 → play 0.04–0.54 and 0.54–1.04 (gapless).
    const s1 = q.scheduleAudio(0.5, 0);
    const s2 = q.scheduleAudio(0.5, 0.01);
    expect(Math.abs(s1 - 0.04) < 1e-9 && Math.abs(s2 - 0.54) < 1e-9, "chunks are scheduled back to back", [s1, s2]);
    q.addMark("turn-1-end", 0.02);
    expect(q.takeDueMarks(0.5).length === 0, "mark is not echoed while its audio is still playing");
    expect(Math.abs((q.nextMarkIn(0.5) ?? -1) - 0.54) < 1e-9, "next mark is due when the queued audio ends", q.nextMarkIn(0.5));
    expect(q.isPlaying(1.0), "AI counts as speaking while audio is queued");
    const due = q.takeDueMarks(1.05);
    expect(due.length === 1 && due[0] === "turn-1-end", "mark is echoed once the audio before it has played", due);
    expect(!q.isPlaying(1.05), "AI no longer speaking after the queue drains");

    // Mark with nothing queued → due at once.
    q.addMark("empty", 2);
    expect(q.takeDueMarks(2).join() === "empty", "a mark with nothing queued is echoed immediately");

    // After silence, the next chunk gets the small head start again.
    const s3 = q.scheduleAudio(0.2, 3);
    expect(Math.abs(s3 - 3.04) < 1e-9, "after silence, playback restarts with a short lead", s3);

    // Marks in order; later audio doesn't hold back an earlier mark.
    q.addMark("a", 3);
    q.scheduleAudio(1, 3);
    q.addMark("b", 3);
    expect(q.takeDueMarks(3.25).join() === "a", "first mark echoes when its audio ends, before later audio", q.takeDueMarks(3.25));
    // clear: flush, return pending marks so they are echoed straight away.
    const pending = q.clear(3.3);
    expect(pending.join() === "b", "clear returns the marks still waiting", pending);
    expect(!q.isPlaying(3.3) && q.takeDueMarks(10).length === 0, "after clear nothing is playing or waiting");
    const s4 = q.scheduleAudio(0.1, 3.31);
    expect(Math.abs(s4 - 3.35) < 1e-9, "audio after a clear starts fresh (no wait for flushed audio)", s4);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
