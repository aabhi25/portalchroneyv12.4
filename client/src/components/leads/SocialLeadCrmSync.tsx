// CRM sync status + Sync / Sync all controls for the Instagram and Facebook Leads pages.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CRM_LABEL, CrmStatusIcon, canResync, type CrmConfig, type CrmSyncState, type SocialCrm } from "./UnifiedLeadParts";

type SocialChannel = "instagram" | "facebook";

/** The CRM columns an instagram_leads / facebook_leads row carries. */
export interface SocialLeadCrmFields {
  id: string;
  leadsquaredSyncStatus?: string | null;
  leadsquaredSyncError?: string | null;
  leadsquaredSyncedAt?: string | null;
  leadsquaredLeadId?: string | null;
  salesforceSyncStatus?: string | null;
  salesforceSyncError?: string | null;
  salesforceSyncedAt?: string | null;
  salesforceLeadId?: string | null;
  customCrmSyncStatus?: string | null;
  customCrmSyncError?: string | null;
  customCrmSyncedAt?: string | null;
  customCrmLeadId?: string | null;
}

function stateOf(lead: SocialLeadCrmFields, crm: SocialCrm): CrmSyncState {
  if (crm === "leadsquared") return { status: lead.leadsquaredSyncStatus ?? null, error: lead.leadsquaredSyncError ?? null, syncedAt: lead.leadsquaredSyncedAt ?? null, crmLeadId: lead.leadsquaredLeadId ?? null };
  if (crm === "salesforce") return { status: lead.salesforceSyncStatus ?? null, error: lead.salesforceSyncError ?? null, syncedAt: lead.salesforceSyncedAt ?? null, crmLeadId: lead.salesforceLeadId ?? null };
  return { status: lead.customCrmSyncStatus ?? null, error: lead.customCrmSyncError ?? null, syncedAt: lead.customCrmSyncedAt ?? null, crmLeadId: lead.customCrmLeadId ?? null };
}

export function useSocialCrmConfig() {
  const { data } = useQuery<CrmConfig | null>({
    queryKey: ["/api/social-leads/crm-config"],
    queryFn: async () => {
      const res = await fetch("/api/social-leads/crm-config", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });
  const configured: SocialCrm[] = data ? (Object.keys(data) as SocialCrm[]).filter(c => data[c].configured) : [];
  return { config: data, configured };
}

/** Status icons for each configured CRM plus a Sync / Retry button. */
export function SocialLeadCrmCell({ channel, lead, configured }: { channel: SocialChannel; lead: SocialLeadCrmFields; configured: SocialCrm[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sync = useMutation({
    mutationFn: () => apiRequest("POST", `/api/social-leads/${channel}/${lead.id}/sync`, {}),
    onSuccess: (res: any) => toast({ title: "Sync complete", description: res?.message }),
    onError: (err: any) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/${channel}/leads`] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"], exact: false });
    },
  });
  if (configured.length === 0) return <span className="text-gray-300 text-xs">—</span>;
  const needsSync = configured.some(c => canResync(stateOf(lead, c)));
  return (
    <div className="flex items-center gap-1.5">
      {configured.map(c => <CrmStatusIcon key={c} label={CRM_LABEL[c]} state={stateOf(lead, c)} />)}
      {needsSync && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full"
          title="Sync to CRM"
          aria-label="Sync to CRM"
          disabled={sync.isPending}
          onClick={(e) => { e.stopPropagation(); sync.mutate(); }}
        >
          {sync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 text-blue-600" />}
        </Button>
      )}
    </div>
  );
}

export function SocialSyncAllButton({ channel, configured }: { channel: SocialChannel; configured: SocialCrm[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const syncAll = useMutation({
    mutationFn: () => apiRequest("POST", `/api/social-leads/${channel}/sync-all`, {}),
    onSuccess: (res: any) => toast({ title: "Sync complete", description: res?.message }),
    onError: (err: any) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/${channel}/leads`] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"], exact: false });
    },
  });
  if (configured.length === 0) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="border-green-500 text-green-600 hover:bg-green-50"
      disabled={syncAll.isPending}
      onClick={() => syncAll.mutate()}
      title={`Send unsynced leads to ${configured.map(c => CRM_LABEL[c]).join(", ")}`}
    >
      {syncAll.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
      Sync all to CRM
    </Button>
  );
}
