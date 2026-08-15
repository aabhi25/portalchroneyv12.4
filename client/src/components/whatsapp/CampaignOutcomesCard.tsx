import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Tags, PhoneCall, HelpCircle, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface OutcomeRow {
  key: string;
  label: string;
  count: number;
  orphaned: boolean;
}

export interface OutcomeSummary {
  campaignId: string;
  configured: boolean;
  totalRecipients: number;
  replied: number;
  classified: number;
  unclassifiedReplies: number;
  callbacksPending: number;
  rows: OutcomeRow[];
}

/**
 * Campaign outcomes panel.
 *
 * Every row here is defined by the campaign's own classification config — this
 * component knows nothing about loans, RSVPs or appointments. Clicking a row
 * asks the parent to filter the recipient list to that outcome.
 */
export function CampaignOutcomesCard({
  campaignId,
  isLive,
  activeClassification,
  onSelectClassification,
}: {
  campaignId: string;
  /** Poll while the campaign is actively sending or receiving replies. */
  isLive?: boolean;
  activeClassification?: string | null;
  onSelectClassification?: (key: string | null) => void;
}) {
  const { data, isLoading } = useQuery<OutcomeSummary>({
    queryKey: [`/api/whatsapp/campaigns/${campaignId}/outcomes`],
    queryFn: () => apiRequest<OutcomeSummary>("GET", `/api/whatsapp/campaigns/${campaignId}/outcomes`),
    refetchInterval: isLive ? 15000 : false,
  });

  // A campaign with no classification config isn't broken — it's a plain
  // broadcast. Say so rather than showing a card full of zeroes.
  if (!isLoading && data && !data.configured) {
    return (
      <Card data-testid="card-outcomes-unconfigured">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Tags className="h-4 w-4 text-violet-600" /> Reply outcomes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            This campaign doesn't classify replies. Add outcome categories in the campaign settings to
            track what customers actually said.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(1, ...(data?.rows || []).map(r => r.count));

  return (
    <Card data-testid="card-outcomes">
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Tags className="h-4 w-4 text-violet-600" /> Reply outcomes
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          asChild
          data-testid="button-export-outcomes"
        >
          <a href={`/api/whatsapp/campaigns/${campaignId}/outcomes.csv`} download>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
          </a>
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-gray-400 py-4 text-center">Loading outcomes…</div>
        ) : !data ? (
          <div className="text-sm text-gray-400 py-4 text-center">Couldn't load outcomes.</div>
        ) : (
          <>
            {/* Universal tiles — meaningful in every vertical */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => onSelectClassification?.(null)}
                className={`text-left rounded-lg border p-2.5 transition-colors ${
                  activeClassification === null || activeClassification === undefined
                    ? "border-violet-300 bg-violet-50"
                    : "hover:bg-gray-50"
                }`}
                data-testid="tile-replied"
              >
                <div className="text-xs text-gray-500">Replied</div>
                <div className="text-xl font-bold text-blue-600">{data.replied}</div>
              </button>

              <div className="rounded-lg border p-2.5" data-testid="tile-callbacks">
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  <PhoneCall className="h-3 w-3" /> Callbacks
                </div>
                <div className="text-xl font-bold text-amber-600">{data.callbacksPending}</div>
              </div>

              <div className="rounded-lg border p-2.5" data-testid="tile-unclassified">
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  <HelpCircle className="h-3 w-3" /> Unclassified
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help text-gray-400">?</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        Recipients who replied but whose message didn't match any category — often
                        greetings or acknowledgements.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="text-xl font-bold text-gray-500">{data.unclassifiedReplies}</div>
              </div>
            </div>

            {/* Per-category breakdown, driven entirely by campaign config */}
            {data.rows.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-3">No categories configured.</div>
            ) : (
              <div className="space-y-1">
                {data.rows.map(row => {
                  const isActive = activeClassification === row.key;
                  const pct = data.replied > 0 ? Math.round((row.count / data.replied) * 100) : 0;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => onSelectClassification?.(isActive ? null : row.key)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                        isActive ? "border-violet-300 bg-violet-50" : "border-transparent hover:bg-gray-50"
                      }`}
                      data-testid={`row-outcome-${row.key}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-gray-700 truncate flex items-center gap-1.5">
                          {row.label}
                          {row.orphaned && (
                            <TooltipProvider delayDuration={100}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs text-xs">
                                  Recorded under a category that's no longer in this campaign's
                                  settings. Kept so the totals still add up.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-gray-400">{pct}%</span>
                          <Badge variant="secondary" className="tabular-nums">{row.count}</Badge>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-violet-400 rounded-full transition-all"
                          style={{ width: `${(row.count / maxCount) * 100}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
