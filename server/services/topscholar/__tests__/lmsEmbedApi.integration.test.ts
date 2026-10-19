/**
 * Integration test for the LMS embedding API and the swap-in resync (real SQL, real
 * worker, fixture CMS, fake embeddings). The local pgvector database doubles as the
 * "client" content store.
 *
 * DESTRUCTIVE: creates and changes rows. It refuses to run unless DATABASE_URL points
 * at localhost AND TOPSCHOLAR_EMBED_TEST_DB=1 is set. Run against a throwaway Postgres
 * (with pgvector) that has the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55497/postgres?sslmode=disable \
 *   TOPSCHOLAR_EMBED_TEST_DB=1 npx tsx server/services/topscholar/__tests__/lmsEmbedApi.integration.test.ts
 */
import crypto from 'crypto';
import type { AddressInfo } from 'net';

const url = process.env.DATABASE_URL || '';
if (process.env.TOPSCHOLAR_EMBED_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set TOPSCHOLAR_EMBED_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}

// The feature is hard-gated to one account id; point the gate at this test's account
// before any TopScholar module is loaded.
const ACCOUNT_ID = crypto.randomUUID();
process.env.TOPSCHOLAR_ACCOUNT_ID = ACCOUNT_ID;

let failed = 0;
function expect(cond: unknown, label: string) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

async function main() {
  const express = (await import('express')).default;
  const { db, pool } = await import('../../../db');
  const schema = await import('@shared/schema');
  const { and, eq } = await import('drizzle-orm');
  const { embeddingService } = await import('../../embeddingService');
  const { generateEmbedApiKey } = await import('../embedApiKey');
  const { encrypt } = await import('../../encryptionService');
  const { ingestSingleCp } = await import('../ingestionService');
  const { getTopscholarConfig } = await import('../config');
  const { processPendingPlanRuns } = await import('../planSyncWorker');
  const { RagK12ContentResolver } = await import('../ragResolver');
  const { DEMO_TOPSCHOLAR_CP_ID: CP, DEMO_TOPSCHOLAR_PLAN_ID: PLAN } = await import('../fixtures');
  const lmsRouter = (await import('../../../routes/topscholarLmsApi')).default;

  // ── Fake embeddings: deterministic, controllable per scenario ──────────────
  const vector = () => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
  let embedHook: ((texts: string[]) => Promise<number[][]>) | null = null;
  (embeddingService as any).generateBatchEmbeddings = async (texts: string[]) =>
    embedHook ? embedHook(texts) : texts.map(() => vector());

  // ── Fixtures ────────────────────────────────────────────────────────────────
  const { key, hash, last4 } = generateEmbedApiKey();
  await db.insert(schema.businessAccounts).values({
    id: ACCOUNT_ID,
    name: 'TopScholar Test',
    website: 'https://example.com',
    openaiApiKey: 'sk-test',
    topscholarContentDbUrl: encrypt(url), // local pgvector stands in for the client store
    topscholarEmbedApiKeyHash: hash,
    topscholarEmbedApiKeyLast4: last4,
    topscholarEmbedApiKeyCreatedAt: new Date(),
  } as any);
  await db.insert(schema.topscholarPlanIds).values({ businessAccountId: ACCOUNT_ID, planId: PLAN });

  const app = express();
  app.use(express.json());
  app.use(lmsRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = (path: string, init: RequestInit = {}, auth: string | null = key) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    });

  const account = async () => (await db.select().from(schema.businessAccounts).where(eq(schema.businessAccounts.id, ACCOUNT_ID)))[0];
  const syncRow = async () => (await db.select().from(schema.topscholarContentSync)
    .where(and(eq(schema.topscholarContentSync.businessAccountId, ACCOUNT_ID), eq(schema.topscholarContentSync.cpId, CP))))[0];
  const chunkVersions = async () => (await pool.query(
    'SELECT sync_version, count(*)::int AS n FROM topscholar_content_chunks WHERE business_account_id = $1 AND cp_id = $2 GROUP BY sync_version',
    [ACCOUNT_ID, CP],
  )).rows as Array<{ sync_version: string | null; n: number }>;
  // Queueing kicks the in-process worker; keep ticking it until the job settles.
  const waitForJob = async (jobId: string) => {
    for (let i = 0; i < 100; i++) {
      await processPendingPlanRuns();
      const [run] = await db.select().from(schema.topscholarPlanRuns).where(eq(schema.topscholarPlanRuns.id, jobId));
      if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run.status;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return 'timeout';
  };

  try {
    // ── Auth and validation ───────────────────────────────────────────────────
    expect((await api('/api/topscholar/v1/embed', { method: 'POST', body: '{}' }, null)).status === 401, 'no key -> 401');
    expect((await api('/api/topscholar/v1/embed', { method: 'POST', body: '{}' }, 'tsk_wrong')).status === 401, 'wrong key -> 401');
    const badBody = await api('/api/topscholar/v1/embed', { method: 'POST', body: JSON.stringify({ cpIds: 'x' }) });
    expect(badBody.status === 400 && (await badBody.json()).error?.code === 'invalid_request', 'malformed body -> 400 invalid_request');
    const tooMany = await api('/api/topscholar/v1/embed', {
      method: 'POST',
      body: JSON.stringify({ cpIds: Array.from({ length: 51 }, (_, i) => `cp${i}`) }),
    });
    expect(tooMany.status === 400 && (await tooMany.json()).error?.code === 'too_many_cp_ids', 'more than 50 CP IDs -> 400');

    // ── Embed by CP ID only: the plan is discovered, unknown/invalid ids rejected ─
    const embed = await api('/api/topscholar/v1/embed', {
      method: 'POST',
      body: JSON.stringify({ cpIds: [CP, 'bad id!', 'unknowncp123'] }),
    });
    const embedBody = await embed.json();
    expect(embed.status === 202, 'mixed request -> 202');
    expect(embedBody.accepted?.length === 1 && embedBody.accepted[0].cpId === CP && embedBody.accepted[0].status === 'queued',
      'a CP ID we had never seen is discovered through its saved Plan and queued');
    const jobId = embedBody.accepted?.[0]?.jobId;
    const codeOf = (cpId: string) => embedBody.rejected?.find((r: any) => r.cpId === cpId)?.code;
    expect(codeOf('bad id!') === 'invalid_cp_id', 'invalid characters -> invalid_cp_id');
    expect(codeOf('unknowncp123') === 'unknown_cp_id', 'a CP ID under no saved Plan -> unknown_cp_id');
    const [resolution] = await db.select().from(schema.topscholarPlanCpResolutions)
      .where(and(eq(schema.topscholarPlanCpResolutions.businessAccountId, ACCOUNT_ID), eq(schema.topscholarPlanCpResolutions.cpId, CP)));
    expect(resolution?.planId === PLAN, 'discovery stored the CP -> Plan link');

    const again = await (await api('/api/topscholar/v1/embed', { method: 'POST', body: JSON.stringify({ cpId: CP }) })).json();
    expect(again.accepted?.[0]?.status === 'already_queued' && again.accepted[0].jobId === jobId, 'a repeat request reuses the queued job');

    const unknownAgain = await api('/api/topscholar/v1/embed', { method: 'POST', body: JSON.stringify({ cpIds: ['unknowncp123'] }) });
    expect(unknownAgain.status === 422 && (await unknownAgain.json()).rejected?.[0]?.code === 'unknown_cp_id',
      'nothing accepted -> 422 (and a recent full scan answers at once)');

    let status = await (await api(`/api/topscholar/v1/embed/status?cpIds=${CP},nothere`)).json();
    // Queueing kicks the in-process worker at once, so the job may already be moving.
    expect(['queued', 'running', 'completed'].includes(status.results?.[0]?.state), `status: job is live (${status.results?.[0]?.state})`);
    expect(status.results?.[1]?.state === 'not_found', 'status: not_found for a CP ID never requested');

    // ── Worker runs the job: first versioned write goes live ──────────────────
    expect((await waitForJob(jobId)) === 'completed', 'the worker finishes the job');
    status = await (await api(`/api/topscholar/v1/embed/status?cpIds=${CP}`)).json();
    const r1 = status.results?.[0];
    let sync = await syncRow();
    let versions = await chunkVersions();
    expect(r1?.state === 'completed' && r1.live.passages > 0 && r1.live.lastCompletedAt, `status: completed with live passages ${r1?.state === 'completed' ? '' : JSON.stringify({ r1, sync })}`);
    expect(versions.length === 1 && versions[0].sync_version === sync.activeSyncVersion && versions[0].n === r1.live.passages,
      'every stored passage belongs to the active version');
    const v1 = sync.activeSyncVersion!;
    const passages = versions[0].n;
    const job = await (await api(`/api/topscholar/v1/embed/jobs/${jobId}`)).json();
    expect(job.state === 'completed' && job.cps?.[0]?.cpId === CP && job.cps[0].state === 'completed', 'jobs endpoint: completed');
    expect((await api('/api/topscholar/v1/embed/jobs/00000000-0000-0000-0000-000000000000')).status === 404, 'unknown job -> 404');

    const cfg = () => account().then((a) => getTopscholarConfig(a));
    const refresh = (planId = PLAN) => cfg().then((c) => ingestSingleCp({
      businessAccountId: ACCOUNT_ID, cpId: CP, planId, cfg: c, mode: 'full', awaitDirect: true,
    }));

    // ── Failed refresh keeps the previous content live ───────────────────────
    embedHook = async () => { throw new Error('OpenAI is down'); };
    let threw = false;
    try { await refresh(); } catch { threw = true; }
    sync = await syncRow();
    versions = await chunkVersions();
    expect(threw && sync.status === 'failed' && /previous content/i.test(sync.lastError || ''), 'embedding failure -> failed, says old content is live');
    expect(versions.length === 1 && versions[0].sync_version === v1 && versions[0].n === passages && sync.activeSyncVersion === v1,
      'after a failure the previous version is untouched');

    // ── Short refresh (some passages not embedded) is not switched in ─────────
    embedHook = async (texts) => texts.map((_, i) => (i === texts.length - 1 ? [] : vector()));
    threw = false;
    try { await refresh(); } catch { threw = true; }
    sync = await syncRow();
    versions = await chunkVersions();
    expect(threw && /Only \d+ of \d+ passages/.test(sync.lastError || ''), 'missing embeddings -> failed with the count');
    expect(versions.length === 1 && versions[0].sync_version === v1 && sync.chunkCount === passages,
      'a short run is rolled back and the live count is unchanged');

    // ── Cancel during a refresh keeps the previous content ────────────────────
    embedHook = async (texts) => {
      await db.update(schema.topscholarContentSync).set({ status: 'cancelled' })
        .where(and(eq(schema.topscholarContentSync.businessAccountId, ACCOUNT_ID), eq(schema.topscholarContentSync.cpId, CP)));
      return texts.map(() => vector());
    };
    const cancelled = await refresh();
    sync = await syncRow();
    versions = await chunkVersions();
    expect(cancelled.cancelled === true && sync.status === 'cancelled', 'cancel -> cancelled');
    expect(versions.length === 1 && versions[0].sync_version === v1, 'after a cancel only the previous version remains');

    // ── Students only see the active version while another is being written ───
    embedHook = null;
    await pool.query(
      `INSERT INTO topscholar_content_chunks (business_account_id, cp_id, content_type, content_text, embedding, sync_version, chapter, title)
       VALUES ($1, $2, 'note', 'UNFINISHED NEW VERSION TEXT', $3::vector, 'in-progress-version', 'X', 'X')`,
      [ACCOUNT_ID, CP, `[${vector().join(',')}]`],
    );
    const resolver = new RagK12ContentResolver({ contentDbUrl: url, contentDbName: null, contentDbIndex: null, contentDbCollection: null });
    const topics = await resolver.searchTopics('photosynthesis', ACCOUNT_ID, { cpIds: [CP] } as any);
    expect(topics.results.length > 0, 'retrieval still returns the live content');
    expect(!topics.results.some((t: any) => String(t.revisionNotes).includes('UNFINISHED NEW VERSION TEXT')),
      'retrieval hides rows of a version that is not live yet');

    // ── A later successful refresh swaps in and clears everything older ───────
    await refresh();
    sync = await syncRow();
    versions = await chunkVersions();
    expect(sync.status === 'completed' && sync.activeSyncVersion && sync.activeSyncVersion !== v1, 'success -> new active version');
    expect(versions.length === 1 && versions[0].sync_version === sync.activeSyncVersion && versions[0].n === passages,
      'old version and leftovers are deleted after the switch');

    // ── Package moved: the remembered plan no longer has it, another known plan does ─
    await db.insert(schema.topscholarPlanCpResolutions).values({
      businessAccountId: ACCOUNT_ID, planId: 'old-plan-without-cp', cpId: CP, lastResolvedAt: new Date(Date.now() - 86_400_000),
    } as any);
    const moved = await refresh('old-plan-without-cp');
    expect(!moved.cancelled && (await syncRow()).status === 'completed', 'falls back to another plan that holds the CP ID');

    // ── CP ID sent with its Plan ID: the pairing is checked, the Plan remembered ─
    const wrongPair = await api('/api/topscholar/v1/embed', {
      method: 'POST',
      body: JSON.stringify({ items: [{ cpId: CP, planId: 'some-other-plan' }] }),
    });
    const wrongBody = await wrongPair.json();
    expect(wrongPair.status === 422 && wrongBody.rejected?.[0]?.code === 'cp_not_in_plan', 'a CP ID paired with a Plan that lacks it -> cp_not_in_plan');

    const badPlan = await (await api('/api/topscholar/v1/embed', {
      method: 'POST',
      body: JSON.stringify({ cpId: CP, planId: 'bad plan!' }),
    })).json();
    expect(badPlan.rejected?.[0]?.code === 'invalid_plan_id', 'invalid characters in planId -> invalid_plan_id');

    // Forget everything about the Plan, so only the supplied pairing can link them.
    await db.delete(schema.topscholarPlanIds).where(eq(schema.topscholarPlanIds.businessAccountId, ACCOUNT_ID));
    await db.delete(schema.topscholarPlanCpResolutions).where(eq(schema.topscholarPlanCpResolutions.businessAccountId, ACCOUNT_ID));
    await db.delete(schema.topscholarCpMappings).where(eq(schema.topscholarCpMappings.businessAccountId, ACCOUNT_ID));
    const paired = await api('/api/topscholar/v1/embed', {
      method: 'POST',
      body: JSON.stringify({ cpIds: [CP], planId: PLAN }),
    });
    const pairedBody = await paired.json();
    expect(paired.status === 202 && pairedBody.accepted?.[0]?.status === 'queued', 'CP ID + Plan ID -> queued without any prior link');
    const savedPlans = await db.select().from(schema.topscholarPlanIds).where(eq(schema.topscholarPlanIds.businessAccountId, ACCOUNT_ID));
    expect(savedPlans.some((plan) => plan.planId === PLAN), 'the supplied Plan is added to the saved Plan ID list');
    const wrongPlanSaved = (await db.select().from(schema.topscholarPlanIds)
      .where(and(eq(schema.topscholarPlanIds.businessAccountId, ACCOUNT_ID), eq(schema.topscholarPlanIds.planId, 'some-other-plan')))).length > 0;
    expect(!wrongPlanSaved, 'a Plan ID with no content is never saved');
    expect((await waitForJob(pairedBody.accepted?.[0]?.jobId)) === 'completed', 'the paired job completes');

    const mixed = await (await api('/api/topscholar/v1/embed', {
      method: 'POST',
      body: JSON.stringify({ items: [{ cpId: CP, planId: PLAN }, { cpId: 'unknowncp123' }] }),
    })).json();
    expect(mixed.accepted?.[0]?.cpId === CP && mixed.rejected?.[0]?.cpId === 'unknowncp123',
      'one request can mix paired and CP-ID-only packages');
    await waitForJob(mixed.accepted?.[0]?.jobId);

    // ── Content store switched off -> 503 ─────────────────────────────────────
    await db.update(schema.businessAccounts).set({ topscholarContentDbDisabled: 'true' }).where(eq(schema.businessAccounts.id, ACCOUNT_ID));
    const off = await api('/api/topscholar/v1/embed', { method: 'POST', body: JSON.stringify({ cpIds: [CP] }) });
    expect(off.status === 503 && (await off.json()).error?.code === 'content_store_unavailable', 'no client store -> 503');
    await db.update(schema.businessAccounts).set({ topscholarContentDbDisabled: 'false' }).where(eq(schema.businessAccounts.id, ACCOUNT_ID));

    // ── Last-used is recorded; rate limit kicks in ────────────────────────────
    expect(!!(await account()).topscholarEmbedApiKeyLastUsedAt, 'records when the key was last used');
    let limited = false;
    for (let i = 0; i < 70 && !limited; i++) {
      const res = await api(`/api/topscholar/v1/embed/status?cpIds=${CP}`);
      if (res.status === 429) limited = !!res.headers.get('retry-after');
    }
    expect(limited, 'more than 60 requests a minute -> 429 with Retry-After');
  } finally {
    server.close();
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, ACCOUNT_ID)).catch(() => {});
    await pool.query('DELETE FROM topscholar_content_chunks WHERE business_account_id = $1', [ACCOUNT_ID]).catch(() => {});
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll LMS embedding API checks passed');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
