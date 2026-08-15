// Routes for the configurable verification engine (Task #5).
import { Router, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  businessAccounts,
  verificationRuleSets,
  verificationRules,
  whatsappLeads,
  insertVerificationRuleSetSchema,
  insertVerificationRuleSchema,
} from "@shared/schema";
import { requireAuth, requireRole } from "../auth";
import {
  getLeadVerification,
  listRules,
  listRuleSets,
  runVerification,
} from "../services/verification";
import { ensureSeedRuleSet } from "../services/verification/seed";
import { sendVerificationOutbound } from "../services/verification/notifier";

const router = Router();

// Only business-account admins / super admins / account group admins may
// manage rule sets or trigger verification runs. (Matches the admin roles
// used elsewhere in the app — see shared/schema.ts users.role.)
const requireAdmin = requireRole("super_admin", "business_user", "account_group_admin");

function getBusinessAccountId(req: Request): string | null {
  const user = (req as any).user;
  if (!user) return null;
  return user.activeBusinessAccountId || user.businessAccountId || null;
}

async function requireWhatsappEnabled(req: Request, res: Response, next: NextFunction) {
  const businessAccountId = getBusinessAccountId(req);
  if (!businessAccountId) return res.status(401).json({ error: "Unauthorized" });
  const [acct] = await db
    .select({ whatsappEnabled: businessAccounts.whatsappEnabled })
    .from(businessAccounts)
    .where(eq(businessAccounts.id, businessAccountId));
  if (!acct || acct.whatsappEnabled !== "true") {
    return res.status(403).json({ error: "WhatsApp is not enabled for this business account" });
  }
  (req as any).businessAccountId = businessAccountId;
  next();
}

async function loadOwnedRuleSet(req: Request, res: Response, ruleSetId: string) {
  const businessAccountId = (req as any).businessAccountId as string;
  const [rs] = await db
    .select()
    .from(verificationRuleSets)
    .where(and(eq(verificationRuleSets.id, ruleSetId), eq(verificationRuleSets.businessAccountId, businessAccountId)))
    .limit(1);
  if (!rs) {
    res.status(404).json({ error: "Rule set not found" });
    return null;
  }
  return rs;
}

// ---- Rule sets ---------------------------------------------------------

router.get("/api/verification/rule-sets", requireAuth, requireWhatsappEnabled, async (req: Request, res: Response) => {
  try {
    const businessAccountId = (req as any).businessAccountId as string;
    const sets = await listRuleSets(businessAccountId);
    res.json({ ruleSets: sets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit, idempotent creation of the "Student Admission — Jain Online" demo rule set.
// Replaces the previous lazy-seed-on-GET behaviour so the demo only appears when
// an admin opts in.
router.post(
  "/api/verification/rule-sets/seed-demo",
  requireAuth,
  requireAdmin,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const businessAccountId = (req as any).businessAccountId as string;
      const ruleSetId = await ensureSeedRuleSet(businessAccountId);
      res.json({ ruleSetId });
    } catch (err: any) {
      console.error("[Verification] Seed error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

router.post(
  "/api/verification/rule-sets",
  requireAuth,
  requireAdmin,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const businessAccountId = (req as any).businessAccountId as string;
      const parsed = insertVerificationRuleSetSchema
        .omit({ businessAccountId: true, isSystemSeed: true })
        .parse(req.body);
      const [created] = await db
        .insert(verificationRuleSets)
        .values({ ...parsed, businessAccountId, isSystemSeed: false })
        .returning();
      res.json({ ruleSet: created });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: err.errors });
      if (err.code === "23505") return res.status(409).json({ error: "A rule set with this name already exists" });
      res.status(500).json({ error: err.message });
    }
  },
);

router.patch(
  "/api/verification/rule-sets/:id",
  requireAuth,
  requireAdmin,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const existing = await loadOwnedRuleSet(req, res, req.params.id);
      if (!existing) return;
      const { name, description, isActive } = req.body || {};
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (typeof name === "string") patch.name = name;
      if (typeof description === "string" || description === null) patch.description = description;
      if (typeof isActive === "boolean") patch.isActive = isActive;
      const [updated] = await db
        .update(verificationRuleSets)
        .set(patch)
        .where(eq(verificationRuleSets.id, req.params.id))
        .returning();
      res.json({ ruleSet: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

router.delete(
  "/api/verification/rule-sets/:id",
  requireAuth,
  requireAdmin,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const existing = await loadOwnedRuleSet(req, res, req.params.id);
      if (!existing) return;
      await db.delete(verificationRuleSets).where(eq(verificationRuleSets.id, req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ---- Rules (nested under rule-sets) -----------------------------------

router.get(
  "/api/verification/rule-sets/:id/rules",
  requireAuth,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const owner = await loadOwnedRuleSet(req, res, req.params.id);
      if (!owner) return;
      const rules = await listRules(req.params.id);
      res.json({ rules });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

const ALLOWED_RULE_TYPES = new Set(["presence", "cross_field", "threshold", "chronology"]);
const ALLOWED_SEVERITIES = new Set(["info", "warning", "blocker"]);

router.post(
  "/api/verification/rule-sets/:id/rules",
  requireAuth,
  requireAdmin,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const owner = await loadOwnedRuleSet(req, res, req.params.id);
      if (!owner) return;
      const parsed = insertVerificationRuleSchema.omit({ ruleSetId: true }).parse(req.body);
      if (!ALLOWED_RULE_TYPES.has(parsed.ruleType)) return res.status(400).json({ error: "Invalid ruleType" });
      if (!ALLOWED_SEVERITIES.has(parsed.severity || "warning")) return res.status(400).json({ error: "Invalid severity" });
      const [created] = await db
        .insert(verificationRules)
        .values({ ...parsed, ruleSetId: req.params.id })
        .returning();
      res.json({ rule: created });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid payload", details: err.errors });
      res.status(500).json({ error: err.message });
    }
  },
);

router.patch(
  "/api/verification/rule-sets/:ruleSetId/rules/:ruleId",
  requireAuth,
  requireAdmin,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const owner = await loadOwnedRuleSet(req, res, req.params.ruleSetId);
      if (!owner) return;
      const [rule] = await db
        .select()
        .from(verificationRules)
        .where(and(eq(verificationRules.id, req.params.ruleId), eq(verificationRules.ruleSetId, req.params.ruleSetId)))
        .limit(1);
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      const { name, severity, messageTemplate, config, sortOrder, isActive, ruleType } = req.body || {};
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (typeof name === "string") patch.name = name;
      if (typeof severity === "string") {
        if (!ALLOWED_SEVERITIES.has(severity)) return res.status(400).json({ error: "Invalid severity" });
        patch.severity = severity;
      }
      if (typeof ruleType === "string") {
        if (!ALLOWED_RULE_TYPES.has(ruleType)) return res.status(400).json({ error: "Invalid ruleType" });
        patch.ruleType = ruleType;
      }
      if (typeof messageTemplate === "string") patch.messageTemplate = messageTemplate;
      if (config && typeof config === "object") patch.config = config;
      if (typeof sortOrder === "number") patch.sortOrder = sortOrder;
      if (typeof isActive === "boolean") patch.isActive = isActive;
      const [updated] = await db.update(verificationRules).set(patch).where(eq(verificationRules.id, req.params.ruleId)).returning();
      res.json({ rule: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

router.delete(
  "/api/verification/rule-sets/:ruleSetId/rules/:ruleId",
  requireAuth,
  requireAdmin,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const owner = await loadOwnedRuleSet(req, res, req.params.ruleSetId);
      if (!owner) return;
      const result = await db
        .delete(verificationRules)
        .where(and(eq(verificationRules.id, req.params.ruleId), eq(verificationRules.ruleSetId, req.params.ruleSetId)))
        .returning({ id: verificationRules.id });
      if (result.length === 0) return res.status(404).json({ error: "Rule not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ---- Run / read for leads (mounted under /api/whatsapp/leads per spec) -

router.post(
  "/api/whatsapp/leads/:leadId/run-verification",
  requireAuth,
  requireAdmin,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const businessAccountId = (req as any).businessAccountId as string;
      const { ruleSetId, notify } = req.body || {};
      const [lead] = await db
        .select()
        .from(whatsappLeads)
        .where(and(eq(whatsappLeads.id, req.params.leadId), eq(whatsappLeads.businessAccountId, businessAccountId)))
        .limit(1);
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      if (!ruleSetId || typeof ruleSetId !== "string") return res.status(400).json({ error: "ruleSetId required" });

      const result = await runVerification({ leadId: lead.id, ruleSetId });

      let notified: boolean | null = null;
      if (notify === true) {
        notified = await sendVerificationOutbound({
          businessAccountId,
          recipientPhone: lead.customerPhone || lead.senderPhone,
          flowSessionId: lead.flowSessionId,
          result,
        });
      }

      res.json({ result, notified });
    } catch (err: any) {
      console.error("[Verification] run error:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

router.get(
  "/api/whatsapp/leads/:leadId/verification",
  requireAuth,
  requireWhatsappEnabled,
  async (req: Request, res: Response) => {
    try {
      const businessAccountId = (req as any).businessAccountId as string;
      const [lead] = await db
        .select()
        .from(whatsappLeads)
        .where(and(eq(whatsappLeads.id, req.params.leadId), eq(whatsappLeads.businessAccountId, businessAccountId)))
        .limit(1);
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      const result = await getLeadVerification(lead.id);
      res.json({ result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

export default router;
