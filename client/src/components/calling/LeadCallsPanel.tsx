import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { MeResponseDto } from "@shared/dto";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Phone } from "lucide-react";
import { callingApi, callingKeys, formatDateTime, formatDuration, useAiCallingAvailability, type CallsListResponse } from "@/lib/aiCallingApi";
import { CallOutcomeBadge, CallStatusBadge, DirectionIcon } from "./CallBadges";
import { useCreateCall } from "./CallNowDialog";
import { LIVE_CALL_STATUSES } from "@shared/aiCalling";

/**
 * Lead details: "Call with AI" + this lead's calls. Renders nothing unless the business has
 * AI Calling switched on.
 */
export function LeadCallsPanel({ leadId, leadName, phone }: { leadId: string; leadName: string | null; phone: string | null }) {
  const { data: me } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const { enabled } = useAiCallingAvailability(me);
  const [, setLocation] = useLocation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const create = useCreateCall({ onDone: () => setConfirmOpen(false) });

  const params = { leadId, limit: 5, offset: 0 };
  const calls = useQuery<CallsListResponse>({
    queryKey: callingKeys.calls(params),
    queryFn: () => callingApi.listCalls(params),
    enabled,
    staleTime: 5_000,
    retry: false,
    refetchInterval: q => ((q.state.data?.calls || []).some(c => LIVE_CALL_STATUSES.includes(c.status) || c.status === "queued") ? 5000 : false),
  });

  if (!enabled) return null;
  const rows = calls.data?.calls || [];
  const who = leadName || "this lead";

  return (
    <div className="space-y-3" data-testid="lead-calls-panel">
      <div className="flex items-center justify-between gap-2 border-b pb-1">
        <h4 className="text-sm font-semibold text-gray-700">Phone calls</h4>
        <Button size="sm" variant="outline" className="h-7" disabled={!phone || create.isPending} onClick={() => setConfirmOpen(true)} data-testid="button-call-lead-with-ai">
          <Phone className="h-3.5 w-3.5 mr-1" /> Call with AI
        </Button>
      </div>
      {!phone && <p className="text-xs text-gray-500">This lead has no phone number.</p>}
      {calls.isLoading ? (
        <p className="text-xs text-gray-500"><Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Loading calls…</p>
      ) : calls.isError ? (
        <p className="text-xs text-gray-500">Couldn't load calls for this lead.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">No calls yet.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {rows.map(c => (
            <button key={c.id} type="button" onClick={() => setLocation(`/admin/calling/calls/${c.id}`)} className="flex w-full gap-2 px-3 py-2 text-left hover:bg-gray-50" data-testid={`lead-call-${c.id}`}>
              <DirectionIcon direction={c.direction} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <CallStatusBadge status={c.status} />
                  <CallOutcomeBadge outcome={c.outcome} status={c.status} />
                  <span className="text-xs text-gray-500">{formatDateTime(c.startedAt || c.createdAt)}{c.durationSec ? ` · ${formatDuration(c.durationSec)}` : ""}</span>
                </div>
                {c.summary && <p className="mt-1 line-clamp-2 text-xs text-gray-600">{c.summary}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={o => { if (!create.isPending) setConfirmOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Call {who} with AI?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI will call {who}{phone ? ` on ${phone}` : ""} now. If it's outside your calling hours, the call is scheduled for the next allowed time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={create.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={create.isPending}
              onClick={e => { e.preventDefault(); create.mutate({ leadId, displayName: who, displayPhone: phone || "" }); }}
              data-testid="button-confirm-call-lead"
            >
              {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Call now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
