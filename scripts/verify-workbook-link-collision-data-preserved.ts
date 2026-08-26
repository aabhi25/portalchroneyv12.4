/** Dev-only check: a workbook's pre-existing name/phone data survives collision-safe linking, only truly empty scaffold columns get dropped. Safe: works on a duplicate, deletes it after. */
import { db } from "../server/db";
import { whatsappAiWorkbooks, whatsappAiWorkbookVersions, marketingCampaigns } from "@shared/schema";
import { eq } from "drizzle-orm";
import { whatsappAiWorkbookService } from "../server/services/whatsappAiWorkbookService";

async function main() {
  const [campaign] = await db.select().from(marketingCampaigns)
    .where(eq(marketingCampaigns.name, "DEV SIMULATION — Loan Recovery (50 replies)")).limit(1);
  if (!campaign) throw new Error("simulated campaign not found");

  // Case A: blank workbook, never touched -> its default name/phone columns must NOT survive as duplicates.
  const blank = await whatsappAiWorkbookService.create(campaign.businessAccountId, { name: "COLLISION VERIFY blank (temp)" });
  try {
    const v = blank.currentVersion;
    const linked = await whatsappAiWorkbookService.linkToCampaign(campaign.businessAccountId, blank.id, campaign.id, {
      expectedCurrentVersionId: v.id, expectedRevision: v.revision,
    }, "full");
    const cols = (linked.version!.sheets as any[])[0].columns.map((c: any) => c.key);
    console.log("Case A (blank scaffold) — no duplicate name/phone columns =", !cols.includes("name_2") && !cols.includes("phone_2"));
  } finally {
    await db.delete(whatsappAiWorkbookVersions).where(eq(whatsappAiWorkbookVersions.workbookId, blank.id));
    await db.delete(whatsappAiWorkbooks).where(eq(whatsappAiWorkbooks.id, blank.id));
  }

  // Case B: blank workbook where the operator typed real name/phone data before ever linking -> that data must survive under a renamed column.
  const filled = await whatsappAiWorkbookService.create(campaign.businessAccountId, { name: "COLLISION VERIFY filled (temp)" });
  try {
    const v = filled.currentVersion;
    const sheets = v.sheets as any[];
    sheets[0].rows = [{ id: "r1", values: { name: "Pre-existing Contact", phone: "919999000011" } }];
    const saved = await whatsappAiWorkbookService.saveSheets(campaign.businessAccountId, filled.id, v.id, v.revision, sheets);
    const linked = await whatsappAiWorkbookService.linkToCampaign(campaign.businessAccountId, filled.id, campaign.id, {
      expectedCurrentVersionId: saved.id, expectedRevision: saved.revision,
    }, "full");
    const ls = (linked.version!.sheets as any[])[0];
    const keptCol = ls.columns.find((c: any) => c.key === "name_2" || c.key === "phone_2");
    const keptRow = ls.rows.find((r: any) => r.values.name_2 === "Pre-existing Contact" || r.values.phone_2 === "919999000011");
    console.log("Case B (real pre-existing data) — renamed duplicate column kept =", !!keptCol, "| data preserved =", !!keptRow);
  } finally {
    await db.delete(whatsappAiWorkbookVersions).where(eq(whatsappAiWorkbookVersions.workbookId, filled.id));
    await db.delete(whatsappAiWorkbooks).where(eq(whatsappAiWorkbooks.id, filled.id));
  }
  console.log("cleaned up");
  process.exit(0);
}
main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
