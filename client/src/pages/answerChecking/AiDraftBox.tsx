import { useEffect, useState } from "react";
import { Loader2, Wand2, X } from "lucide-react";
import { subjectKindOf, type QuestionKind } from "@shared/answerCheck";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { EMPTY_SCOPE, ScopePicker, scopeReady, type Scope } from "./ScopePicker";
import { API, KIND_LABEL, type QuestionInput } from "./answerCheckApi";

const MAX_QUESTIONS = 15;

interface Ask { kind: QuestionKind; count: string; marks: string }

const defaultAsks = (subject: string): Ask[] => {
  const kind = subjectKindOf(subject);
  const numeric = kind === "maths" || kind === "science";
  return [
    { kind: "short", count: "3", marks: "2" },
    { kind: "long", count: "2", marks: "5" },
    { kind: "numerical", count: numeric ? "1" : "0", marks: "3" },
  ];
};

/**
 * "Write questions with AI": the AI writes written-answer questions with model answers from the
 * chosen chapter's own content (notes, e-book pages, video transcripts), added to the assessment
 * for the admin to check before saving.
 */
export function AiDraftBox({ disabled, avoid, onDrafted, onClose }: { disabled: boolean; avoid: string[]; onDrafted: (qs: QuestionInput[], note: string) => void; onClose: () => void }) {
  const [scope, setScope] = useState<Scope>(EMPTY_SCOPE);
  const [asks, setAsks] = useState<Ask[]>(defaultAsks(""));
  const [touched, setTouched] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Numerical problems only by default for maths and science, until the admin changes the counts.
  useEffect(() => { if (!touched) setAsks(defaultAsks(scope.subject)); }, [scope.subject]);

  const setAsk = (i: number, patch: Partial<Ask>) => { setTouched(true); setAsks(a => a.map((x, j) => (j === i ? { ...x, ...patch } : x))); };
  const count = asks.reduce((a, x) => a + (parseInt(x.count, 10) || 0), 0);
  const marks = asks.reduce((a, x) => a + (parseInt(x.count, 10) || 0) * (Number(x.marks) || 0), 0);
  const badMarks = asks.some(x => (parseInt(x.count, 10) || 0) > 0 && !(Number(x.marks) >= 0.5 && Number(x.marks) <= 100));

  async function run() {
    setBusy(true); setError("");
    try {
      const res = await apiRequest<{ questions: QuestionInput[]; note: string }>("POST", `${API}/questions/draft`, {
        scope,
        asks: asks.map(x => ({ kind: x.kind, count: parseInt(x.count, 10) || 0, marks: Number(x.marks) || 0 })).filter(x => x.count > 0),
        instructions,
        avoid,
      });
      onDrafted(res.questions, res.note);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4" data-testid="draft-box">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] text-gray-800"><Wand2 className="mr-1 inline h-4 w-4 text-violet-600" />The AI reads the chapter's own notes, e-book pages and video transcripts and writes written-answer questions with model answers from them. Leave the chapter on "All chapters" to mix questions from the subject's chapters.</p>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <ScopePicker value={scope} onChange={setScope} needSubject />
      <div className="grid gap-2 sm:grid-cols-3" data-testid="draft-asks">
        {asks.map((a, i) => (
          <div key={a.kind} className="rounded-lg border border-black/[0.06] bg-white p-3">
            <p className="text-[13px] font-medium text-gray-800">{KIND_LABEL[a.kind]}</p>
            <div className="mt-1 flex gap-3 text-[12px] text-gray-500">
              <label className="flex-1">How many
                <Input value={a.count} onChange={e => setAsk(i, { count: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" className="mt-0.5 h-8" aria-label={`${KIND_LABEL[a.kind]}: how many`} data-testid={`draft-count-${a.kind}`} />
              </label>
              <label className="flex-1">Marks each
                <Input value={a.marks} onChange={e => setAsk(i, { marks: e.target.value.slice(0, 4) })} inputMode="decimal" className="mt-0.5 h-8" aria-label={`${KIND_LABEL[a.kind]}: marks each`} data-testid={`draft-marks-${a.kind}`} />
              </label>
            </div>
          </div>
        ))}
      </div>
      <Input value={instructions} onChange={e => setInstructions(e.target.value.slice(0, 500))} placeholder="Anything else for the AI (optional), e.g. include one case-based question" data-testid="draft-instructions" />
      {error && <p className="text-[13px] text-red-600" data-testid="draft-error">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={busy || disabled || !scopeReady(scope, true) || count < 1 || count > MAX_QUESTIONS || badMarks} data-testid="draft-run">
          {busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Reading the chapter and writing questions… (up to a minute)</> : `Write ${count} question${count === 1 ? "" : "s"}`}
        </Button>
        <span className="text-[13px] text-gray-500">{count > MAX_QUESTIONS ? `At most ${MAX_QUESTIONS} at a time.` : badMarks ? "Give each kind marks between 0.5 and 100." : `${marks} marks in all`}</span>
      </div>
    </div>
  );
}
