import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Timer, AlertCircle, FileText, Pencil } from "lucide-react";
import {
  DataRetentionDialog,
  RetentionReportDialog,
  formatMinutes,
  type AccountRetention,
} from "@/components/DataRetentionDialog";
import type { MeResponseDto } from "@shared/dto";

/**
 * Data retention (auto-delete) for the current / viewed-as business account.
 *
 * Business users see the effective policy read-only — the policy is set by AI Chroney
 * (super admin), either on the account or on its account group. A super admin viewing the
 * account can open the existing policy editor and monthly report.
 */
export default function DataRetentionSettings({ user }: { user: MeResponseDto | null }) {
  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const isSuperAdminImpersonating = user?.role === "super_admin" && !!user?.activeBusinessAccountId;
  const accountId = user?.activeBusinessAccountId || user?.businessAccountId || "";
  const accountName = user?.businessAccount?.name || "This account";

  const { data, isLoading, isError, refetch } = useQuery<{ policy: AccountRetention["policy"] | null; crm: AccountRetention["crm"] }>({
    queryKey: ["/api/data-retention/effective"],
    queryFn: async () => {
      const res = await fetch("/api/data-retention/effective", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the data retention policy");
      return res.json();
    },
    staleTime: 0,
  });

  const policy = data?.policy ?? null;
  const active = !!policy && policy.mode !== "off";

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="shadow-lg border-gray-200">
        <CardHeader className="border-b bg-gradient-to-r from-emerald-50 to-teal-50 py-4">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Auto-delete policy
          </CardTitle>
          <CardDescription className="mt-1">
            How long leads and chats are kept before they are deleted automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> We couldn't load the data retention policy.</span>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
            </div>
          ) : !active ? (
            <p className="text-sm text-muted-foreground" data-testid="text-retention-off">
              Auto-delete is off. Leads and conversations are kept until you delete them.
            </p>
          ) : (
            <div className="space-y-4" data-testid="retention-policy-summary">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={policy!.mode === "live" ? "bg-orange-500" : "bg-amber-500"}>
                  {policy!.mode === "live" ? "On" : "Dry run"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {policy!.source === "group" ? "Set for your account group" : "Set for this account"}
                  {policy!.mode === "dry_run" && " · nothing is deleted yet"}
                </span>
              </div>
              <dl className="grid gap-3 sm:grid-cols-3 text-sm">
                <div className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground flex items-center gap-1"><Timer className="w-3 h-3" /> Leads synced to a CRM</dt>
                  <dd className="font-medium mt-1">Deleted after {formatMinutes(policy!.deleteSyncedAfterMinutes)}</dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground flex items-center gap-1"><Timer className="w-3 h-3" /> Leads never synced</dt>
                  <dd className="font-medium mt-1">
                    {policy!.deleteUnsyncedAfterMinutes === null ? "Kept" : `Deleted after ${formatMinutes(policy!.deleteUnsyncedAfterMinutes)}`}
                  </dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground flex items-center gap-1"><Timer className="w-3 h-3" /> Chats with no lead</dt>
                  <dd className="font-medium mt-1">
                    {policy!.deleteIdleChatsAfterMinutes === null ? "Kept" : `Deleted after ${formatMinutes(policy!.deleteIdleChatsAfterMinutes)}`}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {!isSuperAdminImpersonating && !isLoading && !isError && (
            <p className="text-xs text-muted-foreground mt-4">
              This policy is managed by your AI Chroney administrator.
            </p>
          )}

          {isSuperAdminImpersonating && accountId && (
            <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid="button-edit-retention">
                <Pencil className="w-4 h-4 mr-1.5" /> Edit auto-delete policy
              </Button>
              <Button variant="outline" size="sm" onClick={() => setReportOpen(true)} data-testid="button-retention-report">
                <FileText className="w-4 h-4 mr-1.5" /> Retention report
              </Button>
              <span className="text-xs text-muted-foreground self-center">Only visible to super admins.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {isSuperAdminImpersonating && accountId && (
        <>
          <DataRetentionDialog
            open={editOpen}
            onOpenChange={(open) => {
              setEditOpen(open);
              if (!open) refetch();
            }}
            scopeType="account"
            scopeId={accountId}
            scopeName={accountName}
          />
          <RetentionReportDialog
            open={reportOpen}
            onOpenChange={setReportOpen}
            baseUrl={`/api/super-admin/data-retention/report?scopeType=account&scopeId=${encodeURIComponent(accountId)}`}
            title={accountName}
          />
        </>
      )}
    </div>
  );
}
