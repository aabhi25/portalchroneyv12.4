/**
 * Pure-logic smoke tests for voice diagram placement.
 * Run manually: `npx tsx server/services/__tests__/voiceDiagramPlacement.test.ts`
 *
 * Voice mode used to attach every diagram retrieval returned, so a refusal or a
 * bit of filler arrived with six pictures. Selection now happens in the
 * formatter pass, and `placeDiagrams` is the gate that turns that selection into
 * rendered image tags. These tests protect the guarantees that do NOT depend on
 * the model's judgement:
 *
 *   - a repeated marker cannot multiply a diagram on screen
 *   - a marker the model invented cannot become an image
 *   - a leaked `[[IMAGE:n]]` cannot reach the student as literal text
 *
 * Whether the model *chooses* sensibly (zero on filler, one on a real lesson)
 * needs a live call and is covered separately.
 */
import {
  createVoiceSpeechFallback,
  placeDiagrams,
  type VoiceDiagramCandidate,
} from "../voiceFormatterService";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) { failed++; console.error(`✗ ${label}`); } else { console.log(`✓ ${label}`); }
}

const candidates: VoiceDiagramCandidate[] = [
  { url: "https://cdn.test/one.png", topic: "Similar triangles", chapter: "Similarity", subject: "Maths" },
  { url: "https://cdn.test/two.png", topic: "Areas of similar triangles", chapter: "Similarity", subject: "Maths" },
  { url: "https://cdn.test/three.png", topic: "Basic proportionality", chapter: "Similarity", subject: "Maths" },
  // Deliberate duplicate of #1: the same figure often appears in several notes.
  { url: "https://cdn.test/one.png", topic: "Similar triangles again", chapter: "Similarity", subject: "Maths" },
];

function countImages(md: string): number {
  return (md.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
}

// 1. A marker repeated by the model must still render exactly one diagram.
{
  const { markdown, urls } = placeDiagrams(
    "Angles first. [[IMAGE:1]] Then sides. [[IMAGE:1]] And finally the ratio. [[IMAGE:1]]",
    [1],
    candidates
  );
  expect(countImages(markdown) === 1, "repeated marker renders one image, not three");
  expect(urls.length === 1, "repeated marker reports one url");
  expect(!markdown.includes("[[IMAGE:"), "leftover repeats are swept out of the text");
}

// 2. Two selections, both repeated, stay at two rendered diagrams.
{
  const { markdown, urls } = placeDiagrams(
    "[[IMAGE:1]] a [[IMAGE:2]] b [[IMAGE:1]] c [[IMAGE:2]]",
    [1, 2],
    candidates
  );
  expect(countImages(markdown) === 2, "two selections render exactly two images");
  expect(urls.length === 2, "two selections report two urls");
}

// 3. A marker the model wrote but did not select must not become an image.
{
  const { markdown, urls } = placeDiagrams(
    "Only this one counts. [[IMAGE:1]] This one was never chosen. [[IMAGE:3]]",
    [1],
    candidates
  );
  expect(countImages(markdown) === 1, "unselected marker does not render");
  expect(!markdown.includes("three.png"), "unselected candidate url never appears");
  expect(!markdown.includes("[[IMAGE:"), "unselected marker is not shown as literal text");
  expect(urls.length === 1, "unselected marker is not reported as a url");
}

// 4. An image tag the model wrote itself is discarded — markers are the only route.
{
  const { markdown, urls } = placeDiagrams(
    "Here is a picture ![made up](https://evil.test/hallucinated.png) and here is the real one. [[IMAGE:2]]",
    [2],
    candidates
  );
  expect(!markdown.includes("hallucinated.png"), "self-written image tag is dropped");
  expect(countImages(markdown) === 1, "only the marker-driven image survives");
  expect(urls.length === 1 && urls[0] === candidates[1].url, "reported url is the selected candidate");
}

// 5. Selected but never placed: fail closed instead of appending an unrelated figure.
{
  const { markdown, urls } = placeDiagrams(
    "A full explanation with no markers at all in it.",
    [1, 2],
    candidates
  );
  expect(countImages(markdown) === 0, "unplaced selections render no trailing diagram");
  expect(urls.length === 0, "unplaced selections report no rendered url");
  expect(markdown.startsWith("A full explanation"), "the answer text is left intact");
}

// 6. The same URL selected twice renders once.
{
  const { markdown, urls } = placeDiagrams(
    "First [[IMAGE:1]] and the duplicate [[IMAGE:4]].",
    [1, 4],
    candidates
  );
  expect(countImages(markdown) === 1, "duplicate url renders once");
  expect(urls.length === 1, "duplicate url reported once");
  expect(!markdown.includes("[[IMAGE:"), "the dropped duplicate leaves no literal marker");
}

// 7. No selection means no images, whatever the text contains.
{
  const { markdown, urls } = placeDiagrams(
    "I don't have a lesson called that. [[IMAGE:1]] [[IMAGE:2]]",
    [],
    candidates
  );
  expect(countImages(markdown) === 0, "no selection renders no images");
  expect(urls.length === 0, "no selection reports no urls");
  expect(!markdown.includes("[[IMAGE:"), "markers are stripped even when nothing was selected");
}

// 8. Alt text must not break the Markdown link it sits in.
{
  const { markdown } = placeDiagrams("[[IMAGE:1]]", [1], [
    { url: "https://cdn.test/x.png", topic: "Tricky [bracket] topic", chapter: "C", subject: "S" },
  ]);
  expect(countImages(markdown) === 1, "bracketed topic still produces one valid image tag");
}

// 9. Speech is derived from canonical Markdown without exposing formatting or URLs.
{
  const speech = createVoiceSpeechFallback(
    "## Step 1\n\nThe ratio is $3:1$.\n\n$$x = \\frac{12}{4}$$\n\n![diagram](https://cdn.test/ratio.png)"
  );
  expect(!speech.includes("##") && !speech.includes("$"), "speech fallback removes Markdown and math delimiters");
  expect(!speech.includes("https://"), "speech fallback never reads an image URL");
  expect(speech.includes("3 to 1"), "speech fallback verbalizes a numeric ratio");
  expect(speech.includes("x equals 12 over 4"), "speech fallback verbalizes equations and fractions");
}

console.log(failed === 0 ? "\nAll voice diagram placement tests passed" : `\n${failed} test(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
