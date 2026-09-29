import type { Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { instagramFlows, instagramFlowSteps, facebookFlows, facebookFlowSteps } from "@shared/schema";

/**
 * Express middleware for Instagram / Facebook flow routes that take a
 * `:flowId` (and optionally a `:stepId`). The flow must belong to the caller's
 * active business account and the step must belong to that flow. A flow or
 * step UUID alone must never authorize cross-account reads or mutations.
 */
export function requireOwnedSocialFlow(platform: "instagram" | "facebook") {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const businessAccountId = req.user?.activeBusinessAccountId || req.user?.businessAccountId;
      if (!businessAccountId) return res.status(400).json({ error: "No active business account" });
      const { flowId, stepId } = (req.params || {}) as { flowId?: string; stepId?: string };
      if (!flowId) return res.status(400).json({ error: "flowId is required" });
      let flowFound: boolean;
      let stepFound = true;
      if (platform === "instagram") {
        const [flow] = await db.select({ id: instagramFlows.id }).from(instagramFlows)
          .where(and(eq(instagramFlows.id, flowId), eq(instagramFlows.businessAccountId, businessAccountId))).limit(1);
        flowFound = !!flow;
        if (flowFound && stepId) {
          const [step] = await db.select({ id: instagramFlowSteps.id }).from(instagramFlowSteps)
            .where(and(eq(instagramFlowSteps.id, stepId), eq(instagramFlowSteps.flowId, flowId))).limit(1);
          stepFound = !!step;
        }
      } else {
        const [flow] = await db.select({ id: facebookFlows.id }).from(facebookFlows)
          .where(and(eq(facebookFlows.id, flowId), eq(facebookFlows.businessAccountId, businessAccountId))).limit(1);
        flowFound = !!flow;
        if (flowFound && stepId) {
          const [step] = await db.select({ id: facebookFlowSteps.id }).from(facebookFlowSteps)
            .where(and(eq(facebookFlowSteps.id, stepId), eq(facebookFlowSteps.flowId, flowId))).limit(1);
          stepFound = !!step;
        }
      }
      if (!flowFound) return res.status(404).json({ error: "Flow not found" });
      if (!stepFound) return res.status(404).json({ error: "Step not found" });
      next();
    } catch (error: any) {
      console.error(`[${platform} Flow] Ownership check failed:`, error);
      res.status(500).json({ error: "Failed to verify flow ownership" });
    }
  };
}
