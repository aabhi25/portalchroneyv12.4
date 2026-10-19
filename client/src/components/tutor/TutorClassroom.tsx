import { useEffect, useRef, useState } from "react";
import { GraduationCap, Loader2, Maximize2, Mic, Minimize2, Play, SkipForward, Square, Volume2, X } from "lucide-react";
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
export function TutorClassroom({ state, chapter, voiceState, chatColor = "#0f766e", onResume, onSkip, onStop, onRestart, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [nativeFull, setNativeFull] = useState(false);

  const nativeFullRef = useRef(false);
  useEffect(() => {
    // Leaving native full screen (Esc, the browser's own control) collapses the classroom.
    const sync = () => {
      const on = !!root.current && document.fullscreenElement === root.current;
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
    const el = root.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }) | null;
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

  return (
    <div
      ref={root}
      data-testid="tutor-classroom"
      className={`${expanded ? (nativeFull ? "w-full h-full" : "fixed inset-0 z-[100001]") : "border-b border-gray-200"} flex flex-col bg-[#f6f4ee] text-gray-900 flex-shrink-0`}
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
        {status === "ended" ? (
          <p className="text-[13px] text-gray-700" data-testid="text-tutor-ended">{state.message || END_TEXT[state.endReason || "stopped"] || END_TEXT.stopped}</p>
        ) : (
          <p className={`text-[13px] leading-snug min-h-[2.4em] ${expanded ? "sm:text-base" : ""}`} aria-live="polite" data-testid="text-tutor-caption">
            {status === "paused" ? <span className="text-gray-600">Paused — ask your question, or continue the lesson.</span> : state.caption}
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {status === "paused" && state.canResume && (
            <button type="button" onClick={onResume} className="h-8 px-3 rounded-full text-white text-[13px] font-medium flex items-center gap-1.5" style={{ background: chatColor }} data-testid="button-tutor-resume">
              <Play className="w-3.5 h-3.5" /> Continue lesson
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
          {status !== "ended" && status !== "paused" && (
            <span className="text-[11px] text-gray-500 ml-auto">Speak any time to ask a question.</span>
          )}
        </div>
      </div>
    </div>
  );
}
