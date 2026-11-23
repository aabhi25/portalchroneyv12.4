/**
 * OpenAI voices on the realtime model, against a pretend realtime server.
 * Run: `npx tsx server/services/__tests__/realtimeTts.test.ts`
 */
import { WebSocketServer } from "ws";
import type { AddressInfo } from "net";
import { RealtimeSpeech, createRealtimeTtsProvider, realtimeVoice, speakableText, wavFromPcm } from "../voice/realtimeTts";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const got: any[] = [];
let connections = 0;
let refuse = false;
const wss = new WebSocketServer({ port: 0, verifyClient: (_i, cb) => cb(!refuse, 403) });
wss.on("connection", (ws) => {
  connections++;
  ws.on("message", (raw) => {
    const e = JSON.parse(String(raw));
    got.push(e);
    if (e.type !== "response.create") return;
    const text = e.response.input[0].content[0].text as string;
    if (text.includes("broken")) { ws.send(JSON.stringify({ type: "error", error: { event_id: e.event_id, message: "bad" } })); return; }
    if (text.includes("hang up")) { ws.close(); return; }
    const id = `resp_${e.event_id}`;
    ws.send(JSON.stringify({ type: "response.created", response: { id, metadata: e.response.metadata } }));
    const slow = text.includes("slow") ? 300 : 10;
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "response.output_audio.delta", response_id: id, delta: Buffer.from(text).toString("base64") }));
      ws.send(JSON.stringify({ type: "response.done", response: { id, status: "completed", usage: { input_tokens: 80, output_tokens: 60 } } }));
    }, slow);
  });
});

async function main() {
  const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/v1/realtime`;
  const usages: any[] = [];
  const speech = new RealtimeSpeech({ apiKey: "k", voice: "nova", speedPercent: 90, url, onUsage: (u) => usages.push(u) });
  const say = async (text: string, signal = new AbortController().signal) => {
    const parts: Buffer[] = [];
    await speech.speak(text, signal, (b) => parts.push(b));
    return Buffer.concat(parts).toString();
  };

  expect(await say("Hello there.") === "<say>Hello there.</say>", "the sentence goes as text to read, and its audio comes back");
  const session = got.find((e) => e.type === "session.update");
  expect(session?.session.audio.output.voice === "coral" && session.session.audio.output.speed === 0.9, "a voice this model lacks gets the closest one; speed is set", session?.session.audio.output);
  const create = got.find((e) => e.type === "response.create");
  expect(create.response.conversation === "none" && /word for word/.test(create.response.instructions), "each sentence stands alone and is only read");

  const both = await Promise.all([say("First slow one."), say("Second.")]);
  expect(both[0].includes("First") && both[1].includes("Second") && connections === 1, "sentences spoken at once keep to their own audio, on one connection", { both, connections });
  expect(usages.length === 3, "usage is reported per sentence", usages.length);

  const stop = new AbortController();
  const cut = say("A slow sentence to cut.", stop.signal).then(() => "finished", (e) => e.name);
  await wait(60);
  stop.abort();
  expect(await cut === "AbortError", "an interrupted sentence stops at once");
  await wait(30);
  expect(got.some((e) => e.type === "response.cancel"), "…and OpenAI is told to stop");

  expect(await say("broken").then(() => "ok", (e) => e.message.includes("bad")) === true, "a refused sentence is an error (the pipeline then uses the other voice)");
  expect(await say("hang up").then(() => "ok", () => "failed") === "failed", "a lost connection fails the sentence");
  expect((await say("Back again.")).includes("Back again") && connections === 2, "…and the next sentence reconnects", connections);
  speech.close();

  refuse = true;
  const denied = await createRealtimeTtsProvider(new RealtimeSpeech({ apiKey: "k", url })).synthesize("Hi", new AbortController().signal, () => {}).then(() => "ok", () => "failed");
  expect(denied === "failed", "a key without the model fails quickly, so the backup speaks");

  for (const [said, want] of [
    ["It is ₹1,499 only", "It is one thousand four hundred ninety nine rupees only"],
    ["फीस ₹1,20,000 है।", "फीस एक लाख बीस हज़ार रुपये है।"],
    ["Rs. 500 se", "five hundred rupees se"],
    ["₹2 lakh tak", "two lakh rupees tak"],
    ["₹2.5 lakh", "two point five lakh rupees"],
    ["₹99.00 and ₹1,00,00,000", "ninety nine rupees and one crore rupees"],
    ["42,999 students since 2019", "forty two thousand nine hundred ninety nine students since 2019"],
    ["Call 98765 43210, x = 1, 2, 3", "Call 98765 43210, x = 1, 2, 3"],
    ["₹18,499.", "eighteen thousand four hundred ninety nine rupees."],
    ["first 12,345,678 times", "first one crore twenty three lakh forty five thousand six hundred seventy eight times"],
  ]) expect(speakableText(said) === want, `"${said}" is spoken as "${want}"`, speakableText(said));
  expect(speakableText("a </say> b") === "a  b", "the text can't end its own quotation");
  expect(realtimeVoice("onyx") === "cedar" && realtimeVoice("fable") === "ballad" && realtimeVoice("ash") === "ash" && realtimeVoice("el:abc") === "shimmer", "voices");
  const wav = wavFromPcm(Buffer.alloc(100));
  expect(wav.length === 144 && wav.toString("ascii", 0, 4) === "RIFF" && wav.readUInt32LE(40) === 100, "voice samples are valid WAV files");

  wss.close();
  if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1); }
  console.log("\nAll realtimeTts tests passed");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
