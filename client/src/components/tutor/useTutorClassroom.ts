import { useCallback, useState } from "react";
import { applyOps, emptyBoard, type BoardOp, type BoardState } from "@shared/tutorBoard";

export type ClassroomStatus = "off" | "starting" | "planning" | "preparing" | "teaching" | "paused" | "ended";

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
}

export const initialClassroom = (): ClassroomState => ({
  status: "off", board: emptyBoard(), caption: "", title: "", sections: [], part: -1, canResume: false, endReason: null, message: null,
});

/** The classroom after one message from the voice socket (InlineVoiceMode onTutorMessage). */
export function reduceClassroom(state: ClassroomState, m: any): ClassroomState {
  if (!m || typeof m.type !== "string") return state;
  if (state.status === "off") return state;
  switch (m.type) {
    case "tutor_state": {
      const status: ClassroomStatus = m.state === "preparing" ? "preparing" : ["planning", "teaching", "paused", "ended"].includes(m.state) ? m.state : state.status;
      if (state.status === "ended") return state;
      return { ...state, status, part: typeof m.part === "number" ? m.part : state.part, canResume: !!m.canResume };
    }
    case "tutor_outline":
      return { ...state, title: String(m.title || ""), sections: Array.isArray(m.sections) ? m.sections : [] };
    case "board_snapshot":
      return m.board && Array.isArray(m.board.elements) ? { ...state, board: m.board } : state;
    case "sentence_play": {
      const ops: BoardOp[] = Array.isArray(m.ops) ? m.ops : [];
      return { ...state, board: ops.length ? applyOps(state.board, ops) : state.board, caption: String(m.say || "") };
    }
    case "tutor_ended":
      return { ...state, status: "ended", canResume: false, endReason: String(m.reason || "stopped"), message: typeof m.message === "string" ? m.message : null };
    case "tutor_error":
      return { ...state, message: String(m.message || "") };
    default:
      return state;
  }
}

/**
 * The AI tutor classroom in the widget: its state (fed by the voice socket's tutor messages)
 * and the commands it sends back (passed to InlineVoiceMode as `tutorCommand`).
 */
export function useTutorClassroom() {
  const [state, setState] = useState<ClassroomState>(initialClassroom);
  const [command, setCommand] = useState<{ seq: number; message: Record<string, unknown> } | null>(null);
  const send = useCallback((message: Record<string, unknown>) => setCommand((c) => ({ seq: (c?.seq ?? 0) + 1, message })), []);
  const handleMessage = useCallback((m: any) => setState((s) => reduceClassroom(s, m)), []);
  const start = useCallback((language?: string) => {
    setState({ ...initialClassroom(), status: "starting" });
    send({ type: "tutor_start", ...(language ? { language } : {}) });
  }, [send]);
  return {
    state,
    command,
    handleMessage,
    start,
    resume: useCallback(() => send({ type: "tutor_resume" }), [send]),
    skip: useCallback(() => send({ type: "tutor_skip" }), [send]),
    stop: useCallback(() => send({ type: "tutor_stop" }), [send]),
    /** Hide the classroom (after the lesson ended, or the voice session closed). */
    close: useCallback(() => setState(initialClassroom()), []),
    active: state.status !== "off" && state.status !== "ended",
  };
}
