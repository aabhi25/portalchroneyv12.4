import { and, eq, like, ne, or } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { trackTimer } from "../lib/lifecycle";
import { storage } from "../storage";
import { resolveGeminiKey } from "./geminiKeys";

/**
 * Keeps photo search ready without anyone pressing a button: every 15 minutes, each account that
 * uses photo search (Visual product search on, or Vista) and has a Gemini key (its own or the
 * platform's) gets Gemini fingerprints for products that
 * don't have one yet: new, bulk-imported or synced products, and products still carrying data from
 * a retired engine. Accounts with AI product processing on also get each piece detected and cut out.
 */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;
const PRODUCTS_PER_ACCOUNT_PER_RUN = 200;

let running = false;
let started = false;

export async function runPhotoSearchIndexSweep(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { productImageEmbeddingService } = await import("./productImageEmbeddingService");
    const accounts = await db
      .select({
        id: businessAccounts.id,
        name: businessAccounts.name,
        aiProductProcessingEnabled: businessAccounts.aiProductProcessingEnabled,
        geminiApiKey: businessAccounts.geminiApiKey,
      })
      .from(businessAccounts)
      .where(and(
        ne(businessAccounts.status, "suspended"),
        or(eq(businessAccounts.visualSearchEnabled, "true"), like(businessAccounts.productTier, "jewelry_showcase%")),
      ));

    for (const account of accounts) {
      if (!(await resolveGeminiKey(account))) continue;
      const useDetection = account.aiProductProcessingEnabled === "true" && !!(await storage.getBusinessAccountOpenAIKey(account.id));
      const result = await productImageEmbeddingService.embedMissingProducts(account.id, { limit: PRODUCTS_PER_ACCOUNT_PER_RUN, useDetection });
      if (result.processed || result.failed) {
        console.log(`[PhotoSearchIndex] ${account.name}: ${result.processed} fingerprinted, ${result.failed} failed`);
      }
      if (result.error) {
        // Key, quota or billing problem for this account's key: try again next run.
        console.error(`[PhotoSearchIndex] ${account.name} stopped: ${result.error}`);
      }
    }
  } catch (error) {
    console.error("[PhotoSearchIndex] Sweep failed:", error);
  } finally {
    running = false;
  }
}

/** Index one account now (after its key is saved), without waiting for the next run. */
export async function indexAccountNow(businessAccountId: string): Promise<void> {
  const { productImageEmbeddingService } = await import("./productImageEmbeddingService");
  const account = await storage.getBusinessAccount(businessAccountId);
  if (!account || !(await resolveGeminiKey(account))) return;
  const useDetection = account.aiProductProcessingEnabled === "true" && !!(await storage.getBusinessAccountOpenAIKey(account.id));
  const result = await productImageEmbeddingService.embedMissingProducts(account.id, { limit: PRODUCTS_PER_ACCOUNT_PER_RUN, useDetection });
  console.log(`[PhotoSearchIndex] ${account.name}: ${result.processed} fingerprinted, ${result.failed} failed${result.error ? ` (stopped: ${result.error})` : ""}`);
}

export function startPhotoSearchIndexSweep(): void {
  if (started) return;
  started = true;
  trackTimer(setTimeout(() => { void runPhotoSearchIndexSweep(); }, FIRST_RUN_DELAY_MS));
  trackTimer(setInterval(() => { void runPhotoSearchIndexSweep(); }, SWEEP_INTERVAL_MS));
}
