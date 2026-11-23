import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, Loader2, Wand2, ZoomIn } from "lucide-react";
import { pageOrderByQuestion, questionSpan } from "@shared/answerCheck";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel } from "@/components/agency/agencyUi";
import { usePageViewer } from "./PageViewer";
import { SortableTiles } from "./SortableTiles";
import { API, imageUrl, paperRunning, type PaperView } from "./answerCheckApi";

type Page = PaperView["pages"][number];

/** The questions answered on a page: "Q1–Q5" ("" when none was found there). */
export function questionsOnPage(p: PaperView, position: number): string {
  const numbers = p.checks.filter(c => !c.reading?.notAttempted && c.reading?.pages?.includes(position + 1)).map(c => c.questionNumber ?? "");
  return questionSpan(numbers, p.questions.map(q => q.number));
}

/** Pages for the viewer, named by page (and by the questions on them, for a whole sheet). */
export const viewerPages = (pages: Page[], sheet?: PaperView) => pages.map(p => {
  const questions = sheet ? questionsOnPage(sheet, p.position) : "";
  return { src: imageUrl(p.id), label: `Page ${p.position + 1}${questions ? ` · ${questions}` : ""}` };
});

/** The answer sheet, its pages in question order: open a page here to zoom in, or put the pages in another order. */
export function SheetPages({ p, off }: { p: PaperView; off: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { open, viewer } = usePageViewer();
  const [draft, setDraft] = useState<Page[] | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "check">("");
  const running = paperRunning(p.status);
  const byQuestion = p.reading && p.matching ? pageOrderByQuestion(p.pages.length, p.reading.parts, p.matching.answers).map(n => p.pages[n - 1]) : null;
  // A sheet read again has other results: start from its saved order.
  useEffect(() => { if (running) setDraft(null); }, [running]);

  const differs = (a: Page[], b: Page[]) => a.some((x, i) => x.id !== b[i]?.id);
  const moved = !!draft && differs(draft, p.pages);
  async function save(checkAgain: boolean) {
    if (!draft) return;
    if (checkAgain && !window.confirm("Save this order and check the whole sheet again? This paper's current results — including any teacher marks — are replaced.")) return;
    setBusy(checkAgain ? "check" : "save");
    try {
      await apiRequest("PUT", `${API}/papers/${p.id}/pages`, { order: draft.map(d => d.id), checkAgain });
      await qc.invalidateQueries({ queryKey: [`${API}/papers/${p.id}`] });
      p.checks.forEach(c => qc.removeQueries({ queryKey: [`${API}/checks/${c.id}`] }));
      setDraft(null);
      toast({ title: checkAgain ? "Order saved — checking the sheet again" : "Order saved" });
    } catch (e: any) { toast({ title: "That didn't work", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  }

  const actions = draft ? (
    <>
      {byQuestion && differs(draft, byQuestion) && <Button size="sm" variant="outline" onClick={() => setDraft(byQuestion)} disabled={!!busy} data-testid="pages-by-question"><Wand2 className="mr-1.5 h-3.5 w-3.5" />Question order</Button>}
      <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={!!busy} data-testid="pages-cancel">Cancel</Button>
      <Button size="sm" variant="outline" onClick={() => save(true)} disabled={!moved || !!busy || off} data-testid="pages-save-check">{busy === "check" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save and check again</Button>
      <Button size="sm" onClick={() => save(false)} disabled={!moved || !!busy} data-testid="pages-save">{busy === "save" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save order</Button>
    </>
  ) : p.pages.length > 1 && (
    <Button size="sm" variant="outline" onClick={() => setDraft(p.pages)} disabled={running} data-testid="pages-arrange"><ArrowDownUp className="mr-1.5 h-3.5 w-3.5" />Change order</Button>
  );
  const grid = "grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

  return (
    <Panel
      title="The answer sheet"
      subtitle={draft ? "Drag the pages, or use the arrows. Saving keeps the marks; “Save and check again” also reads and marks the sheet afresh." : `${p.reading?.arranged === "manual" && byQuestion && differs(p.pages, byQuestion) ? "In the order saved by hand." : p.checks.length ? "Arranged by question, Q1 first." : ""} Click a page to open it here and zoom in.`.trim()}
      actions={actions}
    >
      {!draft && p.checks.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5" data-testid="pages-questions">
          <span className="mr-1 text-[13px] text-gray-500">Go to</span>
          {p.checks.map(c => {
            const first = c.reading?.notAttempted ? undefined : c.reading?.pages?.[0];
            return (
              <button key={c.id} type="button" disabled={!first} title={first ? `Page ${c.reading!.pages!.join(", ")}` : "Not attempted"} onClick={() => open(viewerPages(p.pages, p), first! - 1)} data-testid={`pages-question-${c.questionNumber}`}
                className="rounded-full border border-black/[0.08] bg-white px-2.5 py-0.5 text-[13px] font-medium text-gray-800 hover:border-violet-400 hover:text-violet-700 disabled:border-transparent disabled:bg-gray-50 disabled:text-gray-300">
                Q{c.questionNumber}
              </button>
            );
          })}
        </div>
      )}
      {draft
        ? <SortableTiles items={draft} onChange={setDraft} className={grid} testId="paper-pages-arrange" render={(pg, i) => (
            <PageTile src={imageUrl(pg.id)} label={`Page ${i + 1}`} questions={questionsOnPage(p, pg.position)} note={pg.position === i ? undefined : `was page ${pg.position + 1}`} onOpen={() => open(draft.map((d, j) => ({ src: imageUrl(d.id), label: `Page ${j + 1}` })), i)} />
          )} />
        : (
          <div className={grid} data-testid="paper-pages">
            {p.pages.map((pg, i) => <PageTile key={pg.id} src={imageUrl(pg.id)} label={`Page ${pg.position + 1}`} questions={questionsOnPage(p, pg.position)} onOpen={() => open(viewerPages(p.pages, p), i)} />)}
          </div>
        )}
      {!p.pages.length && <p className="text-[14px] text-gray-500">{p.status === "writing" ? "The practice sheet is being drawn…" : "No pages."}</p>}
      {viewer}
    </Panel>
  );
}

function PageTile({ src, label, questions, note, onOpen }: { src: string; label: string; questions: string; note?: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group block w-full text-left" aria-label={`Open ${label}${questions ? `, ${questions}` : ""}`}>
      <span className="relative block aspect-[3/4] overflow-hidden rounded-lg border bg-gray-50 group-hover:border-violet-300">
        <img src={src} alt={label} draggable={false} loading="lazy" className="h-full w-full object-contain" />
        <span className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100"><ZoomIn className="h-4 w-4" /></span>
      </span>
      <span className="mt-1.5 block text-center">
        {questions && <span className="block text-[14px] font-semibold text-gray-900">{questions}</span>}
        <span className="block text-[12px] text-gray-500">{label}{note && <span className="text-violet-700"> · {note}</span>}</span>
      </span>
    </button>
  );
}
