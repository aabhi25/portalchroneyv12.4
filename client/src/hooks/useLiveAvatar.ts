/**
 * Live AI avatar call controller for the chat widget.
 *
 * The avatar starts ONLY from the visitor's tap. On tap we (1) unlock media
 * playback inside the gesture (iOS Safari), (2) ask our server for a session
 * (it enforces limits and mints the provider token), (3) connect the provider's
 * video. Voice starts in parallel and keeps working throughout; once the video
 * shows its first frame the voice socket is switched to avatar mode. Any
 * failure — refused, slow, dropped — falls back to plain voice with a short
 * notice, without losing the conversation.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { avatarDebug, startAvatarDebug, stopAvatarDebug } from "@/lib/liveAvatar/debug";
import {
  avatarHeartbeat,
  endAvatarSession,
  loadAvatarAdapter,
  reportAvatarConnected,
  startAvatarSession,
} from "@/lib/liveAvatar";
import { avatarReducer, initialAvatarState, isAvatarCallActive } from "@/lib/liveAvatar/stateMachine";
import type { AvatarClientAdapter, AvatarSessionInfo } from "@/lib/liveAvatar/types";
import { AvatarAmbience } from "@/lib/liveAvatar/ambience";

/** Video call settings the widget applies itself (from the widget's avatar config). */
export interface LiveAvatarVideoOptions {
  background?: { sound: "office" | "call_centre"; gain: number } | null;
  /** Switch to voice only when the video freezes. */
  autoVoiceOnly?: boolean;
}

/** The video counts as frozen after this long without a new frame (weak connection). */
const FROZEN_VIDEO_MS = 8000;

export interface LiveAvatarHandle {
  sessionId: string;
  audioRoute: "server" | "client";
  adapter: AvatarClientAdapter;
  speakIntro: boolean;
}

function errorText(error: unknown): string {
  const e = error as { name?: string; message?: string } | null;
  return [e?.name && e.name !== "Error" ? e.name : "", e?.message || String(error)].filter(Boolean).join(": ").slice(0, 200);
}

export function useLiveAvatar(opts: { businessAccountId: string; userId: string; getConversationId: () => string | null | undefined; video?: LiveAvatarVideoOptions | null }) {
  const [state, dispatch] = useReducer(avatarReducer, initialAvatarState);
  const [session, setSession] = useState<AvatarSessionInfo | null>(null);
  const [handle, setHandle] = useState<LiveAvatarHandle | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const adapterRef = useRef<AvatarClientAdapter | null>(null);
  const sessionRef = useRef<AvatarSessionInfo | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const attemptRef = useRef(0);
  const ambienceRef = useRef<AvatarAmbience | null>(null);
  const videoOptsRef = useRef(opts.video);
  videoOptsRef.current = opts.video;
  const auth = useCallback(() => ({ businessAccountId: opts.businessAccountId, userId: opts.userId }), [opts.businessAccountId, opts.userId]);

  const teardown = useCallback(async (reason: string | null, detail?: string) => {
    const adapter = adapterRef.current;
    const current = sessionRef.current;
    adapterRef.current = null;
    sessionRef.current = null;
    ambienceRef.current?.stop();
    ambienceRef.current = null;
    setHandle(null);
    setRemainingSeconds(null);
    // Tell the server first (with the real reason) — closing the voice socket
    // right after would otherwise end the session as "voice_closed".
    if (current && reason) endAvatarSession(current.sessionId, { ...auth(), reason, ...(detail ? { detail: detail.slice(0, 200) } : {}) });
    if (current) { avatarDebug("ended", { reason, detail }); stopAvatarDebug(); }
    if (adapter) { try { await adapter.close(); } catch { /* ignore */ } }
  }, [auth]);

  /** Must be called directly from the visitor's tap/click handler. */
  const start = useCallback(async (startOpts: { purpose?: "tutor" } = {}) => {
    if (isAvatarCallActive(stateRef.current.phase)) return;
    const attempt = ++attemptRef.current;
    const tappedAt = Date.now();
    dispatch({ type: "tap", at: tappedAt });
    // Unlock playback inside the user gesture (iOS Safari / autoplay policy).
    const video = videoRef.current;
    if (video) {
      video.playsInline = true;
      video.muted = false;
      void video.play().catch(() => undefined);
    }
    // Background sound: its audio is unlocked here, inside the tap; it starts with the video.
    if (videoOptsRef.current?.background) {
      ambienceRef.current?.stop();
      ambienceRef.current = new AvatarAmbience();
      ambienceRef.current.prepare();
    }
    const result = await startAvatarSession({ ...auth(), conversationId: opts.getConversationId() || null, purpose: startOpts.purpose });
    if (attempt !== attemptRef.current) return;
    if (!result.ok) {
      dispatch({ type: "session_refused", code: result.error.code, message: result.error.message });
      return;
    }
    const info = result.session;
    if (info.debug) startAvatarDebug(info.sessionId, auth());
    avatarDebug("session", { provider: info.provider, route: info.audioRoute, tapToSessionMs: Date.now() - tappedAt });
    sessionRef.current = info;
    setSession(info);
    setRemainingSeconds(info.limits.maxSessionSeconds);
    dispatch({ type: "session_created", sessionId: info.sessionId });
    let adapter: AvatarClientAdapter;
    try {
      adapter = await loadAvatarAdapter(info.provider);
    } catch (error) {
      console.warn("[LiveAvatar] adapter failed to load", error);
      dispatch({ type: "provider_error" });
      void teardown("connect_failed", `video library failed to load: ${errorText(error)}`);
      return;
    }
    if (attempt !== attemptRef.current) { void adapter.close(); return; }
    adapterRef.current = adapter;
    adapter.on("disconnected", () => {
      if (adapterRef.current !== adapter) return;
      dispatch({ type: "provider_disconnected" });
      void teardown("provider_disconnected");
    });
    adapter.on("speaking", () => dispatch({ type: "speaking", speaking: true }));
    adapter.on("idle", () => dispatch({ type: "speaking", speaking: false }));
    const el = videoRef.current;
    if (!el) {
      dispatch({ type: "provider_error" });
      void teardown("connect_failed");
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; }, info.connectTimeoutMs);
    try {
      await Promise.race([
        adapter.connect(el, info.connection),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("connect timeout")), info.connectTimeoutMs)),
      ]);
    } catch (error) {
      clearTimeout(timer);
      if (attempt !== attemptRef.current || adapterRef.current !== adapter) return;
      console.warn("[LiveAvatar] connect failed", error);
      dispatch(timedOut ? { type: "connect_timeout" } : { type: "provider_error" });
      void teardown(timedOut ? "connect_timeout" : "connect_failed", errorText(error));
      return;
    }
    clearTimeout(timer);
    if (attempt !== attemptRef.current || adapterRef.current !== adapter) return;
    const firstFrameMs = Date.now() - tappedAt;
    avatarDebug("first frame", { msAfterTap: firstFrameMs });
    console.log(`[AvatarTiming] ${info.provider} first frame ${firstFrameMs}ms after tap`);
    adapter.setMuted(stateRef.current.muted);
    dispatch({ type: "connected", at: Date.now() });
    const bg = videoOptsRef.current?.background;
    if (bg && ambienceRef.current) {
      ambienceRef.current.setMuted(stateRef.current.muted);
      void ambienceRef.current.start(`/api/chat/widget/avatar/ambience/${bg.sound}`, bg.gain);
    }
    void reportAvatarConnected(info.sessionId, { ...auth(), providerSessionId: adapter.providerSessionId(), firstFrameMs });
    setHandle({ sessionId: info.sessionId, audioRoute: info.audioRoute, adapter, speakIntro: !!info.disclosure });
  }, [auth, opts, teardown]);

  const end = useCallback((reason: "visitor_closed" | "switched_to_text" = "visitor_closed") => {
    if (!isAvatarCallActive(stateRef.current.phase)) return;
    attemptRef.current++;
    dispatch({ type: "end", reason });
    void teardown(reason).finally(() => dispatch({ type: "closed" }));
  }, [teardown]);

  /** Fall back to plain voice (the voice session continues). */
  const fallback = useCallback((reason: string, endServerSession = false) => {
    attemptRef.current++;
    dispatch({ type: "server_ended", reason });
    void teardown(endServerSession ? reason : null);
  }, [teardown]);

  const setMuted = useCallback((muted: boolean) => {
    dispatch({ type: "mute", muted });
    adapterRef.current?.setMuted(muted);
    ambienceRef.current?.setMuted(muted);
  }, []);

  /** avatar_* messages relayed from the voice socket. */
  const onServerMessage = useCallback((msg: any) => {
    switch (msg?.type) {
      case "avatar_ended":
        if (sessionRef.current && (!msg.avatarSessionId || msg.avatarSessionId === sessionRef.current.sessionId)) fallback(String(msg.reason || "provider_disconnected"));
        break;
      case "avatar_attach_failed":
        if (sessionRef.current) fallback("provider_error", true);
        break;
      case "avatar_event":
        adapterRef.current?.onServerEvent?.(String(msg.event || ""));
        if (msg.event === "speak_started") dispatch({ type: "speaking", speaking: true });
        if (msg.event === "speak_ended" || msg.event === "interrupted") dispatch({ type: "speaking", speaking: false });
        break;
      default:
        break;
    }
  }, [auth, fallback]);

  // Heartbeat while connecting / live; the server ends the call if it stops.
  useEffect(() => {
    if (!session || !(state.phase === "connecting" || state.phase === "live")) return;
    const everyMs = Math.max(5, session.limits.heartbeatIntervalSeconds) * 1000;
    const timer = setInterval(async () => {
      const current = sessionRef.current;
      if (!current) return;
      const res = await avatarHeartbeat(current.sessionId, auth());
      if (sessionRef.current !== current) return;
      if (!res.active) fallback(String(res.endReason || "provider_disconnected"));
      else if (typeof (res as any).remainingSeconds === "number") setRemainingSeconds((res as any).remainingSeconds);
    }, everyMs);
    return () => clearInterval(timer);
  }, [session, state.phase, auth, fallback]);

  // Weak connection: the video stopped moving for a while → carry on by voice only.
  useEffect(() => {
    if (state.phase !== "live" || videoOptsRef.current?.autoVoiceOnly === false) return;
    let lastTime = -1;
    let stuckSince = Date.now();
    const timer = setInterval(() => {
      const el = videoRef.current;
      // A hidden page or a paused video (autoplay blocked) is not a slow connection.
      if (!el || el.paused || document.visibilityState !== "visible") { stuckSince = Date.now(); return; }
      if (el.currentTime !== lastTime) { lastTime = el.currentTime; stuckSince = Date.now(); return; }
      if (Date.now() - stuckSince >= FROZEN_VIDEO_MS && sessionRef.current) {
        avatarDebug("video frozen", { ms: Date.now() - stuckSince });
        fallback("poor_connection", true);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [state.phase, fallback]);

  /** The hand-off button was tapped (counted in the video call report). */
  const recordHandoff = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    void fetch(`/api/chat/widget/avatar/session/${encodeURIComponent(current.sessionId)}/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(auth()),
      keepalive: true,
    }).catch(() => undefined);
  }, [auth]);

  // Local countdown between heartbeats.
  useEffect(() => {
    if (state.phase !== "live") return;
    const t = setInterval(() => setRemainingSeconds((s) => (s == null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [state.phase]);

  // Leaving the page ends the paid session (beacon survives the unload).
  useEffect(() => {
    const onHide = () => {
      const current = sessionRef.current;
      if (current) endAvatarSession(current.sessionId, { ...auth(), reason: "visitor_closed" }, { beacon: true });
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
    };
  }, [auth]);

  // Unmount: close everything.
  useEffect(() => () => { void teardown("visitor_closed"); }, [teardown]);

  return {
    state,
    session,
    handle: state.phase === "live" ? handle : null,
    remainingSeconds,
    videoRef,
    start,
    end,
    fallback,
    setMuted,
    recordHandoff,
    onServerMessage,
    reset: () => dispatch({ type: "reset" }),
  };
}
