/**
 * Where each answer is on its page (answerCheck/regions.ts): rows of writing on plain and ruled
 * pages, a part reaching to where the next begins, boundaries from parts, and the marked sheet cut
 * to them. No database, no AI.
 * Run: npx tsx server/services/__tests__/answerCheckRegions.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused"; // never queried here

import { answerRegions, movedRegions } from "@shared/answerCheck";

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) console.log(`  ok  ${label}`);
  else { failed++; console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

async function main() {
  const sharp = (await import("sharp")).default;
  const { partsOnPage, trimToWriting, writingRows, locateParts } = await import("../answerCheck/regions");
  const { locateUserText, parseLocate, LOCATE_SYSTEM } = await import("../answerCheck/prompts");
  const { renderMarkedSheet, renderPracticeSheet } = await import("../answerCheck/drawing");

  console.log("Rows of writing");
  // A plain page with five lines of "writing" (short strokes) at known heights.
  const lines = [100, 200, 300, 600, 700];
  const strokes = lines.map(y => Array.from({ length: 24 }, (_, i) => `<rect x="${90 + i * 26}" y="${y}" width="10" height="30" fill="#223"/>`).join("")).join("");
  const plain = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#e9e9ea"/>${strokes}</svg>`)).jpeg().toBuffer();
  const rows = await writingRows(plain);
  expect(rows.edges.length === 6 && rows.edges[0] === 0 && rows.edges[5] === 1, "one row per line of writing", rows.edges);
  expect(rows.edges.slice(1, -1).every((e, i) => e * 1000 > lines[i] + 30 && e * 1000 < lines[i + 1]), "cuts lie between the lines", rows.edges);
  const t = trimToWriting(rows, 0, 1);
  expect(t.top > 0.08 && t.top <= 0.1 && t.bottom >= 0.73 && t.bottom < 0.76, "trimmed to the writing with a little space", t);
  const blank = await writingRows(await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#eee" } }).jpeg().toBuffer());
  expect(blank.edges.join() === "0,1" && JSON.stringify(trimToWriting(blank, 0, 1)) === JSON.stringify({ top: 0, bottom: 1 }), "a blank page is one row, shown whole", blank.edges);

  const [ruled] = await renderPracticeSheet({ text: "Q1.\nResistance is the opposition to current.\nR = 440 ohm\n\n2)\nRefraction is the bending of light.", studentLabel: "Name: Sample", questionLabel: "Mock test", seed: "r" });
  const ruledRows = await writingRows(ruled);
  const whole = trimToWriting(ruledRows, 0.2, 1);
  expect(whole.bottom < 0.6, "printed lines under the last answer are not writing", whole);

  console.log("Parts on a page");
  const places = partsOnPage(rows, [{ part: 4, row: 1 }, { part: 5, row: 4 }]);
  expect(places.get(4)!.bottom < 0.36 && places.get(5)!.top > 0.57 && places.get(5)!.bottom < 0.76, "a part reaches to where the next begins", Array.from(places));
  const side = partsOnPage(rows, [{ part: 1, row: 1 }, { part: 2, row: 1 }, { part: 3, row: 4 }]);
  expect(JSON.stringify(side.get(1)) === JSON.stringify(side.get(2)) && side.get(1)!.bottom < 0.36, "two parts side by side share their stretch");
  expect(partsOnPage(rows, [{ part: 1, row: 9 }, { part: 2, row: 0 }]).size === 0, "rows that don't exist are ignored");
  expect(partsOnPage(rows, [{ part: 1, row: 4 }], [1]).get(1)!.top < 0.11, "a continuation at the top begins at the top of its page");
  expect(partsOnPage(rows, [{ part: 1, row: 2 }]).get(1)!.top < 0.11, "a first line placed a row too low is taken in");
  expect(partsOnPage(rows, [{ part: 1, row: 4 }]).get(1)!.top > 0.5, "more lines than that above it are not");
  const later = partsOnPage(rows, [{ part: 1, row: 1 }, { part: 2, row: 4 }], [2]);
  expect(later.get(2)!.top > 0.5, "…but not one with another answer above it");

  console.log("Boundaries of an answer");
  const found = new Map([[0, [{ page: 2, top: 0.1, bottom: 0.3 }]], [1, [{ page: 2, top: 0.31, bottom: 0.4 }, { page: 1, top: 0.5, bottom: 0.9 }]], [2, [{ page: 2, top: 0.7, bottom: 0.8 }]]]);
  expect(JSON.stringify(answerRegions([0, 1, 2, 9], found)) === JSON.stringify([{ page: 1, top: 0.5, bottom: 0.9 }, { page: 2, top: 0.1, bottom: 0.4 }, { page: 2, top: 0.7, bottom: 0.8 }]), "stretches that touch are one, in page order", answerRegions([0, 1, 2, 9], found));
  expect(movedRegions([{ page: 1, top: 0, bottom: 1 }, { page: 3, top: 0, bottom: 0.5 }], [3, 1, 2]).map(r => r.page).join() === "1,2" && movedRegions([{ page: 3, top: 0, bottom: 0.5 }], [3, 1, 2])[0].page === 1 && movedRegions(undefined, [1]).length === 0, "boundaries follow their pages");

  console.log("Asking where");
  expect(JSON.stringify(parseLocate({ places: [{ part: 1, row: 3, begins: "Let" }, { part: "2", row: "4" }, { part: 1, row: 5 }, { part: 8, row: 1 }, { part: 2, row: 0 }, null], notHere: [3, 1, 9, "x"] }, [1, 2, 3])) === JSON.stringify({ places: [{ part: 1, row: 3, begins: "Let" }, { part: 2, row: 4, begins: "" }], notHere: [3] }), "unknown parts, repeats and rows below 1 are dropped");
  expect(parseLocate(null, [1]).places.length === 0 && parseLocate({ places: "x", notHere: 3 }, [1]).notHere.length === 0, "an unusable reply places nothing");
  const ask = locateUserText([{ id: 3, label: "Q2", text: "a\nb", continues: false, goesOn: true }, { id: 4, label: "", text: "x".repeat(400), continues: true, goesOn: true }], 12);
  expect(ask.includes('Part 3, labelled "Q2" (begins on this page and goes on to another): "a b"') && ask.includes("Part 4 (began on another page") && ask.includes("x".repeat(400)) && ask.includes("rows 1 to 12"), "parts are named with their label and how they begin", ask);
  const asked: any[] = [];
  const ai = { costUsd: () => 0, async json(call: any) { asked.push(call); if (call.user.includes("Part 2")) throw new Error("busy"); return { places: [{ part: 0, row: 1 }, { part: 1, row: 4 }] }; } };
  const P = (pages: number[], text: string) => ({ label: "", pages, text, legibility: 1, unclear: [] });
  const located = await locateParts(ai, [plain, plain, plain], [P([1], "a"), P([1], "b"), P([2], "c")]);
  expect(asked.length === 3 && asked.every(c => c.system === LOCATE_SYSTEM && c.images.length >= 1 && c.images.length === c.imageLabels.length), "one question per page, one nobody claims too");
  expect(located.places.get(0)![0].page === 1 && located.places.get(1)![0].top > 0.5 && !located.places.has(2) && JSON.stringify(located.pages) === "[[1],[1],[2]]", "a page that fails leaves its answers without a boundary, the rest stay", Array.from(located.places));

  console.log("A page the reader gave to no part");
  const { besideParts } = await import("../answerCheck/regions");
  const four = [P([1], "a"), P([1, 2], "b"), P([2], "c"), P([5], "d")];
  expect(besideParts(four, 3).map(x => x.i).join() === "2,3" && besideParts(four, 6).map(x => x.i).join() === "3" && besideParts([P([2], "a")], 1).map(x => x.i).join() === "0" && besideParts([], 1).length === 0, "it may carry on the last answer before it, or begin the first after it");
  const tailAsked: any[] = [];
  const tail = await locateParts({ costUsd: () => 0, async json(call: any) { tailAsked.push(call.user); return call.user.includes("may or may not") ? { places: [{ part: 0, row: 1, begins: "ii) LHS = (a-4c)" }] } : { places: [{ part: 0, row: 1, begins: "169775 a, b, c are" }] }; } }, [plain, plain], [P([1], "169775 a, b, c are in continued proportion\nii) LHS = (a-4c)/(a-2b)")]);
  expect(JSON.stringify(tail.pages) === "[[1,2]]" && tail.places.get(0)!.map(r => r.page).join() === "1,2" && tail.places.get(0)![1].top < 0.11, "the answer whose last lines are on it gets that page", tail.pages);
  expect(tailAsked.some(u => u.includes("ii) LHS = (a-4c)/(a-2b)") && u.includes("may or may not have writing on this page")), "the answer is shown to its end");
  const stray = await locateParts({ costUsd: () => 0, async json(call: any) { return call.user.includes("may or may not") ? { places: [], notHere: [0] } : { places: [{ part: 0, row: 1, begins: "a" }] }; } }, [plain, plain], [P([1], "a")]);
  expect(JSON.stringify(stray.pages) === "[[1]]", "a page that is nobody's stays so (rough work)", stray.pages);

  console.log("The pages an answer is on");
  const { isRepeat, partPages } = await import("../answerCheck/regions");
  const long = { ...P([1, 2, 5], "169775 - a, b, c are in continued proportion.\nRHS = (ck + c)/ck\nii) LHS = (a - 4c)/(a - 2b)\nso ii) holds") };
  expect(partPages(long, [], new Map([[5, "169775 – a,b,c are in"], [1, "RHS = (ck+c)/ck"], [2, "ii) LHS = (a-4c)"]])).join() === "5,1,2", "pages are put in the order the text reads");
  expect(partPages(long, [2], new Map([[5, "169775 - a, b, c"], [1, "RHS = (ck + c)"]])).join() === "5,1", "a page the answer isn't on is dropped");
  expect(partPages(long, [], new Map([[5, "169775 - a, b, c"], [1, "something else"], [2, "ii) LHS ="]])).join() === "1,2,5", "one page's words not found: the reader's order is kept");
  expect(partPages({ ...long, text: "same words here x same words here y" }, [], new Map([[1, "same words here"], [2, "y"], [5, "x"]])).join() === "1,2,5", "words that come twice say nothing");
  expect(partPages(P([3], "a"), [3], new Map()).length === 0, "a part that is on no page has none");
  const copies = [P([2], "ii) LHS = (a-4c)/(a-2b)\nSubstituting values of a and b"), P([2], "Substituting values of a and b,"), P([1], "Substituting values of a and b,")];
  expect(isRepeat(copies, 1, 2) && !isRepeat(copies, 0, 2) && !isRepeat(copies, 2, 1), "a part that only repeats another's writing on the same page is left out");
  const moved = await locateParts({ costUsd: () => 0, async json(call: any) { return call.user.includes("Part 0") ? { places: [{ part: 0, row: 1, begins: "a b" }], notHere: [1] } : { places: [{ part: 1, row: 1, begins: "c" }] }; } }, [plain, plain], [P([1], "a b"), P([1, 2], "c d")]);
  const twice = await locateParts({ costUsd: () => 0, async json(call: any) { return { places: call.user.includes("Part 1") ? [{ part: 1, row: 1, begins: "RHS" }] : [{ part: 2, row: 1, begins: "Let" }] }; } }, [plain, plain], [P([1], "Substituting values, RHS = (ck + c)/ck = c(1 + k)/ck"), P([2], "RHS = (ck+c)/ck = c(1+k)/ck"), P([1], "Let the number be x")]);
  expect(JSON.stringify(twice.pages) === "[[2],[2],[1]]", "writing copied twice, once on a page it isn't on, has the page it was found on", twice.pages);
  const borrowed = await locateParts({ costUsd: () => 0, async json(call: any) { return { places: call.user.includes("Part 1") ? [{ part: 1, row: 1, begins: "ii) LHS" }, { part: 0, row: 2, begins: "Substituting values" }] : [{ part: 0, row: 1, begins: "RHS = (ck" }] }; } }, [plain, plain], [P([1, 2], "Substituting values RHS = (ck + c)/ck"), P([1], "ii) LHS = x Substituting values y")]);
  expect(JSON.stringify(borrowed.pages) === "[[2],[1]]" && borrowed.places.get(0)!.every(r => r.page === 2) && borrowed.places.get(1)![0].bottom > 0.7, "a line of another part isn't taken for a part that is on another page", borrowed.pages);
  expect(JSON.stringify(moved.pages) === "[[1],[2]]" && moved.places.get(1)!.every(r => r.page === 2), "corrected pages come with the places", moved.pages);

  console.log("The marked sheet");
  const step = { stepId: "s1", label: "State that it cannot be reduced further and write the final reduced ratio as 18/25", marks: 0.5, awarded: 0.5, comment: "" } as any;
  const base = { steps: [step], total: 1, maxMarks: 1, remark: "", needsTeacher: false };
  const height = async (b: Buffer) => (await sharp(b).metadata()).height!;
  const full = await height(await renderMarkedSheet({ ...base, pages: [plain] }));
  const cut = await renderMarkedSheet({ ...base, pages: [plain], bounds: [[{ top: 0.09, bottom: 0.2 }]] });
  expect(full >= 1100 && (await height(cut)) < 700, "with a boundary only the answer's part of the page is drawn", [full, await height(cut)]);
  const blue = await sharp(await sharp(cut).extract({ left: 300, top: Math.round(0.035 * 1125) - 2, width: 60, height: 4 }).toBuffer()).stats();
  expect(blue.channels[2].mean > blue.channels[0].mean + 60, "a boundary is drawn around it", blue.channels.map(c => Math.round(c.mean)));
  const mixed = await height(await renderMarkedSheet({ ...base, pages: [plain, plain], bounds: [[{ top: 0.1, bottom: 0.2 }], []] }));
  expect(mixed > 1100 && mixed < 2000, "a page without a boundary is shown whole", mixed);

  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll answer boundary checks passed");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
