/**
 * Tests for the Design Studio's shared rules (shared/designStudio.ts): the brand's settings made safe,
 * what a shopper may choose, the price estimate, the motif ranking, the image AI's instructions and
 * the "I want something custom" check on a chat message.
 * Run manually: `npx tsx server/services/__tests__/designStudio.test.ts` (self-asserting, no database).
 */
import {
  MOTIF_LIBRARY, availableMotifs, buildChangePrompt, buildDesignPrompt, cleanChoices, defaultDesignStudioSettings, describeChoices,
  estimatePrice, formatPriceRange, missingChoices, normalizeDesignStudioSettings, rankMotifs, roundPrice, toPublicConfig, wantsCustomDesign,
} from "@shared/designStudio";

let failed = 0;
function expect(cond: any, label: string, got?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}`, got ?? ""); } else { console.log(`✓ ${label}`); }
}

// ── settings ────────────────────────────────────────────────────────────────
const fresh = defaultDesignStudioSettings();
expect(!fresh.ratesConfirmed && fresh.metals.every(m => m.ratePerGram === 0), "a new account has no rates and shows no prices");
expect(JSON.stringify(normalizeDesignStudioSettings(fresh)) === JSON.stringify(fresh), "the defaults survive being saved and read back");

const messy = normalizeDesignStudioSettings({
  label: "  Make   it yours  ", pieces: ["ring", "tiara", "pendant"], makingChargePercent: 400, maxRendersPerSession: 1, dailyRenderCap: "abc",
  metals: [{ id: "gold-18k-yellow", name: "18K yellow gold", ratePerGram: "9000" }, { name: "Platinum", ratePerGram: -5, enabled: false }, { name: "" }],
  stylePhotos: ["https://cdn.example.com/a.jpg", "javascript:alert(1)", "/uploads/design-studio/x/1.jpg", 7],
  customMotifs: [{ name: "Jaipur jaali", meaning: "Our signature lattice", occasions: ["Wedding", "Moon landing"], imageUrl: "ftp://x" }, { name: "" }, { id: "lotus", name: "Our lotus" }],
  hiddenMotifs: ["peacock", 5],
  makingDays: { min: 30, max: 10 },
  somethingElse: true,
});
expect(messy.label === "Make it yours", "label trimmed", messy.label);
expect(messy.pieces.join() === "ring,pendant", "unknown pieces dropped", messy.pieces);
expect(messy.makingChargePercent === 100 && messy.maxRendersPerSession === 3 && messy.dailyRenderCap === 150, "numbers clamped, nonsense falls back");
expect(messy.metals.length === 2 && messy.metals[0].ratePerGram === 9000 && messy.metals[0].look.includes("18 karat")
  && messy.metals[1].id === "platinum" && messy.metals[1].ratePerGram === 0 && !messy.metals[1].enabled, "metals: known look kept, new metal gets an id, bad rate → 0", messy.metals);
expect(messy.stylePhotos.join() === "https://cdn.example.com/a.jpg,/uploads/design-studio/x/1.jpg", "only web or upload addresses kept as photos", messy.stylePhotos);
expect(messy.customMotifs.length === 2 && messy.customMotifs[0].id === "own-jaipur-jaali" && messy.customMotifs[0].occasions.join() === "Wedding"
  && messy.customMotifs[0].imageUrl === null && messy.customMotifs[1].id !== "lotus", "own motifs: id made, unknown occasion and bad photo dropped, no clash with the library", messy.customMotifs);
expect(messy.makingDays.min === 10 && messy.makingDays.max === 30, "making days put in order");
expect(!("somethingElse" in messy), "unknown keys dropped");
const motifs = availableMotifs(messy);
expect(motifs[0].id === "own-jaipur-jaali" && !motifs.some(m => m.id === "peacock") && motifs.some(m => m.id === "lotus"), "own motifs first, hidden library motifs gone");

// ── choices ─────────────────────────────────────────────────────────────────
const picked = cleanChoices({
  piece: "ring", recipient: "Mother", occasion: "Birthday", motifId: "lotus", idea: "  with her   initial R ", metalId: "gold-18k-yellow",
  stoneId: "ruby", tier: "classic", extra: "x",
}, messy);
expect(picked.piece === "ring" && picked.idea === "with her initial R" && picked.stoneId === "ruby" && !("extra" in picked), "a shopper's choices kept and tidied", picked);
const bad = cleanChoices({ piece: "necklace", recipient: "The Queen", motifId: "peacock", metalId: "platinum", stoneId: "kryptonite", tier: "huge" }, messy);
expect(Object.keys(bad).length === 0, "choices the brand doesn't offer are dropped (piece off, motif hidden, metal off, unknown stone)", bad);
expect(missingChoices({}).join() === "piece,motif,metal,tier" && missingChoices(picked).length === 0 && missingChoices({ piece: "ring", idea: "a star", metalId: "x", tier: "classic" }).length === 0,
  "what a design needs: a piece, a motif or an idea, a metal and a size");

// ── prices ──────────────────────────────────────────────────────────────────
expect(roundPrice(8340) === 8300 && roundPrice(45740) === 45500 && roundPrice(231400) === 231000, "prices rounded to a tidy step");
const priced = normalizeDesignStudioSettings({
  ratesConfirmed: true, makingChargePercent: 10, minOrderValue: 0,
  metals: [{ id: "gold-18k-yellow", name: "18K yellow gold", ratePerGram: 10000 }, { id: "silver-925", name: "925 silver", ratePerGram: 0 }],
  stones: [{ id: "ruby", name: "Ruby", pricePerStone: 1000 }],
  pieceWeights: { ring: { min: 2, max: 8 } },
});
// ring 2–8 g in three sizes: 2–4, 4–6, 6–8 g; × 10,000 × 1.1
const delicate = estimatePrice(priced, { piece: "ring", metalId: "gold-18k-yellow", stoneId: "none", tier: "delicate" });
const classic = estimatePrice(priced, { piece: "ring", metalId: "gold-18k-yellow", stoneId: "none", tier: "classic" });
const statement = estimatePrice(priced, { piece: "ring", metalId: "gold-18k-yellow", stoneId: "ruby", tier: "statement" });
expect(delicate?.low === 22000 && delicate?.high === 44000, "delicate ring: 2–4 g", delicate);
expect(classic?.low === 44000 && classic?.high === 66000, "classic ring: 4–6 g", classic);
expect(statement?.low === 66000 + 14000 && statement?.high === 88000 + 30000, "statement ring with rubies: 6–8 g plus 14–30 stones", statement);
expect(estimatePrice(priced, { piece: "ring", metalId: "silver-925", stoneId: "none", tier: "classic" }) === null, "no rate for the metal → no estimate");
expect(estimatePrice({ ...priced, ratesConfirmed: false }, { piece: "ring", metalId: "gold-18k-yellow", stoneId: "none", tier: "classic" }) === null, "rates not confirmed → no estimate");
const floor = estimatePrice({ ...priced, minOrderValue: 50000 }, { piece: "ring", metalId: "gold-18k-yellow", stoneId: "none", tier: "delicate" });
expect(floor?.low === 50000 && floor?.high === 50000, "never below the smallest order", floor);
expect(formatPriceRange("₹", { low: 44000, high: 66000 }) === "₹44,000 – ₹66,000" && formatPriceRange("₹", { low: 50000, high: 50000 }) === "about ₹50,000", "price range in words");

// ── motif advice ────────────────────────────────────────────────────────────
const wedding = rankMotifs(fresh, { occasion: "Wedding", recipient: "Mother", piece: "necklace" });
expect(wedding.length === 4 && wedding.every(s => MOTIF_LIBRARY.find(m => m.id === s.motifId)!.occasions.includes("Wedding")) && wedding[0].why.includes("wedding"),
  "wedding: four wedding motifs, each with a reason", wedding);
expect(rankMotifs(messy, { occasion: "Wedding" })[0].motifId === "own-jaipur-jaali", "the brand's own wedding motif comes first");
expect(!rankMotifs(fresh, { occasion: "Birthday", recipient: "Him" }).some(s => ["floral", "bow", "butterfly", "heart"].includes(s.motifId)), "for him: no bows or flowers");

// ── what the image AI is told ───────────────────────────────────────────────
const prompt = buildDesignPrompt({ choices: picked, settings: { ...messy, styleNote: "minimal, delicate" }, angle: "modern", styleRefs: 2, motifRef: false });
expect(/ring/.test(prompt) && prompt.includes("lotus") && prompt.includes("18 karat yellow gold") && prompt.includes("rubies") && prompt.includes('"with her initial R"')
  && prompt.includes("minimal, delicate") && prompt.includes("first 2 attached images") && prompt.includes("do not copy them")
  && prompt.includes("a real piece a jeweller can make") && prompt.includes("No model"), "design brief: piece, motif, metal, stones, the shopper's idea, house style, style photos, makeable rules", prompt);
const plain = buildDesignPrompt({ choices: { piece: "pendant", idea: "a tiny star", metalId: "silver-925", stoneId: "none", tier: "delicate" }, settings: fresh, angle: "classic", styleRefs: 0, motifRef: false });
expect(plain.includes("No gemstones") && !plain.includes("attached image") && plain.includes("delicate and lightweight"), "no stones, no photos: says so", plain);
expect(buildChangePrompt("make the lotus smaller").includes('"make the lotus smaller"') && buildChangePrompt("x").includes("Keep the same piece"), "a change keeps everything else");
expect(describeChoices(messy, picked) === 'Classic Ring · Lotus motif · 18K yellow gold · Ruby · for mother · Birthday · idea: "with her initial R"', "choices in one line", describeChoices(messy, picked));

// ── what the widget is given ────────────────────────────────────────────────
const pub = toPublicConfig(priced, true) as any;
expect(pub.showPrices === true && pub.metals.every((m: any) => !("ratePerGram" in m)) && pub.stones.every((s: any) => !("pricePerStone" in s)) && !("pieceWeights" in pub) && !("stylePhotos" in pub),
  "the widget never gets the brand's rates, weights or style photos");

// ── "I want something custom" ───────────────────────────────────────────────
for (const yes of ["Do you make custom jewellery?", "can I customise this ring", "I want a personalised pendant", "is this made to order?", "can i design my own necklace", "I want to design a ring for my wife", "bespoke pieces?"]) {
  expect(wantsCustomDesign(yes), `custom: "${yes}"`);
}
for (const no of ["Where is my order?", "customer care number", "show me gold rings", "what is your return policy", "designs under 5000"]) {
  expect(!wantsCustomDesign(no), `not custom: "${no}"`);
}

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("\nAll Design Studio checks passed");
