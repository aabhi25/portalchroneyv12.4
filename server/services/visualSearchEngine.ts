import type { BusinessAccount } from "@shared/schema";
import { resolveGeminiKey, type GeminiKeySource } from "./geminiKeys";

/**
 * Which engine answers an account's photo searches:
 *  - "vision_warehouse": the account chose Google Vision Warehouse AND it is fully set up (Svaraa today)
 *  - "gemini": everyone else, through the built-in matcher with Gemini Embedding 2 fingerprints
 *  - "none": no Gemini key for the account (its own or the platform's)
 * Any other stored choice is a retired engine and falls through to Gemini.
 */
export type VisualSearchEngine = "vision_warehouse" | "gemini" | "none";

export async function resolveVisualSearch(
  account: Pick<BusinessAccount, "visualSearchModel" | "googleVisionWarehouseEndpointId" | "googleVisionWarehouseCredentials" | "geminiApiKey">,
): Promise<{ engine: VisualSearchEngine; geminiKey: string | null; geminiKeySource: GeminiKeySource | null }> {
  if (
    account.visualSearchModel === "google_vision_warehouse" &&
    account.googleVisionWarehouseEndpointId &&
    account.googleVisionWarehouseCredentials
  ) {
    return { engine: "vision_warehouse", geminiKey: null, geminiKeySource: null };
  }
  const resolved = await resolveGeminiKey(account);
  return resolved
    ? { engine: "gemini", geminiKey: resolved.key, geminiKeySource: resolved.source }
    : { engine: "none", geminiKey: null, geminiKeySource: null };
}

/** Accounts whose catalog photos should carry Gemini fingerprints: photo search on, or Vista. */
export function usesPhotoSearch(account: Pick<BusinessAccount, "visualSearchEnabled" | "productTier">): boolean {
  return account.visualSearchEnabled === "true" || account.productTier === "jewelry_showcase" || account.productTier === "jewelry_showcase_chroney";
}

/**
 * Gemini fingerprints are compared by cosine similarity, which runs on a different scale from
 * Vision Warehouse's match score. This maps it onto that 0-1 scale so the widget's existing
 * thresholds (Perfect 96 / Very similar 85 / Somewhat similar 70) keep their meaning.
 * Anchor points from testing on jewellery catalogs: [cosine, match score].
 */
const GEMINI_SCORE_ANCHORS: Array<[number, number]> = [
  [0.0, 0.0],
  [0.6, 0.4],
  [0.75, 0.7],
  [0.85, 0.85],
  [0.95, 0.96],
  [1.0, 1.0],
];

/** Below this cosine similarity a product isn't worth showing at all. */
export const GEMINI_CANDIDATE_MIN_SIMILARITY = 0.6;

export function geminiMatchScore(cosine: number): number {
  const c = Math.max(0, Math.min(1, cosine));
  for (let i = 1; i < GEMINI_SCORE_ANCHORS.length; i++) {
    const [x1, y1] = GEMINI_SCORE_ANCHORS[i];
    if (c <= x1) {
      const [x0, y0] = GEMINI_SCORE_ANCHORS[i - 1];
      return y0 + ((c - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}
