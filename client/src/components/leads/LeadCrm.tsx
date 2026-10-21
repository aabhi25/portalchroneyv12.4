import { Loader2, RefreshCw } from "lucide-react";
import { formatCrmSyncError } from "@/lib/crmSyncError";
import type { CrmSyncState, SocialCrm } from "./UnifiedLeadParts";

/** One CRM a lead can be sent to, with its state and whether a manual sync is possible now. */
export interface CrmTarget {
  crm: SocialCrm;
  label: string;
  state?: CrmSyncState | null;
  canSync: boolean;
}

export const CRM_SHORT: Record<SocialCrm, string> = { leadsquared: "LSQ", salesforce: "SF", custom_crm: "CRM", meritto: "MER" };

/** Plain words and colour for a sync status. */
export function crmStatusLook(status: string | null | undefined): { text: string; className: string } {
  switch (status) {
    case "synced": return { text: "Synced", className: "bg-green-50 text-green-700" };
    case "pending": return { text: "Syncing", className: "bg-gray-100 text-gray-600" };
    case "waiting": return { text: "Waiting", className: "bg-gray-100 text-gray-600" };
    case "disqualified": return { text: "Not qualified", className: "bg-amber-50 text-amber-700" };
    case "needs_attention": return { text: "Needs a look", className: "bg-amber-50 text-amber-700" };
    case "failed":
    case "permanently_failed": return { text: "Failed", className: "bg-red-50 text-red-700" };
    default: return { text: "Not synced", className: "bg-gray-100 text-gray-500" };
  }
}

export function crmStatusTitle(t: CrmTarget): string {
  const status = t.state?.status;
  if (status === "synced") return `Sent to ${t.label}`;
  if (status === "pending") return `${t.label}: sending now`;
  if (status === "waiting") return `${t.label}: waiting until the lead is ready (mobile or email, required details, verification)`;
  if (status === "disqualified") return `Not sent to ${t.label}: ${t.state?.error || "the answer did not match the qualifying values"}`;
  if (status === "failed") return `${t.label} (retrying automatically): ${formatCrmSyncError(t.state?.error)}`;
  if (status === "permanently_failed") return `${t.label} (gave up retrying): ${formatCrmSyncError(t.state?.error)}`;
  if (status === "needs_attention") return `${t.label} needs a look (not retried automatically): ${formatCrmSyncError(t.state?.error)}`;
  return `Not sent to ${t.label} yet`;
}

/** Button text for a manual sync. */
export function syncButtonLabel(t: CrmTarget): string {
  return t.state?.status && t.state.status !== "pending" ? "Retry" : "Sync now";
}

/**
 * The CRM column of the leads list: one line per CRM with its status, and a Sync now / Retry
 * button right there when the lead can be sent (no need to open a menu).
 */
export function LeadCrmCell({ targets, isSyncing, onSync }: {
  targets: CrmTarget[];
  isSyncing: (crm: SocialCrm) => boolean;
  onSync: (crm: SocialCrm) => void;
}) {
  if (targets.length === 0) return <span className="text-xs text-gray-300" title="No CRM connected">—</span>;
  return (
    <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
      {targets.map(t => {
        const look = crmStatusLook(t.state?.status);
        const syncing = isSyncing(t.crm);
        return (
          <div key={t.crm} className="flex items-center gap-1.5 whitespace-nowrap">
            <span
              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${look.className}`}
              title={crmStatusTitle(t)}
              data-testid={`crm-status-${t.crm}`}
            >
              {CRM_SHORT[t.crm]} · {syncing ? "Sending…" : look.text}
            </span>
            {t.canSync && (
              <button
                type="button"
                onClick={() => onSync(t.crm)}
                disabled={syncing}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                aria-label={`${syncButtonLabel(t)}: send to ${t.label}`}
                data-testid={`button-crm-sync-${t.crm}`}
              >
                {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {syncButtonLabel(t)}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
