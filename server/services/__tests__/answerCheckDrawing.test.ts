/**
 * Answer checking pilot — the pictures drawn in code: practice answer sheets in handwriting
 * (English and Hindi, long answers over two pages, the same answer always draws the same page)
 * and the marked sheet (total, a mark for every step, several pages). No database, no AI.
 * Set ANSWER_CHECK_DRAW_OUT=<folder> to save the pictures and look at them.
 *
 *   npx tsx server/services/__tests__/answerCheckDrawing.test.ts
 */
import fs from "fs";
import path from "path";
import { renderMarkedSheet, renderPracticeSheet, wrapLines } from "../answerCheck/drawing";

let failed = 0;
let passed = 0;
function expect(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok  ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

const out = process.env.ANSWER_CHECK_DRAW_OUT;
function save(name: string, buf: Buffer) {
  if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, name), buf); }
}

async function size(buf: Buffer) {
  const sharp = (await import("sharp")).default;
  const m = await sharp(buf).metadata();
  return { w: m.width || 0, h: m.height || 0, format: m.format };
}

async function main() {
  console.log("Wrapping lines");
  {
    const measure = (s: string) => s.length * 10;
    const lines = wrapLines("one two three four five six", 100, measure);
    expect(lines.every(l => measure(l) <= 100) && lines.join(" ") === "one two three four five six", "lines fit and keep every word", lines);
    expect(wrapLines("a\n\nb", 100, measure).join("|") === "a||b", "the writer's own blank lines are kept");
    expect(wrapLines("x".repeat(25), 100, measure).length === 3, "one very long word is cut to fit");
    expect(wrapLines("", 100, measure).length === 0, "nothing to write → no lines");
  }

  console.log("Practice sheets");
  {
    const en = await renderPracticeSheet({
      text: "2x + 4 = 10\n2x = 10 - 4\n2x = 6\nx = 6/2\nso x = 3",
      studentLabel: "Name: Practice student A", questionLabel: "Q. Solve 2x + 4 = 10 (5 marks)", seed: "s1",
    });
    const s = await size(en[0]);
    expect(en.length === 1 && s.format === "jpeg" && s.h > s.w, "short English answer → one upright JPEG page", s);
    save("practice-en.jpg", en[0]);
    const again = await renderPracticeSheet({
      text: "2x + 4 = 10\n2x = 10 - 4\n2x = 6\nx = 6/2\nso x = 3",
      studentLabel: "Name: Practice student A", questionLabel: "Q. Solve 2x + 4 = 10 (5 marks)", seed: "s1",
    });
    expect(again[0].equals(en[0]), "the same answer draws the same page");
    const hi = await renderPracticeSheet({
      text: "प्रकाश संश्लेषण वह प्रक्रिया है जिसमें हरे पौधे सूर्य के प्रकाश की उपस्थिति में कार्बन डाइऑक्साइड और पानी से भोजन बनाते हैं। इसमें क्लोरोफिल की आवश्यकता होती है।",
      studentLabel: "Name: Practice student B", questionLabel: "Q. प्रकाश संश्लेषण क्या है?", seed: "s2",
    });
    expect(hi.length === 1, "Hindi answer draws");
    save("practice-hi.jpg", hi[0]);
    const long = await renderPracticeSheet({
      text: Array.from({ length: 30 }, (_, i) => `Point ${i + 1}: one more idea.`).join("\n"),
      studentLabel: "Name: Practice student C", questionLabel: "Q. Long answer", seed: "s3",
    });
    expect(long.length === 2, "a long answer continues on a second page", long.length);
    save("practice-long-2.jpg", long[1]);
  }

  console.log("Marked sheet");
  {
    const pages = await renderPracticeSheet({ text: "2x + 4 = 10\n2x = 6\nx = 6/2", studentLabel: "Name: A", questionLabel: "Q1", seed: "m1" });
    const steps = [
      { stepId: "eq", label: "Writes the original equation", marks: 1, awarded: 1, comment: "Correct" },
      { stepId: "move", label: "Moves 4 to the other side", marks: 1, awarded: 1, comment: "" },
      { stepId: "simp", label: "Simplifies to 2x = 6", marks: 1, awarded: 1, comment: "" },
      { stepId: "div", label: "Divides by 2", marks: 1, awarded: 0.5, comment: "Division shown but not completed" },
      { stepId: "final", label: "States x = 3", marks: 1, awarded: 0, comment: "Final value of x not written" },
    ];
    const marked = await renderMarkedSheet({ pages, steps, total: 3.5, maxMarks: 5, remark: "Good start. Always finish with the final value, x = 3.", needsTeacher: false });
    const s = await size(marked);
    expect(s.format === "jpeg" && s.w === 1320, "marked sheet = page + red strip", s);
    save("marked.jpg", marked);
    const many = Array.from({ length: 12 }, (_, i) => ({ stepId: `s${i}`, label: `A rather long step description number ${i + 1} that needs two lines`, marks: 1, awarded: i % 2, comment: "Explain this point with an example from the chapter please" }));
    const tall = await renderMarkedSheet({ pages: pages.slice(0, 1), steps: many, total: 6, maxMarks: 12, remark: "Teacher remark", needsTeacher: true });
    const t = await size(tall);
    expect(t.h > 1400, "many steps make the strip (and picture) taller than the page", t);
    save("marked-tall.jpg", tall);
    const two = await renderMarkedSheet({ pages: [pages[0], pages[0]], steps: steps.slice(0, 2), total: 2, maxMarks: 2, remark: "", needsTeacher: false });
    const t2 = await size(two);
    expect(t2.h > s.h * 1.8, "two pages are stacked", { two: t2, one: s });
  }

  if (failed > 0) { console.error(`\n${failed} check(s) failed, ${passed} passed.`); process.exit(1); }
  console.log(`\nAll ${passed} drawing checks passed.`);
}

main().catch(err => { console.error(err); process.exit(1); });
