/**
 * Dealers & Stores: upload in the LOS layout — real SQL, synthetic stores shaped like a live account.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55440/postgres?sslmode=disable \
 *   STORE_SHEET_TEST_DB=1 npx tsx server/services/__tests__/storeSheetLos.integration.test.ts
 */
import crypto from 'crypto';
import { formatEmiSchemes } from '@shared/storeSheet';
import { groupLosRows, isLosLayout, looksCutOff, pickLosColumns, suggestCity, suggestDealerName, suggestStoreName, titleCase } from '@shared/storeSheetLos';

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
const eq_ = (got: unknown, want: unknown, label: string) => expect(JSON.stringify(got) === JSON.stringify(want), label, got);
const refused = (p: Promise<unknown>) => p.then(() => '', (e: any) => e.message as string);

const HV = 'Homevista Decor And Furnishings Private Limited';
/** Rows as the LOS exports them: one per scheme. */
const losRows = (o: { dealer?: string; id: number | string; name: string; sid?: string | null; secret?: string | null; city?: string; schemes?: [number | string, string][]; extra?: Record<string, unknown> }) =>
  (o.schemes ?? [[5, '6/1@4%'], [9, '12/1@3%']]).map(([id, label]) => ({
    Dealer_id: 3, Dealer_name: o.dealer ?? HV, City: o.city ?? '', Store_Id: o.id, SID: o.sid ?? '', Store_Name: o.name, Secret: o.secret ?? '', Scheme_ID: id, EMI_Scheme: label, ...o.extra,
  }));

// ── Reading the file ─────────────────────────────────────────────────────────
expect(isLosLayout(['Dealer_id', 'Dealer_name', 'Store_Id', 'SID', 'Store_Name', 'Secret', 'Scheme_ID', 'EMI_Scheme', 'Active']), "the LOS's own export is recognised, without City");
expect(!isLosLayout(['Dealer', 'City', 'Store', 'EMI Schemes', 'LOS Dealer Name', 'LOS Store Name', 'LOS Store ID', 'SID', 'Secret', 'Active', 'Show in Journey']), 'the older layout is not taken for it');
expect(!('Dealer_id' in pickLosColumns(losRows({ id: 1, name: 'A' }))[0]), 'Dealer_id is left out');
let g = groupLosRows([...losRows({ id: 1, name: 'A', sid: 'S1' }), ...losRows({ id: 1, name: 'A', sid: 'S1' })]);
expect(g.stores.length === 1 && g.stores[0].schemes.length === 2 && g.repeatedRows === 2, 'exact repeats counted once', g);
const reason = (rows: Record<string, unknown>[]) => groupLosRows(rows).held.map(h => h.reason).join(' / ');
expect(/different values for Secret/.test(reason([...losRows({ id: 1, name: 'A', secret: 'x' }), ...losRows({ id: 1, name: 'A', secret: 'y' })])), 'two secrets for one store held back');
expect(/different values for City/.test(reason([...losRows({ id: 1, name: 'A', city: 'Pune' }), ...losRows({ id: 1, name: 'A', city: 'Mumbai' })])), 'two cities for one store held back');
expect(reason([...losRows({ id: 1, name: 'A', city: 'Chennai' }), ...losRows({ id: 1, name: 'A', city: 'chennai' })]) === '', 'Chennai and chennai are one city');
expect(/6\/1@4% has two IDs: 5 and 7/.test(reason(losRows({ id: 1, name: 'A', schemes: [[5, '6/1@4%'], [7, '6/1@4%']] }))), 'one EMI name with two IDs held back', reason(losRows({ id: 1, name: 'A', schemes: [[5, '6/1@4%'], [7, '6/1@4%']] })));
expect(/Scheme_ID 5 has two names/.test(reason(losRows({ id: 1, name: 'A', schemes: [[5, '6/1@4%'], [5, '6/1@5%']] }))), 'one Scheme_ID with two names held back');
g = groupLosRows([...losRows({ id: 1, name: 'A', sid: 'S1' }), ...losRows({ id: 2, name: 'B', sid: 'S1' }), ...losRows({ id: 3, name: 'C', sid: 'S3' })]);
expect(g.stores.length === 1 && g.held.length === 2 && /SID S1 is also on Store_Id/.test(g.held[0].reason), 'one SID on two stores: both held back', g.held);
expect(/Store_Id is missing/.test(reason(losRows({ id: '', name: 'A' }))), 'Store_Id is required');
expect(/EMI_Scheme is missing/.test(reason(losRows({ id: 1, name: 'A', schemes: [[5, '']] }))), 'a scheme ID without a name held back');
g = groupLosRows(losRows({ id: '1,037', name: 'A', sid: 'NULL', secret: 'null', schemes: [['1,044', '3/0@10%'], [5, '24/1@3%'], [9, '6/1@4%']] }));
expect(g.stores[0].storeId === 1037 && g.stores[0].sid === '' && g.stores[0].secret === '', 'NULL is blank, 1,037 is 1037', g.stores[0]);
eq_(g.stores[0].schemes.map(s => `${s.label}=${s.schemeId}`), ['3/0@10%=1044', '6/1@4%=9', '24/1@3%=5'], 'schemes kept as in the sheet, shortest first');
g = groupLosRows([...losRows({ id: 1, name: 'A', extra: { Active: 'Inactive' } }), ...losRows({ id: 2, name: 'B', extra: { Active: 'Active' } })]);
expect(g.stores.length === 1 && g.inactiveStores[0]?.store === 'A', 'a store marked Inactive is listed, not added', g);
expect(looksCutOff(2000) && !looksCutOff(1999) && !looksCutOff(0), 'exactly 2,000 rows looks cut off');

// ── Short names ──────────────────────────────────────────────────────────────
eq_([suggestDealerName('GREAT LEARNING EDUCATION SERVICES PRIVATE LIMITED'), suggestDealerName('TIMES EDUTECH AND EVENTS LIMITED'), suggestDealerName('HERO EDUCATION PRIVATE LIMITED'), suggestDealerName('INTELLIPAAT SOFTWARE SOLUTIONS PRIVATE LIMITED'), suggestDealerName('Onya diamonds')],
  ['Great Learning', 'Times Edutech', 'Hero Education', 'Intellipaat', 'Onya diamonds'], 'dealer names shortened');
const name = (s: string, d: string[], c: string) => suggestStoreName(s, d, c);
eq_([
  name('Homelane-Whitefield - Bengaluru', ['Homelane', HV], 'Bengaluru'), name('Cloudnine -BENGALURU-NAGARABHAVI-Bengaluru', ['Cloudnine'], 'Bengaluru'), name('Vijayawada-Decorpot', ['Decorpot'], 'Vijayawada'),
  name('Cloudnine JayanagarBengaluru', ['Cloudnine'], 'Bengaluru'), name('Cloudnine East Delhi', ['Cloudnine'], 'Delhi'), name('Pune Baner-Pune', ['Cloudnine'], 'Pune'), name('Cloudnine Chandigarh', ['Cloudnine'], 'Chandigarh'),
  name('Design Cafe 1', ['Design Cafe'], 'Online'), name('HSR-Bangalore', ['Onya diamonds'], 'Bengaluru'), name('CORDLIFE SCIENCES INDIA PRIVATE LIMITED', ['Cordlife', 'CORDLIFE SCIENCES INDIA PRIVATE LIMITED'], 'Online'), name('PGDM', ['Great Learning'], 'Online'),
], ['Whitefield', 'Nagarabhavi', 'Vijayawada', 'Jayanagar', 'East Delhi', 'Baner', 'Chandigarh', 'Design Cafe 1', 'HSR', 'Cordlife', 'PGDM'], 'store names shortened: dealer and city dropped');
eq_([suggestCity('Homelane-HSR - Bengaluru', []), suggestCity('Banjara Hills-Hyd-Decorpot', []), suggestCity('Cloudnine JayanagarBengaluru', []), suggestCity('GL - IIT B', []), suggestCity('Onya Jayanagar', [], ['Jayanagar']), suggestCity('X-Bangalore', [], ['Bengaluru']), suggestCity('IIM Calcutta Senior Management Programme_24', [])],
  ['Bengaluru', 'Hyderabad', 'Bengaluru', '', '', 'Bengaluru', ''], 'cities suggested from store names, never an area or a course');
expect(titleCase('IIT ROAD') === 'IIT Road', 'acronyms kept');

async function main() {
  const { db } = await import('../../db');
  const schema = await import('@shared/schema');
  const { eq } = await import('drizzle-orm');
  const { encrypt } = await import('../encryptionService');
  const svc = await import('../storeSheetService');
  const los = await import('../storeSheetLosImport');

  const [acct] = await db.insert(schema.businessAccounts).values({ name: 'LOS Sheet Test', website: 'https://example.com' } as any).returning();
  const [otherAcct] = await db.insert(schema.businessAccounts).values({ name: 'LOS Sheet Other', website: 'https://example.com' } as any).returning();
  await db.insert(schema.whatsappSettings).values({ businessAccountId: acct.id, storeSheetEnabled: 'true' } as any);
  const row = async (v: Record<string, unknown>) => (await db.insert(schema.crmStoreCredentials).values({
    businessAccountId: acct.id, sid: '', secret: '', isActive: true, showInJourney: false, ...v,
  } as any).returning())[0];
  const emi = (s: string) => s.split('; ').map(p => ({ label: p.split('=')[0], schemeId: p.split('=')[1] }));
  const live = await row({ dealerName: HV, storeName: 'Homelane-HSR - Bengaluru', displayDealerName: 'Homelane', displayStoreName: 'HSR Layout', city: 'Bengaluru', storeId: 598, sid: 'T598', secret: encrypt('sec-598'), emiSchemes: emi('6/1=5; 12/1=9'), showInJourney: true });
  const offRow = await row({ dealerName: HV, storeName: 'Homelane-Belapur(Co working)- Mumbai', storeId: 643, sid: 'T643', secret: encrypt('sec-643') });
  const half = await row({ dealerName: 'Homelane', storeName: 'Belapur working)', displayDealerName: 'Homelane', displayStoreName: 'Belapur working)', city: 'Mumbai', emiSchemes: emi('6/1=5'), showInJourney: true });
  const dc = await row({ dealerName: 'Design Cafe', storeName: 'HSR-Bengaluru', displayDealerName: 'Design Cafe', displayStoreName: 'HSR', city: 'Bengaluru', storeId: 201, sid: 'T201', secret: encrypt('sec-201'), emiSchemes: emi('6/1=32; 12/1=34'), showInJourney: true });
  const bvdu = await row({ dealerName: 'HERO EDUCATION PRIVATE LIMITED', storeName: 'BVDU', storeId: 4617, sid: 'T4617', secret: encrypt('sec-4617') });
  const bvduSpare = await row({ dealerName: 'HERO EDUCATION PRIVATE LIMITED', storeName: 'BVDU', storeId: 4617, sid: 'NULL', secret: encrypt('x') });
  const switchedOff = await row({ dealerName: 'Zen Diamond', storeName: 'Bandra', displayDealerName: 'Zen Diamond', displayStoreName: 'Bandra', city: 'Mumbai', storeId: 1382, sid: 'T1382', secret: encrypt('z'), emiSchemes: emi('6/1=5') });
  const pmj = await row({ dealerName: 'PMJ Jewellers', storeName: 'Kokapet', displayDealerName: 'PMJ Jewellers', displayStoreName: 'Kokapet', city: 'Kokapet', storeId: 1298, sid: 'T1298', secret: encrypt('p'), emiSchemes: emi('6/1=5'), showInJourney: true });
  const foreign = (await db.insert(schema.crmStoreCredentials).values({ businessAccountId: otherAcct.id, dealerName: 'X', storeName: 'Y', sid: 'T598', secret: 'q', storeId: 598 } as any).returning())[0];

  const file = [
    ...losRows({ id: 598, name: 'Homelane-HSR - Bengaluru', sid: 'T598', secret: 'sec-598', city: 'bengaluru' }),
    ...losRows({ id: 643, name: 'Homelane-Belapur(Co working)- Mumbai', sid: 'T643', secret: 'sec-643' }),
    ...losRows({ id: 700, name: 'Homelane-Whitefield - Bengaluru', sid: 'T700', secret: 'sec-700', city: 'Bengaluru' }),
    ...losRows({ id: 701, name: 'Homelane-Hebbal - Bengaluru', city: 'Bengaluru' }), // no SID
    ...losRows({ id: 702, name: 'Homelane-Baner- Pune', sid: 'T702', secret: 'sec-702' }), // no city
    ...losRows({ dealer: 'Design Cafe', id: 201, name: 'HSR-Bengaluru', sid: 'T201', schemes: [[160, '36/1@3%'], [161, '6/1@4%']] }),
    ...losRows({ dealer: 'HERO EDUCATION PRIVATE LIMITED', id: 4617, name: 'BVDU', sid: 'T4617', city: 'Online' }),
    ...losRows({ dealer: 'Zen Diamond', id: 1382, name: 'Bandra', sid: 'T1382', schemes: [[5, '6/1']] }),
    ...losRows({ dealer: 'GREAT LEARNING EDUCATION SERVICES PRIVATE LIMITED', id: 1380, name: 'SRM Institute', sid: 'T1380', secret: 'gl', city: 'Online' }),
  ] as Record<string, unknown>[];

  // ── Preview ────────────────────────────────────────────────────────────────
  let p = await los.previewLosImport(acct.id, file, {});
  const at = (key: string) => p.stores.find(s => s.key === key)!;
  expect(!JSON.stringify(p).includes('sec-'), 'the preview never carries a secret');
  eq_([p.counts.add, p.held.map(h => `${h.key}:${h.kind}`), p.held[0]?.citySuggestion], [3, ['702:city'], 'Pune'], 'new stores added; one without a city held back with a suggestion');
  eq_([at('598').store, at('598').city, at('598').dealer, at('598').fields], ['HSR Layout', 'Bengaluru', 'Homelane', ['EMI schemes']], 'a live store keeps its names; only the EMI wording changes');
  eq_(at('598').schemes.map(s => s.label), ['6/1@4%', '12/1@3%'], 'EMI schemes read as in the sheet');
  eq_([at('700').dealer, at('700').store, at('700').inJourney], ['Homelane', 'Whitefield', true], 'a complete new store goes into the journey under the dealer name customers know');
  eq_([at('701').inJourney, at('701').missing], [false, ['SID', 'Secret']], 'a store without SID and secret stays out of the journey');
  eq_([at('201').schemesKept, p.dealers.find(d => d.losDealer === 'Design Cafe')!.schemeChanges.length, formatEmiSchemes(at('201').schemes)], [true, 1, '6/1=32; 12/1=34'], "changed scheme IDs keep today's until chosen");
  eq_([at('1382').leftOff, at('1382').inJourney], [true, false], 'a complete store switched off by hand stays off');
  expect(p.spares.length === 1 && p.spares[0].id === bvduSpare.id && at('4617').fields.length > 0, 'a repeat with "NULL" as SID is offered to be switched off', p.spares);
  eq_([p.unlinked.length, p.unlinked[0]?.id, p.unlinked[0]?.suggestion], [1, half.id, '643'], 'the store without SID is suggested its LOS record');
  eq_(p.notInFile.map(s => s.id), [half.id, pmj.id], 'stores not in the file are only listed');
  eq_(p.dealers.find(d => /GREAT/.test(d.losDealer))!.name, 'Great Learning', 'new dealer gets a short name');
  expect(p.blockers.length === 0, 'nothing blocks saving', p.blockers);

  // Dealer names
  p = await los.previewLosImport(acct.id, file, { dealerNames: { 'great learning education services private limited': 'Great Learning Education Services' } });
  expect(p.blockers.length === 1, 'a dealer name over 24 characters blocks saving', p.blockers);
  p = await los.previewLosImport(acct.id, file, { dealerNames: { 'great learning education services private limited': 'Homelane' } });
  expect(/Also the name of/.test(p.blockers.join()), 'two dealers cannot share a name', p.blockers);
  p = await los.previewLosImport(acct.id, file, { dealerNames: { 'great learning education services private limited': 'PMJ Jewellers' } });
  expect(/Also the name of PMJ/.test(p.blockers.join()), 'nor take the name of a dealer that is not in the file', p.blockers);

  // Conflicts with the app
  const conflict = async (rows: Record<string, unknown>[], choices = {}) => (await los.previewLosImport(acct.id, rows, choices)).held.map(h => `${h.kind}: ${h.reason}`).join(' / ');
  expect(/SID T598 belongs to Store_Id 598/.test(await conflict(losRows({ id: 999, name: 'New', sid: 'T598', city: 'Pune' }))), 'a SID of another store in the app is held back');
  expect(/^same: Possibly the same store/.test(await conflict(losRows({ id: 599, name: 'Homelane HSR Bengaluru', city: 'Bengaluru' }))), 'a new Store_Id with a known name asks first');
  p = await los.previewLosImport(acct.id, losRows({ id: 599, name: 'Homelane HSR Bengaluru', city: 'Bengaluru' }), { sameAs: { '599': live.id } });
  expect(p.stores[0]?.action === 'update' && p.stores[0].fields.includes('Store ID'), '“Same store” updates the one in the app', p.stores[0]);
  p = await los.previewLosImport(acct.id, losRows({ id: 599, name: 'Homelane HSR Bengaluru', city: 'Bengaluru' }), { sameAs: { '599': 'different' }, storeNames: { '599': 'HSR Layout' } });
  expect(p.held[0]?.kind === 'name', 'two stores of one dealer and city cannot show the same name', p.held);
  p = await los.previewLosImport(acct.id, [...losRows({ id: 801, name: 'Homelane-Indiranagar - Bengaluru', city: 'Bengaluru' }), ...losRows({ id: 802, name: 'Indiranagar', city: 'Bengaluru' })], {});
  expect(p.held.length === 0 && p.stores.some(s => s.store === 'Homelane-Indiranagar - Bengaluru'), 'a shortened name that is taken goes back to the full one', p.stores.map(s => s.store));
  p = await los.previewLosImport(acct.id, losRows({ id: 803, name: 'Homelane-X', city: 'Pune', sid: 'S803', secret: 's', schemes: [['', '']] }), {});
  expect(p.stores[0].missing.join() === 'EMI schemes' && !p.stores[0].inJourney, 'no schemes → added, not in the journey', p.stores[0]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const choices = { cities: { '702': 'Pune', '643': 'Navi Mumbai' }, join: { [half.id]: '643' }, switchOff: [bvduSpare.id], keepOff: ['1380'] };
  p = await los.previewLosImport(acct.id, file, choices);
  eq_([p.counts.joined, p.counts.switchedOff, p.counts.held, p.counts.add], [1, 1, 0, 4], 'choices taken in');
  eq_([at('643').store, at('643').wasInJourney, at('643').inJourney], ['Belapur working)', true, true], 'joined: the name customers see stays');
  const body = { rows: file, choices, stamp: p.stamp, fileName: 'los.xlsx' };
  expect(/stores changed/.test(await refused(los.applyLosImport(acct.id, { ...body, stamp: 'old' }, 'Tester'))), 'a preview from before a change is refused');
  const before = await db.select().from(schema.crmStoreCredentials).where(eq(schema.crmStoreCredentials.businessAccountId, acct.id));
  const done = await los.applyLosImport(acct.id, body, 'Tester');
  eq_([done.added, done.joined, done.switchedOff, done.held], [4, 1, 1, 0], 'saved');
  let rows = await svc.listRows(acct.id);
  const by = (id: string) => rows.find(r => r.id === id)!;
  const byStore = (id: number) => rows.find(r => r.losStoreId === id)!;
  eq_([by(offRow.id).store, by(offRow.id).city, by(offRow.id).inJourney, by(offRow.id).sid, by(offRow.id).issues], ['Belapur working)', 'Navi Mumbai', true, 'T643', []], 'the LOS record now carries the customer names and is complete');
  eq_([by(half.id).isActive, by(half.id).inJourney], [false, false], 'the spare entry is switched off, not deleted');
  eq_([by(bvduSpare.id).isActive, by(bvdu.id).inJourney, by(bvdu.id).dealer], [false, true, 'Hero Education'], 'BVDU: one left, in the journey');
  eq_([by(switchedOff.id).inJourney, by(pmj.id).inJourney, by(dc.id).emiSchemes.length], [false, true, 2], 'switched-off, not-in-file and kept-scheme stores untouched');
  eq_([byStore(700).inJourney, byStore(701).inJourney, byStore(1380).inJourney, byStore(702).city], [true, false, false, 'Pune'], 'journey on only for complete stores, and not for the ones left out');
  expect((await svc.revealSecret(acct.id, byStore(700).id)) === 'sec-700' && (await svc.revealSecret(acct.id, live.id)) === 'sec-598', 'secrets saved, existing ones intact');
  const [raw] = await db.select().from(schema.crmStoreCredentials).where(eq(schema.crmStoreCredentials.id, byStore(700).id));
  expect(raw.secret !== 'sec-700', 'secret not stored in plain text');
  const [log] = await db.select().from(schema.storeSheetImports).where(eq(schema.storeSheetImports.businessAccountId, acct.id));
  expect(!JSON.stringify(log).includes('sec-'), 'the undo copy holds no plain secret');

  // The journey shows them
  const snap = await svc.getSheetSnapshot(acct.id);
  expect(snap.rows.some(r => r.store === 'Whitefield') && !snap.rows.some(r => r.losStoreId === 701 || r.id === half.id), 'journey lists follow');

  // ── Same file again ────────────────────────────────────────────────────────
  p = await los.previewLosImport(acct.id, file, {});
  eq_([p.counts.add, p.counts.update, p.counts.held], [0, 0, 0], 'uploading the same file again changes nothing');
  eq_([at('1380').leftOff, at('700').store, p.dealers.find(d => /GREAT/.test(d.losDealer))!.suggested], [true, 'Whitefield', false], 'left-out stores stay out, names are remembered');
  expect(/Nothing to change/.test(await refused(los.applyLosImport(acct.id, { ...body, choices: {}, stamp: p.stamp }, 'Tester'))), 'nothing to save');
  // The missing SID arrives later
  p = await los.previewLosImport(acct.id, losRows({ id: 701, name: 'Homelane-Hebbal - Bengaluru', city: 'Bengaluru', sid: 'T701', secret: 'late' }), {});
  eq_([p.stores[0].inJourney, p.stores[0].fields], [true, ['SID', 'Secret', 'In journey']], 'a later SID and secret switch the store on');
  // Blank cells never clear
  p = await los.previewLosImport(acct.id, losRows({ id: 700, name: 'Homelane-Whitefield - Bengaluru', schemes: [['', '']] }), {});
  eq_([p.stores[0].action, p.stores[0].city, p.stores[0].schemes.length], ['unchanged', 'Bengaluru', 2], 'blank cells keep what is saved');

  const back = (await svc.listRows(acct.id)).flatMap(r => {
    const s = { Dealer_name: r.losDealerName, City: r.city, Store_Id: r.losStoreId ?? '', SID: r.sid, Store_Name: r.losStoreName, Secret: '' };
    return r.emiSchemes.length ? r.emiSchemes.slice().reverse().map(e => ({ ...s, Scheme_ID: e.schemeId, EMI_Scheme: e.label })) : [{ ...s, Scheme_ID: '', EMI_Scheme: '' }];
  });
  p = await los.previewLosImport(acct.id, back, {});
  eq_([p.counts.add, p.counts.update, p.held.map(h => h.reason)], [0, 0, ['Store_Id is missing']], 'an export uploaded again changes nothing, in any order');

  // ── Undo ───────────────────────────────────────────────────────────────────
  const last = (await los.lastLosImport(acct.id))!;
  expect(last.fileName === 'los.xlsx' && last.summary.added === 4 && last.createdByName === 'Tester', 'the upload can be undone', last);
  expect(/newest/.test(await refused(los.undoLosImport(otherAcct.id, last.id, null))), "another account can't undo it");
  await svc.updateRow(acct.id, byStore(702).id, { store: 'Baner (edited)' }); // edited since
  const [lead] = await db.insert(schema.whatsappLeads).values({ businessAccountId: acct.id, senderPhone: '910000000001', customCrmSyncPayload: { _crmSync: { storeCredentialId: byStore(701).id } } } as any).returning();
  const undone = await los.undoLosImport(acct.id, last.id, 'Tester');
  eq_([undone.removed, undone.switchedOff, undone.leftEdited], [2, 1, 1], 'undo: added stores removed, one a lead was sent with switched off, an edited one left', );
  rows = await svc.listRows(acct.id);
  const afterUndo = await db.select().from(schema.crmStoreCredentials).where(eq(schema.crmStoreCredentials.businessAccountId, acct.id));
  const same = (x: any) => { const { updatedAt, ...r } = x; return JSON.stringify(Object.entries(r).sort()); };
  expect(before.every(b => afterUndo.some(a => a.id === b.id && same(a) === same(b))), 'every store it changed is exactly as before');
  expect((await los.lastLosImport(acct.id)) === null && /newest/.test(await refused(los.undoLosImport(acct.id, last.id, null))), 'it cannot be undone twice');
  const [f2] = await db.select().from(schema.crmStoreCredentials).where(eq(schema.crmStoreCredentials.id, foreign.id));
  expect(f2.secret === 'q' && f2.storeName === 'Y', "another account's store with the same SID is untouched");

  // Two uploads, undone newest first
  p = await los.previewLosImport(acct.id, file, {});
  await los.applyLosImport(acct.id, { ...body, choices: {}, stamp: p.stamp, fileName: 'one.xlsx' }, null);
  const second = losRows({ dealer: 'Design Cafe', id: 201, name: 'HSR-Bengaluru', sid: 'T201', schemes: [[161, '6/1@4%']] });
  p = await los.previewLosImport(acct.id, second, { useFileSchemes: ['design cafe'] });
  await los.applyLosImport(acct.id, { rows: second, choices: { useFileSchemes: ['design cafe'] }, stamp: p.stamp, fileName: 'two.xlsx' }, null);
  eq_(formatEmiSchemes((await svc.listRows(acct.id)).find(r => r.id === dc.id)!.emiSchemes), '6/1@4%=161', "the file's schemes are used when chosen");
  await los.undoLosImport(acct.id, (await los.lastLosImport(acct.id))!.id, null);
  eq_([formatEmiSchemes((await svc.listRows(acct.id)).find(r => r.id === dc.id)!.emiSchemes), (await los.lastLosImport(acct.id))?.fileName], ['6/1=32; 12/1=34', 'one.xlsx'], 'the older upload can be undone next');
  const u1 = await los.undoLosImport(acct.id, (await los.lastLosImport(acct.id))!.id, null);
  expect(u1.leftEdited === 0, 'and finds its stores as it left them', u1);

  await db.delete(schema.whatsappLeads).where(eq(schema.whatsappLeads.id, lead.id));
  for (const id of [acct.id, otherAcct.id]) await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, id));
  if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
  console.log('\nAll LOS upload checks passed.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
