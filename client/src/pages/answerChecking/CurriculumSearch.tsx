import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { EMPTY_SCOPE, ScopePicker, scopeReady, type Scope } from "./ScopePicker";
import { API, KIND_LABEL, type QuestionInput } from "./answerCheckApi";

/**
 * The synced curriculum's written-answer questions (as on the Widget Tester: board → medium →
 * grade → subject → chapter), to add to an assessment. Multiple choice is left out.
 */
export function CurriculumSearch({ onPick, picked = [] }: { onPick: (q: QuestionInput) => void; picked?: string[] }) {
  const [scope, setScope] = useState<Scope>(EMPTY_SCOPE);
  const [text, setText] = useState("");
  const [results, setResults] = useState<QuestionInput[] | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!scopeReady(scope, true)) return;
    setBusy(true); setError("");
    try {
      const p = new URLSearchParams({ ...scope, q: text });
      const res = await apiRequest<{ results: QuestionInput[]; summary: string }>("GET", `${API}/questions/search?${p}`);
      setResults(res.results);
      setSummary(res.summary);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3" data-testid="curriculum-search">
      <ScopePicker value={scope} onChange={s => { setScope(s); setResults(null); setSummary(""); }} needSubject />
      <div className="flex flex-wrap items-end gap-2">
        <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} placeholder="Words in the question (optional)" className="w-64" data-testid="search-text" />
        <Button variant="outline" onClick={run} disabled={busy || !scopeReady(scope, true)} data-testid="search-run">{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}{busy ? "Looking through every question…" : "Show questions"}</Button>
      </div>
      {error && <p className="text-[14px] text-red-600">{error}</p>}
      {results && summary && <p className={`rounded-xl px-4 py-3 text-[13px] ${results.length ? "bg-gray-50 text-gray-600" : "bg-amber-50 text-amber-900"}`} data-testid="search-summary">{summary}</p>}
      {results && (results.length === 0
        ? <p className="text-[14px] text-gray-500" data-testid="search-empty">No written-answer questions found{scope.chapter ? " in this chapter" : ""}. Multiple-choice, true/false and fill-in-the-blank questions are left out. You can still import the client's question paper with its answers.</p>
        : (
          <ul className="max-h-[360px] divide-y divide-black/[0.05] overflow-y-auto rounded-xl border border-black/[0.06]" data-testid="search-results">
            {results.map(r => {
              const added = picked.includes(r.questionKey);
              return (
                <li key={r.questionKey} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[14px] text-gray-900">{r.questionText}</p>
                    <p className="text-[12px] text-gray-500">{[r.chapter, r.questionKind ? KIND_LABEL[r.questionKind] : null].filter(Boolean).join(" · ")}{r.modelAnswer ? "" : " · no model answer"}</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={added} onClick={() => onPick(r)}>{added ? "Added" : "Add"}</Button>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
