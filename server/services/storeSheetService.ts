/**
 * Dealers & Stores sheet (see shared/storeSheet.ts).
 *
 * Rows live in crm_store_credentials. When whatsapp_settings.store_sheet_enabled is on,
 * journey dropdown steps tagged with options.sheetLevel ('dealer' | 'city' | 'store' | 'emi')
 * get their options from the sheet instead of their hand-made lists (applySheetToSteps), and
 * the CRM/LOS push uses the exact sheet row the customer picked (findSheetRowForLead).
 */
import { db } from "../db";
import { crmStoreCredentials, whatsappFlows, whatsappFlowSteps, whatsappSettings, type CrmStoreCredential, type WhatsappFlowStep } from "@shared/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  SHEET_LEVELS, normKey, parseActive, parseEmiSchemes, rowKey, suggestSheetLevel,
  type EmiScheme, type SheetLevel, type StoreSheetRow, type StoreSheetRowInput,
} from "@shared/storeSheet";
import { encrypt, safeDecrypt } from "./encryptionService";

export class SheetError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// ── Rows ──────────────────────────────────────────────────────────────────────

const displayDealer = (c: CrmStoreCredential) => (c.displayDealerName || c.dealerName || '').trim();
const displayStore = (c: CrmStoreCredential) => (c.displayStoreName || c.storeName || '').trim();

export function toSheetRow(c: CrmStoreCredential): StoreSheetRow {
  const emiSchemes = Array.isArray(c.emiSchemes) ? (c.emiSchemes as EmiScheme[]) : [];
  const issues: string[] = [];
  if (!c.sid?.trim()) issues.push('No SID');
  if (!c.secret?.trim()) issues.push('No secret');
  if (c.showInJourney && !c.city?.trim()) issues.push('No city');
  if (c.showInJourney && emiSchemes.length === 0) issues.push('No EMI schemes');
  return {
    id: c.id,
    dealer: displayDealer(c),
    city: (c.city || '').trim(),
    store: displayStore(c),
    emiSchemes,
    losDealerName: c.dealerName,
    losStoreName: c.storeName,
    losStoreId: c.storeId ?? null,
    sid: c.sid || '',
    hasSecret: !!c.secret?.trim(),
    isActive: c.isActive,
    inJourney: c.showInJourney,
    issues,
  };
}

async function loadCredentials(businessAccountId: string): Promise<CrmStoreCredential[]> {
  return db
    .select()
    .from(crmStoreCredentials)
    .where(eq(crmStoreCredentials.businessAccountId, businessAccountId))
    .orderBy(asc(crmStoreCredentials.dealerName), asc(crmStoreCredentials.storeName));
}

export async function listRows(businessAccountId: string): Promise<StoreSheetRow[]> {
  const rows = (await loadCredentials(businessAccountId)).map(toSheetRow);
  return rows.sort((a, b) =>
    a.dealer.localeCompare(b.dealer) || a.city.localeCompare(b.city) || a.store.localeCompare(b.store));
}

function parseStoreId(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).trim());
  if (!Number.isInteger(n) || n < 0) throw new SheetError(`LOS Store ID "${v}" must be a whole number`);
  return n;
}

/** Validated DB values for a row. `existing` = the row being edited (partial updates). */
function toDbValues(input: Partial<StoreSheetRowInput>, existing?: CrmStoreCredential) {
  const dealer = input.dealer !== undefined ? String(input.dealer).trim() : existing ? displayDealer(existing) : '';
  const city = input.city !== undefined ? String(input.city ?? '').trim() : (existing?.city || '');
  const store = input.store !== undefined ? String(input.store).trim() : existing ? displayStore(existing) : '';
  if (!dealer) throw new SheetError('Dealer is required');
  if (!store) throw new SheetError('Store is required');
  if (!city) throw new SheetError('City is required');

  const values: Partial<typeof crmStoreCredentials.$inferInsert> = {
    displayDealerName: dealer,
    displayStoreName: store,
    city,
    updatedAt: new Date(),
  };
  if (input.emiSchemes !== undefined) {
    const schemes = Array.isArray(input.emiSchemes)
      ? input.emiSchemes.map(s => ({ label: String(s.label ?? '').trim(), schemeId: String(s.schemeId ?? '').trim() }))
      : parseEmiSchemes(input.emiSchemes);
    if (schemes.some(s => !s.label || !s.schemeId)) throw new SheetError('Each EMI scheme needs a label and a scheme ID');
    if (new Set(schemes.map(s => s.label.toLowerCase())).size !== schemes.length) throw new SheetError('An EMI scheme is listed twice');
    values.emiSchemes = schemes;
  }
  // LOS names default to the names customers see.
  if (input.losDealerName !== undefined || !existing) values.dealerName = String(input.losDealerName ?? '').trim() || dealer;
  if (input.losStoreName !== undefined || !existing) values.storeName = String(input.losStoreName ?? '').trim() || store;
  if (input.losStoreId !== undefined) values.storeId = parseStoreId(input.losStoreId);
  if (input.sid !== undefined || !existing) values.sid = String(input.sid ?? '').trim();
  if (typeof input.secret === 'string' && input.secret.trim()) values.secret = encrypt(input.secret.trim());
  else if (!existing) values.secret = '';
  if (input.isActive !== undefined) values.isActive = !!input.isActive;
  if (input.inJourney !== undefined) values.showInJourney = !!input.inJourney;
  return { values, key: rowKey({ dealer, city, store }) };
}

async function assertUnique(businessAccountId: string, key: string, exceptId?: string) {
  const clash = (await loadCredentials(businessAccountId)).find(c => c.id !== exceptId && rowKey(toSheetRow(c)) === key);
  if (clash) {
    const r = toSheetRow(clash);
    throw new SheetError(`"${r.store}" already exists for ${r.dealer} in ${r.city}`, 409);
  }
}

export async function createRow(businessAccountId: string, input: StoreSheetRowInput): Promise<StoreSheetRow> {
  const { values, key } = toDbValues(input);
  await assertUnique(businessAccountId, key);
  const [row] = await db.insert(crmStoreCredentials).values({ ...values, businessAccountId } as any).returning();
  forgetSheetSnapshot(businessAccountId);
  return toSheetRow(row);
}

async function getOwnedRow(businessAccountId: string, id: string): Promise<CrmStoreCredential> {
  const [row] = await db.select().from(crmStoreCredentials)
    .where(and(eq(crmStoreCredentials.id, id), eq(crmStoreCredentials.businessAccountId, businessAccountId))).limit(1);
  if (!row) throw new SheetError('Store not found', 404);
  return row;
}

export async function updateRow(businessAccountId: string, id: string, input: Partial<StoreSheetRowInput>): Promise<StoreSheetRow> {
  const existing = await getOwnedRow(businessAccountId, id);
  const { values, key } = toDbValues(input, existing);
  await assertUnique(businessAccountId, key, id);
  const [row] = await db.update(crmStoreCredentials).set(values)
    .where(and(eq(crmStoreCredentials.id, id), eq(crmStoreCredentials.businessAccountId, businessAccountId))).returning();
  forgetSheetSnapshot(businessAccountId);
  return toSheetRow(row);
}

export async function deleteRows(businessAccountId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await db.delete(crmStoreCredentials)
    .where(and(eq(crmStoreCredentials.businessAccountId, businessAccountId), inArray(crmStoreCredentials.id, ids)))
    .returning({ id: crmStoreCredentials.id });
  forgetSheetSnapshot(businessAccountId);
  return deleted.length;
}

export async function revealSecret(businessAccountId: string, id: string): Promise<string> {
  const row = await getOwnedRow(businessAccountId, id);
  return row.secret ? safeDecrypt(row.secret) || '' : '';
}

// ── Journey steps and settings ────────────────────────────────────────────────

async function getActiveFlow(businessAccountId: string) {
  const [flow] = await db.select().from(whatsappFlows)
    .where(and(eq(whatsappFlows.businessAccountId, businessAccountId), eq(whatsappFlows.isActive, "true"))).limit(1);
  return flow || null;
}

export async function isSheetEnabled(businessAccountId: string): Promise<boolean> {
  const [s] = await db.select({ v: whatsappSettings.storeSheetEnabled }).from(whatsappSettings)
    .where(eq(whatsappSettings.businessAccountId, businessAccountId)).limit(1);
  return s?.v === "true";
}

const levelOf = (step: WhatsappFlowStep): SheetLevel | null => {
  const l = (step.options as any)?.sheetLevel;
  return SHEET_LEVELS.includes(l) ? l : null;
};

export async function getSheetState(businessAccountId: string, canRevealSecrets: boolean) {
  const flow = await getActiveFlow(businessAccountId);
  const steps = flow
    ? await db.select().from(whatsappFlowSteps).where(eq(whatsappFlowSteps.flowId, flow.id)).orderBy(asc(whatsappFlowSteps.stepOrder))
    : [];
  let journeyStoresNotInSheet = 0;
  try { journeyStoresNotInSheet = (await planSeedFromJourney(businessAccountId)).rows.length; } catch { /* no journey store list */ }
  return {
    enabled: await isSheetEnabled(businessAccountId),
    rows: await listRows(businessAccountId),
    journeyStoresNotInSheet,
    flowName: flow?.name ?? null,
    canRevealSecrets,
    linkedSteps: steps
      .filter(s => s.type === 'dropdown')
      .map(s => ({
        stepId: s.id, stepKey: s.stepKey, stepOrder: s.stepOrder, prompt: s.prompt, saveToField: s.saveToField,
        level: levelOf(s), suggestedLevel: suggestSheetLevel(s.saveToField),
      })),
  };
}

export async function updateSettings(
  businessAccountId: string,
  body: { enabled?: boolean; stepLevels?: Record<string, SheetLevel | null> },
) {
  if (body.stepLevels) {
    const flow = await getActiveFlow(businessAccountId);
    if (!flow) throw new SheetError('No active WhatsApp journey');
    const steps = await db.select().from(whatsappFlowSteps).where(eq(whatsappFlowSteps.flowId, flow.id));
    const byId = new Map(steps.map(s => [s.id, s]));
    const levels = Object.entries(body.stepLevels);
    for (const [stepId, level] of levels) {
      const step = byId.get(stepId);
      if (!step) throw new SheetError('That step is not in the active journey');
      if (level !== null && !SHEET_LEVELS.includes(level)) throw new SheetError(`Unknown level "${level}"`);
      if (level !== null && !step.saveToField) throw new SheetError(`Step ${step.stepOrder} has no "save to" field, so the next dropdowns can't use its answer`);
    }
    // Levels after this change, including steps not in this request.
    const finalLevel = new Map(steps.map(st => [st.id, levelOf(st)]));
    for (const [stepId, level] of levels) finalLevel.set(stepId, level);
    const chosen = Array.from(finalLevel.values()).filter(Boolean);
    if (new Set(chosen).size !== chosen.length) throw new SheetError('Each level (dealer, city, store, EMI) can be linked to one step only');
    for (const [stepId, level] of levels) {
      const step = byId.get(stepId)!;
      const options = { ...((step.options as any) || {}) };
      if (level) options.sheetLevel = level; else delete options.sheetLevel;
      await db.update(whatsappFlowSteps).set({ options }).where(eq(whatsappFlowSteps.id, stepId));
    }
    const { whatsappFlowService } = await import("./whatsappFlowService");
    whatsappFlowService.invalidateFlowCache(businessAccountId);
  }
  if (body.enabled !== undefined) {
    const value = body.enabled ? "true" : "false";
    const updated = await db.update(whatsappSettings).set({ storeSheetEnabled: value } as any)
      .where(eq(whatsappSettings.businessAccountId, businessAccountId)).returning({ id: whatsappSettings.id });
    if (updated.length === 0) throw new SheetError('Set up WhatsApp for this account first');
  }
  forgetSheetSnapshot(businessAccountId);
}

// ── Journey dropdowns from the sheet ──────────────────────────────────────────

export interface SheetSnapshot {
  enabled: boolean;
  rows: StoreSheetRow[];   // active, shown in the journey
  loadedAt: number;
}
const SNAPSHOT_TTL_MS = 30_000;
const snapshots = new Map<string, SheetSnapshot>();

export function forgetSheetSnapshot(businessAccountId: string) {
  snapshots.delete(businessAccountId);
}

export async function getSheetSnapshot(businessAccountId: string): Promise<SheetSnapshot> {
  const cached = snapshots.get(businessAccountId);
  if (cached && Date.now() - cached.loadedAt < SNAPSHOT_TTL_MS) return cached;
  const enabled = await isSheetEnabled(businessAccountId);
  const rows = enabled ? (await listRows(businessAccountId)).filter(r => r.isActive && r.inJourney) : [];
  const snap = { enabled, rows, loadedAt: Date.now() };
  snapshots.set(businessAccountId, snap);
  return snap;
}

const slug = (s: string) => normKey(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'x';
type Item = { id: string; title: string; value: string };

function uniqueSorted(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) if (v && !seen.has(normKey(v))) seen.set(normKey(v), v);
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

/**
 * Replaces the options of steps tagged options.sheetLevel with lists built from the sheet.
 * Each level depends on the answers of the linked levels before it, e.g. the EMI step is
 * keyed by dealer|city|store, so two dealers' stores with the same name never share a list.
 * Untagged steps, and every step when the sheet is off, are returned unchanged.
 */
export function applySheetToSteps(steps: WhatsappFlowStep[], snap: SheetSnapshot): WhatsappFlowStep[] {
  if (!snap.enabled) return steps;
  const linked = new Map<SheetLevel, WhatsappFlowStep>();
  for (const s of steps) {
    const l = levelOf(s);
    if (l && s.type === 'dropdown' && s.saveToField && !linked.has(l)) linked.set(l, s);
  }
  if (linked.size === 0) return steps;

  const order = SHEET_LEVELS.filter(l => linked.has(l));
  const valueOf = (r: StoreSheetRow, l: SheetLevel) => l === 'dealer' ? r.dealer : l === 'city' ? r.city : r.store;
  const built = new Map<string, any>();

  order.forEach((level, i) => {
    const step = linked.get(level)!;
    const parents = order.slice(0, i).filter(l => l !== 'emi');
    const base = { ...((step.options as any) || {}), _fromSheet: true, fallbackOptions: [] };
    const itemsFor = (rows: StoreSheetRow[]): Item[] => {
      if (level === 'emi') {
        const r = rows[0];
        return (r?.emiSchemes || []).map((s, n) => ({ id: `emi_${slug(s.label)}_${n}`, title: s.label, value: s.schemeId }));
      }
      return uniqueSorted(rows.map(r => valueOf(r, level))).map(v => ({ id: `${level}_${slug(v)}`, title: v, value: v }));
    };
    if (parents.length === 0) {
      built.set(step.id, { ...base, dropdownItems: itemsFor(snap.rows), dependsOnFields: undefined, dependsOnField: undefined, conditionalOptions: undefined });
      return;
    }
    const groups = new Map<string, StoreSheetRow[]>();
    for (const r of snap.rows) {
      const key = parents.map(p => valueOf(r, p)).join('|');
      const list = groups.get(normKey(key)) || [];
      list.push(r);
      groups.set(normKey(key), list);
    }
    const conditionalOptions: Record<string, Item[]> = {};
    for (const [key, rows] of Array.from(groups.entries())) conditionalOptions[key] = itemsFor(rows);
    built.set(step.id, {
      ...base,
      dropdownItems: [],
      dependsOnField: undefined,
      dependsOnFields: parents.map(p => linked.get(p)!.saveToField!),
      conditionalOptions,
    });
  });

  return steps.map(s => built.has(s.id) ? { ...s, options: built.get(s.id) } : s);
}

/**
 * The sheet row for a lead's dealer / city / store answers, when the sheet drives the journey.
 * Returns null when the sheet is off or the account's journey isn't linked; returns
 * { row: undefined } when it is on but no single row matches (never guesses).
 */
export async function findSheetRowForLead(
  businessAccountId: string,
  extracted: Record<string, any>,
): Promise<{ row: CrmStoreCredential | undefined; label: string } | null> {
  if (!(await isSheetEnabled(businessAccountId))) return null;
  const flow = await getActiveFlow(businessAccountId);
  if (!flow) return null;
  const steps = await db.select().from(whatsappFlowSteps).where(eq(whatsappFlowSteps.flowId, flow.id));
  const field: Partial<Record<SheetLevel, string>> = {};
  for (const s of steps) { const l = levelOf(s); if (l && s.saveToField) field[l] = s.saveToField; }
  if (!field.store) return null;

  const want = {
    dealer: field.dealer ? normKey(extracted[field.dealer]) : null,
    city: field.city ? normKey(extracted[field.city]) : null,
    store: normKey(extracted[field.store]),
  };
  const label = [extracted[field.dealer!], extracted[field.city!], extracted[field.store]].filter(Boolean).join(' / ');
  if (!want.store) return { row: undefined, label };
  const matches = (await loadCredentials(businessAccountId)).filter(c => {
    const r = toSheetRow(c);
    return c.isActive && normKey(r.store) === want.store
      && (want.dealer === null || normKey(r.dealer) === want.dealer)
      && (want.city === null || normKey(r.city) === want.city);
  });
  return { row: matches.length === 1 ? matches[0] : undefined, label };
}

// ── Excel import ──────────────────────────────────────────────────────────────

const cell = (raw: Record<string, unknown>, col: string) => {
  const k = Object.keys(raw).find(h => normKey(h) === normKey(col));
  return k === undefined ? undefined : raw[k];
};
const text = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

interface PlannedImport {
  added: { rowNumber: number; input: StoreSheetRowInput }[];
  changed: { rowNumber: number; id: string; input: StoreSheetRowInput; fields: string[] }[];
  unchangedCount: number;
  removed: CrmStoreCredential[];
  errors: { rowNumber: number; message: string }[];
}

async function planImport(businessAccountId: string, rows: Record<string, unknown>[], removeMissing: boolean): Promise<PlannedImport> {
  if (!Array.isArray(rows)) throw new SheetError('No rows in the file');
  if (rows.length > 5000) throw new SheetError('The file has more than 5,000 rows');
  const existing = await loadCredentials(businessAccountId);
  const byKey = new Map(existing.map(c => [rowKey(toSheetRow(c)), c]));
  const plan: PlannedImport = { added: [], changed: [], unchangedCount: 0, removed: [], errors: [] };
  const seen = new Set<string>();

  rows.forEach((raw, i) => {
    const rowNumber = i + 2; // row 1 is the header
    const dealer = text(cell(raw, 'Dealer')), city = text(cell(raw, 'City')), store = text(cell(raw, 'Store'));
    if (!dealer && !city && !store && !text(cell(raw, 'SID'))) return; // blank line
    try {
      if (!dealer || !city || !store) throw new Error('Dealer, City and Store are required');
      const input: StoreSheetRowInput = {
        dealer, city, store,
        // A column missing from the file keeps the current values; a blank EMI cell clears the list.
        emiSchemes: cell(raw, 'EMI Schemes') === undefined ? undefined : parseEmiSchemes(cell(raw, 'EMI Schemes')),
        // Blank LOS / SID / Secret cells keep what the sheet already has.
        losDealerName: text(cell(raw, 'LOS Dealer Name')) || undefined,
        losStoreName: text(cell(raw, 'LOS Store Name')) || undefined,
        losStoreId: text(cell(raw, 'LOS Store ID')) || undefined,
        sid: text(cell(raw, 'SID')) || undefined,
        secret: text(cell(raw, 'Secret')) || undefined,
        isActive: text(cell(raw, 'Active')) ? parseActive(cell(raw, 'Active')) : undefined,
        inJourney: text(cell(raw, 'Show in Journey')) ? parseActive(cell(raw, 'Show in Journey')) : undefined,
      };
      parseStoreId(input.losStoreId);
      const key = rowKey(input);
      if (seen.has(key)) throw new Error(`"${store}" (${dealer}, ${city}) appears more than once in the file`);
      seen.add(key);
      const current = byKey.get(key);
      if (!current) { plan.added.push({ rowNumber, input }); return; }
      const r = toSheetRow(current);
      const fields: string[] = [];
      if (input.emiSchemes !== undefined && JSON.stringify(r.emiSchemes) !== JSON.stringify(input.emiSchemes)) fields.push('EMI Schemes');
      if (input.losDealerName && input.losDealerName !== r.losDealerName) fields.push('LOS Dealer Name');
      if (input.losStoreName && input.losStoreName !== r.losStoreName) fields.push('LOS Store Name');
      if (input.losStoreId !== undefined && parseStoreId(input.losStoreId) !== r.losStoreId) fields.push('LOS Store ID');
      if (input.sid !== undefined && input.sid !== r.sid) fields.push('SID');
      if (input.secret) fields.push('Secret');
      if (input.isActive !== undefined && input.isActive !== r.isActive) fields.push('Active');
      if (input.inJourney !== undefined && input.inJourney !== r.inJourney) fields.push('Show in Journey');
      // Letter case in names counts as a change too, so the sheet matches the file.
      if (r.dealer !== dealer || r.city !== city || r.store !== store) fields.push('Names');
      if (fields.length) plan.changed.push({ rowNumber, id: current.id, input, fields });
      else plan.unchangedCount++;
    } catch (err: any) {
      plan.errors.push({ rowNumber, message: err?.message || 'Invalid row' });
    }
  });
  if (removeMissing) plan.removed = existing.filter(c => !seen.has(rowKey(toSheetRow(c))));
  return plan;
}

const brief = (r: { dealer: string; city: string; store: string }) => ({ dealer: r.dealer, city: r.city, store: r.store });

export async function previewImport(businessAccountId: string, rows: Record<string, unknown>[], removeMissing: boolean) {
  const plan = await planImport(businessAccountId, rows, removeMissing);
  return {
    added: plan.added.map(a => ({ rowNumber: a.rowNumber, ...brief(a.input) })),
    changed: plan.changed.map(c => ({ rowNumber: c.rowNumber, id: c.id, ...brief(c.input), fields: c.fields })),
    unchangedCount: plan.unchangedCount,
    removed: plan.removed.map(c => ({ id: c.id, ...brief(toSheetRow(c)) })),
    errors: plan.errors,
  };
}

export async function applyImport(businessAccountId: string, rows: Record<string, unknown>[], removeMissing: boolean) {
  const plan = await planImport(businessAccountId, rows, removeMissing);
  if (plan.errors.length) throw new SheetError(`The file has ${plan.errors.length} row(s) with errors — fix them and upload again`);
  await db.transaction(async (tx) => {
    for (const a of plan.added) {
      const { values } = toDbValues(a.input);
      await tx.insert(crmStoreCredentials).values({ ...values, businessAccountId } as any);
    }
    for (const c of plan.changed) {
      const [existing] = await tx.select().from(crmStoreCredentials).where(eq(crmStoreCredentials.id, c.id)).limit(1);
      const { values } = toDbValues(c.input, existing);
      await tx.update(crmStoreCredentials).set(values).where(and(eq(crmStoreCredentials.id, c.id), eq(crmStoreCredentials.businessAccountId, businessAccountId)));
    }
    if (plan.removed.length) {
      await tx.delete(crmStoreCredentials).where(and(
        eq(crmStoreCredentials.businessAccountId, businessAccountId),
        inArray(crmStoreCredentials.id, plan.removed.map(r => r.id)),
      ));
    }
  });
  forgetSheetSnapshot(businessAccountId);
  return { added: plan.added.length, changed: plan.changed.length, removed: plan.removed.length };
}

// ── One-time: build the sheet from the journey's hand-made lists ─────────────

interface SeedRow {
  dealer: string; city: string; store: string; emiSchemes: EmiScheme[];
  matchedCredentialId: string | null; losStoreName: string | null; notes: string[];
}

const words = (s: string) => normKey(s).replace(/[^a-z0-9]+/g, ' ').trim();
const containsWords = (hay: string, needle: string) => {
  const h = ` ${words(hay)} `, n = words(needle);
  return !!n && h.includes(` ${n} `);
};
// "Design café" ≈ "Design Cafe"
const fold = (s: string) => words(s.normalize('NFD').replace(/[̀-ͯ]/g, ''));

function credentialBelongsToDealer(c: CrmStoreCredential, dealer: string): boolean {
  const d = fold(dealer);
  if (!d) return false;
  const names = [c.displayDealerName || '', c.dealerName, c.storeName].map(fold);
  const first = d.split(' ')[0];
  return names.some(n => n === d || n.startsWith(`${d} `) || n.includes(` ${d} `) || (first.length >= 4 && n.split(' ').includes(first)));
}

export async function planSeedFromJourney(businessAccountId: string) {
  const flow = await getActiveFlow(businessAccountId);
  if (!flow) throw new SheetError('No active WhatsApp journey');
  const steps = await db.select().from(whatsappFlowSteps).where(eq(whatsappFlowSteps.flowId, flow.id)).orderBy(asc(whatsappFlowSteps.stepOrder));
  const pick = (level: SheetLevel) =>
    steps.find(s => s.type === 'dropdown' && levelOf(s) === level) ||
    steps.find(s => s.type === 'dropdown' && !levelOf(s) && suggestSheetLevel(s.saveToField) === level);
  const storeStep = pick('store'), emiStep = pick('emi'), dealerStep = pick('dealer'), cityStep = pick('city');
  const storeOpts = (storeStep?.options as any) || {};
  if (!storeStep || !storeOpts.conditionalOptions) throw new SheetError('Could not find the journey\'s store dropdown (it should depend on dealer and city)');
  const parentFields: string[] = storeOpts.dependsOnFields || (storeOpts.dependsOnField ? [storeOpts.dependsOnField] : []);
  const dealerIdx = parentFields.indexOf(dealerStep?.saveToField || 'dealer_name');
  const cityIdx = parentFields.indexOf(cityStep?.saveToField || 'dealer_city');
  const emiLists: Record<string, any[]> = (emiStep?.options as any)?.conditionalOptions || {};

  const creds = await loadCredentials(businessAccountId);
  const existingKeys = new Set(creds.filter(c => c.displayStoreName).map(c => rowKey(toSheetRow(c))));
  const out: SeedRow[] = [];
  const claimed = new Set<string>();
  // Store names used by more than one dealer: a list keyed by store name alone was shared.
  const dealersByStore = new Map<string, Set<string>>();
  for (const [key, items] of Object.entries(storeOpts.conditionalOptions as Record<string, any[]>)) {
    const dealer = normKey(key.split('|')[dealerIdx >= 0 ? dealerIdx : 0]);
    for (const it of items || []) {
      const st = normKey(it.value || it.title);
      dealersByStore.set(st, (dealersByStore.get(st) || new Set()).add(dealer));
    }
  }

  for (const [key, items] of Object.entries(storeOpts.conditionalOptions as Record<string, any[]>)) {
    const parts = key.split('|');
    const dealer = (dealerIdx >= 0 ? parts[dealerIdx] : parts[0] || '').trim();
    const city = (cityIdx >= 0 ? parts[cityIdx] : parts[1] || '').trim();
    for (const it of items || []) {
      const store = String(it.value || it.title || '').trim();
      if (!store) continue;
      const notes: string[] = [];

      // EMI schemes: prefer a list made for this dealer ("Thane Design café"), then the store's list.
      const dealerSpecific = Object.keys(emiLists).find(k => {
        const kw = fold(k), sw = fold(store);
        return kw.startsWith(`${sw} `) && credentialLikeDealerMatch(kw.slice(sw.length + 1), dealer);
      });
      const exactKey = [ [dealer, city, store].join('|'), [dealer, store].join('|'), store ].find(k => Object.keys(emiLists).some(e => normKey(e) === normKey(k)));
      const listKey = dealerSpecific || (exactKey ? Object.keys(emiLists).find(e => normKey(e) === normKey(exactKey)) : undefined);
      let emiSchemes: EmiScheme[] = (listKey ? emiLists[listKey] : []).map((x: any) => ({ label: String(x.title || '').trim(), schemeId: String(x.value || x.id || '').trim() }));
      if (!listKey) notes.push('No EMI list found — add EMI schemes');
      else if (!dealerSpecific && (dealersByStore.get(normKey(store))?.size || 0) > 1) {
        notes.push(`The old EMI list for "${store}" was shared by more than one dealer — please check the scheme IDs`);
      }
      const labels = emiSchemes.map(s => s.label.toLowerCase());
      if (new Set(labels).size !== labels.length) {
        notes.push('The old EMI list mixes schemes of more than one dealer — please check the scheme IDs');
        const firstOf = new Map<string, EmiScheme>();
        for (const s of emiSchemes) if (!firstOf.has(s.label.toLowerCase())) firstOf.set(s.label.toLowerCase(), s);
        emiSchemes = Array.from(firstOf.values());
      }

      // LOS store record: same dealer, store name contains this store (prefer one naming the city).
      const candidates = creds.filter(c => !claimed.has(c.id) && credentialBelongsToDealer(c, dealer) &&
        (containsWords(c.displayStoreName || c.storeName, store) || fold(c.displayStoreName || c.storeName) === fold(store)));
      let match = candidates.length === 1 ? candidates[0] : undefined;
      if (!match && candidates.length > 1) {
        const exact = candidates.filter(c => fold(c.displayStoreName || c.storeName) === fold(store));
        if (exact.length === 1) match = exact[0];
      }
      if (!match && candidates.length > 1) {
        const withCity = candidates.filter(c => containsWords(c.storeName, city) || normKey(c.city) === normKey(city));
        if (withCity.length === 1) match = withCity[0];
        else notes.push(`Several LOS stores could match (${candidates.slice(0, 3).map(c => c.storeName).join(', ')}) — pick SID/secret manually`);
      }
      if (!match && candidates.length === 0) notes.push('No LOS store record found — add SID and secret');
      if (match) claimed.add(match.id);

      if (existingKeys.has(rowKey({ dealer, city, store }))) continue;
      out.push({ dealer, city, store, emiSchemes, matchedCredentialId: match?.id ?? null, losStoreName: match?.storeName ?? null, notes });
    }
  }
  return { rows: out, unmatchedCount: out.filter(r => !r.matchedCredentialId).length, alreadyInSheet: existingKeys.size };
}

// "design cafe" / "homelane" / "durg" … : does the suffix of an EMI list name refer to this dealer?
function credentialLikeDealerMatch(suffix: string, dealer: string): boolean {
  const s = fold(suffix), d = fold(dealer);
  return !!s && (s === d || d.startsWith(s) || s.startsWith(d) || s.split(' ')[0] === d.split(' ')[0]);
}

export async function applySeedFromJourney(businessAccountId: string) {
  const plan = await planSeedFromJourney(businessAccountId);
  let created = 0, updated = 0;
  await db.transaction(async (tx) => {
    for (const r of plan.rows) {
      if (r.matchedCredentialId) {
        await tx.update(crmStoreCredentials).set({
          displayDealerName: r.dealer, displayStoreName: r.store, city: r.city, emiSchemes: r.emiSchemes, showInJourney: true, updatedAt: new Date(),
        } as any).where(and(eq(crmStoreCredentials.id, r.matchedCredentialId), eq(crmStoreCredentials.businessAccountId, businessAccountId)));
        updated++;
      } else {
        await tx.insert(crmStoreCredentials).values({
          businessAccountId, dealerName: r.dealer, storeName: r.store, displayDealerName: r.dealer, displayStoreName: r.store,
          city: r.city, emiSchemes: r.emiSchemes, sid: '', secret: '', isActive: true, showInJourney: true,
        } as any);
        created++;
      }
    }
    // LOS records that aren't part of the journey (e.g. dealers only used for website leads)
    // stay in the sheet but are not offered on WhatsApp.
    const linkedIds = new Set(plan.rows.map(r => r.matchedCredentialId).filter(Boolean) as string[]);
    const creds = await tx.select().from(crmStoreCredentials).where(eq(crmStoreCredentials.businessAccountId, businessAccountId));
    const notInJourney = creds.filter(c => !c.displayStoreName && !linkedIds.has(c.id)).map(c => c.id);
    if (notInJourney.length) {
      await tx.update(crmStoreCredentials).set({ showInJourney: false } as any)
        .where(and(eq(crmStoreCredentials.businessAccountId, businessAccountId), inArray(crmStoreCredentials.id, notInJourney)));
    }
  });
  forgetSheetSnapshot(businessAccountId);
  return { created, updated };
}
