import { useEffect, useRef, useState } from "react";
import { Check, GraduationCap, HelpCircle, Loader2, Maximize2, MessageCircleQuestion, Mic, Minimize2, Play, RotateCcw, Send, SkipForward, Snail, Square, Volume2, X } from "lucide-react";
import { TutorBoard } from "./TutorBoard";
import type { ClassroomState } from "./useTutorClassroom";

interface Props {
  state: ClassroomState;
  chapter?: string;
  /** Live voice status (listening / speaking), from InlineVoiceMode. */
  voiceState?: "idle" | "listening" | "thinking" | "speaking" | null;
  chatColor?: string;
  onResume: () => void;
  onSkip: () => void;
  onSimpler: () => void;
  onAnswer: (checkId: string, index: number) => void;
  onDontKnow: (checkId: string) => void;
  onAsk: (text: string) => void;
  /** "Slower" speech (from the tutor's next line). */
  slow: boolean;
  onSlowChange: (slow: boolean) => void;
  /** Start the chapter from the beginning (offered when the lesson carried on from last time). */
  onStartOver: () => void;
  /** Told when Expand changes (a video tutor tile follows it). */
  onExpandedChange?: (expanded: boolean) => void;
  onStop: () => void;
  onRestart: () => void;
  onClose: () => void;
}

const END_TEXT: Record<string, string> = {
  completed: "That's the whole chapter — well done! Ask me anything you'd like to go over again.",
  stopped: "Lesson stopped. You can start it again any time.",
  daily_limit: "That's all the tutor time for today. Come back tomorrow to carry on!",
  disconnected: "The connection dropped, so the lesson stopped.",
  error: "Something went wrong with the lesson. Please try again.",
};

/**
 * The AI tutor's classroom inside the chat widget: the board (drawn as each line is said), the
 * line being said, and the lesson controls. Expand fills the screen (Fullscreen API; where a host
 * page or iOS does not allow it, the classroom fills the widget instead). Esc leaves it.
 */
const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function TutorClassroom({ state, chapter, voiceState, chatColor = "#0f766e", onResume, onSkip, onSimpler, onAnswer, onDontKnow, onAsk, slow, onSlowChange, onStartOver, onExpandedChange, onStop, onRestart, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { onExpandedChange?.(expanded); }, [expanded, onExpandedChange]);
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const submitQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    onAsk(q);
    setQuestion("");
    if (!expanded) setAskOpen(false);
  };
  const [nativeFull, setNativeFull] = useState(false);

  const nativeFullRef = useRef(false);
  useEffect(() => {
    // Leaving native full screen (Esc, the browser's own control) collapses the classroom.
    const sync = () => {
      const on = !!document.fullscreenElement;
      if (nativeFullRef.current && !on) setExpanded(false);
      nativeFullRef.current = on;
      setNativeFull(on);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!expanded || nativeFull) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, nativeFull]);

  const toggleExpand = async () => {
    if (expanded) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setExpanded(false);
      return;
    }
    setExpanded(true);
    // The whole widget page goes full screen and the classroom fills it, so anything layered over
    // the classroom (the video tutor tile) stays visible.
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    try {
      if (el?.requestFullscreen) await el.requestFullscreen();
      else if (el?.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch {
      // Not allowed here (host iframe without allow="fullscreen", iOS): fill the widget instead.
    }
  };
  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setExpanded(false);
    onClose();
  };

  const { status } = state;
  const busy = status === "starting" || status === "planning" || status === "preparing";
  const total = state.sections.length;
  const partLabel = state.part < 0 ? "Plan" : total && state.part >= total ? "Recap" : total ? `Part ${state.part + 1} of ${total}` : "";
  const sectionTitle = state.part >= 0 && state.part < total ? state.sections[state.part]?.title : "";
  const emptyText = status === "ended" ? "" : busy ? "Getting the board ready…" : "Listen — the board fills in as I explain.";
  const check = state.check?.shown || state.check?.result ? state.check : null;
  const checkOpen = !!check && (check.result === null || check.result === "retry");
  const inPart = state.part >= 0 && state.part < total;
  const yourTurn = status === "paused" && state.awaitingReply;
  const showAsk = status !== "ended" && (expanded || askOpen || yourTurn);

  return (
    <div
      ref={root}
      data-testid="tutor-classroom"
      className={`${expanded ? "fixed inset-0 z-[100001]" : "border-b border-gray-200"} flex flex-col bg-[#f6f4ee] text-gray-900 flex-shrink-0`}
      data-native-fullscreen={nativeFull ? "true" : undefined}
      style={expanded ? { paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" } : undefined}
    >
      <div className="flex items-center gap-2 px-3 py-2 min-w-0">
        <span className="h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 text-white" style={{ background: chatColor }}>
          <GraduationCap className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight truncate" data-testid="text-tutor-title">{state.title || chapter || "AI tutor"}</p>
          <p className="text-[11px] text-gray-500 leading-tight truncate">
            {partLabel}{sectionTitle ? ` · ${sectionTitle}` : ""}
            {!partLabel && busy ? "Preparing the lesson…" : ""}
          </p>
        </div>
        {voiceState === "listening" && status !== "ended" && (
          <span className="hidden sm:flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5" title="Speak any time to ask a question"><Mic className="w-3 h-3" /> Listening</span>
        )}
        {voiceState === "speaking" && status === "teaching" && (
          <span className="hidden sm:flex items-center gap-1 text-[11px] text-gray-600 bg-white rounded-full px-2 py-0.5"><Volume2 className="w-3 h-3" /> Teaching</span>
        )}
        <button type="button" onClick={toggleExpand} className="h-8 w-8 rounded-full hover:bg-black/5 flex items-center justify-center" aria-label={expanded ? "Exit full screen" : "Expand the classroom"} title={expanded ? "Exit full screen (Esc)" : "Expand"} data-testid="button-tutor-expand">
          {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button type="button" onClick={close} className="h-8 w-8 rounded-full hover:bg-black/5 flex items-center justify-center" aria-label="Close the classroom" data-testid="button-tutor-close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className={`px-3 ${expanded ? "flex-1 min-h-0 flex" : ""}`}>
        <div className={`relative ${expanded ? "flex-1 min-h-0 flex" : ""}`}>
          <TutorBoard board={state.board} className={expanded ? "flex-1 min-h-0 text-[17px] sm:text-[20px]" : "tb-compact h-[230px] text-[13px]"} emptyText={emptyText} />
          {busy && (
            <div className="absolute top-3 right-4 flex items-center gap-1.5 text-[11px] text-[#f3f1e9]/80"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {status === "preparing" ? "Preparing the next part…" : "Preparing…"}</div>
          )}
        </div>
      </div>

      <div className="px-3 pt-2 pb-2.5 space-y-2">
        {check && status !== "ended" && (
          <div className="space-y-1.5" data-testid="tutor-check">
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(check.options.length, expanded ? 4 : 2)}, minmax(0, 1fr))` }}>
              {check.options.map((o, i) => {
                const right = check.correctIndex === i;
                const wrongPick = check.chosen === i && !right && check.result !== null;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!checkOpen}
                    onClick={() => onAnswer(check.id, i)}
                    className={`min-h-9 px-2.5 py-1.5 rounded-lg border text-left text-[13px] leading-snug flex items-center gap-2 transition-colors ${right ? "border-emerald-500 bg-emerald-50 text-emerald-900" : wrongPick ? "border-rose-300 bg-rose-50 text-rose-900" : "border-gray-200 bg-white hover:border-gray-400"} disabled:cursor-default`}
                    data-testid={`button-tutor-option-${i}`}
                  >
                    <span className="font-semibold">{LETTERS[i]}</span>
                    <span className="min-w-0 break-words">{o}</span>
                    {right && <Check className="w-3.5 h-3.5 ml-auto flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
            {checkOpen && (
              <div className="flex items-center gap-2 text-[12px] text-gray-500">
                <span>{check.result === "retry" ? "Not quite — try again." : "Tap an answer, or say it."}</span>
                <button type="button" onClick={() => onDontKnow(check.id)} className="ml-auto underline underline-offset-2 hover:text-gray-800" data-testid="button-tutor-dontknow">I don't know</button>
              </div>
            )}
          </div>
        )}
        {status === "ended" ? (
          <p className="text-[13px] text-gray-700" data-testid="text-tutor-ended">
            {state.message || END_TEXT[state.endReason || "stopped"] || END_TEXT.stopped}
            {state.checksTotal > 0 && <span className="block text-gray-500 mt-0.5">Quick checks: {state.checksCorrect} of {state.checksTotal} right.</span>}
          </p>
        ) : status === "answering" && !state.caption ? (
          <p className="text-[13px] text-gray-600 flex items-center gap-1.5 min-h-[2.4em]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking about your question…</p>
        ) : (
          <p className={`text-[13px] leading-snug min-h-[2.4em] ${expanded ? "sm:text-base" : ""}`} aria-live="polite" data-testid="text-tutor-caption">
            {yourTurn ? <span className="font-medium" style={{ color: chatColor }} data-testid="text-tutor-your-turn">Your turn — say your answer, or type it below.</span>
              : status === "paused" ? <span className="text-gray-600">Paused — ask your question, or continue the lesson.</span> : state.caption}
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {status === "paused" && state.canResume && (
            <button type="button" onClick={onResume} className="h-8 px-3 rounded-full text-white text-[13px] font-medium flex items-center gap-1.5" style={{ background: chatColor }} data-testid="button-tutor-resume">
              <Play className="w-3.5 h-3.5" /> Continue lesson
            </button>
          )}
          {(status === "teaching" || status === "paused") && inPart && (
            <button type="button" onClick={onSimpler} className="h-8 px-3 rounded-full bg-white border border-gray-200 text-[13px] flex items-center gap-1.5" data-testid="button-tutor-simpler">
              <HelpCircle className="w-3.5 h-3.5" /> I didn't get it
            </button>
          )}
          {(status === "teaching" || status === "paused") && state.part < total && (
            <button type="button" onClick={onSkip} className="h-8 px-3 rounded-full bg-white border border-gray-200 text-[13px] flex items-center gap-1.5" data-testid="button-tutor-skip">
              <SkipForward className="w-3.5 h-3.5" /> Next part
            </button>
          )}
          {status !== "ended" && (
            <button type="button" onClick={onStop} className="h-8 px-3 rounded-full bg-white border border-gray-200 text-[13px] flex items-center gap-1.5" data-testid="button-tutor-stop">
              <Square className="w-3 h-3" /> Stop
            </button>
          )}
          {status === "ended" && state.endReason !== "daily_limit" && state.endReason !== "unavailable" && (
            <button type="button" onClick={onRestart} className="h-8 px-3 rounded-full text-white text-[13px] font-medium flex items-center gap-1.5" style={{ background: chatColor }} data-testid="button-tutor-restart">
              <Play className="w-3.5 h-3.5" /> {state.endReason === "completed" ? "Teach it again" : "Start the lesson"}
            </button>
          )}
          {status !== "ended" && (
            <button type="button" onClick={() => onSlowChange(!slow)} aria-pressed={slow} className={`h-8 px-3 rounded-full border text-[13px] flex items-center gap-1.5 ${slow ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200"}`} title="Speak more slowly" data-testid="button-tutor-slower">
              <Snail className="w-3.5 h-3.5" /> Slower
            </button>
          )}
          {state.continuedFrom && status !== "ended" && (
            <button type="button" onClick={onStartOver} className="h-8 px-3 rounded-full bg-white border border-gray-200 text-[13px] flex items-center gap-1.5" data-testid="button-tutor-startover">
              <RotateCcw className="w-3.5 h-3.5" /> Start over
            </button>
          )}
          {status !== "ended" && !expanded && (
            <button type="button" onClick={() => setAskOpen((v) => !v)} className={`h-8 px-3 rounded-full border text-[13px] flex items-center gap-1.5 ${askOpen ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200"}`} data-testid="button-tutor-ask">
              <MessageCircleQuestion className="w-3.5 h-3.5" /> Ask
            </button>
          )}
          {status !== "ended" && status !== "paused" && expanded && (
            <span className="text-[11px] text-gray-500 ml-auto">Speak any time to ask a question.</span>
          )}
        </div>
        {showAsk && (
          <form onSubmit={submitQuestion} className="flex items-center gap-2" data-testid="form-tutor-ask">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={500}
              placeholder={yourTurn ? "Type your answer…" : "Type a question about this chapter…"}
              className="flex-1 min-w-0 h-9 px-3 rounded-full border border-gray-200 bg-white text-[14px] focus:outline-none focus:border-gray-400"
              autoFocus={!expanded}
              data-testid="input-tutor-question"
            />
            <button type="submit" disabled={!question.trim()} className="h-9 w-9 rounded-full text-white flex items-center justify-center disabled:opacity-40" style={{ background: chatColor }} aria-label="Ask the tutor" data-testid="button-tutor-send">
              <Send className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
