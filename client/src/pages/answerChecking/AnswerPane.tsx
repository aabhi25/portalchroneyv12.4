import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { StudentView, TeacherView } from "./CheckDetailPage";
import { API, isRunning, fmtMarks, type CheckView, type PaperView } from "./answerCheckApi";

/** The dot on a question's button: full marks, some, none, a teacher should look, still being marked. */
function dot(c: CheckView): { color: string; label: string } {
  if (isRunning(c)) return { color: "bg-sky-400", label: "being evaluated" };
  if (c.status === "needs_teacher" || c.status === "failed") return { color: "bg-amber-500", label: "needs a teacher" };
  if (c.reading?.notAttempted) return { color: "bg-gray-300", label: "not attempted" };
  const marks = c.teacherMarks ?? c.aiMarks ?? 0;
  return marks >= c.maxMarks ? { color: "bg-emerald-500", label: "full marks" } : marks > 0 ? { color: "bg-yellow-400", label: "some marks" } : { color: "bg-red-500", label: "no marks" };
}

/**
 * One question of a checked sheet, beside the list: everything about the answer, with the paper's
 * other questions one click away. The list stays usable while it is open.
 */
export function AnswerPane({ p, number, onGo, onClose, onDirty, mayLeave }: {
  p: PaperView;
  number: string;
  onGo: (number: string) => void;
  onClose: () => void;
  /** Teacher's marks typed but not saved; `mayLeave` asks before they are lost. */
  onDirty: (dirty: boolean) => void;
  mayLeave: () => boolean;
}) {
  const [view, setView] = useState<"teacher" | "student">("teacher");
  const index = p.checks.findIndex(c => c.questionNumber === number);
  const summary = p.checks[index];
  const { data } = useQuery<{ check: CheckView }>({
    queryKey: [`${API}/checks/${summary?.id}`],
    enabled: !!summary,
    staleTime: 0,
    refetchOnMount: "always",
    placeholderData: summary ? { check: summary } : undefined,
    refetchInterval: q => (q.state.data && isRunning(q.state.data.check) ? 2000 : false),
  });
  const c = data?.check;

  const step = useCallback((by: number) => {
    const next = p.checks[index + by];
    if (next?.questionNumber) onGo(next.questionNumber);
  }, [p.checks, index, onGo]);

  // ← → go through the questions (not while typing, nor while a page is open in the viewer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true], [data-testid=page-viewer]")) return;
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Esc closes the pane — first, before a toast on screen takes the key; a page open in the viewer closes on its own.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[data-testid=page-viewer]")) onClose(); };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Keeps the open question's button in view when the row of questions is longer than the pane.
  const [chips, setChips] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const chip = chips?.querySelector<HTMLElement>("[aria-current=true]");
    if (chips && chip) chips.scrollLeft = chip.offsetLeft - chips.offsetLeft - (chips.clientWidth - chip.offsetWidth) / 2;
  }, [chips, number]);

  if (!summary) return null;
  const arrow = "grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-30";
  return (
    <DialogPrimitive.Root open modal={false} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-[#f5f5f7] shadow-[-12px_0_40px_rgba(0,0,0,0.12)] outline-none duration-300 animate-in slide-in-from-right sm:w-[min(680px,92vw)]"
          aria-describedby={undefined}
          onOpenAutoFocus={e => e.preventDefault()}
          onEscapeKeyDown={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
          data-testid="answer-pane"
        >
          <div className="border-b bg-white px-4 pb-3 pt-3 sm:px-5">
            <div className="flex items-center gap-2">
              <button type="button" className={arrow} onClick={() => step(-1)} disabled={index === 0} aria-label="Previous question" title="Previous question (←)" data-testid="pane-prev"><ChevronLeft className="h-5 w-5" /></button>
              <button type="button" className={arrow} onClick={() => step(1)} disabled={index === p.checks.length - 1} aria-label="Next question" title="Next question (→)" data-testid="pane-next"><ChevronRight className="h-5 w-5" /></button>
              <DialogPrimitive.Title className="min-w-0 flex-1 truncate pl-1 text-[17px] font-semibold text-gray-900" data-testid="pane-title">
                <span className="sm:hidden">Q</span><span className="hidden sm:inline">Question </span>{number}<span className="ml-2 hidden text-[13px] font-normal text-gray-500 sm:inline">{index + 1} of {p.checks.length} · {fmtMarks(summary.teacherMarks ?? summary.aiMarks)}/{fmtMarks(summary.maxMarks)}</span>
              </DialogPrimitive.Title>
              <div className="inline-flex shrink-0 rounded-full bg-gray-100 p-0.5" role="tablist">
                {(["teacher", "student"] as const).map(v => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => { if (v !== view && mayLeave()) setView(v); }} data-testid={`pane-view-${v}`}
                    className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${view === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}>
                    {v === "teacher" ? "Teacher" : "Student"}
                  </button>
                ))}
              </div>
              <DialogPrimitive.Close className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-500 hover:bg-gray-100" aria-label="Close" title="Close (Esc)" data-testid="pane-close"><X className="h-5 w-5" /></DialogPrimitive.Close>
            </div>
            <div ref={setChips} className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="pane-questions">
              {p.checks.map(q => {
                const d = dot(q);
                const here = q.id === summary.id;
                return (
                  <button key={q.id} type="button" onClick={() => { if (!here && q.questionNumber) onGo(q.questionNumber); }} aria-current={here} title={`Question ${q.questionNumber}: ${d.label}`} data-testid={`pane-question-${q.questionNumber}`}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-medium ${here ? "border-violet-500 bg-violet-50 text-violet-800" : "border-black/[0.08] bg-white text-gray-700 hover:border-violet-300"}`}>
                    <span className={`h-2 w-2 rounded-full ${d.color}`} aria-hidden />Q{q.questionNumber}
                  </button>
                );
              })}
            </div>
          </div>
          <div key={summary.id} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5" data-testid="pane-body">
            {c && (view === "student"
              ? <StudentView c={c} />
              : <TeacherView c={c} pane onDeleted={onClose} onDirty={onDirty} onSaveNext={index < p.checks.length - 1 ? () => { onDirty(false); step(1); } : undefined} />)}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
