import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { API, OVERVIEW_KEY, type Overview } from "./answerCheckApi";

/** Whether AI assessment is switched on (null while loading). */
export function useAssessmentOn(): { on: boolean | null; overview: Overview | undefined } {
  const { data } = useQuery<Overview>({ queryKey: OVERVIEW_KEY });
  return { on: data ? data.settings.enabled : null, overview: data };
}

/** The AI assessment on/off switch — the same one on the pilot's Settings and on the account's Features. */
export function AssessmentSwitch({ testid = "assessment-switch" }: { testid?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { on } = useAssessmentOn();
  const [busy, setBusy] = useState(false);
  async function set(next: boolean) {
    setBusy(true);
    try {
      await apiRequest("PUT", `${API}/enabled`, { enabled: next });
      await qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
      toast({ title: next ? "AI assessment switched on" : "AI assessment switched off" });
    } catch (e: any) { toast({ title: "Could not change it", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }
  return <Switch checked={!!on} disabled={busy || on === null} onCheckedChange={set} data-testid={testid} aria-label="AI assessment" />;
}

/** Shown on the pilot pages while AI assessment is off. */
export function AssessmentOffBanner({ accountName }: { accountName?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-100 px-4 py-3 text-[14px] text-gray-800" data-testid="assessment-off">
      <span className="min-w-0 flex-1">
        <b>AI assessment is switched off{accountName ? ` for ${accountName}` : ""}.</b> Nothing is checked and no AI cost is spent while it's off. Earlier results stay here.
      </span>
      <label className="flex items-center gap-2 font-medium">Switch on <AssessmentSwitch testid="assessment-switch-banner" /></label>
    </div>
  );
}
