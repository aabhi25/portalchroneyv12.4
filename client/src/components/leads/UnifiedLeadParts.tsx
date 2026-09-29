import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock, Globe, Instagram, Facebook, MessageCircle, XCircle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCrmSyncError } from "@/lib/crmSyncError";

export type LeadChannel = "website" | "whatsapp" | "instagram" | "facebook";
export type ChannelFilter = LeadChannel | "all";
export type SocialCrm = "leadsquared" | "salesforce" | "custom_crm";

export interface CrmSyncState {
  status: string | null;
  error: string | null;
  syncedAt: string | null;
  crmLeadId: string | null;
}

/** One row of GET /api/leads/unified. */
export interface UnifiedLeadRow {
  key: string;
  channel: LeadChannel;
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  capturedAt: string;
  crm: { leadsquared?: CrmSyncState; salesforce?: CrmSyncState; customCrm?: CrmSyncState };
  detail: Record<string, any>;
}

export interface UnifiedLeadsResponse {
  leads: UnifiedLeadRow[];
  total: number;
  countsByChannel: Record<LeadChannel, number>;
  channels: LeadChannel[];
}

export type CrmConfig = Record<SocialCrm, { configured: boolean; autoSync: boolean }>;

export const CHANNEL_META: Record<LeadChannel, { label: string; className: string; icon: typeof Globe; page: string | null }> = {
  website: { label: "Website", className: "bg-purple-100 text-purple-700", icon: Globe, page: null },
  whatsapp: { label: "WhatsApp", className: "bg-green-100 text-green-700", icon: MessageCircle, page: "/admin/whatsapp-leads" },
  instagram: { label: "Instagram", className: "bg-pink-100 text-pink-700", icon: Instagram, page: "/admin/instagram-leads" },
  facebook: { label: "Facebook", className: "bg-blue-100 text-blue-700", icon: Facebook, page: "/admin/facebook-leads" },
};

export const CRM_LABEL: Record<SocialCrm, string> = { leadsquared: "LeadSquared", salesforce: "Salesforce", custom_crm: "Custom CRM" };

export function ChannelBadge({ channel }: { channel: LeadChannel }) {
  const meta = CHANNEL_META[channel];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${meta.className}`} data-testid={`badge-channel-${channel}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

/** Small icon for one CRM's sync state, with the reason in the tooltip. */
export function CrmStatusIcon({ label, state }: { label: string; state?: CrmSyncState | null }) {
  const status = state?.status;
  if (status === "synced") return <div className="text-green-600" title={`Synced to ${label}`}><CheckCircle2 className="h-3.5 w-3.5" /></div>;
  if (status === "pending") return <div className="text-gray-400 cursor-help" title={`${label} sync in progress`}><Clock className="h-3.5 w-3.5" /></div>;
  if (status === "needs_attention") {
    return <div className="text-amber-600 cursor-help" title={`${label} — needs attention (not retried automatically): ${formatCrmSyncError(state?.error)}`}><AlertTriangle className="h-3.5 w-3.5" /></div>;
  }
  if (status === "failed" || status === "permanently_failed") {
    return <div className="text-red-600 cursor-help" title={`${label}: ${formatCrmSyncError(state?.error)}`}><XCircle className="h-3.5 w-3.5" /></div>;
  }
  return <span className="text-gray-300 text-xs" title={`Not sent to ${label}`}>—</span>;
}

export function canResync(state?: CrmSyncState | null): boolean {
  return !state || (state.status !== "synced" && state.status !== "pending");
}

function StateLine({ label, state }: { label: string; state?: CrmSyncState }) {
  if (!state) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-gray-500 w-28">{label}:</span>
        {state.status === "synced" ? (
          <Badge className="bg-green-100 text-green-700">Synced</Badge>
        ) : state.status === "pending" ? (
          <Badge className="bg-gray-100 text-gray-600">In progress</Badge>
        ) : state.status ? (
          <Badge className="bg-red-100 text-red-700">{state.status.replace(/_/g, " ")}</Badge>
        ) : (
          <Badge className="bg-gray-100 text-gray-600">Not synced</Badge>
        )}
        {state.syncedAt && <span className="text-xs text-gray-400">{format(new Date(state.syncedAt), "PPp")}</span>}
      </div>
      {state.crmLeadId && <code className="ml-28 text-xs bg-gray-100 px-2 py-0.5 rounded font-mono w-fit">{state.crmLeadId}</code>}
      {state.error && state.status !== "synced" && <p className="ml-28 text-xs text-red-600 bg-red-50 rounded p-2">{formatCrmSyncError(state.error)}</p>}
    </div>
  );
}

/** Detail view for a WhatsApp / Instagram / Facebook row of the unified list. */
export function ChannelLeadDetailsDialog({
  row,
  open,
  onOpenChange,
  onOpenChannelPage,
}: {
  row: UnifiedLeadRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChannelPage: (path: string) => void;
}) {
  const extracted: Record<string, any> = (row?.detail?.extractedData as Record<string, any>) || {};
  const extractedEntries = Object.entries(extracted).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "" && typeof v !== "object");
  const meta = row ? CHANNEL_META[row.channel] : null;
  const sender = row?.detail?.senderUsername ? `@${row.detail.senderUsername}` : row?.detail?.senderName || row?.detail?.senderPhone || row?.detail?.senderId;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[75vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-600" />
            Lead Details
            {row && <ChannelBadge channel={row.channel} />}
          </DialogTitle>
          <DialogDescription>Captured {row ? format(new Date(row.capturedAt), "PPpp") : ""}</DialogDescription>
        </DialogHeader>
        {row && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Name:</span><p className="font-medium">{row.name || "—"}</p></div>
              <div><span className="text-gray-500">Email:</span><p className="font-medium break-all">{row.email || "—"}</p></div>
              <div><span className="text-gray-500">Phone:</span><p className="font-medium font-mono">{row.phone || "—"}</p></div>
              <div><span className="text-gray-500">From:</span><p className="font-medium break-all">{sender || "—"}</p></div>
            </div>
            {extractedEntries.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">Captured Fields</h4>
                <div className="bg-gray-50 rounded-md p-3 space-y-1.5">
                  {extractedEntries.map(([k, v]) => (
                    <div key={k} className="flex text-xs">
                      <span className="text-gray-600 font-mono min-w-[140px] flex-shrink-0">{k}:</span>
                      <span className="text-gray-800 break-all">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-700 border-b pb-1">CRM Sync</h4>
              <StateLine label="LeadSquared" state={row.crm.leadsquared} />
              <StateLine label="Salesforce" state={row.crm.salesforce} />
              <StateLine label="Custom CRM" state={row.crm.customCrm} />
            </div>
            {meta?.page && (
              <Button variant="outline" size="sm" onClick={() => onOpenChannelPage(meta.page!)}>
                Open {meta.label} Leads
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
