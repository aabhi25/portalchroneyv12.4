import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Loader2, Phone } from "lucide-react";
import { callingApi, callingKeys, errorStatus, type SuperAdminCallingState } from "@/lib/aiCallingApi";

/**
 * Super admin → business modules: "AI Calling" switch + optional monthly minute cap.
 * Uses GET/PUT /api/super-admin/ai-calling/:businessAccountId.
 */
export function SuperAdminAiCallingCard({ businessAccountId, initialEnabled }: { businessAccountId: string; initialEnabled?: boolean }) {
  const { toast } = useToast();
  const q = useQuery<SuperAdminCallingState>({
    queryKey: callingKeys.superAdmin(businessAccountId),
    queryFn: () => callingApi.superAdminGet(businessAccountId),
    staleTime: 0,
    retry: false,
  });
  const unavailable = q.isError && (errorStatus(q.error) === 404 || errorStatus(q.error) === 501);
  const enabled = q.data?.enabled ?? initialEnabled ?? false;
  const [cap, setCap] = useState("");

  useEffect(() => {
    if (q.data) setCap(q.data.monthlyMinuteCap === null || q.data.monthlyMinuteCap === undefined ? "" : String(q.data.monthlyMinuteCap));
  }, [q.data]);

  const savedCap = q.data?.monthlyMinuteCap ?? null;
  const capValid = cap.trim() === "" || (/^\d+$/.test(cap.trim()) && Number(cap) > 0);
  const capNumber = cap.trim() === "" ? null : Number(cap);
  const capDirty = capValid && capNumber !== savedCap;

  const save = useMutation({
    mutationFn: (body: { enabled: boolean; monthlyMinuteCap: number | null }) => callingApi.superAdminPut(businessAccountId, body),
    onSuccess: (data, body) => {
      queryClient.setQueryData(callingKeys.superAdmin(businessAccountId), { ...q.data, ...data });
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "AI Calling updated", description: body.enabled ? "Enabled for this business." : "Disabled for this business." });
    },
    onError: (e: Error) => toast({ title: "Couldn't update AI Calling", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors" data-testid="card-super-admin-ai-calling">
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
        <Phone className="h-5 w-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-gray-900 mb-1">AI Calling</h4>
        <p className="text-sm text-gray-600 mb-2">
          The AI phones new leads and answers the business's number (Exotel), with summaries, outcomes, retries and a do-not-call list. Includes a test mode that rings in the portal.
        </p>
        {unavailable ? (
          <p className="text-xs text-amber-700">The AI Calling server update isn't installed yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={enabled}
                disabled={q.isLoading || save.isPending}
                onCheckedChange={v => save.mutate({ enabled: v, monthlyMinuteCap: savedCap })}
                data-testid="switch-ai-calling"
              />
              <span className="text-sm font-medium text-gray-700">{enabled ? "Enabled" : "Disabled"}</span>
              {(q.isLoading || save.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
            </div>
            {enabled && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600" htmlFor={`ai-calling-cap-${businessAccountId}`}>Monthly minute cap (optional)</label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={`ai-calling-cap-${businessAccountId}`}
                    className="w-32 h-8"
                    inputMode="numeric"
                    placeholder="No cap"
                    value={cap}
                    onChange={e => setCap(e.target.value)}
                    data-testid="input-ai-calling-cap"
                  />
                  <span className="text-xs text-gray-500">minutes</span>
                  <Button size="sm" variant="outline" className="h-8" disabled={!capDirty || save.isPending} onClick={() => save.mutate({ enabled, monthlyMinuteCap: capNumber })} data-testid="button-save-ai-calling-cap">
                    Save cap
                  </Button>
                </div>
                {!capValid && <p className="text-xs text-red-600">Enter a whole number of minutes, or leave empty for no cap.</p>}
                {typeof q.data?.minutesThisMonth === "number" && (
                  <p className="text-xs text-gray-500">{Math.round(q.data.minutesThisMonth).toLocaleString()} minutes used this month.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
