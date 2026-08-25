/** Dev-only verification for workbook↔campaign linking (Task #13). Safe: works on a duplicate, deletes it after. */
import { db } from "../server/db";
import { whatsappAiWorkbooks, whatsappAiWorkbookVersions, marketingCampaigns } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { whatsappAiWorkbookService } from "../server/services/whatsappAiWorkbookService";

async function main() {
  const [campaign] = await db.select().from(marketingCampaigns)
    .where(eq(marketingCampaigns.name, "DEV SIMULATION — Loan Recovery (50 replies)")).limit(1);
  if (!campaign) throw new Error("simulated campaign not found");
  const copy = await whatsappAiWorkbookService.create(campaign.businessAccountId, { name: "LINK VERIFY (temp)" });
  try {
    // independent rows: one matching a campaign recipient phone, one unmatched, plus an operator column
    const v = copy.currentVersion;
    const sheets = v.sheets as any[];
    sheets[0].columns.push({ key: "team_notes", label: "Team Notes", source: "operator", editable: true, type: "text" });
    sheets[0].rows = [
      { id: "r1", values: { name: "Aarav (mine)", phone: "12025550101", team_notes: "KEEP-ME" } },
      { id: "r2", values: { name: "Outsider", phone: "919999888877", team_notes: "ALSO-KEEP" } },
    ];
    await whatsappAiWorkbookService.saveSheets(campaign.businessAccountId, copy.id, v.id, v.revision, sheets);
    const markedPhone = "12025550101";

    const saved = await whatsappAiWorkbookService.get(campaign.businessAccountId, copy.id);
    const linked = await whatsappAiWorkbookService.linkToCampaign(campaign.businessAccountId, copy.id, campaign.id, {
      expectedCurrentVersionId: saved!.currentVersion!.id,
      expectedRevision: saved!.currentVersion!.revision,
    });
    // stale-version link attempt must be rejected
    let staleRejected = false;
    try {
      await whatsappAiWorkbookService.linkToCampaign(campaign.businessAccountId, copy.id, campaign.id, {
        expectedCurrentVersionId: saved!.currentVersion!.id,
        expectedRevision: saved!.currentVersion!.revision,
      });
    } catch { staleRejected = true; }
    console.log("stale link attempt rejected =", staleRejected);
    const ls = (linked.version!.sheets as any[])[0];
    const markedRow = ls.rows.find((r: any) => String(r.values.phone) === String(markedPhone));
    console.log("after link: rows =", ls.rows.length, "| outcome col present =", ls.columns.some((c: any) => c.key === "classification_label"));
    console.log("operator note preserved on matched row =", markedRow?.values.team_notes === "KEEP-ME");
    console.log("matched rows with outcomes =", ls.rows.filter((r: any) => r.values.classification_label).length);

    const refreshed = await whatsappAiWorkbookService.refreshFromCampaign(campaign.businessAccountId, copy.id);
    const rs = (refreshed.sheets as any[])[0];
    const rRow = rs.rows.find((r: any) => String(r.values.phone) === String(markedPhone));
    console.log("after refresh: rows =", rs.rows.length, "| note survived refresh =", rRow?.values.team_notes === "KEEP-ME");

    const unlinked = await whatsappAiWorkbookService.linkToCampaign(campaign.businessAccountId, copy.id, null);
    console.log("unlinked ok =", unlinked.workbook.sourceCampaignId === null);
  } finally {
    await db.delete(whatsappAiWorkbookVersions).where(eq(whatsappAiWorkbookVersions.workbookId, copy.id));
    await db.delete(whatsappAiWorkbooks).where(eq(whatsappAiWorkbooks.id, copy.id));
    console.log("temp workbook cleaned up");
  }
  process.exit(0);
}
main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
