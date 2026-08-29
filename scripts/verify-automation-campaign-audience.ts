/** Dev-only verification for automation campaigns whose audience is selected during automation setup. */
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { campaignAutomationService } from "../server/services/campaignAutomationService";
import { marketingCampaignService } from "../server/services/marketingCampaignService";
import {
  contactGroupContacts,
  contactGroups,
  marketingCampaigns,
  whatsappAiWorkbooks,
  whatsappCampaignAutomationDispatches,
  whatsappCampaignAutomationRuns,
  whatsappCampaignAutomations,
  whatsappTemplates,
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
  const templateParams = Array.from({ length: template.paramCount }, (_, index) => `automation-${index + 1}`);
  const createdCampaignIds: string[] = [];
  const createdGroupIds: string[] = [];
  const createdWorkbookIds: string[] = [];
  let automationId: string | null = null;

  try {
    const blueprint = await marketingCampaignService.create(businessAccountId, {
      name: "AUTOMATION CAMPAIGN AUDIENCE VERIFY (temp)",
      campaignType: "automation",
      templateId: template.id,
      templateParams,
      groupIds: [],
      scheduledAt: new Date(Date.now() + 86_400_000),
      aiEnabled: true,
      aiAgentName: "Automation Verify",
      aiSystemPrompt: "Verify automation-owned audience",
      aiUseFaqs: true,
      aiUseDocs: true,
      aiUseProducts: true,
      aiKnowledgeDocIds: [],
      replyClassifications: [],
      aiDailyTokenBudget: 50000,
      aiMaxRepliesPerRecipient: 20,
    });
    createdCampaignIds.push(blueprint.id);
    if (
      blueprint.campaignType !== "automation"
      || (blueprint.groupIds || []).length !== 0
      || blueprint.scheduledAt !== null
      || blueprint.status !== "draft"
    ) {
      throw new Error("Automation campaign retained a campaign audience or one-time schedule");
    }

    const [sourceGroup] = await db.insert(contactGroups).values({
      businessAccountId,
      name: "AUTOMATION FIXED AUDIENCE VERIFY (temp)",
      description: "Temporary fixed-audience verification fixture",
      defaultCountryCode: "91",
      contactCount: 1,
    }).returning();
    createdGroupIds.push(sourceGroup.id);
    await db.insert(contactGroupContacts).values({
      businessAccountId,
      groupId: sourceGroup.id,
      phone: "9876543210",
      name: "Fixed Audience Verify",
      attributes: {
        record_id: `fixed-${Date.now()}`,
        due_date: todayIn(timezone),
        status: "pending",
      },
    });

    const [oneTimeCampaign] = await db.insert(marketingCampaigns).values({
      businessAccountId,
      name: "ONE-TIME BLUEPRINT REJECTION VERIFY (temp)",
      campaignType: "one_time",
      templateId: template.id,
      templateParams,
      groupIds: [sourceGroup.id],
      status: "draft",
    }).returning();
    createdCampaignIds.push(oneTimeCampaign.id);
    let oneTimeRejected = false;
    try {
      await campaignAutomationService.create(businessAccountId, {
        name: "INVALID ONE-TIME AUTOMATION VERIFY (temp)",
        sourceType: "campaign_blueprint",
        sourceCampaignId: oneTimeCampaign.id,
        sourceGroupIds: [sourceGroup.id],
        templateId: template.id,
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
    } catch (error: any) {
      oneTimeRejected = /one-time campaigns cannot be used/i.test(error.message);
    }
    if (!oneTimeRejected) throw new Error("A one-time campaign was accepted as a new automation blueprint");

    const [inactiveWorkbook] = await db.insert(whatsappAiWorkbooks).values({
      businessAccountId,
      name: "INACTIVE WORKBOOK REJECTION VERIFY (temp)",
      status: "archived",
    }).returning();
    createdWorkbookIds.push(inactiveWorkbook.id);
    let inactiveWorkbookRejected = false;
    try {
      await campaignAutomationService.create(businessAccountId, {
        name: "INVALID INACTIVE WORKBOOK AUTOMATION VERIFY (temp)",
        sourceType: "ai_workbook",
        sourceWorkbookId: inactiveWorkbook.id,
        templateId: template.id,
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
    } catch (error: any) {
      inactiveWorkbookRejected = /no longer available/i.test(error.message);
    }
    if (!inactiveWorkbookRejected) throw new Error("An inactive AI Workbook was accepted as a new automation source");

    const automation = await campaignAutomationService.create(businessAccountId, {
      name: "FIXED AUDIENCE AUTOMATION VERIFY (temp)",
      sourceType: "campaign_blueprint",
      sourceCampaignId: blueprint.id,
      sourceWorkbookId: null,
      sourceGroupIds: [sourceGroup.id],
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
      automation.sourceWorkbookId !== null
      || !Array.isArray(automation.sourceGroupIds)
      || automation.sourceGroupIds[0] !== sourceGroup.id
    ) {
      throw new Error("Automation did not persist its fixed audience");
    }
    let referencedConversionRejected = false;
    try {
      await marketingCampaignService.update(businessAccountId, blueprint.id, {
        campaignType: "one_time",
        groupIds: [sourceGroup.id],
      });
    } catch (error: any) {
      referencedConversionRejected = /delete the linked automation/i.test(error.message);
    }
    if (!referencedConversionRejected) {
      throw new Error("A referenced automation campaign was converted into a one-time campaign");
    }

    const preview = await campaignAutomationService.preview(businessAccountId, automation.id, {});
    if (
      preview.summary.eligibleRows !== 1
      || preview.source.type !== "campaign_blueprint"
      || preview.source.audienceType !== "contact_groups"
      || preview.source.groupIds?.[0] !== sourceGroup.id
    ) {
      throw new Error("Fixed contact-group audience did not validate through the campaign blueprint");
    }

    const created = await campaignAutomationService.createRun(
      businessAccountId,
      automation.id,
      { expectedCampaignUpdatedAt: preview.source.campaignUpdatedAt },
      "",
    );
    if (created.run.campaignId) createdCampaignIds.push(created.run.campaignId);
    if (created.run.contactGroupId) createdGroupIds.push(created.run.contactGroupId);
    if (
      created.run.sourceWorkbookId !== null
      || created.run.sourceGroupIds?.[0] !== sourceGroup.id
      || created.run.sourceGroupNames?.[0] !== sourceGroup.name
      || created.run.sourceSnapshot?.recipients.length !== 1
    ) {
      throw new Error("Fixed audience run did not preserve immutable group provenance and recipients");
    }

    const directSend = await marketingCampaignService.startSend(businessAccountId, blueprint.id);
    if (directSend.started || !/only run through Automations/i.test(directSend.reason || "")) {
      throw new Error("Automation campaign draft could be sent directly");
    }

    console.log("automation campaign saves without campaign audience or one-time schedule = true");
    console.log("automation setup persists fixed contact-group audience = true");
    console.log("fixed audience preview validates current contact fields = true");
    console.log("run snapshots fixed audience and provenance = true");
    console.log("automation campaign direct send remains blocked = true");
    console.log("one-time campaign rejected as new automation blueprint = true");
    console.log("inactive AI Workbook rejected as automation source = true");
    console.log("referenced automation campaign cannot convert to one-time = true");
  } finally {
    if (automationId) {
      const runs = await db.select({ id: whatsappCampaignAutomationRuns.id })
        .from(whatsappCampaignAutomationRuns)
        .where(eq(whatsappCampaignAutomationRuns.automationId, automationId));
      if (runs.length) {
        await db.delete(whatsappCampaignAutomationDispatches)
          .where(inArray(whatsappCampaignAutomationDispatches.runId, runs.map(run => run.id)));
        await db.delete(whatsappCampaignAutomationRuns)
          .where(inArray(whatsappCampaignAutomationRuns.id, runs.map(run => run.id)));
      }
      await db.delete(whatsappCampaignAutomations).where(eq(whatsappCampaignAutomations.id, automationId));
    }
    if (createdCampaignIds.length) {
      await db.delete(marketingCampaigns).where(inArray(marketingCampaigns.id, createdCampaignIds));
    }
    if (createdGroupIds.length) {
      await db.delete(contactGroups).where(inArray(contactGroups.id, createdGroupIds));
    }
    if (createdWorkbookIds.length) {
      await db.delete(whatsappAiWorkbooks).where(inArray(whatsappAiWorkbooks.id, createdWorkbookIds));
    }
    console.log("temporary automation campaign audience verification data cleaned up");
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});