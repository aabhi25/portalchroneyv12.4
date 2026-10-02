import { ChevronDown, Loader2, MessageSquare, Mic, PhoneOff, ShoppingBag, Video, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { AvatarPhase } from "@/lib/liveAvatar/stateMachine";

/** What the voice session is doing (from InlineVoiceMode, which sits under this call screen). */
export interface AvatarVoiceStatus {
  state: "idle" | "listening" | "thinking" | "speaking";
  connecting: boolean;
  error: string | null;
  transcript: string;
}

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
  voiceStatus?: AvatarVoiceStatus | null;
  /** Product cards for the latest answer, shown on the call screen. */
  products?: ReactNode;
  /** Changes whenever a new set of products arrives (re-opens the tray). */
  productsKey?: string | null;
  onToggleMute: () => void;
  /** Start the microphone (status pill tap when it isn't listening yet). */
  onRequestListen?: () => void;
  onEnd: () => void;
  onSwitchToText: () => void;
  onDismissNotice: () => void;
}

function formatClock(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function voiceLabel(status: AvatarVoiceStatus | null | undefined, avatarSpeaking: boolean, displayName: string): string | null {
  if (avatarSpeaking) return null;
  if (!status) return null;
  if (status.error && status.state === "idle") return status.error;
  if (status.connecting) return "Connecting…";
  if (status.state === "listening") return status.transcript ? status.transcript : "Listening…";
  if (status.state === "thinking") return `${displayName} is thinking…`;
  if (status.state === "idle") return "Tap to talk — allow the microphone";
  return null;
}

/**
 * Live AI avatar call: covers the whole chat window like a video call (video,
 * live captions, product cards for the latest answer, mute / text / end, and ✕).
 * The chat transcript keeps everything underneath. The <video> element stays
 * mounted (hidden) whenever the avatar is available so playback can be unlocked
 * synchronously inside the visitor's tap (iOS Safari).
 */
export function LiveAvatarPanel(props: LiveAvatarPanelProps) {
  const { phase, displayName, videoRef, caption, speaking, muted, remainingSeconds, notice, chatColor, chatColorEnd, avatarImageUrl, voiceStatus, products, productsKey } = props;
  const active = phase === "requesting" || phase === "connecting" || phase === "live" || phase === "ending";
  const connecting = phase === "requesting" || phase === "connecting";
  const [productsOpen, setProductsOpen] = useState(true);
  useEffect(() => { if (productsKey) setProductsOpen(true); }, [productsKey]);
  const status = phase === "live" ? voiceLabel(voiceStatus, speaking, displayName) : null;
  const listening = phase === "live" && voiceStatus?.state === "listening" && !speaking;
  const micIdle = phase === "live" && !speaking && voiceStatus?.state === "idle" && !voiceStatus.connecting;

  return (
    <>
      {notice && !active && (
        <div role="status" className="mx-3 mt-2 flex flex-shrink-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="live-avatar-notice">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={props.onDismissNotice} aria-label="Dismiss" className="text-amber-700 hover:text-amber-900">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <section
        aria-label={`Video call with ${displayName}, an AI avatar`}
        role="dialog"
        aria-modal={active}
        className={active ? "absolute inset-0 z-40 flex flex-col overflow-hidden bg-gray-950" : "hidden"}
        data-testid="live-avatar-region"
      >
        {/* Video fills the call screen. */}
        <div className="relative min-h-0 flex-1" data-testid="live-avatar-panel">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            autoPlay
            // Never request the camera: this element only PLAYS the avatar stream.
            aria-label={`${displayName} (AI avatar)`}
            data-testid="live-avatar-video"
          />
          {connecting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white" style={{ background: `linear-gradient(160deg, ${chatColor}, ${chatColorEnd})` }} data-testid="live-avatar-connecting">
              {avatarImageUrl ? (
                <img src={avatarImageUrl} alt="" className="h-24 w-24 animate-pulse rounded-full border-2 border-white/40 object-cover" />
              ) : (
                <div className="flex h-24 w-24 animate-pulse items-center justify-center rounded-full bg-white/20">
                  <Video className="h-10 w-10" />
                </div>
              )}
              <div className="flex items-center gap-2 text-base">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Connecting to {displayName}…</span>
              </div>
            </div>
          )}

          {/* Top bar: AI badge + name, timer, close. */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6 pt-3">
            <div className="flex min-w-0 items-center gap-2">
              {/* Permanent AI disclosure badge (EU AI Act Art. 50 / India SGI labelling). */}
              <div className="flex flex-shrink-0 items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white" data-testid="live-avatar-badge">
                <span className={`h-1.5 w-1.5 rounded-full ${speaking ? "bg-emerald-400" : "bg-white/70"}`} aria-hidden />
                AI avatar
              </div>
              <span className="truncate text-sm font-medium text-white drop-shadow">{displayName}</span>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {phase === "live" && remainingSeconds != null && (
                <span className="rounded-full bg-black/50 px-2 py-0.5 text-[11px] tabular-nums text-white" aria-label="Time left in this video call">
                  {formatClock(remainingSeconds)}
                </span>
              )}
              <button
                type="button"
                onClick={props.onEnd}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                aria-label="Close video call"
                data-testid="button-avatar-close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Captions + what the call is doing (listening / thinking). */}
          {phase === "live" && (caption || status) && (
            <div className="absolute inset-x-3 bottom-3 flex flex-col items-center gap-1.5" aria-live="polite">
              {caption && (
                <p className="max-w-full rounded-lg bg-black/65 px-3 py-1.5 text-center text-[14px] leading-snug text-white" data-testid="live-avatar-caption">{caption}</p>
              )}
              {!caption && status && (micIdle && props.onRequestListen ? (
                <button type="button" onClick={props.onRequestListen} className="flex max-w-full items-center gap-1.5 rounded-full bg-white/90 px-3.5 py-1.5 text-[13px] font-medium text-gray-900 shadow hover:bg-white" data-testid="live-avatar-status">
                  <Mic className="h-4 w-4" aria-hidden />
                  <span className="truncate">{status}</span>
                </button>
              ) : (
                <p className="flex max-w-full items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[13px] text-white" data-testid="live-avatar-status">
                  {listening && <Mic className="h-3.5 w-3.5 animate-pulse text-emerald-300" aria-hidden />}
                  <span className="truncate">{status}</span>
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Products for the latest answer, "on screen" next to the avatar. */}
        {phase === "live" && products && (
          productsOpen ? (
            <div className="flex-shrink-0 border-t border-white/10 bg-white px-3 pb-1 pt-2" data-testid="live-avatar-products">
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-gray-700">
                <span className="flex items-center gap-1.5"><ShoppingBag className="h-3.5 w-3.5" /> Products</span>
                <button type="button" onClick={() => setProductsOpen(false)} className="flex items-center gap-0.5 text-gray-500 hover:text-gray-800" aria-label="Hide products">
                  Hide <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-[42vh] overflow-y-auto">{products}</div>
            </div>
          ) : (
            <button type="button" onClick={() => setProductsOpen(true)} className="flex flex-shrink-0 items-center justify-center gap-1.5 bg-white py-2 text-xs font-medium text-gray-700" data-testid="button-avatar-show-products">
              <ShoppingBag className="h-3.5 w-3.5" /> Show products
            </button>
          )
        )}

        {/* Call controls. */}
        <div className="flex flex-shrink-0 items-center justify-center gap-3 bg-gray-950 px-3 py-3">
          <button
            type="button"
            onClick={props.onToggleMute}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label={muted ? "Unmute avatar" : "Mute avatar"}
            aria-pressed={muted}
            data-testid="button-avatar-mute"
          >
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={props.onSwitchToText}
            className="flex h-11 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm text-white hover:bg-white/20"
            aria-label="Switch to text chat"
            data-testid="button-avatar-text"
          >
            <MessageSquare className="h-4 w-4" /> Text
          </button>
          <button
            type="button"
            onClick={props.onEnd}
            className="flex h-11 items-center gap-1.5 rounded-full bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
            aria-label="End video call"
            data-testid="button-avatar-end"
          >
            <PhoneOff className="h-4 w-4" /> End
          </button>
        </div>
      </section>
    </>
  );
}
