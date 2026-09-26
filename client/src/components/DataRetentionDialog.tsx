import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ShieldCheck, Timer, Download, AlertTriangle, Search } from "lucide-react";
import { format } from "date-fns";
import { decideLead, type AccountCrmTargets, type EffectiveRetentionPolicy, type RetentionMode, type RetentionPolicySettings } from "@shared/dataRetentionPolicy";

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

const PRESETS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 6 * 60, label: "6 hours" },
  { minutes: 24 * 60, label: "24 hours" },
  { minutes: 3 * 24 * 60, label: "3 days" },
  { minutes: 7 * 24 * 60, label: "7 days" },
  { minutes: 30 * 24 * 60, label: "30 days" },
];

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "Never";
  const preset = PRESETS.find(p => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} days`;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Preset list plus "Custom" (hours) and optionally "Never". */
function DurationSelect({ value, onChange, allowNever, id }: {
  value: number | null;
  onChange: (v: number | null) => void;
  allowNever?: boolean;
  id: string;
}) {
  const isPreset = value === null || PRESETS.some(p => p.minutes === value);
  const [custom, setCustom] = useState(!isPreset);
  const selectValue = custom ? "custom" : value === null ? "never" : String(value);
  return (
    <div className="flex gap-2">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === "custom") { setCustom(true); if (value === null) onChange(48 * 60); return; }
          setCustom(false);
          onChange(v === "never" ? null : Number(v));
        }}
      >
        <SelectTrigger id={id} className="flex-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          {allowNever && <SelectItem value="never">Never (keep)</SelectItem>}
          {PRESETS.map(p => <SelectItem key={p.minutes} value={String(p.minutes)}>{p.label}</SelectItem>)}
          <SelectItem value="custom">Custom…</SelectItem>
        </SelectContent>
      </Select>
      {custom && (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={1}
            className="w-24"
            value={value ? Math.round(value / 60) : ""}
            onChange={(e) => onChange(e.target.value ? Math.max(1, Number(e.target.value)) * 60 : null)}
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report (shared with the group-admin view)
// ---------------------------------------------------------------------------

interface ReportRow {
  businessAccountId: string;
  accountName: string;
  policyMode: string;
  capturedLeads: number;
  syncedLeads: number;
  deletedLeads: number;
  deletedConversations: number;
  leadsHeldNow: number;
  conversationsHeldNow: number;
  oldestLeadHeld: string | null;
  dueNow: number | null;
  lastRunAt: string | null;
}

const MODE_LABEL: Record<string, string> = { off: "Off", dry_run: "Dry run", live: "Live" };

/** `baseUrl` returns JSON by default and CSV with `format=csv`. */
export function RetentionReport({ baseUrl }: { baseUrl: string }) {
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const sep = baseUrl.includes("?") ? "&" : "?";
  const { data, isLoading, error } = useQuery<{ month: string; rows: ReportRow[] }>({
    queryKey: [baseUrl, "report", month],
    queryFn: () => apiRequest("GET", `${baseUrl}${sep}month=${month}`),
    staleTime: 0,
  });
  const totals = useMemo(() => (data?.rows || []).reduce((t, r) => ({
    captured: t.captured + r.capturedLeads,
    synced: t.synced + r.syncedLeads,
    deleted: t.deleted + r.deletedLeads,
    deletedConvs: t.deletedConvs + r.deletedConversations,
    held: t.held + r.leadsHeldNow,
  }), { captured: 0, synced: 0, deleted: 0, deletedConvs: 0, held: 0 }), [data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="retention-month" className="text-sm">Month</Label>
        <Input id="retention-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" />
        <Button variant="outline" size="sm" asChild className="ml-auto">
          <a href={`${baseUrl}${sep}month=${month}&format=csv`}>
            <Download className="w-4 h-4 mr-1.5" /> Download CSV
          </a>
        </Button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading report…</div>
      ) : error ? (
        <p className="text-sm text-red-600">{(error as Error).message}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
            {[
              ["Leads captured", totals.captured],
              ["Leads synced", totals.synced],
              ["Leads deleted", totals.deleted],
              ["Chats deleted", totals.deletedConvs],
              ["Leads held now", totals.held],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-md border bg-muted/30 px-2 py-2">
                <div className="text-lg font-semibold tabular-nums">{(n as number).toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <div className="max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-medium">Account</th>
                  <th className="px-2 py-1.5 font-medium">Auto-delete</th>
                  <th className="px-2 py-1.5 font-medium text-right">Captured</th>
                  <th className="px-2 py-1.5 font-medium text-right">Synced</th>
                  <th className="px-2 py-1.5 font-medium text-right">Deleted</th>
                  <th className="px-2 py-1.5 font-medium text-right">Held now</th>
                  <th className="px-2 py-1.5 font-medium">Oldest held</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).map(r => (
                  <tr key={r.businessAccountId} className="border-t">
                    <td className="px-2 py-1.5">{r.accountName}</td>
                    <td className="px-2 py-1.5">{MODE_LABEL[r.policyMode] || r.policyMode}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.capturedLeads}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.syncedLeads}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.deletedLeads}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.leadsHeldNow}</td>
                    <td className="px-2 py-1.5">{r.oldestLeadHeld ? format(new Date(r.oldestLeadHeld), "d MMM yyyy") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Months are in IST. Deletion records keep only IDs, dates and CRM IDs — no names, phone numbers, emails or messages.
          </p>
        </>
      )}
    </div>
  );
}

export function RetentionReportDialog({ open, onOpenChange, baseUrl, title }: { open: boolean; onOpenChange: (o: boolean) => void; baseUrl: string; title: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-600" /> Data retention report</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        {open && <RetentionReport baseUrl={baseUrl} />}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Super-admin settings dialog
// ---------------------------------------------------------------------------

interface PolicyRow extends RetentionPolicySettings { id: string; updatedAt: string }

interface PolicyResponse {
  policy: PolicyRow | null;
  defaults: RetentionPolicySettings;
  effective?: (RetentionPolicySettings & { source: 'account' | 'group' }) | null;
  status?: { lastRunAt: string; dueLeads: number; dueConversations: number; lastPurgedLeads: number; lastPurgedConversations: number; lastError: string | null; mode: string } | null;
  groups?: { groupId: string; name: string; policy: PolicyRow | null }[];
  memberCount?: number;
  overriddenAccounts?: number;
}

interface PreviewResponse {
  totalLeads: number;
  totalIdleChats: number;
  accounts: { businessAccountId: string; name: string; overridden: boolean; leads: number; idleChats: number; crm?: { leadsquared: boolean; salesforce: boolean } }[];
}

export function DataRetentionDialog({ open, onOpenChange, scopeType, scopeId, scopeName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeType: 'group' | 'account';
  scopeId: string;
  scopeName: string;
}) {
  const { toast } = useToast();
  const url = `/api/super-admin/data-retention/${scopeType}/${scopeId}`;
  const { data, isLoading } = useQuery<PolicyResponse>({
    queryKey: [url],
    queryFn: () => apiRequest("GET", url),
    enabled: open,
    staleTime: 0,
  });

  const [settings, setSettings] = useState<RetentionPolicySettings | null>(null);
  const [useGroupPolicy, setUseGroupPolicy] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (!data) return;
    const p = data.policy;
    setSettings(p ? {
      mode: p.mode as RetentionMode,
      deleteSyncedAfterMinutes: p.deleteSyncedAfterMinutes,
      deleteUnsyncedAfterMinutes: p.deleteUnsyncedAfterMinutes,
      deleteIdleChatsAfterMinutes: p.deleteIdleChatsAfterMinutes,
      keepAnonymousCounts: p.keepAnonymousCounts,
    } : data.defaults);
    setUseGroupPolicy(scopeType === 'account' && !p);
    setPreview(null);
  }, [data, scopeType]);

  useEffect(() => { if (!open) { setConfirmOpen(false); setConfirmText(""); } }, [open]);

  const previewMutation = useMutation({
    mutationFn: () => apiRequest<PreviewResponse>("POST", `${url}/preview`, settings),
    onSuccess: setPreview,
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async (confirmation?: string) => {
      if (scopeType === 'account' && useGroupPolicy) {
        return apiRequest("DELETE", `/api/super-admin/data-retention/account/${scopeId}`);
      }
      return apiRequest("PUT", url, { ...settings, confirmation });
    },
    onSuccess: () => {
      toast({ title: "Auto-delete settings saved", description: scopeType === 'account' && useGroupPolicy ? "This account now follows its group policy." : undefined });
      queryClient.invalidateQueries({ queryKey: [url] });
      setConfirmOpen(false);
      setConfirmText("");
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const wasLive = data?.policy?.mode === 'live';
  const goingLive = !useGroupPolicy && settings?.mode === 'live' && !wasLive;

  const handleSave = () => {
    if (goingLive) {
      setConfirmOpen(true);
      if (!preview) previewMutation.mutate();
      return;
    }
    saveMutation.mutate(undefined);
  };

  const set = <K extends keyof RetentionPolicySettings>(key: K, value: RetentionPolicySettings[K]) =>
    setSettings(s => (s ? { ...s, [key]: value } : s));

  const status = data?.status;

  return (
    <>
      <Dialog open={open && !confirmOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Timer className="w-5 h-5 text-purple-600" /> Auto-delete (data retention)</DialogTitle>
            <DialogDescription>
              {scopeType === 'group'
                ? `${scopeName} — applies to all ${data?.memberCount ?? ''} member accounts${data?.overriddenAccounts ? ` (${data.overriddenAccounts} with their own override)` : ''}.`
                : `${scopeName} — overrides any group policy for this account.`}
            </DialogDescription>
          </DialogHeader>

          {isLoading || !settings ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          ) : (
            <Tabs defaultValue="settings">
              <TabsList>
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="report">Report</TabsTrigger>
              </TabsList>

              <TabsContent value="settings" className="space-y-5 pt-2">
                {scopeType === 'account' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {[{ v: true, t: "Use group policy" }, { v: false, t: "Override for this account" }].map(o => (
                        <button
                          key={String(o.v)}
                          type="button"
                          onClick={() => setUseGroupPolicy(o.v)}
                          className={`rounded-lg border p-2.5 text-sm text-left ${useGroupPolicy === o.v ? "border-purple-500 bg-purple-50 ring-1 ring-purple-500" : "hover:bg-muted/50"}`}
                        >
                          {o.t}
                        </button>
                      ))}
                    </div>
                    {useGroupPolicy && (
                      <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                        {data?.groups?.length ? data.groups.map(g => (
                          <div key={g.groupId}>
                            <span className="font-medium">{g.name}:</span>{" "}
                            {g.policy && g.policy.mode !== 'off'
                              ? `${MODE_LABEL[g.policy.mode]} — synced leads deleted after ${formatMinutes(g.policy.deleteSyncedAfterMinutes)}`
                              : "auto-delete off"}
                          </div>
                        )) : <div className="text-muted-foreground">This account is not in any group, so auto-delete is off.</div>}
                      </div>
                    )}
                  </div>
                )}

                {!useGroupPolicy && (
                  <>
                    <div className="space-y-2">
                      <Label>Mode</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          ["off", "Off", "Nothing is deleted"],
                          ["dry_run", "Dry run", "Only reports what would be deleted"],
                          ["live", "Live", "Deletes on schedule"],
                        ] as const).map(([v, t, d]) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => set('mode', v)}
                            className={`rounded-lg border p-2.5 text-left ${settings.mode === v ? (v === 'live' ? "border-red-500 bg-red-50 ring-1 ring-red-500" : "border-purple-500 bg-purple-50 ring-1 ring-purple-500") : "hover:bg-muted/50"}`}
                          >
                            <div className="text-sm font-medium">{t}</div>
                            <div className="text-[11px] text-muted-foreground">{d}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="ret-synced">Delete synced leads after</Label>
                        <DurationSelect id="ret-synced" value={settings.deleteSyncedAfterMinutes} onChange={(v) => set('deleteSyncedAfterMinutes', v ?? 24 * 60)} />
                        <p className="text-[11px] text-muted-foreground">Counted from the lead's last successful sync to LeadSquared/Salesforce.</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ret-unsynced">Delete leads that never sync</Label>
                        <DurationSelect id="ret-unsynced" allowNever value={settings.deleteUnsyncedAfterMinutes} onChange={(v) => set('deleteUnsyncedAfterMinutes', v)} />
                        <p className="text-[11px] text-muted-foreground">Counted from capture. "Never" keeps them until they sync.</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ret-chats">Delete chats with no lead after</Label>
                        <DurationSelect id="ret-chats" allowNever value={settings.deleteIdleChatsAfterMinutes} onChange={(v) => set('deleteIdleChatsAfterMinutes', v)} />
                        <p className="text-[11px] text-muted-foreground">Counted from the last message.</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Keep anonymous counts</Label>
                        <div className="flex items-center gap-2 pt-1">
                          <Switch checked={settings.keepAnonymousCounts} onCheckedChange={(v) => set('keepAnonymousCounts', v)} />
                          <span className="text-xs text-muted-foreground">Dashboards keep counting deleted leads (numbers only).</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                      <p>Deleted with each lead: its conversation, messages, journey/form answers, uploaded chat images, and linked appointments, tickets and applications.</p>
                      <p>A conversation is never deleted while the visitor is still chatting (30 minutes idle required). Copies in the client's CRM are not touched.</p>
                    </div>

                    <div className="space-y-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
                        {previewMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}
                        Check what these settings would delete now
                      </Button>
                      {preview && <PreviewSummary preview={preview} />}
                    </div>
                  </>
                )}

                {scopeType === 'account' && status && (
                  <div className="text-xs text-muted-foreground border-t pt-3">
                    Last run {format(new Date(status.lastRunAt), "d MMM, h:mm a")} ({MODE_LABEL[status.mode] || status.mode}):
                    {" "}{status.dueLeads} lead(s) and {status.dueConversations} idle chat(s) due
                    {status.mode === 'live' && `, ${status.lastPurgedLeads} lead(s) deleted`}.
                    {status.lastError && <span className="text-red-600"> Error: {status.lastError}</span>}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="report" className="pt-2">
                <RetentionReport baseUrl={`/api/super-admin/data-retention/report?scopeType=${scopeType}&scopeId=${scopeId}`} />
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!settings || saveMutation.isPending} className={goingLive ? "bg-red-600 hover:bg-red-700" : ""}>
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {goingLive ? "Switch to live…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open && confirmOpen} onOpenChange={(o) => { if (!o && !saveMutation.isPending) { setConfirmOpen(false); setConfirmText(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="w-5 h-5" /> Turn on live auto-delete?</DialogTitle>
            <DialogDescription>
              From the next run (within 5 minutes), data matching these settings is permanently deleted for {scopeName}, including records that already exist. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {previewMutation.isPending || !preview ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3"><Loader2 className="w-4 h-4 animate-spin" /> Counting what will be deleted…</div>
          ) : (
            <PreviewSummary preview={preview} />
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ret-confirm">Type <span className="font-mono font-semibold">CONFIRM</span> to continue</Label>
            <Input id="ret-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saveMutation.isPending} onClick={() => { setConfirmOpen(false); setConfirmText(""); }}>Back</Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "CONFIRM" || saveMutation.isPending || !preview}
              onClick={() => saveMutation.mutate("CONFIRM")}
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Turn on live auto-delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreviewSummary({ preview }: { preview: PreviewResponse }) {
  const affected = preview.accounts.filter(a => a.leads + a.idleChats > 0);
  const overridden = preview.accounts.filter(a => a.overridden).length;
  const noCrm = preview.accounts.filter(a => a.crm && !a.crm.leadsquared && !a.crm.salesforce).length;
  return (
    <div className="rounded-md border p-3 text-sm space-y-2">
      <div>
        Deleted right away: <span className="font-semibold text-red-600">{preview.totalLeads.toLocaleString()} lead(s)</span> (with their chats)
        {" "}and <span className="font-semibold text-red-600">{preview.totalIdleChats.toLocaleString()} chat(s) with no lead</span>.
      </div>
      {affected.length > 0 && (
        <div className="max-h-36 overflow-auto text-xs space-y-0.5">
          {affected.map(a => (
            <div key={a.businessAccountId} className="flex justify-between gap-2">
              <span className="truncate">{a.name}</span>
              <span className="tabular-nums text-muted-foreground shrink-0">{a.leads} leads · {a.idleChats} chats</span>
            </div>
          ))}
        </div>
      )}
      {overridden > 0 && <div className="text-xs text-muted-foreground">{overridden} account(s) have their own override and are not affected.</div>}
      {noCrm > 0 && (
        <div className="text-xs text-amber-700 flex items-start gap-1">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {noCrm} account(s) have no CRM connected, so their leads never count as synced and are only deleted by the "never sync" timer.
        </div>
      )}
      <Badge variant="outline" className="text-[10px]">Counts are for right now; more become due over time.</Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner + per-lead countdown for the Leads pages
// ---------------------------------------------------------------------------


export interface AccountRetention {
  policy: EffectiveRetentionPolicy;
  crm: AccountCrmTargets | null;
}

function shortDuration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Small line under a lead's date: when it will be deleted, or why it is kept. */
export function RetentionCountdown({ lead, retention, align = "right" }: {
  lead: { createdAt: string; leadsquaredSyncStatus?: string | null; leadsquaredSyncedAt?: string | null; salesforceSyncStatus?: string | null; salesforceSyncedAt?: string | null };
  retention: AccountRetention | null | undefined;
  align?: "left" | "right";
}) {
  if (!retention?.policy) return null;
  const d = decideLead(lead, retention.policy, retention.crm || { leadsquared: false, salesforce: false }, null, new Date());
  const dry = retention.policy.mode === 'dry_run';
  let text: string;
  let cls = "text-gray-400";
  if (d.due) {
    text = dry ? "would be deleted now" : "deleting shortly";
    cls = dry ? "text-amber-600" : "text-red-500";
  } else if (d.dueAt) {
    text = `${dry ? "would delete" : "deletes"} in ${shortDuration(d.dueAt.getTime() - Date.now())}`;
    cls = dry ? "text-amber-600" : "text-orange-500";
  } else {
    text = "kept (not synced)";
  }
  return (
    <div className={`text-[10px] flex items-center ${align === "right" ? "justify-end" : ""} gap-0.5 ${cls}`} title={dry ? "Auto-delete is in dry-run mode: nothing is actually deleted yet." : "Auto-delete is on for this account."}>
      <Timer className="w-2.5 h-2.5" /> {text}
    </div>
  );
}

export function RetentionBanner({ policies, totalAccounts, onViewReport }: {
  policies: EffectiveRetentionPolicy[];
  totalAccounts?: number;
  onViewReport?: () => void;
}) {
  if (policies.length === 0) return null;
  const live = policies.some(p => p.mode === 'live');
  const synced = Array.from(new Set(policies.map(p => formatMinutes(p.deleteSyncedAfterMinutes))));
  const unsynced = Array.from(new Set(policies.map(p => p.deleteUnsyncedAfterMinutes === null ? null : formatMinutes(p.deleteUnsyncedAfterMinutes))));
  return (
    <div className={`flex flex-wrap items-center gap-2 px-4 py-2 text-xs border-b ${live ? "bg-orange-50 text-orange-800 border-orange-100" : "bg-amber-50 text-amber-800 border-amber-100"}`}>
      <Timer className="w-3.5 h-3.5 shrink-0" />
      <span>
        <span className="font-semibold">{live ? "Auto-delete is on" : "Auto-delete dry run"}</span>
        {totalAccounts !== undefined && totalAccounts > 1 ? ` for ${policies.length} of ${totalAccounts} accounts` : ""}:
        {" "}leads are {live ? "" : "would be "}removed {synced.join(" / ")} after syncing to the CRM;
        {" "}leads that never sync are {unsynced.every(u => u === null) ? "kept" : `removed after ${unsynced.filter(Boolean).join(" / ")}`}.
        {!live && " Nothing is deleted yet."}
      </span>
      {onViewReport && (
        <button type="button" onClick={onViewReport} className="ml-auto underline font-medium">View retention report</button>
      )}
    </div>
  );
}
