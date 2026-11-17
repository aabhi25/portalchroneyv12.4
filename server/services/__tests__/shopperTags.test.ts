/**
 * Tests for shopperTags (server/services/websiteStores.ts): which Shopify tags a website-products sync keeps.
 * The tag list below is a real Giva product's tags (www.giva.co/products.json) plus gift tags seen across its catalog.
 * Run manually: `npx tsx server/services/__tests__/shopperTags.test.ts` (self-asserting, no database).
 */
import { mapShopifyProduct, shopperTags } from "../websiteStores";

let failed = 0;
function expect(cond: any, label: string, got?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}`, got ?? ""); } else { console.log(`✓ ${label}`); }
}

const giva = [
  "30 days easy return", "6 month plating", "925Hallmark_Yes", "Aadi", "Authentication certificate", "avgGrossWeight_0",
  "Best suited for women", "brand_Giva", "collectionName_Teal", "Color_Silver", "component type_Pearl", "giva_festive_2026",
  "goat_sale", "Hallmarked Jewellery", "height_3.8cm", "JEP", "lifetime_plating", "Lock Type_Screw Back", "Metal_925 Silver",
  "motifs_Classic", "plating_Rhodium Micron", "source_Inhouse", "stemLength_10.7 mm", "Style_Office",
  "gifts_wife", "gifts_for her", "gifts_birthday", "gifts_999", "gifts_special days", "no_gift_wrap", "npd_mens",
];
const kept = shopperTags(giva);
console.log("kept:", kept);

const has = (t: string) => kept.includes(t);
expect(has("Gift: Wife") && has("Gift: For her") && has("Gift: Birthday") && has("Gift: Special days"), "gift recipients and occasions kept, cleaned up", kept);
expect(has("Best suited for women"), "plain 'Best suited for women' kept", kept);
expect(has("Style: Office") && has("Metal: 925 Silver") && has("Colour: Silver") && has("Motif: Classic") && has("Collection: Teal"), "style, metal, colour, motif, collection kept", kept);
expect(!kept.some(t => /999/.test(t)), "price-band tag gifts_999 left out", kept);
for (const word of ["sale", "jep", "inhouse", "weight", "height", "hallmark", "giva", "plating", "return", "npd", "stem", "lock"]) {
  expect(!kept.some(t => t.toLowerCase().includes(word)), `internal tag left out: ${word}`, kept);
}
expect(!kept.some(t => /no gift wrap|no_gift_wrap/i.test(t)), "'no_gift_wrap' is not mistaken for a gift tag", kept);

expect(shopperTags("Gifts_Mother, Occasion_Anniversary, SKU-1234").join("|") === "Gift: Mother|Occasion: Anniversary", "comma-separated tags (Shopify admin format)");
expect(shopperTags(["Gift for him", "for her", "Wedding Collection", "random"]).join("|") === "Gift for him|For her|Wedding Collection", "plain gift / recipient / occasion words kept");
expect(shopperTags(["Gift_Wife", "gifts_wife"]).length === 1, "duplicates dropped");
expect(shopperTags(Array.from({ length: 40 }, (_, i) => `Style_Look ${i}`)).length === 20, "at most 20 tags per product");
expect(shopperTags(["Stone_None", "Collection_Less AOV", "Collection_Sale 2025", "Collection_Kids Jewelery"]).join("|") === "Collection: Kids Jewelery", "empty and shop-internal values left out");
expect(shopperTags(undefined).length === 0 && shopperTags(null).length === 0, "no tags → none");

const mapped = mapShopifyProduct({ id: 1, title: "Silver Pendant", product_type: "Pendant", tags: giva, variants: [{ price: "1999.00", available: true }] }, "https://www.giva.co");
expect(mapped?.categories[0] === "Pendant" && mapped.tags.includes("Gift: Wife") && !mapped.tags.includes("goat_sale"), "Shopify product: type as category, shopper tags as tags", mapped?.tags);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("\nAll shopper tag checks passed");
