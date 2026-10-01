import { Loader2, MessageSquare, PhoneOff, Video, Volume2, VolumeX, X } from "lucide-react";
import type { RefObject } from "react";
import type { AvatarPhase } from "@/lib/liveAvatar/stateMachine";

interface LiveAvatarPanelProps {
  phase: AvatarPhase;
  displayName: string;
  styleHint?: string;
  videoRef: RefObject<HTMLVideoElement>;
  caption: string;
  speaking: boolean;
  muted: boolean;
  remainingSeconds: number | null;
  notice: string | null;
  chatColor: string;
  chatColorEnd: string;
  avatarImageUrl?: string;
  onToggleMute: () => void;
  onEnd: () => void;
  onSwitchToText: () => void;
  onDismissNotice: () => void;
}

function formatClock(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Live AI avatar panel: video on top (aspect-fit, portrait friendly), live
 * captions, a permanent "AI avatar" badge and the call controls. The chat
 * transcript (with product cards) continues below it. The <video> element stays
 * mounted (hidden) whenever the avatar is available so playback can be
 * unlocked synchronously inside the visitor's tap (iOS Safari).
 */
export function LiveAvatarPanel(props: LiveAvatarPanelProps) {
  const { phase, displayName, videoRef, caption, speaking, muted, remainingSeconds, notice, chatColor, chatColorEnd, avatarImageUrl } = props;
  const active = phase === "requesting" || phase === "connecting" || phase === "live" || phase === "ending";
  const connecting = phase === "requesting" || phase === "connecting";

  return (
    <div className="flex-shrink-0" data-testid="live-avatar-region">
      {notice && !active && (
        <div role="status" className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="live-avatar-notice">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={props.onDismissNotice} aria-label="Dismiss" className="text-amber-700 hover:text-amber-900">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <section
        aria-label={`Video call with ${displayName}, an AI avatar`}
        className={active ? "relative mx-3 mt-2 overflow-hidden rounded-2xl bg-gray-900 shadow-md" : "hidden"}
        data-testid="live-avatar-panel"
      >
        <div className="relative mx-auto w-full" style={{ height: "clamp(150px, 34vh, 340px)" }}>
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            autoPlay
            // Never request the camera: this element only PLAYS the avatar stream.
            aria-label={`${displayName} (AI avatar)`}
            data-testid="live-avatar-video"
          />
          {connecting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white" style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }} data-testid="live-avatar-connecting">
              {avatarImageUrl ? (
                <img src={avatarImageUrl} alt="" className="h-16 w-16 animate-pulse rounded-full border-2 border-white/40 object-cover" />
              ) : (
                <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-white/20">
                  <Video className="h-7 w-7" />
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Connecting to {displayName}…</span>
              </div>
            </div>
          )}
          {/* Permanent AI disclosure badge (EU AI Act Art. 50 / India SGI labelling). */}
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white" data-testid="live-avatar-badge">
            <span className={`h-1.5 w-1.5 rounded-full ${speaking ? "bg-emerald-400" : "bg-white/70"}`} aria-hidden />
            AI avatar
          </div>
          {phase === "live" && remainingSeconds != null && (
            <div className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] tabular-nums text-white" aria-label="Time left in this video call">
              {formatClock(remainingSeconds)}
            </div>
          )}
          {phase === "live" && caption && (
            <div className="absolute inset-x-2 bottom-2 flex justify-center" aria-live="polite" data-testid="live-avatar-caption">
              <p className="max-w-full rounded-lg bg-black/65 px-2.5 py-1 text-center text-[13px] leading-snug text-white">{caption}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 bg-gray-900 px-2 py-1.5">
          <span className="min-w-0 truncate pl-1 text-xs text-white/80">{displayName}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={props.onToggleMute}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label={muted ? "Unmute avatar" : "Mute avatar"}
              aria-pressed={muted}
              data-testid="button-avatar-mute"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={props.onSwitchToText}
              className="flex h-8 items-center gap-1 rounded-full bg-white/10 px-2.5 text-xs text-white hover:bg-white/20"
              aria-label="Switch to text chat"
              data-testid="button-avatar-text"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Text
            </button>
            <button
              type="button"
              onClick={props.onEnd}
              className="flex h-8 items-center gap-1 rounded-full bg-red-600 px-2.5 text-xs font-medium text-white hover:bg-red-700"
              aria-label="End video call"
              data-testid="button-avatar-end"
            >
              <PhoneOff className="h-3.5 w-3.5" /> End
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
