/**
 * AI Tutor — pure checks for the board model, board-op cleaning, lesson validation, question
 * checks, the daily limit and the lesson pack (with a fake content reader).
 * Run: npx tsx server/services/tutor/__tests__/tutorPlan.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused"; // never queried here

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
}

async function main() {
  const { applyOps, emptyBoard } = await import("@shared/tutorBoard");
  const { sanitizeOps } = await import("../boardOps");
  const { validateOutline, validateSection, checksFor } = await import("../lessonPlanner");
  const { buildLessonPack, isUsableCheck, mediaProxyUrl } = await import("../lessonPack");
  const { istDay, remainingSeconds, tutorStudentKey } = await import("../usage");

  // ── board model ──
  let b = applyOps(emptyBoard(), [
    { op: "write", id: "t1", text: "Pythagoras", style: "title", color: "ink" },
    { op: "math", id: "f1", tex: "a^2+b^2=c^2" },
  ]);
  expect(b.elements.length === 2 && b.page === 0, "write + math add two elements");
  b = applyOps(b, [{ op: "highlight", target: "f1", mode: "underline" }]);
  expect(b.highlights.length === 1 && b.highlights[0].target === "f1", "highlight points at an element");
  b = applyOps(b, [{ op: "highlight", target: "nope", mode: "circle" }]);
  expect(b.highlights[0].target === "f1", "a highlight on something not on the board is ignored");
  b = applyOps(b, [{ op: "erase", target: "f1" }]);
  expect(b.elements.length === 1 && b.highlights.length === 0, "erase removes the element and its highlight");
  b = applyOps(b, [{ op: "clear" }]);
  expect(b.elements.length === 0 && b.page === 1, "clear starts a new page");

  // ── cleaning ops ──
  const media = (id: string) => (id === "m1" ? { src: mediaProxyUrl("https://cdn.example.com/a.png"), caption: "Map" } : null);
  let r = sanitizeOps([
    { op: "image", id: "i1", mediaId: "m1" },
    { op: "image", id: "i2", mediaId: "m9" },
    { op: "image", id: "i3", mediaId: "m1", src: "https://evil.example.com/x.png" },
    { op: "math", id: "f1", tex: "\\frac{1}{2" },
    { op: "math", id: "f2", tex: "\\href{https://x.com}{x}" },
    { op: "write", id: "w1", text: "" },
  ], emptyBoard(), media, 10);
  const img = r.ops.filter((o) => o.op === "image") as any[];
  expect(img.length === 2 && img.every((o) => o.src.startsWith("/api/topscholar/media-proxy?url=")), "images: only chapter figures, src always set by the server (model URLs replaced)", img);
  expect(r.ops.some((o) => o.op === "write" && (o as any).id === "f1"), "broken TeX is written as text instead");
  expect(!r.ops.some((o) => o.op === "math" && (o as any).id === "f2"), "unsafe TeX (\\href) is not rendered as maths");
  expect(!r.ops.some((o) => (o as any).id === "w1"), "an empty write is dropped");

  r = sanitizeOps([
    { op: "diagram", id: "g1", kind: "geometry", points: { A: [1, 20], B: [-3, 1], C: [7, 1] }, segments: [["A", "B"], ["B", "Z"]], angles: [{ at: "B", mark: "right" }, { at: "Q", mark: "arc" }] },
    { op: "highlight", target: "g1", part: "A-B", mode: "circle" },
    { op: "highlight", target: "g1", part: "X-Y", mode: "circle" },
    { op: "highlight", target: "missing", mode: "circle" },
    { op: "diagram", id: "d1", kind: "flow", nodes: [{ id: "a", label: "Union" }, { id: "b", label: "States" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "zz" }] },
  ], emptyBoard(), media, 10);
  const g = r.ops.find((o) => (o as any).id === "g1") as any;
  expect(g && g.points.A[1] === 10 && g.points.B[0] === 0, "geometry is clamped to the 0–10 grid", g?.points);
  expect(g && g.segments.length === 1 && g.angles.length === 1, "geometry keeps only segments and angles between its own points");
  expect(r.ops.filter((o) => o.op === "highlight").length === 1, "highlights must point at an existing element / part");
  const flow = r.ops.find((o) => (o as any).id === "d1") as any;
  expect(flow && flow.edges.length === 1, "flow edges must join existing nodes");

  // crowded board → a new page
  let crowded = emptyBoard();
  for (let i = 0; i < 40; i++) crowded = applyOps(crowded, [{ op: "write", id: `w${i}`, text: `line ${i}`, style: "body", color: "ink" }]);
  r = sanitizeOps([{ op: "write", id: "more", text: "one more" }], crowded, media);
  expect(r.ops[0].op === "clear" && r.board.elements.length === 1, "a full board (40 things) starts a new page first");

  // ── the lesson pack (fake reader) ──
  const chunk = (id: string, contentType: string, contentText: string, metadata: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    ({ id, contentType, chapter: "Triangles", title: `${contentType} ${id}`, contentHtml: null, contentText, sourceRef: null, mediaUrl: null, metadata, createdAt: new Date(), ...extra }) as any;
  const data: Record<string, any[]> = {
    note: [
      chunk("n1", "note", "A right-angled triangle has one angle of 90 degrees. The side opposite the right angle is the hypotenuse.", { concept: "Right triangles", images: [{ url: "https://cdn.example.com/tri.png", caption: "A right triangle" }] }),
      chunk("n2", "note", "Pythagoras theorem: in a right triangle the square of the hypotenuse equals the sum of the squares of the other two sides.", { concept: "Pythagoras theorem" }),
      chunk("n3", "note", "short"),
    ],
    transcript: [chunk("t1", "transcript", "In this video we prove the theorem using similar triangles step by step.", {}, { mediaUrl: "https://video.example.com/v.mp4" })],
    ebook_page: [],
    question: [
      chunk("q1", "question", "In a right triangle with legs 3 and 4, the hypotenuse is", { options: [{ text: "5", isCorrect: true }, { text: "6", isCorrect: false }, { text: "7", isCorrect: false }], solution: "3²+4²=25, so 5", concept: "Pythagoras theorem" }),
      chunk("q2", "question", "Explain the theorem in your own words.", { questionType: "subjective" }),
      chunk("q3", "question", "Which is the longest side?", { options: [{ text: "hypotenuse", isCorrect: true }, { text: "base", isCorrect: true }] }),
    ],
  };
  const reader = {
    chapters: async (cpId: string) => (cpId === "cp1" ? [{ chapter: "Triangles " }, { chapter: "Circles" }] : [{ chapter: "TRIANGLES" }]),
    chunks: async (cpId: string, _ch: string, type: string, page: number) => ({ items: page === 1 && cpId === "cp1" ? data[type] : [], total: cpId === "cp1" ? data[type].length : 0 }),
  };
  const pack = await buildLessonPack({ cfg: { storeType: "pgvector" } as any, businessAccountId: "acc", cpIds: ["cp1", "cp2", "cp1"], chapter: "  triangles", reader });
  expect(pack.cpIds.join(",") === "cp1,cp2", "packages are de-duplicated and sorted");
  expect(pack.sources.length === 3 && pack.sources.every((s) => /^c\d+$/.test(s.id)), "notes and transcripts become sources c1…; too-short text is skipped", pack.sources.map((s) => s.id));
  expect(pack.questions.length === 3 && pack.media.length === 1 && pack.media[0].id === "m1" && pack.media[0].src.startsWith("/api/topscholar/media-proxy"), "questions q1… and figures m1… (proxied, not the raw URL; video URLs are not figures)", pack.media);
  expect(pack.questions.filter(isUsableCheck).length === 1, "only MCQs with exactly one correct option can be checks");
  expect(/^[0-9a-f]{32}$/.test(pack.versionKey), "the pack has a content version key");

  // ── outline validation ──
  const outline = validateOutline({
    title: "Right triangles",
    intro: ["Hi! Today we learn Pythagoras."],
    sections: [
      { title: "What is a right triangle", sourceIds: ["c1", "c99"], questionIds: ["q1", "q77"], mediaIds: ["m1", "m5"] },
      { title: "Made up", sourceIds: ["c42"] },
      { title: "The theorem", sourceIds: ["c2", "c3"], questionIds: ["q1"] },
    ],
    recap: ["Remember the hypotenuse."],
  }, pack);
  expect(!!outline && outline.sections.length === 2, "sections citing no real source are dropped", outline?.sections.map((s) => s.title));
  expect(outline!.sections[0].sourceIds.join() === "c1" && outline!.sections[0].questionIds.join() === "q1" && outline!.sections[0].mediaIds.join() === "m1", "unknown source / question / figure ids are removed");
  expect(outline!.sections.map((s) => s.id).join() === "s1,s2", "section ids are renumbered");
  expect(validateOutline({ title: "x", intro: [], sections: [], recap: [] }, pack) === null, "an outline without sections is rejected");

  // ── section validation ──
  const section = validateSection({
    lines: [
      { say: "Let's start with a right triangle.", ops: [{ op: "clear" }, { op: "write", id: "t1", text: "Right triangles", style: "title" }, { op: "image", id: "i1", mediaId: "m1" }] },
      { say: "This corner is ninety degrees.", ops: [{ op: "diagram", id: "g1", kind: "geometry", points: { A: [1, 6], B: [1, 1], C: [7, 1] }, segments: [["A", "B"], ["B", "C"], ["A", "C"]], angles: [{ at: "B", mark: "right" }] }, { op: "highlight", target: "g1", part: "A-C" }] },
    ],
    simpler: [{ say: "Think of the corner of a book.", ops: [{ op: "image", id: "i9", mediaId: "m2" }] }],
  }, pack, ["m1"]);
  expect(!!section && section.script.lines.length === 2 && section.script.lines[1].ops.length === 2, "a section keeps its lines and valid ops (highlight after the diagram it points at)");
  expect(section!.script.simpler[0].ops.length === 0, "a figure not chosen for this section is dropped");
  expect(validateSection({ lines: [{ say: "only one", ops: [] }] }, pack, []) === null, "a section needs at least two lines");

  // ── formulas written as handwriting become maths ──
  {
    const { formulaToTex, upgradeFormulaOps } = await import("../boardOps");
    const w = (text: string, style = "body") => ({ op: "write", id: "f", text, style, color: "ink" }) as any;
    const up = (text: string, style?: string) => upgradeFormulaOps([w(text, style)])[0] as any;
    expect(up("Distance d = sqrt((x2 - x1)^2 + (y2 - y1)^2)").tex === "\\text{Distance } d = \\sqrt{(x_{2} - x_{1})^{2} + (y_{2} - y_{1})^{2}}", "sqrt( … ), powers and x1 → TeX (words kept upright)", up("Distance d = sqrt((x2 - x1)^2 + (y2 - y1)^2)").tex);
    expect(up("d = 3√5").tex === "d = 3\\sqrt{5}" && up("a² + b² = c²").tex === "a^{2} + b^{2} = c^{2}", "√ and ² become TeX");
    expect(up("A(x1, y1), B(x2, y2)").tex === "A(x_{1}, y_{1}), B(x_{2}, y_{2})", "point names get subscripts");
    expect(up("Hypotenuse is the longest side").op === "write" && up("Class 10 notes").op === "write", "sentences stay handwriting");
    expect(up("a² + b² = c²", "title").op === "write", "titles stay handwriting");
    expect(up("sqrt((1 + 2)").op === "write" && formulaToTex("sqrt((1 + 2)") === null, "an unbalanced bracket is left as written");
    const cleaned = sanitizeOps([{ op: "write", id: "z", text: "d = sqrt(9 + 36)", style: "body" }], emptyBoard(), () => null);
    expect(cleaned.ops[0]?.op === "math" && cleaned.board.elements[0]?.id === "z", "new plans: formula text is stored as a math op (same id, so highlights still work)", cleaned.ops);
  }

  // ── checks come from the question bank ──
  const checks = checksFor(pack.questions, ["q1", "q2", "q3"]);
  expect(checks.length === 1 && checks[0].correctIndex === 0 && checks[0].options.join() === "5,6,7", "checks: only usable MCQs, answer key from the bank", checks);

  // ── daily limit ──
  expect(istDay(new Date("2026-10-20T18:29:00Z")) === "2026-10-20" && istDay(new Date("2026-10-20T18:31:00Z")) === "2026-10-21", "the day changes at midnight India time");
  expect(remainingSeconds(20, 600) === 600 && remainingSeconds(20, 5000) === 0, "remaining seconds never go below zero");
  expect(tutorStudentKey("S123", "v1") === "student:S123" && tutorStudentKey(null, "v1") === "visitor:v1" && tutorStudentKey("", "") === "visitor:anonymous", "usage is counted per student, else per visitor");

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll tutor plan checks passed.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
