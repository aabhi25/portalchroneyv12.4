/**
 * An answer sheet's pages arranged by question (shared/answerCheck.ts): Q1's page first, an
 * answer's pages never separated backwards, and page numbers that follow their pages.
 * Run: npx tsx server/services/__tests__/answerCheckPageOrder.test.ts
 */
import { pageOrderByQuestion, questionSpan, renumberPages } from "@shared/answerCheck";

let failed = 0;
function expect(got: unknown, want: unknown, label: string) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`  ok  ${label}`);
  else { failed++; console.error(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
const on = (...pages: number[]) => ({ pages });
const from = (...parts: number[]) => ({ parts });

// The client's real sheet, uploaded last page first: Q9 starts on page 5 and carries on to 1 and 2.
{
  const parts = [on(1), on(2), on(3), on(3), on(3), on(5), on(5), on(5), on(4), on(4), on(4), on(4), on(4)];
  const answers = [from(8), from(9), from(10), from(11), from(12), from(2), from(3), from(4, 5), from(6, 0, 1, 7)];
  expect(pageOrderByQuestion(5, parts, answers), [4, 3, 5, 1, 2], "pages uploaded last first are put in question order");
}
expect(pageOrderByQuestion(3, [on(1), on(2), on(3)], [from(0), from(1), from(2)]), [1, 2, 3], "pages already in order stay as they are");
expect(pageOrderByQuestion(3, [on(1), on(2), on(3)], [from(2), from(0), from(1)]), [3, 1, 2], "Q1 written last still comes first");
expect(pageOrderByQuestion(2, [on(1), on(1), on(2)], [from(2), from(0), from(1)]), [2, 1], "a page's earliest question decides its place");
expect(pageOrderByQuestion(2, [on(1), on(2), on(2)], [from(2), from(0, 1)]), [1, 2], "Q2's continuation with Q1 below it never comes before Q2's start");
expect(pageOrderByQuestion(2, [on(1, 2)], [from(0)]), [1, 2], "one part over two pages keeps them in order");
{
  // One part over three pages (Q2 starts on page 3): moved by hand, question order is found again.
  const parts = [on(3, 1, 2)];
  const byHand = [2, 3, 1];
  const moved = parts.map(p => ({ pages: renumberPages(p.pages, byHand) }));
  expect(pageOrderByQuestion(3, moved, [from(0)]).map(n => byHand[n - 1]), [3, 1, 2], "question order is found again after a change by hand");
}
expect(pageOrderByQuestion(4, [on(2), on(3), on(4)], [from(2), from(1), from(0)]), [1, 4, 3, 2], "a cover page stays first");
expect(pageOrderByQuestion(4, [on(1), on(3), on(4)], [from(2), from(0), from(1)]), [4, 1, 2, 3], "a page without answers stays after the page it follows");
expect(pageOrderByQuestion(3, [], []), [1, 2, 3], "nothing read: the order is kept");
expect(pageOrderByQuestion(2, [on(1), on(2), on(2), on(1)], [from(0, 1), from(2, 3)]), [1, 2], "answers that contradict each other still give every page once");
expect(pageOrderByQuestion(2, [on(1), on(7)], [from(1, 5), from(0)]), [1, 2], "page and part numbers that don't exist are ignored");

expect(renumberPages([1, 2, 5], [4, 3, 5, 1, 2]), [4, 5, 3], "page numbers follow their pages");
expect(renumberPages([5, 2, 4], [1, 2, 3, 4, 5]), [5, 2, 4], "a part keeps its pages as it reads");
expect(renumberPages(undefined, [2, 1]), [], "no page numbers");
expect(questionSpan(["1", "2", "3", "5"], ["1", "2", "3", "4", "5"]), "Q1–Q3, Q5", "questions in a row are shortened");
expect(questionSpan(["9", "8"], ["1", "8", "9"]), "Q8, Q9", "two questions are listed, in the paper's order");
expect(questionSpan(["x"], ["1"]), "", "no question on the page");

// Jumbled (an answer carries on to an earlier page) or only answered out of question order?
async function jumbled() {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused"; // never queried here
  const { carriesOnBackwards } = await import("../answerCheck/papers");
  const { parsePieces, piecesUserText } = await import("../answerCheck/prompts");
  expect(carriesOnBackwards([on(5), on(1), on(2)], [from(0, 1, 2)]), true, "Q9 on pages 5, 1, 2 is a jumble");
  expect(carriesOnBackwards([on(5, 1)], [from(0)]), true, "one part over pages 5, 1 too");
  expect(carriesOnBackwards([on(2), on(1)], [from(1), from(0)]), false, "Q2 answered before Q1 is not");
  expect(carriesOnBackwards([on(1), on(2), on(1)], [from(0, 1, 2)]), false, "a note back on the first page is not");
  expect(parsePieces({ order: ["B", "piece a", "C"] }, 3), [1, 0, 2], "the pieces' order");
  expect(parsePieces({ order: ["A", "A"] }, 2), null, "a piece given twice: no order");
  expect(parsePieces({ order: ["A"] }, 2), null, "a piece missing: no order");
  expect(parsePieces(null, 2), null, "no reply: no order");
  expect(piecesUserText({ number: "9", questionText: "Prove it" }, ["x", "y"]).includes('Piece B:\n"""\ny'), true, "the pieces are lettered");
}

jumbled().then(() => {
  if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll page order checks passed");
  process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
