import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, MicOff, PhoneOff, X, AlertTriangle, CheckCircle2, Bot, User } from "lucide-react";
import { callSession, useCallSession } from "./callSession";
import { formatClock } from "@/lib/aiCallingApi";

/** Timer, live status, mute and hang up for the open test call. `compact` = floating card. */
export function ActiveCallPanel({ compact = false }: { compact?: boolean }) {
  const s = useCallSession();
  const [, setLocation] = useLocation();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (s.phase !== "live" && s.phase !== "connecting") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [s.phase]);

  if (s.phase === "idle") return null;

  const elapsed = s.liveAt ? (now - s.liveAt) / 1000 : 0;
  const status =
    s.phase === "connecting"
      ? "Connecting…"
      : s.phase === "live"
        ? s.aiSpeaking
          ? "AI is speaking"
          : s.muted
            ? "You're muted"
            : s.userSpeaking
              ? "Listening to you"
              : "Listening…"
        : s.phase === "ended"
          ? "Call ended"
          : "Couldn't connect";

  const live = s.phase === "live" || s.phase === "connecting";

  return (
    <div className={`rounded-2xl border bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-xl ${compact ? "p-4" : "p-6"}`} data-testid="active-call-panel">
      <div className="flex items-start gap-3">
        <div className={`relative flex shrink-0 items-center justify-center rounded-full bg-white/10 ${compact ? "h-11 w-11" : "h-16 w-16"}`}>
          {s.phase === "live" && s.aiSpeaking && <span className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping" />}
          {s.phase === "connecting" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : s.phase === "error" ? (
            <AlertTriangle className="h-5 w-5 text-amber-300" />
          ) : s.phase === "ended" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          ) : s.aiSpeaking ? (
            <Bot className="h-6 w-6 text-emerald-300" />
          ) : (
            <User className={`h-6 w-6 ${s.userSpeaking ? "text-sky-300" : "text-white/70"}`} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`truncate font-semibold ${compact ? "text-sm" : "text-lg"}`}>{s.title}</p>
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/70">Test</span>
          </div>
          <p className="truncate text-xs text-white/60">{s.subtitle}</p>
          <p className={`mt-1 ${compact ? "text-xs" : "text-sm"} ${s.phase === "error" ? "text-amber-200" : "text-white/80"}`} aria-live="polite">
            {status}
            {s.phase === "live" && <span className="ml-2 tabular-nums text-white/60">{formatClock(elapsed)}</span>}
          </p>
        </div>
        {!live && (
          <button className="text-white/60 hover:text-white" onClick={() => callSession.dismiss()} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {s.phase === "error" && s.error && <p className="mt-3 text-xs text-amber-100/90">{s.error}</p>}

      {live ? (
        <div className={`mt-4 flex items-center ${compact ? "justify-end gap-2" : "justify-center gap-6"}`}>
          <Button
            type="button"
            variant="secondary"
            size={compact ? "sm" : "lg"}
            className={`rounded-full ${s.muted ? "bg-amber-400 text-slate-900 hover:bg-amber-300" : "bg-white/15 text-white hover:bg-white/25"}`}
            onClick={() => callSession.toggleMute()}
            disabled={s.phase !== "live"}
            data-testid="button-call-mute"
            aria-pressed={s.muted}
          >
            {s.muted ? <MicOff className="h-4 w-4 mr-1" /> : <Mic className="h-4 w-4 mr-1" />}
            {s.muted ? "Unmute" : "Mute"}
          </Button>
          <Button
            type="button"
            size={compact ? "sm" : "lg"}
            className="rounded-full bg-red-600 hover:bg-red-700 text-white"
            onClick={() => callSession.hangUp()}
            data-testid="button-call-hangup"
          >
            <PhoneOff className="h-4 w-4 mr-1" /> Hang up
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {s.phase === "ended" && (
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/15 text-white hover:bg-white/25"
              onClick={() => {
                const id = s.callId;
                callSession.dismiss();
                setLocation(id ? `/admin/calling/calls/${id}` : "/admin/calling");
              }}
              data-testid="button-call-see-details"
            >
              {s.callId ? "See transcript & summary" : "See it in Calls"}
            </Button>
          )}
          <Button size="sm" variant="secondary" className="bg-white/15 text-white hover:bg-white/25" onClick={() => callSession.dismiss()}>
            Close
          </Button>
        </div>
      )}
      {s.phase === "ended" && (
        <p className="mt-2 text-[11px] text-white/50">The summary and outcome appear a few seconds after the call ends.</p>
      )}
    </div>
  );
}
