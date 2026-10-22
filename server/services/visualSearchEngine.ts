import { sql } from "drizzle-orm";
import { products, type BusinessAccount } from "@shared/schema";
import { GEMINI_EMBEDDING_MARKER } from "./geminiImageEmbeddingService";

/** Products whose stored fingerprints were made by Gemini, so they can be compared with a Gemini query. */
export const productHasGeminiFingerprint = sql`${products.visualDescription} LIKE ${`${GEMINI_EMBEDDING_MARKER}%`}`;

/** Accounts whose catalog photos should carry Gemini fingerprints: photo search on, or Vista. */
export function usesPhotoSearch(account: Pick<BusinessAccount, "visualSearchEnabled" | "productTier">): boolean {
  return account.visualSearchEnabled === "true" || account.productTier === "jewelry_showcase" || account.productTier === "jewelry_showcase_chroney";
}

/**
 * Gemini fingerprints are compared by cosine similarity. This maps it onto the 0-1 match score
 * the widget's thresholds (Perfect 96 / Very similar 85 / Somewhat similar 70) are written for.
 * Anchor points [cosine, match score]: first estimates, to be tuned on real jewellery catalogs.
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
