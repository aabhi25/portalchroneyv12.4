/**
 * Integration tests for mass-assignment / cross-tenant write protection.
 *
 * Update endpoints hand the request body to storage/service update functions.
 * The WHERE clause checks ownership, but the SET clause used to accept
 * anything — so a caller could move a record into another business account,
 * or re-parent a step into another tenant's journey / flow. These tests call
 * the storage/service functions exactly as the routes do (with a hostile body)
 * and assert the record stays put while legitimate edits still persist.
 *
 * DESTRUCTIVE: creates rows. Refuses to run unless DATABASE_URL points at
 * localhost AND MASS_ASSIGNMENT_TEST_DB=1 is set.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55452/postgres?sslmode=disable \
 *   MASS_ASSIGNMENT_TEST_DB=1 npx tsx server/services/__tests__/massAssignment.integration.test.ts
 */
const url = process.env.DATABASE_URL || '';
if (process.env.MASS_ASSIGNMENT_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set MASS_ASSIGNMENT_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}

// No network: embedding regeneration etc. is fire-and-forget; make any
// outbound call fail fast instead of reaching a real provider.
globalThis.fetch = (async () => { throw new Error('network disabled in test'); }) as typeof fetch;
process.env.OPENAI_API_KEY = '';

async function main() {
  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq } = await import('drizzle-orm');
  const { storage } = await import('../../storage');
  const { whatsappFlowService } = await import('../whatsappFlowService');
  const { instagramFlowService } = await import('../instagramFlowService');
  const { whatsappTemplateService } = await import('../whatsappTemplateService');
  const urgency = await import('../urgencyOfferService');
  const { stripProtectedFields, pickAllowedFields } = await import('../../lib/safeUpdate');
  const { requireOwnedSocialFlow } = await import('../../lib/socialFlowOwnership');

  // ── helper unit checks ─────────────────────────────────────────────────────
  {
    const out = stripProtectedFields({ id: 'x', businessAccountId: 'b', business_account_id: 'b', createdAt: 1, updatedAt: 2, journeyId: 'j', name: 'n' } as any, ['journeyId']);
    expect(JSON.stringify(out) === JSON.stringify({ name: 'n' }), 'stripProtectedFields removes id/tenant/timestamps + extra keys', out);
    const proto = stripProtectedFields(JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}'));
    expect((proto as any).ok === 1 && ({} as any).polluted === undefined, 'stripProtectedFields ignores __proto__');
    expect(JSON.stringify(stripProtectedFields(null as any)) === '{}', 'stripProtectedFields(null) → {}');
    const picked = pickAllowedFields({ a: 1, b: 2, c: undefined, businessAccountId: 'x' }, ['a', 'c', 'businessAccountId'] as const);
    expect(JSON.stringify(picked) === JSON.stringify({ a: 1, businessAccountId: 'x' }), 'pickAllowedFields keeps only listed defined keys', picked);
  }

  const stamp = Date.now();
  const [acctA] = await db.insert(schema.businessAccounts).values({ name: `Tenant A ${stamp}`, website: 'https://a.example.com' } as any).returning();
  const [acctB] = await db.insert(schema.businessAccounts).values({ name: `Tenant B ${stamp}`, website: 'https://b.example.com' } as any).returning();
  const A = acctA.id, B = acctB.id;
  const [userA] = await db.insert(schema.users).values({ username: `ua-${stamp}`, passwordHash: 'x', role: 'business_user', businessAccountId: A } as any).returning();

  // ── Products: PATCH /api/products/:id → storage.updateProduct(id, A, req.body)
  {
    const [p] = await db.insert(schema.products).values({ businessAccountId: A, name: 'Chair', description: 'Wood' } as any).returning();
    const hostile = { name: 'Chair v2', description: 'Oak', businessAccountId: B, id: 'hijacked-id', createdAt: '2000-01-01' };
    const updated = await storage.updateProduct(p.id, A, hostile as any);
    const [row] = await db.select().from(schema.products).where(eq(schema.products.id, p.id));
    expect(!!row && row.businessAccountId === A, 'product: body businessAccountId cannot move product to tenant B', row?.businessAccountId);
    expect(row?.name === 'Chair v2' && row?.description === 'Oak', 'product: name/description edits persist', { name: row?.name, description: row?.description });
    expect(updated?.id === p.id, 'product: id cannot be rewritten', updated?.id);
    const other = await storage.updateProduct(p.id, B, { name: 'B was here' } as any);
    expect(other === undefined, 'product: tenant B cannot update tenant A product', other);
  }

  // ── FAQs: PATCH /api/faqs/:id → storage.updateFaq(id, A, req.body)
  {
    const [f] = await db.insert(schema.faqs).values({ businessAccountId: A, question: 'Q?', answer: 'A.' } as any).returning();
    await storage.updateFaq(f.id, A, { question: 'Q2?', businessAccountId: B } as any);
    const [row] = await db.select().from(schema.faqs).where(eq(schema.faqs.id, f.id));
    expect(row?.businessAccountId === A, 'faq: cannot be moved to tenant B', row?.businessAccountId);
    expect(row?.question === 'Q2?', 'faq: question edit persists', row?.question);
  }

  // ── Journeys + steps: PUT /api/journeys/:id, PUT /api/journeys/:journeyId/steps/:stepId
  {
    const jA = await storage.createJourney({ businessAccountId: A, name: 'Journey A' } as any);
    const jB = await storage.createJourney({ businessAccountId: B, name: 'Journey B' } as any);
    await storage.updateJourney(jA.id, A, { name: 'Journey A2', description: 'desc', businessAccountId: B } as any);
    const [jRow] = await db.select().from(schema.conversationJourneys).where(eq(schema.conversationJourneys.id, jA.id));
    expect(jRow?.businessAccountId === A, 'journey: cannot be moved to tenant B', jRow?.businessAccountId);
    expect(jRow?.name === 'Journey A2' && jRow?.description === 'desc', 'journey: name/description edits persist', jRow);

    const step = await storage.createJourneyStep({ journeyId: jA.id, stepOrder: '0', questionText: 'Name?' } as any);
    await storage.updateJourneyStep(step.id, jA.id, { questionText: 'Full name?', stepOrder: '3', journeyId: jB.id, id: 'x' } as any);
    const [sRow] = await db.select().from(schema.journeySteps).where(eq(schema.journeySteps.id, step.id));
    expect(sRow?.journeyId === jA.id, "journey step: cannot be re-parented into tenant B's journey", sRow?.journeyId);
    expect(sRow?.questionText === 'Full name?' && String(sRow?.stepOrder) === '3', 'journey step: question/order edits persist', { q: sRow?.questionText, o: sRow?.stepOrder });
    const bSteps = await storage.getJourneySteps(jB.id);
    expect(bSteps.length === 0, "journey step: tenant B's journey has no injected steps", bSteps.length);
  }

  // ── Canned responses: PATCH /api/canned-responses/:id
  {
    const c = await storage.createCannedResponse({ businessAccountId: A, title: 'Hi', content: 'Hello!', createdBy: userA.id } as any);
    await storage.updateCannedResponse(c.id, A, { title: 'Hi there', businessAccountId: B } as any);
    const [row] = await db.select().from(schema.cannedResponses).where(eq(schema.cannedResponses.id, c.id));
    expect(row?.businessAccountId === A, 'canned response: cannot be moved to tenant B', row?.businessAccountId);
    expect(row?.title === 'Hi there', 'canned response: title edit persists', row?.title);
  }

  // ── WhatsApp flows + steps
  {
    const fA = await whatsappFlowService.createFlow(A, 'WA flow A');
    const fB = await whatsappFlowService.createFlow(B, 'WA flow B');
    await whatsappFlowService.updateFlow(fA.id, { name: 'WA flow A2', description: 'd', businessAccountId: B, id: 'x' } as any);
    const [fRow] = await db.select().from(schema.whatsappFlows).where(eq(schema.whatsappFlows.id, fA.id));
    expect(fRow?.businessAccountId === A, 'whatsapp flow: cannot be moved to tenant B', fRow?.businessAccountId);
    expect(fRow?.name === 'WA flow A2' && fRow?.description === 'd', 'whatsapp flow: name/description edits persist', fRow);

    // POST /api/whatsapp/flows/:flowId/steps → createStep(flowId, req.body)
    const s = await whatsappFlowService.createStep(fA.id, { stepKey: 'start', stepOrder: 0, type: 'text', prompt: 'Hi', flowId: fB.id, id: 'forced-id' } as any);
    expect(s.flowId === fA.id, "whatsapp step create: body flowId cannot place the step in tenant B's flow", s.flowId);
    expect(s.id !== 'forced-id', 'whatsapp step create: body id is ignored', s.id);
    // PUT /api/whatsapp/flows/:flowId/steps/:stepId → updateStep(stepId, req.body)
    await whatsappFlowService.updateStep(s.id, { prompt: 'Hello!', stepOrder: 2, flowId: fB.id } as any);
    const [sRow] = await db.select().from(schema.whatsappFlowSteps).where(eq(schema.whatsappFlowSteps.id, s.id));
    expect(sRow?.flowId === fA.id, "whatsapp step update: cannot be re-parented into tenant B's flow", sRow?.flowId);
    expect(sRow?.prompt === 'Hello!' && sRow?.stepOrder === 2, 'whatsapp step update: prompt/order edits persist', { p: sRow?.prompt, o: sRow?.stepOrder });
  }

  // ── Instagram flows + steps (service) and route ownership middleware
  {
    const fA = await instagramFlowService.createFlow(A, 'IG flow A');
    const fB = await instagramFlowService.createFlow(B, 'IG flow B');
    await instagramFlowService.updateFlow(fA.id, { name: 'IG flow A2', businessAccountId: B } as any);
    const [fRow] = await db.select().from(schema.instagramFlows).where(eq(schema.instagramFlows.id, fA.id));
    expect(fRow?.businessAccountId === A && fRow?.name === 'IG flow A2', 'instagram flow: rename persists, tenant unchanged', fRow);
    const s = await instagramFlowService.createStep(fA.id, { stepKey: 'start', stepOrder: 0, type: 'text', prompt: 'Hi', flowId: fB.id } as any);
    expect(s.flowId === fA.id, "instagram step create: body flowId ignored", s.flowId);
    await instagramFlowService.updateStep(s.id, { prompt: 'Yo', flowId: fB.id } as any);
    const [sRow] = await db.select().from(schema.instagramFlowSteps).where(eq(schema.instagramFlowSteps.id, s.id));
    expect(sRow?.flowId === fA.id && sRow?.prompt === 'Yo', 'instagram step update: prompt persists, flow unchanged', sRow);

    const run = async (user: any, params: any) => {
      let status = 200; let nexted = false;
      const res: any = { status(c: number) { status = c; return this; }, json() { return this; } };
      await requireOwnedSocialFlow('instagram')({ user, params } as any, res, () => { nexted = true; });
      return { status, nexted };
    };
    const own = await run({ businessAccountId: A }, { flowId: fA.id, stepId: s.id });
    expect(own.nexted, 'instagram route guard: owner passes', own);
    const cross = await run({ businessAccountId: B }, { flowId: fA.id });
    expect(!cross.nexted && cross.status === 404, "instagram route guard: tenant B cannot reach tenant A's flow", cross);
    const sB = await instagramFlowService.createStep(fB.id, { stepKey: 's', stepOrder: 0, type: 'text', prompt: 'B' } as any);
    const mixed = await run({ businessAccountId: A }, { flowId: fA.id, stepId: sB.id });
    expect(!mixed.nexted && mixed.status === 404, "instagram route guard: step from another flow is rejected", mixed);
  }

  // ── WhatsApp template status is server-controlled
  {
    const tpl = await whatsappTemplateService.create(A, { name: 'promo', bodyText: 'Hi {{1}}' } as any);
    await db.update(schema.whatsappTemplates).set({ status: 'pending' }).where(eq(schema.whatsappTemplates.id, tpl.id));
    await whatsappTemplateService.update(A, tpl.id, { name: 'promo2', status: 'approved', rejectionReason: 'none', businessAccountId: B, sourceType: 'msg91' } as any);
    const [row] = await db.select().from(schema.whatsappTemplates).where(eq(schema.whatsappTemplates.id, tpl.id));
    // Renaming a hand-added template sends it back to 'not_verified'; either way never 'approved'.
    expect(row?.status === 'pending' || row?.status === 'not_verified', 'template: tenant cannot self-approve via PATCH status', row?.status);
    expect(row?.rejectionReason === null, 'template: tenant cannot set rejectionReason', row?.rejectionReason);
    expect(row?.businessAccountId === A && row?.sourceType === 'manual', 'template: tenant/source fields unchanged', { b: row?.businessAccountId, s: row?.sourceType });
    expect(row?.name === 'promo2', 'template: name edit persists', row?.name);
  }

  // ── Urgency offer campaigns: id-only lookups were cross-tenant
  {
    const cA = await urgency.upsertCampaign(A, { name: 'A offer', headline: 'Hurry' } as any);
    expect(cA.businessAccountId === A, 'urgency: create assigns caller tenant');
    const cB = await urgency.upsertCampaign(B, { id: cA.id, name: 'hijack', headline: 'pwned', businessAccountId: A } as any);
    const [aRow] = await db.select().from(schema.urgencyOfferSettings).where(eq(schema.urgencyOfferSettings.id, cA.id));
    expect(aRow?.headline === 'Hurry' && aRow?.businessAccountId === A, "urgency: tenant B cannot update tenant A's campaign by id", aRow);
    expect(cB.id !== cA.id && cB.businessAccountId === B, 'urgency: B gets its own new campaign instead', { id: cB.id, b: cB.businessAccountId });
    expect((await urgency.getCampaignById(cA.id, B)) === undefined, "urgency: tenant B cannot read tenant A's campaign");
    expect((await urgency.deleteCampaign(cA.id, B)) === undefined, "urgency: tenant B cannot delete tenant A's campaign");
    const upd = await urgency.upsertCampaign(A, { id: cA.id, headline: 'Last chance' } as any);
    expect(upd.id === cA.id && upd.headline === 'Last chance', 'urgency: owner edit persists', upd);
  }

  if (failed > 0) { console.error(`\n${failed} mass-assignment test(s) failed.`); process.exit(1); }
  console.log('\nAll mass-assignment tests passed.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
