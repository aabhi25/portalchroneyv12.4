import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Coins, Loader2, MessageSquare, Sparkles, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CHANNEL_COLORS,
  CHANNEL_LABELS,
  currentIstMonth,
  formatInr,
  formatPercentChange,
  formatTokens,
  formatUsd,
  monthLabel,
  recentMonths,
  type UsageChannel,
  type UsageLimit,
} from "./usageFormat";

export interface AccountMonthUsage {
  businessAccountId: string;
  businessName?: string;
  month: string;
  timezone: string;
  isCurrentMonth: boolean;
  daysElapsed: number;
  daysInMonth: number;
  usdInrRate: number;
  totals: { costUsd: number; costInr: number; tokensInput: number; tokensOutput: number; tokens: number; aiCalls: number; aiReplies: number };
  byChannel: Array<{ channel: UsageChannel; label: string; costUsd: number; tokens: number; aiCalls: number; aiReplies: number }>;
  daily: Array<{ date: string; costUsd: number; tokens: number; aiCalls: number; aiReplies: number; byChannel: Partial<Record<UsageChannel, number>> }>;
  previousMonth: { month: string; costUsd: number; tokens: number; aiReplies: number; sameDaysCostUsd: number };
  changePercent: number | null;
  projectedCostUsd: number | null;
  limit: UsageLimit | null;
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="w-4 h-4" />
          {label}
        </div>
        <div className="mt-2 text-2xl font-semibold text-gray-900 tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function LimitProgress({ limit, spentUsd, rate }: { limit: UsageLimit; spentUsd: number; rate: number }) {
  const pct = Math.min(limit.percentUsed, 100);
  const barColor = limit.level === "exceeded" ? "[&>div]:bg-red-600" : limit.level === "warn" ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-600";
  return (
    <Card data-testid="card-usage-limit">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="w-4 h-4" /> Monthly AI limit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="tabular-nums">
            <span className="font-semibold">{formatUsd(spentUsd)}</span> of {formatUsd(limit.monthlyLimitUsd)}{" "}
            <span className="text-muted-foreground">({formatInr(limit.monthlyLimitUsd, rate)})</span>
          </span>
          <span className="font-medium tabular-nums">{limit.percentUsed.toFixed(0)}%</span>
        </div>
        <Progress value={pct} className={`h-2.5 ${barColor}`} />
        <p className="text-xs text-muted-foreground">
          Warning at {limit.warnAtPercent}%.{" "}
          {limit.action === "block"
            ? "When the limit is reached, AI replies pause until next month (or until the limit is raised)."
            : "Reaching the limit shows a warning; AI replies keep working."}
        </p>
        {limit.level !== "ok" && (
          <div className={`flex items-start gap-2 rounded-md p-2 text-sm ${limit.level === "exceeded" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}>
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {limit.level === "exceeded"
              ? limit.action === "block"
                ? "Monthly AI limit reached — AI replies are paused."
                : "Monthly AI limit reached."
              : `Over ${limit.warnAtPercent}% of the monthly AI limit used.`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** One account's AI usage for a month. `businessAccountId` is omitted for the user's own/active account. */
export function UsageDashboard({ businessAccountId }: { businessAccountId?: string }) {
  const [month, setMonth] = useState(currentIstMonth());
  const months = recentMonths(12);

  const { data, isLoading, isError, error } = useQuery<AccountMonthUsage>({
    queryKey: ["/api/usage/summary", businessAccountId ?? "active", month],
    queryFn: async () => {
      const params = new URLSearchParams({ month });
      if (businessAccountId) params.set("businessAccountId", businessAccountId);
      const res = await fetch(`/api/usage/summary?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load usage");
      return res.json();
    },
    staleTime: 60_000,
  });

  const rate = data?.usdInrRate ?? 84;
  const chartData = (data?.daily ?? []).map((d) => ({ day: Number(d.date.slice(8, 10)), ...d.byChannel }));
  const chartChannels = (data?.byChannel ?? []).map((c) => c.channel);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI usage & spend</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.businessName ? `${data.businessName} · ` : ""}Months follow India time (IST). ₹ amounts are approximate (1 USD ≈ ₹{rate}).
          </p>
        </div>
        <div className="w-full sm:w-56">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger data-testid="select-usage-month"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading usage…
        </div>
      )}
      {isError && <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{(error as Error)?.message || "Failed to load usage"}</div>}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Coins}
              label={data.isCurrentMonth ? "Spend this month" : `Spend in ${monthLabel(data.month)}`}
              value={formatUsd(data.totals.costUsd)}
              sub={<>{formatInr(data.totals.costUsd, rate)}{data.projectedCostUsd !== null && <> · on track for {formatUsd(data.projectedCostUsd)}</>}</>}
            />
            <StatCard
              icon={data.changePercent !== null && data.changePercent < 0 ? ArrowDownRight : ArrowUpRight}
              label="vs last month"
              value={formatPercentChange(data.changePercent)}
              sub={<>First {Math.min(data.daysElapsed, 31)} days of {monthLabel(data.previousMonth.month)}: {formatUsd(data.previousMonth.sameDaysCostUsd)} · full month {formatUsd(data.previousMonth.costUsd)}</>}
            />
            <StatCard icon={MessageSquare} label="AI replies" value={data.totals.aiReplies.toLocaleString()} sub={<>{data.totals.aiCalls.toLocaleString()} AI calls in total</>} />
            <StatCard
              icon={Sparkles}
              label="Tokens"
              value={formatTokens(data.totals.tokens)}
              sub={<>{formatTokens(data.totals.tokensInput)} in · {formatTokens(data.totals.tokensOutput)} out</>}
            />
          </div>

          {data.limit && <LimitProgress limit={data.limit} spentUsd={data.totals.costUsd} rate={rate} />}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Daily spend (USD)</CardTitle></CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No days to show for this month yet.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} tickFormatter={(v: number) => `$${v < 1 ? v.toFixed(2) : v.toFixed(0)}`} />
                      <Tooltip
                        formatter={(v: number, name: string) => [formatUsd(v), CHANNEL_LABELS[name as UsageChannel] ?? name]}
                        labelFormatter={(d) => `${monthLabel(data.month).split(" ")[0]} ${d}`}
                      />
                      {chartChannels.map((c) => (
                        <Bar key={c} dataKey={c} stackId="spend" fill={CHANNEL_COLORS[c]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">By channel</CardTitle></CardHeader>
            <CardContent>
              {data.byChannel.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No AI usage recorded for this month.</p>
              ) : (
                <div className="space-y-3">
                  {data.byChannel.map((c) => {
                    const share = data.totals.costUsd > 0 ? (c.costUsd / data.totals.costUsd) * 100 : 0;
                    return (
                      <div key={c.channel} data-testid={`usage-channel-${c.channel}`}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHANNEL_COLORS[c.channel] }} />
                            {c.label}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            <span className="font-medium text-gray-900">{formatUsd(c.costUsd)}</span>
                            {" · "}{formatTokens(c.tokens)} tokens
                            {c.aiReplies > 0 && <> · {c.aiReplies.toLocaleString()} replies</>}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded bg-gray-100 overflow-hidden">
                          <div className="h-full rounded" style={{ width: `${share}%`, background: CHANNEL_COLORS[c.channel] }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
