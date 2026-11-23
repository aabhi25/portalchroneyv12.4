/**
 * Dealers & Stores: the LOS upload layout — one row per store and EMI scheme, as the LOS
 * exports it, plus City. Rows of one Store_Id become one store in the sheet (shared/storeSheet.ts).
 * Used by the template, the export and the upload preview (server/services/storeSheetLosImport.ts).
 */
import { normKey, parseActive, type EmiScheme } from "./storeSheet";
import { WA_LIMITS, waLength } from "./whatsappLimits";

/** Template columns, in order. */
export const LOS_COLUMNS = ["Dealer_name", "City", "Store_Id", "SID", "Store_Name", "Secret", "Scheme_ID", "EMI_Scheme"] as const;
export type LosColumn = typeof LOS_COLUMNS[number];

export const LOS_COLUMN_HELP: Record<LosColumn, string> = {
  Dealer_name: "Dealer exactly as registered in the LOS. Customers see a short name (up to 24 characters), checked once when you upload.",
  City: "City the customer picks after the dealer. Required. Use “Online” for courses.",
  Store_Id: "Store ID from the LOS. Required: rows with the same Store_Id are one store.",
  SID: "Store SID from the LOS. A store without it is kept out of the WhatsApp journey.",
  Store_Name: "Store exactly as registered in the LOS. Customers see a short name, checked when you upload.",
  Secret: "Store secret from the LOS. Leave blank to keep the one already saved.",
  Scheme_ID: "EMI scheme ID, sent to the LOS.",
  EMI_Scheme: "EMI scheme as customers see it, e.g. 6/1@4%.",
};

/** Limits of a WhatsApp list option (dealer, city, store and scheme names). */
export const SHORT_NAME_LIMIT = WA_LIMITS.rowTitle;

const header = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A file in this layout (City and extra columns may be there or not). */
export function isLosLayout(headers: string[]): boolean {
  const h = new Set(headers.map(header));
  return ["dealername", "storename", "storeid", "schemeid", "emischeme"].every(c => h.has(c));
}

/** Only the columns the upload reads, under their template names (Dealer_id and others stay behind). */
export function pickLosColumns(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const wanted = new Map([...LOS_COLUMNS, "Active"].map(c => [header(c), c as string]));
  return rows.map(raw => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const col = wanted.get(header(k));
      if (col) out[col] = v;
    }
    return out;
  });
}

/** Trimmed text; the LOS export writes an empty value as the word NULL. */
export function losText(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v).trim().replace(/\s+/g, " ");
  return /^null$/i.test(s) ? "" : s;
}
/** IDs as plain digits: Excel sometimes shows 1037 as "1,037". */
const losId = (v: unknown) => losText(v).replace(/(\d),(?=\d)/g, "$1");

export const letters = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export interface LosStore {
  /** Store_Id as text; identifies the store within the file. */
  key: string;
  storeId: number;
  rowNumber: number;
  losDealer: string;
  losStore: string;
  city: string;
  sid: string;
  secret: string;
  /** Shortest first. Empty = the file says nothing about schemes. */
  schemes: EmiScheme[];
}

export interface LosHeld { key: string; rowNumber: number; dealer: string; store: string; reason: string }

export interface LosFile {
  stores: LosStore[];
  held: LosHeld[];
  rowCount: number;
  /** Exact repeats that were counted once. */
  repeatedRows: number;
  inactiveStores: { key: string; dealer: string; store: string }[];
  inactiveRows: number;
}

const months = (label: string) => label.split(/[^0-9.]+/).filter(Boolean).map(Number);
export function bySchemeLength(a: EmiScheme, b: EmiScheme): number {
  const x = months(a.label), y = months(b.label);
  return (x[0] ?? 0) - (y[0] ?? 0) || (x[1] ?? 0) - (y[1] ?? 0) || a.label.localeCompare(b.label);
}

/** The same schemes, in whatever order. */
export const sameSchemes = (a: EmiScheme[], b: EmiScheme[]) =>
  a.length === b.length && a.every(x => b.some(y => y.schemeId === x.schemeId && y.label === x.label));

/** Rows of the file → one entry per Store_Id, with the ones that contradict themselves held back. */
export function groupLosRows(rows: Record<string, unknown>[]): LosFile {
  interface Group { key: string; rows: { n: number; r: Record<string, string> }[] }
  const groups = new Map<string, Group>();
  const out: LosFile = { stores: [], held: [], rowCount: 0, repeatedRows: 0, inactiveStores: [], inactiveRows: 0 };
  const inactive = new Map<string, { key: string; dealer: string; store: string }>();
  const seenRows = new Set<string>();

  rows.forEach((raw, i) => {
    const n = i + 2; // row 1 is the header
    const r: Record<string, string> = {};
    for (const c of LOS_COLUMNS) r[c] = c === "Store_Id" || c === "Scheme_ID" ? losId(raw[c]) : losText(raw[c]);
    if (LOS_COLUMNS.every(c => !r[c])) return;
    out.rowCount++;
    if (!parseActive(losText(raw.Active))) {
      out.inactiveRows++;
      if (r.Store_Id) inactive.set(r.Store_Id, { key: r.Store_Id, dealer: r.Dealer_name, store: r.Store_Name });
      return;
    }
    const same = JSON.stringify(LOS_COLUMNS.map(c => r[c]));
    if (seenRows.has(same)) { out.repeatedRows++; return; }
    seenRows.add(same);
    const key = r.Store_Id || `none|${normKey(r.Dealer_name)}|${normKey(r.City)}|${normKey(r.Store_Name)}`;
    const g = groups.get(key) || { key, rows: [] };
    g.rows.push({ n, r });
    groups.set(key, g);
  });

  for (const g of Array.from(groups.values())) {
    const first = g.rows[0];
    const values = (c: LosColumn) => {
      const seen = new Map<string, string>();
      for (const { r } of g.rows) if (r[c]) { const k = c === "City" ? normKey(r[c]) : r[c]; if (!seen.has(k)) seen.set(k, r[c]); }
      return Array.from(seen.values());
    };
    const hold = (reason: string) => out.held.push({ key: g.key, rowNumber: first.n, dealer: values("Dealer_name")[0] || "", store: values("Store_Name")[0] || "", reason });
    if (!first.r.Store_Id) { hold("Store_Id is missing"); continue; }
    if (!/^\d{1,9}$/.test(first.r.Store_Id)) { hold(`Store_Id "${first.r.Store_Id}" must be a whole number`); continue; }
    if (!values("Dealer_name").length) { hold("Dealer_name is missing"); continue; }
    if (!values("Store_Name").length) { hold("Store_Name is missing"); continue; }
    const differing = (["Dealer_name", "Store_Name", "City", "SID", "Secret"] as LosColumn[]).filter(c => values(c).length > 1);
    if (differing.length) { hold(`Its rows have different values for ${differing.join(", ")}`); continue; }
    const half = g.rows.find(({ r }) => !r.Scheme_ID !== !r.EMI_Scheme);
    if (half) { hold(`${half.r.Scheme_ID ? "EMI_Scheme" : "Scheme_ID"} is missing in row ${half.n}`); continue; }

    const byId = new Map<string, string>(), byLabel = new Map<string, string>();
    let clash = "";
    for (const { r } of g.rows) {
      if (!r.Scheme_ID) continue;
      const label = r.EMI_Scheme, id = r.Scheme_ID;
      if (byId.has(id) && byId.get(id) !== label) clash = `Scheme_ID ${id} has two names: ${byId.get(id)} and ${label}`;
      const other = byLabel.get(label.toLowerCase());
      if (other !== undefined && other !== id) clash = `EMI scheme ${label} has two IDs: ${other} and ${id}`;
      byId.set(id, label);
      byLabel.set(label.toLowerCase(), id);
    }
    if (clash) { hold(clash); continue; }
    out.stores.push({
      key: g.key, storeId: Number(first.r.Store_Id), rowNumber: first.n,
      losDealer: values("Dealer_name")[0], losStore: values("Store_Name")[0], city: values("City")[0] || "",
      sid: values("SID")[0] || "", secret: values("Secret")[0] || "",
      schemes: Array.from(byId, ([schemeId, label]) => ({ label, schemeId })).sort(bySchemeLength),
    });
  }

  // One SID on two stores could send leads to the wrong one.
  const bySid = new Map<string, LosStore[]>();
  for (const s of out.stores) if (s.sid) bySid.set(normKey(s.sid), [...(bySid.get(normKey(s.sid)) || []), s]);
  for (const list of Array.from(bySid.values())) {
    if (list.length < 2) continue;
    for (const s of list) out.held.push({ key: s.key, rowNumber: s.rowNumber, dealer: s.losDealer, store: s.losStore, reason: `SID ${s.sid} is also on Store_Id ${list.filter(x => x !== s).map(x => x.storeId).join(", ")}` });
    out.stores = out.stores.filter(s => !list.includes(s));
  }
  const kept = new Set([...out.stores.map(s => s.key), ...out.held.map(h => h.key)]);
  out.inactiveStores = Array.from(inactive.values()).filter(s => !kept.has(s.key));
  return out;
}

/** Downloads from the LOS's reporting tool stop at a round number of rows. */
export const looksCutOff = (rowCount: number) => rowCount === 2000 || (rowCount > 0 && rowCount % 10000 === 0);

// ── Short names for WhatsApp ─────────────────────────────────────────────────

const LEGAL = /[\s,]*\b(private limited|pvt\.?\s*ltd\.?|limited|ltd\.?|llp|inc\.?|india)\s*$/i;
const GENERIC = /[\s,]*\b(and|&|software|solutions?|services?|technolog(?:y|ies)|sciences?|events?|enterprises?|lifestyles?|decor|furnishings?|ventures?|industries)\s*$/i;

const SHORT_WORDS = new Set(["road", "city", "mall", "east", "west", "and", "of", "new", "old", "east", "park", "hill", "fort", "main"]);
/** Capitals made readable; words up to `acronym` letters (IIT, HRBR, PGDM) are left as they are. */
export function titleCase(s: string, acronym = 4): string {
  if (/[a-z]/.test(s)) return s;
  return s.replace(/[A-Z]+/g, w => w.length <= acronym && !SHORT_WORDS.has(w.toLowerCase()) ? w : w[0] + w.slice(1).toLowerCase());
}

function cutAtWord(s: string, limit: number): string {
  if (waLength(s) <= limit) return s;
  const cut = s.slice(0, limit + 1).replace(/\s+\S*$/, "").trim();
  return cut && cut.length <= limit ? cut : s.slice(0, limit).trim();
}

/** "GREAT LEARNING EDUCATION SERVICES PRIVATE LIMITED" → "Great Learning". */
export function suggestDealerName(losDealer: string): string {
  let s = losDealer.trim();
  for (let prev = ""; prev !== s;) { prev = s; s = s.replace(LEGAL, "").trim() || s; }
  for (let prev = ""; prev !== s;) { prev = s; s = s.replace(GENERIC, "").trim() || s; }
  if (s.split(/\s+/).length > 2) s = s.replace(/\s+education$/i, "");
  return cutAtWord(titleCase(s, 3), SHORT_NAME_LIMIT);
}

const ALIASES: Record<string, string> = {
  bangalore: "Bengaluru", hyd: "Hyderabad", gurgaon: "Gurugram", gurgoan: "Gurugram", bombay: "Mumbai", calcutta: "Kolkata",
  madras: "Chennai", vizag: "Visakhapatnam", mysore: "Mysuru", bhubaneshwar: "Bhubaneswar", trivandrum: "Thiruvananthapuram",
};
const CITIES = [
  "Agra", "Ahmedabad", "Amritsar", "Aurangabad", "Bengaluru", "Bhopal", "Bhubaneswar", "Chandigarh", "Chennai", "Coimbatore", "Dehradun", "Delhi",
  "Faridabad", "Gandhinagar", "Ghaziabad", "Goa", "Gurugram", "Guwahati", "Hyderabad", "Indore", "Jaipur", "Jalandhar", "Jammu", "Kanpur", "Kochi",
  "Kolkata", "Kozhikode", "Lucknow", "Ludhiana", "Madurai", "Mangaluru", "Mohali", "Mumbai", "Mysuru", "Nagpur", "Nashik", "Navi Mumbai", "Noida",
  "Panchkula", "Patna", "Pune", "Raipur", "Rajkot", "Ranchi", "Salem", "Surat", "Thiruvananthapuram", "Tiruppur", "Trichy", "Udaipur", "Vadodara",
  "Varanasi", "Vijayawada", "Visakhapatnam",
];

const COURSE = /(\b|_)(iims?|iimc|iit|iitm|iisc|aiims|programmes?|certificate|diploma|batch|course|degree)(\b|_)/i;

/** One city under its different spellings ("Bangalore", "Bengaluru"). */
export const cityKey = (city: string) => normKey(ALIASES[normKey(city)] || city);

/**
 * City named in a store name, preferring the last one: "Homelane-HSR - Bengaluru" → Bengaluru. "" when unsure.
 * `dealerCities` are the dealer's own; other dealers use areas as cities ("Jayanagar"), so `spellings` only says how a city is written.
 */
export function suggestCity(storeName: string, dealerCities: string[], spellings: string[] = dealerCities): string {
  if (COURSE.test(storeName)) return ""; // "IIM Calcutta … Programme" is not in Kolkata
  const name = ` ${storeName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const spelling = new Map<string, string>();
  for (const c of CITIES) spelling.set(normKey(c), c);
  for (const [alias, c] of Object.entries(ALIASES)) spelling.set(alias, c);
  for (const c of dealerCities) if (normKey(c).length >= 4) spelling.set(normKey(c), c);
  let best = "", at = -1;
  for (const [k, c] of Array.from(spelling)) {
    const i = name.lastIndexOf(` ${k} `);
    if (i > at || (i >= 0 && i === at && k.length > best.length)) { at = i; best = c; }
  }
  if (at >= 0) return known(best, spellings);
  // "Cloudnine JayanagarBengaluru"
  const glued = Array.from(spelling).find(([k]) => k.length >= 6 && name.trim().endsWith(k));
  return glued ? known(glued[1], spellings) : "";
}
/** The account's own spelling of a city. */
const known = (city: string, spellings: string[]) =>
  spellings.find(c => normKey(c) === normKey(city)) || spellings.find(c => cityKey(c) === cityKey(city)) || city;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const trimEdges = (s: string) => s.replace(/^[\s\-–_,.&]+|[\s\-–_,.&]+$/g, "").replace(/\s+/g, " ");
const enough = (s: string) => letters(s).replace(/[0-9]/g, "").length >= 3;

/** "Homelane-Whitefield - Bengaluru" → "Whitefield": the dealer and the city were already picked. */
export function suggestStoreName(losStore: string, dealerNames: string[], city: string): string {
  if (dealerNames.some(d => letters(d) === letters(losStore))) return dealerNames[0]; // its only store, named after the dealer
  let s = trimEdges(losStore.replace(/_/g, " "));
  const brand = (b: string) => new RegExp(`(^|[^a-z0-9])${b.trim().split(/\s+/).map(escape).join("[\\s-]*")}(?=[^a-z0-9]|$)`, "ig");
  const full = dealerNames.find(d => brand(d).test(s));
  const brands = full ? [full] : Array.from(new Set(dealerNames.map(d => d.trim().split(/\s+/)[0]))).filter(w => w.length >= 5);
  for (const b of brands) {
    const without = trimEdges(s.replace(brand(b), "$1"));
    if (enough(without)) s = without;
  }
  const spellings = city ? [city, ...Object.keys(ALIASES).filter(a => cityKey(a) === cityKey(city)), ...CITIES.filter(c => cityKey(c) === cityKey(city))] : [];
  let named = false;
  for (const c of spellings) {
    const e = escape(c), long = waLength(s) > SHORT_NAME_LIMIT;
    const tail = trimEdges(s.replace(new RegExp(long ? `[\\s\\-–,]+${e}$` : `\\s*[\\-–,]\\s*${e}$`, "i"), ""));
    const glued = c.length >= 6 ? trimEdges(s.replace(new RegExp(`([a-z])${e}$`, "i"), "$1")) : s;
    if (tail !== s && enough(tail)) { s = tail; named = true; }
    else if (glued !== s && enough(glued)) { s = glued; named = true; }
  }
  for (const c of spellings) {
    const head = trimEdges(s.replace(new RegExp(`^${escape(c)}${named || waLength(s) > SHORT_NAME_LIMIT ? "[\\s\\-–,]+" : "\\s*[\\-–,]\\s*"}`, "i"), ""));
    if (head !== s && enough(head)) s = head;
  }
  return titleCase(s) || losStore;
}

/** Words of `small` that are all in `big`; how a hand-typed store name is matched to its LOS name. */
export function wordsInside(small: string, big: string): boolean {
  const w = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const b = new Set(w(big)), a = w(small);
  return a.length > 0 && a.every(x => b.has(x));
}

// ── Preview and save ─────────────────────────────────────────────────────────

/** What the person settled in the preview, by Store_Id (stores) or LOS dealer (dealers). */
export interface LosChoices {
  cities?: Record<string, string>;
  storeNames?: Record<string, string>;
  dealerNames?: Record<string, string>;
  /** Dealers whose stores already in the app also take the chosen name. */
  renameDealers?: string[];
  /** Dealers whose changed scheme IDs come from the file (otherwise those stores keep theirs). */
  useFileSchemes?: string[];
  /** Stores to leave out of the journey. */
  keepOff?: string[];
  /** Store in the app without Store_Id and SID → the Store_Id it is. */
  join?: Record<string, string>;
  /** Store_Id → id of the store in the app it replaces, or "different". */
  sameAs?: Record<string, string>;
  /** Repeated stores in the app to switch off. */
  switchOff?: string[];
}

export interface LosPreviewStore {
  key: string;
  rowNumber: number;
  losDealer: string;
  losStore: string;
  dealer: string;
  city: string;
  store: string;
  /** The short name can still be chosen (not a name customers already see). */
  nameIsNew: boolean;
  tooLong: boolean;
  action: "add" | "update" | "unchanged";
  fields: string[];
  schemes: EmiScheme[];
  schemesKept: boolean;
  wasInJourney: boolean;
  inJourney: boolean;
  /** What still keeps it out of the journey. */
  missing: string[];
  /** Complete, but off because someone switched it off (or left it out here). */
  leftOff: boolean;
  citySuggestion: string;
  cityNote: string;
}

export interface LosPreviewDealer {
  key: string;
  losDealer: string;
  stores: number;
  name: string;
  /** Names its stores in the app have now. */
  current: { name: string; count: number }[];
  suggested: boolean;
  problem: string;
  warning: string;
  /** Stores in the app that keep another name unless renamed. */
  differing: number;
  renamed: boolean;
  missingCity: number;
  schemeChanges: { key: string; store: string; now: EmiScheme[]; file: EmiScheme[] }[];
  useFileSchemes: boolean;
}

export interface LosPreview {
  stamp: string;
  rowCount: number;
  repeatedRows: number;
  cutOff: boolean;
  inactiveStores: { key: string; dealer: string; store: string }[];
  dealers: LosPreviewDealer[];
  stores: LosPreviewStore[];
  held: (LosHeld & { kind: "city" | "conflict" | "same" | "name"; citySuggestion?: string; sameAs?: { id: string; store: string }[] })[];
  unlinked: { id: string; dealer: string; city: string; store: string; suggestion: string; options: { key: string; store: string }[]; chosen: string }[];
  spares: { id: string; dealer: string; store: string; reason: string; chosen: boolean }[];
  notInFile: { id: string; dealer: string; city: string; store: string; inJourney: boolean }[];
  counts: { add: number; update: number; unchanged: number; held: number; intoJourney: number; joined: number; switchedOff: number };
  /** Reasons nothing can be saved yet. */
  blockers: string[];
}

export interface LosImportSummary { added: number; updated: number; unchanged: number; held: number; intoJourney: number; joined: number; switchedOff: number }

export interface LosLastImport { id: string; fileName: string; createdAt: string; createdByName: string | null; summary: LosImportSummary }
