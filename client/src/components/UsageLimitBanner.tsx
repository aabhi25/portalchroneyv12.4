import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle } from "lucide-react";
import { formatUsd, type UsageLimit } from "@/components/usage/usageFormat";

interface LimitStatusResponse {
  spentUsd?: number;
  limit: UsageLimit | null;
}

/**
 * In-app banner when the active account is over its monthly AI warning threshold
 * or limit. Shown to the account's users and to super admins viewing as it.
 */
export function UsageLimitBanner() {
  const [, setLocation] = useLocation();
  const { data } = useQuery<LimitStatusResponse>({
    queryKey: ["/api/usage/limit-status"],
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: false,
  });
  const limit = data?.limit;
  if (!limit || limit.level === "ok") return null;
  const exceeded = limit.level === "exceeded";
  const text = exceeded
    ? limit.action === "block"
      ? "Monthly AI limit reached — AI replies are paused until next month or until the limit is raised."
      : "Monthly AI limit reached."
    : `${limit.percentUsed.toFixed(0)}% of this month's AI limit used.`;
  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 text-sm border-b ${exceeded ? "bg-red-50 text-red-800 border-red-200" : "bg-amber-50 text-amber-900 border-amber-200"}`}
      data-testid="banner-usage-limit"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        {text} <span className="opacity-80">({formatUsd(data?.spentUsd ?? 0)} of {formatUsd(limit.monthlyLimitUsd)})</span>
      </span>
      <button type="button" className="underline font-medium" onClick={() => setLocation("/admin/usage")}>View usage</button>
    </div>
  );
}
