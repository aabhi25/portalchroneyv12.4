import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MeResponseDto } from "@shared/dto";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Phone, PhoneOff } from "lucide-react";
import {
  callingApi,
  callingKeys,
  useAiCallingAvailability,
  useCallingSettings,
  type IncomingSimCall,
} from "@/lib/aiCallingApi";
import { callSession, useCallSession } from "./callSession";
import { ActiveCallPanel } from "./ActiveCallPanel";

/**
 * Mounted once for the whole portal. In test mode it watches for test calls the AI is placing
 * (every 3 s) and shows a ringing card wherever the user is; once answered, a floating in-call
 * card stays on screen across pages. Renders nothing unless the business has AI Calling and the
 * phone provider is "Test mode".
 */
export function AiCallingHost({ user }: { user: MeResponseDto | null }) {
  const { enabled } = useAiCallingAvailability(user);
  const settings = useCallingSettings(enabled);
  const testMode = enabled && settings.data?.provider === "simulator";
  const session = useCallSession();
  const [location] = useLocation();
  const { toast } = useToast();
  const [declined, setDeclined] = useState<Set<string>>(new Set());

  const busy = session.phase === "connecting" || session.phase === "live";
  const incoming = useQuery<{ calls: IncomingSimCall[] }>({
    queryKey: callingKeys.incoming,
    queryFn: callingApi.incoming,
    enabled: testMode && !busy,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });

  const decline = useMutation({
    mutationFn: (id: string) => callingApi.decline(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: callingKeys.callsRoot });
      queryClient.invalidateQueries({ queryKey: callingKeys.incoming });
    },
    onError: (e: Error) => toast({ title: "Couldn't decline the test call", description: e.message, variant: "destructive" }),
  });

  // Refresh the call lists when a test call finishes (and again once the summary is likely ready).
  useEffect(() => {
    if (session.phase !== "ended") return;
    const refresh = () => queryClient.invalidateQueries({ queryKey: callingKeys.all });
    refresh();
    const t1 = setTimeout(refresh, 4000);
    const t2 = setTimeout(refresh, 12000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [session.phase]);

  const ringing = testMode && !busy ? (incoming.data?.calls || []).find(c => !declined.has(c.id)) : undefined;
  const onTryPage = location.startsWith("/admin/calling/try");
  const showFloating = session.phase !== "idle" && !onTryPage;

  if (!enabled) return null;

  return (
    <>
      {ringing && (
        <div className="fixed inset-x-3 top-3 z-50 sm:inset-x-auto sm:right-4 sm:top-4 sm:w-[360px]" role="alertdialog" aria-label="Incoming test call" data-testid="incoming-call-popup">
          <div className="rounded-2xl border bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-white shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500">
                <span className="absolute inset-0 rounded-full bg-emerald-400/50 animate-ping" />
                <Phone className="relative h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">AI is calling {ringing.leadName || ringing.phone} (test)</p>
                <p className="text-xs text-white/60">Answer to hear the call as {ringing.leadName ? "they" : "the customer"} would. Uses your microphone.</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                className="rounded-full bg-red-600 text-white hover:bg-red-700"
                disabled={decline.isPending}
                onClick={() => {
                  setDeclined(prev => new Set(prev).add(ringing.id));
                  decline.mutate(ringing.id);
                }}
                data-testid="button-decline-test-call"
              >
                <PhoneOff className="h-4 w-4 mr-1" /> Decline
              </Button>
              <Button
                className="rounded-full bg-emerald-500 text-white hover:bg-emerald-600"
                onClick={() => {
                  setDeclined(prev => new Set(prev).add(ringing.id));
                  callSession.answerOutbound(ringing);
                }}
                data-testid="button-answer-test-call"
              >
                <Phone className="h-4 w-4 mr-1" /> Answer
              </Button>
            </div>
          </div>
        </div>
      )}
      {showFloating && (
        <div className="fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[360px]">
          <ActiveCallPanel compact />
        </div>
      )}
    </>
  );
}
