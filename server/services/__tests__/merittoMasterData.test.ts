/**
 * Meritto master data: course / city matching and the payload built with the lists. No database.
 *
 *   npx tsx server/services/__tests__/merittoMasterData.test.ts
 */
import type { MerittoFieldMapping } from "@shared/schema";
import { indexMerittoLists, parseMerittoWorkbook, googleFileFrom } from "../merittoMasterData";
import { buildMerittoPayload, type MerittoLeadContext } from "../merittoService";

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? `\n    got: ${JSON.stringify(detail)}` : ""}`); }
}

// Shaped like Meritto's "Program master data" and "State and City" tabs (and its "Pre-requisites" tab, which isn't a list).
const { programs, cities } = parseMerittoWorkbook([
  { name: "Pre-requisites", rows: [["Field Name", "Field Keys/API Parameters", "Field Type"], ["Program Level", "campus", "Dropdown"], ["Program Name", "course", "Dropdown"]] },
  { name: "Program master data", rows: [
    ["Program Level", "Program Name"],
    ["UG", "B.Tech (Artificial Intelligence and Machine learning)"],
    ["UG", "B.Tech [Computer Science & IT (Cyber Security)]"],
    ["UG", "BBA (Fintech)"],
    ["UG", "BBA (Digital Media Marketing)"],
    ["UG", "B. Arch"],
    ["UG", "B. Des. (Interior Design)"],
    ["UG", "B.Sc. (Beauty & Wellness)"],
    ["UG", "B.Sc. (Data Science)"],
    ["PG", "M.Sc. (Data Science)"],
    ["PG", "M.Sc. (Nutritional Sciences and Ditetics)"],
    ["PG", "M. Plan. (Urban Planning)"],
    ["PG", "MBA (FinTech)"],
    ["Ph.D", "Ph.D. (Engineering)"],
    ["Ph.D", "Ph.D. (Science)"],
    ["UG", "BBA (Fintech)"],
    ["", ""],
  ] },
  { name: "State and City", rows: [
    ["State", "City"],
    ["Maharashtra", "Pune"], ["Maharashtra", "Kolhapur"], ["Maharashtra", "Aurangabad"], ["Bihar", "Aurangabad"],
    ["Delhi", "New Delhi"], ["Karnataka", "Bengaluru"], ["Haryana", "Gurugram"],
  ] },
]);

expect(programs.length === 14 && cities.length === 7, "sheet tabs found by their headers; repeats and blanks skipped", { programs: programs.length, cities: cities.length });
expect(googleFileFrom("https://docs.google.com/spreadsheets/d/1iDhEm5-qO-FdaD1lZjspk7oLKiOcd-GQRgYffCucPzU/edit?usp=sharing")?.kind === "sheet"
  && googleFileFrom("https://docs.google.com/document/d/1F2SEAa3FecdyHGVWZobDiMzqpuQBwdY_r1OlGGkLcYM/edit")?.kind === "doc"
  && googleFileFrom("https://evil.example.com/spreadsheets/d/1iDhEm5-qO-FdaD1lZjspk7oLKiOcd") === null, "only Google Sheet / Doc links are accepted");

const ix = indexMerittoLists(programs, cities);
const course = (v: string) => ix.matchProgram(v)?.name ?? null;

expect(course("B.Tech Artificial Intelligence & Machine Learning (AI & ML) ") === "B.Tech (Artificial Intelligence and Machine learning)", "AI & ML course with its abbreviation");
expect(course("B.Tech Computer Science & Information Technology (Cyber Security)") === "B.Tech [Computer Science & IT (Cyber Security)]", "\"IT\" read as Information Technology");
expect(course("BBA Digital Media & Marketing") === "BBA (Digital Media Marketing)", "an extra \"&\" doesn't matter");
expect(course("Bachelor of Architecture (B.Arch)") === "B. Arch" && course("Bachelor of Design (Interior Design)") === "B. Des. (Interior Design)", "degree written out in words");
expect(course("Master in Planning (Urban Planning)") === "M. Plan. (Urban Planning)", "Master in Planning → M. Plan.");
expect(course("M.Sc Nutritional Sciences & Dietetics") === "M.Sc. (Nutritional Sciences and Ditetics)", "Meritto's own spelling is kept");
expect(course("BSc Beauty and Welness") === "B.Sc. (Beauty & Wellness)" && course("mba fintech") === "MBA (FinTech)", "typed answers with a typo or in lower case");
expect(course("Ph.D. in Science ") === "Ph.D. (Science)", "Ph.D. in Science");
expect(course("Data Science") === null, "no degree and two equally good courses → no guess");
expect(course("MBA Fintech and Data Science Marketing") === null, "a course of the wrong length/words isn't forced");
expect(course("B.Tech Smart & Sustainable Energy") === null && course("M.Tech Mechatronics Engineering") === null && course("Ph.D. in Computer Science") === null, "courses not in Meritto's list don't match");
expect(course("BBA FinTech") === "BBA (Fintech)" && course("MBA FinTech") === "MBA (FinTech)", "the degree must match (BBA vs MBA)");
expect(ix.matchProgram("B. Arch")?.level === "UG" && ix.matchProgram("Ph.D. (Engineering)")?.level === "Ph.D", "programme level comes with the course");

const city = (v: string) => { const c = ix.matchCity(v); return c ? `${c.city}|${c.state}` : null; };
expect(city("Kolhāpur") === "Kolhapur|Maharashtra" && city(" pune ") === "Pune|Maharashtra", "accents and case don't matter");
expect(city("Delhi") === "New Delhi|Delhi" && city("Bangalore") === "Bengaluru|Karnataka" && city("Gurgaon") === "Gurugram|Haryana", "old or short city names");
expect(city("Aurangabad") === null && city("Doha") === null, "a city in two states, or not in the list → nothing");

// ── payload ──
let order = 0;
const row = (merittoField: string, sourceField: string | null, extra: Partial<MerittoFieldMapping> = {}): MerittoFieldMapping => ({
  id: merittoField, businessAccountId: "b", merittoField, sourceType: sourceField ? "dynamic" : "custom", sourceField, customValue: null, fallbackValue: null,
  displayName: merittoField, isEnabled: "true", sortOrder: order++, createdAt: new Date(), updatedAt: new Date(), ...extra,
});
const mappings = [
  row("name", "lead.name"), row("course", "journey.course"), row("campus", "meritto.campus"),
  row("city", "session.city"), row("state", "meritto.state"), row("medium", "session.utmMedium", { fallbackValue: "Chatbot" }),
];
const ctx = (courseValue: string | null, cityValue: string | null): MerittoLeadContext => ({
  lead: { name: "Asha", email: null, phone: null, whatsapp: null, createdAt: null, sourceUrl: null, captchaStatus: null, channel: "Website" },
  session: { city: cityValue, utmCampaign: null, utmSource: null, utmMedium: null, pageUrl: null },
  business: { name: "SSPU", website: null },
  ...(courseValue ? { journey: { course: courseValue } } : {}),
} as MerittoLeadContext);

let p = buildMerittoPayload(mappings, ctx("BSc Beauty and Welness", "Kolhāpur"), ix);
expect(p.course === "B.Sc. (Beauty & Wellness)" && p.campus === "UG" && p.city === "Kolhapur" && p.state === "Maharashtra" && p.medium === "Chatbot", "course + campus and city + state in Meritto's names", p);
p = buildMerittoPayload(mappings, ctx("IDESCO++ Aesthetics International Diploma", "Doha"), ix);
expect(!("course" in p) && !("campus" in p) && !("city" in p) && !("state" in p) && p.name === "Asha", "unknown course / city left out so the lead still goes", p);
p = buildMerittoPayload(mappings, ctx("BSc Beauty and Welness", "Kolhāpur"), null);
expect(p.course === "BSc Beauty and Welness" && !("campus" in p) && !("state" in p) && p.city === "Kolhāpur", "without lists: sent as before", p);
p = buildMerittoPayload([row("city", "session.city")], ctx(null, "Pune"), ix);
expect(p.city === "Pune" && p.state === "Maharashtra", "a city always goes with its state (Meritto refuses it alone)", p);

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log("\nAll Meritto master data checks passed.");
