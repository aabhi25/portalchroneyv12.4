import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Headset, Info, Loader2, PhoneIncoming, PhoneOutgoing, Settings } from "lucide-react";
import { isCallingUnavailable, useCallingSettings } from "@/lib/aiCallingApi";
import { CallingPageHeader, CallingUnavailable } from "@/components/calling/RequireAiCalling";
import { CallTargetPicker, useCreateCall, type CallTarget } from "@/components/calling/CallNowDialog";
import { ActiveCallPanel } from "@/components/calling/ActiveCallPanel";
import { callSession, useCallSession } from "@/components/calling/callSession";

/** Talk to the AI through the browser, as a customer would on the phone. */
export default function CallingTry() {
  const [, setLocation] = useLocation();
  const settings = useCallingSettings();
  const session = useCallSession();
  const [target, setTarget] = useState<CallTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const create = useCreateCall({ test: true, onDone: () => setConfirmOpen(false) });

  if (isCallingUnavailable(settings.error)) return <CallingUnavailable />;

  const testMode = settings.data?.provider === "simulator";
  const inCall = session.phase !== "idle";
  const busy = session.phase === "connecting" || session.phase === "live";

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <CallingPageHeader title="Try a call" description="Hear exactly what your customers will hear — right here in the browser, using your microphone." />

      {settings.isLoading ? (
        <div className="py-16 text-center"><Loader2 className="inline h-6 w-6 animate-spin text-gray-400" /></div>
      ) : !testMode ? (
        <Card className="mb-5 border-amber-200 bg-amber-50/60">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2 text-sm text-amber-900">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Your phone provider is set to Exotel, so calls go to real phones. To practise here in the portal, switch the phone provider to
                <b> Test mode</b> in settings. (Testing an incoming call below still works.)
              </span>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 self-start sm:self-auto" onClick={() => setLocation("/admin/calling/settings")}>
              <Settings className="h-4 w-4 mr-1" /> Settings
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {inCall && (
        <div className="mb-6 mx-auto max-w-md">
          <ActiveCallPanel />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-sky-500 to-indigo-600 px-5 py-6 text-white">
            <PhoneIncoming className="h-7 w-7" />
            <h2 className="mt-3 text-lg font-semibold">Test an incoming call</h2>
            <p className="text-sm text-white/80">Call your business as a customer. The AI answers with your greeting and knows everything you've trained it on.</p>
          </div>
          <CardContent className="p-5">
            <Button
              size="lg"
              className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
              disabled={busy || settings.isLoading}
              onClick={() => callSession.startInbound()}
              data-testid="button-test-inbound"
            >
              <Headset className="h-5 w-5 mr-2" /> Call my business
            </Button>
            <p className="mt-2 text-center text-xs text-gray-500">Your browser will ask to use the microphone. Headphones give the best result.</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-violet-500 to-purple-700 px-5 py-6 text-white">
            <PhoneOutgoing className="h-7 w-7" />
            <h2 className="mt-3 text-lg font-semibold">Test the AI calling a lead</h2>
            <p className="text-sm text-white/80">Pick a lead (or make one up). The AI phones them — and your portal rings instead of their phone. You play the lead.</p>
          </div>
          <CardContent className="space-y-4 p-5">
            {testMode ? (
              <>
                <CallTargetPicker onChange={setTarget} />
                <Button
                  size="lg"
                  className="w-full rounded-full"
                  disabled={!target || busy || create.isPending}
                  onClick={() => setConfirmOpen(true)}
                  data-testid="button-test-outbound"
                >
                  {create.isPending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <PhoneOutgoing className="h-5 w-5 mr-2" />} Call me in test mode
                </Button>
                <p className="text-center text-xs text-gray-500">The call follows your settings (calling hours, do-not-call list) just like a real one.</p>
              </>
            ) : (
              <p className="text-sm text-gray-600">Available in Test mode. In Exotel mode use “Call someone now” on the Calls page — it rings a real phone.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={o => { if (!create.isPending) setConfirmOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a test call?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI will call {target?.displayName} in test mode. Nobody's phone rings — this portal rings in a few seconds and you answer as {target?.displayName}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={create.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={create.isPending || !target} onClick={e => { e.preventDefault(); if (target) create.mutate(target); }} data-testid="button-confirm-test-outbound">
              {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Start test call
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
