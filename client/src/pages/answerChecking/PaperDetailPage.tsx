import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileCheck2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel, Stat } from "@/components/agency/agencyUi";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { AssessmentOffBanner, useAssessmentOn } from "./AssessmentSwitch";
import { AnswerPane } from "./AnswerPane";
import { usePageViewer } from "./PageViewer";
import { SheetPages, viewerPages } from "./SheetPages";
import { ASSESS_PATH,
  API, LEVEL_LABEL, PAPER_STATUS_LABEL, PAPER_STATUS_STYLE, STATUS_LABEL, STATUS_STYLE, fmtMarks, isRunning, paperRunning,
  type CheckView, type PaperView,
} from "./answerCheckApi";

/** Super admin › Answer checking › one whole paper: totals, each question's answer and the sheet. */
export default function PaperDetailPage({ paperId }: { paperId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [busy, setBusy] = useState("");
  const { on, overview } = useAssessmentOn();
  const off = on === false;
  const key = [`${API}/papers/${paperId}`];
  const { data, isLoading, isError } = useQuery<{ paper: PaperView }>({
    queryKey: key,
    refetchInterval: q => (q.state.data && (paperRunning(q.state.data.paper.status) || q.state.data.paper.locating) ? 2500 : false),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const p = data?.paper;
  const back = p?.assessmentId
    ? { label: "Back to the assessment", href: `${ASSESS_PATH}/${p.assessmentId}` }
    : { label: "Assessment", href: ASSESS_PATH };

  async function act(name: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(name);
    try { await fn(); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: [`${API}/papers`] }); if (done) toast({ title: done }); }
    catch (e: any) { toast({ title: "That didn't work", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  }

  const running = p ? paperRunning(p.status) : false;
  return (
    <>
      <SaHeader
        icon={FileCheck2}
        tint="bg-orange-500"
        kind="Assessment · whole paper"
        title={p ? `${p.studentLabel || "Student"}${p.rollNo ? ` (roll no. ${p.rollNo})` : ""}` : "Answer sheet"}
        subtitle={p ? `${p.title || "Paper"} · ${p.questions.length} questions · ${p.pages.length} page${p.pages.length === 1 ? "" : "s"}${p.source === "practice" ? " · sample sheet written by the AI" : ""}` : undefined}
        back={back}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {p && (
              <>
                <Button size="sm" variant="outline" disabled={running || off || !!busy} data-testid="paper-rerun"
                  onClick={() => { if (window.confirm("Read the whole sheet again? This paper's current results — including any teacher marks — are replaced.")) act("rerun", () => apiRequest("POST", `${API}/papers/${p.id}/rerun`), "Reading the sheet again"); }}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />{p.status === "failed" ? "Try again" : "Read again"}
                </Button>
                <Button size="sm" variant="ghost" disabled={!!busy} data-testid="paper-delete"
                  onClick={() => { if (window.confirm("Delete this paper, its pages and all its answers' marks? This can't be undone.")) act("delete", async () => { await apiRequest("DELETE", `${API}/papers/${p.id}`); setLocation(back.href); }); }}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
                </Button>
              </>
            )}
          </div>
        }
      />
      <SaBody>
        {off && <AssessmentOffBanner accountName={overview?.account?.name} />}
        {isLoading && <p className="text-[14px] text-gray-500">Loading…</p>}
        {isError && <p className="text-[14px] text-red-600">This paper could not be loaded. It may have been deleted.</p>}
        {p && <TeacherPaper p={p} off={off} />}
      </SaBody>
    </>
  );
}

function TeacherPaper({ p, off }: { p: PaperView; off: boolean }) {
  const { open, viewer } = usePageViewer();
  // The question open in the side pane; kept in the address (?q=3) so a reload or a shared link opens it.
  const [question, setQuestion] = useState<string | null>(() => new URLSearchParams(window.location.search).get("q"));
  const unsaved = useRef(false);
  const onDirty = useCallback((dirty: boolean) => { unsaved.current = dirty; }, []);
  const mayLeave = useCallback(() => {
    if (unsaved.current && !window.confirm("Leave this question without saving the teacher's marks?")) return false;
    unsaved.current = false;
    return true;
  }, []);
  const show = useCallback((q: string | null) => {
    if (!mayLeave()) return;
    setQuestion(q);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }, [mayLeave]);
  const hide = useCallback(() => show(null), [show]);
  // Boundaries found on a sheet checked earlier: its answers and marked sheets have changed.
  const qc = useQueryClient();
  const wasLocating = useRef(p.locating);
  useEffect(() => {
    if (wasLocating.current && !p.locating) qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith(`${API}/checks/`) });
    wasLocating.current = p.locating;
  }, [p.locating]);
  const t = p.totals;
  const lost = (p.matching?.unassigned ?? []).filter(u => !/^\((heading|rough work)\)/i.test(u.text.trim()));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-medium ${PAPER_STATUS_STYLE[p.status]}`} data-testid="paper-status">
          {paperRunning(p.status) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{PAPER_STATUS_LABEL[p.status]}
        </span>
        {p.status === "writing" && <span className="text-[14px] text-gray-500">The AI is writing the practice answers and drawing the sheet…</span>}
        {p.status === "reading" && <span className="text-[14px] text-gray-500">Reading the whole sheet and finding each question's answer — usually 30–90 seconds.</span>}
        {p.status === "checking" && <span className="text-[14px] text-gray-500">Marking each answer…</span>}
      </div>
      {p.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700" data-testid="paper-error">{p.error}</p>}
      {p.reading?.blank && p.status !== "reading" && <p className="rounded-xl bg-amber-50 px-4 py-3 text-[14px] text-amber-900">The sheet looks blank — no answers were found.</p>}

      {p.checks.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="AI total" value={t.aiMarks === null ? "…" : `${fmtMarks(t.aiMarks)}/${fmtMarks(t.maxMarks)}`} />
          {p.source === "practice" ? <Stat label="Expected total" value={fmtMarks(t.expectedMarks)} /> : <Stat label="With teacher's marks" value={t.teacherMarks === null ? "—" : `${fmtMarks(t.teacherMarks)}/${fmtMarks(t.maxMarks)}`} />}
          <Stat label="Answered" value={`${t.answered} of ${p.questions.length}`} hint={t.notAttempted ? `${t.notAttempted} not attempted` : undefined} />
          <Stat label="Need a teacher" value={t.needsTeacher} />
        </div>
      )}

      {lost.length > 0 && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-[14px] text-amber-900" data-testid="paper-unplaced">
          <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />Parts of the sheet the AI couldn't match to a question</p>
          <ul className="mt-1 space-y-1">{lost.map(u => <li key={u.part} className="text-[13px]"><span className="font-medium">{u.reason}:</span> “{u.text.slice(0, 160)}{u.text.length > 160 ? "…" : ""}”</li>)}</ul>
        </div>
      )}

      {p.checks.length > 0 && (
        <Panel title="Question by question" subtitle="Click a question to see its marks per step, feedback and marked sheet, or to enter the teacher's marks.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[14px]" data-testid="paper-answers">
              <thead>
                <tr className="border-b text-left text-[12px] text-gray-500">
                  <th className="w-14 py-2 pl-2 pr-3 font-medium">Q</th>
                  <th className="py-2 pr-3 font-medium">Question</th>
                  <th className="py-2 pr-3 font-medium">Found on</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">AI marks</th>
                  <th className="py-2 pr-3 text-right font-medium">{p.source === "practice" ? "Expected" : "Teacher"}</th>
                </tr>
              </thead>
              <tbody>
                {p.checks.map(c => <AnswerRow key={c.id} c={c} practice={p.source === "practice"} open={c.questionNumber === question} onOpen={() => { if (c.questionNumber !== question) show(c.questionNumber); }} onPage={n => open(viewerPages(p.pages, p, c), n - 1)} />)}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <SheetPages p={p} off={off} />

      {p.practice && (
        <Panel title="What the practice student wrote" subtitle={`Written order: ${p.practice.writtenOrder.map(n => `Q${n}`).join(", ")}`}>
          <pre className="whitespace-pre-wrap rounded-xl bg-violet-50/50 p-3 font-sans text-[13px] text-gray-700">{p.practice.sheet}</pre>
        </Panel>
      )}
      {question !== null && <AnswerPane p={p} number={question} onGo={show} onClose={hide} onDirty={onDirty} />}
      {viewer}
    </div>
  );
}

function AnswerRow({ c, practice, open, onOpen, onPage }: { c: CheckView; practice: boolean; open: boolean; onOpen: () => void; onPage: (page: number) => void }) {
  const r = c.reading;
  const compare = practice ? c.expectedMarks : c.teacherMarks;
  const gap = c.aiMarks !== null && compare !== null ? c.aiMarks - compare : null;
  const row = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (open) row.current?.scrollIntoView({ block: "nearest" }); }, [open]);
  return (
    <tr ref={row} onClick={onOpen} aria-selected={open} className={`cursor-pointer border-b border-black/[0.04] align-top ${open ? "bg-violet-50" : "hover:bg-gray-50"}`} data-testid={`paper-answer-${c.questionNumber}`}>
      <td className="py-2.5 pl-2 pr-3 font-semibold">{c.questionNumber}</td>
      <td className="max-w-[360px] py-2.5 pr-3">
        <p className="line-clamp-2 text-gray-900">{c.scheme?.questionText}</p>
        {c.practiceLevel && <span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">{LEVEL_LABEL[c.practiceLevel]}</span>}
      </td>
      <td className="py-2.5 pr-3 text-[13px] text-gray-600">
        {r?.notAttempted ? <span className="text-gray-500">Not attempted</span> : <>Page {r?.pages?.length ? r.pages.map((n, i) => <span key={n}>{i > 0 && ", "}<button type="button" onClick={e => { e.stopPropagation(); onPage(n); }} className="font-medium text-violet-700 hover:underline" aria-label={`Open page ${n}`} data-testid={`paper-answer-${c.questionNumber}-page-${n}`}>{n}</button></span>) : "?"}{typeof r?.matchConfidence === "number" && r.matchConfidence < 0.6 && <span className="ml-1 text-amber-700">(unsure)</span>}</>}
        {r?.matchNote && <p className="text-[12px] text-gray-400">{r.matchNote}</p>}
      </td>
      <td className="py-2.5 pr-3">
        {r?.notAttempted && c.status === "done"
          ? <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[12px] font-medium text-gray-600">Not attempted</span>
          : <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${STATUS_STYLE[c.status]}`}>{isRunning(c) && <Loader2 className="h-3 w-3 animate-spin" />}{STATUS_LABEL[c.status]}</span>}
      </td>
      <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{c.aiMarks === null ? "—" : `${fmtMarks(c.aiMarks)}/${fmtMarks(c.maxMarks)}`}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums text-gray-600">
        {fmtMarks(compare)}
        {gap !== null && <span className={`ml-1.5 text-[12px] ${Math.abs(gap) <= 0.5 ? "text-emerald-600" : "text-red-600"}`}>({gap > 0 ? "+" : ""}{fmtMarks(gap)})</span>}
      </td>
    </tr>
  );
}
