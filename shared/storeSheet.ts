/**
 * Dealers & Stores sheet — one row per store, used for the WhatsApp journey's
 * Dealer → City → Store → EMI scheme dropdowns and for the CRM/LOS store credentials.
 *
 * Stored in crm_store_credentials:
 *   dealer / store        → display_dealer_name / display_store_name (what customers see;
 *                           default to the LOS names)
 *   losDealerName / losStoreName → dealer_name / store_name (as registered in the LOS)
 *   emiSchemes            → emi_schemes jsonb [{ label: "6/1", schemeId: "32" }]
 *   inJourney             → show_in_journey (off: LOS only, not offered on WhatsApp)
 */

export type SheetLevel = 'dealer' | 'city' | 'store' | 'emi';
export const SHEET_LEVELS: SheetLevel[] = ['dealer', 'city', 'store', 'emi'];

export interface EmiScheme {
  label: string;     // shown to the customer, e.g. "6/1"
  schemeId: string;  // sent to the LOS, e.g. "32"
}

export interface StoreSheetRow {
  id: string;
  dealer: string;
  city: string;
  store: string;
  emiSchemes: EmiScheme[];
  losDealerName: string;
  losStoreName: string;
  losStoreId: number | null;
  sid: string;
  hasSecret: boolean;
  /** Off = not used anywhere (journey or LOS). */
  isActive: boolean;
  /** Off = kept for the LOS (e.g. website leads) but not offered in the WhatsApp journey. */
  inJourney: boolean;
  /** Problems to fix, e.g. "No SID", "No EMI schemes". */
  issues: string[];
}

export interface StoreSheetRowInput {
  dealer: string;
  city: string;
  store: string;
  emiSchemes?: EmiScheme[];
  losDealerName?: string | null;
  losStoreName?: string | null;
  losStoreId?: number | string | null;
  sid?: string | null;
  /** Set to change the secret; omit or leave blank to keep the current one. */
  secret?: string | null;
  isActive?: boolean;
  inJourney?: boolean;
}

/** Excel template columns, in order. */
export const SHEET_COLUMNS = [
  'Dealer', 'City', 'Store', 'EMI Schemes', 'LOS Dealer Name', 'LOS Store Name', 'LOS Store ID', 'SID', 'Secret', 'Active', 'Show in Journey',
] as const;
export type SheetColumn = typeof SHEET_COLUMNS[number];

export const EMI_FORMAT_HINT = 'label=scheme ID, separated by ";" — e.g. 6/1=32; 12/1=34; 18/1=35';

/** "6/1=32; 12/1=34" → [{label:"6/1", schemeId:"32"}, …]. Throws with a readable message on bad input. */
export function parseEmiSchemes(text: unknown): EmiScheme[] {
  if (text === null || text === undefined) return [];
  const raw = String(text).trim();
  if (!raw) return [];
  const out: EmiScheme[] = [];
  for (const part of raw.split(/[;\n]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(.+)=\s*([^=\s]+)$/);
    if (!m) throw new Error(`EMI scheme "${p}" should look like 6/1=32`);
    out.push({ label: m[1].trim(), schemeId: m[2].trim() });
  }
  const labels = new Set<string>();
  for (const s of out) {
    const k = s.label.toLowerCase();
    if (labels.has(k)) throw new Error(`EMI scheme "${s.label}" is listed twice`);
    labels.add(k);
  }
  return out;
}

export function formatEmiSchemes(schemes: EmiScheme[] | null | undefined): string {
  return (schemes || []).map(s => `${s.label}=${s.schemeId}`).join('; ');
}

export const normKey = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Identity of a store in the sheet (unique per account). */
export function rowKey(r: { dealer: string; city: string; store: string }): string {
  return `${normKey(r.dealer)}|${normKey(r.city)}|${normKey(r.store)}`;
}

export function parseActive(v: unknown): boolean {
  if (v === undefined || v === null || String(v).trim() === '') return true;
  return !/^(no|n|false|0|inactive|off)$/i.test(String(v).trim());
}

/** Suggests which journey step is which sheet level from its "save to" field. */
export function suggestSheetLevel(saveToField: string | null | undefined): SheetLevel | null {
  const f = normKey(saveToField).replace(/[^a-z]/g, '_');
  if (!f) return null;
  if (/(scheme|emi|tenure)/.test(f)) return 'emi';
  if (/store|branch|outlet|showroom/.test(f)) return 'store';
  if (/city|location/.test(f)) return 'city';
  if (/dealer|merchant|partner|brand/.test(f)) return 'dealer';
  return null;
}
