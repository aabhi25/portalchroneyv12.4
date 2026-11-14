import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileCheck2, FileUp, Loader2, Plus, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel } from "@/components/agency/agencyUi";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { AiDraftBox } from "./AiDraftBox";
import { CurriculumSearch } from "./CurriculumSearch";
import { AssessmentOffBanner, useAssessmentOn } from "./AssessmentSwitch";
import { API, ASSESS_PATH, fileToDataUrl, fmtMarks, type AssessmentView, type ImportedPaper, type QuestionInput } from "./answerCheckApi";

interface Row {
  number: string;
  questionText: string;
  maxMarks: string;
  modelAnswer: string;
  /** Model answer written by the AI (not from the client's document) — shown so it gets checked. */
  modelAnswerByAi?: boolean;
  questionKey?: string | null;
  chapter?: string | null;
  fromCurriculum?: boolean;
  /** Question and model answer written by the AI from the chapter's content — shown so they get checked. */
  aiDrafted?: boolean;
}

const emptyRow = (n: number): Row => ({ number: String(n), questionText: "", maxMarks: "", modelAnswer: "" });

/** Create or edit an assessment: name, class, and the questions with marks and model answers. */
export default function AssessmentEditor({ assessmentId }: { assessmentId?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { on, overview } = useAssessmentOn();
  const existing = useQuery<{ assessment: AssessmentView }>({ queryKey: [`${API}/assessments/${assessmentId}`], enabled: !!assessmentId, staleTime: 0 });
  const [title, setTitle] = useState("");
  const [mockTestId, setMockTestId] = useState("");
  const [board, setBoard] = useState("");
  const [medium, setMedium] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(!assessmentId);
  const [adding, setAdding] = useState<"" | "import" | "curriculum" | "draft">(assessmentId ? "" : "import");
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    const a = existing.data?.assessment;
    if (!a || loaded) return;
    setTitle(a.title); setMockTestId(a.mockTestId ?? ""); setBoard(a.board ?? ""); setMedium(a.medium ?? ""); setGrade(a.grade ?? ""); setSubject(a.subject ?? "");
    setRows(a.questions.map(q => ({
      number: q.number, questionText: q.scheme?.questionText ?? "", maxMarks: q.scheme ? String(q.scheme.maxMarks) : "",
      modelAnswer: q.scheme?.modelAnswer ?? "", modelAnswerByAi: q.scheme?.modelAnswerByAi, questionKey: q.questionKey, chapter: q.scheme?.chapter, fromCurriculum: q.questionKey.startsWith("cms:"),
    })));
    setLoaded(true);
  }, [existing.data]);

  const nextNumber = (list: Row[]) => {
    const nums = list.map(r => parseInt(r.number, 10)).filter(Number.isFinite);
    return (nums.length ? Math.max(...nums) : 0) + 1;
  };
  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((a, r) => a + (Number(r.maxMarks) || 0), 0);

  function applyImport(p: ImportedPaper) {
    if (!title && p.title) setTitle(p.title);
    if (!board && p.board) setBoard(p.board);
    if (!medium && p.medium) setMedium(p.medium);
    if (!grade && p.grade) setGrade(p.grade);
    if (!subject && p.subject) setSubject(p.subject);
    const written = p.questions.filter(q => !q.objective);
    const skipped = p.questions.length - written.length;
    setRows(rs => [...rs.filter(r => r.questionText.trim()), ...written.map(q => ({
      number: q.number, questionText: q.question, maxMarks: q.marks ? String(q.marks) : "", modelAnswer: q.modelAnswer, modelAnswerByAi: q.modelAnswerByAi,
    }))]);
    setAdding("");
    toast({ title: `${written.length} question${written.length === 1 ? "" : "s"} imported`, description: [skipped ? `${skipped} multiple-choice or objective question${skipped === 1 ? " was" : "s were"} left out (checked by the client's own system).` : "", "Check each question, its marks and model answer, then save."].filter(Boolean).join(" ") });
  }

  function addFromCurriculum(q: QuestionInput) {
    setRows(rs => [...rs.filter(r => r.questionText.trim()), {
      number: String(nextNumber(rs)), questionText: q.questionText, maxMarks: String(q.maxMarks), modelAnswer: q.modelAnswer,
      modelAnswerByAi: !q.modelAnswer, questionKey: q.questionKey, chapter: q.chapter, fromCurriculum: true,
    }]);
    if (!board && q.board) setBoard(q.board);
    if (!medium && q.medium) setMedium(q.medium);
    if (!grade && q.grade) setGrade(q.grade);
    if (!subject && q.subject) setSubject(q.subject);
  }

  function addDrafted(qs: QuestionInput[], note: string) {
    setRows(rs => {
      let n = nextNumber(rs);
      return [...rs.filter(r => r.questionText.trim()), ...qs.map(q => ({
        number: String(n++), questionText: q.questionText, maxMarks: String(q.maxMarks), modelAnswer: q.modelAnswer, chapter: q.chapter, aiDrafted: true,
      }))];
    });
    const q = qs[0];
    if (q) {
      if (!board && q.board) setBoard(q.board);
      if (!medium && q.medium) setMedium(q.medium);
      if (!grade && q.grade) setGrade(q.grade);
      if (!subject && q.subject) setSubject(q.subject);
    }
    setAdding("");
    toast({ title: `${qs.length} question${qs.length === 1 ? "" : "s"} written by the AI`, description: note });
  }

  async function save() {
    setSaving(true); setProblems([]);
    try {
      const body = {
        title, mockTestId, board, medium, grade, subject,
        questions: rows.filter(r => r.questionText.trim() || r.modelAnswer.trim()).map(r => ({
          number: r.number, questionText: r.questionText, maxMarks: Number(r.maxMarks), modelAnswer: r.modelAnswer, questionKey: r.questionKey ?? null, chapter: r.chapter ?? null,
        })),
      };
      const res = assessmentId
        ? await apiRequest<{ assessment: AssessmentView }>("PUT", `${API}/assessments/${assessmentId}`, body)
        : await apiRequest<{ assessment: AssessmentView }>("POST", `${API}/assessments`, body);
      qc.invalidateQueries({ queryKey: [`${API}/assessments`] });
      qc.invalidateQueries({ queryKey: [`${API}/assessments/${res.assessment.id}`] });
      setLocation(`${ASSESS_PATH}/${res.assessment.id}`);
    } catch (e: any) {
      setProblems([e.message]);
      toast({ title: "Not saved", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  const back = assessmentId ? `${ASSESS_PATH}/${assessmentId}` : ASSESS_PATH;
  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <SaHeader icon={FileCheck2} tint="bg-orange-500" kind="Education · AI assessment (pilot)" title={assessmentId ? "Edit assessment" : "New assessment"} back={{ label: assessmentId ? "Back to the assessment" : "Assessment", href: back }} />
      <SaBody className="max-w-[1100px]">
        {on === false && <AssessmentOffBanner accountName={overview?.account?.name} />}
        {!loaded ? <p className="text-[14px] text-gray-500">Loading…</p> : (
          <>
            <Panel title="1. About this test">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-[13px] font-medium text-gray-700 md:col-span-2">Name<Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1" placeholder="e.g. Science Mock Test 1 – Grade 10" data-testid="asmt-title" /></label>
                <label className="text-[13px] font-medium text-gray-700">Mock test ID (optional)<Input value={mockTestId} onChange={e => setMockTestId(e.target.value)} className="mt-1" placeholder="From the client's app" data-testid="asmt-mocktest" /></label>
                <label className="text-[13px] font-medium text-gray-700">Board<Input value={board} onChange={e => setBoard(e.target.value)} className="mt-1" placeholder="CBSE" /></label>
                <label className="text-[13px] font-medium text-gray-700">Grade<Input value={grade} onChange={e => setGrade(e.target.value)} className="mt-1" placeholder="10" data-testid="asmt-grade" /></label>
                <label className="text-[13px] font-medium text-gray-700">Medium<Input value={medium} onChange={e => setMedium(e.target.value)} className="mt-1" placeholder="English" /></label>
                <label className="text-[13px] font-medium text-gray-700 md:col-span-3">Subject<Input value={subject} onChange={e => setSubject(e.target.value)} className="mt-1" placeholder="Science" data-testid="asmt-subject" /></label>
              </div>
            </Panel>

            <Panel
              title="2. Questions and model answers"
              subtitle="The AI teacher marks each answer against its model answer. It writes a step-by-step answer key from it, which you can see and change on the assessment page."
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button variant={adding === "import" ? "default" : "outline"} size="sm" onClick={() => setAdding(adding === "import" ? "" : "import")} data-testid="asmt-add-import"><FileUp className="mr-1.5 h-4 w-4" />Import from document</Button>
                  <Button variant={adding === "curriculum" ? "default" : "outline"} size="sm" onClick={() => setAdding(adding === "curriculum" ? "" : "curriculum")} data-testid="asmt-add-curriculum"><BookOpen className="mr-1.5 h-4 w-4" />From the curriculum</Button>
                  <Button variant={adding === "draft" ? "default" : "outline"} size="sm" onClick={() => setAdding(adding === "draft" ? "" : "draft")} data-testid="asmt-add-draft"><Wand2 className="mr-1.5 h-4 w-4" />Write questions with AI</Button>
                  <Button variant="outline" size="sm" onClick={() => setRows(rs => [...rs, emptyRow(nextNumber(rs))])} data-testid="asmt-add-row"><Plus className="mr-1.5 h-4 w-4" />Add a question</Button>
                </div>
              }
            >
              {adding === "import" && <ImportBox disabled={on === false} onImported={applyImport} onClose={() => setAdding("")} />}
              {adding === "draft" && <AiDraftBox disabled={on === false} avoid={rows.map(r => r.questionText).filter(t => t.trim())} onDrafted={addDrafted} onClose={() => setAdding("")} />}
              {adding === "curriculum" && (
                <div className="mb-4 rounded-xl border border-black/[0.06] p-4">
                  <CurriculumSearch onPick={addFromCurriculum} picked={rows.map(r => r.questionKey || "")} />
                </div>
              )}
              {rows.length === 0 && adding === "" && <p className="text-[14px] text-gray-500">No questions yet. Import the client's question paper, take them from the curriculum, have the AI write them from a chapter, or add them one by one.</p>}
              <div className="space-y-3" data-testid="asmt-rows">
                {rows.map((r, i) => (
                  <div key={i} className="rounded-xl border border-black/[0.08] p-4" data-testid={`asmt-row-${i}`}>
                    <div className="flex flex-wrap items-start gap-3">
                      <label className="w-16 text-[12px] font-medium text-gray-600">No.<Input value={r.number} onChange={e => setRow(i, { number: e.target.value.slice(0, 10) })} className="mt-1 h-9" /></label>
                      <label className="min-w-[240px] flex-1 text-[12px] font-medium text-gray-600">Question{r.fromCurriculum && <span className="ml-2 rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] text-cyan-700">From the curriculum{r.chapter ? ` · ${r.chapter}` : ""}</span>}
                        {r.aiDrafted && <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700" data-testid={`asmt-drafted-${i}`}>Written by AI from the chapter content{r.chapter ? ` · ${r.chapter}` : ""} — please check</span>}
                        <Textarea value={r.questionText} onChange={e => setRow(i, { questionText: e.target.value })} rows={2} className="mt-1" data-testid={`asmt-q-${i}`} />
                      </label>
                      <label className="w-24 text-[12px] font-medium text-gray-600">Marks<Input value={r.maxMarks} onChange={e => setRow(i, { maxMarks: e.target.value })} inputMode="decimal" className="mt-1 h-9" placeholder="e.g. 3" data-testid={`asmt-marks-${i}`} /></label>
                      <Button size="icon" variant="ghost" className="mt-5" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label="Remove question"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <label className="mt-2 block text-[12px] font-medium text-gray-600">Model answer
                      {r.modelAnswerByAi && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">Written by the AI — not in the document, please check</span>}
                      <Textarea value={r.modelAnswer} onChange={e => setRow(i, { modelAnswer: e.target.value, modelAnswerByAi: false })} rows={3} className="mt-1" placeholder="The full-marks answer. Leave empty and the AI writes one." data-testid={`asmt-answer-${i}`} />
                    </label>
                  </div>
                ))}
              </div>
              {rows.length > 0 && <p className="mt-3 text-[13px] text-gray-600" data-testid="asmt-total">{rows.length} question{rows.length === 1 ? "" : "s"} · {fmtMarks(total)} marks</p>}
            </Panel>

            {problems.length > 0 && <ul className="list-disc space-y-0.5 rounded-xl bg-red-50 px-8 py-3 text-[14px] text-red-700" data-testid="asmt-problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
            <div className="sticky bottom-4 flex items-center justify-end gap-3">
              {saving && <span className="rounded-full bg-white px-3 py-1.5 text-[13px] text-gray-600 shadow">The AI is preparing the answer keys… (about 10–30 seconds)</span>}
              <Button variant="outline" onClick={() => setLocation(back)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving || on === false || !rows.length} className="shadow-lg" data-testid="asmt-save">{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save assessment</Button>
            </div>
          </>
        )}
      </SaBody>
    </div>
  );
}

function ImportBox({ disabled, onImported, onClose }: { disabled: boolean; onImported: (p: ImportedPaper) => void; onClose: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true); setError("");
    try {
      const data = await Promise.all(files.map(fileToDataUrl));
      const res = await apiRequest<ImportedPaper>("POST", `${API}/assessments/import`, { files: data, names: files.map(f => f.name), text });
      onImported(res);
      setFiles([]); setText("");
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="mb-4 space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4" data-testid="import-box">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] text-gray-800"><Sparkles className="mr-1 inline h-4 w-4 text-violet-600" />Upload the client's question paper with its answer key (PDF, Word, or photos), or paste the text. The AI fills in the questions, marks and model answers for you to check.</p>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input bg-white px-3 py-2 text-[13px] font-medium hover:bg-gray-50">
          <FileUp className="h-4 w-4" />Choose files
          <input type="file" multiple accept=".pdf,.docx,image/jpeg,image/png,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={e => { setFiles([...files, ...Array.from(e.target.files || [])].slice(0, 10)); e.target.value = ""; }} data-testid="import-files" />
        </label>
        {files.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] text-gray-700 shadow-sm">{f.name}
            <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
      <Textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="…or paste the questions and answers here" data-testid="import-text" />
      {error && <p className="text-[13px] text-red-600" data-testid="import-error">{error}</p>}
      <Button onClick={run} disabled={busy || disabled || (!files.length && !text.trim())} data-testid="import-run">
        {busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Reading the document… (up to a minute)</> : "Import questions"}
      </Button>
    </div>
  );
}
