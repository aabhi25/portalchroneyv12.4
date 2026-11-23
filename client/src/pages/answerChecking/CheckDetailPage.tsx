import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Eye, FileCheck2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel } from "@/components/agency/agencyUi";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { AssessmentOffBanner, useAssessmentOn } from "./AssessmentSwitch";
import { Boundaries, usePageViewer } from "./PageViewer";
import { PictureStrip } from "./PictureStrip";
import { viewerPages } from "./SheetPages";
import { ASSESS_PATH,
  AI_WRITTEN_LABEL, API, DRAWING_LABEL, KIND_LABEL, LEVEL_LABEL, STATUS_LABEL, STATUS_STYLE, fmtMarks, imageUrl, isRunning, scopeLabel,
  type CheckView,
} from "./answerCheckApi";

const CORRECTNESS: Record<string, string> = { correct: "Correct", partial: "Partly correct", incorrect: "Incorrect" };

/** Super admin › Answer checking › one checked answer (an answer of a whole sheet opens in its paper). */
export default function CheckDetailPage({ checkId }: { checkId: string }) {
  const [, setLocation] = useLocation();
  const key = [`${API}/checks/${checkId}`];
  const { data, isLoading, isError } = useQuery<{ check: CheckView }>({
    queryKey: key,
    refetchInterval: q => (q.state.data && isRunning(q.state.data.check) ? 2000 : false),
  });
  const c = data?.check;
  // An answer of a whole sheet is shown in its paper's side pane.
  const inPaper = c?.paperId && c.questionNumber ? `${ASSESS_PATH}/papers/${c.paperId}?q=${encodeURIComponent(c.questionNumber)}` : null;
  useEffect(() => { if (inPaper) setLocation(inPaper, { replace: true }); }, [inPaper]);
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
      />
      <SaBody>
        {isLoading && <p className="text-[14px] text-gray-500">Loading…</p>}
        {isError && <p className="text-[14px] text-red-600">This answer could not be loaded. It may have been deleted.</p>}
        {c && !inPaper && <TeacherView c={c} onDeleted={() => setLocation(back.href)} />}
      </SaBody>
    </>
  );
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${className}`}>{children}</span>;
}

function Photos({ c, pane }: { c: CheckView; pane?: boolean }) {
  const marked = c.images.find(i => i.kind === "marked");
  const pages = c.paperId ? c.sheetPages ?? [] : c.images.filter(i => i.kind === "answer");
  const { open, viewer } = usePageViewer();
  const [show, setShow] = useState<"marked" | "pages">(marked ? "marked" : "pages");
  useEffect(() => { if (marked) setShow("marked"); }, [marked?.id]);
  // Without a boundary the pane shows the top of a page; it opens whole in the viewer.
  const short = pane && !c.reading?.regions?.length;
  const shot = `relative block w-full cursor-zoom-in overflow-hidden rounded-xl border ${short ? "max-h-[380px]" : ""}`;
  const more = short && <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-white/95 to-transparent pb-2 pt-10"><span className="rounded-full border bg-white px-3 py-1 text-[12px] font-medium text-gray-800">Open and zoom</span></span>;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant={show === "marked" ? "default" : "outline"} disabled={!marked} onClick={() => setShow("marked")} data-testid="show-marked">Marked sheet</Button>
        <Button size="sm" variant={show === "pages" ? "default" : "outline"} onClick={() => setShow("pages")} data-testid="show-pages">Original photos ({pages.length})</Button>
      </div>
      {show === "marked" && marked
        ? <button type="button" className={shot} onClick={() => open([{ src: imageUrl(marked.id), label: c.questionNumber ? `Question ${c.questionNumber} · marked sheet` : "Marked sheet" }])}><img src={imageUrl(marked.id)} alt="Marked answer sheet" className="w-full" data-testid="marked-image" />{more}</button>
        : pages.map((p, i) => <button key={p.id} type="button" className={shot} onClick={() => open(viewerPages(pages, undefined, c), i)}><img src={imageUrl(p.id)} alt={`Page ${p.position + 1}`} className="w-full" /><Boundaries bounds={c.paperId ? c.reading?.regions?.filter(r => r.page === p.position + 1) : undefined} />{more}</button>)}
      {!pages.length && <p className="text-[13px] text-gray-500">{c.status === "writing" ? "The practice answer is being written…" : "No photos."}</p>}
      {viewer}
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

/** Everything about one answer: two columns on its own page, one column in the paper's side pane. */
export function TeacherView({ c, onDeleted, pane, onDirty, onSaveNext }: { c: CheckView; onDeleted: () => void; pane?: boolean; onDirty?: (dirty: boolean) => void; onSaveNext?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const r = c.result;
  const { on, overview } = useAssessmentOn();
  const off = on === false;
  const [busy, setBusy] = useState("");
  const [tMarks, setTMarks] = useState(c.teacherMarks === null ? "" : String(c.teacherMarks));
  const [tComment, setTComment] = useState(c.teacherComment ?? "");
  useEffect(() => { setTMarks(c.teacherMarks === null ? "" : String(c.teacherMarks)); setTComment(c.teacherComment ?? ""); }, [c.id, c.teacherAt]);
  const dirty = tMarks !== (c.teacherMarks === null ? "" : String(c.teacherMarks)) || tComment !== (c.teacherComment ?? "");
  useEffect(() => { onDirty?.(dirty); }, [dirty]);
  const refresh = () => { qc.invalidateQueries({ queryKey: [`${API}/checks/${c.id}`] }); if (c.paperId) qc.invalidateQueries({ queryKey: [`${API}/papers/${c.paperId}`] }); qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith(`${API}/checks?`) }); };

  async function act(name: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(name);
    try { await fn(); refresh(); if (done) toast({ title: done }); return true; }
    catch (e: any) { toast({ title: "That didn't work", description: e.message, variant: "destructive" }); return false; }
    finally { setBusy(""); }
  }
  const saveTeacher = () => act("teacher", () => apiRequest("PUT", `${API}/checks/${c.id}/teacher`, { marks: tMarks.trim() === "" ? null : Number(tMarks), comment: tComment }), "Teacher's marks saved");

  const running = isRunning(c);
  const schemeChanged = c.scheme && r && c.scheme.version !== r.schemeVersion;
  const questionPanel = (
    <Panel title="Question">
      <p className="whitespace-pre-wrap text-[15px] text-gray-900">{c.scheme?.questionText}</p>
      <p className="mt-1 text-[12px] text-gray-500">{fmtMarks(c.maxMarks)} mark{c.maxMarks === 1 ? "" : "s"}{c.scheme?.questionKind ? ` · ${KIND_LABEL[c.scheme.questionKind]}` : ""}</p>
      <PictureStrip pictures={(c.scheme?.questionImages ?? []).map(id => ({ id }))} testId="question-pictures" />
      {!!c.scheme?.answerImages?.length && (
        <div className="mt-3 text-[13px] text-gray-600" data-testid="answer-pictures">The correct answer's diagram<PictureStrip pictures={c.scheme.answerImages.map(id => ({ id }))} /></div>
      )}
    </Panel>
  );
  const sheetPanel = <Panel title="Answer sheet"><Photos c={c} pane={pane} /></Panel>;
  const summaryPanel = (
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
  );
  const stepsPanel = r && (
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
      {r.drawing && r.drawing.status !== "none" && (
        <p className="mt-3 text-[14px] text-gray-800" data-testid="drawing-note"><span className="font-medium">{DRAWING_LABEL[r.drawing.status]}</span>{r.drawing.note ? ` — ${r.drawing.note}` : ""}</p>
      )}
      {r.alternativeMethod && <p className="mt-3 text-[13px] text-gray-600">The student used a different valid method.</p>}
      {r.confidenceNote && <p className="mt-3 text-[13px] text-gray-500">How sure the AI is: {r.confidenceNote}</p>}
    </Panel>
  );
  const feedbackPanel = r && (
    <Panel title="Feedback for the student">
      <p className="text-[14px] text-gray-900" data-testid="feedback-summary">{r.feedback.summary}</p>
      {r.feedback.improvement && <p className="mt-2 text-[14px] text-gray-700"><span className="font-medium">To improve:</span> {r.feedback.improvement}</p>}
      {r.feedback.revision && <p className="mt-2 text-[14px] text-gray-700"><span className="font-medium">Revise:</span> {r.feedback.revision}</p>}
      {r.teacherComment && <p className="mt-2 text-[14px] italic text-red-700">“{r.teacherComment}”</p>}
    </Panel>
  );
  const aiWrittenPanel = c.aiWritten && (
    <MaybeFold fold={pane} title="AI-written estimate" subtitle="An indicator only — it never changes the marks, and it can't prove anything.">
      <div className="flex flex-wrap items-center gap-3 text-[14px]" data-testid="ai-written">
        <span className="text-[22px] font-semibold tabular-nums">{c.aiWritten.percent === null ? "—" : `${c.aiWritten.percent}%`}</span>
        <Pill className={c.aiWritten.status === "possibly_ai" ? "bg-amber-50 text-amber-800" : c.aiWritten.status === "likely_human" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-700"}>{AI_WRITTEN_LABEL[c.aiWritten.status]}</Pill>
        <span className="text-gray-500">confidence: {c.aiWritten.confidence}</span>
      </div>
      {c.aiWritten.signals.length > 0 && <ul className="mt-2 list-disc pl-6 text-[13px] text-gray-600">{c.aiWritten.signals.map(s => <li key={s}>{s}</li>)}</ul>}
    </MaybeFold>
  );
  const readPanel = c.readText !== null && (
    <MaybeFold fold={pane} title="What the AI read" subtitle={c.reading?.notes || "Exactly as written; [unclear] marks parts it could not read."}>
      {c.readText ? <ReadText text={c.readText} /> : <p className="text-[14px] text-gray-500">Nothing — the page looked blank.</p>}
      {c.practiceText && (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-violet-700">What the practice answer actually says</summary>
          <p className="mt-2 whitespace-pre-wrap rounded-xl bg-violet-50/50 p-3 text-gray-700">{c.practiceText}</p>
        </details>
      )}
    </MaybeFold>
  );
  const teacherPanel = c.status !== "writing" && (
    <Panel title="Teacher's marks" subtitle="Enter what a teacher gives this answer; it is compared with the AI's marks.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[13px] font-medium text-gray-700">Marks (of {fmtMarks(c.maxMarks)})
          <Input value={tMarks} onChange={e => setTMarks(e.target.value)} inputMode="decimal" className="mt-1 w-24" data-testid="teacher-marks" />
        </label>
        <label className="min-w-[240px] flex-1 text-[13px] font-medium text-gray-700">Comment
          <Textarea value={tComment} onChange={e => setTComment(e.target.value)} rows={1} className="mt-1 min-h-9" data-testid="teacher-comment" />
        </label>
        <Button disabled={!!busy} onClick={saveTeacher} data-testid="teacher-save">
          {busy === "teacher" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save
        </Button>
        {onSaveNext && <Button variant="outline" disabled={!!busy || !dirty} onClick={async () => { if (await saveTeacher()) onSaveNext(); }} data-testid="teacher-save-next">Save and next</Button>}
      </div>
      {c.teacherAt && c.aiMarks !== null && c.teacherMarks !== null && (
        <p className={`mt-2 text-[13px] ${Math.abs(c.aiMarks - c.teacherMarks) <= 0.5 ? "text-emerald-700" : "text-red-600"}`} data-testid="teacher-gap">
          AI {c.aiMarks > c.teacherMarks ? "gave" : c.aiMarks < c.teacherMarks ? "gave" : "matched the teacher:"} {c.aiMarks === c.teacherMarks ? `${fmtMarks(c.aiMarks)}` : `${fmtMarks(Math.abs(c.aiMarks - c.teacherMarks))} mark${Math.abs(c.aiMarks - c.teacherMarks) === 1 ? "" : "s"} ${c.aiMarks > c.teacherMarks ? "more" : "less"} than the teacher`}.
        </p>
      )}
    </Panel>
  );
  const historyPanel = c.history.length > 0 && (
    <MaybeFold fold={pane} title="Earlier markings">
      <ul className="space-y-1 text-[13px] text-gray-700">
        {c.history.slice().reverse().map((h, i) => <li key={i}>{new Date(h.at).toLocaleString("en-IN")} — {fmtMarks(h.aiMarks)}/{fmtMarks(c.maxMarks)}{h.schemeVersion ? ` (scheme version ${h.schemeVersion})` : ""}</li>)}
      </ul>
    </MaybeFold>
  );
  const footer = (
    <p className="text-[12px] text-gray-400">{c.model ? `${c.model} · ` : ""}{c.durationMs ? `${Math.round(c.durationMs / 100) / 10} s · ` : ""}{new Date(c.createdAt).toLocaleString("en-IN")}</p>
  );

  if (pane) {
    return (
      <div className="space-y-4">
        {off && <AssessmentOffBanner accountName={overview?.account?.name} />}
        {summaryPanel}{questionPanel}{!c.reading?.notAttempted && sheetPanel}{stepsPanel}{feedbackPanel}{teacherPanel}{readPanel}{aiWrittenPanel}{historyPanel}{footer}
      </div>
    );
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {off && <div className="xl:col-span-2"><AssessmentOffBanner accountName={overview?.account?.name} /></div>}
      <div className="space-y-5">{questionPanel}{sheetPanel}</div>
      <div className="space-y-5">{summaryPanel}{stepsPanel}{feedbackPanel}{aiWrittenPanel}{readPanel}{teacherPanel}{historyPanel}{footer}</div>
    </div>
  );
}

/** A panel that starts folded in the side pane. */
function MaybeFold({ fold, title, subtitle, children }: { fold?: boolean; title: string; subtitle?: string; children: ReactNode }) {
  if (!fold) return <Panel title={title} subtitle={subtitle}>{children}</Panel>;
  return (
    <details className="group rounded-2xl border border-black/[0.06] bg-white px-5 py-3.5">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[15px] font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">{title}<ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" /></summary>
      {subtitle && <p className="mb-3 mt-1 text-[13px] text-gray-500">{subtitle}</p>}
      <div className="pb-1.5 pt-2">{children}</div>
    </details>
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
