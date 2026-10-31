import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { AGENCY_FEATURES, type AgencyFeatureKey } from "@shared/agency";

/** Shared pieces of the agency pages (super admin side and the agency's own portal). */

export function Panel({ title, subtitle, actions, children, className = "" }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-black/[0.06] bg-white p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[16px] font-semibold text-gray-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-gray-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-gray-500">{hint}</p>}
    </div>
  );
}

/** "$12.40 (≈ ₹1,042)" — AI costs are recorded in USD; INR agencies also see rupees. */
export function formatUsd(usd: number | null | undefined, usdInrRate?: number, currency?: string): string {
  if (usd === null || usd === undefined) return "—";
  const dollars = `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
  if (currency === "INR" && usdInrRate) return `${dollars} (≈ ₹${Math.round(usd * usdInrRate).toLocaleString("en-IN")})`;
  return dollars;
}

export function formatMoney(amount: number, currency: string): string {
  return currency === "INR"
    ? `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The current IST month and the 11 before it, newest first ("YYYY-MM"). */
export function recentMonths(current: string, count = 12): string[] {
  const [y, m] = current.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function StatusPill({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
      {active ? "Active" : "Paused"}
    </span>
  );
}

/** A usage bar: grey under the warning line, amber after it, red at 100%. */
export function UsageBar({ percent, warnAt = 80 }: { percent: number | null; warnAt?: number }) {
  if (percent === null) return null;
  const p = Math.max(0, Math.min(100, percent));
  const tone = percent >= 100 ? "bg-red-500" : percent >= warnAt ? "bg-amber-500" : "bg-gray-900";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100" aria-label={`${percent}% used`}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${p}%` }} />
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] text-gray-500">{label}</p>
        <p className="truncate font-mono text-[14px] text-gray-900 select-all">{value}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

/** Shows a new login's temporary password once. */
export function CredentialsDialog({ credentials, title, onClose }: {
  credentials: { username: string; tempPassword: string } | null;
  title: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!credentials} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Share these with the person who will log in. They'll choose their own password the first time. The temporary password works for 30 days and isn't shown again.
          </DialogDescription>
        </DialogHeader>
        {credentials && (
          <div className="space-y-2">
            <CopyRow label="Login (email)" value={credentials.username} />
            <CopyRow label="Temporary password" value={credentials.tempPassword} />
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** On/off list of features. `only` limits the list (e.g. what an agency may resell). */
export function FeatureSwitches({ value, onChange, only, disabled, testIdPrefix = "feature" }: {
  value: Partial<Record<AgencyFeatureKey, boolean>>;
  onChange: (key: AgencyFeatureKey, on: boolean) => void;
  only?: AgencyFeatureKey[];
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  const list = only ? AGENCY_FEATURES.filter(f => only.includes(f.key)) : AGENCY_FEATURES;
  if (list.length === 0) return <p className="text-[13px] text-gray-500">No features to show.</p>;
  return (
    <div className="divide-y divide-black/[0.05]">
      {list.map(f => (
        <label key={f.key} className="flex cursor-pointer items-center justify-between gap-4 py-2.5">
          <span className="min-w-0">
            <span className="block text-[14px] text-gray-900">{f.label}</span>
            <span className="block text-[12px] text-gray-500">{f.hint}</span>
          </span>
          <Switch
            checked={!!value[f.key]}
            disabled={disabled}
            onCheckedChange={(on) => onChange(f.key, on)}
            data-testid={`${testIdPrefix}-${f.key}`}
          />
        </label>
      ))}
    </div>
  );
}
