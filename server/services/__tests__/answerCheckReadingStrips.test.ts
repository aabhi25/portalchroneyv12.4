/**
 * AI assessment — reading at full sharpness and answer keys that follow the model answer, the
 * parts with no AI and no database: a page enlarged and cut into overlapping strips for the reader
 * (a short photo sent whole), each photo named so page numbers stay page numbers, what
 * the reader is told about strips, what the answer-key writer is told when the model answer did
 * not earn full marks on its own key, and marks that contradict the marker's own comments.
 *
 *   npx tsx server/services/__tests__/answerCheckReadingStrips.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused";

let failed = 0;
let passed = 0;
function expect(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

async function main() {
  const sharp = (await import("sharp")).default;
  const { readingStrips, readerPhotos } = await import("../answerCheck/images");
  const { readPaperUserText, readUserText, STRIPS_NOTE, schemeCorrectionText, schemeSystem, markSystem, markContradictions, remarkNote } = await import("../answerCheck/prompts");
  const { openAiAnswerCheck } = await import("../answerCheck/ai");
  const { defaultAnswerCheckSettings } = await import("@shared/answerCheck");

  const page = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const sizes = async (strips: Buffer[]) => Promise.all(strips.map(async s => { const m = await sharp(s).metadata(); return [m.width, m.height]; }));

  console.log("A page as the reader sees it");
  {
    const phone = await sizes(await readingStrips(await page(981, 1280)));
    expect(phone.length === 4 && phone.every(([w, h]) => w === 1960 && h! <= 768) && phone.reduce((a, s) => a + s[1]!, 0) >= 2560 + 3 * 100, "a phone photo of a page is enlarged twice and cut into 4 overlapping strips, each small enough to stay sharp", phone);
    const full = await sizes(await readingStrips(await page(1500, 2000)));
    expect(full.length === 4 && full.every(([w, h]) => w === 1960 && h! <= 768), "a full-size page is enlarged less (to the same width) and cut the same way", full);
    const wide = await sizes(await readingStrips(await page(2000, 1500)));
    expect(wide.length === 3 && wide.every(([w, h]) => w === 1960 && h! <= 768), "a page photographed sideways is already wide enough: cut, not enlarged", wide);
    const slip = await sizes(await readingStrips(await page(1080, 326)));
    expect(slip.length === 1 && slip[0][0] === 1960 && slip[0][1]! <= 768, "a short strip of paper is enlarged and sent whole", slip);
    const narrow = await sizes(await readingStrips(await page(600, 1300)));
    expect(narrow.length === 4 && narrow.every(([w, h]) => w === 1200 && h! <= 768), "a narrow photo is enlarged no more than twice", narrow);
    const cut = await readingStrips(await page(1000, 1400));
    const last = await sharp(cut[cut.length - 1]).metadata();
    expect(cut.length === 5 && last.height! > 600, "the last strip is a full strip, not a sliver", [cut.length, last.height]);
    const photos = await readerPhotos([await page(981, 1280), await page(1080, 326)]);
    expect(photos.labels.join(" | ") === "Page 1, strip 1 of 4 | Page 1, strip 2 of 4 | Page 1, strip 3 of 4 | Page 1, strip 4 of 4 | Page 2" && photos.images.length === 5 && photos.strips, "each photo is named by its page, so page numbers stay page numbers", photos.labels);
    const small = await readerPhotos([await page(900, 300)]);
    expect(small.labels.join() === "Page 1" && !small.strips, "a sheet of short photos has no strips");
  }

  console.log("What the reader is told");
  {
    const q = { board: "CBSE", grade: "9", medium: "English", subject: "Mathematics", chapter: null };
    expect(readPaperUserText(q, 5, true).includes("show the 5 pages") && readPaperUserText(q, 5, true).includes(STRIPS_NOTE) && !readPaperUserText(q, 5).includes("strip"), "the strips are explained only when there are strips");
    expect(readUserText(q, 1, true).includes("show the page of") && readUserText(q, 2, true).includes("the 2 pages, in order,") && !readUserText(q, 1).includes("strip"), "and for a single answer too");
    expect(/copy each line once/.test(STRIPS_NOTE) && /never the strips/.test(STRIPS_NOTE), "overlapping lines are copied once; pages are counted, not strips");
    const sent: any[] = [];
    const ai = openAiAnswerCheck({ chat: { completions: { create: async (body: any) => { sent.push(body); return { choices: [{ message: { content: "{}" } }] }; } } } } as any);
    await ai.json({ model: "gpt-4.1", system: "s", user: "u", images: ["data:image/jpeg;base64,AA", "data:image/jpeg;base64,BB"], imageLabels: ["Page 1, strip 1 of 2", "Page 1, strip 2 of 2"], maxTokens: 10 });
    const content = sent[0].messages[1].content;
    expect(content.map((c: any) => c.type).join() === "text,text,image_url,text,image_url" && content[1].text === "Page 1, strip 1 of 2" && content[3].text === "Page 1, strip 2 of 2", "each photo's name is said just before it", content.map((c: any) => c.text || c.type));
    await ai.json({ model: "gpt-4.1", system: "s", user: "u", images: ["data:image/jpeg;base64,AA"], maxTokens: 10 });
    expect(sent[1].messages[1].content.map((c: any) => c.type).join() === "text,image_url", "photos without names go as before");
    expect(sent[0].temperature === 0 && sent[0].max_tokens === 10 && !("reasoning_effort" in sent[0]), "GPT-4 models get a temperature");
    await ai.json({ model: "gpt-6-luna", system: "s", user: "u", maxTokens: 10, temperature: 0.7 });
    await ai.json({ model: "gpt-6-luna", effort: "high", system: "s", user: "u", maxTokens: 10 });
    expect(sent[2].reasoning_effort === "none" && sent[2].max_completion_tokens === 10 && !("temperature" in sent[2]) && !("max_tokens" in sent[2]) && sent[3].reasoning_effort === "high" && sent[3].max_completion_tokens > 1000, "newer models get how hard to think, with room for it, and no temperature", sent[3]);
    // A key without access to the newer models: GPT-4.1 for the rest of the check.
    const models: string[] = [];
    const noLuna = openAiAnswerCheck({ chat: { completions: { create: async (body: any) => { models.push(body.model); if (body.model !== "gpt-4.1") throw Object.assign(new Error("403 Project `p` does not have access to model `gpt-6-luna`"), { status: 403 }); return { choices: [{ message: { content: '{"ok":1}' } }], usage: { prompt_tokens: 1000, completion_tokens: 0 } }; } } } } as any);
    const one = await noLuna.json({ model: "gpt-6-luna", system: "s", user: "u", maxTokens: 10 });
    await noLuna.json({ model: "gpt-6-luna", system: "s", user: "u", maxTokens: 10 });
    expect(one?.ok === 1 && models.join() === "gpt-6-luna,gpt-4.1,gpt-4.1" && Math.abs(noLuna.costUsd() - 0.004) < 1e-9, "a key that can't use a model falls back, tried once, at the fallback's price", [models, noLuna.costUsd()]);
    const refused = await openAiAnswerCheck({ chat: { completions: { create: async () => { throw Object.assign(new Error("401 Incorrect API key provided"), { status: 401 }); } } } } as any).json({ model: "gpt-6-luna", system: "s", user: "u", maxTokens: 10 }).catch((e: any) => e.status);
    expect(refused === 401, "any other refusal is passed on");
    const { estimateTextCostUsd } = await import("../aiUsageLogger");
    expect(Math.abs(estimateTextCostUsd("gpt-6-luna", 1e6, 1e6) - 0.6) < 1e-9 && Math.abs(estimateTextCostUsd("gpt-6.1-terra", 1e6, 1e6) - 6) < 1e-9, "the newer models are costed at their own prices");
  }

  console.log("Answer keys follow the model answer");
  {
    const text = schemeCorrectionText([{ label: "Write the final answer in words", marks: 0.5, awarded: 0, comment: "Did not write final answer in words." }, { label: "Units", marks: 1, awarded: 0.5, comment: "" }]);
    expect(text.includes('"Write the final answer in words" (0 of 0.5) — Did not write final answer in words.') && text.includes('"Units" (0.5 of 1)') && /full-marks standard/.test(text) && /adding up to the maximum marks/.test(text), "the writer is told which steps the model answer did not earn, and what to do", text);
    expect(/full-marks standard/.test(schemeSystem()) && /closing sentence in words/.test(schemeSystem()) && /Never one step that stands for several/.test(schemeSystem()), "the rule is in the answer-key instructions: nothing the model answer doesn't do, one step per point");
    const marker = markSystem(defaultAnswerCheckSettings());
    expect(/all five right in a 5-mark step → 5/.test(marker), "the marker adds up a step that covers several points");
    expect(/a final-answer step with a wrong value gets 0/.test(marker) && /If your comment on a step says it is wrong, incorrect or missing, its marks are 0/.test(marker), "a step the marker itself calls wrong earns nothing (a wrong final answer had been given its mark 4 times in 5)");
  }

  console.log("Marks and comments must agree");
  {
    const step = (awarded: number, marks: number, comment: string, label = "Gives the final answer: 60°") => ({ label, marks, awarded, comment });
    const check = (steps: ReturnType<typeof step>[], finalAnswerCorrect: boolean | null = null, extra: Record<string, unknown> = {}) =>
      markContradictions({ finalAnswerCorrect }, { steps, total: steps.reduce((a, s) => a + s.awarded, 0), maxMarks: steps.reduce((a, s) => a + s.marks, 0), ...extra });
    const wrongKept = check([step(1, 1, "Final answer given with unit, but value is wrong.")]);
    expect(wrongKept.length === 1 && wrongKept[0].includes("full 1 mark") && wrongKept[0].includes("value is wrong"), "full marks on a step the comment calls wrong", wrongKept);
    expect(check([step(1, 1, "Normal not drawn or labelled.", "Draws the normal")]).length === 1 && check([step(2, 2, "Did not simplify the ratio.", "Simplifies")]).length === 1, "…or missing, or not done");
    expect(check([step(1, 1, "Correct, nothing is missing.")]).length === 0 && check([step(1, 1, "Correct; no mistakes.")]).length === 0 && check([step(1, 1, "")]).length === 0, "a full-marks step that is simply right is fine (\"nothing is missing\" is not a fault)");
    expect(check([step(1, 1, "Answer written clearly.")], false).length === 1 && check([step(1, 1, "Answer written clearly.")], true).length === 0 && check([step(1, 1, "Sets up the equation", "Sets up the equation")], false).length === 0, "a final-answer step with full marks when the marker says the final answer is not correct");
    const praised = check([step(1, 5, "Correct, relevant sentence with capital and full stop.", "Each correct sentence, 1 mark each")]);
    expect(praised.length === 1 && praised[0].includes("only 1 of its 5 marks"), "marks cut on a step whose comment only says it is right (the live pilot's 1 of 5 with \"Excellent work\")", praised);
    expect(check([step(1, 2, "Only one water animal named.", "Names two animals")]).length === 0 && check([step(0.5, 1, "Correct formula, substitution incomplete.", "Formula and substitution")]).length === 0 && check([step(0, 1, "", "Units")]).length === 0 && check([step(0, 1, "Second law missing.", "Second law")]).length === 0, "marks cut with a reason, or with no comment at all, are fine");
    expect(check([step(0, 1, "Correct final answer.", "Working")], true, { finalAnswerOnlyApplied: true }).length === 0, "the right-answer-without-working rule is not second-guessed");
    const note = remarkNote(wrongKept);
    expect(note.includes("contradicts itself") && note.includes("value is wrong") && /Mark the answer again/.test(note), "the marker is told where its marking contradicts itself", note);
  }

  if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
  console.log(`\nAll ${passed} reading and answer-key checks passed.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
