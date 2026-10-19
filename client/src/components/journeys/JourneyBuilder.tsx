import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle, ArrowDown, ArrowUp, CalendarCheck, CalendarDays, CornerDownRight, Flag, Hash, ListChecks,
  Loader2, Mail, Pencil, Phone, Plus, ShoppingBag, Sparkles, Trash2, Type, User, X,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ANSWER_KINDS, DEFAULT_ENDING_TEXT, SAVED_AS_SUGGESTIONS, incomingLinks, kindLabel, newQuestion, orderedStepIds,
  orphanEndings, questionPayload, questionProblems, readModel,
  type AnswerKind, type Ending, type JourneyModel, type Question, type StepRow, type Then,
} from "./journeyModel";
import { JourneyPreview } from "./JourneyPreview";

const KIND_ICON: Record<AnswerKind, LucideIcon> = {
  short: Type, choice: ListChecks, name: User, mobile: Phone, email: Mail, number: Hash,
  date: CalendarDays, appointment: CalendarCheck, products: ShoppingBag, special: Sparkles,
};

const AUTO_SAVED: AnswerKind[] = ["name", "mobile", "email"];
const NO_ANSWER: AnswerKind[] = ["appointment", "products", "special"];

const shorten = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Journey builder: the questions top to bottom as they're asked, each edited in place, with a
 * live chat on the side to try every path. Saves into the existing journey steps (see
 * journeyModel.ts), so the widget and the server run journeys exactly as before.
 */
export function JourneyBuilder({ journeyId, steps, aiWords }: { journeyId: string; steps: StepRow[]; aiWords: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const model = useMemo(() => readModel(steps), [steps]);
  const links = useMemo(() => incomingLinks(model), [model]);
  const [editing, setEditing] = useState<{ key: string; draft: Question } | null>(null);
  const [endingDraft, setEndingDraft] = useState<Ending | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const api = <T,>(method: string, path: string, body?: unknown) => apiRequest<T>(method, `/api/journeys/${journeyId}${path}`, body);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/journeys", journeyId] });
    queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
  };
  const fresh = async (): Promise<JourneyModel> => readModel((await api<{ steps?: StepRow[] }>("GET", "")).steps ?? []);
  const reorder = (ids: string[]) => api("POST", "/steps/reorder", { stepOrders: ids.map((id, i) => ({ id, stepOrder: i })) });
  /** After a change: drop endings nothing leads to and keep questions → ending → extra endings in order. */
  const tidy = async (questionIds?: string[]) => {
    const now = await fresh();
    const orphans = orphanEndings(now);
    for (const id of orphans) await api("DELETE", `/steps/${id}`);
    const kept = { ...now, extraEndings: now.extraEndings.filter(s => !orphans.includes(s.id)) };
    const ids = (questionIds ?? now.questions.map(q => q.id!)).filter(id => now.questions.some(q => q.id === id));
    await reorder(orderedStepIds(ids, kept));
  };
  const run = async (what: string, work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (e: any) {
      toast({ title: `Couldn't ${what}`, description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  /** Ending steps for options that end the chat: reuse, update or create them. */
  const prepareEndings = async (q: Question) => {
    const ids = new Map<number, string>();
    for (let i = 0; i < q.options.length; i++) {
      const then = q.options[i].then;
      if (then.kind !== "end") continue;
      const message = then.message.trim();
      if (then.endingStepId) {
        const endingId = then.endingStepId;
        const mainEnding = model.ending;
        const existing = model.extraEndings.find(s => s.id === endingId)
          ?? (mainEnding && mainEnding.id === endingId ? { questionText: mainEnding.message } : null);
        if (existing && existing.questionText !== message) await api("PUT", `/steps/${endingId}`, { questionText: message });
        ids.set(i, endingId);
      } else {
        const created = await api<StepRow>("POST", "/steps", {
          questionText: message, questionType: "text", toolTrigger: "journey_complete", isRequired: "false",
          isConditional: "true", stepOrder: "9999",
        });
        ids.set(i, created.id);
      }
    }
    return ids;
  };

  const saveQuestion = (draft: Question) => {
    const found = questionProblems(draft);
    setProblems(found);
    if (found.length > 0) return;
    run("save the question", async () => {
      const endingIds = await prepareEndings(draft);
      const payload = questionPayload(draft, endingIds);
      const order = model.questions.map(q => q.id!);
      if (draft.id) {
        await api("PUT", `/steps/${draft.id}`, payload);
      } else {
        const created = await api<StepRow>("POST", "/steps", { ...payload, stepOrder: String(model.questions.length) });
        order.push(created.id);
      }
      await tidy(order);
      setEditing(null);
      setProblems([]);
    });
  };

  const deleteQuestion = (q: Question) => run("delete the question", async () => {
    // Options elsewhere that led here now just go to the next question.
    for (const other of model.questions) {
      if (other.id === q.id) continue;
      const pointsHere = other.options.some(o => o.then.kind === "goto" && o.then.stepId === q.id)
        || other.keptRoutes.some(r => r.targetStepId === q.id) || other.defaultNextStepId === q.id;
      if (!pointsHere) continue;
      const fixed: Question = {
        ...other,
        options: other.options.map(o => (o.then.kind === "goto" && o.then.stepId === q.id ? { ...o, then: { kind: "next" } as Then } : o)),
        keptRoutes: other.keptRoutes.filter(r => r.targetStepId !== q.id),
        defaultNextStepId: other.defaultNextStepId === q.id ? null : other.defaultNextStepId,
      };
      const endings = new Map<number, string>();
      fixed.options.forEach((o, i) => { if (o.then.kind === "end" && o.then.endingStepId) endings.set(i, o.then.endingStepId); });
      await api("PUT", `/steps/${other.id}`, questionPayload(fixed, endings));
    }
    await api("DELETE", `/steps/${q.id}`);
    await tidy(model.questions.map(x => x.id!).filter(id => id !== q.id));
    setConfirmDelete(null);
  });

  const move = (index: number, dir: -1 | 1) => run("move the question", async () => {
    const ids = model.questions.map(q => q.id!);
    const j = index + dir;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await reorder(orderedStepIds(ids, model));
  });

  const setOnlyWhenLed = (q: Question, on: boolean) => run("change who is asked", async () => {
    await api("PUT", `/steps/${q.id}`, { isConditional: on ? "true" : "false" });
  });

  const saveEnding = (draft: Ending) => run("save the ending", async () => {
    const fields = { questionText: draft.message.trim() || DEFAULT_ENDING_TEXT, completionButtonText: draft.buttonText.trim() || null };
    if (draft.id) {
      await api("PUT", `/steps/${draft.id}`, fields);
    } else {
      await api("POST", "/steps", { ...fields, questionType: "text", toolTrigger: "journey_complete", isRequired: "false", isConditional: "false", stepOrder: String(model.questions.length) });
      await tidy();
    }
    setEndingDraft(null);
  });

  // The preview follows what's being edited, before it's saved.
  const previewModel = useMemo<JourneyModel>(() => {
    let questions = model.questions;
    if (editing) {
      questions = editing.draft.id
        ? questions.map(q => (q.id === editing.draft.id ? editing.draft : q))
        : [...questions, { ...editing.draft, id: "__new__" }];
    }
    return { ...model, questions, ending: endingDraft ?? model.ending };
  }, [model, editing, endingDraft]);

  const startEdit = (key: string, draft: Question) => {
    setProblems([]);
    setEndingDraft(null);
    setEditing({ key, draft: JSON.parse(JSON.stringify(draft)) });
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]" data-testid="journey-builder">
      <div className="min-w-0 space-y-3">
        {model.questions.length === 0 && !editing && (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center">
            <p className="font-medium text-gray-800">No questions yet</p>
            <p className="mt-1 text-sm text-gray-500">Add the first thing the assistant should ask.</p>
          </div>
        )}

        {model.questions.map((q, index) => {
          const key = q.id!;
          if (editing?.key === key) {
            return (
              <QuestionEditor
                key={key}
                index={index}
                draft={editing.draft}
                later={model.questions.slice(index + 1)}
                incoming={(links.get(key) ?? []).map(l => ({ ...l, fromText: model.questions[l.fromIndex]?.text ?? "" }))}
                problems={problems}
                busy={busy}
                onChange={(draft) => setEditing({ key, draft })}
                onSave={() => saveQuestion(editing.draft)}
                onCancel={() => { setEditing(null); setProblems([]); }}
              />
            );
          }
          return (
            <QuestionCard
              key={key}
              q={q}
              index={index}
              questions={model.questions}
              incoming={links.get(key) ?? []}
              busy={busy}
              confirmingDelete={confirmDelete === key}
              onEdit={() => startEdit(key, q)}
              onUp={index > 0 ? () => move(index, -1) : undefined}
              onDown={index < model.questions.length - 1 ? () => move(index, 1) : undefined}
              onAskDelete={() => setConfirmDelete(key)}
              onCancelDelete={() => setConfirmDelete(null)}
              onDelete={() => deleteQuestion(q)}
              onOnlyWhenLed={(on) => setOnlyWhenLed(q, on)}
            />
          );
        })}

        {editing?.key === "new" ? (
          <QuestionEditor
            index={model.questions.length}
            draft={editing.draft}
            later={[]}
            incoming={[]}
            problems={problems}
            busy={busy}
            onChange={(draft) => setEditing({ key: "new", draft })}
            onSave={() => saveQuestion(editing.draft)}
            onCancel={() => { setEditing(null); setProblems([]); }}
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => startEdit("new", newQuestion())}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-purple-200 py-3 text-sm font-medium text-purple-700 hover:bg-purple-50/60 disabled:opacity-50"
            data-testid="button-add-question"
          >
            <Plus className="h-4 w-4" /> Add a question
          </button>
        )}

        <EndingCard
          ending={model.ending}
          draft={endingDraft}
          busy={busy}
          onEdit={() => { setEditing(null); setEndingDraft(model.ending ?? { id: null, message: "", buttonText: "" }); }}
          onChange={setEndingDraft}
          onSave={() => endingDraft && saveEnding(endingDraft)}
          onCancel={() => setEndingDraft(null)}
        />
      </div>

      <div className="xl:sticky xl:top-4 xl:self-start">
        <JourneyPreview model={previewModel} aiWords={aiWords} />
      </div>
    </div>
  );
}

function thenSummary(then: Then, ownIndex: number, questions: Question[]): { text: string; warn?: boolean } {
  if (then.kind === "end") return { text: `Ends: “${shorten(then.message, 60)}”` };
  if (then.kind === "goto") {
    const target = questions.findIndex(q => q.id === then.stepId);
    if (target === -1) return { text: "Next question" };
    if (target <= ownIndex) return { text: `Points to an earlier question (Q${target + 1}), so it goes to the next one. Edit to choose again.`, warn: true };
    return { text: `Goes to Q${target + 1}: ${shorten(questions[target].text)}` };
  }
  return { text: "Next question" };
}

function QuestionCard({
  q, index, questions, incoming, busy, confirmingDelete,
  onEdit, onUp, onDown, onAskDelete, onCancelDelete, onDelete, onOnlyWhenLed,
}: {
  q: Question; index: number; questions: Question[]; incoming: { fromIndex: number; option: string }[];
  busy: boolean; confirmingDelete: boolean;
  onEdit: () => void; onUp?: () => void; onDown?: () => void;
  onAskDelete: () => void; onCancelDelete: () => void; onDelete: () => void; onOnlyWhenLed: (on: boolean) => void;
}) {
  const Icon = KIND_ICON[q.kind];
  const hasExtraRules = q.keptRoutes.length > 0 || q.keepExit || q.keepSkip || !!q.defaultNextStepId;
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${q.onlyWhenLed ? "border-dashed border-purple-300" : "border-black/[0.08]"}`} data-testid={`question-card-${index}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-purple-100 text-[12px] font-semibold text-purple-700">{index + 1}</span>
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left" title="Edit this question">
          <p className="text-[15px] font-medium leading-snug text-gray-900">{q.text || <span className="text-gray-400">(no words yet)</span>}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-gray-700"><Icon className="h-3.5 w-3.5" />{kindLabel(q.kind, q.raw)}</span>
            {!q.required && !NO_ANSWER.includes(q.kind) && <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-600">Optional</span>}
            {q.savedAs && <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-700">Saved as {q.savedAs}</span>}
            {q.onlyWhenLed && <span className="rounded-md bg-purple-50 px-2 py-0.5 text-purple-700">Asked only when an earlier answer leads here</span>}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="Move up" onClick={onUp} disabled={busy || !onUp}><ArrowUp className="h-4 w-4" /></IconButton>
          <IconButton label="Move down" onClick={onDown} disabled={busy || !onDown}><ArrowDown className="h-4 w-4" /></IconButton>
          <IconButton label="Edit" onClick={onEdit} disabled={busy}><Pencil className="h-4 w-4" /></IconButton>
          <IconButton label="Delete" onClick={onAskDelete} disabled={busy}><Trash2 className="h-4 w-4 text-red-500" /></IconButton>
        </div>
      </div>

      {q.kind === "choice" && q.options.length > 0 && (() => {
        // Options that simply go on are shown together; those that lead elsewhere get their own line.
        const plain = q.options.filter(o => o.then.kind === "next");
        const routed = q.options.filter(o => o.then.kind !== "next");
        const shown = plain.slice(0, 10);
        return (
          <div className="mt-3 space-y-1.5 pl-10 text-[13px]">
            {plain.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {shown.map((o, i) => <span key={i} className="rounded-full border border-purple-300 px-2.5 py-0.5 font-medium text-purple-700">{o.label}</span>)}
                {plain.length > shown.length && <span className="text-gray-500">+{plain.length - shown.length} more</span>}
                <span className="inline-flex items-center gap-1 text-gray-500"><CornerDownRight className="h-3.5 w-3.5" />Next question</span>
              </div>
            )}
            {routed.map((o, i) => {
              const summary = thenSummary(o.then, index, questions);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-purple-300 px-2.5 py-0.5 font-medium text-purple-700">{o.label}</span>
                  <CornerDownRight className="h-3.5 w-3.5 text-gray-400" />
                  <span className={summary.warn ? "text-amber-700" : "text-gray-700"}>{summary.text}</span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {incoming.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-purple-50/60 px-3 py-2 pl-10 text-[12.5px] text-purple-900">
          <span>Reached from {incoming.map(l => `“${l.option}” in Q${l.fromIndex + 1}`).join(", ")}</span>
          <label className="flex items-center gap-2">
            <span>Ask only then</span>
            <Switch checked={q.onlyWhenLed} disabled={busy} onCheckedChange={onOnlyWhenLed} aria-label="Ask only when an earlier answer leads here" />
          </label>
        </div>
      )}

      {hasExtraRules && (
        <p className="mt-2 pl-10 text-[12px] text-gray-500">This question also has rules set up earlier (for example "if the answer contains…"). They're kept as they are.</p>
      )}

      {confirmingDelete && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-800">
          Delete this question? Any answers that led here will go to the next question instead.
          <Button size="sm" variant="destructive" className="h-7" disabled={busy} onClick={onDelete}>Delete</Button>
          <Button size="sm" variant="outline" className="h-7" onClick={onCancelDelete}>Keep it</Button>
        </div>
      )}
    </div>
  );
}

function QuestionEditor({
  index, draft, later, incoming, problems, busy, onChange, onSave, onCancel,
}: {
  index: number; draft: Question; later: Question[];
  incoming: { fromIndex: number; option: string; fromText: string }[];
  problems: string[]; busy: boolean;
  onChange: (q: Question) => void; onSave: () => void; onCancel: () => void;
}) {
  const set = (patch: Partial<Question>) => onChange({ ...draft, ...patch });
  const setKind = (kind: AnswerKind) => {
    const patch: Partial<Question> = { kind };
    if (kind === "choice" && draft.options.length === 0) patch.options = [{ label: "", then: { kind: "next" } }, { label: "", then: { kind: "next" } }];
    if (NO_ANSWER.includes(kind)) patch.required = true;
    set(patch);
  };
  const setOption = (i: number, patch: Partial<{ label: string; then: Then }>) =>
    set({ options: draft.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  return (
    <div className="rounded-2xl border-2 border-purple-300 bg-white p-4 shadow-sm" data-testid="question-editor">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-purple-800">{draft.id ? `Question ${index + 1}` : "New question"}</p>
        <button type="button" onClick={onCancel} aria-label="Close" className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-4 w-4" /></button>
      </div>

      <label className="mb-1 block text-[13px] font-medium text-gray-700">What should the assistant ask?</label>
      <Textarea
        value={draft.text}
        onChange={(e) => set({ text: e.target.value })}
        placeholder="e.g. Which course are you interested in?"
        className="min-h-[64px] resize-none"
        autoFocus={!draft.id}
        data-testid="input-question-text"
      />

      {draft.kind !== "special" && (
        <>
          <p className="mb-1.5 mt-4 text-[13px] font-medium text-gray-700">How do they answer?</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {ANSWER_KINDS.map(k => {
              const Icon = KIND_ICON[k.kind];
              const active = draft.kind === k.kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => setKind(k.kind)}
                  className={`flex items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors ${active ? "border-purple-500 bg-purple-50" : "border-gray-200 hover:bg-gray-50"}`}
                  data-testid={`kind-${k.kind}`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-purple-700" : "text-gray-500"}`} />
                  <span>
                    <span className={`block text-[13px] font-medium ${active ? "text-purple-900" : "text-gray-800"}`}>{k.label}</span>
                    <span className="block text-[11.5px] leading-tight text-gray-500">{k.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {draft.kind === "choice" && (
        <div className="mt-4">
          <p className="mb-1.5 text-[13px] font-medium text-gray-700">Options, and what happens after each</p>
          <div className="space-y-2">
            {draft.options.map((o, i) => {
              const value = o.then.kind === "goto" ? `goto:${o.then.stepId}` : o.then.kind;
              return (
                <div key={i} className="rounded-xl border border-gray-200 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={o.label}
                      onChange={(e) => setOption(i, { label: e.target.value })}
                      placeholder={`Option ${i + 1}`}
                      className="h-9 min-w-[8rem] flex-1"
                      data-testid={`input-option-${i}`}
                    />
                    <span className="text-[12px] text-gray-500">then</span>
                    <Select
                      value={value}
                      onValueChange={(v) => {
                        if (v === "next") setOption(i, { then: { kind: "next" } });
                        else if (v === "end") setOption(i, { then: { kind: "end", message: o.then.kind === "end" ? o.then.message : "", endingStepId: o.then.kind === "end" ? o.then.endingStepId : undefined } });
                        else setOption(i, { then: { kind: "goto", stepId: v.slice(5) } });
                      }}
                    >
                      <SelectTrigger className="h-9 w-[min(16rem,100%)]" data-testid={`select-then-${i}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="next">Next question</SelectItem>
                        {later.map((l, j) => (
                          <SelectItem key={l.id} value={`goto:${l.id}`}>Go to Q{index + 2 + j}: {shorten(l.text, 40)}</SelectItem>
                        ))}
                        {o.then.kind === "goto" && !later.some(l => l.id === (o.then as { stepId: string }).stepId) && (
                          <SelectItem value={value}>An earlier question (choose again)</SelectItem>
                        )}
                        <SelectItem value="end">End the chat with a message</SelectItem>
                      </SelectContent>
                    </Select>
                    <IconButton label="Remove option" onClick={() => set({ options: draft.options.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></IconButton>
                  </div>
                  {o.then.kind === "end" && (
                    <Input
                      value={o.then.message}
                      onChange={(e) => setOption(i, { then: { ...(o.then as { kind: "end"; message: string; endingStepId?: string }), message: e.target.value } })}
                      placeholder="e.g. No problem! A counsellor will call you shortly."
                      className="mt-2 h-9"
                      data-testid={`input-end-message-${i}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => set({ options: [...draft.options, { label: "", then: { kind: "next" } }] })} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-purple-700 hover:text-purple-900" data-testid="button-add-option">
            <Plus className="h-4 w-4" /> Add an option
          </button>
          {later.length === 0 && <p className="mt-1 text-[12px] text-gray-500">To send an option to a later question, add that question first; it then shows in the list.</p>}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {!NO_ANSWER.includes(draft.kind) && (
          <label className="flex items-center justify-between gap-3 text-[13px] text-gray-700">
            <span>They must answer this <span className="text-gray-500">(otherwise they can skip it)</span></span>
            <Switch checked={draft.required} onCheckedChange={(v) => set({ required: v })} aria-label="They must answer this" />
          </label>
        )}

        {!AUTO_SAVED.includes(draft.kind) && !NO_ANSWER.includes(draft.kind) && (
          <div>
            <label className="mb-1 block text-[13px] text-gray-700">Saved as <span className="text-gray-500">(optional, used in the lead and for your CRM)</span></label>
            <Input
              value={draft.savedAs}
              onChange={(e) => set({ savedAs: e.target.value.replace(/\s+/g, "_") })}
              placeholder="e.g. course"
              list="journey-saved-as"
              className="h-9 max-w-xs"
              data-testid="input-saved-as"
            />
            <datalist id="journey-saved-as">{SAVED_AS_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
          </div>
        )}
        {AUTO_SAVED.includes(draft.kind) && (
          <p className="text-[12px] text-gray-500">Saved to the lead's {draft.kind === "mobile" ? "mobile number" : draft.kind} automatically.</p>
        )}

        {(incoming.length > 0 || draft.onlyWhenLed) && (
          <label className="flex items-center justify-between gap-3 rounded-xl bg-purple-50/60 px-3 py-2 text-[13px] text-purple-900">
            <span>
              Ask only when an earlier answer leads here
              {incoming.length > 0 && <span className="block text-[12px] text-purple-700">From {incoming.map(l => `“${l.option}” in Q${l.fromIndex + 1}`).join(", ")}</span>}
            </span>
            <Switch checked={draft.onlyWhenLed} onCheckedChange={(v) => set({ onlyWhenLed: v })} aria-label="Ask only when an earlier answer leads here" />
          </label>
        )}
      </div>

      {problems.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-900" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{problems.map(p => <p key={p}>{p}</p>)}</div>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={onSave} disabled={busy} data-testid="button-save-question">
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {draft.id ? "Save question" : "Add question"}
        </Button>
      </div>
    </div>
  );
}

function EndingCard({ ending, draft, busy, onEdit, onChange, onSave, onCancel }: {
  ending: Ending | null; draft: Ending | null; busy: boolean;
  onEdit: () => void; onChange: (e: Ending) => void; onSave: () => void; onCancel: () => void;
}) {
  if (draft) {
    return (
      <div className="rounded-2xl border-2 border-purple-300 bg-white p-4" data-testid="ending-editor">
        <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-purple-800"><Flag className="h-4 w-4" /> How the journey ends</p>
        <label className="mb-1 block text-[13px] text-gray-700">Closing message</label>
        <Textarea value={draft.message} onChange={(e) => onChange({ ...draft, message: e.target.value })} placeholder={DEFAULT_ENDING_TEXT} className="min-h-[56px] resize-none" data-testid="input-ending-message" />
        <label className="mb-1 mt-3 block text-[13px] text-gray-700">Button under it <span className="text-gray-500">(optional, e.g. "Continue exploring")</span></label>
        <Input value={draft.buttonText} onChange={(e) => onChange({ ...draft, buttonText: e.target.value })} className="h-9 max-w-xs" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={onSave} disabled={busy} data-testid="button-save-ending">{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save ending</Button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" onClick={onEdit} disabled={busy} className="flex w-full items-start gap-3 rounded-2xl border border-black/[0.08] bg-gray-50 p-4 text-left hover:bg-gray-100/70" data-testid="ending-card">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gray-200 text-gray-600"><Flag className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium uppercase tracking-wide text-gray-500">Ending</span>
        <span className="block text-[14.5px] text-gray-800">{ending?.message || DEFAULT_ENDING_TEXT}</span>
        {ending?.buttonText && <span className="mt-1 inline-block rounded-full border border-purple-300 px-2.5 py-0.5 text-[12px] text-purple-700">{ending.buttonText}</span>}
        {!ending && <span className="block text-[12px] text-gray-500">The standard message. Click to write your own.</span>}
      </span>
      <Pencil className="h-4 w-4 shrink-0 text-gray-400" />
    </button>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30">
      {children}
    </button>
  );
}
