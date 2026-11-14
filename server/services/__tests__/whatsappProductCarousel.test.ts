/**
 * WhatsApp product carousel + product texts (no database):
 *  - the carousel follows Meta's interactive carousel format and limits (2–10 cards, card text ≤ 160
 *    characters with ≤ 2 line breaks, button titles ≤ 20, same buttons on every card);
 *  - "Know more (N)" taps become the product's number; other messages are unchanged;
 *  - product texts: heading dropped, cut at a sentence or whole word, website line breaks joined.
 *
 *   npx tsx server/services/__tests__/whatsappProductCarousel.test.ts
 */
import { captionExcerpt, cardBody, carouselInteractive, carouselTapToNumber, knowMoreTitle } from "../whatsappProductCarousel";
import { htmlToText } from "../wooCommerceStore";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
  else console.log(`✓ ${label}`);
}

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const accurexT3 = "Overview\nBuy AccuDx CQ T3 (Triiodothyronine) Fast Test Kit (Immunofluorescence Assay) used for determination of T3 in serum & plasma. Accurex Triiodothyronine test can be used in the monitoring of hypothyroidism and hyperthyroidism. It gives results in 15 minutes.";

// ── Product texts ──
const ex = captionExcerpt(accurexT3, 300);
expect(!ex.startsWith("Overview") && ex.startsWith("Buy AccuDx CQ T3"), "heading line \"Overview\" dropped", ex);
expect(ex.length <= 300 && /[.!?]$/.test(ex), "cut at the end of a sentence", ex);
const word = captionExcerpt("Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu", 30);
expect(word.endsWith("…") && word.length <= 31 && !/\s…$/.test(word) && word.split(" ").every(w => /^[a-z]+…?$/i.test(w)), "otherwise cut at a whole word with …", word);
expect(captionExcerpt("Short text.", 300) === "Short text.", "short text unchanged");
expect(captionExcerpt("Hematology Analyzer Lyse\nfor 3-part analyzers", 300) === "Hematology Analyzer Lyse for 3-part analyzers", "a first line that is a sentence part, not a heading, is kept and joined");
const html = "<h3>Overview</h3>\n<p>AccuDx CQ is a Near Patient Critical Care Quantitative Analyzer.\nBest Criticare Analyzer\nin the\nPoint of Care (POC)\nRange from Accurex.</p><ul>\n<li>Fast</li>\n<li>Accurate</li></ul>";
const text = htmlToText(html);
expect(text === "Overview\nAccuDx CQ is a Near Patient Critical Care Quantitative Analyzer. Best Criticare Analyzer in the Point of Care (POC) Range from Accurex.\n• Fast\n• Accurate", "website line breaks inside a paragraph become spaces; paragraphs and list items keep their own lines", text);

// ── Cards ──
const body = cardBody({ name: "AccuDx CQ T3 (25 Test)", price: 6250, description: ex, imageUrl: "https://x/y.jpg" }, rupees);
expect(body.length <= 160 && (body.match(/\n/g) || []).length <= 2, "card text within 160 characters and 2 line breaks", body);
expect(body.startsWith("*AccuDx CQ T3 (25 Test)*\n₹6,250\n"), "card text: bold name, then price", body);
const oos = cardBody({ name: "CBC 3D Control", price: 8289, outOfStock: true, imageUrl: "https://x/y.jpg" }, rupees);
expect(oos === "*CBC 3D Control*\n₹8,289 · Out of stock", "out of stock shown next to the price", oos);
const noPrice = cardBody({ name: "Quote only", imageUrl: "https://x/y.jpg", description: "Ask us for a price." }, rupees);
expect(noPrice === "*Quote only*\nAsk us for a price.", "no price → no empty line", noPrice);
const longName = cardBody({ name: "X".repeat(200), price: 1, description: "Y ".repeat(200), imageUrl: "https://x/y.jpg" }, rupees);
expect(longName.length <= 160, "very long name and text still fit", longName.length);

expect(knowMoreTitle(1) === "Know more (1)" && knowMoreTitle(10).length <= 20, "Know more titles fit in 20 characters");
expect(knowMoreTitle(3, "जानकारी के लिए और देखें यहाँ").length <= 20, "a long translated label is shortened to fit");

const cards = [1, 2, 3].map(i => ({ name: `Product ${i}`, price: 100 * i, description: "Nice product.", imageUrl: `https://cdn.test/${i}.jpg` }));
const inter: any = carouselInteractive("Swipe to see the products.", cards, rupees);
expect(inter.type === "carousel" && inter.body.text === "Swipe to see the products." && inter.action.cards.length === 3, "carousel: type, body text and one card per product");
const c0 = inter.action.cards[0];
expect(c0.card_index === 0 && c0.type === "cta_url" && c0.header.type === "image" && c0.header.image.link === "https://cdn.test/1.jpg", "card: index, type and image header as in Meta's example", c0);
expect(c0.action.buttons.length === 2 && c0.action.buttons.every((b: any) => b.type === "quick_reply" && b.quick_reply.title.length <= 20 && b.quick_reply.id), "card: two quick-reply buttons with ids and short titles", c0.action.buttons);
expect(inter.action.cards.every((c: any) => c.action.buttons.length === 2 && c.action.buttons[1].quick_reply.title === "Book consultation"), "every card has the same buttons (WhatsApp rule)");
expect(inter.action.cards.map((c: any) => c.action.buttons[0].quick_reply.title).join("|") === "Know more (1)|Know more (2)|Know more (3)", "each card's Know more carries its number");
const skipped: any = carouselInteractive("x", [{ ...cards[0], number: 1 }, { ...cards[2], number: 3 }], rupees);
expect(skipped.action.cards.map((c: any) => c.action.buttons[0].quick_reply.title).join("|") === "Know more (1)|Know more (3)", "Know more keeps the product's number when one without a photo is left out");
const many: any = carouselInteractive("x", Array.from({ length: 14 }, (_, i) => ({ ...cards[0], name: `P${i}` })), rupees);
expect(many.action.cards.length === 10, "at most 10 cards");

// ── Taps ──
expect(carouselTapToNumber("Know more (2)") === "2" && carouselTapToNumber("  Know more (10) ") === "10", "a Know more tap becomes the product's number");
expect(carouselTapToNumber("Do you have CQ Trop") === "Do you have CQ Trop" && carouselTapToNumber("Book consultation") === "Book consultation", "ordinary messages unchanged");
expect(carouselTapToNumber("I need the analyzer for my lab (2)") === "I need the analyzer for my lab (2)", "a long sentence ending in (2) is not treated as a tap");

console.log(failed ? `\n${failed} check(s) failed` : "\nAll WhatsApp carousel checks passed");
process.exit(failed ? 1 : 0);
