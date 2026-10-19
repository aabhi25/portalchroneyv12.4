import { useCallback, useRef, useState } from "react";
import { applyOps, emptyBoard, type BoardOp, type BoardState } from "@shared/tutorBoard";

export type ClassroomStatus = "off" | "starting" | "planning" | "preparing" | "teaching" | "checking" | "answering" | "paused" | "ended";

export interface ClassroomCheck {
  id: string;
  prompt: string;
  options: string[];
  /** The student's latest pick, and what the tutor said about it. */
  chosen: number | null;
  result: "right" | "retry" | "wrong" | null;
  /** Known only once the check is answered (right, or revealed). */
  correctIndex: number | null;
  /** The options show once the question starts being read (its board page is drawn). */
  shown: boolean;
}

export interface ClassroomState {
  status: ClassroomStatus;
  board: BoardState;
  /** The line being said right now. */
  caption: string;
  title: string;
  sections: Array<{ id: string; title: string }>;
  /** -1 = the plan, 0… = sections, sections.length = recap. */
  part: number;
  canResume: boolean;
  endReason: string | null;
  message: string | null;
  check: ClassroomCheck | null;
  checksCorrect: number;
  checksTotal: number;
  /** Carrying on from where the student stopped last time (Start over is offered). */
  continuedFrom: { part: number; title: string } | null;
}

export const initialClassroom = (): ClassroomState => ({
  status: "off", board: emptyBoard(), caption: "", title: "", sections: [], part: -1, canResume: false, endReason: null, message: null,
  check: null, checksCorrect: 0, checksTotal: 0, continuedFrom: null,
});

/** The classroom after one message from the voice socket (InlineVoiceMode onTutorMessage). */
export function reduceClassroom(state: ClassroomState, m: any): ClassroomState {
  if (!m || typeof m.type !== "string") return state;
  if (state.status === "off") return state;
  switch (m.type) {
    case "tutor_state": {
      const status: ClassroomStatus = m.state === "preparing" ? "preparing" : ["planning", "teaching", "checking", "answering", "paused", "ended"].includes(m.state) ? m.state : state.status;
      if (state.status === "ended") return state;
      // An open check stays; an answered one stays until the next page (its feedback is being said).
      const answered = state.check?.result === "right" || state.check?.result === "wrong";
      const check = m.checkOpen || answered ? state.check : null;
      return { ...state, status, part: typeof m.part === "number" ? m.part : state.part, canResume: !!m.canResume, check };
    }
    case "tutor_check":
      return {
        ...state,
        check: { id: String(m.id), prompt: String(m.prompt || ""), options: Array.isArray(m.options) ? m.options.map(String) : [], chosen: null, result: null, correctIndex: null, shown: false },
      };
    case "tutor_check_result": {
      if (!state.check || state.check.id !== m.id) return state;
      // (An answer can only follow the question, so the options are on screen by now.)
      const result: ClassroomCheck["result"] = m.correct ? "right" : m.retry ? "retry" : "wrong";
      return {
        ...state,
        check: { ...state.check, chosen: typeof m.chosen === "number" ? m.chosen : null, result, correctIndex: typeof m.correctIndex === "number" ? m.correctIndex : null },
        checksCorrect: state.checksCorrect + (m.correct ? 1 : 0),
        checksTotal: state.checksTotal + (result === "retry" ? 0 : 1),
      };
    }
    case "tutor_continued":
      return { ...state, continuedFrom: { part: Number(m.part) || 0, title: String(m.title || "") } };
    case "tutor_outline":
      return { ...state, title: String(m.title || ""), sections: Array.isArray(m.sections) ? m.sections : [] };
    case "board_snapshot":
      return m.board && Array.isArray(m.board.elements) ? { ...state, board: m.board } : state;
    case "sentence_play": {
      const ops: BoardOp[] = Array.isArray(m.ops) ? m.ops : [];
      const answered = state.check?.result === "right" || state.check?.result === "wrong";
      const newPage = ops.some((o) => o.op === "clear");
      const asked = ops.some((o) => o.op === "write" && o.id === "chk_t");
      const check = answered && newPage ? null : state.check && asked && !state.check.shown ? { ...state.check, shown: true } : state.check;
      return { ...state, board: ops.length ? applyOps(state.board, ops) : state.board, caption: String(m.say || ""), check };
    }
    case "tutor_ended":
      return { ...state, status: "ended", canResume: false, check: null, endReason: String(m.reason || "stopped"), message: typeof m.message === "string" ? m.message : null };
    case "tutor_error":
      return { ...state, message: String(m.message || "") };
    default:
      return state;
  }
}

export interface TutorCommand { seq: number; message: Record<string, unknown> }

/**
 * The AI tutor classroom in the widget: its state (fed by the voice socket's tutor messages)
 * and the commands it sends back (passed to InlineVoiceMode as `tutorCommand`).
 */
export function useTutorClassroom() {
  const [state, setState] = useState<ClassroomState>(initialClassroom);
  // Commands for the voice socket, in order (InlineVoiceMode sends each once; kept short).
  // Seq only ever grows, so a voice bar that stays open never skips a new command; a lesson start
  // drops the older ones, so a voice bar opened afresh never replays a previous lesson's commands.
  const [commands, setCommands] = useState<TutorCommand[]>([]);
  const seq = useRef(0);
  const send = useCallback((message: Record<string, unknown>) => setCommands((list) => [...list.slice(-19), { seq: ++seq.current, message }]), []);
  const handleMessage = useCallback((m: any) => setState((s) => reduceClassroom(s, m)), []);
  const [slow, setSlowState] = useState(false);
  const start = useCallback((opts: { language?: string; fromStart?: boolean } = {}) => {
    setState({ ...initialClassroom(), status: "starting" });
    setCommands([{ seq: ++seq.current, message: { type: "tutor_start", slow, ...(opts.language ? { language: opts.language } : {}), ...(opts.fromStart ? { fromStart: true } : {}) } }]);
  }, [slow]);
  return {
    state,
    commands,
    handleMessage,
    start,
    resume: useCallback(() => send({ type: "tutor_resume" }), [send]),
    skip: useCallback(() => send({ type: "tutor_skip" }), [send]),
    simpler: useCallback(() => send({ type: "tutor_simpler" }), [send]),
    answer: useCallback((checkId: string, index: number) => send({ type: "tutor_answer", checkId, index }), [send]),
    dontKnow: useCallback((checkId: string) => send({ type: "tutor_dontknow", checkId }), [send]),
    ask: useCallback((text: string) => { const t = text.trim(); if (t) send({ type: "tutor_text", text: t }); }, [send]),
    stop: useCallback(() => send({ type: "tutor_stop" }), [send]),
    slow,
    setSlow: useCallback((v: boolean) => { setSlowState(v); send({ type: "tutor_speed", slow: v }); }, [send]),
    /** Hide the classroom (after the lesson ended, or the voice session closed). */
    close: useCallback(() => setState(initialClassroom()), []),
    active: state.status !== "off" && state.status !== "ended",
  };
}
