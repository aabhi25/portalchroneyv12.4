import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, Eye, FileCheck2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel } from "@/components/agency/agencyUi";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { AssessmentOffBanner, useAssessmentOn } from "./AssessmentSwitch";
import { ASSESS_PATH,
  AI_WRITTEN_LABEL, API, KIND_LABEL, LEVEL_LABEL, STATUS_LABEL, STATUS_STYLE, fmtCost, fmtMarks, imageUrl, isRunning, scopeLabel,
  type CheckView,
} from "./answerCheckApi";

const CORRECTNESS: Record<string, string> = { correct: "Correct", partial: "Partly correct", incorrect: "Incorrect" };

/** Super admin › Answer checking › one checked answer: teacher view (everything) or student view (what a student would see). */
export default function CheckDetailPage({ checkId }: { checkId: string }) {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<"teacher" | "student">("teacher");
  const key = [`${API}/checks/${checkId}`];
  const { data, isLoading, isError } = useQuery<{ check: CheckView }>({
    queryKey: key,
    refetchInterval: q => (q.state.data && isRunning(q.state.data.check) ? 2000 : false),
  });
  const c = data?.check;
  const back = c?.paperId
    ? { label: "Back to the paper", href: `${ASSESS_PATH}/papers/${c.paperId}` }
    : { label: "Assessment", href: c ? `${ASSESS_PATH}?q=${encodeURIComponent(c.questionKey)}` : `${ASSESS_PATH}` };
  return (
    <>
      <SaHeader
        icon={FileCheck2}
        tint="bg-orange-500"
        kind="Assessment · one answer"
        title={c ? (c.studentLabel || "Uploaded answer") : "Answer"}
        subtitle={c?.scheme ? scopeLabel(c.scheme) : undefined}
        back={back}
        actions={
          <div className="inline-flex rounded-full bg-gray-100 p-1" role="tablist">
            {(["teacher", "student"] as const).map(v => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} data-testid={`view-${v}`}
                className={`rounded-full px-3 py-1 text-[13px] font-medium ${view === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}>
                {v === "teacher" ? "Teacher view" : "Student view"}
              </button>
            ))}
          </div>
        }
      />
      <SaBody>
        {isLoading && <p className="text-[14px] text-gray-500">Loading…</p>}
        {isError && <p className="text-[14px] text-red-600">This answer could not be loaded. It may have been deleted.</p>}
        {c && (view === "student" ? <StudentView c={c} /> : <TeacherView c={c} onDeleted={() => setLocation(back.href)} />)}
      </SaBody>
    </>
  );
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${className}`}>{children}</span>;
}

function Photos({ c }: { c: CheckView }) {
  const marked = c.images.find(i => i.kind === "marked");
  const pages = c.images.filter(i => i.kind === "answer");
  const [show, setShow] = useState<"marked" | "pages">(marked ? "marked" : "pages");
  useEffect(() => { if (marked) setShow("marked"); }, [marked?.id]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant={show === "marked" ? "default" : "outline"} disabled={!marked} onClick={() => setShow("marked")} data-testid="show-marked">Marked sheet</Button>
        <Button size="sm" variant={show === "pages" ? "default" : "outline"} onClick={() => setShow("pages")} data-testid="show-pages">Original photos ({pages.length})</Button>
      </div>
      {show === "marked" && marked
        ? <a href={imageUrl(marked.id)} target="_blank" rel="noreferrer"><img src={imageUrl(marked.id)} alt="Marked answer sheet" className="w-full rounded-xl border" data-testid="marked-image" /></a>
        : pages.map(p => <a key={p.id} href={imageUrl(p.id)} target="_blank" rel="noreferrer"><img src={imageUrl(p.id)} alt={`Page ${p.position + 1}`} className="w-full rounded-xl border" /></a>)}
      {!pages.length && <p className="text-[13px] text-gray-500">{c.status === "writing" ? "The practice answer is being written…" : "No photos."}</p>}
    </div>
  );
}

/** Highlights [unclear] in what the AI read. */
function ReadText({ text }: { text: string }) {
  const parts = text.split(/(\[unclear\])/gi);
  return (
    <p className="whitespace-pre-wrap rounded-xl bg-gray-50 p-3 font-mono text-[13px] leading-relaxed text-gray-800" data-testid="read-text">
      {parts.map((p, i) => /^\[unclear\]$/i.test(p) ? <mark key={i} className="rounded bg-amber-200 px-0.5">{p}</mark> : <span key={i}>{p}</span>)}
    </p>
  );
}

function TeacherView({ c, onDeleted }: { c: CheckView; onDeleted: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const r = c.result;
  const { on, overview } = useAssessmentOn();
  const off = on === false;
  const [busy, setBusy] = useState("");
  const [tMarks, setTMarks] = useState(c.teacherMarks === null ? "" : String(c.teacherMarks));
  const [tComment, setTComment] = useState(c.teacherComment ?? "");
  useEffect(() => { setTMarks(c.teacherMarks === null ? "" : String(c.teacherMarks)); setTComment(c.teacherComment ?? ""); }, [c.id, c.teacherAt]);
  const refresh = () => { qc.invalidateQueries({ queryKey: [`${API}/checks/${c.id}`] }); qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith(`${API}/checks?`) }); };

  async function act(name: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(name);
    try { await fn(); refresh(); if (done) toast({ title: done }); }
    catch (e: any) { toast({ title: "That didn't work", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  }

  const running = isRunning(c);
  const schemeChanged = c.scheme && r && c.scheme.version !== r.schemeVersion;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {off && <div className="xl:col-span-2"><AssessmentOffBanner accountName={overview?.account?.name} /></div>}
      <div className="space-y-5">
        <Panel title="Question">
          <p className="whitespace-pre-wrap text-[15px] text-gray-900">{c.scheme?.questionText}</p>
          <p className="mt-1 text-[12px] text-gray-500">{fmtMarks(c.maxMarks)} marks{c.scheme?.questionKind ? ` · ${KIND_LABEL[c.scheme.questionKind]}` : ""}</p>
        </Panel>
        <Panel title="Answer sheet"><Photos c={c} /></Panel>
      </div>

      <div className="space-y-5">
        <Panel>
          <div className="flex flex-wrap items-center gap-3">
            <Pill className={STATUS_STYLE[c.status]}>{running && <Loader2 className="h-3 w-3 animate-spin" />}{STATUS_LABEL[c.status]}</Pill>
            {c.practiceLevel && <Pill className="bg-violet-50 text-violet-700">Practice · {LEVEL_LABEL[c.practiceLevel]}</Pill>}
            {r && <Pill className="bg-gray-100 text-gray-700">{CORRECTNESS[r.correctness]}</Pill>}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={running || off || !!busy} onClick={() => act("recheck", () => apiRequest("POST", `${API}/checks/${c.id}/recheck`), "Checking again")} data-testid="recheck">
                {busy === "recheck" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}{c.status === "failed" ? "Try again" : "Re-check"}
              </Button>
              {c.readText !== null && !c.paperId && (
                <Button size="sm" variant="outline" disabled={running || off || !!busy} onClick={() => act("reread", () => apiRequest("POST", `${API}/checks/${c.id}/recheck`, { reread: true }), "Reading the photos again")} data-testid="reread">
                  <Eye className="mr-1 h-3.5 w-3.5" />Read again
                </Button>
              )}
              {!c.paperId && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { if (window.confirm("Delete this answer, its photos and its marks? This can't be undone.")) act("delete", async () => { await apiRequest("DELETE", `${API}/checks/${c.id}`); onDeleted(); }); }} data-testid="delete-check">
                <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
              </Button>}
            </div>
          </div>
          {c.paperId && (
            <p className="mt-3 text-[13px] text-gray-600" data-testid="from-paper">
              Question {c.questionNumber} of a whole answer sheet{c.reading?.notAttempted ? " — not attempted" : c.reading?.pages?.length ? `, found on page ${c.reading.pages.join(", ")}` : ""}.
              {typeof c.reading?.matchConfidence === "number" && !c.reading.notAttempted && ` The AI is ${Math.round(c.reading.matchConfidence * 100)}% sure this is the right part of the sheet.`}
            </p>
          )}
          {c.error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700" data-testid="check-error">{c.error}</p>}
          {running && <p className="mt-3 text-[14px] text-gray-500">{c.status === "writing" ? "The AI is writing this practice answer…" : "Reading the handwriting and marking — usually 20–60 seconds."}</p>}
          {r && (
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Big label="AI marks" value={`${fmtMarks(c.aiMarks)}/${fmtMarks(c.maxMarks)}`} testid="ai-marks" />
              <Big label={c.source === "practice" ? "Expected" : "Teacher"} value={c.source === "practice" ? fmtMarks(c.expectedMarks) : fmtMarks(c.teacherMarks)} />
              <Big label="AI sure of marks" value={`${Math.round(r.confidence * 100)}%`} />
              <Big label="Handwriting readable" value={c.reading ? `${Math.round((c.reading.legibility || 0) * 100)}%` : "—"} />
            </div>
          )}
          {c.teacherReasons.length > 0 && (
            <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[14px] text-amber-900" data-testid="teacher-reasons">
              <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" />A teacher should look at this answer</p>
              <ul className="mt-1 list-disc pl-6">{c.teacherReasons.map(t => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
          {schemeChanged && <p className="mt-3 text-[13px] text-amber-700">Marked with scheme version {r!.schemeVersion}; the question is now on version {c.scheme!.version}. Re-check to use it.</p>}
          {r?.practiceWhy && <p className="mt-3 text-[13px] text-violet-800">Practice answer written to get: {r.practiceWhy}</p>}
        </Panel>

        {r && (
          <Panel title="Marks for each step" subtitle={`Marking scheme version ${r.schemeVersion}${r.finalAnswerOnlyApplied ? " · right final answer without working" : ""}`}>
            <table className="w-full text-[14px]" data-testid="steps-table">
              <tbody>
                {r.steps.map(s => (
                  <tr key={s.stepId} className="border-b border-black/[0.05] last:border-0 align-top">
                    <td className="w-8 py-2">{s.awarded >= s.marks ? <span className="text-emerald-600">✓</span> : s.awarded > 0 ? <span className="text-amber-600">½</span> : <span className="text-red-600">✗</span>}</td>
                    <td className="py-2 pr-3"><p className="text-gray-900">{s.label}</p>{s.comment && <p className="text-[13px] text-gray-500">{s.comment}</p>}</td>
                    <td className="w-16 py-2 text-right font-medium tabular-nums">{fmtMarks(s.awarded)}/{fmtMarks(s.marks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.deductions.length > 0 && (
              <div className="mt-4 text-[14px]">
                <p className="font-medium text-gray-900">Marks cut ({fmtMarks(r.deductions.reduce((a, d) => a + d.marks, 0))})</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-6 text-gray-700">{r.deductions.map(d => <li key={d.stepId}>−{fmtMarks(d.marks)}: {d.reason}</li>)}</ul>
              </div>
            )}
            <div className="mt-4 grid gap-3 text-[14px] md:grid-cols-2">
              <ListBlock title="Right" items={r.correctPoints} />
              <ListBlock title="Mistakes" items={r.mistakes} />
              <ListBlock title="Missing concepts" items={r.missingConcepts} />
              <ListBlock title="Missing keywords" items={r.missingKeywords} />
            </div>
            {r.alternativeMethod && <p className="mt-3 text-[13px] text-gray-600">The student used a different valid method.</p>}
            {r.confidenceNote && <p className="mt-3 text-[13px] text-gray-500">How sure the AI is: {r.confidenceNote}</p>}
          </Panel>
        )}

        {r && (
          <Panel title="Feedback for the student">
            <p className="text-[14px] text-gray-900" data-testid="feedback-summary">{r.feedback.summary}</p>
            {r.feedback.improvement && <p className="mt-2 text-[14px] text-gray-700"><span className="font-medium">To improve:</span> {r.feedback.improvement}</p>}
            {r.feedback.revision && <p className="mt-2 text-[14px] text-gray-700"><span className="font-medium">Revise:</span> {r.feedback.revision}</p>}
            {r.teacherComment && <p className="mt-2 text-[14px] italic text-red-700">“{r.teacherComment}”</p>}
          </Panel>
        )}

        {c.aiWritten && (
          <Panel title="AI-written estimate" subtitle="An indicator only — it never changes the marks, and it can't prove anything.">
            <div className="flex flex-wrap items-center gap-3 text-[14px]" data-testid="ai-written">
              <span className="text-[22px] font-semibold tabular-nums">{c.aiWritten.percent === null ? "—" : `${c.aiWritten.percent}%`}</span>
              <Pill className={c.aiWritten.status === "possibly_ai" ? "bg-amber-50 text-amber-800" : c.aiWritten.status === "likely_human" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-700"}>{AI_WRITTEN_LABEL[c.aiWritten.status]}</Pill>
              <span className="text-gray-500">confidence: {c.aiWritten.confidence}</span>
            </div>
            {c.aiWritten.signals.length > 0 && <ul className="mt-2 list-disc pl-6 text-[13px] text-gray-600">{c.aiWritten.signals.map(s => <li key={s}>{s}</li>)}</ul>}
          </Panel>
        )}

        {c.readText !== null && (
          <Panel title="What the AI read" subtitle={c.reading?.notes || "Exactly as written; [unclear] marks parts it could not read."}>
            {c.readText ? <ReadText text={c.readText} /> : <p className="text-[14px] text-gray-500">Nothing — the page looked blank.</p>}
            {c.practiceText && (
              <details className="mt-3 text-[13px]">
                <summary className="cursor-pointer text-violet-700">What the practice answer actually says</summary>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-violet-50/50 p-3 text-gray-700">{c.practiceText}</p>
              </details>
            )}
          </Panel>
        )}

        {c.status !== "writing" && (
          <Panel title="Teacher's marks" subtitle="Enter what a teacher gives this answer — the History page compares it with the AI.">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[13px] font-medium text-gray-700">Marks (of {fmtMarks(c.maxMarks)})
                <Input value={tMarks} onChange={e => setTMarks(e.target.value)} inputMode="decimal" className="mt-1 w-24" data-testid="teacher-marks" />
              </label>
              <label className="min-w-[240px] flex-1 text-[13px] font-medium text-gray-700">Comment
                <Textarea value={tComment} onChange={e => setTComment(e.target.value)} rows={1} className="mt-1 min-h-9" data-testid="teacher-comment" />
              </label>
              <Button disabled={!!busy} onClick={() => act("teacher", () => apiRequest("PUT", `${API}/checks/${c.id}/teacher`, { marks: tMarks.trim() === "" ? null : Number(tMarks), comment: tComment }), "Teacher's marks saved")} data-testid="teacher-save">
                {busy === "teacher" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save
              </Button>
            </div>
            {c.teacherAt && c.aiMarks !== null && c.teacherMarks !== null && (
              <p className={`mt-2 text-[13px] ${Math.abs(c.aiMarks - c.teacherMarks) <= 0.5 ? "text-emerald-700" : "text-red-600"}`} data-testid="teacher-gap">
                AI {c.aiMarks > c.teacherMarks ? "gave" : c.aiMarks < c.teacherMarks ? "gave" : "matched the teacher:"} {c.aiMarks === c.teacherMarks ? `${fmtMarks(c.aiMarks)}` : `${fmtMarks(Math.abs(c.aiMarks - c.teacherMarks))} mark${Math.abs(c.aiMarks - c.teacherMarks) === 1 ? "" : "s"} ${c.aiMarks > c.teacherMarks ? "more" : "less"} than the teacher`}.
              </p>
            )}
          </Panel>
        )}

        {c.history.length > 0 && (
          <Panel title="Earlier markings">
            <ul className="space-y-1 text-[13px] text-gray-700">
              {c.history.slice().reverse().map((h, i) => <li key={i}>{new Date(h.at).toLocaleString("en-IN")} — {fmtMarks(h.aiMarks)}/{fmtMarks(c.maxMarks)}{h.schemeVersion ? ` (scheme version ${h.schemeVersion})` : ""}</li>)}
            </ul>
          </Panel>
        )}

        <p className="text-[12px] text-gray-400">{c.model ? `${c.model} · ` : ""}{c.durationMs ? `${Math.round(c.durationMs / 100) / 10} s · ` : ""}AI cost {fmtCost(c.costUsd)} · {new Date(c.createdAt).toLocaleString("en-IN")}</p>
      </div>
    </div>
  );
}

function Big({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="text-[20px] font-semibold tabular-nums text-gray-900" data-testid={testid}>{value}</p>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="font-medium text-gray-900">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-700">{items.map(i => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

/** What a student would see in the app, laid out like the client's document (section 4.7). */
function StudentView({ c }: { c: CheckView }) {
  const r = c.result;
  const marked = c.images.find(i => i.kind === "marked");
  const pages = c.images.filter(i => i.kind === "answer");
  const [sheet, setSheet] = useState(false);
  if (!r) return <p className="text-[14px] text-gray-500">The student view appears once the answer is checked.</p>;
  const finalMarks = c.teacherMarks ?? c.aiMarks;
  const reviewed = c.teacherAt && c.teacherMarks !== null;
  return (
    <div className="mx-auto max-w-[420px]" data-testid="student-view">
      <p className="mb-2 text-center text-[12px] text-gray-500">Preview: how a student would see this in the app</p>
      <div className="overflow-hidden rounded-[28px] border-[6px] border-gray-900 bg-white shadow-xl">
        <div className="bg-teal-700 px-5 py-4 text-white">
          <p className="text-[12px] opacity-80">Mock Test{c.scheme?.subject ? ` – ${c.scheme.subject}` : ""}</p>
          <p className="text-[17px] font-semibold">{reviewed ? "Teacher evaluated" : "AI Teacher evaluated"}</p>
        </div>
        <div className="space-y-4 p-5 text-[14px]">
          <div className="flex items-center justify-between">
            <p className="font-medium text-gray-900">Question 1 · Maximum marks: {fmtMarks(c.maxMarks)}</p>
            <span className="rounded-full bg-teal-50 px-3 py-1 text-[15px] font-semibold text-teal-800">{fmtMarks(finalMarks)}/{fmtMarks(c.maxMarks)}</span>
          </div>
          <p className="whitespace-pre-wrap text-gray-700">{c.scheme?.questionText}</p>
          <div className="rounded-2xl bg-gray-50 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">AI Teacher Evaluation</p>
            <p className="mt-1 text-gray-900">AI marks: <b>{fmtMarks(c.aiMarks)}/{fmtMarks(c.maxMarks)}</b></p>
            <p className="mt-2 text-gray-800">{r.feedback.summary}</p>
            {r.feedback.improvement && <p className="mt-2 text-gray-700">{r.feedback.improvement}</p>}
            {r.feedback.revision && <p className="mt-2 flex items-start gap-1.5 text-gray-700"><BookOpen className="mt-0.5 h-4 w-4 shrink-0" />{r.feedback.revision}</p>}
          </div>
          {c.aiWritten && c.aiWritten.percent !== null && (
            <div className="flex items-center justify-between rounded-2xl border border-black/[0.06] px-4 py-3">
              <span className="text-gray-600">AI-content detection</span>
              <span className="font-medium text-gray-900">{c.aiWritten.percent}% estimated</span>
            </div>
          )}
          <div className="rounded-2xl border border-black/[0.06] p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{reviewed ? "Teacher review" : "AI review"}</p>
            <p className="mt-1 text-gray-900">Final marks: <b>{fmtMarks(finalMarks)}/{fmtMarks(c.maxMarks)}</b></p>
            {(c.teacherComment || r.teacherComment) && <p className="mt-2 text-gray-700">{reviewed ? "Teacher's" : "AI Teacher's"} comments: {c.teacherComment || r.teacherComment}</p>}
          </div>
          <Button variant="outline" className="w-full" onClick={() => setSheet(!sheet)} disabled={!marked && !pages.length} data-testid="student-sheet">{sheet ? "Hide answer sheet" : "View evaluated answer sheet"}</Button>
          {sheet && (marked ? <img src={imageUrl(marked.id)} alt="Evaluated answer sheet" className="w-full rounded-xl border" /> : pages.map(p => <img key={p.id} src={imageUrl(p.id)} alt="" className="w-full rounded-xl border" />))}
          {c.teacherReasons.length > 0 && !reviewed && <p className="text-[12px] text-amber-700">Admin note (not shown to students): this answer is waiting for a teacher, so it would not be published yet.</p>}
        </div>
      </div>
    </div>
  );
}
