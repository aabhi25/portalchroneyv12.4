/** Dev-only verification for AI Workbook and upload-backed automations. Creates review-only fixtures and cleans them up. */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import { campaignAutomationService } from "../server/services/campaignAutomationService";
import { whatsappAiWorkbookService } from "../server/services/whatsappAiWorkbookService";
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
        name: "Workbook Verify",
        record_id: `verify-${Date.now()}`,
        due_date: todayIn(timezone),
        status: "pending",
      },
    }],
  }];

  const [workbook] = await db.insert(whatsappAiWorkbooks).values({
    businessAccountId,
    name: "WORKBOOK AUTOMATION VERIFY (temp)",
    description: "Temporary verification fixture",
  }).returning();
  const [version1] = await db.insert(whatsappAiWorkbookVersions).values({
    workbookId: workbook.id,
    businessAccountId,
    versionNumber: 1,
    source: "manual",
    sheets,
  }).returning();

  let workbookAutomationId: string | null = null;
  let uploadAutomationId: string | null = null;
  const runIds: string[] = [];
  const campaignIds: string[] = [];
  const groupIds: string[] = [];
  try {
    const templateParams = Array.from({ length: template.paramCount }, (_, index) => `verify-${index + 1}`);
    const workbookAutomation = await campaignAutomationService.create(businessAccountId, {
      name: "WORKBOOK AUTOMATION VERIFY (temp)",
      sourceType: "ai_workbook",
      sourceWorkbookId: workbook.id,
      sourceWorkbookSheetId: "contacts",
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
    workbookAutomationId = workbookAutomation.id;

    const preview = await campaignAutomationService.preview(businessAccountId, workbookAutomation.id, {});
    if (preview.summary.eligibleRows !== 1 || preview.source.type !== "ai_workbook") {
      throw new Error("Workbook preview did not return the expected recipient and source");
    }
    if (preview.source.versionId !== version1.id) throw new Error("Workbook preview did not record version 1");

    const [version2] = await db.insert(whatsappAiWorkbookVersions).values({
      workbookId: workbook.id,
      businessAccountId,
      versionNumber: 2,
      source: "manual",
      sheets,
    }).returning();
    let stalePreviewRejected = false;
    try {
      await campaignAutomationService.createRun(
        businessAccountId,
        workbookAutomation.id,
        { expectedWorkbookVersionId: version1.id, expectedWorkbookRevision: version1.revision },
        "",
      );
    } catch (error: any) {
      stalePreviewRejected = /changed after validation/i.test(error.message);
    }
    if (!stalePreviewRejected) throw new Error("A stale workbook preview was not rejected");
    let missingPreviewRejected = false;
    try {
      await campaignAutomationService.createRun(businessAccountId, workbookAutomation.id, {}, "");
    } catch (error: any) {
      missingPreviewRejected = /validate the latest/i.test(error.message);
    }
    if (!missingPreviewRejected) throw new Error("A workbook run without a validated version was not rejected");
    const version2Updated = await whatsappAiWorkbookService.saveSheets(
      businessAccountId,
      workbook.id,
      version2.id,
      version2.revision,
      sheets,
    );
    let staleRevisionRejected = false;
    try {
      await campaignAutomationService.createRun(
        businessAccountId,
        workbookAutomation.id,
        { expectedWorkbookVersionId: version2.id, expectedWorkbookRevision: version2.revision },
        "",
      );
    } catch (error: any) {
      staleRevisionRejected = /changed after validation/i.test(error.message);
    }
    if (!staleRevisionRejected) throw new Error("A stale workbook revision was not rejected");

    const created = await campaignAutomationService.createRun(
      businessAccountId,
      workbookAutomation.id,
      { expectedWorkbookVersionId: version2Updated.id, expectedWorkbookRevision: version2Updated.revision },
      "",
    );
    runIds.push(created.run.id);
    if (created.run.campaignId) campaignIds.push(created.run.campaignId);
    if (created.run.contactGroupId) groupIds.push(created.run.contactGroupId);
    if (
      created.run.sourceType !== "ai_workbook"
      || created.run.sourceWorkbookId !== workbook.id
      || created.run.sourceWorkbookVersionId !== version2Updated.id
      || created.run.sourceWorkbookName !== workbook.name
      || created.run.sourceWorkbookVersionNumber !== 2
      || created.run.sourceWorkbookRevision !== version2Updated.revision
      || created.run.sourceWorkbookSheetName !== "Contacts"
      || created.run.status !== "awaiting_review"
    ) {
      throw new Error("Workbook run provenance or review status was not preserved");
    }

    const uploadAutomation = await campaignAutomationService.create(businessAccountId, {
      name: "UPLOAD AUTOMATION VERIFY (temp)",
      sourceType: "upload",
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
    uploadAutomationId = uploadAutomation.id;
    const uploadPreview = await campaignAutomationService.preview(businessAccountId, uploadAutomation.id, {
      columns: sheets[0].columns.map(column => ({ key: column.key, label: column.label })),
      rows: sheets[0].rows.map((row, index) => ({
        r: index + 2,
        v: sheets[0].columns.map(column => String(row.values[column.key] ?? "")),
      })),
    });
    if (uploadPreview.summary.eligibleRows !== 1 || uploadPreview.source.type !== "upload") {
      throw new Error("Upload-backed preview no longer works");
    }

    console.log("workbook preview uses latest saved rows = true");
    console.log("stale workbook preview rejected = true");
    console.log("unvalidated workbook run rejected = true");
    console.log("stale workbook revision rejected = true");
    console.log("workbook run records exact version = true");
    console.log("review run remains unscheduled = true");
    console.log("upload-backed automation still works = true");
  } finally {
    if (runIds.length) {
      await db.delete(whatsappCampaignAutomationDispatches)
        .where(inArray(whatsappCampaignAutomationDispatches.runId, runIds));
      await db.delete(whatsappCampaignAutomationRuns)
        .where(inArray(whatsappCampaignAutomationRuns.id, runIds));
    }
    if (campaignIds.length) {
      await db.delete(marketingCampaigns).where(inArray(marketingCampaigns.id, campaignIds));
    }
    if (groupIds.length) {
      await db.delete(contactGroups).where(inArray(contactGroups.id, groupIds));
    }
    const automationIds = [workbookAutomationId, uploadAutomationId].filter((id): id is string => Boolean(id));
    if (automationIds.length) {
      await db.delete(whatsappCampaignAutomations)
        .where(and(
          eq(whatsappCampaignAutomations.businessAccountId, businessAccountId),
          inArray(whatsappCampaignAutomations.id, automationIds),
        ));
    }
    await db.delete(whatsappAiWorkbookVersions).where(eq(whatsappAiWorkbookVersions.workbookId, workbook.id));
    await db.delete(whatsappAiWorkbooks).where(eq(whatsappAiWorkbooks.id, workbook.id));
    console.log("temporary verification data cleaned up");
  }
}

main().then(() => process.exit(0)).catch(error => {
  console.error("FAIL:", error.message);
  process.exit(1);
});