export type UsageChannel = "website" | "whatsapp" | "instagram" | "facebook" | "voice" | "training" | "other";

export const CHANNEL_COLORS: Record<UsageChannel, string> = {
  website: "#6366f1",
  whatsapp: "#16a34a",
  instagram: "#db2777",
  facebook: "#2563eb",
  voice: "#f59e0b",
  training: "#8b5cf6",
  other: "#94a3b8",
};

export const CHANNEL_LABELS: Record<UsageChannel, string> = {
  website: "Website chat",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  voice: "Voice",
  training: "Documents & training",
  other: "Other",
};

export type LimitLevel = "ok" | "warn" | "exceeded";

export interface UsageLimit {
  monthlyLimitUsd: number;
  warnAtPercent: number;
  action: "warn" | "block";
  percentUsed: number;
  level: LimitLevel;
}

export function formatUsd(v: number): string {
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Approximate ₹ amount (the rate comes from the server's USD_INR_RATE). */
export function formatInr(usd: number, rate: number): string {
  const inr = usd * rate;
  return `≈ ₹${inr.toLocaleString("en-IN", { maximumFractionDigits: inr < 100 ? 2 : 0 })}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function formatPercentChange(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(0)}%`;
}

/** Current month "YYYY-MM" in IST (Asia/Kolkata), matching the server. */
export function currentIstMonth(): string {
  const d = new Date(Date.now() + 330 * 60_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last `count` IST months, newest first, as { value: "YYYY-MM", label: "September 2026" }. */
export function recentMonths(count = 12): Array<{ value: string; label: string }> {
  const [y, m] = currentIstMonth().split("-").map(Number);
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push({
      value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
  }
  return out;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
