/**
 * ElevenLabs "busy" answers are retried before the voice pipeline switches to the backup
 * (OpenAI) voice — a refused opening line made video calls start in a different voice.
 * Run: npx tsx server/services/__tests__/elevenlabsBusyRetry.test.ts
 */
let passed = 0;
let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`✓ ${label}`); }
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
}

(async () => {
  const { synthesizeSpeechStreaming } = await import("../elevenlabsService");
  const realFetch = globalThis.fetch;
  const audio = () => new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), { status: 200 });
  const busy = () => new Response('{"detail":{"status":"too_many_concurrent_requests"}}', { status: 429 });
  const opts = { apiKey: "k", voiceId: "v", text: "Hello there" };

  // 1. Busy once, then audio → same voice, no error.
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return calls === 1 ? busy() : audio(); }) as typeof fetch;
  let bytes = 0;
  await synthesizeSpeechStreaming(opts, (b) => { bytes += b.length; });
  expect(calls === 2 && bytes === 6, "busy (429) once → retried, ElevenLabs audio delivered", { calls, bytes });

  // 2. Busy every time → gives up after the retries (the pipeline then uses its backup voice).
  calls = 0;
  globalThis.fetch = (async () => { calls++; return busy(); }) as typeof fetch;
  let threw = false;
  try { await synthesizeSpeechStreaming(opts, () => {}); } catch { threw = true; }
  expect(threw && calls === 3, "always busy → 1 try + 2 retries, then the error", { calls, threw });

  // 3. A real error (bad key / voice) is not retried.
  calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("invalid api key", { status: 401 }); }) as typeof fetch;
  threw = false;
  try { await synthesizeSpeechStreaming(opts, () => {}); } catch { threw = true; }
  expect(threw && calls === 1, "401 → no retry", { calls });

  // 4. Aborted while waiting to retry → stops (AbortError), no further request.
  calls = 0;
  globalThis.fetch = (async () => { calls++; return busy(); }) as typeof fetch;
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  let name = "";
  try { await synthesizeSpeechStreaming({ ...opts, signal: ac.signal }, () => {}); } catch (e) { name = (e as Error).name; }
  expect(name === "AbortError" && calls === 1, "abort during the retry pause → AbortError, no second request", { calls, name });

  globalThis.fetch = realFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
