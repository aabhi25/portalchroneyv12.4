import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type TutorAdminView = {
  eligible: boolean;
  enabled: boolean;
  dailyMinutesPerStudent: number;
  limits: { dailyMinutesPerStudent: { min: number; max: number; default: number } };
  updatedAt: string | null;
};
type UsageView = { day: string; students: number; totalSeconds: number };

export const tutorKey = (id: string) => ["/api/super-admin/tutor/accounts", id];

/**
 * Super admin: switch the AI tutor on/off for an account and set the minutes each student may
 * use per day. Video follows the account's live avatar settings.
 */
export function TutorSettingsDialog({ open, onOpenChange, businessAccountId, businessName }: {
  open: boolean; onOpenChange: (v: boolean) => void; businessAccountId: string; businessName: string;
}) {
  const { toast } = useToast();
  const settings = useQuery<TutorAdminView>({ queryKey: tutorKey(businessAccountId), enabled: open });
  const usage = useQuery<UsageView>({ queryKey: [`/api/super-admin/tutor/accounts/${businessAccountId}/usage`], enabled: open });
  const [enabled, setEnabled] = useState(false);
  const [minutes, setMinutes] = useState("20");

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setMinutes(String(settings.data.dailyMinutesPerStudent));
  }, [settings.data]);

  const lim = settings.data?.limits.dailyMinutesPerStudent ?? { min: 5, max: 240, default: 20 };
  const minutesNum = Number(minutes);
  const minutesError = !/^\d+$/.test(minutes.trim()) || minutesNum < lim.min || minutesNum > lim.max
    ? `Enter ${lim.min}–${lim.max} minutes.` : null;

  const save = useMutation({
    mutationFn: () => apiRequest<TutorAdminView>("PUT", `/api/super-admin/tutor/accounts/${businessAccountId}`, {
      enabled, dailyMinutesPerStudent: minutesNum,
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(tutorKey(businessAccountId), data);
      toast({ title: "Tutor settings saved", description: data.enabled ? "The AI tutor is on for this account." : "The AI tutor is off for this account." });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Couldn't save tutor settings", description: e?.message || "Try again.", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>AI tutor · {businessName}</DialogTitle>
          <DialogDescription>
            A teacher-like tutor in the chat widget that teaches a chapter from your synced content, with a live board.
            It uses the video avatar when that is on for this account, otherwise voice with the board.
          </DialogDescription>
        </DialogHeader>
        {settings.isLoading ? (
          <div className="py-8 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-gray-400" /></div>
        ) : settings.isError ? (
          <p className="text-sm text-red-600">Couldn't load the tutor settings. Close and try again.</p>
        ) : (
          <div className="space-y-5">
            {!settings.data?.eligible && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Only K12 / TopScholar accounts can use the tutor: it teaches from synced curriculum content.
              </p>
            )}
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="tutor-enabled" className="text-sm font-medium">Tutor on for this account</Label>
                <p className="text-xs text-gray-500">Students see "Teach me this chapter" in the chat.</p>
              </div>
              <Switch id="tutor-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={!settings.data?.eligible} data-testid="switch-tutor-enabled" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tutor-minutes">Minutes per student per day</Label>
              <div className="flex items-center gap-2">
                <Input id="tutor-minutes" className="w-24" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} data-testid="input-tutor-minutes" />
                <span className="text-sm text-gray-500">minutes, resets at midnight (India time)</span>
              </div>
              {minutesError ? <p className="text-xs text-red-600">{minutesError}</p> : (
                <p className="text-xs text-gray-500">When a student reaches it, the tutor wraps up with a short recap and says goodbye.</p>
              )}
            </div>
            <p className="text-xs text-gray-500" data-testid="text-tutor-usage">
              {usage.data ? `Today: ${usage.data.students} student${usage.data.students === 1 ? "" : "s"}, ${Math.round(usage.data.totalSeconds / 60)} min in total.` : "Today: —"}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!!minutesError || save.isPending || settings.isLoading || settings.isError} data-testid="button-save-tutor">
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
