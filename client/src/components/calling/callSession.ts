/**
 * The one test-mode call the portal can have open at a time, shared by the global
 * incoming-call popup and the "Try a call" page (so moving between pages never drops the call).
 */
import { useSyncExternalStore } from "react";
import { CallSimulator, type SimPhase } from "@/lib/callSimulator";
import { simulatorPaths } from "@/lib/aiCallingApi";

export interface CallSessionState {
  phase: "idle" | SimPhase;
  kind: "outbound" | "inbound" | null;
  /** Call id when known (outbound test calls). */
  callId: string | null;
  title: string;
  subtitle: string;
  startedAt: number | null;
  liveAt: number | null;
  aiSpeaking: boolean;
  userSpeaking: boolean;
  muted: boolean;
  error: string | null;
}

const IDLE: CallSessionState = {
  phase: "idle",
  kind: null,
  callId: null,
  title: "",
  subtitle: "",
  startedAt: null,
  liveAt: null,
  aiSpeaking: false,
  userSpeaking: false,
  muted: false,
  error: null,
};

let state: CallSessionState = IDLE;
let sim: CallSimulator | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<CallSessionState>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}

function begin(opts: { kind: "outbound" | "inbound"; path: string; callId: string | null; title: string; subtitle: string; from: string; to: string }) {
  if (sim) sim.hangUp();
  state = { ...IDLE, phase: "connecting", kind: opts.kind, callId: opts.callId, title: opts.title, subtitle: opts.subtitle, startedAt: Date.now() };
  listeners.forEach(l => l());
  const s = new CallSimulator({
    path: opts.path,
    from: opts.from,
    to: opts.to,
    onPhase: (phase, detail) => {
      if (sim !== s) return;
      if (phase === "live") set({ phase, liveAt: Date.now() });
      else if (phase === "error") set({ phase, error: detail || "The test call couldn't connect.", aiSpeaking: false, userSpeaking: false });
      else set({ phase, aiSpeaking: false, userSpeaking: false });
      if (phase === "ended" || phase === "error") sim = null;
    },
    onActivity: a => {
      if (sim !== s) return;
      set({ aiSpeaking: a.aiSpeaking, userSpeaking: a.userSpeaking, muted: a.muted });
    },
  });
  sim = s;
  void s.start();
}

export const callSession = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Answer a ringing test call placed by the AI (outbound). Must run inside a click. */
  answerOutbound(call: { id: string; phone: string; leadName: string | null }) {
    begin({
      kind: "outbound",
      path: simulatorPaths.outbound(call.id),
      callId: call.id,
      title: call.leadName ? `AI calling ${call.leadName}` : "AI test call",
      subtitle: call.phone,
      from: call.phone,
      to: "TEST",
    });
  },
  /** Call the business as a customer would (inbound). Must run inside a click. */
  startInbound() {
    begin({
      kind: "inbound",
      path: simulatorPaths.inbound(),
      callId: null,
      title: "Calling your business",
      subtitle: "You're the customer — the AI answers",
      from: "+910000000000",
      to: "TEST",
    });
  },
  hangUp() {
    sim?.hangUp();
  },
  toggleMute() {
    if (!sim) return;
    sim.setMuted(!sim.isMuted());
  },
  /** Close the ended / failed call card. */
  dismiss() {
    if (state.phase === "ended" || state.phase === "error" || state.phase === "idle") {
      state = IDLE;
      listeners.forEach(l => l());
    }
  },
  isActive: () => state.phase === "connecting" || state.phase === "live",
};

export function useCallSession(): CallSessionState {
  return useSyncExternalStore(callSession.subscribe, callSession.get, callSession.get);
}
