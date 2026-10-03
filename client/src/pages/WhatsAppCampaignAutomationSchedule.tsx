import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Loader2, MinusCircle, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { WEEKDAY_SHORT, describeScheduleDays } from "./WhatsAppCampaignAutomations";

type Attempt = {
  id: string;
  runDate: string;
  scheduledFor: string;
  status: "running" | "created" | "skipped" | "failed";
  outcome: string | null;
  reason: string | null;
  runId: string | null;
  eligibleRows: number;
  createdAt: string;
};
type Schedule = {
  scheduleEnabled: boolean;
  scheduleDays: number[];
  sendTime: string;
  timezone: string;
  sendMode: "review" | "automatic";
  enabled: boolean;
  canSchedule: boolean;
  cannotScheduleReason: string | null;
  nextRunAt: string | null;
  history: Attempt[];
};

const OUTCOME: Record<string, { label: string; tone: "good" | "wait" | "neutral" | "bad"; icon: React.ComponentType<{ className?: string }> }> = {
  scheduled: { label: "Campaign scheduled", tone: "good", icon: CheckCircle2 },
  awaiting_review: { label: "Waiting for your approval", tone: "wait", icon: Clock },
  nothing_due: { label: "Nobody due", tone: "neutral", icon: MinusCircle },
  campaigns_off: { label: "Campaigns switched off", tone: "neutral", icon: MinusCircle },
  needs_upload: { label: "Needs a file", tone: "neutral", icon: MinusCircle },
  missed: { label: "Missed", tone: "bad", icon: AlertTriangle },
  interrupted: { label: "Interrupted", tone: "bad", icon: AlertTriangle },
  validation_failed: { label: "Could not run", tone: "bad", icon: XCircle },
};
const TONE_CLASS = {
  good: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  wait: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  neutral: "bg-gray-100 text-gray-700 hover:bg-gray-100",
  bad: "bg-red-100 text-red-800 hover:bg-red-100",
};

function formatInZone(iso: string, timezone: string, withWeekday = true): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: timezone, weekday: withWeekday ? "short" : undefined, day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}
function formatRunDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Daily schedule for one automation: on/off, weekdays, next run time and the
 * history of automatic runs with a readable status and reason.
 */
export function AutomationScheduleCard({
  automationId,
  runCampaignIds,
}: {
  automationId: string;
  /** runId -> campaignId, so a history row can open the campaign it created. */
  runCampaignIds: Map<string, string | null>;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [confirmOn, setConfirmOn] = useState(false);
  const queryKey = ["/api/whatsapp/campaign-automations", automationId, "schedule"];
  const { data: schedule, isLoading } = useQuery<Schedule>({
    queryKey,
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-automations/${automationId}/schedule`),
    refetchInterval: 30_000,
  });
  const save = useMutation({
    mutationFn: (body: { scheduleEnabled?: boolean; scheduleDays?: number[] }) =>
      apiRequest("PATCH", `/api/whatsapp/campaign-automations/${automationId}/schedule`, body),
    onSuccess: (result: Schedule, body) => {
      queryClient.setQueryData(queryKey, result);
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations"] });
      if (body.scheduleEnabled !== undefined) {
        toast({ title: body.scheduleEnabled ? "Automatic daily run switched on" : "Automatic daily run switched off" });
      }
    },
    onError: (error: any) => toast({ title: "Could not save the schedule", description: error.message, variant: "destructive" }),
  });

  if (isLoading || !schedule) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…</CardContent>
      </Card>
    );
  }

  const days = schedule.scheduleDays;
  const toggleDay = (day: number) => {
    const current = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
    const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day];
    if (next.length === 0) {
      toast({ title: "Pick at least one day", variant: "destructive" });
      return;
    }
    save.mutate({ scheduleDays: next });
  };
  const handleSwitch = (on: boolean) => {
    if (on && schedule.sendMode === "automatic") { setConfirmOn(true); return; }
    save.mutate({ scheduleEnabled: on });
  };

  return (
    <Card data-testid="card-automation-schedule">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4 text-emerald-600" /> Automatic daily run</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!schedule.canSchedule ? (
          <p className="text-sm text-gray-600">{schedule.cannotScheduleReason}</p>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <Switch
                id="automation-schedule-switch"
                checked={schedule.scheduleEnabled}
                disabled={save.isPending || !schedule.enabled}
                onCheckedChange={handleSwitch}
                data-testid="switch-automation-schedule"
              />
              <div className="min-w-0">
                <Label htmlFor="automation-schedule-switch">Run by itself</Label>
                <p className="text-xs text-gray-500 mt-0.5">
                  {schedule.sendMode === "automatic"
                    ? `At ${schedule.sendTime} (${schedule.timezone}) it checks who is due and sends to them — no clicks needed.`
                    : `At ${schedule.sendTime} (${schedule.timezone}) it checks who is due and prepares a run. Nothing is sent until you approve it below.`}
                </p>
                {!schedule.enabled && <p className="text-xs text-amber-700 mt-1">This automation is paused. Switch it back on in Edit to use the schedule.</p>}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">Days</p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_SHORT.map((label, day) => {
                  const active = days.length === 0 || days.includes(day);
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={save.isPending}
                      onClick={() => toggleDay(day)}
                      aria-pressed={active}
                      className={`h-8 min-w-[44px] rounded-full border px-2.5 text-xs transition-colors ${active ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                      data-testid={`schedule-day-${day}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500">{describeScheduleDays(days)}</p>
            </div>

            <div className="rounded-md bg-gray-50 px-3 py-2 text-sm" data-testid="text-next-run">
              {schedule.scheduleEnabled && schedule.nextRunAt
                ? <>Next run: <span className="font-medium">{formatInZone(schedule.nextRunAt, schedule.timezone)}</span> <span className="text-gray-500">({schedule.timezone})</span></>
                : <span className="text-gray-500">No automatic run planned. Use "Run now" below whenever you like.</span>}
            </div>
          </>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">Automatic run history</p>
          {schedule.history.length === 0 ? (
            <p className="text-sm text-gray-500">No automatic runs yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {schedule.history.map(attempt => {
                const meta = attempt.status === "running"
                  ? { label: "Preparing…", tone: "wait" as const, icon: Loader2 }
                  : OUTCOME[attempt.outcome || ""] || { label: attempt.status, tone: "neutral" as const, icon: MinusCircle };
                const Icon = meta.icon;
                const campaignId = attempt.runId ? runCampaignIds.get(attempt.runId) : null;
                return (
                  <li key={attempt.id} className="p-3 flex flex-col sm:flex-row sm:items-start gap-2" data-testid={`schedule-attempt-${attempt.runDate}`}>
                    <div className="flex items-center gap-2 sm:w-48 shrink-0">
                      <span className="text-sm font-medium">{formatRunDate(attempt.runDate)}</span>
                      <Badge className={`${TONE_CLASS[meta.tone]} text-[11px] font-normal gap-1`}>
                        <Icon className={`h-3 w-3 ${attempt.status === "running" ? "animate-spin" : ""}`} /> {meta.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 flex-1 min-w-0 break-words">{attempt.reason}</p>
                    {campaignId && (
                      <Button size="sm" variant="ghost" className="self-start h-7" onClick={() => setLocation(`/admin/whatsapp-campaigns/${campaignId}`)}>
                        Open campaign
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>

      <AlertDialog open={confirmOn} onOpenChange={open => { if (!save.isPending) setConfirmOn(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send automatically every day?</AlertDialogTitle>
            <AlertDialogDescription>
              From now on, at {schedule.sendTime} ({schedule.timezone}) {describeScheduleDays(days) === "Every day" ? "every day" : `on ${describeScheduleDays(days)}`}, this automation will
              message everyone who is due — without waiting for your review. People already messaged by this automation are never messaged twice
              for the same record. You can switch it off at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={save.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={save.isPending}
              onClick={event => {
                event.preventDefault();
                save.mutate({ scheduleEnabled: true }, { onSettled: () => setConfirmOn(false) });
              }}
            >
              Switch on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
