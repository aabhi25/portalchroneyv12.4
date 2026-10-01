/**
 * Pure unit tests for voice mode's deterministic speech layer:
 *   - markdownToSpeech (Markdown + maths → words), services/voice/speechText.ts
 *   - SentenceStreamSplitter (speak-while-writing), services/voice/sentenceSplitter.ts
 *   - classifyVoiceTurn (noise / backchannel / interruption filter), services/voice/turnFilter.ts
 *   - SentenceTtsPipeline ordering + fallback, services/voice/ttsPipeline.ts
 *
 * Run: `npx tsx server/services/__tests__/voiceSpeechText.test.ts`
 * No network, no database.
 */
import { markdownToSpeech, latexToSpeech } from "../voice/speechText";
import { SentenceStreamSplitter, splitIntoSpeechSegments } from "../voice/sentenceSplitter";
import { classifyVoiceTurn, endsWithQuestion, looksLikeEcho, normalizeTranscript } from "../voice/turnFilter";
import { SentenceTtsPipeline, type TtsProvider } from "../voice/ttsPipeline";

let failed = 0;
let passed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}${detail !== undefined ? `\n    got: ${JSON.stringify(detail)}` : ''}`);
  } else {
    passed++;
    console.log(`✓ ${label}`);
  }
}
function says(md: string, ...fragments: string[]) {
  const out = markdownToSpeech(md);
  for (const f of fragments) expect(out.includes(f), `"${md.slice(0, 50)}" → contains "${f}"`, out);
  return out;
}
function never(md: string, ...fragments: string[]) {
  const out = markdownToSpeech(md);
  for (const f of fragments) expect(!out.includes(f), `"${md.slice(0, 50)}" → no "${f}"`, out);
  return out;
}

// ---------------------------------------------------------------------------
// 1. Markdown → sentences
// ---------------------------------------------------------------------------
says("## Step 1\n\nThe ratio is $3:1$.", "Step 1.", "3 to 1");
never("## Heading\n### Sub\nText", "#");
says("**Photosynthesis** is how plants make food.", "Photosynthesis is how plants make food.");
never("**bold** and *italic* and __under__ and ~~strike~~ and `code`", "*", "_", "~", "`");
says("- Sunlight\n- Water\n- Carbon dioxide", "Sunlight. Water. Carbon dioxide.");
says("1. First step\n2. Second step", "First step. Second step.");
never("1. First step\n2. Second step", "1.", "2.");
says("(a) roots\n(b) stem", "roots.", "stem.");
says("| Name | Value |\n|---|---|\n| a | 5 |", "Name, Value.", "a, 5.");
never("| Name | Value |\n|---|---|", "|", "---");
says("> Quoted line", "Quoted line");
never("> Quoted line", ">");
never("![diagram](https://cdn.test/ratio.png) Look at this.", "https", "diagram", "![");
says("Visit [our site](https://x.com) today.", "Visit our site today.");
never("Visit [our site](https://x.com) today. See https://example.com/x", "http", "](");
never("Great job! 🎉🌱👍 Keep going ✅", "🎉", "🌱", "👍", "✅");
says("Great job! 🎉 Keep going", "Great job! Keep going");
never("```\nx = 1\n```", "```");
never("Text [[IMAGE:2]] more", "[[IMAGE");
expect(markdownToSpeech("") === "", "empty input → empty speech");
expect(markdownToSpeech("   \n\n  ") === "", "whitespace input → empty speech");
expect(markdownToSpeech("---") === "", "horizontal rule alone → empty speech");

// ---------------------------------------------------------------------------
// 2. Maths in plain text
// ---------------------------------------------------------------------------
says("x^2 + 2x + 1", "x squared plus 2x plus 1");
says("x^3", "x cubed");
says("x^n and 2^10", "x to the power n", "2 to the power 10");
says("x^(n+1)", "x to the power n plus 1");
says("x² and y³", "x squared", "y cubed");
says("10⁻³", "10 to the power minus 3");
says("Area = πr²", "Area equals pi r squared");
says("√25 = 5", "the square root of 25 equals 5");
says("√(x+1)", "the square root of x plus 1");
says("sqrt(9) = 3", "the square root of 9 equals 3");
says("3/4 of the cake", "3 over 4 of the cake");
says("Half is 1/2.", "1 over 2");
says("Date 12/05/2024 stays", "12/05/2024");
never("Date 12/05/2024 stays", "over");
says("speed = d/t", "d over t");
never("and/or either", "over");
says("x ≥ 3, y ≠ 4, z ≤ 2, a ≈ 1", "x is greater than or equal to 3", "y is not equal to 4", "z is less than or equal to 2", "a is approximately 1");
says("2 × 3 = 6 and 6 ÷ 2 = 3", "2 times 3 equals 6", "6 divided by 2 equals 3");
says("±1", "plus or minus 1");
says("5 − 2", "5 minus 2");
says("7 - 2 = 5", "7 minus 2 equals 5");
says("3 * 4 = 12", "3 times 4 equals 12");
says("x = -5", "x equals minus 5");
says("In 2020-21 we read pages 5–10.", "2020-21", "5–10");
never("Photosynthesis - the process.", "minus");
says("a < b and c > d", "a is less than b", "c is greater than d");
says("θ = 30°", "theta equals 30 degrees");
says("Δ and λ and μ", "delta", "lambda", "mu");
says("AB ∥ CD and AB ⊥ EF", "is parallel to", "is perpendicular to");
says("∠ABC = 90°", "angle ABC equals 90 degrees");

// Units, percent, currency, decimals, ratios, times.
says("g = 9.8 m/s^2", "9 point 8 metres per second squared");
says("g = 9.8 m/s²", "metres per second squared");
says("speed is 60 km/h", "60 kilometres per hour");
says("speed is 20 m/s", "20 metres per second");
says("25°C and 98°F", "25 degrees Celsius", "98 degrees Fahrenheit");
says("Area is 25 cm² and volume is 8 cm^3", "25 square centimetres", "8 cubic centimetres");
says("It weighs 5 kg and is 10 cm long", "5 kilograms", "10 centimetres");
says("Use 200 g of salt and 2 L of water", "200 grams", "2 litres");
says("A force of 10 N", "10 newtons");
says("Interest is 5%", "5 percent");
says("Price is ₹50", "50 rupees");
says("Rs. 200 only", "200 rupees");
says("pi is 3.14159.", "3 point 1 4 1 5 9");
says("version 1.2.3 stays", "1.2.3");
says("ratio 3:1", "3 to 1");
says("The class is at 10:30.", "10:30");
says("e.g. apples, i.e. fruits", "for example apples", "that is fruits");
says("m^2 + n^2", "m squared plus n squared");
never("m^2 + n^2", "metres");

// Chemistry.
says("Water is H2O.", "H 2 O");
says("Water is H_2O.", "H 2 O");
says("Carbon dioxide CO2", "C O 2");
says("Sulphuric acid H₂SO₄", "H 2 S O 4");
says("Glucose C6H12O6", "C 6 H 12 O 6");
says("Use A4 paper", "A4");
says("Ca(OH)2 is lime water", "C a O H 2");

// ---------------------------------------------------------------------------
// 3. LaTeX
// ---------------------------------------------------------------------------
says("$\\frac{a}{b}$", "a over b");
says("$$x = \\frac{12}{4}$$", "x equals 12 over 4");
says("$\\dfrac{1}{2}$", "1 over 2");
says("$\\frac{\\frac{1}{2}}{3}$", "1 over 2 over 3");
says("$\\sqrt{16} = 4$", "the square root of 16 equals 4");
says("$\\sqrt[3]{27}$", "the cube root of 27");
says("$x^{2} + y^{2} = r^{2}$", "x squared plus y squared equals r squared");
says("$a^{n+1}$", "a to the power n plus 1");
says("$H_2O$ and $CO_{2}$", "H 2 O", "CO 2");
says("$a_{n+1} = a_n + d$", "a n plus 1 equals a n plus d");
says("$3 \\times 4 = 12$", "3 times 4 equals 12");
says("$3 \\cdot 4$", "3 times 4");
says("$6 \\div 2$", "6 divided by 2");
says("$x \\le 5$ and $y \\geq 2$ and $z \\neq 0$", "x is less than or equal to 5", "y is greater than or equal to 2", "z is not equal to 0");
says("$\\alpha + \\beta = \\pi$", "alpha plus beta equals pi");
says("$\\theta = 30^\\circ$", "theta equals 30 degrees");
says("$\\theta = 30^{\\circ}$", "30 degrees");
says("$E = mc^2$", "E equals mc squared");
says("$\\text{Area} = l \\times b$", "Area equals l times b");
says("$\\left( x + 1 \\right)$", "x plus 1");
says("$2H_2 + O_2 \\rightarrow 2H_2O$", "gives");
says("\\(x + 1\\) and \\[y = 2\\]", "x plus 1", "y equals 2");
says("Stray \\frac{3}{2} outside maths", "3 over 2");
never("$\\frac{a}{b}$ $$\\sqrt{x}$$ \\(y\\)", "$", "\\", "{", "}");
expect(latexToSpeech("\\frac{a}{b}") === "a over b", "latexToSpeech: bare fraction", latexToSpeech("\\frac{a}{b}"));

// Existing contract (voiceDiagramPlacement.test.ts #9).
{
  const speech = markdownToSpeech("## Step 1\n\nThe ratio is $3:1$.\n\n$$x = \\frac{12}{4}$$\n\n![diagram](https://cdn.test/ratio.png)");
  expect(speech.includes("x equals 12 over 4") && speech.includes("3 to 1") && !speech.includes("https"), "existing fallback contract kept", speech);
}

// ---------------------------------------------------------------------------
// 4. Hindi / Hinglish pass through
// ---------------------------------------------------------------------------
{
  const hindi = "प्रकाश संश्लेषण एक प्रक्रिया है। पौधे भोजन बनाते हैं।";
  expect(markdownToSpeech(hindi) === hindi, "pure Hindi text is untouched", markdownToSpeech(hindi));
  says("**प्रकाश संश्लेषण** एक प्रक्रिया है।", "प्रकाश संश्लेषण एक प्रक्रिया है।");
  says("x = 5 है।", "x equals 5 है।");
  const hinglish = "Haan, photosynthesis mein plants sunlight use karte hain.";
  expect(markdownToSpeech(hinglish) === hinglish, "Hinglish text is untouched", markdownToSpeech(hinglish));
  says("Is sawaal mein x² + 3 = 7 hai.", "x squared plus 3 equals 7 hai");
}

// ---------------------------------------------------------------------------
// 5. Sentence splitter
// ---------------------------------------------------------------------------
function streamSplit(text: string, chunk = 3, opts?: ConstructorParameters<typeof SentenceStreamSplitter>[0]) {
  const s = new SentenceStreamSplitter(opts);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunk) out.push(...s.push(text.slice(i, i + chunk)));
  out.push(...s.flush());
  return out;
}
{
  const text = "Photosynthesis is how plants make food. They use sunlight! Do you know why? Let's see.";
  const segs = streamSplit(text);
  expect(segs.join("") === text, "segments re-join to the exact input");
  expect(segs.length === 4, "splits on . ! ?", segs);
}
{
  const segs = splitIntoSpeechSegments("The value of pi is 3.14 approximately. Next sentence here.");
  expect(segs.length === 2 && segs[0].includes("3.14"), "does not split a decimal", segs);
}
{
  const segs = splitIntoSpeechSegments("Many fruits, e.g. apples and mangoes, are sweet. That is all for now.");
  expect(segs.length === 2 && segs[0].includes("mangoes"), "does not split after e.g.", segs);
}
{
  const segs = splitIntoSpeechSegments("Dr. Kalam was a scientist. He was also president of India.");
  expect(segs.length === 2 && segs[0].startsWith("Dr. Kalam"), "does not split after Dr.", segs);
}
{
  const segs = splitIntoSpeechSegments("A. P. J. Abdul Kalam was born in 1931. He loved science deeply.");
  expect(segs.length === 2 && segs[0].includes("1931"), "does not split initials", segs);
}
{
  const segs = splitIntoSpeechSegments("See Fig. 3 for the diagram of the leaf. It has veins.");
  expect(segs.length === 2 && segs[0].includes("Fig. 3"), "does not split after Fig.", segs);
}
{
  const text = "Follow these steps carefully:\n1. Add the numbers together.\n2. Divide the total by two.\n";
  const segs = streamSplit(text, 2);
  expect(segs.join("") === text, "numbered list re-joins exactly");
  expect(!segs.some((s) => /^\s*\d\.\s*$/.test(s)), "numbered marker never becomes its own segment", segs);
  expect(segs.some((s) => s.startsWith("1. Add")) || segs.some((s) => s.includes("1. Add the numbers together.")), "list item kept with its marker", segs);
}
{
  const text = "प्रकाश संश्लेषण एक प्रक्रिया है। पौधे सूर्य के प्रकाश से भोजन बनाते हैं। क्या आप समझे?";
  const segs = streamSplit(text, 4);
  expect(segs.length === 3, "splits on Hindi danda and ?", segs);
  expect(segs.join("") === text, "Hindi re-joins exactly");
}
{
  const text = "We know that $x = 3.5$. So the answer is clear now.";
  const segs = splitIntoSpeechSegments(text);
  expect(segs.length === 2 && segs[0].includes("$x = 3.5$."), "does not split inside inline maths", segs);
}
{
  const text = "The formula is:\n$$\nA = \\pi r^2. B = 2.\n$$\nNow we use it.";
  const segs = splitIntoSpeechSegments(text);
  expect(segs.some((s) => s.includes("A = \\pi r^2. B = 2.") && s.includes("$$")), "display maths stays in one segment", segs);
}
{
  const longClause = "When light falls on the leaf, the chlorophyll absorbs the energy, the water is split into hydrogen and oxygen, the oxygen escapes through the stomata, and the hydrogen combines with carbon dioxide to make glucose which the plant stores";
  const segs = streamSplit(longClause + ".", 5);
  expect(segs.length >= 2, "flushes a long clause at a comma", segs);
  expect(segs.every((s) => s.length <= 260), "no segment far beyond the clause limit", segs.map((s) => s.length));
  expect(segs[0].trimEnd().endsWith(","), "long clause split lands on a comma", segs[0]);
}
{
  const segs = splitIntoSpeechSegments("Yes. That is exactly right, well done!");
  expect(segs.length === 1, "very short first sentence merges with the next", segs);
}
{
  const s = new SentenceStreamSplitter();
  expect(s.push("The answer is 3.").length === 0, "waits at a trailing '.' (could be a decimal)");
  const next = s.push("14 exactly. Good");
  expect(next.length === 1 && next[0] === "The answer is 3.14 exactly. ", "emits once the decimal resolves", next);
  expect(s.flush().join("") === "Good", "flush returns the tail");
}
{
  const segs = splitIntoSpeechSegments("## Photosynthesis\n\nPlants make food from sunlight. They need water too.");
  expect(segs.join("") === "## Photosynthesis\n\nPlants make food from sunlight. They need water too.", "heading text re-joins");
  expect(markdownToSpeech(segs[0]).startsWith("Photosynthesis."), "heading becomes its own spoken sentence", segs.map(markdownToSpeech));
}
{
  const segs = splitIntoSpeechSegments("Fruits etc. are healthy foods to eat. They have vitamins.");
  expect(segs.length === 2, "etc. followed by lowercase does not split", segs);
}

// ---------------------------------------------------------------------------
// 6. Turn filter
// ---------------------------------------------------------------------------
const drop = (r: ReturnType<typeof classifyVoiceTurn>, reason: string, label: string) =>
  expect(!r.accept && r.reason === reason, label, r);
const keep = (r: ReturnType<typeof classifyVoiceTurn>, label: string) => expect(r.accept, label, r);

drop(classifyVoiceTurn({ transcript: "", aiActive: false }), "empty", "empty transcript dropped");
drop(classifyVoiceTurn({ transcript: " ... ", aiActive: false }), "empty", "punctuation-only dropped");
drop(classifyVoiceTurn({ transcript: "Thank you.", aiActive: false, speechMs: 900 }), "noise_phrase", "'Thank you.' alone dropped (hands-free)");
drop(classifyVoiceTurn({ transcript: "Thanks for watching!", aiActive: false, speechMs: 1200 }), "noise_phrase", "'Thanks for watching' dropped");
drop(classifyVoiceTurn({ transcript: "you", aiActive: false, speechMs: 600 }), "noise_phrase", "'you' dropped");
drop(classifyVoiceTurn({ transcript: "So.", aiActive: false }), "noise_phrase", "'So.' dropped");
drop(classifyVoiceTurn({ transcript: "[Music]", aiActive: false }), "noise_phrase", "'[Music]' dropped");
drop(classifyVoiceTurn({ transcript: "धन्यवाद", aiActive: false, speechMs: 800 }), "noise_phrase", "Hindi 'धन्यवाद' alone dropped");
keep(classifyVoiceTurn({ transcript: "धन्यवाद, अब अगला सवाल बताइए", aiActive: false, speechMs: 2000 }), "'धन्यवाद' inside a real sentence kept");
keep(classifyVoiceTurn({ transcript: "Thank you, can you explain photosynthesis?", aiActive: false, speechMs: 2500 }), "'thank you' inside a question kept");
keep(classifyVoiceTurn({ transcript: "Thank you", aiActive: false, heldTurn: true, speechMs: 700 }), "held 'thank you' is intentional");
drop(classifyVoiceTurn({ transcript: "Subscribe", aiActive: false, heldTurn: true }), "noise_phrase", "strong noise dropped even when held");
drop(classifyVoiceTurn({ transcript: "Hmm.", aiActive: false, speechMs: 700 }), "filler", "'Hmm.' filler dropped");
drop(classifyVoiceTurn({ transcript: "um uh", aiActive: false }), "filler", "fillers dropped");

// While the tutor is answering (interruptions).
drop(classifyVoiceTurn({ transcript: "Haan", aiActive: true, speechMs: 700 }), "backchannel", "'Haan' while speaking is a backchannel");
drop(classifyVoiceTurn({ transcript: "OK, ok.", aiActive: true, speechMs: 800 }), "backchannel", "'ok ok' backchannel");
drop(classifyVoiceTurn({ transcript: "Acha theek hai", aiActive: true, speechMs: 900 }), "backchannel", "'acha theek hai' backchannel");
drop(classifyVoiceTurn({ transcript: "हाँ जी", aiActive: true, speechMs: 900 }), "backchannel", "Devanagari 'हाँ जी' backchannel");
drop(classifyVoiceTurn({ transcript: "Yes", aiActive: true, speechMs: 600 }), "backchannel", "'Yes' while speaking backchannel");
drop(classifyVoiceTurn({ transcript: "What about", aiActive: true, speechMs: 300 }), "too_short", "<500 ms speech cannot interrupt");
keep(classifyVoiceTurn({ transcript: "Wait, what about mitochondria?", aiActive: true, speechMs: 1400 }), "real question ≥500 ms interrupts");
keep(classifyVoiceTurn({ transcript: "Stop", aiActive: true, speechMs: 250 }), "'Stop' interrupts even when short");
keep(classifyVoiceTurn({ transcript: "Ruko", aiActive: true, speechMs: 300 }), "'Ruko' interrupts even when short");
keep(classifyVoiceTurn({ transcript: "Tell me again please", aiActive: true, speechMs: null }), "unknown duration does not block an interruption");
drop(classifyVoiceTurn({
  transcript: "plants make their food using sunlight",
  aiActive: true,
  speechMs: 1500,
  recentAssistantSpeech: "Photosynthesis is how plants make their food using sunlight and water.",
}), "echo", "the tutor's own words echoing back are dropped");
keep(classifyVoiceTurn({
  transcript: "why do plants need sunlight",
  aiActive: true,
  speechMs: 1500,
  recentAssistantSpeech: "Photosynthesis is how plants make their food using sunlight and water.",
}), "a real follow-up sharing some words is not echo");
expect(looksLikeEcho(normalizeTranscript("make food"), "plants make food") === false, "echo needs at least 3 words");

// Not answering: short single words.
drop(classifyVoiceTurn({ transcript: "Five", aiActive: false, speechMs: 250 }), "too_short", "short single word without a question is dropped");
keep(classifyVoiceTurn({ transcript: "Five", aiActive: false, speechMs: 250, assistantAskedQuestion: true }), "'Five' answering the tutor's question counts");
keep(classifyVoiceTurn({ transcript: "12", aiActive: false, speechMs: 200, assistantAskedQuestion: true }), "digit answer counts");
keep(classifyVoiceTurn({ transcript: "Haan.", aiActive: false, speechMs: 300, assistantAskedQuestion: true }), "'Haan' answering a question counts when the tutor is silent");
keep(classifyVoiceTurn({ transcript: "Nahi", aiActive: false, speechMs: 300, assistantAskedQuestion: true }), "'Nahi' answering a question counts");
keep(classifyVoiceTurn({ transcript: "Photosynthesis", aiActive: false, speechMs: 700 }), "single word ≥400 ms counts");
keep(classifyVoiceTurn({ transcript: "Five", aiActive: false, speechMs: 200, heldTurn: true }), "held single word counts");
keep(classifyVoiceTurn({ transcript: "What is a cell?", aiActive: false, speechMs: 300 }), "multi-word question counts even if quick");
drop(classifyVoiceTurn({ transcript: "The", aiActive: false, speechMs: 300, logprobs: [{ logprob: -3 }] }), "noise_phrase", "blocklist before confidence");
drop(classifyVoiceTurn({ transcript: "Blue sky", aiActive: false, speechMs: 900, logprobs: [{ logprob: -2.5 }, { logprob: -1.9 }] }), "low_confidence", "very low-confidence short transcript dropped");
keep(classifyVoiceTurn({ transcript: "Blue sky", aiActive: false, speechMs: 900, logprobs: [{ logprob: -0.1 }, { logprob: -0.2 }] }), "confident short transcript kept");

expect(endsWithQuestion("Can you try the next step?") === true, "endsWithQuestion: plain");
expect(endsWithQuestion("Can you try the **next step?**") === true, "endsWithQuestion: emphasis");
expect(endsWithQuestion("Well done.") === false, "endsWithQuestion: statement");

// ---------------------------------------------------------------------------
// 7. TTS pipeline: order, pipelining, fallback, cancel
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fakeProvider(name: string, opts: { delayFor?: (t: string) => number; failOn?: (t: string) => boolean; log?: string[] } = {}): TtsProvider {
  return {
    name,
    synthesize: async (text, signal, onChunk) => {
      opts.log?.push(`${name}:start:${text}`);
      if (opts.failOn?.(text)) throw new Error(`${name} 500`);
      const delay = opts.delayFor?.(text) ?? 5;
      for (let i = 0; i < 3; i++) {
        await sleep(delay);
        if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        const piece = `${name}|${text}|${i};`;
        onChunk(Buffer.from(piece.length % 2 ? piece + ";" : piece));
      }
    },
  };
}
async function pipelineTests() {
  {
    const sent: string[] = [];
    const log: string[] = [];
    // Sentence 1 is SLOW, sentence 2 fast: audio must still come out in order.
    const p = new SentenceTtsPipeline({
      primary: fakeProvider("el", { delayFor: (t) => (t === "one" ? 30 : 2), log }),
      fallback: null,
      sendAudio: (b) => sent.push(b.toString()),
    });
    p.enqueue("one");
    p.enqueue("two");
    p.close();
    await sleep(5);
    expect(log.includes("el:start:two"), "sentence 2 request starts while sentence 1 is still synthesising (pipelined)", log);
    await p.finished();
    const order = sent.join("").split(";").filter(Boolean).map((s) => s.split("|")[1]);
    expect(JSON.stringify(order) === JSON.stringify(["one", "one", "one", "two", "two", "two"]), "audio stays in sentence order", order);
  }
  {
    const sent: string[] = [];
    const failures: string[] = [];
    const p = new SentenceTtsPipeline({
      primary: fakeProvider("el", { failOn: (t) => t === "two" }),
      fallback: fakeProvider("openai"),
      sendAudio: (b) => sent.push(b.toString()),
      onProviderFailure: (prov) => failures.push(prov),
      maxParallel: 1,
    });
    p.enqueue("one"); p.enqueue("two"); p.enqueue("three"); p.close();
    await p.finished();
    const used = sent.join("").split(";").filter(Boolean).map((s) => s.split("|").slice(0, 2).join(":"));
    const unique = used.filter((v, i) => used.indexOf(v) === i);
    expect(JSON.stringify(unique) === JSON.stringify(["el:one", "openai:two", "openai:three"]), "ElevenLabs failure mid-answer falls back for the rest", unique);
    expect(failures.length === 1 && failures[0] === "el", "one primary failure reported", failures);
  }
  {
    const sent: string[] = [];
    const p = new SentenceTtsPipeline({
      primary: { name: "hang", synthesize: (_t, signal) => new Promise((_res, rej) => { signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))); }) },
      fallback: fakeProvider("openai"),
      sendAudio: (b) => sent.push(b.toString()),
      firstChunkTimeoutMs: 40,
    });
    p.enqueue("one"); p.close();
    await p.finished();
    expect(sent.join("").includes("openai|one"), "a primary that never produces audio times out to the fallback", sent);
  }
  {
    const sent: string[] = [];
    const p = new SentenceTtsPipeline({
      primary: fakeProvider("el", { delayFor: () => 15 }),
      fallback: null,
      sendAudio: (b) => sent.push(b.toString()),
    });
    p.enqueue("one"); p.enqueue("two"); p.enqueue("three");
    await sleep(20);
    p.cancel();
    const countAtCancel = sent.length;
    await sleep(80);
    expect(sent.length === countAtCancel, "nothing is sent after cancel()", { before: countAtCancel, after: sent.length });
    await p.finished();
    expect(p.isCancelled && !p.isActive, "cancelled pipeline is inactive");
  }
  {
    const sent: Buffer[] = [];
    const p = new SentenceTtsPipeline({
      primary: { name: "odd", synthesize: async (_t, _s, onChunk) => { onChunk(Buffer.from([1, 2, 3])); onChunk(Buffer.from([4, 5, 6])); } },
      sendAudio: (b) => sent.push(b),
    });
    p.enqueue("x"); p.close();
    await p.finished();
    expect(sent.every((b) => b.length % 2 === 0), "PCM16 chunks stay 2-byte aligned", sent.map((b) => b.length));
  }
}

// ---------------------------------------------------------------------------
// 8. Client barge-in detector (adaptive noise floor, 500 ms) — pure logic
// ---------------------------------------------------------------------------
async function detectorTests() {
  const { AdaptiveSpeechDetector, resolveInputMode } = await import("../../../client/src/lib/voiceTurnTaking");
  {
    const d = new AdaptiveSpeechDetector();
    let confirmedAt = -1;
    for (let i = 0; i < 20; i++) d.push(0.004, 50); // quiet room
    for (let i = 0; i < 20; i++) {
      const r = d.push(0.08, 50);
      if (r.justConfirmed && confirmedAt < 0) confirmedAt = (i + 1) * 50;
    }
    expect(confirmedAt === 500, "speech is confirmed after 500 ms, not before", confirmedAt);
  }
  {
    const d = new AdaptiveSpeechDetector();
    for (let i = 0; i < 20; i++) d.push(0.004, 50);
    let confirmed = false;
    for (let round = 0; round < 10; round++) {
      // 150 ms bursts (a cough, a clap) separated by silence never add up.
      for (let i = 0; i < 3; i++) confirmed = d.push(0.2, 50).confirmed || confirmed;
      for (let i = 0; i < 6; i++) d.push(0.004, 50);
    }
    expect(!confirmed, "short bursts never confirm");
  }
  {
    const d = new AdaptiveSpeechDetector();
    // A noisy home: a steady fan/TV hum (RMS 0.012) becomes the floor…
    for (let i = 0; i < 200; i++) d.push(0.012, 50);
    const quietSpeech = d.push(0.025, 50);
    expect(!quietSpeech.speaking, "speech barely above a noisy floor is not counted", { floor: d.noiseFloor, thr: quietSpeech.threshold });
    let confirmed = false;
    for (let i = 0; i < 12; i++) confirmed = d.push(0.09, 50).confirmed || confirmed;
    expect(confirmed, "clear speech over the noisy floor still confirms");
  }
  {
    const d = new AdaptiveSpeechDetector();
    for (let i = 0; i < 20; i++) d.push(0.004, 50);
    let confirmed = false;
    // Tutor playing loudly: echo at RMS 0.03 must not count.
    for (let i = 0; i < 20; i++) confirmed = d.push(0.03, 50, 0.6).confirmed || confirmed;
    expect(!confirmed, "echo of loud playback does not confirm");
  }
  expect(resolveInputMode("hold_to_talk") === "hold_to_talk", "setting hold_to_talk → hold");
  expect(resolveInputMode("student_choice") === "hands_free", "student_choice defaults to hands-free");
  expect(resolveInputMode("student_choice", "hold_to_talk") === "hold_to_talk", "student_choice remembers the student's pick");
  expect(resolveInputMode(undefined) === "hands_free" && resolveInputMode("bogus") === "hands_free", "unknown → hands-free");
}

pipelineTests().then(detectorTests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? "All voice speech-text tests passed" : `${failed} test(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
});
