/**
 * Live AI avatar call — pure state machine (no DOM, unit-tested).
 *
 *   idle ──tap──▶ requesting ──session_created──▶ connecting ──connected──▶ live
 *     ▲               │ refused                       │ timeout / error          │ provider drop / server end
 *     │               ▼                               ▼                          ▼
 *     └──closed── fallback ◀──────────────────────────┴──────────────────────────┘
 *                    (voice keeps going with local playback, visitor is told briefly)
 *   live ──end──▶ ending ──closed──▶ ended
 *
 * The voice conversation is never interrupted by any of this: the avatar is
 * only a renderer on top of it.
 */
export type AvatarPhase = "idle" | "requesting" | "connecting" | "live" | "ending" | "ended" | "fallback";

export interface AvatarMachineState {
  phase: AvatarPhase;
  sessionId: string | null;
  tappedAt: number | null;
  connectedAt: number | null;
  speaking: boolean;
  muted: boolean;
  /** Why we fell back / ended (for the visitor message and the end call). */
  reason: string | null;
  /** Short visitor-facing message (fallback / ended), or null. */
  notice: string | null;
}

export type AvatarMachineEvent =
  | { type: "tap"; at: number }
  | { type: "session_created"; sessionId: string }
  | { type: "session_refused"; code: string; message?: string }
  | { type: "connected"; at: number }
  | { type: "connect_timeout" }
  | { type: "provider_error"; message?: string }
  | { type: "provider_disconnected" }
  | { type: "server_ended"; reason: string }
  | { type: "speaking"; speaking: boolean }
  | { type: "mute"; muted: boolean }
  | { type: "end"; reason: "visitor_closed" | "switched_to_text" }
  | { type: "closed" }
  | { type: "reset" };

export const initialAvatarState: AvatarMachineState = {
  phase: "idle",
  sessionId: null,
  tappedAt: null,
  connectedAt: null,
  speaking: false,
  muted: false,
  reason: null,
  notice: null,
};

const NOTICES: Record<string, string> = {
  monthly_cap_reached: "The video assistant isn't available right now — continuing with voice.",
  concurrency_limit: "The video assistant is busy right now — continuing with voice.",
  rate_limited: "Please wait a moment before starting the video assistant again.",
  connect_timeout: "The video took too long to connect — continuing with voice.",
  connect_failed: "The video couldn't connect — continuing with voice.",
  provider_error: "The video assistant couldn't start — continuing with voice.",
  provider_disconnected: "The video connection dropped — continuing with voice.",
  idle_timeout: "The video assistant ended after a quiet spell — you can keep talking or type.",
  max_duration: "The video call reached its time limit — continuing with voice.",
  cap_reached: "Video minutes are used up for now — continuing with voice.",
  voice_closed: "The video call ended.",
  heartbeat_timeout: "The video connection was lost — continuing with voice.",
  server_shutdown: "The video assistant restarted — continuing with voice.",
  disabled: "The video assistant was switched off — continuing with voice.",
};

export function avatarNotice(reason: string | null | undefined): string {
  return (reason && NOTICES[reason]) || "The video assistant isn't available right now — continuing with voice.";
}

/** A call is "on" (panel visible, voice in avatar mode or about to be). */
export function isAvatarCallActive(phase: AvatarPhase): boolean {
  return phase === "requesting" || phase === "connecting" || phase === "live" || phase === "ending";
}

export function avatarReducer(state: AvatarMachineState, event: AvatarMachineEvent): AvatarMachineState {
  switch (event.type) {
    case "reset":
      return { ...initialAvatarState, muted: state.muted };
    case "tap":
      if (isAvatarCallActive(state.phase)) return state;
      return { ...initialAvatarState, muted: state.muted, phase: "requesting", tappedAt: event.at };
    case "session_created":
      if (state.phase !== "requesting") return state;
      return { ...state, phase: "connecting", sessionId: event.sessionId };
    case "session_refused":
      if (state.phase !== "requesting") return state;
      return { ...state, phase: "fallback", reason: event.code, notice: event.message || avatarNotice(event.code) };
    case "connected":
      if (state.phase !== "connecting") return state;
      return { ...state, phase: "live", connectedAt: event.at };
    case "connect_timeout":
      if (state.phase !== "connecting" && state.phase !== "requesting") return state;
      return { ...state, phase: "fallback", speaking: false, reason: "connect_timeout", notice: avatarNotice("connect_timeout") };
    case "provider_error": {
      if (!isAvatarCallActive(state.phase) || state.phase === "ending") return state;
      const reason = state.phase === "live" ? "provider_disconnected" : "connect_failed";
      return { ...state, phase: "fallback", speaking: false, reason, notice: avatarNotice(reason) };
    }
    case "provider_disconnected":
      if (state.phase !== "live" && state.phase !== "connecting") return state;
      return { ...state, phase: "fallback", speaking: false, reason: "provider_disconnected", notice: avatarNotice("provider_disconnected") };
    case "server_ended":
      if (!isAvatarCallActive(state.phase) || state.phase === "ending") return state;
      return { ...state, phase: "fallback", speaking: false, reason: event.reason, notice: avatarNotice(event.reason) };
    case "speaking":
      if (state.phase !== "live") return state.speaking ? { ...state, speaking: false } : state;
      return state.speaking === event.speaking ? state : { ...state, speaking: event.speaking };
    case "mute":
      return state.muted === event.muted ? state : { ...state, muted: event.muted };
    case "end":
      if (!isAvatarCallActive(state.phase) || state.phase === "ending") return state;
      return { ...state, phase: "ending", speaking: false, reason: event.reason, notice: null };
    case "closed":
      if (state.phase === "ending") return { ...state, phase: "ended" };
      return state;
    default:
      return state;
  }
}

/** Time left before a connecting avatar should be abandoned (ms, ≥ 0). */
export function connectTimeRemaining(state: AvatarMachineState, timeoutMs: number, now: number): number {
  if (!state.tappedAt || (state.phase !== "requesting" && state.phase !== "connecting")) return timeoutMs;
  return Math.max(0, state.tappedAt + timeoutMs - now);
}
