/**
 * Virtual Try-On helpers: the prompt for each product type, the OpenAI image call and the message a
 * visitor sees when a try-on fails. The route is /api/chat/widget/try-on in server/routes.ts.
 */
import { toFile } from "openai";
import { createOpenAI } from "../lib/openaiClient";
import { OPENAI_IMAGE_MODEL } from "./imageGenerationProviders";

const KEEP_THE_PERSON = "Do not change the person's face, expression, skin tone, body shape, pose, clothing or background, except where the product naturally covers them.";
const KEEP_THE_PRODUCT = "Copy the product exactly from the second image: same design, shape, colours, materials, textures, patterns, text and logos. Do not simplify, redesign or invent any detail.";
const LOOK_REAL = "Match the lighting, shadows, reflections and camera perspective of the first image so the result looks like one real photograph, with no floating or pasted look.";

interface ProductRule {
  match: RegExp;
  instructions: (type: string) => string;
}

// First match wins, so the more specific words come first ("earring" before "ring").
const PRODUCT_RULES: ProductRule[] = [
  {
    match: /\bwatch(es)?\b|\b(wrist|smart)watch(es)?\b|\btimepiece\b/,
    instructions: () => `Place the watch on the person's wrist, wrapped around it, with the dial facing the camera.
- Keep the dial sharp and readable: the same bezel, stones, numerals, hands, date window, sub-dials and logo as the second image.
- Keep the same strap or bracelet, with its links, colour and finish.
- Size it realistically for this wrist: the case should sit on top of the wrist and look like a real watch being worn, not oversized.
- The strap must go around the wrist and follow its curve, with a natural contact shadow on the skin.`,
  },
  {
    match: /\bearrings?\b|\bjhumkas?\b|\bstuds?\b|\bhoops?\b/,
    instructions: () => `Place the earrings on the person's ears.
- They should hang from or attach to the earlobes realistically, and show on both ears when both are visible.
- Size them in proportion to the face.
- Hair may naturally cover part of an earring.`,
  },
  {
    match: /\bnecklaces?\b|\bchains?\b|\bpendants?\b|\bmangalsutras?\b|\bchokers?\b/,
    instructions: () => `Place the necklace around the person's neck.
- It should drape naturally on the neck and chest, following their shape, with the pendant or centre piece in the middle.
- Size it in proportion to their body.`,
  },
  {
    match: /\b(bangles?|bracelets?|kadas?|cuffs?)\b/,
    instructions: () => `Place the bangle or bracelet around the person's wrist.
- It should wrap around the wrist and follow its curve, resting naturally on the skin.
- Size it in proportion to this wrist.`,
  },
  {
    match: /\brings?\b/,
    instructions: () => `Place the ring on one of the person's fingers, on the ring finger if it is visible.
- It should wrap around the finger, with the stone or main design facing the camera.
- Size it in proportion to this hand, with a small contact shadow on the skin.`,
  },
  {
    match: /\b(sun\s?glasses|glasses|spectacles|eyewear|shades|goggles)\b/,
    instructions: () => `Place the eyewear on the person's face.
- It should rest on the nose and ears, level with the eyes, and fit the width of the face.
- Keep the lens colour and tint as in the second image, with natural reflections.
- If the lenses are see-through, the eyes should stay visible behind them.`,
  },
  {
    match: /\b(hats?|caps?|beanies?|turbans?|headbands?|helmets?)\b/,
    instructions: () => `Place the headwear on the person's head.
- It should sit at a natural angle and fit the head, with hair adjusting around it.`,
  },
  {
    match: /\b(shoes?|sneakers?|sandals?|heels|boots?|loafers?|slippers?|footwear|flats)\b/,
    instructions: () => `Put the footwear on the person's feet, replacing what they are wearing there.
- It should fit the feet and match their angle, with a natural shadow on the ground.
- Show both shoes when both feet are visible.`,
  },
  {
    match: /\b(bags?|handbags?|backpacks?|purses?|clutch(es)?|totes?)\b/,
    instructions: () => `Show the person carrying the bag in a natural way for its type: on the shoulder, in the hand or on the back.
- Keep it at its real size compared with their body, with the strap resting naturally.`,
  },
  {
    match: /\b(t-?shirts?|shirts?|tops?|blouses?|dress(es)?|kurtas?|kurtis?|sarees?|sari|lehengas?|suits?|blazers?|jackets?|coats?|hoodies?|sweaters?|sweatshirts?|jeans|trousers|pants|shorts|skirts?|gowns?|clothing|apparel|garments?)\b/,
    instructions: (type) => `Dress the person in the ${type} from the second image, replacing what they are wearing in that part of the body.
- It should fit their body and pose, with natural folds and drape.
- Keep the same fabric, print, colour, neckline, sleeves and length as in the second image.
- Hair and arms should naturally overlap the garment where they would in real life.`,
  },
];

/** The instructions for the image model. The first image sent is the person, the second the product. */
export function tryOnPromptFor(productType: string | null | undefined): string {
  const type = (productType || "").trim().toLowerCase() || "product";
  const rule = PRODUCT_RULES.find(r => r.match.test(type));
  const instructions = rule
    ? rule.instructions(type)
    : `Place the ${type} on the correct part of the person's body, in the way it is really worn or used.
- Align it with their pose and perspective.
- Size it in proportion to their body.
- Hair, sleeves and fingers should naturally overlap it where they would in real life.`;
  return `The first image is a photo of a person. The second image is a product. Show this same person wearing or using the product.

${instructions}

${KEEP_THE_PRODUCT}
${KEEP_THE_PERSON}
${LOOK_REAL}`;
}

/** What a visitor sees when a try-on fails. The real error stays in the server log. */
export function friendlyTryOnError(error: any): string {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  if (/moderation|safety|declined|content.?policy/i.test(text)) {
    return "We couldn't use this photo. Please try a different, clear photo.";
  }
  if (/timed? ?out|timeout|ETIMEDOUT|aborted/i.test(text)) {
    return "This is taking longer than usual. Please try again.";
  }
  return "Try-on isn't available right now. Please try again in a little while.";
}

/** Photos are sent up to this size: fine detail like a watch dial needs the pixels. */
const MAX_INPUT_DIM = 1536;

/** Upright (phone photos), not larger than MAX_INPUT_DIM, on white where the picture is transparent. */
async function prepareImage(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(buffer)
    .rotate()
    .resize({ width: MAX_INPUT_DIM, height: MAX_INPUT_DIM, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** OpenAI try-on: the person and the product go as two separate images. Returns a data URL. */
export async function generateOpenAiTryOn(apiKey: string, selfie: Buffer, product: Buffer, prompt: string): Promise<string> {
  const [selfieJpeg, productJpeg] = await Promise.all([prepareImage(selfie), prepareImage(product)]);
  console.log(`[Try-On][OpenAI] ${OPENAI_IMAGE_MODEL} | selfie ${(selfieJpeg.length / 1024).toFixed(1)} KB | product ${(productJpeg.length / 1024).toFixed(1)} KB`);

  const client = createOpenAI({ apiKey, timeout: 120000 });
  const startedAt = Date.now();
  const response = await client.images.edit({
    model: OPENAI_IMAGE_MODEL,
    image: [
      await toFile(selfieJpeg, "person.jpg", { type: "image/jpeg" }),
      await toFile(productJpeg, "product.jpg", { type: "image/jpeg" }),
    ],
    prompt,
    quality: "high",
  });

  const usage = response.usage;
  console.log(`[Try-On][OpenAI] ${OPENAI_IMAGE_MODEL} responded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s | tokens in ${usage?.input_tokens ?? "?"} out ${usage?.output_tokens ?? "?"}`);

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No image returned from ${OPENAI_IMAGE_MODEL}`);
  return `data:image/png;base64,${b64}`;
}
