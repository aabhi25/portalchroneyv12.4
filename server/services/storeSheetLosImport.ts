/**
 * Dealers & Stores: upload in the LOS layout (shared/storeSheetLos.ts) — preview, save, undo.
 *
 * A store is recognised by its SID, then its Store_Id, never by its name. Nothing is deleted by an
 * upload, blank cells never clear anything, and names customers already see stay. A store goes into
 * the WhatsApp journey once it has a city, EMI schemes, a SID and a secret.
 */
import crypto from "node:crypto";
import { db } from "../db";
import { crmStoreCredentials, storeSheetImports, type CrmStoreCredential } from "@shared/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { normKey, rowKey, type EmiScheme } from "@shared/storeSheet";
import {
  SHORT_NAME_LIMIT, cityKey, groupLosRows, letters, looksCutOff, losText, pickLosColumns, sameSchemes, suggestCity, suggestDealerName, suggestStoreName, wordsInside,
  type LosChoices, type LosImportSummary, type LosLastImport, type LosPreview, type LosPreviewDealer, type LosPreviewStore, type LosStore,
} from "@shared/storeSheetLos";
import { waLength } from "@shared/whatsappLimits";
import { encrypt, safeDecrypt } from "./encryptionService";
import { SheetError, forgetSheetSnapshot } from "./storeSheetService";

const MAX_ROWS = 50_000;
const KEPT_IMPORTS = 5;

type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

const shownDealer = (c: CrmStoreCredential) => (c.displayDealerName || c.dealerName || "").trim();
const shownStore = (c: CrmStoreCredential) => (c.displayStoreName || c.storeName || "").trim();
const sidOf = (c: CrmStoreCredential) => losText(c.sid);
const schemesOf = (c: CrmStoreCredential) => (Array.isArray(c.emiSchemes) ? c.emiSchemes : []) as EmiScheme[];
const hasSecret = (c: CrmStoreCredential) => !!c.secret?.trim();
const complete = (c: CrmStoreCredential) => !!(c.city?.trim() && schemesOf(c).length && sidOf(c) && hasSecret(c));
const keyOf = (c: CrmStoreCredential) => rowKey({ dealer: shownDealer(c), city: c.city || "", store: shownStore(c) });
const label = (c: CrmStoreCredential) => [shownDealer(c), c.city?.trim(), shownStore(c)].filter(Boolean).join(" · ");

async function loadRows(ex: Executor, businessAccountId: string): Promise<CrmStoreCredential[]> {
  return ex.select().from(crmStoreCredentials).where(eq(crmStoreCredentials.businessAccountId, businessAccountId));
}

/** Changes when any store of the account was added, edited or removed. */
const stampOf = (rows: CrmStoreCredential[]) => crypto.createHash("sha1")
  .update(rows.map(r => `${r.id}:${new Date(r.updatedAt).getTime()}`).sort().join("|")).digest("hex");

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const texts = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = Object.create(null);
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x.trim().replace(/\s+/g, " ");
  return out;
};
function readChoices(raw: unknown) {
  const c = (raw && typeof raw === "object" ? raw : {}) as LosChoices;
  return {
    cities: texts(c.cities), storeNames: texts(c.storeNames), dealerNames: texts(c.dealerNames), join: texts(c.join), sameAs: texts(c.sameAs),
    renameDealers: new Set(strings(c.renameDealers)), useFileSchemes: new Set(strings(c.useFileSchemes)),
    keepOff: new Set(strings(c.keepOff)), switchOff: new Set(strings(c.switchOff)),
  };
}

type RowValues = Partial<typeof crmStoreCredentials.$inferInsert>;
interface Plan {
  preview: LosPreview;
  adds: RowValues[];
  updates: { id: string; values: RowValues }[];
}

/** Everything the upload would do. `existing` = the account's stores now. */
function planFrom(existing: CrmStoreCredential[], rawRows: Record<string, unknown>[], rawChoices: unknown): Plan {
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw new SheetError("No rows in the file");
  if (rawRows.length > MAX_ROWS) throw new SheetError(`The file has more than ${MAX_ROWS.toLocaleString("en-IN")} rows`);
  const choices = readChoices(rawChoices);
  const file = groupLosRows(pickLosColumns(rawRows));
  const held: LosPreview["held"] = file.held.map(h => ({ ...h, kind: "conflict" as const }));
  const hold = (s: LosStore, kind: LosPreview["held"][number]["kind"], reason: string, extra: Partial<LosPreview["held"][number]> = {}) =>
    held.push({ key: s.key, rowNumber: s.rowNumber, dealer: s.losDealer, store: s.losStore, reason, kind, ...extra });

  const bySid = new Map<string, CrmStoreCredential[]>(), byStoreId = new Map<number, CrmStoreCredential[]>();
  for (const c of existing) {
    if (sidOf(c)) bySid.set(normKey(sidOf(c)), [...(bySid.get(normKey(sidOf(c))) || []), c]);
    if (c.storeId !== null) byStoreId.set(c.storeId, [...(byStoreId.get(c.storeId) || []), c]);
  }
  // Stores customers can pick that have neither a Store_Id nor a SID: the same store is often
  // also there under its LOS name.
  const loose = existing.filter(c => c.isActive && c.storeId === null && !sidOf(c));
  const knownCities = Array.from(new Set(existing.map(c => c.city?.trim()).filter((c): c is string => !!c)));

  // ── Which store in the app each one is ────────────────────────────────────
  const matched = new Map<LosStore, CrmStoreCredential | undefined>();
  const named = new Set<string>(); // stores in the app the file names by SID or Store_Id
  for (const s of file.stores) for (const c of [...(s.sid && bySid.get(normKey(s.sid)) || []), ...(byStoreId.get(s.storeId) || [])]) named.add(c.id);
  const spares: LosPreview["spares"] = [];
  for (const s of file.stores) {
    const sidHits = s.sid ? bySid.get(normKey(s.sid)) || [] : [];
    const idHits = byStoreId.get(s.storeId) || [];
    if (sidHits.length > 1) { hold(s, "conflict", `SID ${s.sid} is on ${sidHits.length} stores in the app`); continue; }
    const bySidRow = sidHits[0];
    if (bySidRow && bySidRow.storeId !== null && bySidRow.storeId !== s.storeId) {
      hold(s, "conflict", `In the app, SID ${s.sid} belongs to Store_Id ${bySidRow.storeId} (${label(bySidRow)})`);
      continue;
    }
    let row: CrmStoreCredential | undefined = bySidRow;
    if (!row) {
      const usable = idHits.filter(sidOf);
      const candidates = idHits.length > 1 && usable.length === 1 ? usable : idHits;
      if (candidates.length > 1) { hold(s, "conflict", `Store_Id ${s.storeId} is on ${candidates.length} stores in the app`); continue; }
      row = candidates[0];
    }
    for (const c of idHits) {
      if (row && c.id !== row.id && c.isActive) spares.push({ id: c.id, dealer: shownDealer(c), store: shownStore(c), reason: `Same Store_Id (${s.storeId}) as ${label(row)}`, chosen: choices.switchOff.has(c.id) });
    }
    if (!row) {
      const alike = existing.filter(c => !loose.includes(c) && !named.has(c.id) && letters(c.storeName) === letters(s.losStore) && letters(c.dealerName) === letters(s.losDealer));
      const choice = choices.sameAs[s.key];
      const chosen = alike.find(c => c.id === choice);
      if (alike.length && !chosen && choice !== "different") {
        hold(s, "same", `Possibly the same store as one in the app with Store_Id ${alike.map(c => c.storeId ?? "not set").join(", ")}`, { sameAs: alike.map(c => ({ id: c.id, store: label(c) })) });
        continue;
      }
      row = chosen;
    }
    matched.set(s, row);
  }
  const claims = new Map<string, LosStore[]>();
  for (const [s, c] of Array.from(matched)) if (c) claims.set(c.id, [...(claims.get(c.id) || []), s]);
  for (const list of Array.from(claims.values())) {
    if (list.length < 2) continue;
    for (const s of list) { hold(s, "conflict", `Store_Id ${list.map(x => x.storeId).join(" and ")} are one store in the app`); matched.delete(s); }
  }

  const dealerCities = new Map<string, string[]>();
  for (const c of existing) if (c.city?.trim()) dealerCities.set(normKey(c.dealerName), [...(dealerCities.get(normKey(c.dealerName)) || []), c.city.trim()]);

  // ── Dealer names ──────────────────────────────────────────────────────────
  const dealerKey = (d: string) => normKey(d);
  const dealers = new Map<string, LosPreviewDealer>();
  for (const s of Array.from(matched.keys())) {
    const k = dealerKey(s.losDealer);
    const d = dealers.get(k);
    if (d) { d.stores++; continue; }
    const names = new Map<string, number>();
    for (const c of existing) {
      const name = c.displayDealerName?.trim();
      if (name && c.isActive && dealerKey(c.dealerName) === k) names.set(name, (names.get(name) || 0) + 1);
    }
    const current = Array.from(names, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const typed = choices.dealerNames[k];
    const name = typed !== undefined ? typed : current[0]?.name || suggestDealerName(s.losDealer);
    dealers.set(k, {
      key: k, losDealer: s.losDealer, stores: 1, name, current, suggested: typed === undefined && !current.length, problem: "", warning: "",
      differing: 0, renamed: choices.renameDealers.has(k), missingCity: 0, schemeChanges: [], useFileSchemes: choices.useFileSchemes.has(k),
    });
  }
  const takenBy = new Map<string, LosPreviewDealer>();
  for (const d of Array.from(dealers.values())) {
    const used = d.current.some(c => c.name === d.name);
    if (!d.name) d.problem = "Type the name customers see";
    else if (waLength(d.name) > SHORT_NAME_LIMIT) {
      const text = `${waLength(d.name)} characters; WhatsApp shows ${SHORT_NAME_LIMIT}`;
      if (used) d.warning = `${text}, so it is cut today`; else d.problem = text;
    }
    const other = takenBy.get(normKey(d.name));
    if (d.name && other) d.problem = `Also the name of ${other.losDealer}`;
    takenBy.set(normKey(d.name), d);
    const foreign = existing.find(c => c.isActive && !loose.includes(c) && !dealers.has(dealerKey(c.dealerName)) && normKey(shownDealer(c)) === normKey(d.name) && dealerKey(c.dealerName) !== d.key);
    if (d.name && !used && foreign && !d.problem) d.problem = `Also the name of ${foreign.dealerName} in the app`;
    d.differing = d.current.filter(c => c.name !== d.name).reduce((n, c) => n + c.count, 0);
  }

  // ── Joining stores without SID to their LOS record ────────────────────────
  const dealerOf = (s: LosStore) => dealers.get(dealerKey(s.losDealer))!;
  const open = Array.from(matched).filter(([, c]) => !c || !c.displayStoreName?.trim());
  const belongs = (c: CrmStoreCredential, s: LosStore) => {
    const d = dealerOf(s);
    const names = [d.name, s.losDealer, ...d.current.map(x => x.name)].map(normKey);
    return names.includes(normKey(shownDealer(c))) || names.includes(normKey(c.dealerName));
  };
  const suggestions = new Map<string, LosStore>();
  const pairs = loose.flatMap(c => open.filter(([s]) => belongs(c, s) && wordsInside(shownStore(c), s.losStore)).map(([s]) => ({ c, s })));
  const cityOnly = (c: CrmStoreCredential) => normKey(shownStore(c)) === normKey(c.city);
  const extra = (p: { c: CrmStoreCredential; s: LosStore }) => letters(p.s.losStore).length - letters(shownStore(p.c)).length;
  // The store with fewest options first, then the closest name; a name that is only the city last.
  const optionCount = new Map<string, number>();
  for (const p of pairs) optionCount.set(p.c.id, (optionCount.get(p.c.id) || 0) + 1);
  pairs.sort((a, b) => Number(cityOnly(a.c)) - Number(cityOnly(b.c)) || optionCount.get(a.c.id)! - optionCount.get(b.c.id)! || extra(a) - extra(b));
  for (const p of pairs) {
    if (suggestions.has(p.c.id) || Array.from(suggestions.values()).includes(p.s)) continue;
    suggestions.set(p.c.id, p.s);
  }
  const joinedTo = new Map<LosStore, CrmStoreCredential>();
  const unlinked: LosPreview["unlinked"] = [];
  for (const c of loose) {
    const options = open.filter(([s]) => belongs(c, s)).map(([s]) => s);
    if (!options.length) continue;
    const pick = options.find(s => s.key === choices.join[c.id]);
    if (pick && !joinedTo.has(pick)) joinedTo.set(pick, c);
    unlinked.push({
      id: c.id, dealer: shownDealer(c), city: c.city || "", store: shownStore(c),
      suggestion: suggestions.get(c.id)?.key || "", options: options.map(s => ({ key: s.key, store: s.losStore })).sort((a, b) => a.store.localeCompare(b.store)),
      chosen: pick && joinedTo.get(pick) === c ? pick.key : choices.join[c.id] === "none" ? "none" : "",
    });
  }

  // ── Result of every store ─────────────────────────────────────────────────
  interface Result { s: LosStore; row?: CrmStoreCredential; half?: CrmStoreCredential; values: RowValues; view: LosPreviewStore; suggestedName: boolean }
  const results: Result[] = [];
  for (const [s, found] of Array.from(matched)) {
    const d = dealerOf(s);
    const half = joinedTo.get(s);
    const row = found || half; // a new store joined to one in the app fills that one in
    const front = half || row; // whose names customers see
    const cityNow = front?.city?.trim() || row?.city?.trim() || "";
    const typedCity = choices.cities[s.key] || "";
    const cityGiven = s.city || typedCity;
    // The account's own spelling for a city it already has (Chennai / chennai).
    const city = cityGiven ? (normKey(cityGiven) === normKey(cityNow) ? cityNow : knownCities.find(c => normKey(c) === normKey(cityGiven)) || cityGiven) : cityNow;
    const citySuggestion = city ? "" : suggestCity(s.losStore, dealerCities.get(d.key) || [], knownCities);
    if (!city) d.missingCity++;
    if (!city && !row) { hold(s, "city", "City is missing", { citySuggestion }); continue; }
    const alias = city && city !== cityNow && knownCities.find(c => normKey(c) !== normKey(city) && cityKey(c) === cityKey(city));

    const dealerShown = front?.displayDealerName?.trim() && !(d.renamed && d.differing) ? front.displayDealerName.trim() : d.name;
    const nameFixed = !!front?.displayStoreName?.trim();
    const typedName = choices.storeNames[s.key];
    const store = nameFixed ? front!.displayStoreName!.trim() : typedName || suggestStoreName(s.losStore, [d.name, s.losDealer, ...d.current.map(c => c.name)], city || citySuggestion);

    const schemesNow = row ? schemesOf(front!).length ? schemesOf(front!) : schemesOf(row) : [];
    const drops = s.schemes.length > 0 && schemesNow.some(x => !s.schemes.some(y => y.schemeId === x.schemeId));
    if (drops) d.schemeChanges.push({ key: s.key, store: [city, store].filter(Boolean).join(" · "), now: schemesNow, file: s.schemes });
    const schemesKept = drops && !d.useFileSchemes;
    const schemes = s.schemes.length && !schemesKept && !sameSchemes(s.schemes, schemesNow) ? s.schemes : schemesNow;

    const sid = s.sid || (row ? sidOf(row) : "");
    const newSecret = s.secret && !(row && hasSecret(row) && safeDecrypt(row.secret) === s.secret) ? s.secret : "";
    const secretSet = !!newSecret || (!!row && hasSecret(row));
    const missing = [!city && "City", !schemes.length && "EMI schemes", !sid && "SID", !secretSet && "Secret"].filter((x): x is string => !!x);
    const was = !!front && front.isActive && front.showInJourney;
    // Complete but off: someone switched it off, so an upload doesn't bring it back.
    const switchedOff = !!row && !half && (!row.isActive || (!row.showInJourney && complete(row)));
    const leftOff = !missing.length && !was && (switchedOff || choices.keepOff.has(s.key));
    const inJourney = was || (!missing.length && !leftOff);

    const values: RowValues = {
      dealerName: s.losDealer, storeName: s.losStore, displayDealerName: dealerShown, displayStoreName: store,
      city: city || null, storeId: s.storeId, emiSchemes: schemes, showInJourney: row && !row.isActive ? row.showInJourney : inJourney,
    };
    if (sid || !row) values.sid = sid;
    if (newSecret || !row) values.secret = newSecret; // encrypted when saved
    if (!row) values.isActive = true;

    const fields: string[] = [];
    if (row) {
      if (half && found) fields.push(`Joined with “${shownStore(half)}”`);
      if (row.storeId !== s.storeId) fields.push("Store ID");
      if (values.sid !== undefined && values.sid !== sidOf(row)) fields.push("SID");
      if (newSecret) fields.push("Secret");
      if ((row.city?.trim() || "") !== city) fields.push(cityNow && cityNow !== city ? `City (was ${cityNow})` : "City");
      if (JSON.stringify(schemesOf(row)) !== JSON.stringify(schemes)) fields.push("EMI schemes");
      if (row.dealerName !== s.losDealer || row.storeName !== s.losStore) fields.push("LOS names");
      if ((row.displayDealerName?.trim() || "") !== dealerShown || (row.displayStoreName?.trim() || "") !== store) fields.push("WhatsApp name");
      if (values.showInJourney !== row.showInJourney) fields.push(values.showInJourney ? "In journey" : "Out of journey");
    }
    results.push({
      s, row, half: half && found ? half : undefined, values, suggestedName: !nameFixed && !typedName,
      view: {
        key: s.key, rowNumber: s.rowNumber, losDealer: s.losDealer, losStore: s.losStore, dealer: dealerShown, city, store,
        nameIsNew: !nameFixed, tooLong: waLength(store) > SHORT_NAME_LIMIT, action: !row ? "add" : fields.length ? "update" : "unchanged", fields,
        schemes, schemesKept, wasInJourney: was, inJourney: inJourney && (!row || row.isActive), missing, leftOff,
        citySuggestion, cityNote: alias ? `Other stores use “${alias}”` : "",
      },
    });
  }

  // ── No two stores alike to the customer ───────────────────────────────────
  const touched = new Set(results.flatMap(r => [r.row?.id, r.half?.id]).filter((x): x is string => !!x));
  const others = new Set(existing.filter(c => c.isActive && !touched.has(c.id)).map(keyOf));
  const viewKey = (r: Result) => rowKey(r.view);
  const rename = (r: Result, name: string) => { r.values.displayStoreName = name; r.view.store = name; r.view.tooLong = waLength(name) > SHORT_NAME_LIMIT; };
  const clashing = () => {
    const n = new Map<string, number>();
    for (const r of results) if (r.view.city) n.set(viewKey(r), (n.get(viewKey(r)) || 0) + 1);
    return results.filter(r => r.view.city && (n.get(viewKey(r))! > 1 || others.has(viewKey(r))));
  };
  // A shortened name that isn't unique goes back to the LOS name.
  for (const r of clashing()) if (r.suggestedName) rename(r, r.s.losStore);
  for (const r of clashing()) {
    // Two stores that already share their names stay as they are.
    if (r.row && keyOf(r.row) === viewKey(r)) continue;
    hold(r.s, "name", `Another ${r.view.dealer} store in ${r.view.city} is also called “${r.view.store}”`);
    results.splice(results.indexOf(r), 1);
  }

  const halves = results.filter(r => r.half);
  const updates: Plan["updates"] = results.filter(r => r.row && r.view.action === "update").map(r => ({ id: r.row!.id, values: r.values }));
  for (const r of halves) {
    const h = r.half!;
    updates.push({ id: h.id, values: { isActive: false, showInJourney: false, displayStoreName: `${shownStore(h)} (joined)` } });
  }
  const off = spares.filter(x => x.chosen && !touched.has(x.id));
  for (const x of off) updates.push({ id: x.id, values: { isActive: false, showInJourney: false } });

  const inFile = new Set([...Array.from(touched), ...spares.map(x => x.id), ...held.flatMap(h => existing.filter(c => c.storeId !== null && String(c.storeId) === h.key).map(c => c.id))]);
  const dealerList = Array.from(dealers.values()).sort((a, b) => a.losDealer.localeCompare(b.losDealer));
  const stores = results.map(r => r.view).sort((a, b) => a.dealer.localeCompare(b.dealer) || a.city.localeCompare(b.city) || a.store.localeCompare(b.store));
  const count = (a: LosPreviewStore["action"]) => stores.filter(s => s.action === a).length;
  return {
    adds: results.filter(r => !r.row).map(r => r.values),
    updates,
    preview: {
      stamp: stampOf(existing), rowCount: file.rowCount, repeatedRows: file.repeatedRows, cutOff: looksCutOff(file.rowCount), inactiveStores: file.inactiveStores,
      dealers: dealerList, stores, held, unlinked, spares,
      notInFile: existing.filter(c => c.isActive && !inFile.has(c.id)).map(c => ({ id: c.id, dealer: shownDealer(c), city: c.city || "", store: shownStore(c), inJourney: c.showInJourney })),
      counts: {
        add: count("add"), update: count("update"), unchanged: count("unchanged"), held: held.length,
        intoJourney: stores.filter(s => s.inJourney && !s.wasInJourney).length, joined: halves.length, switchedOff: off.length,
      },
      blockers: dealerList.filter(d => d.problem).map(d => `${d.losDealer}: ${d.problem}`),
    },
  };
}

export async function previewLosImport(businessAccountId: string, rows: Record<string, unknown>[], choices: unknown): Promise<LosPreview> {
  return planFrom(await loadRows(db, businessAccountId), rows, choices).preview;
}

export async function applyLosImport(
  businessAccountId: string,
  body: { rows: Record<string, unknown>[]; choices: unknown; stamp: unknown; fileName: unknown },
  userName: string | null,
): Promise<LosImportSummary> {
  const summary = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM crm_store_credentials WHERE business_account_id = ${businessAccountId} FOR UPDATE`);
    const existing = await loadRows(tx, businessAccountId);
    const plan = planFrom(existing, body.rows, body.choices);
    if (plan.preview.stamp !== body.stamp) throw new SheetError("The stores changed since this preview. Check the changes again.", 409);
    if (plan.preview.blockers.length) throw new SheetError(`Fix the dealer names first. ${plan.preview.blockers[0]}`);
    if (!plan.adds.length && !plan.updates.length) throw new SheetError("Nothing to change");

    const savedAt = new Date();
    const sealed = (v: RowValues): RowValues => ({ ...v, ...(v.secret ? { secret: encrypt(v.secret) } : {}), updatedAt: savedAt });
    const addedIds: string[] = [];
    for (const v of plan.adds) {
      const [row] = await tx.insert(crmStoreCredentials).values({ ...sealed(v), businessAccountId } as typeof crmStoreCredentials.$inferInsert).returning({ id: crmStoreCredentials.id });
      addedIds.push(row.id);
    }
    for (const u of plan.updates) {
      await tx.update(crmStoreCredentials).set(sealed(u.values))
        .where(and(eq(crmStoreCredentials.id, u.id), eq(crmStoreCredentials.businessAccountId, businessAccountId)));
    }
    const ids = new Set(plan.updates.map(u => u.id));
    const { add, update, unchanged, held, intoJourney, joined, switchedOff } = plan.preview.counts;
    const done: LosImportSummary = { added: add, updated: update, unchanged, held, intoJourney, joined, switchedOff };
    await tx.insert(storeSheetImports).values({
      businessAccountId, fileName: (losText(body.fileName) || "Excel file").slice(0, 200), summary: done, createdByName: userName, createdAt: savedAt,
      snapshot: { before: existing.filter(c => ids.has(c.id)), addedIds, savedAt: savedAt.toISOString() },
    });
    const old = await tx.select({ id: storeSheetImports.id }).from(storeSheetImports).where(eq(storeSheetImports.businessAccountId, businessAccountId))
      .orderBy(desc(storeSheetImports.createdAt)).offset(KEPT_IMPORTS);
    if (old.length) await tx.delete(storeSheetImports).where(inArray(storeSheetImports.id, old.map(o => o.id)));
    return done;
  });
  forgetSheetSnapshot(businessAccountId);
  return summary;
}

// ── Undo ──────────────────────────────────────────────────────────────────────

async function newestImport(ex: Executor, businessAccountId: string) {
  const list = await ex.select().from(storeSheetImports).where(eq(storeSheetImports.businessAccountId, businessAccountId)).orderBy(desc(storeSheetImports.createdAt)).limit(KEPT_IMPORTS);
  return list.find(i => !i.undoneAt);
}

/** The upload that can be undone: the newest one that hasn't been. */
export async function lastLosImport(businessAccountId: string): Promise<LosLastImport | null> {
  const i = await newestImport(db, businessAccountId);
  return i ? { id: i.id, fileName: i.fileName, createdAt: i.createdAt.toISOString(), createdByName: i.createdByName, summary: i.summary as LosImportSummary } : null;
}

/** Stores an already sent lead belongs to keep their record, so its documents can still follow. */
async function usedByLeads(ex: Executor, businessAccountId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const used = new Set<string>();
  for (const table of ["whatsapp_leads", "instagram_leads", "facebook_leads"]) {
    const res = await ex.execute(sql`
      SELECT DISTINCT custom_crm_sync_payload->'_crmSync'->>'storeCredentialId' AS id FROM ${sql.identifier(table)}
      WHERE business_account_id = ${businessAccountId}
        AND custom_crm_sync_payload->'_crmSync'->>'storeCredentialId' IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`);
    for (const r of res.rows as { id: string }[]) used.add(r.id);
  }
  return used;
}

export async function undoLosImport(businessAccountId: string, importId: string, userName: string | null) {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM crm_store_credentials WHERE business_account_id = ${businessAccountId} FOR UPDATE`);
    const newest = await newestImport(tx, businessAccountId);
    if (!newest || newest.id !== importId) throw new SheetError("Only the newest upload can be undone", 409);
    const snap = newest.snapshot as { before: CrmStoreCredential[]; addedIds: string[]; savedAt: string };
    const savedAt = new Date(snap.savedAt).getTime();
    const now = new Map((await loadRows(tx, businessAccountId)).map(c => [c.id, c]));
    // A store edited after the upload keeps its edits.
    const untouched = (id: string) => { const c = now.get(id); return !!c && new Date(c.updatedAt).getTime() === savedAt; };
    let restored = 0, removed = 0, switchedOff = 0, leftEdited = 0;
    for (const c of snap.before) {
      if (!untouched(c.id)) { if (now.has(c.id)) leftEdited++; continue; }
      await tx.update(crmStoreCredentials).set({
        dealerName: c.dealerName, storeName: c.storeName, city: c.city, storeId: c.storeId, sid: c.sid, secret: c.secret, isActive: c.isActive,
        displayDealerName: c.displayDealerName, displayStoreName: c.displayStoreName, emiSchemes: c.emiSchemes, showInJourney: c.showInJourney, updatedAt: new Date(c.updatedAt),
      }).where(and(eq(crmStoreCredentials.id, c.id), eq(crmStoreCredentials.businessAccountId, businessAccountId)));
      restored++;
    }
    const used = await usedByLeads(tx, businessAccountId, snap.addedIds);
    for (const id of snap.addedIds) {
      if (!untouched(id)) { if (now.has(id)) leftEdited++; continue; }
      const own = and(eq(crmStoreCredentials.id, id), eq(crmStoreCredentials.businessAccountId, businessAccountId));
      if (used.has(id)) {
        await tx.update(crmStoreCredentials).set({ isActive: false, showInJourney: false, updatedAt: new Date() }).where(own);
        switchedOff++;
      } else { await tx.delete(crmStoreCredentials).where(own); removed++; }
    }
    await tx.update(storeSheetImports).set({ undoneAt: new Date(), undoneByName: userName }).where(eq(storeSheetImports.id, newest.id));
    return { restored, removed, switchedOff, leftEdited };
  });
  forgetSheetSnapshot(businessAccountId);
  return result;
}
