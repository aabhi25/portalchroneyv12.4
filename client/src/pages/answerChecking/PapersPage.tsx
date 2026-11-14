import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ExternalLink, ImagePlus, Loader2, Play, Shuffle, Trash2, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel } from "@/components/agency/agencyUi";
import { SearchQuestions, TypeQuestion } from "./CheckAnswerPage";
import { AssessmentOffBanner, useAssessmentOn } from "./AssessmentSwitch";
import {
  API, KIND_LABEL, PAPER_STATUS_LABEL, PAPER_STATUS_STYLE, fmtCost, fmtMarks, paperRunning, photoToDataUrl, scopeLabel,
  type PaperSummary, type QuestionInput, type SchemeView,
} from "./answerCheckApi";

interface PaperRow {
  number: string;
  scheme: SchemeView;
}

const DRAFT_KEY = "answer-checking:paper-draft";
const PAPERS_KEY = [`${API}/papers`];
const selectClass = "h-9 rounded-md border border-input bg-white px-2 text-[14px]";

function loadDraft(): { title: string; student: string; rows: PaperRow[] } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage blocked: start empty */ }
  return { title: "Mock test", student: "", rows: [] };
}

/** Super admin › Answer checking › Whole paper: set up a paper's questions, then check a whole answer sheet. */
export default function PapersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { on, overview } = useAssessmentOn();
  const off = on === false;
  const draft = loadDraft();
  const [title, setTitle] = useState(draft.title);
  const [student, setStudent] = useState(draft.student);
  const [rows, setRows] = useState<PaperRow[]>(draft.rows);
  const [adding, setAdding] = useState<"" | "search" | "type">("");
  const [preparing, setPreparing] = useState(0);
  const [randomCount, setRandomCount] = useState(5);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "check" | "practice" | "random">("");
  const [error, setError] = useState("");

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, student, rows })); } catch { /* not kept */ }
  }, [title, student, rows]);

  const { data: list } = useQuery<{ papers: PaperSummary[] }>({
    queryKey: PAPERS_KEY,
    refetchInterval: q => (q.state.data?.papers.some(p => paperRunning(p.status)) ? 3000 : false),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const nextNumber = (current: PaperRow[]) => {
    const nums = current.map(r => Number(r.number)).filter(Number.isFinite);
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  };

  /** Each question gets its answer key (drafted once by the AI, or the saved one). */
  async function addQuestions(qs: QuestionInput[]) {
    setError("");
    setPreparing(p => p + qs.length);
    const results = await Promise.all(qs.map(q => apiRequest<{ scheme: SchemeView }>("POST", `${API}/questions/prepare`, q).then(r => r.scheme).catch((e: any) => { setError(e.message); return null; })));
    setPreparing(p => p - qs.length);
    setRows(current => {
      const next = current.slice();
      for (const s of results) {
        if (!s || next.some(r => r.scheme.questionKey === s.questionKey)) continue;
        next.push({ number: nextNumber(next), scheme: s });
      }
      return next;
    });
  }

  async function addRandom() {
    setBusy("random"); setError("");
    try {
      const res = await apiRequest<{ questions: QuestionInput[]; notes: string[] }>("POST", `${API}/papers/random-questions`, { count: randomCount });
      if (!res.questions.length) setError(res.notes[0] || "No questions found.");
      else await addQuestions(res.questions);
      if (res.notes.length && res.questions.length) toast({ title: "Note", description: res.notes.join(" ") });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const next = photos.slice();
    for (const f of Array.from(files)) {
      if (next.length >= 12) { setError("At most 12 pages per answer sheet."); break; }
      try { next.push(await photoToDataUrl(f)); } catch (e: any) { setError(e.message); }
    }
    setPhotos(next);
  }

  const questions = rows.map(r => ({ number: r.number, questionKey: r.scheme.questionKey }));
  const numbersOk = rows.every(r => r.number.trim()) && new Set(rows.map(r => r.number.trim().toLowerCase())).size === rows.length;
  const total = rows.reduce((a, r) => a + r.scheme.maxMarks, 0);

  async function start(kind: "check" | "practice") {
    setBusy(kind); setError("");
    try {
      const res = kind === "check"
        ? await apiRequest<{ id: string }>("POST", `${API}/papers`, { title, studentLabel: student, questions, photos })
        : await apiRequest<{ id: string }>("POST", `${API}/papers/practice`, { title: `${title} (practice)`, studentLabel: "", questions });
      if (kind === "check") setPhotos([]);
      qc.invalidateQueries({ queryKey: PAPERS_KEY });
      setLocation(`/super-admin/answer-checking/papers/${res.id}`);
    } catch (e: any) { setError(e.message); toast({ title: "Couldn't start", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-5" data-testid="papers-page">
      {overview?.account && off && <AssessmentOffBanner accountName={overview.account.name} />}

      <Panel title="1. Set up the paper" subtitle="The questions on the student's answer sheet, with their numbers and marks. Each question gets its own answer key, drafted once by the AI.">
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="text-[13px] font-medium text-gray-700">Paper name<Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1 w-64" data-testid="paper-title" /></label>
          <label className="text-[13px] font-medium text-gray-700">Student (optional)<Input value={student} onChange={e => setStudent(e.target.value)} className="mt-1 w-56" placeholder="Name or roll no." data-testid="paper-student" /></label>
        </div>
        {rows.length > 0 && (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[14px]" data-testid="paper-questions">
              <thead>
                <tr className="border-b text-left text-[12px] text-gray-500">
                  <th className="w-20 py-2 pr-3 font-medium">No.</th>
                  <th className="py-2 pr-3 font-medium">Question</th>
                  <th className="py-2 pr-3 text-right font-medium">Marks</th>
                  <th className="py-2 pr-3 font-medium">Answer key</th>
                  <th className="w-20 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.scheme.questionKey} className="border-b border-black/[0.04]">
                    <td className="py-2 pr-3"><Input value={r.number} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, number: e.target.value.slice(0, 10) } : x)))} className="h-8 w-16" aria-label="Question number" data-testid={`paper-q-number-${i}`} /></td>
                    <td className="py-2 pr-3">
                      <p className="line-clamp-2 text-gray-900">{r.scheme.questionText}</p>
                      <p className="text-[12px] text-gray-500">{[scopeLabel(r.scheme), r.scheme.questionKind ? KIND_LABEL[r.scheme.questionKind] : null].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtMarks(r.scheme.maxMarks)}</td>
                    <td className="py-2 pr-3 text-[12px]">
                      <a href={`/super-admin/answer-checking?q=${encodeURIComponent(r.scheme.questionKey)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-700 hover:underline">
                        {r.scheme.status === "approved" ? "Approved" : "Drafted by AI"}<ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    <td className="py-2 text-right"><Button size="icon" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove question" data-testid={`paper-q-remove-${i}`}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[13px] text-gray-600" data-testid="paper-total">{rows.length} question{rows.length === 1 ? "" : "s"} · {fmtMarks(total)} marks{!numbersOk && <span className="ml-2 text-red-600">Every question needs its own number.</span>}</p>
          </div>
        )}
        {preparing > 0 && <p className="mb-3 flex items-center gap-2 text-[13px] text-gray-600" data-testid="paper-preparing"><Loader2 className="h-4 w-4 animate-spin" />The AI is writing the answer key for {preparing} question{preparing === 1 ? "" : "s"}…</p>}
        <div className="flex flex-wrap items-center gap-2">
          <select className={selectClass} value={randomCount} onChange={e => setRandomCount(Number(e.target.value))} aria-label="How many random questions" data-testid="paper-random-count">
            {[1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <Button variant="outline" onClick={addRandom} disabled={!!busy || off || preparing > 0} data-testid="paper-add-random">{busy === "random" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Shuffle className="mr-1.5 h-4 w-4" />}Add random questions</Button>
          <Button variant={adding === "search" ? "default" : "outline"} onClick={() => setAdding(adding === "search" ? "" : "search")} disabled={off} data-testid="paper-add-search"><BookOpen className="mr-1.5 h-4 w-4" />From Top Scholar's content</Button>
          <Button variant={adding === "type" ? "default" : "outline"} onClick={() => setAdding(adding === "type" ? "" : "type")} disabled={off} data-testid="paper-add-type"><Type className="mr-1.5 h-4 w-4" />Type a question</Button>
          {rows.length > 0 && <Button variant="ghost" onClick={() => { if (window.confirm("Remove all questions from this paper?")) setRows([]); }}>Clear</Button>}
        </div>
        {adding === "search" && <div className="mt-4 rounded-xl border border-black/[0.06] p-4"><SearchQuestions overview={overview} onPick={q => addQuestions([q])} /></div>}
        {adding === "type" && <div className="mt-4 rounded-xl border border-black/[0.06] p-4"><TypeQuestion overview={overview} onDone={q => { addQuestions([q]); setAdding(""); }} /></div>}
        {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700" data-testid="paper-error">{error}</p>}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="2a. Check a student's answer sheet" subtitle="All pages of the handwritten sheet, in order (JPG or PNG, up to 12). The AI finds which part answers which question — answers can be in any order.">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2" data-testid="paper-thumbs">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p} alt={`Page ${i + 1}`} className="h-28 w-20 rounded-lg border object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[11px] text-white">{i + 1}</span>
                  <button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-gray-900 text-white" aria-label={`Remove page ${i + 1}`}><X className="h-3 w-3" /></button>
                </div>
              ))}
              {photos.length < 12 && (
                <label className="grid h-28 w-20 cursor-pointer place-items-center rounded-lg border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
                  <span className="flex flex-col items-center text-[11px]"><ImagePlus className="mb-1 h-5 w-5" />Add pages</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ""; }} data-testid="paper-upload-input" />
                </label>
              )}
            </div>
            <Button onClick={() => start("check")} disabled={!!busy || off || !rows.length || !photos.length || !numbersOk || preparing > 0} data-testid="paper-check">
              {busy === "check" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Check whole paper
            </Button>
          </div>
        </Panel>
        <Panel title="2b. Practice answer sheet" subtitle="The AI writes one student's whole sheet in handwriting: strong, average and weak answers in turn, two answers in swapped order and (with 4+ questions) the last one skipped — then checks it like a real sheet.">
          <Button onClick={() => start("practice")} disabled={!!busy || off || !rows.length || !numbersOk || preparing > 0} data-testid="paper-practice">
            {busy === "practice" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}Make and check a practice sheet
          </Button>
        </Panel>
      </div>

      <Panel title="Papers checked" subtitle={list?.papers.length ? `${list.papers.length} so far` : "None yet."}>
        {list?.papers.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-[14px]" data-testid="papers-table">
              <thead>
                <tr className="border-b text-left text-[12px] text-gray-500">
                  <th className="py-2 pr-3 font-medium">Paper</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 text-right font-medium">AI total</th>
                  <th className="py-2 pr-3 text-right font-medium">Expected</th>
                  <th className="py-2 pr-3 text-right font-medium">Teacher</th>
                  <th className="py-2 pr-3 text-right font-medium">Questions</th>
                  <th className="py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {list.papers.map(p => (
                  <tr key={p.id} onClick={() => setLocation(`/super-admin/answer-checking/papers/${p.id}`)} className="cursor-pointer border-b border-black/[0.04] hover:bg-gray-50" data-testid={`paper-row-${p.id}`}>
                    <td className="py-2.5 pr-3">
                      <span className="text-gray-900">{p.title || "Paper"}</span>
                      <span className="ml-2 text-[12px] text-gray-500">{p.studentLabel}</span>
                      {p.source === "practice" && <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">Practice</span>}
                    </td>
                    <td className="py-2.5 pr-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${PAPER_STATUS_STYLE[p.status]}`}>{paperRunning(p.status) && <Loader2 className="h-3 w-3 animate-spin" />}{PAPER_STATUS_LABEL[p.status]}</span></td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{p.totals.aiMarks === null ? "—" : `${fmtMarks(p.totals.aiMarks)}/${fmtMarks(p.totals.maxMarks)}`}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-600">{fmtMarks(p.totals.expectedMarks)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-600">{fmtMarks(p.totals.teacherMarks)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-600">{p.questionCount}{p.totals.notAttempted ? ` (${p.totals.notAttempted} not attempted)` : ""}</td>
                    <td className="py-2.5 text-[13px] text-gray-500">{new Date(p.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {fmtCost(p.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-[14px] text-gray-500">Set up a paper above, then upload a student's sheet or make a practice sheet.</p>}
      </Panel>
    </div>
  );
}
