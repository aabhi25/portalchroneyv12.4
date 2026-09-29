/**
 * WhatsApp KYC documents in a private R2 bucket (review finding H1).
 *
 * DESTRUCTIVE: creates and deletes rows. Refuses to run unless DATABASE_URL points at
 * localhost AND WA_DOCS_TEST_DB=1. R2 is replaced by an in-memory S3 stub — the real
 * bucket is never contacted. Run against a throwaway Postgres with the schema pushed:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55443/postgres?sslmode=disable \
 *   WA_DOCS_TEST_DB=1 npx tsx server/services/__tests__/whatsappPrivateDocuments.test.ts
 */
const url = process.env.DATABASE_URL || '';
if (process.env.WA_DOCS_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set WA_DOCS_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
// Never let the singleton pick up real credentials from the environment.
for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'R2_PRIVATE_BUCKET_NAME', 'R2_PRIVATE_SHARE_TTL_SECONDS']) delete process.env[k];

import { Readable, Writable } from "stream";
import { createHash, createHmac } from "crypto";
import os from "os";
import path from "path";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

// ── In-memory S3 stub ────────────────────────────────────────────────────────
class StubS3 {
  objects = new Map<string, { body: Buffer; contentType?: string }>();
  failDeleteKeys = new Set<string>();
  calls: string[] = [];
  async send(cmd: any): Promise<any> {
    const name = cmd.constructor.name as string;
    const { Bucket, Key } = cmd.input;
    this.calls.push(`${name} ${Bucket}/${Key}`);
    const id = `${Bucket}/${Key}`;
    switch (name) {
      case 'PutObjectCommand':
        this.objects.set(id, { body: Buffer.from(cmd.input.Body), contentType: cmd.input.ContentType });
        return {};
      case 'GetObjectCommand': {
        const o = this.objects.get(id);
        if (!o) { const e: any = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
        return { Body: Readable.from([o.body]), ContentType: o.contentType, ContentLength: o.body.length };
      }
      case 'DeleteObjectCommand':
        if (this.failDeleteKeys.has(Key)) throw new Error('simulated R2 outage');
        this.objects.delete(id);
        return {};
      case 'CopyObjectCommand': {
        const src = decodeURIComponent(cmd.input.CopySource);
        const o = this.objects.get(src);
        if (!o) { const e: any = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
        this.objects.set(id, { ...o });
        return {};
      }
      case 'HeadObjectCommand':
        if (!this.objects.has(id)) { const e: any = new Error('NotFound'); e.name = 'NotFound'; throw e; }
        return {};
      default:
        throw new Error(`unexpected command ${name}`);
    }
  }
  has(bucket: string, key: string) { return this.objects.has(`${bucket}/${key}`); }
}

const CFG = { accountId: 'acct123', accessKeyId: 'AKIDTEST', secretAccessKey: 'secretTEST', bucketName: 'pub', publicUrl: 'https://files.example.com' };
const PRIV = 'priv';

// Minimal Express-like response capturing a streamed body.
function fakeRes() {
  const chunks: Buffer[] = [];
  const res: any = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
  res.statusCode = 200;
  res.headers = {} as Record<string, string>;
  res.headersSent = false;
  res.body = undefined as any;
  res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; res.headersSent = true; res.emit('finish'); return res; };
  res.done = new Promise<void>(resolve => res.on('finish', () => resolve()));
  res.bytes = () => Buffer.concat(chunks);
  return res;
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { r2Storage } = await import("../r2StorageService");
  const { whatsappService } = await import("../whatsappService");
  const { serveWhatsappDocument } = await import("../../routes/whatsappDocuments");
  const { deleteStoredFile } = await import("../dataRetentionService");
  const { runMigration } = await import("../../../scripts/migrate-whatsapp-docs-private");

  const s3 = new StubS3();

  // ── 1. Fallback when no private bucket is configured ───────────────────────
  {
    r2Storage.configureForTesting(s3 as any, { ...CFG });
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: any[]) => { warnings.push(a.join(' ')); };
    const r1 = await r2Storage.uploadSensitiveFile(Buffer.from('a'), 'a.jpg', 'whatsapp/x', 'image/jpeg', 'biz');
    const r2 = await r2Storage.uploadSensitiveFile(Buffer.from('b'), 'b.jpg', 'whatsapp/x', 'image/jpeg', 'biz');
    console.warn = origWarn;
    expect(r1.success && r1.ref?.startsWith('https://files.example.com/whatsapp/x/biz/') && r1.isPrivate === false, 'no private bucket → falls back to public URL', r1);
    expect(r2.success && s3.has('pub', r2.key!), 'fallback upload lands in the public bucket');
    expect(warnings.filter(w => w.includes('R2_PRIVATE_BUCKET_NAME')).length === 1, 'fallback warning is logged once', warnings);
  }

  r2Storage.configureForTesting(s3 as any, { ...CFG, privateBucketName: PRIV });

  // ── 2. Private upload stores an r2private ref ───────────────────────────────
  {
    const r = await r2Storage.uploadSensitiveFile(Buffer.from('img'), 'aadhaar.jpg', 'whatsapp/lead1', 'image/jpeg', 'biz');
    expect(r.success && r.ref === `r2private://${r.key}` && r.isPrivate, 'private upload returns r2private://<key>', r);
    expect(s3.has(PRIV, r.key!) && !s3.has('pub', r.key!), 'private upload lands only in the private bucket');
  }

  // ── 3. Shareable URLs ───────────────────────────────────────────────────────
  {
    const pub = 'https://files.example.com/whatsapp/old/biz/1-x.jpg';
    expect(await r2Storage.getShareableUrl(pub) === pub, 'getShareableUrl passes legacy public URLs through');
    expect(await r2Storage.getShareableUrl('https://other.example/x.pdf') === 'https://other.example/x.pdf', 'getShareableUrl passes foreign URLs through');
    expect(await r2Storage.getShareableUrl(null) === null, 'getShareableUrl(null) → null');
    const signed = (await r2Storage.getShareableUrl('r2private://whatsapp/l/biz/1-a b.jpg'))!;
    const u = new URL(signed);
    expect(u.host === 'acct123.r2.cloudflarestorage.com' && u.pathname === '/priv/whatsapp/l/biz/1-a%20b.jpg', 'presigned URL targets the private bucket on the S3 endpoint', signed);
    expect(u.searchParams.get('X-Amz-Expires') === '604800' && /^[0-9a-f]{64}$/.test(u.searchParams.get('X-Amz-Signature') || ''), 'default TTL is 7 days and URL is signed', signed);
    const short = new URL((await r2Storage.getShareableUrl('r2private://k.jpg', 300))!);
    expect(short.searchParams.get('X-Amz-Expires') === '300', 'explicit TTL honoured');
    const capped = new URL((await r2Storage.getShareableUrl('r2private://k.jpg', 30 * 86400))!);
    expect(capped.searchParams.get('X-Amz-Expires') === '604800', 'TTL capped at the SigV4 maximum');
    process.env.R2_PRIVATE_SHARE_TTL_SECONDS = '3600';
    const envTtl = new URL((await r2Storage.getShareableUrl('r2private://k.jpg'))!);
    expect(envTtl.searchParams.get('X-Amz-Expires') === '3600', 'R2_PRIVATE_SHARE_TTL_SECONDS sets the default TTL');
    delete process.env.R2_PRIVATE_SHARE_TTL_SECONDS;

    // Cross-check our SigV4 against the AWS SDK's own signer.
    const { SignatureV4 } = await import("@smithy/signature-v4");
    class Sha256 {
      private h: any; private secret?: any;
      constructor(secret?: any) { this.secret = secret; this.h = secret ? createHmac('sha256', Buffer.from(secret)) : createHash('sha256'); }
      update(d: any) { this.h.update(typeof d === 'string' ? d : Buffer.from(d)); }
      async digest() { return new Uint8Array(this.h.digest()); }
      reset() { this.h = this.secret ? createHmac('sha256', Buffer.from(this.secret)) : createHash('sha256'); }
    }
    const signer = new SignatureV4({ credentials: { accessKeyId: CFG.accessKeyId, secretAccessKey: CFG.secretAccessKey }, region: 'auto', service: 's3', sha256: Sha256 as any, uriEscapePath: false, applyChecksum: false });
    const now = new Date('2026-09-29T10:00:00Z');
    const key = 'whatsapp/l/biz/1-a b(1).jpg';
    const ours = new URL(r2Storage.presignGetUrl(PRIV, key, 300, { now }));
    const theirs: any = await signer.presign({
      method: 'GET', protocol: 'https:', hostname: 'acct123.r2.cloudflarestorage.com',
      path: ours.pathname, query: { 'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD' },
      headers: { host: 'acct123.r2.cloudflarestorage.com', 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
    } as any, {
      // Same options @aws-sdk/s3-request-presigner uses: unsigned payload, header not signed/hoisted.
      expiresIn: 300, signingDate: now,
      unsignableHeaders: new Set(['x-amz-content-sha256']), unhoistableHeaders: new Set(['x-amz-content-sha256']),
    });
    expect(theirs.query['X-Amz-Signature'] === ours.searchParams.get('X-Amz-Signature'), 'SigV4 signature matches @smithy/signature-v4', { ours: ours.searchParams.get('X-Amz-Signature'), theirs: theirs.query['X-Amz-Signature'] });
  }

  // ── Fixtures ───────────────────────────────────────────────────────────────
  const stamp = Date.now();
  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Docs Co', website: 'https://example.com', whatsappEnabled: 'true' } as any).returning();
  const [other] = await db.insert(schema.businessAccounts).values({ name: 'Other Co', website: 'https://other.example', whatsappEnabled: 'true' } as any).returning();
  const phone = `91999${String(stamp).slice(-7)}`;
  const [lead] = await db.insert(schema.whatsappLeads).values({ businessAccountId: acct.id, senderPhone: phone, status: 'new' } as any).returning();

  // ── 4. WhatsApp media download stores the private ref ──────────────────────
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(Buffer.from('JPEGDATA'), { status: 200, headers: { 'content-type': 'image/jpeg' } })) as any;
  const returned = await whatsappService.downloadAndSaveMediaFromUrl(lead.id, acct.id, 'https://msg91.example/media/aadhaar.jpg', 'image', 'aadhaar.jpg');
  globalThis.fetch = origFetch;
  const [att] = await db.select().from(schema.whatsappLeadAttachments).where(eq(schema.whatsappLeadAttachments.leadId, lead.id));
  const attKey = att?.filePath?.replace('r2private://', '') || '';
  expect(returned?.startsWith('r2private://whatsapp/') && att?.filePath === returned, 'downloadAndSaveMediaFromUrl stores and returns r2private ref', { returned, filePath: att?.filePath });
  expect(s3.has(PRIV, attKey) && !s3.has('pub', attKey), 'WhatsApp media is uploaded to the private bucket');
  await db.update(schema.whatsappLeadAttachments).set({ documentCategory: 'aadhaar_card' }).where(eq(schema.whatsappLeadAttachments.id, att.id));

  // ── 5. Dashboard never sees the storage reference ──────────────────────────
  {
    const atts = await whatsappService.getLeadAttachments(lead.id);
    expect(atts[0]?.filePath === `/api/whatsapp/documents/${att.id}` && atts[0]?.mediaUrl === null, 'getLeadAttachments exposes only the authenticated route', atts[0]);
    const conv = await whatsappService.getConversationMessages(acct.id, phone);
    const convAtt = conv.messages.flatMap((m: any) => m.attachments || [])[0];
    expect(convAtt?.filePath === `/api/whatsapp/documents/${att.id}`, 'conversation messages expose only the authenticated route', convAtt);
  }

  // ── 6. Ownership check on the document route ───────────────────────────────
  {
    expect(await whatsappService.getAttachmentForAccount(att.id, other.id) === null, 'getAttachmentForAccount denies another account');
    expect((await whatsappService.getAttachmentForAccount(att.id, acct.id))?.id === att.id, 'getAttachmentForAccount allows the owning account');

    const denied = fakeRes();
    await serveWhatsappDocument({ params: { attachmentId: att.id }, query: {}, user: { businessAccountId: other.id, activeBusinessAccountId: other.id } } as any, denied);
    expect(denied.statusCode === 404 && denied.bytes().length === 0, 'route returns 404 to another account (no bytes)', denied.statusCode);

    const switched = fakeRes();
    // Group/super admins reach a client's leads by switching their active account.
    const p = switched.done;
    await serveWhatsappDocument({ params: { attachmentId: att.id }, query: {}, user: { businessAccountId: acct.id, activeBusinessAccountId: acct.id, role: 'account_group_admin' } } as any, switched);
    await p;
    expect(switched.statusCode === 200 && switched.bytes().toString() === 'JPEGDATA', 'route streams the file to the owning (active) account', switched.statusCode);
    expect(switched.headers['content-type'] === 'image/jpeg' && switched.headers['content-disposition']?.startsWith('inline') && switched.headers['cache-control'] === 'private, no-store', 'image served inline, not cached', switched.headers);

    const [htmlAtt] = await db.insert(schema.whatsappLeadAttachments).values({ leadId: lead.id, businessAccountId: acct.id, fileName: 'x.html', fileType: 'document', mimeType: 'text/html', filePath: att.filePath }).returning();
    const html = fakeRes();
    const ph = html.done;
    await serveWhatsappDocument({ params: { attachmentId: htmlAtt.id }, query: {}, user: { businessAccountId: acct.id } } as any, html);
    await ph;
    expect(html.headers['content-type'] === 'application/octet-stream' && html.headers['content-disposition']?.startsWith('attachment'), 'unsafe types are forced to download', html.headers);
    await db.delete(schema.whatsappLeadAttachments).where(eq(schema.whatsappLeadAttachments.id, htmlAtt.id));
  }

  // ── 7. CRM document context gets presigned URLs ─────────────────────────────
  {
    const ctx = await whatsappService.buildLeadDocumentContext(lead.id);
    const u = ctx.aadhaar_card?.[0]?.url || '';
    expect(u.startsWith(`https://acct123.r2.cloudflarestorage.com/${PRIV}/whatsapp/`) && u.includes('X-Amz-Signature='), 'buildLeadDocumentContext returns presigned URLs', ctx);
  }

  // ── 8. Deleting a lead removes its files (unless still referenced) ─────────
  {
    // A second attachment row (conversation message) sharing the same file keeps it alive.
    const msg = await whatsappService.createMinimalLead(acct.id, phone, 'upload', undefined, 'incoming');
    await db.insert(schema.whatsappLeadAttachments).values({ leadId: msg.id, businessAccountId: acct.id, fileName: 'aadhaar.jpg', fileType: 'image', mimeType: 'image/jpeg', filePath: att.filePath });
    // A file only this lead references (via extractedData) — must be deleted.
    const solo = await r2Storage.uploadSensitiveFile(Buffer.from('pan'), 'pan.jpg', `whatsapp/${lead.id}`, 'image/jpeg', acct.id);
    await db.update(schema.whatsappLeads).set({ extractedData: { _documents: { pan_card: { fileUrl: solo.ref } } } }).where(eq(schema.whatsappLeads.id, lead.id));

    await whatsappService.deleteLead(lead.id);
    const [gone] = await db.select().from(schema.whatsappLeads).where(eq(schema.whatsappLeads.id, lead.id));
    expect(!gone, 'lead row deleted');
    expect(!s3.has(PRIV, solo.key!), 'deleteLead removes the lead-only file from R2');
    expect(s3.has(PRIV, attKey), 'deleteLead keeps a file still referenced by the conversation message');

    // ── 9. Deleting the conversation removes the rest (private + legacy public) ──
    const legacyKey = `whatsapp/${msg.id}/${acct.id}/legacy.jpg`;
    s3.objects.set(`pub/${legacyKey}`, { body: Buffer.from('old') });
    const failKey = `whatsapp/${msg.id}/${acct.id}/fails.jpg`;
    s3.objects.set(`${PRIV}/${failKey}`, { body: Buffer.from('f') });
    s3.failDeleteKeys.add(failKey);
    await db.insert(schema.whatsappLeadAttachments).values([
      { leadId: msg.id, businessAccountId: acct.id, fileName: 'legacy.jpg', fileType: 'image', filePath: `https://files.example.com/${legacyKey}` },
      { leadId: msg.id, businessAccountId: acct.id, fileName: 'fails.jpg', fileType: 'image', filePath: `r2private://${failKey}` },
      { leadId: msg.id, businessAccountId: acct.id, fileName: 'foreign.jpg', fileType: 'image', filePath: 'https://third-party.example/whatsapp/foreign.jpg' },
    ]);
    const deleted = await whatsappService.deleteConversation(acct.id, phone);
    const remaining = await db.select().from(schema.whatsappLeadAttachments).where(eq(schema.whatsappLeadAttachments.leadId, msg.id));
    expect(deleted >= 1 && remaining.length === 0, 'conversation rows deleted even though one file delete failed', { deleted, remaining: remaining.length });
    expect(!s3.has(PRIV, attKey), 'deleteConversation removes the private file');
    expect(!s3.has('pub', legacyKey), 'deleteConversation removes the legacy public file');
    expect(!s3.calls.some(c => c.includes('third-party.example') || c.includes('foreign.jpg')), 'foreign URLs are never deleted');
  }

  // ── 10. Data retention helper understands private refs ─────────────────────
  {
    s3.objects.set(`${PRIV}/whatsapp/r/k.jpg`, { body: Buffer.from('x') });
    await deleteStoredFile('r2private://whatsapp/r/k.jpg');
    expect(!s3.has(PRIV, 'whatsapp/r/k.jpg'), 'deleteStoredFile deletes r2private refs');
  }

  // ── 11. Migration script (dry run, then apply) ─────────────────────────────
  {
    const [mLead] = await db.insert(schema.whatsappLeads).values({ businessAccountId: acct.id, senderPhone: phone, status: 'new' } as any).returning();
    const mKey = `whatsapp/${mLead.id}/${acct.id}/mig.jpg`;
    const mUrl = `https://files.example.com/${mKey}`;
    s3.objects.set(`pub/${mKey}`, { body: Buffer.from('MIG'), contentType: 'image/jpeg' });
    await db.insert(schema.whatsappLeadAttachments).values({ leadId: mLead.id, businessAccountId: acct.id, fileName: 'mig.jpg', fileType: 'image', filePath: mUrl });
    await db.update(schema.whatsappLeads).set({ extractedData: { _documents: { pan_card: { fileUrl: mUrl } } } }).where(eq(schema.whatsappLeads.id, mLead.id));
    const stateFile = path.join(os.tmpdir(), `wa-docs-mig-${stamp}.json`);
    const base = { batchSize: 1, limit: Number.MAX_SAFE_INTEGER, businessAccountId: acct.id, keepPublic: false, stateFile };

    const dry = await runMigration({ ...base, apply: false });
    const [afterDry] = await db.select().from(schema.whatsappLeadAttachments).where(eq(schema.whatsappLeadAttachments.leadId, mLead.id));
    expect(dry.filesEligible === 1 && afterDry.filePath === mUrl && !s3.has(PRIV, mKey), 'dry run changes nothing', dry);

    const run = await runMigration({ ...base, apply: true });
    const [afterAtt] = await db.select().from(schema.whatsappLeadAttachments).where(eq(schema.whatsappLeadAttachments.leadId, mLead.id));
    const [afterLead] = await db.select().from(schema.whatsappLeads).where(eq(schema.whatsappLeads.id, mLead.id));
    expect(run.migrated === 1 && afterAtt.filePath === `r2private://${mKey}`, 'migration rewrites attachment file_path', run);
    expect((afterLead.extractedData as any)?._documents?.pan_card?.fileUrl === `r2private://${mKey}`, 'migration rewrites extracted_data fileUrl', afterLead.extractedData);
    expect(s3.has(PRIV, mKey) && !s3.has('pub', mKey), 'migration copies to private and deletes the public copy');
    const again = await runMigration({ ...base, apply: true });
    expect(again.filesScanned === 0, 'second run finds nothing left to migrate (resumable/idempotent)', again);
    await db.delete(schema.whatsappLeads).where(eq(schema.whatsappLeads.id, mLead.id));
  }

  await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, acct.id));
  await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, other.id));

  if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll checks passed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
