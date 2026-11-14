import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ImagePlus, Loader2, Play, Search, Shuffle, Sparkles, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel } from "@/components/agency/agencyUi";
import { PRACTICE_LEVELS, QUESTION_KINDS, type PracticeLevel, type QuestionKind } from "@shared/answerCheck";
import { SchemeEditor } from "./SchemeEditor";
import { AssessmentOffBanner, useScopes } from "./AssessmentSwitch";
import { ASSESS_PATH,
  API, KIND_LABEL, LEVEL_LABEL, OVERVIEW_KEY, STATUS_LABEL, STATUS_STYLE, fmtMarks, isRunning, photoToDataUrl, scopeLabel,
  type ChecksResponse, type Overview, type QuestionInput, type SchemeView,
} from "./answerCheckApi";

type Mode = "random" | "search" | "type";

const selectClass = "h-9 rounded-md border border-input bg-white px-2 text-[14px]";

/** Super admin › Answer checking › Check an answer: question → marking scheme → answers → results. */
export default function CheckAnswerPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const questionKey = new URLSearchParams(search).get("q");
  const { data: overview } = useQuery<Overview>({ queryKey: OVERVIEW_KEY, staleTime: 0, refetchOnMount: "always" });

  const schemeQuery = useQuery<{ scheme: SchemeView; checks: number }>({
    queryKey: [`${API}/schemes/${encodeURIComponent(questionKey || "")}`],
    enabled: !!questionKey,
  });
  const scheme = questionKey ? schemeQuery.data?.scheme ?? null : null;
  const checksQuery = useQuery<ChecksResponse>({
    queryKey: [`${API}/checks?questionKey=${encodeURIComponent(questionKey || "")}`],
    enabled: !!questionKey,
    refetchInterval: q => (q.state.data?.checks.some(isRunning) ? 2500 : false),
  });
  const checks = checksQuery.data?.checks ?? [];
  const wasRunning = useMemo(() => checks.some(isRunning), [checks]);
  useEffect(() => { if (!wasRunning && questionKey) qc.invalidateQueries({ queryKey: [`${API}/schemes/${encodeURIComponent(questionKey)}`] }); }, [wasRunning]);

  const [fullTest, setFullTest] = useState("");
  const openQuestion = (key: string) => setLocation(`${ASSESS_PATH}?q=${encodeURIComponent(key)}`);
  const refreshChecks = () => qc.invalidateQueries({ queryKey: [`${API}/checks?questionKey=${encodeURIComponent(questionKey || "")}`] });

  /** One click: random question → its marking scheme → strong, average and weak practice answers. */
  async function runFullTest() {
    try {
      setFullTest("Picking a random question…");
      const picked = await apiRequest<{ question: QuestionInput | null; note: string }>("POST", `${API}/questions/random`);
      if (!picked.question) throw new Error(picked.note || "No question found.");
      setFullTest("The AI is writing the marking scheme…");
      const prepared = await apiRequest<{ scheme: SchemeView }>("POST", `${API}/questions/prepare`, picked.question);
      setFullTest("Writing three practice answers…");
      await apiRequest("POST", `${API}/practice`, { questionKey: prepared.scheme.questionKey, levels: ["strong", "average", "weak"] });
      openQuestion(prepared.scheme.questionKey);
      if (picked.note) toast({ title: "Question set by the AI", description: picked.note });
    } catch (e: any) {
      toast({ title: "Full test stopped", description: e.message, variant: "destructive" });
    } finally { setFullTest(""); }
  }

  const noKey = overview?.account && !overview.account.hasKey;
  const off = overview ? !overview.enabled : false;
  return (
    <div className="space-y-5" data-testid="answer-checking-page">
      {!overview?.account && overview && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-800">This account was not found.</div>
      )}
      {overview?.account && off && <AssessmentOffBanner accountName={overview.account.name} />}
      {noKey && <div className="rounded-xl bg-amber-50 px-4 py-3 text-[14px] text-amber-900">This account has no OpenAI key, so answers can't be checked. A super admin can add it on the account's "AI & keys" tab.</div>}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/[0.06] bg-white px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-gray-900">Run a full test</p>
          <p className="text-[13px] text-gray-500">Picks a random question, writes its marking scheme, then makes and checks three practice answers (strong, average, weak).</p>
        </div>
        <Button onClick={runFullTest} disabled={!!fullTest || !overview?.account?.hasKey || off} data-testid="run-full-test">
          {fullTest ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}{fullTest || "Run full test"}
        </Button>
      </div>

      <Panel
        title="1. Question"
        subtitle={scheme ? scopeLabel(scheme) || "Typed question" : "Pick a question from the curriculum, or type one."}
        actions={scheme && <Button variant="outline" size="sm" onClick={() => setLocation(`${ASSESS_PATH}`)} data-testid="change-question">Change question</Button>}
      >
        {questionKey && schemeQuery.isLoading && <p className="text-[14px] text-gray-500">Loading…</p>}
        {questionKey && schemeQuery.isError && <p className="text-[14px] text-red-600">This question could not be loaded.</p>}
        {scheme ? (
          <div className="space-y-2" data-testid="chosen-question">
            <p className="whitespace-pre-wrap text-[15px] text-gray-900">{scheme.questionText}</p>
            <p className="text-[13px] text-gray-500">
              {fmtMarks(scheme.maxMarks)} marks{scheme.questionKind ? ` · ${KIND_LABEL[scheme.questionKind]}` : ""} · {scheme.source === "cms" ? "From the curriculum" : scheme.source === "generated" ? "Set by the AI from the chapter notes" : "Typed by an admin"}
            </p>
            {scheme.modelAnswer && (
              <details className="text-[13px]">
                <summary className="cursor-pointer text-violet-700">Model answer{scheme.modelAnswerByAi ? " (written by the AI — there was none)" : ""}</summary>
                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-gray-700">{scheme.modelAnswer}</p>
              </details>
            )}
          </div>
        ) : !questionKey && <QuestionPicker overview={overview} off={off} onPrepared={s => openQuestion(s.questionKey)} />}
      </Panel>

      {scheme && (
        <>
          <Panel title="2. Marking scheme" subtitle="Drafted once by the AI from the model answer and saved, so every student is marked the same way. Edit it if it isn't right.">
            <SchemeEditor off={off} scheme={scheme} checksCount={schemeQuery.data?.checks ?? 0} onSaved={() => { qc.invalidateQueries({ queryKey: [`${API}/schemes/${encodeURIComponent(scheme.questionKey)}`] }); refreshChecks(); }} onRechecked={refreshChecks} />
          </Panel>
          <div className="grid gap-5 lg:grid-cols-2">
            <UploadPanel off={off} questionKey={scheme.questionKey} onStarted={id => { refreshChecks(); setLocation(`${ASSESS_PATH}/checks/${id}`); }} />
            <PracticePanel off={off} questionKey={scheme.questionKey} onStarted={refreshChecks} />
          </div>
          <Panel title="Answers to this question" subtitle={checks.length ? `${checks.length} checked` : "None yet."}>
            <AnswersList checks={checks} />
          </Panel>
        </>
      )}
    </div>
  );
}

function QuestionPicker({ overview, off, onPrepared }: { overview: Overview | undefined; off: boolean; onPrepared: (s: SchemeView) => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("random");
  const [candidate, setCandidate] = useState<QuestionInput | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "random" | "prepare" | "search">("");
  const [error, setError] = useState("");

  async function pickRandom() {
    setBusy("random"); setError(""); setNote("");
    try {
      const res = await apiRequest<{ question: QuestionInput | null; note: string; looked: { packs: number; questions: number; writtenQuestions: number } }>("POST", `${API}/questions/random`);
      if (!res.question) { setCandidate(null); setError(res.note || "No question found."); return; }
      setCandidate(res.question);
      setNote(res.note);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  }

  async function prepare(q: QuestionInput) {
    setBusy("prepare"); setError("");
    try {
      const res = await apiRequest<{ scheme: SchemeView }>("POST", `${API}/questions/prepare`, q);
      onPrepared(res.scheme);
    } catch (e: any) { setError(e.message); toast({ title: "Could not prepare the question", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  }

  const tab = (m: Mode, label: string, Icon: typeof Shuffle) => (
    <button type="button" onClick={() => { setMode(m); setCandidate(null); setError(""); setNote(""); }} data-testid={`picker-${m}`}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium ${mode === m ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
      <Icon className="h-3.5 w-3.5" />{label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tab("random", "Random question", Shuffle)}
        {tab("search", "From the curriculum", BookOpen)}
        {tab("type", "Type your own", Type)}
      </div>
      {mode === "random" && !candidate && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={pickRandom} disabled={!!busy || off} data-testid="pick-random">{busy === "random" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Shuffle className="mr-1.5 h-4 w-4" />}Pick a random question</Button>
          <span className="text-[13px] text-gray-500">From the classes, subjects and question types chosen in Settings.</span>
        </div>
      )}
      {mode === "search" && !candidate && <SearchQuestions overview={overview} onPick={setCandidate} />}
      {mode === "type" && !candidate && <TypeQuestion overview={overview} onDone={setCandidate} />}
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-[14px] text-red-700" data-testid="picker-error">{error}</p>}
      {candidate && (
        <CandidateCard
          q={candidate}
          note={note}
          busy={busy}
          off={off}
          onChange={setCandidate}
          onUse={() => prepare(candidate)}
          onAnother={mode === "random" ? pickRandom : () => setCandidate(null)}
          anotherLabel={mode === "random" ? "Pick another" : "Back"}
        />
      )}
    </div>
  );
}

function CandidateCard({ q, note, busy, off, onChange, onUse, onAnother, anotherLabel }: {
  q: QuestionInput; note: string; busy: string; off: boolean; onChange: (q: QuestionInput) => void; onUse: () => void; onAnother: () => void; anotherLabel: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-black/[0.08] bg-gray-50/60 p-4" data-testid="candidate-question">
      {note && <p className="flex items-start gap-1.5 text-[13px] text-violet-800"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />{note}</p>}
      <p className="text-[12px] text-gray-500">{scopeLabel(q) || "Typed question"}{q.questionKind ? ` · ${KIND_LABEL[q.questionKind]}` : ""}</p>
      <p className="whitespace-pre-wrap text-[15px] text-gray-900" data-testid="candidate-text">{q.questionText}</p>
      {q.modelAnswer ? (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-violet-700">Model answer</summary>
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-gray-700">{q.modelAnswer}</p>
        </details>
      ) : <p className="text-[13px] text-amber-700">No model answer — the AI will write one first.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[13px] font-medium text-gray-700">Max marks
          <Input value={String(q.maxMarks)} onChange={e => onChange({ ...q, maxMarks: Number(e.target.value) || 0 })} inputMode="decimal" className="mt-1 w-24" data-testid="candidate-max" />
        </label>
        <Button onClick={onUse} disabled={!!busy || off || !(q.maxMarks > 0)} data-testid="use-question">
          {busy === "prepare" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{busy === "prepare" ? "The AI is writing the marking scheme…" : "Use this question"}
        </Button>
        <Button variant="outline" onClick={onAnother} disabled={!!busy} data-testid="another-question">{busy === "random" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{anotherLabel}</Button>
      </div>
    </div>
  );
}

export function SearchQuestions({ overview, onPick }: { overview: Overview | undefined; onPick: (q: QuestionInput) => void }) {
  const { scopes, error: scopesError, loading } = useScopes();
  const [scopeIdx, setScopeIdx] = useState(0);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [results, setResults] = useState<QuestionInput[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = scopes[scopeIdx];
  if (loading) return <p className="text-[14px] text-gray-500">Loading the classes and subjects…</p>;
  if (scopesError) return <p className="text-[14px] text-red-600">{scopesError}</p>;
  if (!scopes.length) return <p className="text-[14px] text-gray-500">This account has no curriculum content yet.</p>;

  async function run() {
    if (!scope) return;
    setBusy(true); setError("");
    try {
      const p = new URLSearchParams({ board: scope.board, medium: scope.medium, grade: scope.grade, subject, q: text });
      const res = await apiRequest<{ results: QuestionInput[] }>("GET", `${API}/questions/search?${p}`);
      setResults(res.results);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[13px] font-medium text-gray-700">Class
          <select className={`${selectClass} mt-1 block`} value={scopeIdx} onChange={e => { setScopeIdx(Number(e.target.value)); setSubject(""); }} data-testid="search-scope">
            {scopes.map((s, i) => <option key={i} value={i}>{scopeLabel(s)}</option>)}
          </select>
        </label>
        <label className="text-[13px] font-medium text-gray-700">Subject
          <select className={`${selectClass} mt-1 block`} value={subject} onChange={e => setSubject(e.target.value)} data-testid="search-subject">
            <option value="">All subjects</option>
            {scope?.subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} placeholder="Words in the question (optional)" className="w-64" data-testid="search-text" />
        <Button onClick={run} disabled={busy} data-testid="search-run">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}Search</Button>
      </div>
      {error && <p className="text-[14px] text-red-600">{error}</p>}
      {results && (results.length === 0
        ? <p className="text-[14px] text-gray-500" data-testid="search-empty">No written-answer questions found. Multiple-choice and true/false questions are left out.</p>
        : (
          <ul className="max-h-[420px] divide-y divide-black/[0.05] overflow-y-auto rounded-xl border border-black/[0.06]" data-testid="search-results">
            {results.map(r => (
              <li key={r.questionKey} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[14px] text-gray-900">{r.questionText}</p>
                  <p className="text-[12px] text-gray-500">{[r.subject, r.chapter, r.questionKind ? KIND_LABEL[r.questionKind] : null].filter(Boolean).join(" · ")}{r.modelAnswer ? "" : " · no model answer"}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onPick(r)}>Choose</Button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

export function TypeQuestion({ overview, onDone }: { overview: Overview | undefined; onDone: (q: QuestionInput) => void }) {
  const [questionText, setQuestionText] = useState("");
  const [modelAnswer, setModelAnswer] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const { scopes } = useScopes();
  const [board, setBoard] = useState(scopes[0]?.board ?? "");
  const [medium, setMedium] = useState("English");
  const [kind, setKind] = useState<QuestionKind | "">("");
  const [maxMarks, setMaxMarks] = useState("3");
  return (
    <div className="space-y-3">
      <label className="block text-[13px] font-medium text-gray-700">Question
        <Textarea value={questionText} onChange={e => setQuestionText(e.target.value)} rows={3} className="mt-1" placeholder="e.g. State Ohm's law and write its formula." data-testid="type-question" />
      </label>
      <label className="block text-[13px] font-medium text-gray-700">Model answer (optional, but marking is more reliable with one)
        <Textarea value={modelAnswer} onChange={e => setModelAnswer(e.target.value)} rows={3} className="mt-1" data-testid="type-model-answer" />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="text-[13px] font-medium text-gray-700">Subject<Input value={subject} onChange={e => setSubject(e.target.value)} className="mt-1 w-40" placeholder="Science" data-testid="type-subject" /></label>
        <label className="text-[13px] font-medium text-gray-700">Grade<Input value={grade} onChange={e => setGrade(e.target.value)} className="mt-1 w-20" placeholder="10" data-testid="type-grade" /></label>
        <label className="text-[13px] font-medium text-gray-700">Board<Input value={board} onChange={e => setBoard(e.target.value)} className="mt-1 w-28" placeholder="CBSE" /></label>
        <label className="text-[13px] font-medium text-gray-700">Medium<Input value={medium} onChange={e => setMedium(e.target.value)} className="mt-1 w-28" /></label>
        <label className="text-[13px] font-medium text-gray-700">Type
          <select className={`${selectClass} mt-1 block`} value={kind} onChange={e => setKind(e.target.value as QuestionKind | "")}>
            <option value="">Let the AI decide</option>
            {QUESTION_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="text-[13px] font-medium text-gray-700">Max marks<Input value={maxMarks} onChange={e => setMaxMarks(e.target.value)} inputMode="decimal" className="mt-1 w-20" data-testid="type-max" /></label>
      </div>
      <Button
        disabled={questionText.trim().length < 5 || !(Number(maxMarks) > 0)}
        onClick={() => onDone({
          questionKey: "", source: "custom", questionText: questionText.trim(), modelAnswer: modelAnswer.trim(), questionKind: kind || null,
          board: board.trim() || null, medium: medium.trim() || null, grade: grade.trim() || null, subject: subject.trim() || null, chapter: null, maxMarks: Number(maxMarks),
        })}
        data-testid="type-continue"
      >Continue</Button>
    </div>
  );
}

function UploadPanel({ questionKey, off, onStarted }: { questionKey: string; off: boolean; onStarted: (id: string) => void }) {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<string[]>([]);
  const [student, setStudent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const next = photos.slice();
    for (const f of Array.from(files)) {
      if (next.length >= 5) { setError("At most 5 photos per answer."); break; }
      try { next.push(await photoToDataUrl(f)); } catch (e: any) { setError(e.message); }
    }
    setPhotos(next);
  }

  async function submit() {
    setBusy(true); setError("");
    try {
      const res = await apiRequest<{ id: string }>("POST", `${API}/checks`, { questionKey, photos, studentLabel: student });
      setPhotos([]); setStudent("");
      onStarted(res.id);
    } catch (e: any) { setError(e.message); toast({ title: "Could not start checking", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }

  return (
    <Panel title="3a. Check a student's answer" subtitle="Photos of the handwritten answer, pages in order (JPG or PNG, up to 5).">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" data-testid="upload-thumbs">
          {photos.map((p, i) => (
            <div key={i} className="relative">
              <img src={p} alt={`Page ${i + 1}`} className="h-28 w-20 rounded-lg border object-cover" />
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[11px] text-white">{i + 1}</span>
              <button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-gray-900 text-white" aria-label={`Remove page ${i + 1}`}><X className="h-3 w-3" /></button>
            </div>
          ))}
          {photos.length < 5 && (
            <label className="grid h-28 w-20 cursor-pointer place-items-center rounded-lg border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
              <span className="flex flex-col items-center text-[11px]"><ImagePlus className="mb-1 h-5 w-5" />Add page</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ""; }} data-testid="upload-input" />
            </label>
          )}
        </div>
        <Input value={student} onChange={e => setStudent(e.target.value)} placeholder="Student name or roll no. (optional)" data-testid="upload-student" />
        {error && <p className="text-[13px] text-red-600" data-testid="upload-error">{error}</p>}
        <Button onClick={submit} disabled={busy || off || !photos.length} data-testid="upload-check">{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Check answer</Button>
      </div>
    </Panel>
  );
}

function PracticePanel({ questionKey, off, onStarted }: { questionKey: string; off: boolean; onStarted: () => void }) {
  const { toast } = useToast();
  const [levels, setLevels] = useState<PracticeLevel[]>(["strong", "average", "weak"]);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await apiRequest("POST", `${API}/practice`, { questionKey, levels });
      onStarted();
      toast({ title: `Writing ${levels.length} practice answer${levels.length === 1 ? "" : "s"}`, description: "They appear below and are checked one by one." });
    } catch (e: any) { toast({ title: "Could not make practice answers", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }
  const hint: Record<PracticeLevel, string> = {
    strong: "full or nearly full marks",
    average: "about half the marks",
    weak: "a wrong idea or calculation",
    ai_copied: "tests the AI-written estimate",
  };
  return (
    <Panel title="3b. Practice answers" subtitle="The AI writes answers at known levels, draws them in handwriting and checks them — expected marks are shown next to the AI's.">
      <div className="space-y-3">
        {PRACTICE_LEVELS.map(l => (
          <label key={l} className="flex items-center gap-2 text-[14px] text-gray-800">
            <Checkbox checked={levels.includes(l)} onCheckedChange={v => setLevels(v ? [...levels, l].filter((x, i, a) => a.indexOf(x) === i) : levels.filter(x => x !== l))} data-testid={`practice-${l}`} />
            {LEVEL_LABEL[l]} <span className="text-[12px] text-gray-500">— {hint[l]}</span>
          </label>
        ))}
        <Button onClick={run} disabled={busy || off || !levels.length} data-testid="practice-run">{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Make and check {levels.length} practice answer{levels.length === 1 ? "" : "s"}</Button>
      </div>
    </Panel>
  );
}

export function AnswersList({ checks, showQuestion = false }: { checks: ChecksResponse["checks"]; showQuestion?: boolean }) {
  const [, setLocation] = useLocation();
  if (!checks.length) return <p className="text-[14px] text-gray-500">Upload a student's answer or make practice answers above.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-[14px]" data-testid="answers-table">
        <thead>
          <tr className="border-b text-left text-[12px] text-gray-500">
            <th className="py-2 pr-3 font-medium">Answer</th>
            {showQuestion && <th className="py-2 pr-3 font-medium">Question</th>}
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 text-right font-medium">AI marks</th>
            <th className="py-2 pr-3 text-right font-medium">Expected</th>
            <th className="py-2 pr-3 text-right font-medium">Teacher</th>
            <th className="py-2 font-medium">AI-written</th>
          </tr>
        </thead>
        <tbody>
          {checks.map(c => {
            const gapTo = (other: number | null) => (c.aiMarks !== null && other !== null ? c.aiMarks - other : null);
            const gap = (g: number | null) => g === null ? null
              : <span className={`ml-1.5 text-[12px] ${Math.abs(g) <= 0.5 ? "text-emerald-600" : "text-red-600"}`}>({g > 0 ? "+" : ""}{fmtMarks(g)})</span>;
            return (
              <tr key={c.id} onClick={() => setLocation(`${ASSESS_PATH}/checks/${c.id}`)} className="cursor-pointer border-b border-black/[0.04] hover:bg-gray-50" data-testid={`answer-row-${c.id}`}>
                <td className="py-2.5 pr-3">
                  <span className="text-gray-900">{c.studentLabel || "Uploaded answer"}</span>
                  {c.practiceLevel && <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">{LEVEL_LABEL[c.practiceLevel]}</span>}
                </td>
                {showQuestion && <td className="max-w-[320px] truncate py-2.5 pr-3 text-gray-600">{c.scheme?.questionText}</td>}
                <td className="py-2.5 pr-3">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${STATUS_STYLE[c.status]}`}>
                    {isRunning(c) && <Loader2 className="h-3 w-3 animate-spin" />}{STATUS_LABEL[c.status]}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{c.aiMarks === null ? "—" : `${fmtMarks(c.aiMarks)}/${fmtMarks(c.maxMarks)}`}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-gray-600">{fmtMarks(c.expectedMarks)}{gap(gapTo(c.expectedMarks))}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-gray-600">{fmtMarks(c.teacherMarks)}{gap(gapTo(c.teacherMarks))}</td>
                <td className="py-2.5 text-[13px] text-gray-600">{c.aiWritten?.percent !== null && c.aiWritten?.percent !== undefined ? `${c.aiWritten.percent}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
