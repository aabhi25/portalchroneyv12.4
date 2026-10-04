/**
 * AI Calling — access gate.
 *
 * Every business endpoint of AI Calling sits behind:
 *   signed in  →  has a business account  →  super admin switched AI Calling on
 *   (business_accounts.ai_calling_enabled = 'true'; default 'false').
 *
 * Usage:
 *   app.get("/api/calling/x", ...requireAiCalling, handler)       // array of middlewares (spread keeps req/res typed)
 *   app.get("/api/calling/x", requireAuth, requireBusinessAccount, requireAiCallingFlag, handler)
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { requireAuth, requireBusinessAccount } from "../auth";

export const AI_CALLING_OFF_MESSAGE =
  "AI Calling is not switched on for this business. Please contact support to turn it on.";

/** True when the super admin has switched AI Calling on for this business. */
export async function isAiCallingEnabled(businessAccountId: string | null | undefined): Promise<boolean> {
  if (!businessAccountId) return false;
  const [row] = await db
    .select({ enabled: businessAccounts.aiCallingEnabled })
    .from(businessAccounts)
    .where(eq(businessAccounts.id, businessAccountId))
    .limit(1);
  return row?.enabled === "true";
}

/** Flag check only (expects requireAuth + requireBusinessAccount before it). */
export async function requireAiCallingFlag(req: Request, res: Response, next: NextFunction) {
  try {
    const businessAccountId = req.user?.businessAccountId;
    if (!businessAccountId) return res.status(403).json({ error: "No business account associated" });
    if (!(await isAiCallingEnabled(businessAccountId))) {
      return res.status(403).json({ error: AI_CALLING_OFF_MESSAGE });
    }
    next();
  } catch (err: any) {
    console.error("[AiCallingGate] check failed:", err?.message || err);
    res.status(500).json({ error: "Could not check AI Calling access. Please try again." });
  }
}

/** Full gate: auth + business account + AI Calling switched on. */
export const requireAiCalling: RequestHandler[] = [
  requireAuth as RequestHandler,
  requireBusinessAccount as RequestHandler,
  requireAiCallingFlag as RequestHandler,
];
