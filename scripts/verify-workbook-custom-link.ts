/** Dev-only verification for custom-column campaign linking + column mapping (Task #14). Safe: works on a duplicate, deletes it after. */
import { db } from "../server/db";
import { whatsappAiWorkbooks, whatsappAiWorkbookVersions, marketingCampaigns } from "@shared/schema";
import { eq } from "drizzle-orm";
import { whatsappAiWorkbookService } from "../server/services/whatsappAiWorkbookService";

async function main() {
  const [campaign] = await db.select().from(marketingCampaigns)
    .where(eq(marketingCampaigns.name, "DEV SIMULATION — Loan Recovery (50 replies)")).limit(1);
  if (!campaign) throw new Error("simulated campaign not found");
  const copy = await whatsappAiWorkbookService.create(campaign.businessAccountId, { name: "CUSTOM LINK VERIFY (temp)" });
  try {
    const created = copy.currentVersion;

    // Link in custom mode: only Name/Phone should come in, no AI/system columns.
    const linked = await whatsappAiWorkbookService.linkToCampaign(campaign.businessAccountId, copy.id, campaign.id, {
      expectedCurrentVersionId: created.id,
      expectedRevision: created.revision,
    }, "custom");
    const linkedSheet = (linked.version!.sheets as any[])[0];
    const onlyIdentity = linkedSheet.columns.every((c: any) => c.source === "operator" || ["name", "phone"].includes(c.key));
    console.log("custom link pulls only identity columns =", onlyIdentity, "| columns =", linkedSheet.columns.map((c: any) => c.key).join(","));
    console.log("custom link row count =", linkedSheet.rows.length);

    // Add a team column, then map it to the campaign's reply-outcome field.
    linkedSheet.columns.push({ key: "my_status", label: "My Status", source: "operator", editable: true, type: "text" });
    for (const row of linkedSheet.rows) row.values.my_status = "";
    let v2 = await whatsappAiWorkbookService.saveSheets(campaign.businessAccountId, copy.id, linked.version!.id, linked.version!.revision, [linkedSheet]);

    const mapped = await whatsappAiWorkbookService.mapColumn(campaign.businessAccountId, copy.id, {
      columnKey: "my_status",
      mapping: { source: "outcome_label", format: "text" },
      expectedCurrentVersionId: v2.id,
      expectedRevision: v2.revision,
    });
    const mappedSheet = (mapped.sheets as any[])[0];
    const populatedCount = mappedSheet.rows.filter((r: any) => r.values.my_status).length;
    console.log("mapping populated values immediately =", populatedCount, "rows out of", mappedSheet.rows.length);

    // Refresh should keep re-applying the mapping, not revert to full column set.
    const refreshed = await whatsappAiWorkbookService.refreshFromCampaign(campaign.businessAccountId, copy.id);
    const refreshedSheet = (refreshed.sheets as any[])[0];
    const stillIdentityOnly = refreshedSheet.columns.every((c: any) => c.source === "operator" || ["name", "phone"].includes(c.key));
    const stillMapped = refreshedSheet.columns.find((c: any) => c.key === "my_status")?.campaignMapping?.source === "outcome_label";
    const stillPopulated = refreshedSheet.rows.filter((r: any) => r.values.my_status).length;
    console.log("refresh keeps custom column shape =", stillIdentityOnly, "| mapping survives refresh =", stillMapped, "| still populated =", stillPopulated);

    // Clearing the mapping should stop future auto-updates but not erase existing values.
    const cleared = await whatsappAiWorkbookService.mapColumn(campaign.businessAccountId, copy.id, {
      columnKey: "my_status",
      mapping: null,
      expectedCurrentVersionId: refreshed.id,
      expectedRevision: refreshed.revision,
    });
    const clearedSheet = (cleared.sheets as any[])[0];
    const clearedCol = clearedSheet.columns.find((c: any) => c.key === "my_status");
    const valuesKeptAfterClear = clearedSheet.rows.filter((r: any) => r.values.my_status).length;
    console.log("mapping cleared =", !clearedCol.campaignMapping, "| existing values kept =", valuesKeptAfterClear === stillPopulated);

    // A non-operator (identity) column must never be mappable.
    let identityMapRejected = false;
    try {
      await whatsappAiWorkbookService.mapColumn(campaign.businessAccountId, copy.id, {
        columnKey: "name",
        mapping: { source: "outcome_label", format: "text" },
        expectedCurrentVersionId: cleared.id,
        expectedRevision: cleared.revision,
      });
    } catch { identityMapRejected = true; }
    console.log("mapping identity column rejected =", identityMapRejected);
  } finally {
    await db.delete(whatsappAiWorkbookVersions).where(eq(whatsappAiWorkbookVersions.workbookId, copy.id));
    await db.delete(whatsappAiWorkbooks).where(eq(whatsappAiWorkbooks.id, copy.id));
    console.log("temp workbook cleaned up");
  }
  process.exit(0);
}
main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
