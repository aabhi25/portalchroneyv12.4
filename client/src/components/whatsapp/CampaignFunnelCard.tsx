import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Filter, Hand } from "lucide-react";

export interface CampaignFunnel {
  campaignId: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  interested: number;
  interestedLabels: string[];
  needsHuman: number;
  aiPaused: number;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Sent → Delivered → Read → Replied → Interested. Each bar is a share of the messages sent;
 * the small figure is the step-to-step rate ("62% of delivered were read").
 */
export function CampaignFunnelCard({ campaignId, isLive }: { campaignId: string; isLive?: boolean }) {
  const { data, isLoading, error } = useQuery<CampaignFunnel>({
    queryKey: [`/api/whatsapp/campaigns/${campaignId}/funnel`],
    refetchInterval: (q) => (q.state.error ? false : isLive ? 10000 : false),
    refetchOnMount: "always",
  });

  const steps = data ? [
    { key: "sent", label: "Sent", value: data.sent, prev: null as null | { label: string; value: number }, color: "bg-emerald-500" },
    { key: "delivered", label: "Delivered", value: data.delivered, prev: { label: "sent", value: data.sent }, color: "bg-teal-500" },
    { key: "read", label: "Read", value: data.read, prev: { label: "delivered", value: data.delivered }, color: "bg-sky-500" },
    { key: "replied", label: "Replied", value: data.replied, prev: { label: "read", value: data.read }, color: "bg-blue-600" },
    { key: "interested", label: "Interested", value: data.interested, prev: { label: "replied", value: data.replied }, color: "bg-violet-600" },
  ] : [];
  const noPositiveOutcome = !!data && data.interestedLabels.length === 0;

  return (
    <Card data-testid="card-campaign-funnel">
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2">
          <Filter className="h-4 w-4 text-emerald-600" /> Results
        </CardTitle>
        {data && data.needsHuman > 0 && (
          <Link
            href={`/admin/whatsapp-campaign-conversations?campaign=${campaignId}&filter=needs-human`}
            className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 inline-flex items-center gap-1 hover:bg-amber-100"
            data-testid="link-needs-human"
          >
            <Hand className="h-3 w-3" /> {data.needsHuman} {data.needsHuman === 1 ? "customer needs" : "customers need"} a person
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-gray-400 py-4 text-center">Loading results…</div>
        ) : error || !data ? (
          <div className="text-sm text-gray-400 py-4 text-center">Couldn't load the results.</div>
        ) : data.sent === 0 ? (
          <div className="text-sm text-gray-500 py-3">Nothing has been sent yet — results appear here once messages go out.</div>
        ) : (
          <div className="space-y-2.5">
            {steps.map(step => {
              const share = pct(step.value, data.sent);
              const stepRate = step.prev ? pct(step.value, step.prev.value) : null;
              const muted = step.key === "interested" && noPositiveOutcome;
              return (
                <div key={step.key} data-testid={`funnel-${step.key}`}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-gray-700 flex items-center gap-1">
                      {step.label}
                      {step.key === "interested" && (
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild><span className="cursor-help text-gray-400 text-xs">?</span></TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              {noPositiveOutcome
                                ? "Add a positive reply outcome (for example \"Interested\") to this campaign to count interested customers."
                                : `Customers whose reply was marked: ${data.interestedLabels.join(", ")}.`}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </span>
                    <span className="flex items-baseline gap-2 shrink-0">
                      {muted ? (
                        <span className="text-xs text-gray-400">Not set up</span>
                      ) : (
                        <>
                          <span className="text-lg font-bold tabular-nums text-gray-900">{step.value.toLocaleString()}</span>
                          <span className="text-xs text-gray-500 tabular-nums w-10 text-right">{share}%</span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${muted ? "bg-gray-200" : step.color} rounded-full transition-all`} style={{ width: `${muted ? 0 : Math.min(100, share)}%` }} />
                  </div>
                  {step.prev && !muted && (
                    <div className="text-[11px] text-gray-400 mt-0.5">{stepRate}% of {step.prev.label}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
