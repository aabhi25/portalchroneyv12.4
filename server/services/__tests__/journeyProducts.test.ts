/**
 * Tests for journeys that end by showing products (shared/journeyProducts.ts) and for reading an option
 * out of the visitor's first message (journeyOrchestrator.optionNamedIn).
 * Run manually: `DATABASE_URL=postgres://unused@127.0.0.1:1/x npx tsx server/services/__tests__/journeyProducts.test.ts`
 * (No database is touched; the URL only satisfies server/db.ts. Self-asserting, no test runner.)
 */
import { buildJourneyProductSearch, matchOption, withOptionFilters, optionFiltersOf, type ProductStepLike } from "@shared/journeyProducts";
import { optionNamedIn } from "../journeyOrchestrator";

let failed = 0;
function expect(cond: any, label: string, got?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}`, got ?? ""); } else { console.log(`✓ ${label}`); }
}

const who: ProductStepLike = {
  id: "who", questionText: "Who is the gift for?", questionType: "radio",
  multipleChoiceOptions: JSON.stringify(["Wife", "Mother", "Sister", "Myself"]),
  toolParameters: withOptionFilters(null, {
    Wife: { tags: ["Gift: Wife", "Gift: For her"] },
    Mother: { tags: ["Gift: Mother"] },
    Sister: { tags: ["Gift: Sister"] },
  }),
};
const budget: ProductStepLike = {
  id: "budget", questionText: "Your budget?", questionType: "radio",
  multipleChoiceOptions: JSON.stringify(["Under ₹1,000", "₹1,000–2,500", "Above ₹2,500"]),
  toolParameters: withOptionFilters(null, { "Under ₹1,000": { maxPrice: 1000 }, "₹1,000–2,500": { minPrice: 1000, maxPrice: 2500 }, "Above ₹2,500": { minPrice: 2500 } }),
};
const kind: ProductStepLike = {
  id: "kind", questionText: "What kind of jewellery?", questionType: "radio",
  multipleChoiceOptions: JSON.stringify(["Rings", "Earrings", "Surprise me"]),
  // "Rings" saved the older way (one type); "Earrings" with several types.
  toolParameters: withOptionFilters(null, { Rings: { type: "Rings" }, Earrings: { types: ["Earrings", "Gold Earrings"] } }),
};
const style: ProductStepLike = { id: "style", questionText: "Anything she likes?", questionType: "text" };
const phone: ProductStepLike = { id: "phone", questionText: "Your mobile number?", questionType: "phone" };
const show: ProductStepLike = { id: "show", questionText: "Here are a few she'll love", toolTrigger: "get_products", toolParameters: JSON.stringify({ search: "gift" }) };
const steps = [who, budget, kind, style, phone, show];

const s1 = buildJourneyProductSearch(steps, { who: "wife", budget: "₹1,000–2,500", kind: "Rings", style: "minimal, rose gold", phone: "9876543210" }, show);
expect(s1.tagGroups.length === 1 && s1.tagGroups[0].join() === "Gift: Wife,Gift: For her", "recipient → its tags (answer matched ignoring case)", s1);
expect(s1.minPrice === 1000 && s1.maxPrice === 2500, "budget → price range", s1);
expect(JSON.stringify(s1.typeGroups) === JSON.stringify([["Rings"]]), "older single type → one type group", s1);
expect(s1.search.includes("gift") && s1.search.includes("minimal, rose gold") && s1.search.includes("Rings"), "search words: the step's words, typed answers and the type", s1.search);
expect(!s1.search.includes("9876543210"), "contact answers never go into the search", s1.search);

const s2 = buildJourneyProductSearch(steps, { who: "[SKIPPED: not answered]", budget: "Under ₹1,000", kind: "Surprise me" }, show);
expect(s2.tagGroups.length === 0 && s2.maxPrice === 1000 && s2.typeGroups.length === 0, "skipped and unmapped answers add no filter", s2);
const material: ProductStepLike = { id: "metal", questionText: "Silver or gold?", questionType: "radio", toolParameters: withOptionFilters(null, { Gold: { types: ["Gold Earrings", "Gold Ring"] } }) };
const s5 = buildJourneyProductSearch([kind, material], { kind: "Earrings", metal: "Gold" });
expect(JSON.stringify(s5.typeGroups) === JSON.stringify([["Earrings", "Gold Earrings"], ["Gold Earrings", "Gold Ring"]]), "each answer's types are one group (Earrings + Gold → gold earrings)", s5.typeGroups);
expect(s2.search.includes("Surprise me"), "an option with no filter is searched by its words", s2.search);

const s3 = buildJourneyProductSearch([who], new Map([["who", "Mother"]]));
expect(s3.search === "gift" && s3.tagGroups[0][0] === "Gift: Mother", "no product step: a default search word, filters still applied", s3);

const builderMade = steps.map(st => (st.toolTrigger ? st : { ...st, toolTrigger: "none" }));
const s4 = buildJourneyProductSearch(builderMade, { who: "Wife", budget: "Under ₹1,000" }, show);
expect(s4.tagGroups.length === 1 && s4.maxPrice === 1000, "questions saved by the journey builder (step type 'none') still count", s4);

expect(matchOption("my WIFE", ["Wife", "Mother"]) === "Wife" && matchOption("x", ["Wife"]) === null, "matchOption: contains / none");
expect(Object.keys(optionFiltersOf({ toolParameters: withOptionFilters(JSON.stringify({ other: 1, optionFilters: { A: { tags: [] } } }), { A: {} }) })).length === 0, "empty filters are not saved, other settings kept");
expect(JSON.parse(withOptionFilters(JSON.stringify({ other: 1 }), {})!).other === 1, "other step settings survive saving filters");

expect(optionNamedIn("I want to gift my wife something", ["Wife", "Mother", "Sister"]) === "Wife", "first message names the recipient");
expect(optionNamedIn("gift for my mother-in-law", ["Wife", "Mother"]) === "Mother", "words split on punctuation");
expect(optionNamedIn("gift for my wife and mother", ["Wife", "Mother"]) === null, "two options named: ask instead");
expect(optionNamedIn("something for my wifey", ["Wife"]) === null, "whole words only");
expect(optionNamedIn("anything", ["Under ₹1,000"]) === null, "no option named");

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("\nAll journey product checks passed");
process.exit(0); // the orchestrator's imports keep timers running
