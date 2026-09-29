/**
 * One-off migration: move existing WhatsApp customer documents (Aadhaar / PAN / bank
 * statements) from the PUBLIC R2 bucket to the PRIVATE bucket (R2_PRIVATE_BUCKET_NAME).
 *
 * For each distinct public file referenced by whatsapp_lead_attachments.file_path
 * (keys under `whatsapp/` in our public bucket only):
 *   1. copy the object into the private bucket under the same key and verify it exists;
 *   2. in one DB transaction, rewrite every reference to `r2private://<key>`:
 *        - whatsapp_lead_attachments.file_path
 *        - whatsapp_leads.extracted_data            (_documents / _collectedDocuments fileUrls)
 *        - whatsapp_flow_sessions.collected_data    (_collectedDocuments fileUrls)
 *   3. delete the public copy.
 *
 * DRY RUN BY DEFAULT — nothing is copied, written or deleted unless --apply is passed.
 *
 * Resumable: migrated rows no longer hold a public URL, so a re-run picks up where the last
 * one stopped. Public copies whose delete failed are remembered in --state-file and retried
 * first on the next run.
 *
 * Usage:
 *   npx tsx scripts/migrate-whatsapp-docs-private.ts                      # dry run, report only
 *   npx tsx scripts/migrate-whatsapp-docs-private.ts --apply              # migrate everything
 *   npx tsx scripts/migrate-whatsapp-docs-private.ts --apply --batch-size=50 --limit=500
 *   npx tsx scripts/migrate-whatsapp-docs-private.ts --apply --business-account=<id>
 *   npx tsx scripts/migrate-whatsapp-docs-private.ts --apply --keep-public   # copy+rewrite, keep public copies
 *
 * Requires DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
 * R2_PUBLIC_URL (if a custom domain is used) and R2_PRIVATE_BUCKET_NAME.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { r2Storage, PRIVATE_REF_PREFIX } from "../server/services/r2StorageService";

export interface Options {
  apply: boolean;
  batchSize: number;
  limit: number;
  businessAccountId: string | null;
  keepPublic: boolean;
  stateFile: string;
}

export function parseArgs(argv: string[]): Options {
  const get = (name: string) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const num = (name: string, fallback: number) => {
    const v = parseInt(get(name) || "", 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    apply: argv.includes("--apply") && !argv.includes("--dry-run"),
    batchSize: num("batch-size", 100),
    limit: num("limit", Number.MAX_SAFE_INTEGER),
    businessAccountId: get("business-account") || null,
    keepPublic: argv.includes("--keep-public"),
    stateFile: get("state-file") || path.join(process.cwd(), "scripts", ".migrate-whatsapp-docs-private.state.json"),
  };
}

interface State { pendingPublicDeletes: string[] }

function loadState(file: string): State {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { pendingPublicDeletes: Array.isArray(parsed.pendingPublicDeletes) ? parsed.pendingPublicDeletes : [] };
  } catch {
    return { pendingPublicDeletes: [] };
  }
}

function saveState(file: string, state: State) {
  if (state.pendingPublicDeletes.length === 0) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

export async function runMigration(opts: Options) {
  const summary = {
    mode: opts.apply ? "APPLY" : "DRY RUN",
    filesScanned: 0,
    filesEligible: 0,
    skippedNotOurBucket: 0,
    skippedNotWhatsappKey: 0,
    migrated: 0,
    copyFailed: 0,
    dbFailed: 0,
    attachmentRowsUpdated: 0,
    leadRowsUpdated: 0,
    sessionRowsUpdated: 0,
    publicDeleted: 0,
    publicDeleteFailed: 0,
    publicDeleteRetried: 0,
  };

  const configured = await r2Storage.ensureInitialized();
  if (!configured) throw new Error("R2 storage is not configured");
  if (!r2Storage.isPrivateBucketConfigured()) {
    if (opts.apply) throw new Error("R2_PRIVATE_BUCKET_NAME is not set — refusing to migrate");
    console.warn("[migrate] R2_PRIVATE_BUCKET_NAME is not set (dry run continues, --apply would refuse)");
  }

  console.log(`[migrate] ${summary.mode} — batch size ${opts.batchSize}${opts.limit < Number.MAX_SAFE_INTEGER ? `, limit ${opts.limit}` : ""}${opts.businessAccountId ? `, account ${opts.businessAccountId}` : ""}${opts.keepPublic ? ", keeping public copies" : ""}`);

  // Retry public deletes that failed on a previous run.
  const state = loadState(opts.stateFile);
  if (opts.apply && !opts.keepPublic && state.pendingPublicDeletes.length > 0) {
    const retry = state.pendingPublicDeletes;
    state.pendingPublicDeletes = [];
    for (const url of retry) {
      const res = await r2Storage.deleteByRef(url);
      summary.publicDeleteRetried++;
      if (res.success) summary.publicDeleted++;
      else state.pendingPublicDeletes.push(url);
    }
    saveState(opts.stateFile, state);
  }

  let lastFilePath = "";
  let processed = 0;
  while (processed < opts.limit) {
    const pageSize = Math.min(opts.batchSize, opts.limit - processed);
    // Keyset pagination: works for dry runs (rows unchanged) and apply runs alike.
    const result = await db.execute(sql`
      SELECT file_path, MIN(business_account_id) AS business_account_id
      FROM whatsapp_lead_attachments
      WHERE file_path LIKE 'https://%'
        AND file_path > ${lastFilePath}
        ${opts.businessAccountId ? sql`AND business_account_id = ${opts.businessAccountId}` : sql``}
      GROUP BY file_path
      ORDER BY file_path
      LIMIT ${pageSize}
    `);
    const rows = ((result as any).rows || []) as { file_path: string; business_account_id: string }[];
    if (rows.length === 0) break;
    lastFilePath = rows[rows.length - 1].file_path;

    for (const row of rows) {
      processed++;
      summary.filesScanned++;
      const oldUrl = row.file_path;
      const ref = r2Storage.parseRef(oldUrl);
      if (!ref || ref.bucket !== "public") { summary.skippedNotOurBucket++; continue; }
      if (!ref.key.startsWith("whatsapp/")) { summary.skippedNotWhatsappKey++; continue; }
      summary.filesEligible++;
      const newRef = `${PRIVATE_REF_PREFIX}${ref.key}`;

      if (!opts.apply) {
        console.log(`[migrate] would migrate ${ref.key}`);
        continue;
      }

      const copy = await r2Storage.copyPublicToPrivate(ref.key);
      if (!copy.success) {
        summary.copyFailed++;
        console.error(`[migrate] copy failed for ${ref.key}: ${copy.error}`);
        continue;
      }

      try {
        await db.transaction(async (tx) => {
          const a = await tx.execute(sql`
            UPDATE whatsapp_lead_attachments SET file_path = ${newRef} WHERE file_path = ${oldUrl}
          `);
          const l = await tx.execute(sql`
            UPDATE whatsapp_leads
            SET extracted_data = replace(extracted_data::text, ${oldUrl}, ${newRef})::jsonb
            WHERE business_account_id = ${row.business_account_id}
              AND extracted_data IS NOT NULL
              AND position(${oldUrl} in extracted_data::text) > 0
          `);
          const s = await tx.execute(sql`
            UPDATE whatsapp_flow_sessions
            SET collected_data = replace(collected_data::text, ${oldUrl}, ${newRef})::jsonb
            WHERE business_account_id = ${row.business_account_id}
              AND collected_data IS NOT NULL
              AND position(${oldUrl} in collected_data::text) > 0
          `);
          summary.attachmentRowsUpdated += (a as any).rowCount || 0;
          summary.leadRowsUpdated += (l as any).rowCount || 0;
          summary.sessionRowsUpdated += (s as any).rowCount || 0;
        });
      } catch (err: any) {
        // Private copy is harmless (unreferenced); the public file is untouched. Re-run to retry.
        summary.dbFailed++;
        console.error(`[migrate] DB rewrite failed for ${ref.key}: ${err?.message}`);
        continue;
      }
      summary.migrated++;

      if (!opts.keepPublic) {
        const del = await r2Storage.deleteByRef(oldUrl);
        if (del.success) summary.publicDeleted++;
        else {
          summary.publicDeleteFailed++;
          state.pendingPublicDeletes.push(oldUrl);
          saveState(opts.stateFile, state);
        }
      }
    }
    console.log(`[migrate] progress: ${processed} file(s) scanned, ${summary.migrated} migrated`);
  }

  saveState(opts.stateFile, state);
  console.log("[migrate] summary:");
  console.table(summary);
  if (state.pendingPublicDeletes.length > 0) {
    console.warn(`[migrate] ${state.pendingPublicDeletes.length} public copies could not be deleted; re-run with --apply to retry (state: ${opts.stateFile})`);
  }
  return summary;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  runMigration(parseArgs(process.argv.slice(2)))
    .then(async () => { await pool.end(); process.exit(0); })
    .catch(async (err) => {
      console.error("[migrate] failed:", err?.message || err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
