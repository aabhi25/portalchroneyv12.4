/** Dev verification for campaign-owned AI Workbook automation blueprints. */
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { campaignAutomationService } from "../server/services/campaignAutomationService";
import { marketingCampaignService } from "../server/services/marketingCampaignService";
import {
  contactGroups, marketingCampaigns, whatsappAiWorkbookVersions, whatsappAiWorkbooks,
  whatsappCampaignAutomationDispatches, whatsappCampaignAutomationRuns,
  whatsappCampaignAutomations, whatsappTemplates, type AiWorkbookSheet,
} from "@shared/schema";

function todayIn(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function sheet(rows: AiWorkbookSheet["rows"]): AiWorkbookSheet {
  return {
    id: "repayments", name: "Repayments", kind: "custom",
    columns: [
      "phone", "name", "loan_id", "emi_amount", "total_outstanding", "payment_link", "due_date", "status",
    ].map(key => ({ key, label: key, type: key === "due_date" ? "date" : "text", source: "operator", editable: true })),
    rows,
  };
}

async function main() {
  const [template] = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.status, "approved")).limit(1);
  if (!template || template.paramCount < 2) throw new Error("Verification requires an approved template with at least two parameters");
  const businessAccountId = template.businessAccountId;
  const timezone = "Asia/Kolkata";
  const dueDate = todayIn(timezone);
  const templateParams = Array.from({ length: template.paramCount }, (_, i) => i === 0 ? "{{name}}" : i === 1 ? "{{loan_id}}" : "Reminder");
  const rows = ["LOAN-VERIFY-1", "LOAN-VERIFY-2"].map((loanId, i) => ({
    id: `row-${i + 1}`, values: {
      phone: `98765000${10 + i}`, name: `Workbook Verify ${i + 1}`, loan_id: loanId,
      emi_amount: "1500", total_outstanding: "9000", payment_link: `https://example.invalid/pay/${loanId}`,
      due_date: dueDate, status: "due",
    },
  }));
  let workbookId: string | null = null;
  let blueprintId: string | null = null;
  let automationId: string | null = null;
  const runIds: string[] = [], executionCampaignIds: string[] = [], groupIds: string[] = [];
  try {
    const [workbook] = await db.insert(whatsappAiWorkbooks).values({
      businessAccountId, name: "CAMPAIGN OWNED SOURCE VERIFY (temp)", description: "Temporary verification fixture", status: "active",
    }).returning();
    workbookId = workbook.id;
    const [v1] = await db.insert(whatsappAiWorkbookVersions).values({
      workbookId, businessAccountId, versionNumber: 1, source: "manual", sheets: [sheet(rows)],
    }).returning();

    // A malformed campaign-owned source must fail before an insert is possible.
    const before = await db.select({ id: marketingCampaigns.id }).from(marketingCampaigns)
      .where(eq(marketingCampaigns.name, "INVALID OWNED SOURCE VERIFY (temp)"));
    let rejected = false;
    try {
      await marketingCampaignService.create(businessAccountId, {
        name: "INVALID OWNED SOURCE VERIFY (temp)", campaignType: "automation", templateId: template.id, templateParams, groupIds: [],
        recipientSourceType: "ai_workbook", recipientWorkbookId: workbookId, recipientWorkbookSheetId: "repayments",
        recipientPhoneColumn: "missing_phone", recipientRecordKeyColumn: "loan_id", recipientDateColumn: "due_date",
      });
    } catch { rejected = true; }
    const after = await db.select({ id: marketingCampaigns.id }).from(marketingCampaigns)
      .where(eq(marketingCampaigns.name, "INVALID OWNED SOURCE VERIFY (temp)"));
    if (!rejected || before.length !== after.length) throw new Error("Invalid source was written before validation");

    const blueprint = await marketingCampaignService.create(businessAccountId, {
      name: "CAMPAIGN OWNED BLUEPRINT VERIFY (temp)", campaignType: "automation", templateId: template.id, templateParams, groupIds: [],
      recipientSourceType: "ai_workbook", recipientWorkbookId: workbookId, recipientWorkbookSheetId: "repayments",
      recipientPhoneColumn: "phone", recipientNameColumn: "name", recipientRecordKeyColumn: "loan_id", recipientDateColumn: "due_date",
      recipientDateOffsetDays: 0, recipientStatusColumn: "status", recipientEligibleStatuses: ["due"],
      recipientAiAllowedFields: ["loan_id", "emi_amount", "payment_link"],
    });
    blueprintId = blueprint.id;
    // Deliberately wrong audience mappings are overridden by the blueprint.
    const automation = await campaignAutomationService.create(businessAccountId, {
      name: "CAMPAIGN OWNED AUTOMATION VERIFY (temp)", sourceType: "campaign_blueprint", sourceCampaignId: blueprintId,
      templateId: template.id, phoneColumn: "wrong", recordKeyColumn: "wrong", dateColumn: "wrong",
      sourceWorkbookId: "wrong-workbook", sourceWorkbookSheetId: "wrong-sheet", eligibleStatuses: ["wrong"],
      defaultCountryCode: "91", sendMode: "review", sendTime: "23:59", timezone, enabled: true,
    });
    automationId = automation.id;
    if (
      automation.sourceWorkbookId !== workbookId || automation.sourceWorkbookSheetId !== "repayments"
      || automation.phoneColumn !== "phone" || automation.recordKeyColumn !== "loan_id"
      || automation.dateColumn !== "due_date" || automation.eligibleStatuses?.join(",") !== "due"
    ) throw new Error("Automation retained caller-provided mappings instead of blueprint mappings");
    const first = await campaignAutomationService.preview(businessAccountId, automationId, {});
    if (first.summary.eligibleRows !== 2 || first.source.versionId !== v1.id) throw new Error("Blueprint did not authoritatively read version one");
    const created = await campaignAutomationService.createRun(businessAccountId, automationId, {
      expectedWorkbookVersionId: first.source.versionId, expectedWorkbookRevision: first.source.revision,
      expectedCampaignUpdatedAt: first.source.campaignUpdatedAt,
    }, "");
    runIds.push(created.run.id);
    if (created.run.campaignId) executionCampaignIds.push(created.run.campaignId);
    if (created.run.contactGroupId) groupIds.push(created.run.contactGroupId);
    if (created.campaign.recipientAiAllowedFields?.join(",") !== "loan_id,emi_amount,payment_link") throw new Error("Execution did not inherit AI allowlist");

    const v2Rows = [...rows, { id: "row-3", values: { ...rows[0].values, phone: "9876500012", name: "Workbook Verify 3", loan_id: "LOAN-VERIFY-3", payment_link: "https://example.invalid/pay/LOAN-VERIFY-3" } }];
    const [v2] = await db.insert(whatsappAiWorkbookVersions).values({
      workbookId, businessAccountId, versionNumber: 2, source: "manual", sheets: [sheet(v2Rows)],
    }).returning();
    const later = await campaignAutomationService.preview(businessAccountId, automationId, {});
    const [pinned] = await db.select().from(whatsappCampaignAutomationRuns).where(eq(whatsappCampaignAutomationRuns.id, created.run.id));
    if (later.summary.eligibleRows !== 3 || later.source.versionId !== v2.id || pinned.sourceWorkbookVersionId !== v1.id || pinned.sourceSnapshot?.recipients.length !== 2) {
      throw new Error("Live preview or pinned execution snapshot was not preserved");
    }
    console.log("campaign-owned workbook blueprint verification = true");
  } finally {
    if (runIds.length) await db.delete(whatsappCampaignAutomationDispatches).where(inArray(whatsappCampaignAutomationDispatches.runId, runIds));
    if (runIds.length) await db.delete(whatsappCampaignAutomationRuns).where(inArray(whatsappCampaignAutomationRuns.id, runIds));
    if (executionCampaignIds.length) await db.delete(marketingCampaigns).where(inArray(marketingCampaigns.id, executionCampaignIds));
    if (groupIds.length) await db.delete(contactGroups).where(inArray(contactGroups.id, groupIds));
    if (automationId) await db.delete(whatsappCampaignAutomations).where(eq(whatsappCampaignAutomations.id, automationId));
    if (blueprintId) await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, blueprintId));
    if (workbookId) {
      await db.delete(whatsappAiWorkbookVersions).where(eq(whatsappAiWorkbookVersions.workbookId, workbookId));
      await db.delete(whatsappAiWorkbooks).where(eq(whatsappAiWorkbooks.id, workbookId));
    }
  }
}
main().then(() => process.exit(0)).catch(error => { console.error("FAIL:", error.message); process.exit(1); });