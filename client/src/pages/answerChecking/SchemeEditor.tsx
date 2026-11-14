import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { schemeProblems, type MarkingScheme, type SchemeStep } from "@shared/answerCheck";
import { API, fmtMarks, type SchemeView } from "./answerCheckApi";

/**
 * A question's marking scheme: steps with marks, keywords, other accepted answers, the
 * final-answer-only rule and half marks. Shown read-only with "Edit"; saving makes a new approved
 * version, and "Re-check N answers" marks the question's answers again with it.
 */
export function SchemeEditor({ scheme, checksCount, off = false, onSaved, onRechecked }: { scheme: SchemeView; checksCount: number; off?: boolean; onSaved: (s: SchemeView) => void; onRechecked: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "approve" | "recheck">("");
  const [draft, setDraft] = useState<MarkingScheme>(scheme.scheme);
  const [maxMarks, setMaxMarks] = useState(String(scheme.maxMarks));
  const [modelAnswer, setModelAnswer] = useState(scheme.modelAnswer);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setDraft(scheme.scheme);
    setMaxMarks(String(scheme.maxMarks));
    setModelAnswer(scheme.modelAnswer);
  }, [scheme.id]);

  const max = Number(maxMarks);
  const total = draft.steps.reduce((a, s) => a + (Number(s.marks) || 0), 0);
  const problems = editing ? [...schemeProblems({ ...draft, steps: draft.steps.map(s => ({ ...s, marks: Number(s.marks) || 0 })) }, max), ...(draft.steps.some(s => !(Number(s.marks) > 0)) ? ["Every step needs more than 0 marks."] : [])] : [];

  const setStep = (i: number, patch: Partial<SchemeStep>) => setDraft(d => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, dir: -1 | 1) => setDraft(d => {
    const steps = d.steps.slice();
    const j = i + dir;
    if (j < 0 || j >= steps.length) return d;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...d, steps };
  });
  const listText = (l: string[]) => l.join("\n");
  const textList = (t: string) => t.split("\n").map(x => x.trim()).filter(Boolean);

  async function save() {
    setBusy("save");
    setServerProblems([]);
    try {
      const res = await apiRequest<{ scheme: SchemeView }>("PUT", `${API}/schemes/${encodeURIComponent(scheme.questionKey)}`, {
        maxMarks: max,
        modelAnswer,
        scheme: { ...draft, steps: draft.steps.map(s => ({ ...s, marks: Number(s.marks) })) },
      });
      setEditing(false);
      setJustSaved(true);
      onSaved(res.scheme);
      toast({ title: `Marking scheme saved (version ${res.scheme.version})` });
    } catch (e: any) {
      setServerProblems([e.message]);
    } finally { setBusy(""); }
  }

  async function approve() {
    setBusy("approve");
    try {
      const res = await apiRequest<{ scheme: SchemeView }>("POST", `${API}/schemes/${encodeURIComponent(scheme.questionKey)}/approve`);
      onSaved(res.scheme);
    } catch (e: any) { toast({ title: "Could not approve", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  }

  async function recheckAll() {
    setBusy("recheck");
    try {
      const res = await apiRequest<{ started: number }>("POST", `${API}/schemes/${encodeURIComponent(scheme.questionKey)}/recheck`);
      setJustSaved(false);
      onRechecked();
      toast({ title: `Re-checking ${res.started} answer${res.started === 1 ? "" : "s"} with version ${scheme.version}` });
    } catch (e: any) { toast({ title: "Could not re-check", description: e.message, variant: "destructive" }); }
    finally { setBusy(""); }
  }

  const s = scheme.scheme;
  return (
    <div className="space-y-4" data-testid="scheme-editor">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${scheme.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"}`} data-testid="scheme-status">
          {scheme.status === "approved" ? "Approved by admin" : "Drafted by AI"}
        </span>
        <span className="text-[12px] text-gray-500">Version {scheme.version} · {fmtMarks(scheme.maxMarks)} marks</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {!editing && scheme.status !== "approved" && (
            <Button size="sm" variant="outline" onClick={approve} disabled={!!busy} data-testid="scheme-approve">
              {busy === "approve" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}Approve as it is
            </Button>
          )}
          {!editing && <Button size="sm" variant="outline" onClick={() => { setEditing(true); setServerProblems([]); }} data-testid="scheme-edit"><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>}
        </div>
      </div>

      {justSaved && checksCount > 0 && !editing && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <span>{checksCount} answer{checksCount === 1 ? " was" : "s were"} marked with an earlier version.</span>
          <Button size="sm" onClick={recheckAll} disabled={!!busy || off} data-testid="scheme-recheck-all">
            {busy === "recheck" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}Re-check {checksCount === 1 ? "it" : `all ${checksCount}`} with this scheme
          </Button>
        </div>
      )}

      {!editing ? (
        <>
          <table className="w-full text-[14px]">
            <tbody>
              {s.steps.map((st, i) => (
                <tr key={st.id} className="border-b border-black/[0.05] last:border-0">
                  <td className="w-8 py-2 align-top text-gray-400">{i + 1}.</td>
                  <td className="py-2 pr-3 text-gray-900">{st.label}</td>
                  <td className="w-20 py-2 text-right font-medium tabular-nums">{fmtMarks(st.marks)} mark{st.marks === 1 ? "" : "s"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid gap-3 text-[13px] text-gray-600 md:grid-cols-2">
            {s.mustKeywords.length > 0 && <p><span className="font-medium text-gray-900">Must have:</span> {s.mustKeywords.join(", ")}</p>}
            {s.niceKeywords.length > 0 && <p><span className="font-medium text-gray-900">Nice to have:</span> {s.niceKeywords.join(", ")}</p>}
            {s.alternatives.length > 0 && <p className="md:col-span-2"><span className="font-medium text-gray-900">Also accept:</span> {s.alternatives.join("; ")}</p>}
            <p><span className="font-medium text-gray-900">Right answer, no working:</span> {s.finalAnswerOnlyMarks === null ? "marked by steps only" : `${fmtMarks(s.finalAnswerOnlyMarks)} mark(s)`}</p>
            <p><span className="font-medium text-gray-900">Half marks:</span> {s.allowHalfMarks ? "allowed" : "not allowed"}</p>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            {draft.steps.map((st, i) => (
              <div key={i} className="flex items-start gap-2" data-testid={`scheme-step-${i}`}>
                <span className="mt-2 w-6 text-right text-[13px] text-gray-400">{i + 1}.</span>
                <Textarea value={st.label} onChange={e => setStep(i, { label: e.target.value })} rows={1} className="min-h-9 flex-1 text-[14px]" placeholder="What the student must show" data-testid={`scheme-step-label-${i}`} />
                <Input value={String(st.marks)} onChange={e => setStep(i, { marks: e.target.value as any })} inputMode="decimal" className="w-20 text-right" aria-label="Marks" data-testid={`scheme-step-marks-${i}`} />
                <div className="flex">
                  <Button size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={i === draft.steps.length - 1} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDraft(d => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))} aria-label="Remove step" data-testid={`scheme-step-remove-${i}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3 pl-8">
              <Button size="sm" variant="outline" onClick={() => setDraft(d => ({ ...d, steps: [...d.steps, { id: `s${Date.now()}`, label: "", marks: 1 }] }))} data-testid="scheme-add-step"><Plus className="mr-1 h-3.5 w-3.5" />Add a step</Button>
              <span className={`text-[13px] tabular-nums ${Math.abs(total - max) < 1e-9 ? "text-emerald-700" : "text-red-600"}`} data-testid="scheme-total">Steps add up to {fmtMarks(total)} of {fmtMarks(max)}</span>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-[13px] font-medium text-gray-700">Maximum marks
              <Input value={maxMarks} onChange={e => setMaxMarks(e.target.value)} inputMode="decimal" className="mt-1 w-28" data-testid="scheme-max" />
            </label>
            <label className="block text-[13px] font-medium text-gray-700">Right answer but no working — marks (blank = mark by steps only)
              <Input value={draft.finalAnswerOnlyMarks ?? ""} onChange={e => setDraft(d => ({ ...d, finalAnswerOnlyMarks: e.target.value === "" ? null : (e.target.value as any) }))} inputMode="decimal" className="mt-1 w-28" />
            </label>
            <label className="block text-[13px] font-medium text-gray-700">Must-have keywords (one per line)
              <Textarea value={listText(draft.mustKeywords)} onChange={e => setDraft(d => ({ ...d, mustKeywords: textList(e.target.value) }))} rows={3} className="mt-1" />
            </label>
            <label className="block text-[13px] font-medium text-gray-700">Nice-to-have keywords (one per line)
              <Textarea value={listText(draft.niceKeywords)} onChange={e => setDraft(d => ({ ...d, niceKeywords: textList(e.target.value) }))} rows={3} className="mt-1" />
            </label>
            <label className="block text-[13px] font-medium text-gray-700 md:col-span-2">Also accept — other correct methods or wordings (one per line)
              <Textarea value={listText(draft.alternatives)} onChange={e => setDraft(d => ({ ...d, alternatives: textList(e.target.value) }))} rows={2} className="mt-1" />
            </label>
            <label className="block text-[13px] font-medium text-gray-700 md:col-span-2">Model answer
              <Textarea value={modelAnswer} onChange={e => setModelAnswer(e.target.value)} rows={4} className="mt-1" />
            </label>
            <label className="flex items-center gap-2 text-[13px] font-medium text-gray-700">
              <Switch checked={draft.allowHalfMarks} onCheckedChange={v => setDraft(d => ({ ...d, allowHalfMarks: v }))} />Half marks allowed
            </label>
          </div>
          {[...problems, ...serverProblems].length > 0 && (
            <ul className="list-disc space-y-0.5 rounded-xl bg-red-50 px-8 py-3 text-[13px] text-red-700" data-testid="scheme-problems">
              {Array.from(new Set([...problems, ...serverProblems])).map(p => <li key={p}>{p}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <Button onClick={save} disabled={!!busy || problems.length > 0} data-testid="scheme-save">{busy === "save" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save as version {scheme.version + 1}</Button>
            <Button variant="outline" onClick={() => { setEditing(false); setDraft(scheme.scheme); setMaxMarks(String(scheme.maxMarks)); setModelAnswer(scheme.modelAnswer); setServerProblems([]); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
