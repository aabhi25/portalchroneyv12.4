import { Badge } from "@/components/ui/badge";
import { Check, MessageCircle, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { formatDateTime, formatTime } from "@/lib/aiCallingApi";
import {
  CALL_OUTCOME_LABEL,
  CALL_STATUS_LABEL,
  LIVE_CALL_STATUSES,
  type CallDirection,
  type CallFollowUpView,
  type CallOutcome,
  type CallStatus,
} from "@shared/aiCalling";

const STATUS_TONE: Record<CallStatus, string> = {
  queued: "border-slate-200 bg-slate-50 text-slate-700",
  dialing: "border-sky-200 bg-sky-50 text-sky-700",
  ringing: "border-sky-200 bg-sky-50 text-sky-700",
  in_progress: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-gray-200 bg-white text-gray-700",
  no_answer: "border-amber-200 bg-amber-50 text-amber-700",
  busy: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  voicemail: "border-amber-200 bg-amber-50 text-amber-700",
  cancelled: "border-gray-200 bg-gray-50 text-gray-500",
  skipped: "border-gray-200 bg-gray-50 text-gray-500",
};

const OUTCOME_TONE: Partial<Record<CallOutcome, string>> = {
  interested: "border-emerald-200 bg-emerald-50 text-emerald-700",
  callback_requested: "border-violet-200 bg-violet-50 text-violet-700",
  not_interested: "border-gray-200 bg-gray-50 text-gray-600",
  wrong_number: "border-gray-200 bg-gray-50 text-gray-600",
  do_not_call: "border-red-200 bg-red-50 text-red-700",
  transferred: "border-sky-200 bg-sky-50 text-sky-700",
};

export function CallStatusBadge({ status }: { status: CallStatus }) {
  const live = LIVE_CALL_STATUSES.includes(status);
  return (
    <Badge variant="outline" className={`whitespace-nowrap font-normal ${STATUS_TONE[status] ?? ""}`}>
      {live && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {CALL_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/** Pass `status` to skip the badge when it would only repeat the status (e.g. "No answer" twice). */
export function CallOutcomeBadge({ outcome, status }: { outcome: CallOutcome | null; status?: CallStatus }) {
  if (!outcome) return null;
  if (status && (outcome === status || CALL_OUTCOME_LABEL[outcome] === CALL_STATUS_LABEL[status])) return null;
  return (
    <Badge variant="outline" className={`whitespace-nowrap font-normal ${OUTCOME_TONE[outcome] ?? "border-gray-200 bg-white text-gray-700"}`}>
      {CALL_OUTCOME_LABEL[outcome] ?? outcome}
    </Badge>
  );
}

export function DirectionIcon({ direction, className = "h-4 w-4" }: { direction: CallDirection; className?: string }) {
  return direction === "inbound" ? (
    <PhoneIncoming className={`${className} text-sky-600`} aria-label="Incoming call" />
  ) : (
    <PhoneOutgoing className={`${className} text-violet-600`} aria-label="Outgoing call" />
  );
}

/**
 * The WhatsApp follow-up sent after a call, and how far it got: Sent → Delivered → Read → Replied
 * (delivery receipts from WhatsApp), or why it failed.
 */
export function CallFollowUpLine({ followUp, className = "" }: { followUp: CallFollowUpView | null | undefined; className?: string }) {
  if (!followUp) return null;
  const name = followUp.template ? ` “${followUp.template}”` : "";
  if (followUp.status === "failed") {
    return (
      <p className={`flex items-start gap-1.5 text-xs text-red-700 ${className}`} data-testid="call-follow-up">
        <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>WhatsApp follow-up{name} failed{followUp.error ? `: ${followUp.error}` : ""}</span>
      </p>
    );
  }
  const steps: Array<{ label: string; at: string | null; done: boolean }> = [
    { label: "Sent", at: followUp.sentAt, done: true },
    { label: "Delivered", at: followUp.deliveredAt, done: !!followUp.deliveredAt || followUp.status === "delivered" || followUp.status === "read" },
    { label: "Read", at: followUp.readAt, done: !!followUp.readAt || followUp.status === "read" },
    { label: "Replied", at: followUp.repliedAt, done: !!followUp.repliedAt },
  ];
  return (
    <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs ${className}`} data-testid="call-follow-up">
      <span className="flex items-center gap-1 text-gray-600"><MessageCircle className="h-3.5 w-3.5 text-emerald-600" />WhatsApp follow-up{name}</span>
      {steps.map((s, i) => (
        <span key={s.label} className={`flex items-center gap-0.5 ${s.done ? "text-emerald-700" : "text-gray-400"}`} title={s.at ? formatDateTime(s.at) : undefined} data-testid={`follow-up-${s.label.toLowerCase()}${s.done ? "-done" : ""}`}>
          {i > 0 && <span className="mr-1 text-gray-300">·</span>}
          {s.done ? <Check className="h-3 w-3" /> : null}
          {s.label}{s.done && s.at ? ` ${formatTime(s.at)}` : ""}
        </span>
      ))}
    </div>
  );
}
