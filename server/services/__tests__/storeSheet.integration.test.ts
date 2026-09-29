/**
 * Dealers & Stores sheet — real SQL, synthetic data shaped like a live account's journey
 * (two dealers with a store of the same name, a merged EMI list, "Store Dealer" EMI lists,
 * LOS store records under legal dealer names).
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/postgres?sslmode=disable \
 *   STORE_SHEET_TEST_DB=1 npx tsx server/services/__tests__/storeSheet.integration.test.ts
 */
import crypto from 'crypto';
import { parseEmiSchemes, formatEmiSchemes, suggestSheetLevel } from '@shared/storeSheet';

const url = process.env.DATABASE_URL || '';
if (process.env.STORE_SHEET_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set STORE_SHEET_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); } else { console.log(`✓ ${label}`); }
}
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

// ── Pure helpers ─────────────────────────────────────────────────────────────
expect(JSON.stringify(parseEmiSchemes('6/1=32; 12/1=34\n18/1 = 35')) === JSON.stringify([{ label: '6/1', schemeId: '32' }, { label: '12/1', schemeId: '34' }, { label: '18/1', schemeId: '35' }]), 'EMI text parsed');
expect(formatEmiSchemes(parseEmiSchemes('6/1=32;12/1=34')) === '6/1=32; 12/1=34', 'EMI formatted back');
expect(throws(() => parseEmiSchemes('6/1 32')), 'EMI without "=" rejected');
expect(throws(() => parseEmiSchemes('6/1=32; 6/1=33')), 'duplicate EMI label rejected');
expect(suggestSheetLevel('dealer_name') === 'dealer' && suggestSheetLevel('dealer_city') === 'city' && suggestSheetLevel('store_name') === 'store' && suggestSheetLevel('scheme_name') === 'emi', 'levels suggested from save-to fields');

async function main() {
  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { encrypt } = await import('../encryptionService');
  const svc = await import('../storeSheetService');
  const { whatsappFlowService } = await import('../whatsappFlowService');
  for (const ddl of [
    sql`ALTER TABLE crm_store_credentials ADD COLUMN IF NOT EXISTS display_dealer_name TEXT`,
    sql`ALTER TABLE crm_store_credentials ADD COLUMN IF NOT EXISTS display_store_name TEXT`,
    sql`ALTER TABLE crm_store_credentials ADD COLUMN IF NOT EXISTS emi_schemes JSONB NOT NULL DEFAULT '[]'::jsonb`,
    sql`ALTER TABLE crm_store_credentials ADD COLUMN IF NOT EXISTS show_in_journey BOOLEAN NOT NULL DEFAULT true`,
    sql`ALTER TABLE whatsapp_settings ADD COLUMN IF NOT EXISTS store_sheet_enabled TEXT NOT NULL DEFAULT 'false'`,
  ]) await db.execute(ddl);

  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'Sheet Test', website: 'https://example.com' } as any).returning();
  await db.insert(schema.whatsappSettings).values({ businessAccountId: acct.id } as any);
  const [flow] = await db.insert(schema.whatsappFlows).values({ businessAccountId: acct.id, name: 'Lead Capture Flow', isActive: 'true' } as any).returning();
  const item = (v: string, value = v) => ({ id: v.toLowerCase().replace(/\W+/g, '_'), title: v, value });
  const emi = (pairs: [string, string][]) => pairs.map(([t, v]) => ({ id: t, title: t, value: v }));
  const step = async (order: number, saveToField: string, options: any) => (await db.insert(schema.whatsappFlowSteps).values({
    flowId: flow.id, stepKey: String(order), stepOrder: order, type: 'dropdown', prompt: `Pick ${saveToField}`, saveToField, options,
  } as any).returning())[0];
  const dealerStep = await step(1, 'dealer_name', { dropdownItems: [item('Homelane'), item('Design Cafe'), item('PMJ Jewellers')] });
  const cityStep = await step(2, 'dealer_city', { dependsOnFields: ['dealer_name'], conditionalOptions: { Homelane: [item('Bengaluru'), item('Hyderabad')], 'Design Cafe': [item('Bengaluru')], 'PMJ Jewellers': [item('Kokapet')] } });
  const storeStep = await step(3, 'store_name', { dependsOnFields: ['dealer_name', 'dealer_city'], conditionalOptions: {
    'Homelane|Bengaluru': [item('HSR'), item('Whitefield')], 'Design Cafe|Bengaluru': [item('HSR'), item('Whitefield')],
    'Homelane|Hyderabad': [item('Kokapet')], 'PMJ Jewellers|Kokapet': [item('Kokapet')],
  } });
  const emiStep = await step(4, 'scheme_name', { dependsOnFields: ['store_name'], conditionalOptions: {
    HSR: emi([['6/1', '32'], ['12/1', '34']]),                                            // Design Cafe's, shown to both
    Whitefield: emi([['6/1', '5'], ['12/1', '9'], ['6/1', '32'], ['12/1', '34']]),       // two dealers merged
    'Whitefield Design café': emi([['6/1', '32'], ['9/1', '33'], ['12/1', '34']]),       // never matched today
    'Kokapet Homelane': emi([['6/1', '5'], ['12/1', '8']]),
  } });

  // LOS store records: Homelane's are under its legal name, PMJ has a store also called Kokapet.
  const cred = (dealerName: string, storeName: string, city: string | null, storeId: number) =>
    ({ businessAccountId: acct.id, dealerName, storeName, city, storeId, sid: `SID-${storeId}`, secret: encrypt(`secret-${storeId}`), isActive: true });
  await db.insert(schema.crmStoreCredentials).values([
    cred('Homevista Decor And Furnishings Private Limited', 'Homelane-HSR- Bengaluru', null, 101),
    cred('Homevista Decor And Furnishings Private Limited', 'Homelane-Whitefield- Bengaluru', null, 102),
    cred('Homevista Decor And Furnishings Private Limited', 'Homelane-Kokapet - Hyderabad', null, 103),
    cred('Design Cafe', 'HSR-Bengaluru', null, 201),
    cred('Design Cafe', 'Whitefield-Bengaluru', null, 202),
    cred('PMJ Jewellers', 'Kokapet', 'Kokapet', 301),
    cred('Cloudnine', 'Cloudnine-Andheri', 'Mumbai', 401),   // not part of the WhatsApp journey
  ] as any);

  // ── Build the sheet from the journey ───────────────────────────────────────
  const plan = await svc.planSeedFromJourney(acct.id);
  const find = (d: string, c: string, s: string) => plan.rows.find(r => r.dealer === d && r.city === c && r.store === s);
  expect(plan.rows.length === 6, 'seed: one row per journey store', plan.rows.length);
  expect(find('Homelane', 'Hyderabad', 'Kokapet')?.losStoreName === 'Homelane-Kokapet - Hyderabad', "Homelane Kokapet linked to Homelane's LOS store, not PMJ's", find('Homelane', 'Hyderabad', 'Kokapet'));
  expect(find('PMJ Jewellers', 'Kokapet', 'Kokapet')?.losStoreName === 'Kokapet', 'PMJ Kokapet linked to PMJ');
  expect(find('Design Cafe', 'Bengaluru', 'HSR')?.losStoreName === 'HSR-Bengaluru' && find('Homelane', 'Bengaluru', 'HSR')?.losStoreName === 'Homelane-HSR- Bengaluru', 'HSR linked per dealer');
  expect(formatEmiSchemes(find('Homelane', 'Hyderabad', 'Kokapet')!.emiSchemes) === '6/1=5; 12/1=8', 'dealer-specific EMI list ("Kokapet Homelane") used');
  expect(formatEmiSchemes(find('Design Cafe', 'Bengaluru', 'Whitefield')!.emiSchemes) === '6/1=32; 9/1=33; 12/1=34', 'unused "Whitefield Design café" list now used for Design Cafe');
  const hlWhitefield = find('Homelane', 'Bengaluru', 'Whitefield')!;
  expect(hlWhitefield.notes.some(n => /more than one dealer/.test(n)) && hlWhitefield.emiSchemes.length === 2, 'merged EMI list flagged and de-duplicated', hlWhitefield);
  await svc.applySeedFromJourney(acct.id);
  let rows = await svc.listRows(acct.id);
  expect(rows.length === 7 && rows.find(r => r.losStoreName === 'Cloudnine-Andheri')?.inJourney === false, 'seed applied; LOS-only dealer kept but not in journey', rows.length);
  expect((await svc.planSeedFromJourney(acct.id)).rows.length === 0, 'seeding twice adds nothing');

  // ── Link steps and switch on ─────────────────────────────────────────────
  await svc.updateSettings(acct.id, { enabled: true, stepLevels: { [dealerStep.id]: 'dealer', [cityStep.id]: 'city', [storeStep.id]: 'store', [emiStep.id]: 'emi' } });
  const state = await svc.getSheetState(acct.id, false);
  expect(state.enabled && state.linkedSteps.every(s => s.level === s.suggestedLevel), 'steps linked, sheet on');
  expect(!!(await svc.updateSettings(acct.id, { stepLevels: { [dealerStep.id]: 'store' } }).then(() => false, () => true)), 'a level can be linked to one step only');

  const steps = await whatsappFlowService.getFlowSteps(flow.id);
  const optionsAt = (key: string, data: Record<string, string>) =>
    ((whatsappFlowService as any).resolveStepOptions(steps.find(s => s.stepKey === key), data).options.dropdownItems as any[]);
  const titles = (xs: any[]) => xs.map(x => x.title).join(',');
  expect(titles(optionsAt('1', {})) === 'Design Cafe,Homelane,PMJ Jewellers', 'dealer list from the sheet (not the LOS-only dealer)', titles(optionsAt('1', {})));
  expect(titles(optionsAt('2', { dealer_name: 'Homelane' })) === 'Bengaluru,Hyderabad', 'cities by dealer');
  expect(titles(optionsAt('3', { dealer_name: 'Design Cafe', dealer_city: 'Bengaluru' })) === 'HSR,Whitefield', 'stores by dealer + city');
  const hlHsr = optionsAt('4', { dealer_name: 'Homelane', dealer_city: 'Bengaluru', store_name: 'HSR' });
  const dcHsr = optionsAt('4', { dealer_name: 'Design Cafe', dealer_city: 'Bengaluru', store_name: 'HSR' });
  expect(JSON.stringify(dcHsr.map(x => x.value)) === '["32","34"]', "Design Cafe HSR shows Design Cafe's schemes", dcHsr);
  expect(hlHsr.length === 2 && optionsAt('4', { dealer_name: 'Homelane', dealer_city: 'Hyderabad', store_name: 'Kokapet' }).map(x => x.value).join() === '5,8', 'Homelane stores get their own lists — same store name no longer shares one', hlHsr);
  const stored = await whatsappFlowService.getStoredFlowSteps(flow.id);
  expect(Object.keys((stored.find(s => s.stepKey === '4')!.options as any).conditionalOptions).includes('HSR'), 'journey editor still sees its own saved lists');
  const byKey = await whatsappFlowService.getStepByKey(flow.id, '4');
  expect((byKey!.options as any)._fromSheet === true, 'single-step lookup also uses the sheet');

  // ── Edits show up in the dropdowns ───────────────────────────────────────
  const dcHsrRow = rows.find(r => r.dealer === 'Homelane' && r.store === 'HSR')!;
  await svc.updateRow(acct.id, dcHsrRow.id, { emiSchemes: parseEmiSchemes('6/1=5; 9/1=6; 12/1=9') });
  const after = (await whatsappFlowService.getFlowSteps(flow.id));
  const hsrAfter = ((whatsappFlowService as any).resolveStepOptions(after.find(s => s.stepKey === '4'), { dealer_name: 'Homelane', dealer_city: 'Bengaluru', store_name: 'HSR' }).options.dropdownItems as any[]);
  expect(hsrAfter.map(x => x.value).join() === '5,6,9', 'editing a row changes the journey dropdown immediately', hsrAfter);
  expect(await svc.updateRow(acct.id, dcHsrRow.id, { store: 'Whitefield' }).then(() => false, (e: any) => /already exists/.test(e.message)), 'duplicate store for the same dealer + city rejected');

  // ── CRM store: exact row, never another dealer's ─────────────────────────
  const kok = await svc.findSheetRowForLead(acct.id, { dealer_name: 'Homelane', dealer_city: 'Hyderabad', store_name: 'Kokapet' });
  expect(kok?.row?.storeId === 103, "Homelane Kokapet lead → Homelane's LOS store (103), not PMJ's (301)", kok?.row?.storeId);
  const missing = await svc.findSheetRowForLead(acct.id, { dealer_name: 'Homelane', dealer_city: 'Hyderabad', store_name: 'Gachibowli' });
  expect(missing && !missing.row, 'unknown store → no guess');

  // ── Excel import ─────────────────────────────────────────────────────────
  const file = [
    { Dealer: 'Homelane', City: 'Bengaluru', Store: 'HSR', 'EMI Schemes': '6/1=5; 9/1=6; 12/1=9', SID: 'SID-101', Active: 'Yes', 'Show in Journey': 'Yes' },
    { Dealer: 'Homelane', City: 'Bengaluru', Store: 'Koramangala', 'EMI Schemes': '6/1=5', 'LOS Store ID': '104', SID: 'SID-104', Secret: 'new-secret' },
    { Dealer: 'Design Cafe', City: 'Bengaluru', Store: 'HSR', 'EMI Schemes': '6/1=32; 12/1=34; 18/1=35', SID: 'SID-201' },
    { Dealer: 'Zen', City: '', Store: 'X' },
    { dealer: 'Zen', city: 'Pune', store: 'Y', 'emi schemes': 'bad' },
  ];
  const preview = await svc.previewImport(acct.id, file, false);
  expect(preview.added.length === 1 && preview.added[0].store === 'Koramangala', 'import preview: 1 new store', preview.added);
  expect(preview.changed.length === 1 && preview.changed[0].fields.join() === 'EMI Schemes', 'import preview: Design Cafe HSR EMI changed', preview.changed);
  expect(preview.errors.map(e => e.rowNumber).join() === '5,6', 'import preview: bad rows reported with row numbers', preview.errors);
  expect(await svc.applyImport(acct.id, file, false).then(() => false, () => true), 'apply refused while the file has errors');
  const fixed = file.slice(0, 3);
  expect((await svc.previewImport(acct.id, fixed, true)).removed.length === 5, 'remove-missing lists stores not in the file');
  const applied = await svc.applyImport(acct.id, fixed, false);
  rows = await svc.listRows(acct.id);
  const kor = rows.find(r => r.store === 'Koramangala')!;
  expect(applied.added === 1 && applied.changed === 1 && kor.hasSecret && kor.losStoreId === 104 && kor.issues.length === 0, 'import applied', { applied, kor });
  expect((await svc.revealSecret(acct.id, kor.id)) === 'new-secret', 'secret stored encrypted and readable by reveal');
  const [rawKor] = await db.select().from(schema.crmStoreCredentials).where(eq(schema.crmStoreCredentials.id, kor.id));
  expect(rawKor.secret !== 'new-secret', 'secret not stored in plain text');

  // Switching off → the journey's own lists again.
  await svc.updateSettings(acct.id, { enabled: false });
  const offSteps = await whatsappFlowService.getFlowSteps(flow.id);
  expect(!(offSteps.find(s => s.stepKey === '4')!.options as any)._fromSheet, 'sheet off → hand-made lists used again');

  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll Dealers & Stores checks passed.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
