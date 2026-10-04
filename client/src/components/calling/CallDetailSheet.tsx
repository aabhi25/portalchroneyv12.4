import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { AlertTriangle, Bot, CalendarClock, CheckCircle2, Circle, ExternalLink, Loader2, MessageSquareText, User, XCircle } from "lucide-react";
import { CALL_STATUS_LABEL, LIVE_CALL_STATUSES, TERMINAL_CALL_STATUSES, type CallStatus } from "@shared/aiCalling";
import {
  callingApi,
  callingKeys,
  endReasonLabel,
  formatDateTime,
  formatDuration,
  formatTime,
  friendlyFieldName,
  isCallingUnavailable,
  type CallDetail,
  type CallDetailResponse,
} from "@/lib/aiCallingApi";
import { CallOutcomeBadge, CallStatusBadge, DirectionIcon } from "./CallBadges";

const TRIGGER_LABEL: Record<string, string> = {
  auto_lead: "New lead (automatic)",
  manual: "Called by your team",
  retry: "Retry",
  callback: "Requested call-back",
  audience: "Audience",
  inbound: "They called you",
  test: "Test call",
};

function Timeline({ call }: { call: CallDetail }) {
  const failedEnd = TERMINAL_CALL_STATUSES.includes(call.status) && call.status !== "completed";
  const steps: { label: string; at: string | null; done: boolean; bad?: boolean }[] =
    call.direction === "inbound"
      ? [
          { label: "Call came in", at: call.startedAt || call.createdAt, done: true },
          { label: "AI answered", at: call.answeredAt, done: !!call.answeredAt },
          { label: failedEnd ? CALL_STATUS_LABEL[call.status] : "Ended", at: call.endedAt, done: !!call.endedAt || TERMINAL_CALL_STATUSES.includes(call.status), bad: failedEnd },
        ]
      : [
          { label: call.scheduledAt && new Date(call.scheduledAt) > new Date(call.createdAt) ? `Waiting until ${formatDateTime(call.scheduledAt)}` : "Queued", at: call.createdAt, done: true },
          { label: "Dialling", at: call.startedAt, done: !!call.startedAt },
          { label: "Answered", at: call.answeredAt, done: !!call.answeredAt },
          {
            label: failedEnd ? CALL_STATUS_LABEL[call.status] : "Ended",
            at: call.endedAt,
            done: !!call.endedAt || TERMINAL_CALL_STATUSES.includes(call.status),
            bad: failedEnd,
          },
        ];
  // A call that never got answered: grey out "Answered" rather than implying it is still pending.
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const skipped = !s.done && TERMINAL_CALL_STATUSES.includes(call.status);
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              {s.bad ? (
                <XCircle className="h-4 w-4 text-red-500" />
              ) : s.done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Circle className={`h-4 w-4 ${skipped ? "text-gray-200" : "text-gray-300"}`} />
              )}
              {i < steps.length - 1 && <div className="w-px flex-1 min-h-[14px] bg-gray-200" />}
            </div>
            <div className="pb-3 -mt-0.5">
              <p className={`text-sm ${s.done ? "text-gray-900" : "text-gray-400"} ${skipped ? "line-through" : ""}`}>{s.label}</p>
              {s.at && s.done && <p className="text-xs text-gray-500">{formatDateTime(s.at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function CallDetailSheet({ callId, onClose }: { callId: string | null; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const q = useQuery<CallDetailResponse>({
    queryKey: callingKeys.call(callId || ""),
    queryFn: () => callingApi.getCall(callId!),
    enabled: !!callId,
    staleTime: 0,
    retry: false,
    refetchInterval: query => {
      const c = query.state.data?.call;
      if (!c) return false;
      if (LIVE_CALL_STATUSES.includes(c.status)) return 3000;
      // Summary arrives shortly after a call ends.
      if (c.status === "completed" && !c.summary && c.endedAt && Date.now() - new Date(c.endedAt).getTime() < 90_000) return 4000;
      return false;
    },
  });

  const cancel = useMutation({
    mutationFn: () => callingApi.cancelCall(callId!),
    onSuccess: () => {
      setConfirmCancel(false);
      queryClient.invalidateQueries({ queryKey: callingKeys.all });
      toast({ title: "Call cancelled", description: "The AI won't make this call." });
    },
    onError: (e: Error) => toast({ title: "Couldn't cancel the call", description: e.message, variant: "destructive" }),
  });

  const call = q.data?.call;
  const lead = q.data?.lead;
  const transcript = q.data?.transcript || [];
  const fields = call?.capturedFields ? Object.entries(call.capturedFields).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "") : [];

  return (
    <Sheet open={!!callId} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0" data-testid="sheet-call-detail">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 pr-6">
            {call && <DirectionIcon direction={call.direction} />}
            <span className="truncate">{call ? call.leadName || lead?.name || call.phone : "Call"}</span>
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {call ? (
                <>
                  <span className="font-mono">{call.phone}</span>
                  <CallStatusBadge status={call.status as CallStatus} />
                  <CallOutcomeBadge outcome={call.outcome} />
                </>
              ) : (
                <span>Call details</span>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        {q.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : q.isError ? (
          <div className="p-6 text-sm text-gray-600">
            {isCallingUnavailable(q.error) ? "This call couldn't be found." : `Couldn't load this call: ${(q.error as Error).message}`}
          </div>
        ) : call ? (
          <div className="space-y-6 px-5 py-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500 text-xs">Why</p><p>{TRIGGER_LABEL[call.trigger] || call.trigger}{call.attempt > 1 ? ` · attempt ${call.attempt}` : ""}</p></div>
              <div><p className="text-gray-500 text-xs">Length</p><p>{formatDuration(call.durationSec)}</p></div>
              {call.provider === "simulator" && <div className="col-span-2"><p className="text-xs text-gray-500">Made in test mode (rang in the portal, not a real phone).</p></div>}
            </div>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-700">What happened</h3>
              <Timeline call={call} />
              {endReasonLabel(call.endReason) && <p className="text-xs text-gray-500">{endReasonLabel(call.endReason)}</p>}
              {call.errorMessage && (
                <p className="mt-2 flex gap-1.5 rounded bg-red-50 p-2 text-xs text-red-700"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {call.errorMessage}</p>
              )}
              {call.status === "queued" && (
                <Button variant="outline" size="sm" className="mt-3 text-red-600 hover:bg-red-50" onClick={() => setConfirmCancel(true)} data-testid="button-cancel-call">
                  Cancel this call
                </Button>
              )}
            </section>

            {(call.summary || call.outcomeNote || call.callbackAt || call.transferred || call.followUpSentAt) && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700">Summary</h3>
                {call.summary && <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-line">{call.summary}</p>}
                {call.outcomeNote && <p className="text-sm text-gray-600">{call.outcomeNote}</p>}
                {call.callbackAt && (
                  <p className="flex items-center gap-1.5 rounded bg-violet-50 px-2 py-1.5 text-sm text-violet-800">
                    <CalendarClock className="h-4 w-4" /> Call back {formatDateTime(call.callbackAt)}
                  </p>
                )}
                {call.transferred && <p className="text-sm text-sky-700">The call was passed to your team.</p>}
                {call.followUpSentAt && <p className="text-xs text-gray-500">WhatsApp follow-up sent {formatDateTime(call.followUpSentAt)}</p>}
              </section>
            )}
            {call.status === "completed" && !call.summary && (
              <p className="text-xs text-gray-500 flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Preparing the summary…</p>
            )}

            {fields.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Details the AI noted</h3>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
                  {fields.map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-xs text-gray-500">{friendlyFieldName(k)}</dt>
                      <dd className="break-words">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {call.hasRecording && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Recording</h3>
                <audio controls preload="none" src={callingApi.recordingUrl(call.id)} className="w-full" data-testid="audio-call-recording">
                  Your browser can't play this recording.
                </audio>
              </section>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700"><MessageSquareText className="h-4 w-4" /> Transcript</h3>
              {transcript.length === 0 ? (
                <p className="text-sm text-gray-500">{LIVE_CALL_STATUSES.includes(call.status) ? "The transcript appears as the call goes on." : "No conversation was recorded for this call."}</p>
              ) : (
                <div className="space-y-2 rounded-lg bg-gray-50 p-3">
                  {transcript.map((line, i) => {
                    const ai = line.role === "assistant";
                    return (
                      <div key={i} className={`flex gap-2 ${ai ? "" : "flex-row-reverse"}`}>
                        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${ai ? "bg-purple-100 text-purple-700" : "bg-sky-100 text-sky-700"}`}>
                          {ai ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                        </div>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${ai ? "bg-white border text-gray-800 rounded-tl-sm" : "bg-sky-600 text-white rounded-tr-sm"}`}>
                          <p className="whitespace-pre-line break-words">{line.content}</p>
                          {line.createdAt && <p className={`mt-0.5 text-[10px] ${ai ? "text-gray-400" : "text-sky-100"}`}>{formatTime(line.createdAt)}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {(lead || call.leadId) && (
              <Button variant="outline" size="sm" onClick={() => setLocation(`/admin/leads?leadId=${encodeURIComponent((lead?.id || call.leadId)!)}`)} data-testid="button-open-lead">
                <ExternalLink className="h-4 w-4 mr-1" /> Open lead{lead?.name ? `: ${lead.name}` : ""}
              </Button>
            )}
          </div>
        ) : null}

        <AlertDialog open={confirmCancel} onOpenChange={o => { if (!cancel.isPending) setConfirmCancel(o); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this call?</AlertDialogTitle>
              <AlertDialogDescription>The AI won't call {call?.leadName || call?.phone}. You can always start a new call later.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancel.isPending}>Keep it</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-700" disabled={cancel.isPending} onClick={e => { e.preventDefault(); cancel.mutate(); }} data-testid="button-confirm-cancel-call">
                {cancel.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Cancel call
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
