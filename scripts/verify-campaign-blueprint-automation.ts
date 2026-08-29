/** Dev-only verification for campaign-blueprint automations. Creates review-only fixtures and cleans them up. */
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { campaignAutomationService } from "../server/services/campaignAutomationService";
import { marketingCampaignService } from "../server/services/marketingCampaignService";
import {
  contactGroups,
  marketingCampaigns,
  whatsappAiWorkbookVersions,
  whatsappAiWorkbooks,
  whatsappCampaignAutomationDispatches,
  whatsappCampaignAutomationRuns,
  whatsappCampaignAutomations,
  whatsappTemplates,
  type AiWorkbookSheet,
} from "@shared/schema";

function todayIn(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function main() {
  const [template] = await db.select().from(whatsappTemplates)
    .where(eq(whatsappTemplates.status, "approved"))
    .limit(1);
  if (!template) throw new Error("No approved WhatsApp template is available for verification");

  const businessAccountId = template.businessAccountId;
  const timezone = "Asia/Kolkata";
  const templateParams = Array.from({ length: template.paramCount }, (_, index) => `blueprint-${index + 1}`);
  const [sourceGroup] = await db.insert(contactGroups).values({
    businessAccountId,
    name: "BLUEPRINT SOURCE GROUP (temp)",
    description: "Temporary campaign-blueprint verification fixture",
    defaultCountryCode: "91",
    contactCount: 0,
  }).returning();
  const [blueprint] = await db.insert(marketingCampaigns).values({
    businessAccountId,
    name: "AUTOMATION BLUEPRINT VERIFY (temp)",
    campaignType: "automation",
    templateId: template.id,
    templateParams,
    groupIds: [sourceGroup.id],
    status: "draft",
    aiEnabled: "true",
    aiAgentName: "Blueprint Agent",
    aiSystemPrompt: "Original blueprint prompt",
    aiUseFaqs: "true",
    aiUseDocs: "false",
    aiUseProducts: "true",
    aiKnowledgeDocIds: [],
    replyClassifications: [{
      key: "interested",
      label: "Interested",
      description: "Customer wants a follow-up",
      captureFields: [],
    }],
    aiDailyTokenBudget: 43210,
    aiMaxRepliesPerRecipient: 7,
  }).returning();

  const sheets: AiWorkbookSheet[] = [{
    id: "contacts",
    name: "Contacts",
    kind: "custom",
    columns: [
      { key: "phone", label: "Phone", type: "text", source: "operator", editable: true },
      { key: "name", label: "Name", type: "text", source: "operator", editable: true },
      { key: "record_id", label: "Record ID", type: "text", source: "operator", editable: true },
      { key: "due_date", label: "Due Date", type: "date", source: "operator", editable: true },
      { key: "status", label: "Status", type: "text", source: "operator", editable: true },
    ],
    rows: [{
      id: "row-1",
      values: {
        phone: "9876543210",
        name: "Blueprint Verify",
        record_id: `blueprint-${Date.now()}`,
        due_date: todayIn(timezone),
        status: "pending",
      },
    }],
  }];
  const [workbook] = await db.insert(whatsappAiWorkbooks).values({
    businessAccountId,
    name: "BLUEPRINT WORKBOOK VERIFY (temp)",
    description: "Temporary campaign-blueprint verification fixture",
    sourceCampaignId: blueprint.id,
  }).returning();
  const [version] = await db.insert(whatsappAiWorkbookVersions).values({
    workbookId: workbook.id,
    businessAccountId,
    sourceCampaignId: blueprint.id,
    versionNumber: 1,
    source: "campaign",
    sheets,
  }).returning();

  let automationId: string | null = null;
  const runIds: string[] = [];
  const executionCampaignIds: string[] = [];
  const executionGroupIds: string[] = [];
  try {
    const automation = await campaignAutomationService.create(businessAccountId, {
      name: "BLUEPRINT AUTOMATION VERIFY (temp)",
      sourceType: "campaign_blueprint",
      sourceCampaignId: blueprint.id,
      templateId: blueprint.templateId,
      templateParams,
      phoneColumn: "phone",
      nameColumn: "name",
      recordKeyColumn: "record_id",
      dateColumn: "due_date",
      statusColumn: "status",
      eligibleStatuses: ["pending"],
      defaultCountryCode: "91",
      sendMode: "review",
      sendTime: "23:59",
      timezone,
      enabled: true,
    });
    automationId = automation.id;
    if (
      automation.sourceCampaignId !== blueprint.id
      || automation.sourceWorkbookId !== workbook.id
      || automation.templateId !== blueprint.templateId
    ) {
      throw new Error("Automation did not derive its campaign, workbook, and template from the blueprint");
    }

    const preview = await campaignAutomationService.preview(businessAccountId, automation.id, {});
    if (
      preview.summary.eligibleRows !== 1
      || preview.source.type !== "campaign_blueprint"
      || preview.source.campaignId !== blueprint.id
      || preview.source.versionId !== version.id
    ) {
      throw new Error("Blueprint preview did not return the expected campaign, workbook, and recipient");
    }

    let missingBlueprintTokenRejected = false;
    try {
      await campaignAutomationService.createRun(
        businessAccountId,
        automation.id,
        {
          expectedWorkbookVersionId: preview.source.versionId,
          expectedWorkbookRevision: preview.source.revision,
        },
        "",
      );
    } catch (error: any) {
      missingBlueprintTokenRejected = /campaign blueprint changed after validation/i.test(error.message);
    }
    if (!missingBlueprintTokenRejected) throw new Error("A run without a validated blueprint revision was not rejected");

    const changedAt = new Date(Date.now() + 1_000);
    await db.update(marketingCampaigns).set({
      aiSystemPrompt: "Updated blueprint prompt",
      updatedAt: changedAt,
    }).where(eq(marketingCampaigns.id, blueprint.id));
    let staleBlueprintRejected = false;
    try {
      await campaignAutomationService.createRun(
        businessAccountId,
        automation.id,
        {
          expectedWorkbookVersionId: preview.source.versionId,
          expectedWorkbookRevision: preview.source.revision,
          expectedCampaignUpdatedAt: preview.source.campaignUpdatedAt,
        },
        "",
      );
    } catch (error: any) {
      staleBlueprintRejected = /campaign blueprint changed after validation/i.test(error.message);
    }
    if (!staleBlueprintRejected) throw new Error("A stale campaign blueprint preview was not rejected");

    const freshPreview = await campaignAutomationService.preview(businessAccountId, automation.id, {});
    const created = await campaignAutomationService.createRun(
      businessAccountId,
      automation.id,
      {
        expectedWorkbookVersionId: freshPreview.source.versionId,
        expectedWorkbookRevision: freshPreview.source.revision,
        expectedCampaignUpdatedAt: freshPreview.source.campaignUpdatedAt,
      },
      "",
    );
    runIds.push(created.run.id);
    if (created.run.campaignId) executionCampaignIds.push(created.run.campaignId);
    if (created.run.contactGroupId) executionGroupIds.push(created.run.contactGroupId);
    if (
      created.run.sourceType !== "campaign_blueprint"
      || created.run.sourceCampaignId !== blueprint.id
      || created.run.sourceCampaignName !== blueprint.name
      || created.run.sourceWorkbookId !== workbook.id
      || created.run.sourceWorkbookVersionId !== version.id
      || created.run.sourceSnapshot?.recipients.length !== 1
      || created.run.blueprintSnapshot?.campaignId !== blueprint.id
      || created.run.status !== "awaiting_review"
    ) {
      throw new Error("Blueprint run provenance or review status was not preserved");
    }

    const generated = created.campaign;
    if (
      generated.templateId !== blueprint.templateId
      || generated.aiEnabled !== "true"
      || generated.aiAgentName !== "Blueprint Agent"
      || generated.aiSystemPrompt !== "Updated blueprint prompt"
      || generated.aiUseFaqs !== "true"
      || generated.aiUseDocs !== "false"
      || generated.aiUseProducts !== "true"
      || generated.aiDailyTokenBudget !== 43210
      || generated.aiMaxRepliesPerRecipient !== 7
      || !Array.isArray(generated.replyClassifications)
      || generated.replyClassifications.length !== 1
    ) {
      throw new Error("Generated campaign did not inherit the full blueprint behavior");
    }
    if ((generated.groupIds || []).includes(sourceGroup.id)) {
      throw new Error("Generated execution reused the blueprint's original audience group");
    }

    const executionDirectSend = await marketingCampaignService.startSend(businessAccountId, generated.id);
    if (executionDirectSend.started || !/scheduled automation run/i.test(executionDirectSend.reason || "")) {
      throw new Error("A review-mode execution campaign could be sent before approval");
    }
    let executionEditRejected = false;
    try {
      await marketingCampaignService.update(businessAccountId, generated.id, { name: "MUTATED EXECUTION" });
    } catch (error: any) {
      executionEditRejected = /immutable/i.test(error.message);
    }
    if (!executionEditRejected) throw new Error("An automation execution campaign could still be edited");
    let executionDeleteRejected = false;
    try {
      await marketingCampaignService.remove(businessAccountId, generated.id);
    } catch (error: any) {
      executionDeleteRejected = /run history/i.test(error.message);
    }
    if (!executionDeleteRejected) throw new Error("An automation execution campaign could still be deleted");
    let blueprintDeleteRejected = false;
    try {
      await marketingCampaignService.remove(businessAccountId, blueprint.id);
    } catch (error: any) {
      blueprintDeleteRejected = /automation blueprint/i.test(error.message);
    }
    if (!blueprintDeleteRejected) throw new Error("A referenced campaign blueprint could still be deleted");

    await db.update(whatsappCampaignAutomations)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(whatsappCampaignAutomations.id, automation.id));
    const directSend = await marketingCampaignService.startSend(businessAccountId, blueprint.id);
    if (directSend.started || !/automation blueprint|only run through Automations/i.test(directSend.reason || "")) {
      throw new Error("A blueprint attached to a paused automation could still be sent directly");
    }
    const refreshedBlueprint = await marketingCampaignService.get(businessAccountId, blueprint.id);
    if (!refreshedBlueprint || refreshedBlueprint.status !== "draft" || refreshedBlueprint.startedAt) {
      throw new Error("The original campaign blueprint was mutated by the automation run");
    }

    console.log("automation derives campaign and workbook from blueprint = true");
    console.log("blueprint preview pins campaign and workbook revisions = true");
    console.log("missing blueprint validation token rejected = true");
    console.log("stale blueprint preview rejected = true");
    console.log("run records campaign and workbook provenance = true");
    console.log("run stores immutable audience and blueprint snapshots = true");
    console.log("generated campaign inherits AI and outcome settings = true");
    console.log("generated execution uses its own audience group = true");
    console.log("review execution cannot bypass approval = true");
    console.log("execution campaign cannot be edited or deleted = true");
    console.log("referenced blueprint cannot be deleted = true");
    console.log("paused automation still protects its blueprint = true");
    console.log("original blueprint remains an unsent draft = true");
  } finally {
    if (runIds.length) {
      await db.delete(whatsappCampaignAutomationDispatches)
        .where(inArray(whatsappCampaignAutomationDispatches.runId, runIds));
      await db.delete(whatsappCampaignAutomationRuns)
        .where(inArray(whatsappCampaignAutomationRuns.id, runIds));
    }
    if (executionCampaignIds.length) {
      await db.delete(marketingCampaigns).where(inArray(marketingCampaigns.id, executionCampaignIds));
    }
    if (executionGroupIds.length) {
      await db.delete(contactGroups).where(inArray(contactGroups.id, executionGroupIds));
    }
    if (automationId) {
      await db.delete(whatsappCampaignAutomations).where(eq(whatsappCampaignAutomations.id, automationId));
    }
    await db.delete(whatsappAiWorkbookVersions).where(eq(whatsappAiWorkbookVersions.workbookId, workbook.id));
    await db.delete(whatsappAiWorkbooks).where(eq(whatsappAiWorkbooks.id, workbook.id));
    await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, blueprint.id));
    await db.delete(contactGroups).where(eq(contactGroups.id, sourceGroup.id));
    console.log("temporary blueprint verification data cleaned up");
  }
}

main().then(() => process.exit(0)).catch(error => {
  console.error("FAIL:", error.message);
  process.exit(1);
});