/**
 * Meritto's master data (the "Program master data" and "State and City" sheets a Meritto client
 * shares): read from the Google Sheet, and used to turn what the chat has into Meritto's exact
 * values. Meritto's course and city fields are dropdowns, so "B.Sc Beauty & Wellness" must become
 * "B.Sc. (Beauty & Wellness)", and a course needs its programme level (campus) and a city its state.
 *
 * No database here (see merittoSetup.ts for that), so the matching can be tested on its own.
 */
import type { MerittoCity, MerittoProgram } from "@shared/schema";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";

// ── Courses ──────────────────────────────────────────────────────────────────

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const DEGREE_PHRASES: Array<[RegExp, string]> = [
  [/\bbachelors? of technology\b/g, " btech "],
  [/\bbachelors? of engineering\b/g, " btech "],
  [/\bbachelors? of architecture\b/g, " barch "],
  [/\bbachelors? of design\b/g, " bdes "],
  [/\bbachelors? of business administration\b/g, " bba "],
  [/\bbachelors? of science\b/g, " bsc "],
  [/\bbachelors? of computer applications?\b/g, " bca "],
  [/\bbachelors? of commerce\b/g, " bcom "],
  [/\bmasters? (?:of|in) technology\b/g, " mtech "],
  [/\bmasters? (?:of|in) planning\b/g, " mplan "],
  [/\bmasters? (?:of|in) business administration\b/g, " mba "],
  [/\bmasters? (?:of|in) science\b/g, " msc "],
  [/\bmasters? (?:of|in) computer applications?\b/g, " mca "],
  [/\bmasters? (?:of|in) design\b/g, " mdes "],
  [/\bdoctor(?:ate)? of philosophy\b/g, " phd "],
];
const DEGREES = new Set(["btech", "mtech", "barch", "march", "bdes", "mdes", "bba", "mba", "bsc", "msc", "bplan", "mplan", "phd", "bca", "mca", "bcom", "mcom", "pgdm", "diploma"]);
const STOP = new Set(["in", "of", "and", "the", "with", "for", "a", "an", "specialization", "specialisation", "hons", "honours", "program", "programme", "course", "degree"]);
const ABBR: Record<string, string[]> = {
  ai: ["artificial", "intelligence"],
  ml: ["machine", "learning"],
  aiml: ["artificial", "intelligence", "machine", "learning"],
  it: ["information", "technology"],
  cs: ["computer", "science"],
  csit: ["computer", "science", "information", "technology"],
  ds: ["data", "science"],
  engg: ["engineering"],
  eng: ["engineering"],
  mgmt: ["management"],
  mgt: ["management"],
  sci: ["science"],
};

interface CourseKey { degree: string | null; words: string[] }

/** "B.Tech Artificial Intelligence & Machine Learning (AI & ML)" → { degree: "btech", words: [artificial, intelligence, machine, learning] } */
export function courseKey(raw: string): CourseKey {
  let s = fold(raw).replace(/&/g, " and ").replace(/\./g, "");
  s = s.replace(/[^a-z0-9]+/g, " ");
  for (const [re, rep] of DEGREE_PHRASES) s = s.replace(re, rep);
  const parts = s.split(" ").filter(Boolean);
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i], next = parts[i + 1];
    // "B. Arch" → "barch", "M. Plan." → "mplan", "Ph D" → "phd"
    if ((t === "b" || t === "m") && next && DEGREES.has(t + next)) { tokens.push(t + next); i++; continue; }
    if (t === "ph" && next === "d") { tokens.push("phd"); i++; continue; }
    tokens.push(t);
  }
  const degree = tokens.find(t => DEGREES.has(t)) ?? null;
  const words = new Set<string>();
  for (const t of tokens) {
    if (DEGREES.has(t) || STOP.has(t)) continue;
    for (const w of ABBR[t] ?? [t]) words.add(w);
  }
  return { degree, words: Array.from(words) };
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Same word, allowing a typo or a plural ("Welness" / "Wellness", "Sciences" / "Science"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 5) return false;
  return editDistance(a, b) <= (shorter >= 8 ? 2 : 1);
}

/** 0..1: how alike the words are (Dice coefficient with typo-tolerant word matching). */
function similarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const free = [...b];
  let matched = 0;
  for (const w of a) {
    const i = free.findIndex(x => sameWord(w, x));
    if (i >= 0) { matched++; free.splice(i, 1); }
  }
  return (2 * matched) / (a.length + b.length);
}

const MATCH_THRESHOLD = 0.75;

// ── Cities ───────────────────────────────────────────────────────────────────

const cityKey = (s: string) => fold(s).replace(/[^a-z0-9]+/g, "");

/** Older or other names → the one Meritto's list is likely to use (tried both ways). */
const CITY_ALIASES: Record<string, string> = {
  delhi: "newdelhi",
  bangalore: "bengaluru",
  gurgaon: "gurugram",
  bombay: "mumbai",
  cochin: "kochi",
  calcutta: "kolkata",
  madras: "chennai",
  mysore: "mysuru",
  allahabad: "prayagraj",
  pondicherry: "puducherry",
  trivandrum: "thiruvananthapuram",
  poona: "pune",
  baroda: "vadodara",
  vizag: "visakhapatnam",
  benares: "varanasi",
  banaras: "varanasi",
  mangalore: "mangaluru",
  belgaum: "belagavi",
  hubli: "hubballi",
  calicut: "kozhikode",
};
const CITY_ALIASES_BACK: Record<string, string> = Object.fromEntries(Object.entries(CITY_ALIASES).map(([k, v]) => [v, k]));

// ── The index ────────────────────────────────────────────────────────────────

export interface MerittoListsIndex {
  hasPrograms: boolean;
  hasCities: boolean;
  /** Meritto's course for what the chat has, or null when it isn't clearly one of them. */
  matchProgram(value: string | null | undefined): MerittoProgram | null;
  /** Meritto's spelling of the city and its state, or null when unknown or in more than one state. */
  matchCity(value: string | null | undefined): MerittoCity | null;
}

export function indexMerittoLists(programs: MerittoProgram[] | null | undefined, cities: MerittoCity[] | null | undefined): MerittoListsIndex {
  const progs = (programs ?? []).filter(p => p?.name?.trim());
  const keyed = progs.map(p => ({ p, key: courseKey(p.name), exact: fold(p.name).replace(/\s+/g, " ").trim() }));

  const byCity = new Map<string, MerittoCity[]>();
  for (const c of cities ?? []) {
    if (!c?.city?.trim() || !c?.state?.trim()) continue;
    const k = cityKey(c.city);
    const list = byCity.get(k) ?? [];
    list.push(c);
    byCity.set(k, list);
  }

  return {
    hasPrograms: progs.length > 0,
    hasCities: byCity.size > 0,

    matchProgram(value) {
      const v = value?.trim();
      if (!v || keyed.length === 0) return null;
      const exactKey = fold(v).replace(/\s+/g, " ");
      const exact = keyed.find(k => k.exact === exactKey);
      if (exact) return exact.p;
      const want = courseKey(v);
      let best: { p: MerittoProgram; score: number } | null = null;
      let second = 0;
      for (const k of keyed) {
        if (want.degree && k.key.degree !== want.degree) continue;
        // Without a degree ("Interior Design") only a course that names one can match, and it must be the only good one.
        if (!want.degree && want.words.length === 0) continue;
        const score = similarity(want.words, k.key.words);
        if (!best || score > best.score) { second = best?.score ?? 0; best = { p: k.p, score }; }
        else if (score > second) second = score;
      }
      if (!best || best.score < MATCH_THRESHOLD || second >= best.score) return null;
      return best.p;
    },

    matchCity(value) {
      const v = value?.trim();
      if (!v || byCity.size === 0) return null;
      const k = cityKey(v);
      const found = byCity.get(k) ?? byCity.get(CITY_ALIASES[k] ?? "") ?? byCity.get(CITY_ALIASES_BACK[k] ?? "");
      if (!found?.length) return null;
      const states = new Set(found.map(c => c.state.trim().toLowerCase()));
      return states.size === 1 ? found[0] : null;
    },
  };
}

// ── Reading the Google Sheet ─────────────────────────────────────────────────

export interface MerittoSheet {
  sheetUrl: string;
  programs: MerittoProgram[];
  cities: MerittoCity[];
}

/** A Google Sheet link, or the Meritto Google Doc that links to one. */
export function googleFileFrom(url: string): { kind: "sheet" | "doc"; id: string } | null {
  const m = url.trim().match(/^https:\/\/docs\.google\.com\/(spreadsheets|document)\/d\/([a-zA-Z0-9_-]{20,})/);
  if (!m) return null;
  return { kind: m[1] === "spreadsheets" ? "sheet" : "doc", id: m[2] };
}

const NOT_SHARED = "Couldn't open it. In Google, set Share → General access → \"Anyone with the link\" (Viewer), then try again.";

/** Rows of every tab → Meritto's programmes and cities, found by their header row. */
export function parseMerittoWorkbook(tabs: Array<{ name: string; rows: unknown[][] }>): { programs: MerittoProgram[]; cities: MerittoCity[] } {
  const programs: MerittoProgram[] = [];
  const cities: MerittoCity[] = [];
  const seenP = new Set<string>(), seenC = new Set<string>();
  const cell = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

  for (const tab of tabs) {
    for (let h = 0; h < Math.min(tab.rows.length, 10); h++) {
      const header = (tab.rows[h] ?? []).map(c => cell(c).toLowerCase());
      const level = header.findIndex(c => /^(program(me)? level|campus|level)$/.test(c));
      const name = header.findIndex(c => /^(program(me)? name|course( name)?)$/.test(c));
      const state = header.findIndex(c => c === "state");
      const city = header.findIndex(c => c === "city");
      if (level >= 0 && name >= 0) {
        for (const row of tab.rows.slice(h + 1)) {
          const p = { level: cell(row[level]), name: cell(row[name]) };
          if (!p.level || !p.name || seenP.has(p.name.toLowerCase())) continue;
          seenP.add(p.name.toLowerCase());
          programs.push(p);
        }
        break;
      }
      if (state >= 0 && city >= 0) {
        for (const row of tab.rows.slice(h + 1)) {
          const c = { state: cell(row[state]), city: cell(row[city]) };
          const k = `${c.state}|${c.city}`.toLowerCase();
          if (!c.state || !c.city || seenC.has(k)) continue;
          seenC.add(k);
          cities.push(c);
        }
        break;
      }
    }
  }
  return { programs, cities };
}

/** Downloads the sheet (following a Meritto Google Doc to the sheet it links) and reads its lists. */
export async function loadMerittoSheet(url: string): Promise<MerittoSheet> {
  const file = googleFileFrom(url);
  if (!file) throw new Error("Paste the Google Sheet link of Meritto's master data (it starts with https://docs.google.com/spreadsheets/…).");
  let sheetId = file.id;
  if (file.kind === "doc") {
    const res = await fetchWithTimeout(`https://docs.google.com/document/d/${file.id}/export?format=html`, {}, 20_000);
    const html = res.ok ? await res.text() : "";
    if (!res.ok || !html) throw new Error(NOT_SHARED);
    const link = html.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
    if (!link) throw new Error("That document has no Google Sheet link in it. Paste the master data sheet's link instead.");
    sheetId = link[1];
  }
  const res = await fetchWithTimeout(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, {}, 30_000);
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !/spreadsheetml|octet-stream/.test(type)) throw new Error(NOT_SHARED);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 15 * 1024 * 1024) throw new Error("That sheet is too big to read (over 15 MB).");

  const XLSX = await import("xlsx");
  const book = XLSX.read(buffer, { type: "buffer" });
  const tabs = book.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: "", raw: false }) }));
  const { programs, cities } = parseMerittoWorkbook(tabs);
  if (programs.length === 0 && cities.length === 0) {
    throw new Error("Couldn't find Meritto's lists in that sheet: expected a tab with \"Program Level\" and \"Program Name\" columns, or one with \"State\" and \"City\".");
  }
  return { sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, programs, cities };
}
