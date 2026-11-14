import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileCheck2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel, Stat } from "@/components/agency/agencyUi";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { AssessmentOffBanner, useAssessmentOn } from "./AssessmentSwitch";
import {
  API, LEVEL_LABEL, PAPER_STATUS_LABEL, PAPER_STATUS_STYLE, STATUS_LABEL, STATUS_STYLE, fmtCost, fmtMarks, imageUrl, isRunning, paperRunning,
  type CheckView, type PaperView,
} from "./answerCheckApi";

/** Super admin › Answer checking › one whole paper: totals, each question's answer, the sheet, and a student view. */
export default function PaperDetailPage({ paperId }: { paperId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [view, setView] = useState<"teacher" | "student">("teacher");
  const [busy, setBusy] = useState("");
  const { on, overview } = useAssessmentOn();
  const off = on === false;
  const key = [`${API}/papers/${paperId}`];
  const { data, isLoading, isError } = useQuery<{ paper: PaperView }>({
    queryKey: key,
    refetchInterval: q => (q.state.data && paperRunning(q.state.data.paper.status) ? 2500 : false),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const p = data?.paper;
  const back = { label: "Whole paper", href: "/super-admin/answer-checking/papers" };

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
        kind="Answer checking · whole paper"
        title={p ? `${p.title || "Paper"}${p.studentLabel ? ` — ${p.studentLabel}` : ""}` : "Paper"}
        subtitle={p ? `${p.questions.length} questions · ${p.pages.length} page${p.pages.length === 1 ? "" : "s"}${p.source === "practice" ? " · practice sheet written by the AI" : ""}` : undefined}
        back={back}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-gray-100 p-1" role="tablist">
              {(["teacher", "student"] as const).map(v => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} data-testid={`paper-view-${v}`}
                  className={`rounded-full px-3 py-1 text-[13px] font-medium ${view === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}>
                  {v === "teacher" ? "Teacher view" : "Student view"}
                </button>
              ))}
            </div>
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
        {p && (view === "student" ? <StudentReport p={p} /> : <TeacherPaper p={p} />)}
      </SaBody>
    </>
  );
}

function TeacherPaper({ p }: { p: PaperView }) {
  const [, setLocation] = useLocation();
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="AI total" value={t.aiMarks === null ? "…" : `${fmtMarks(t.aiMarks)}/${fmtMarks(t.maxMarks)}`} />
          {p.source === "practice" ? <Stat label="Expected total" value={fmtMarks(t.expectedMarks)} /> : <Stat label="With teacher's marks" value={t.teacherMarks === null ? "—" : `${fmtMarks(t.teacherMarks)}/${fmtMarks(t.maxMarks)}`} />}
          <Stat label="Answered" value={`${t.answered} of ${p.questions.length}`} hint={t.notAttempted ? `${t.notAttempted} not attempted` : undefined} />
          <Stat label="Need a teacher" value={t.needsTeacher} />
          <Stat label="AI cost" value={fmtCost(p.costUsd)} hint={p.durationMs ? `reading ${Math.round(p.durationMs / 1000)} s` : undefined} />
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
                  <th className="w-14 py-2 pr-3 font-medium">Q</th>
                  <th className="py-2 pr-3 font-medium">Question</th>
                  <th className="py-2 pr-3 font-medium">Found on</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">AI marks</th>
                  <th className="py-2 pr-3 text-right font-medium">{p.source === "practice" ? "Expected" : "Teacher"}</th>
                </tr>
              </thead>
              <tbody>
                {p.checks.map(c => <AnswerRow key={c.id} c={c} practice={p.source === "practice"} onOpen={() => setLocation(`/super-admin/answer-checking/checks/${c.id}`)} />)}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="The answer sheet" subtitle="As uploaded; click a page to open it full size.">
        <div className="flex flex-wrap gap-3" data-testid="paper-pages">
          {p.pages.map(pg => (
            <a key={pg.id} href={imageUrl(pg.id)} target="_blank" rel="noreferrer" className="block">
              <img src={imageUrl(pg.id)} alt={`Page ${pg.position + 1}`} className="h-56 rounded-lg border object-cover" />
              <p className="mt-1 text-center text-[12px] text-gray-500">Page {pg.position + 1}</p>
            </a>
          ))}
          {!p.pages.length && <p className="text-[14px] text-gray-500">{p.status === "writing" ? "The practice sheet is being drawn…" : "No pages."}</p>}
        </div>
      </Panel>

      {p.practice && (
        <Panel title="What the practice student wrote" subtitle={`Written order: ${p.practice.writtenOrder.map(n => `Q${n}`).join(", ")}`}>
          <pre className="whitespace-pre-wrap rounded-xl bg-violet-50/50 p-3 font-sans text-[13px] text-gray-700">{p.practice.sheet}</pre>
        </Panel>
      )}
    </div>
  );
}

function AnswerRow({ c, practice, onOpen }: { c: CheckView; practice: boolean; onOpen: () => void }) {
  const r = c.reading;
  const compare = practice ? c.expectedMarks : c.teacherMarks;
  const gap = c.aiMarks !== null && compare !== null ? c.aiMarks - compare : null;
  return (
    <tr onClick={onOpen} className="cursor-pointer border-b border-black/[0.04] align-top hover:bg-gray-50" data-testid={`paper-answer-${c.questionNumber}`}>
      <td className="py-2.5 pr-3 font-semibold">{c.questionNumber}</td>
      <td className="max-w-[360px] py-2.5 pr-3">
        <p className="line-clamp-2 text-gray-900">{c.scheme?.questionText}</p>
        {c.practiceLevel && <span className="mt-1 inline-block rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">{LEVEL_LABEL[c.practiceLevel]}</span>}
      </td>
      <td className="py-2.5 pr-3 text-[13px] text-gray-600">
        {r?.notAttempted ? <span className="text-gray-500">Not attempted</span> : <>Page {(r?.pages ?? []).join(", ") || "?"}{typeof r?.matchConfidence === "number" && r.matchConfidence < 0.6 && <span className="ml-1 text-amber-700">(unsure)</span>}</>}
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

/** What a student would see for the whole paper: total, then each question's marks and feedback. */
function StudentReport({ p }: { p: PaperView }) {
  const t = p.totals;
  const finalTotal = t.teacherMarks ?? t.aiMarks;
  if (t.aiMarks === null) return <p className="text-[14px] text-gray-500">The student view appears once every answer is marked.</p>;
  return (
    <div className="mx-auto max-w-[460px]" data-testid="paper-student-view">
      <p className="mb-2 text-center text-[12px] text-gray-500">Preview: how a student would see this in the app</p>
      <div className="overflow-hidden rounded-[28px] border-[6px] border-gray-900 bg-white shadow-xl">
        <div className="bg-teal-700 px-5 py-4 text-white">
          <p className="text-[12px] opacity-80">{p.title || "Mock Test"}</p>
          <div className="flex items-end justify-between">
            <p className="text-[17px] font-semibold">{t.teacherMarks !== null ? "Teacher evaluated" : "AI Teacher evaluated"}</p>
            <p className="text-[26px] font-semibold tabular-nums">{fmtMarks(finalTotal)}<span className="text-[15px] opacity-80">/{fmtMarks(t.maxMarks)}</span></p>
          </div>
        </div>
        <div className="divide-y divide-black/[0.06]">
          {p.checks.map(c => {
            const marked = c.images.find(i => i.kind === "marked");
            const final = c.teacherMarks ?? c.aiMarks;
            return (
              <div key={c.id} className="space-y-2 p-4 text-[14px]">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-gray-900">Question {c.questionNumber} · {fmtMarks(c.maxMarks)} marks</p>
                  <span className="shrink-0 rounded-full bg-teal-50 px-2.5 py-0.5 font-semibold text-teal-800">{fmtMarks(final)}/{fmtMarks(c.maxMarks)}</span>
                </div>
                <p className="line-clamp-2 text-gray-600">{c.scheme?.questionText}</p>
                {c.reading?.notAttempted ? <p className="text-gray-500">Not attempted.</p> : c.result && (
                  <>
                    <p className="text-gray-800">{c.result.feedback.summary}</p>
                    {c.result.feedback.improvement && <p className="text-gray-600">{c.result.feedback.improvement}</p>}
                    {(c.teacherComment || c.result.teacherComment) && <p className="text-[13px] italic text-gray-600">Comment: {c.teacherComment || c.result.teacherComment}</p>}
                  </>
                )}
                {marked && <a href={imageUrl(marked.id)} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-teal-700 hover:underline">View evaluated answer sheet</a>}
              </div>
            );
          })}
        </div>
        {t.needsTeacher > 0 && t.teacherMarks === null && <p className="px-4 pb-4 text-[12px] text-amber-700">Admin note (not shown to students): {t.needsTeacher} answer{t.needsTeacher === 1 ? " is" : "s are"} waiting for a teacher, so this result would not be published yet.</p>}
      </div>
    </div>
  );
}
