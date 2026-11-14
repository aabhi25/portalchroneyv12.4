import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FileCheck2, FileUp, Loader2, Pencil, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel, Stat } from "@/components/agency/agencyUi";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { SchemeEditor } from "./SchemeEditor";
import { AssessmentOffBanner, useAssessmentOn } from "./AssessmentSwitch";
import {
  API, ASSESS_PATH, KIND_LABEL, PAPER_STATUS_LABEL, PAPER_STATUS_STYLE, fileToDataUrl, fmtCost, fmtMarks, paperRunning, scopeLabel,
  type AssessmentView, type PaperSummary,
} from "./answerCheckApi";

/** One assessment: upload a student's answer sheet, see every student's result, and the answer keys. */
export default function AssessmentPage({ assessmentId }: { assessmentId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { on, overview } = useAssessmentOn();
  const key = [`${API}/assessments/${assessmentId}`];
  const { data, isLoading, isError } = useQuery<{ assessment: AssessmentView }>({
    queryKey: key,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: q => (q.state.data?.assessment.sheets.some(s => paperRunning(s.status)) ? 3000 : false),
  });
  const a = data?.assessment;
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  async function remove() {
    if (!a || !window.confirm(`Delete "${a.title}" and all ${a.sheets.length} checked sheet${a.sheets.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    try {
      await apiRequest("DELETE", `${API}/assessments/${a.id}`);
      qc.invalidateQueries({ queryKey: [`${API}/assessments`] });
      setLocation(ASSESS_PATH);
    } catch (e: any) { toast({ title: "Not deleted", description: e.message, variant: "destructive" }); }
  }

  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <SaHeader
        icon={FileCheck2}
        tint="bg-orange-500"
        kind="Education · AI assessment (pilot)"
        title={a?.title ?? "Assessment"}
        subtitle={a ? [scopeLabel(a), a.mockTestId ? `Mock test ${a.mockTestId}` : null, `${a.questions.length} questions · ${fmtMarks(a.totalMarks)} marks`].filter(Boolean).join(" · ") : undefined}
        back={{ label: "All assessments", href: ASSESS_PATH }}
        actions={a && (
          <>
            <Button variant="outline" size="sm" onClick={() => setLocation(`${ASSESS_PATH}/${a.id}/edit`)} data-testid="asmt-edit"><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit questions</Button>
            <Button variant="ghost" size="sm" onClick={remove} data-testid="asmt-delete"><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button>
          </>
        )}
      />
      <SaBody>
        {on === false && <AssessmentOffBanner accountName={overview?.account?.name} />}
        {isLoading && <p className="text-[14px] text-gray-500">Loading…</p>}
        {isError && <p className="text-[14px] text-red-600">This assessment could not be loaded. It may have been deleted.</p>}
        {a && (
          <>
            <UploadSheet assessmentId={a.id} disabled={on === false || !a.questions.length} onStarted={id => { refresh(); setLocation(`${ASSESS_PATH}/papers/${id}`); }} onSample={refresh} />
            <Results a={a} />
            <AnswerKeys a={a} onChanged={refresh} />
          </>
        )}
      </SaBody>
    </div>
  );
}

function UploadSheet({ assessmentId, disabled, onStarted, onSample }: { assessmentId: string; disabled: boolean; onStarted: (paperId: string) => void; onSample: () => void }) {
  const { toast } = useToast();
  const [files, setFiles] = useState<Array<{ file: File; preview: string | null }>>([]);
  const [name, setName] = useState("");
  const [roll, setRoll] = useState("");
  const [busy, setBusy] = useState<"" | "check" | "sample">("");
  const [error, setError] = useState("");

  function add(list: FileList | null) {
    if (!list) return;
    setError("");
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!/^image\/(jpeg|png|webp)$/i.test(f.type) && f.type !== "application/pdf") { setError(`${f.name}: use photos (JPG, PNG) or a PDF.`); continue; }
      next.push({ file: f, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
    }
    setFiles(next.slice(0, 12));
  }

  async function check() {
    setBusy("check"); setError("");
    try {
      const data = await Promise.all(files.map(f => fileToDataUrl(f.file)));
      const res = await apiRequest<{ id: string; pages: number; warnings: string[] }>("POST", `${API}/assessments/${assessmentId}/sheets`, { files: data, names: files.map(f => f.file.name), studentName: name, rollNo: roll });
      if (res.warnings.length) toast({ title: "Note", description: res.warnings.join(" ") });
      setFiles([]); setName(""); setRoll("");
      onStarted(res.id);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  }

  async function sample() {
    setBusy("sample"); setError("");
    try {
      await apiRequest("POST", `${API}/assessments/${assessmentId}/sample`);
      toast({ title: "Sample sheet on its way", description: "The AI writes a student's sheet in handwriting and checks it — it appears in the results below." });
      onSample();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  }

  return (
    <Panel title="Check a student's answer sheet" subtitle="Photos of every page (in order) or a PDF of the sheet. The AI teacher finds each question's answer, marks it, and sends unclear ones for human intervention.">
      <div className="space-y-3">
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50/60 px-6 py-8 text-center hover:border-violet-400 hover:bg-violet-50/40"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); add(e.dataTransfer.files); }}
          data-testid="sheet-drop"
        >
          <FileUp className="h-7 w-7 text-gray-400" />
          <span className="text-[15px] font-medium text-gray-800">Drop the answer sheet here, or click to choose</span>
          <span className="text-[13px] text-gray-500">Photos (JPG, PNG) or PDF · up to 12 pages</span>
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={e => { add(e.target.files); e.target.value = ""; }} data-testid="sheet-input" />
        </label>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="sheet-files">
            {files.map((f, i) => (
              <div key={i} className="relative">
                {f.preview
                  ? <img src={f.preview} alt={`Page ${i + 1}`} className="h-24 w-[70px] rounded-lg border object-cover" />
                  : <div className="grid h-24 w-[70px] place-items-center rounded-lg border bg-white px-1 text-center text-[11px] text-gray-600">PDF<br />{f.file.name.slice(0, 18)}</div>}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[11px] text-white">{i + 1}</span>
                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-gray-900 text-white" aria-label={`Remove ${f.file.name}`}><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[13px] font-medium text-gray-700">Student name<Input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-56" data-testid="sheet-name" /></label>
          <label className="text-[13px] font-medium text-gray-700">Roll no.<Input value={roll} onChange={e => setRoll(e.target.value)} className="mt-1 w-32" data-testid="sheet-roll" /></label>
          <Button onClick={check} disabled={!!busy || disabled || !files.length} data-testid="sheet-check">{busy === "check" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Check answer sheet</Button>
          <Button variant="ghost" onClick={sample} disabled={!!busy || disabled} className="ml-auto text-gray-600" data-testid="sheet-sample">{busy === "sample" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}Try with a sample sheet</Button>
        </div>
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700" data-testid="sheet-error">{error}</p>}
      </div>
    </Panel>
  );
}

function Results({ a }: { a: AssessmentView }) {
  const [, setLocation] = useLocation();
  const s = a.stats;
  return (
    <>
      {a.sheets.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Sheets evaluated" value={s.checked} />
          <Stat label="Average marks" value={s.averageMarks === null ? "—" : `${fmtMarks(s.averageMarks)}/${fmtMarks(a.totalMarks)}`} />
          <Stat label="Human intervention" value={s.humanIntervention} />
          <Stat label="AI within ½ mark of teacher" value={s.teacher.compared ? `${s.teacher.withinHalf} of ${s.teacher.compared}` : "—"} hint={s.teacher.compared ? undefined : "enter teacher marks on an answer"} />
        </div>
      )}
      <Panel title="Results" subtitle={a.sheets.length ? "Click a student to see the question-wise marks, feedback and marked pages." : "No answer sheets checked yet."}>
        {a.sheets.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[14px]" data-testid="results-table">
              <thead>
                <tr className="border-b text-left text-[12px] text-gray-500">
                  <th className="py-2 pr-3 font-medium">Student</th>
                  <th className="py-2 pr-3 font-medium">Roll no.</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">AI marks</th>
                  <th className="py-2 pr-3 text-right font-medium">With teacher</th>
                  <th className="py-2 font-medium">Checked</th>
                </tr>
              </thead>
              <tbody>
                {a.sheets.map((p: PaperSummary) => (
                  <tr key={p.id} onClick={() => setLocation(`${ASSESS_PATH}/papers/${p.id}`)} className="cursor-pointer border-b border-black/[0.04] hover:bg-gray-50" data-testid={`result-row-${p.id}`}>
                    <td className="py-2.5 pr-3 text-gray-900">{p.studentLabel || "Student"}{p.source === "practice" && <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">Sample</span>}</td>
                    <td className="py-2.5 pr-3 text-gray-600">{p.rollNo || "—"}</td>
                    <td className="py-2.5 pr-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${PAPER_STATUS_STYLE[p.status]}`}>{paperRunning(p.status) && <Loader2 className="h-3 w-3 animate-spin" />}{PAPER_STATUS_LABEL[p.status]}</span></td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{p.totals.aiMarks === null ? "—" : `${fmtMarks(p.totals.aiMarks)}/${fmtMarks(p.totals.maxMarks)}`}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-600">{p.totals.teacherMarks === null ? "—" : fmtMarks(p.totals.teacherMarks)}</td>
                    <td className="py-2.5 text-[13px] text-gray-500">{new Date(p.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {fmtCost(p.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function AnswerKeys({ a, onChanged }: { a: AssessmentView; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel title="Questions and answer keys" subtitle="The AI wrote each answer key from the model answer. Open one to see or change how marks are given.">
      <div className="divide-y divide-black/[0.05]" data-testid="answer-keys">
        {a.questions.map(q => (
          <div key={q.questionKey} className="py-3">
            <button type="button" onClick={() => setOpen(open === q.questionKey ? null : q.questionKey)} className="flex w-full items-start gap-3 text-left" data-testid={`key-toggle-${q.number}`}>
              {open === q.questionKey ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />}
              <span className="w-10 shrink-0 font-semibold text-gray-900">Q{q.number}</span>
              <span className="min-w-0 flex-1 text-[14px] text-gray-800">{q.scheme?.questionText ?? "(answer key missing)"}</span>
              <span className="shrink-0 text-[13px] text-gray-500">{q.scheme ? `${fmtMarks(q.scheme.maxMarks)} marks${q.scheme.questionKind ? ` · ${KIND_LABEL[q.scheme.questionKind]}` : ""}` : ""}</span>
            </button>
            {open === q.questionKey && q.scheme && (
              <div className="ml-14 mt-3 space-y-3">
                <details className="text-[13px]" open>
                  <summary className="cursor-pointer text-violet-700">Model answer{q.scheme.modelAnswerByAi ? " (written by the AI)" : ""}</summary>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-gray-700">{q.scheme.modelAnswer || "—"}</p>
                </details>
                <SchemeEditor scheme={q.scheme} checksCount={0} onSaved={onChanged} onRechecked={onChanged} />
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
