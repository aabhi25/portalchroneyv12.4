/**
 * Virtual Try-On helpers: prompts by product type, visitor-friendly errors and the OpenAI request
 * (no network: fetch is stubbed).
 * Run manually: `npx tsx server/services/__tests__/tryOn.test.ts` (self-asserting).
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://x:x@127.0.0.1:1/x";
delete process.env.OPENAI_IMAGE_MODEL;

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}

async function main() {
  const sharp = (await import("sharp")).default;
  const { tryOnPromptFor, friendlyTryOnError, generateOpenAiTryOn } = await import("../tryOn");
  const { OPENAI_IMAGE_MODEL } = await import("../imageGenerationProviders");

  // ── Prompts ────────────────────────────────────────────────────────────────
  const cases: Array<[string, RegExp]> = [
    ["watch", /on the person's wrist.*dial/s],
    ["wristwatch", /dial facing the camera/],
    ["diamond watch", /dial facing the camera/],
    ["smart watch", /dial facing the camera/],
    ["earring", /on the person's ears/],
    ["earrings", /on the person's ears/],
    ["ring", /on one of the person's fingers/],
    ["diamond ring", /on one of the person's fingers/],
    ["necklace", /around the person's neck/],
    ["pendant", /around the person's neck/],
    ["bangle", /around the person's wrist/],
    ["bracelet", /around the person's wrist/],
    ["sunglasses", /eyewear on the person's face/],
    ["hat", /headwear on the person's head/],
    ["sneakers", /footwear on the person's feet/],
    ["handbag", /carrying the bag/],
    ["t-shirt", /Dress the person in the t-shirt/],
    ["kurti", /Dress the person in the kurti/],
    ["saree", /Dress the person in the saree/],
    ["perfume", /Place the perfume on the correct part/],
  ];
  for (const [type, re] of cases) expect(re.test(tryOnPromptFor(type)), `prompt for "${type}"`, tryOnPromptFor(type).slice(0, 160));
  expect(!/fingers/.test(tryOnPromptFor("clothing")) && !/fingers/.test(tryOnPromptFor("earring")), "clothing and earrings don't get the ring prompt");
  const anyPrompt = tryOnPromptFor("watch");
  expect(/first image is a photo of a person/.test(anyPrompt) && /second image is a product/.test(anyPrompt), "the prompt says which image is which");
  expect(/Copy the product exactly/.test(anyPrompt) && /Do not change the person's face/.test(anyPrompt), "the prompt protects the product and the person");
  expect(/Place the product on/.test(tryOnPromptFor("")) && /Place the product on/.test(tryOnPromptFor(null)), "an unknown type still gets a prompt");

  // ── Friendly errors ────────────────────────────────────────────────────────
  const notAvailable = /isn't available right now/;
  const retired = friendlyTryOnError({ code: "model_not_found", message: "404 The model `gpt-image-1` does not exist or you do not have access to it." });
  expect(notAvailable.test(retired) && !/gpt|model|404/i.test(retired), "a model error doesn't show technical details", retired);
  expect(/different, clear photo/.test(friendlyTryOnError({ message: "400 Your request was rejected by the safety system." })), "a safety rejection asks for another photo");
  expect(/different, clear photo/.test(friendlyTryOnError({ code: "moderation_blocked" })), "moderation code too");
  expect(/longer than usual/.test(friendlyTryOnError(new Error("Try-On request timed out after 90 seconds."))), "a timeout asks to try again");
  expect(notAvailable.test(friendlyTryOnError(null)), "no key / unknown error is the general message");
  expect(!/key/i.test(friendlyTryOnError(new Error("Incorrect API key provided: sk-abc"))), "a key error never reaches the visitor");

  // ── The OpenAI request ─────────────────────────────────────────────────────
  expect(OPENAI_IMAGE_MODEL === "gpt-image-2.5-sunburst", "default model is Sunburst", OPENAI_IMAGE_MODEL);

  // A wide phone photo and a transparent product picture.
  const selfie = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#c08060" } }).jpeg().toBuffer();
  const product = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();

  const calls: Array<{ url: string; form: FormData }> = [];
  const realFetch = globalThis.fetch;
  let reply: () => Response = () => new Response(JSON.stringify({
    created: 1, data: [{ b64_json: "QUJD" }], usage: { input_tokens: 1200, output_tokens: 4000, total_tokens: 5200 },
  }), { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (url.startsWith("data:")) return realFetch(input, init); // the SDK's own FormData check
    calls.push({ url, form: init?.body as FormData });
    return reply();
  }) as typeof fetch;

  const result = await generateOpenAiTryOn("sk-test", selfie, product, "PROMPT");
  expect(result === "data:image/png;base64,QUJD", "returns the image as a data URL", result.slice(0, 40));
  expect(calls.length === 1 && /\/images\/edits$/.test(calls[0].url), "one call to the edit route", calls.map(c => c.url));
  const form = calls[0].form;
  expect(form.get("model") === "gpt-image-2.5-sunburst", "sends the Sunburst model", form.get("model"));
  expect(form.get("quality") === "high", "asks for high quality", form.get("quality"));
  expect(form.get("prompt") === "PROMPT", "sends the prompt");
  expect(!form.has("size") && !form.has("input_fidelity"), "no size / input_fidelity (the model decides)");
  const images = form.getAll("image[]") as File[];
  expect(images.length === 2, "two separate images", images.length);
  expect(images[0]?.name === "person.jpg" && images[1]?.name === "product.jpg", "the person first, then the product", images.map(f => f?.name));

  const personMeta = await sharp(Buffer.from(await images[0].arrayBuffer())).metadata();
  expect(personMeta.format === "jpeg" && personMeta.width === 1536 && personMeta.height === 768, "large photos are reduced to 1536 keeping their shape", [personMeta.width, personMeta.height]);
  const productPixels = await sharp(Buffer.from(await images[1].arrayBuffer())).raw().toBuffer();
  expect(productPixels[0] > 240 && productPixels[1] > 240 && productPixels[2] > 240, "a transparent product picture goes on white, not black", [...productPixels.subarray(0, 3)]);

  // A retired model: the error reaches the route (which logs it and shows the friendly text).
  reply = () => new Response(JSON.stringify({ error: { message: "The model does not exist", code: "model_not_found" } }), { status: 404, headers: { "content-type": "application/json" } });
  let thrown: any = null;
  try { await generateOpenAiTryOn("sk-test", selfie, product, "PROMPT"); } catch (e) { thrown = e; }
  expect(thrown?.status === 404 && notAvailable.test(friendlyTryOnError(thrown)), "a provider error is thrown, then shown friendly", thrown?.status);

  reply = () => new Response(JSON.stringify({ created: 1, data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  thrown = null;
  try { await generateOpenAiTryOn("sk-test", selfie, product, "PROMPT"); } catch (e) { thrown = e; }
  expect(/No image returned/.test(thrown?.message || ""), "an empty reply is an error", thrown?.message);

  globalThis.fetch = realFetch;
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll try-on tests passed.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
