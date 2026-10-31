import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Handshake, Plus, KeyRound, Trash2, ExternalLink } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { AGENCY_TABS, agencyHref, accountHref, type AgencyTabKey } from "@/navigation/superAdminAreas";
import {
  CredentialsDialog, FeatureSwitches, Panel, Stat, StatusPill, UsageBar, formatMoney, formatUsd, monthLabel, recentMonths,
} from "@/components/agency/agencyUi";
import {
  AGENCY_FEATURES, AGENCY_PERMISSIONS,
  type AgencyBilling, type AgencyBranding, type AgencyFeatureKey, type AgencyPermissions, type AgencyStatement,
} from "@shared/agency";

export interface AgencySettingsDto {
  id: string;
  name: string;
  status: string;
  maxAccounts: number | null;
  allowedFeatures: AgencyFeatureKey[];
  permissions: AgencyPermissions;
  monthlyAiCapUsd: number | null;
  aiCapAction: "warn" | "block";
  aiCapWarnAtPercent: number;
  defaultClientLimitUsd: number | null;
  billing: AgencyBilling;
  branding: AgencyBranding;
  notes: string;
}

interface ClientRow {
  id: string;
  name: string;
  website: string;
  status: string;
  login: { username: string; lastLoginAt: string | null } | null;
  features: Record<AgencyFeatureKey, boolean>;
  actions: number;
  spentUsd: number | null;
  limit: { monthlyLimitUsd: number | null; warnAtPercent: number; action: string } | null;
  percentOfLimit: number | null;
}

interface LoginRow { userId: string; username: string; role: string; lastLoginAt: string | null }

interface AgencyDetail {
  agency: AgencySettingsDto;
  clients: ClientRow[];
  logins: LoginRow[];
  month: string;
  spentUsd: number;
  usdInrRate: number;
}

const toNum = (v: string): number | null => (v.trim() === "" ? null : Number(v));

/** One agency's own page for super admins. */
export default function SuperAdminAgencyPage({ agencyId, tab }: { agencyId: string; tab?: string }) {
  const { data, isLoading } = useQuery<AgencyDetail>({ queryKey: [`/api/super-admin/agencies/${agencyId}`] });
  const active = (AGENCY_TABS.find(t => t.key === tab)?.key ?? "overview") as AgencyTabKey;
  const tabs = AGENCY_TABS.map(t => ({ key: t.key, label: t.label, href: agencyHref(agencyId, t.key) }));

  return (
    <>
      <SaHeader
        icon={Handshake}
        tint="bg-teal-600"
        kind="Agency"
        title={data?.agency.name ?? (isLoading ? "Loading…" : "Agency not found")}
        subtitle={data ? <span className="inline-flex items-center gap-2"><StatusPill status={data.agency.status} />{data.clients.length} client{data.clients.length === 1 ? "" : "s"} · {data.logins.length} login{data.logins.length === 1 ? "" : "s"}</span> : undefined}
        back={{ label: "Agencies", href: "/super-admin/agencies" }}
        tabs={tabs}
        activeTab={active}
      />
      <SaBody>
        {!isLoading && !data ? (
          <p className="text-sm text-gray-500">This agency could not be found. It may have been deleted.</p>
        ) : data ? (
          <>
            {active === "overview" && <OverviewTab detail={data} />}
            {active === "plan" && <PlanTab detail={data} />}
            {active === "billing" && <BillingTab detail={data} />}
            {active === "brand" && <BrandTab detail={data} />}
          </>
        ) : null}
      </SaBody>
    </>
  );
}

function useSaveAgency(agencyId: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (body: Partial<Record<string, unknown>>) => apiRequest("PATCH", `/api/super-admin/agencies/${agencyId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/super-admin/agencies/${agencyId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/agencies"] });
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
}

function refresh(agencyId: string) {
  queryClient.invalidateQueries({ queryKey: [`/api/super-admin/agencies/${agencyId}`] });
  queryClient.invalidateQueries({ queryKey: ["/api/super-admin/agencies"] });
}

// ── Clients & logins ─────────────────────────────────────────────────────────

function OverviewTab({ detail }: { detail: AgencyDetail }) {
  const { agency, clients, logins, usdInrRate } = detail;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [pick, setPick] = useState("");
  const [moveConfirm, setMoveConfirm] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginRole, setLoginRole] = useState<"owner" | "staff">("staff");
  const [creds, setCreds] = useState<{ username: string; tempPassword: string } | null>(null);
  const { data: all } = useQuery<{ accounts: { id: string; name: string; agencyId?: string | null }[] }>({ queryKey: ["/api/business-accounts"] });

  const options = useMemo(
    () => (all?.accounts ?? []).filter(a => a.agencyId !== agency.id).map(a => ({ value: a.id, label: a.agencyId ? `${a.name} (in another agency)` : a.name })),
    [all, agency.id],
  );

  const addAccount = useMutation({
    mutationFn: (move: boolean) => apiRequest("POST", `/api/super-admin/agencies/${agency.id}/accounts`, { businessAccountId: pick, move }),
    onSuccess: () => { setPick(""); setMoveConfirm(null); refresh(agency.id); queryClient.invalidateQueries({ queryKey: ["/api/business-accounts"] }); toast({ title: "Account added to the agency" }); },
    onError: (e: Error & { status?: number }) => {
      if (e.status === 409) setMoveConfirm(e.message);
      else toast({ title: "Couldn't add the account", description: e.message, variant: "destructive" });
    },
  });
  const removeAccount = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/super-admin/agencies/${agency.id}/accounts/${id}`),
    onSuccess: () => { refresh(agency.id); queryClient.invalidateQueries({ queryKey: ["/api/business-accounts"] }); toast({ title: "Removed from the agency", description: "The account stays, as a direct customer." }); },
    onError: (e: Error) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
  });
  const addLogin = useMutation({
    mutationFn: () => apiRequest<{ credentials: { username: string; tempPassword: string } }>("POST", `/api/super-admin/agencies/${agency.id}/logins`, { username: loginEmail, role: loginRole }),
    onSuccess: (res) => { setLoginOpen(false); setLoginEmail(""); setCreds(res.credentials); refresh(agency.id); },
    onError: (e: Error) => toast({ title: "Couldn't add the login", description: e.message, variant: "destructive" }),
  });
  const resetLogin = useMutation({
    mutationFn: (userId: string) => apiRequest<{ username: string; tempPassword: string }>("POST", `/api/super-admin/agencies/${agency.id}/logins/${userId}/reset-password`),
    onSuccess: (res) => setCreds(res),
    onError: (e: Error) => toast({ title: "Couldn't reset", description: e.message, variant: "destructive" }),
  });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => apiRequest("PATCH", `/api/super-admin/agencies/${agency.id}/logins/${userId}`, { role }),
    onSuccess: () => refresh(agency.id),
  });
  const removeLogin = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/super-admin/agencies/${agency.id}/logins/${userId}`),
    onSuccess: () => { refresh(agency.id); toast({ title: "Login removed" }); },
  });

  const capPct = agency.monthlyAiCapUsd ? Math.round((detail.spentUsd / agency.monthlyAiCapUsd) * 1000) / 10 : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Clients" value={clients.length} hint={agency.maxAccounts !== null ? `Plan allows ${agency.maxAccounts}` : "No account limit"} />
        <Stat label="Active clients" value={clients.filter(c => c.status === "active").length} />
        <Stat label={`AI this month (${monthLabel(detail.month)})`} value={formatUsd(detail.spentUsd)} hint={usdInrRate ? `≈ ₹${Math.round(detail.spentUsd * usdInrRate).toLocaleString("en-IN")}` : undefined} />
        <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
          <p className="text-[12px] text-gray-500">Agency AI cap</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums text-gray-900">{agency.monthlyAiCapUsd !== null ? formatUsd(agency.monthlyAiCapUsd) : "None"}</p>
          {capPct !== null && <div className="mt-2"><UsageBar percent={capPct} warnAt={agency.aiCapWarnAtPercent} /><p className="mt-1 text-[12px] text-gray-500">{capPct}% used · {agency.aiCapAction === "block" ? "AI stops at 100%" : "warning only"}</p></div>}
        </div>
      </div>

      <Panel
        title="Client accounts"
        subtitle="Accounts this agency manages. Removing one keeps the account as our direct customer."
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="w-64"><SearchableSelect value={pick} onValueChange={setPick} options={options} placeholder="Add an existing account…" searchPlaceholder="Search accounts…" /></div>
            <Button variant="outline" disabled={!pick || addAccount.isPending} onClick={() => addAccount.mutate(false)} data-testid="button-add-agency-account">Add</Button>
          </div>
        }
      >
        {clients.length === 0 ? (
          <p className="text-[13px] text-gray-500">No clients yet. The agency can create them from its own portal, or add existing accounts here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-black/[0.06] text-[12px] text-gray-500">
                  <th className="py-2 pr-3 font-medium">Client</th>
                  <th className="py-2 pr-3 font-medium">Features on</th>
                  <th className="py-2 pr-3 font-medium">AI this month</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id} className="border-b border-black/[0.04] last:border-0">
                    <td className="py-3 pr-3">
                      <button type="button" className="text-left font-medium text-gray-900 hover:underline" onClick={() => setLocation(accountHref(c.id))}>{c.name}</button>
                      <p className="text-[12px] text-gray-500">{c.login?.username ?? "No login"}</p>
                    </td>
                    <td className="py-3 pr-3 text-[13px] text-gray-600">{AGENCY_FEATURES.filter(f => c.features[f.key]).map(f => f.label).join(", ") || "—"}</td>
                    <td className="py-3 pr-3">
                      <p className="tabular-nums">{formatUsd(c.spentUsd)}{c.limit?.monthlyLimitUsd ? ` of ${formatUsd(c.limit.monthlyLimitUsd)}` : ""}</p>
                      {c.percentOfLimit !== null && <div className="mt-1 w-28"><UsageBar percent={c.percentOfLimit} warnAt={c.limit?.warnAtPercent} /></div>}
                    </td>
                    <td className="py-3 pr-3"><StatusPill status={c.status} /></td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setLocation(accountHref(c.id))} title="Open account page"><ExternalLink className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => removeAccount.mutate(c.id)} title="Remove from agency"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Agency logins"
        subtitle="People at the agency who manage its clients. The owner can also add staff, if the plan allows it."
        actions={<Button variant="outline" onClick={() => setLoginOpen(true)} data-testid="button-add-agency-login"><Plus className="mr-1 h-4 w-4" />Add login</Button>}
      >
        {logins.length === 0 ? (
          <p className="text-[13px] text-gray-500">No logins yet. Add the agency owner's email to give them access.</p>
        ) : (
          <div className="divide-y divide-black/[0.05]">
            {logins.map(l => (
              <div key={l.userId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-gray-900">{l.username}</p>
                  <p className="text-[12px] text-gray-500">{l.lastLoginAt ? `Last login ${new Date(l.lastLoginAt).toLocaleDateString("en-IN")}` : "Never logged in"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={l.role} onValueChange={(role) => setRole.mutate({ userId: l.userId, role })}>
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="owner">Owner</SelectItem><SelectItem value="staff">Staff</SelectItem></SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => resetLogin.mutate(l.userId)} title="New temporary password"><KeyRound className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => removeLogin.mutate(l.userId)} title="Remove login"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add agency login</DialogTitle>
            <DialogDescription>They'll get a temporary password and choose their own when they first log in.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); addLogin.mutate(); }}>
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input id="login-email" type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={loginRole} onValueChange={(v) => setLoginRole(v as "owner" | "staff")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="owner">Owner — can also manage the team</SelectItem><SelectItem value="staff">Staff</SelectItem></SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLoginOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!loginEmail.trim() || addLogin.isPending}>Add login</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!moveConfirm} onOpenChange={(o) => { if (!o) setMoveConfirm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move this account?</DialogTitle>
            <DialogDescription>{moveConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveConfirm(null)}>Cancel</Button>
            <Button onClick={() => addAccount.mutate(true)}>Move here</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CredentialsDialog credentials={creds} title="Login details" onClose={() => setCreds(null)} />
    </>
  );
}

// ── Plan & limits ────────────────────────────────────────────────────────────

function PlanTab({ detail }: { detail: AgencyDetail }) {
  const { agency } = detail;
  const save = useSaveAgency(agency.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [form, setForm] = useState(() => ({
    name: agency.name,
    status: agency.status,
    maxAccounts: agency.maxAccounts === null ? "" : String(agency.maxAccounts),
    allowedFeatures: agency.allowedFeatures,
    permissions: agency.permissions,
    cap: agency.monthlyAiCapUsd === null ? "" : String(agency.monthlyAiCapUsd),
    aiCapAction: agency.aiCapAction,
    aiCapWarnAtPercent: String(agency.aiCapWarnAtPercent),
    defaultClientLimit: agency.defaultClientLimitUsd === null ? "" : String(agency.defaultClientLimitUsd),
    notes: agency.notes,
  }));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const del = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/super-admin/agencies/${agency.id}`, { confirmName }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/super-admin/agencies"] }); setLocation("/super-admin/agencies"); toast({ title: "Agency deleted", description: "Its clients are now direct customers." }); },
    onError: (e: Error) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  const submit = () => save.mutate({
    name: form.name,
    status: form.status,
    maxAccounts: toNum(form.maxAccounts),
    allowedFeatures: form.allowedFeatures,
    permissions: form.permissions,
    monthlyAiCapUsd: toNum(form.cap),
    aiCapAction: form.aiCapAction,
    aiCapWarnAtPercent: Number(form.aiCapWarnAtPercent) || 80,
    defaultClientLimitUsd: toNum(form.defaultClientLimit),
    notes: form.notes,
  });

  return (
    <>
      <Panel title="Agency" subtitle="Pausing an agency stops its logins. Its clients keep working unless you pause them too.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Name</Label>
            <Input id="plan-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Paused</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-max">Most client accounts</Label>
            <Input id="plan-max" inputMode="numeric" value={form.maxAccounts} onChange={e => setForm({ ...form, maxAccounts: e.target.value.replace(/[^\d]/g, "") })} placeholder="No limit" />
          </div>
        </div>
      </Panel>

      <Panel title="AI limits" subtitle="Amounts are our AI cost in US dollars per calendar month (India time), the same as AI spend & limits.">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="plan-cap">Agency AI cap ($)</Label>
            <Input id="plan-cap" inputMode="decimal" value={form.cap} onChange={e => setForm({ ...form, cap: e.target.value })} placeholder="No cap" data-testid="input-agency-cap" />
            <p className="text-[12px] text-gray-500">Total for all its clients together.</p>
          </div>
          <div className="space-y-1.5">
            <Label>At the cap</Label>
            <Select value={form.aiCapAction} onValueChange={(v) => setForm({ ...form, aiCapAction: v as "warn" | "block" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="block">Stop AI for all its clients</SelectItem><SelectItem value="warn">Only warn</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-warn">Warn at (%)</Label>
            <Input id="plan-warn" inputMode="numeric" value={form.aiCapWarnAtPercent} onChange={e => setForm({ ...form, aiCapWarnAtPercent: e.target.value.replace(/[^\d]/g, "") })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-default">New client limit ($)</Label>
            <Input id="plan-default" inputMode="decimal" value={form.defaultClientLimit} onChange={e => setForm({ ...form, defaultClientLimit: e.target.value })} placeholder="None" />
            <p className="text-[12px] text-gray-500">Given to each new client; AI stops at it.</p>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Features it may resell" subtitle="The agency can switch only these on for its clients. Clients keep what's already on.">
          <FeatureSwitches
            value={Object.fromEntries(form.allowedFeatures.map(k => [k, true]))}
            onChange={(k, on) => setForm({ ...form, allowedFeatures: on ? [...form.allowedFeatures, k] : form.allowedFeatures.filter(x => x !== k) })}
            testIdPrefix="allowed"
          />
        </Panel>
        <Panel title="What its logins may do" subtitle="Applies to every login of this agency.">
          <div className="divide-y divide-black/[0.05]">
            {AGENCY_PERMISSIONS.map(p => (
              <label key={p.key} className="flex cursor-pointer items-center justify-between gap-4 py-2.5">
                <span className="min-w-0">
                  <span className="block text-[14px] text-gray-900">{p.label}</span>
                  <span className="block text-[12px] text-gray-500">{p.hint}</span>
                </span>
                <Switch
                  checked={form.permissions[p.key]}
                  onCheckedChange={(on) => setForm({ ...form, permissions: { ...form.permissions, [p.key]: on } })}
                  data-testid={`perm-${p.key}`}
                />
              </label>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Notes" subtitle="Only you see these: contract, contacts, anything agreed.">
        <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} />
      </Panel>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={save.isPending || !form.name.trim()} data-testid="button-save-agency-plan">{save.isPending ? "Saving…" : "Save plan & limits"}</Button>
      </div>

      <Panel title="Delete agency" subtitle="Its logins are removed. Its client accounts stay, as our direct customers, with all their data.">
        <Button variant="outline" className="text-red-600" onClick={() => setDeleteOpen(true)}>Delete this agency…</Button>
      </Panel>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {agency.name}?</DialogTitle>
            <DialogDescription>Type the agency's name to confirm.</DialogDescription>
          </DialogHeader>
          <Input value={confirmName} onChange={e => setConfirmName(e.target.value)} placeholder={agency.name} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={confirmName.trim() !== agency.name || del.isPending} onClick={() => del.mutate()}>Delete agency</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Billing ──────────────────────────────────────────────────────────────────

export function StatementView({ statement }: { statement: AgencyStatement }) {
  const c = statement.currency;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-black/[0.06] text-[12px] text-gray-500">
              <th className="py-2 pr-3 font-medium">Client</th>
              <th className="py-2 pr-3 font-medium">AI used</th>
              <th className="py-2 pr-3 font-medium">Above allowance</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.map(l => (
              <tr key={l.businessAccountId} className="border-b border-black/[0.04] last:border-0">
                <td className="py-2.5 pr-3">{l.name}{l.status !== "active" && <span className="ml-2 text-[12px] text-amber-700">paused (no account fee)</span>}</td>
                <td className="py-2.5 pr-3 tabular-nums">{l.aiCost ? formatMoney(l.aiCost, c) : "—"}</td>
                <td className="py-2.5 pr-3 tabular-nums">{l.aiOverage ? formatMoney(l.aiOverage, c) : "—"}</td>
                <td className="py-2.5 text-right tabular-nums">{formatMoney(l.amount, c)}</td>
              </tr>
            ))}
            {statement.lines.length === 0 && <tr><td colSpan={4} className="py-3 text-[13px] text-gray-500">No clients this month.</td></tr>}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto max-w-sm space-y-1 text-[14px]">
        <div className="flex justify-between"><dt className="text-gray-500">Account fees ({statement.accounts} active)</dt><dd className="tabular-nums">{formatMoney(statement.accountFees, c)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">AI above allowance</dt><dd className="tabular-nums">{formatMoney(statement.aiCharges, c)}</dd></div>
        {statement.monthlyFee > 0 && <div className="flex justify-between"><dt className="text-gray-500">Monthly fee</dt><dd className="tabular-nums">{formatMoney(statement.monthlyFee, c)}</dd></div>}
        <div className="flex justify-between border-t border-black/[0.08] pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="statement-total">{formatMoney(statement.total, c)}</dd></div>
      </dl>
      {statement.model === "custom" && <p className="text-[12px] text-gray-500">Custom pricing: only the fixed monthly fee is charged here; anything else is agreed separately.</p>}
    </div>
  );
}

function BillingTab({ detail }: { detail: AgencyDetail }) {
  const { agency } = detail;
  const save = useSaveAgency(agency.id);
  const [b, setB] = useState(() => ({
    model: agency.billing.model,
    currency: agency.billing.currency,
    pricePerAccount: String(agency.billing.pricePerAccount),
    includedAiPerAccount: String(agency.billing.includedAiPerAccount),
    aiMarkupPercent: String(agency.billing.aiMarkupPercent),
    monthlyFee: String(agency.billing.monthlyFee),
    notes: agency.billing.notes,
  }));
  const [month, setMonth] = useState(detail.month);
  const { data: statement } = useQuery<AgencyStatement>({ queryKey: [`/api/super-admin/agencies/${agency.id}/statement?month=${month}`] });
  const sym = b.currency === "INR" ? "₹" : "$";
  const submit = () => save.mutate({
    billing: {
      model: b.model, currency: b.currency, notes: b.notes,
      pricePerAccount: Number(b.pricePerAccount) || 0,
      includedAiPerAccount: Number(b.includedAiPerAccount) || 0,
      aiMarkupPercent: Number(b.aiMarkupPercent) || 0,
      monthlyFee: Number(b.monthlyFee) || 0,
    },
  }, {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/super-admin/agencies/${agency.id}/statement?month=${month}`] }),
  });

  return (
    <>
      <Panel title="What we charge this agency" subtitle="The agency sets its own prices for its clients; this is only our bill to the agency.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Pricing</Label>
            <Select value={b.model} onValueChange={(v) => setB({ ...b, model: v as AgencyBilling["model"] })}>
              <SelectTrigger data-testid="select-billing-model"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="per_account">Per client account, with an AI allowance</SelectItem>
                <SelectItem value="usage">AI use with a markup (plus any account fee)</SelectItem>
                <SelectItem value="custom">Custom (fixed monthly fee only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Select value={b.currency} onValueChange={(v) => setB({ ...b, currency: v as AgencyBilling["currency"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="INR">Indian rupees (₹)</SelectItem><SelectItem value="USD">US dollars ($)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-fee">Fixed monthly fee ({sym})</Label>
            <Input id="bill-fee" inputMode="decimal" value={b.monthlyFee} onChange={e => setB({ ...b, monthlyFee: e.target.value })} />
          </div>
          {b.model !== "custom" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="bill-price">Fee per active client ({sym}/month)</Label>
                <Input id="bill-price" inputMode="decimal" value={b.pricePerAccount} onChange={e => setB({ ...b, pricePerAccount: e.target.value })} data-testid="input-price-per-account" />
              </div>
              {b.model === "per_account" && (
                <div className="space-y-1.5">
                  <Label htmlFor="bill-included">AI included per client ({sym}/month)</Label>
                  <Input id="bill-included" inputMode="decimal" value={b.includedAiPerAccount} onChange={e => setB({ ...b, includedAiPerAccount: e.target.value })} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="bill-markup">Markup on AI above that (%)</Label>
                <Input id="bill-markup" inputMode="decimal" value={b.aiMarkupPercent} onChange={e => setB({ ...b, aiMarkupPercent: e.target.value })} />
              </div>
            </>
          )}
        </div>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="bill-notes">Billing notes <span className="font-normal text-gray-500">(the agency sees these on its statement)</span></Label>
          <Textarea id="bill-notes" rows={2} value={b.notes} onChange={e => setB({ ...b, notes: e.target.value })} placeholder="e.g. Invoiced on the 1st, payable in 15 days." />
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={submit} disabled={save.isPending} data-testid="button-save-billing">{save.isPending ? "Saving…" : "Save pricing"}</Button>
        </div>
      </Panel>

      <Panel
        title="Monthly statement"
        subtitle="AI cost is converted from US dollars at today's rate. Paused clients pay no account fee."
        actions={
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{recentMonths(detail.month).map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
          </Select>
        }
      >
        {statement ? <StatementView statement={statement} /> : <p className="text-sm text-gray-500">Loading…</p>}
      </Panel>
    </>
  );
}

// ── Brand ────────────────────────────────────────────────────────────────────

export function BrandForm({ branding, onSave, saving, showLeadSource = true, allowPlatform = true }: {
  branding: AgencyBranding;
  onSave: (b: AgencyBranding) => void;
  saving: boolean;
  showLeadSource?: boolean;
  /** Offer "Powered by AI Chroney" (super admins only; agencies never see our name). */
  allowPlatform?: boolean;
}) {
  const [f, setF] = useState(branding);
  const preview = f.widgetFooter === "platform" ? (allowPlatform ? "Powered by AI Chroney" : "Platform default") : f.widgetFooter === "hidden" ? "" : `Powered by ${f.footerText || f.brandName}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="brand-name">Brand name</Label>
          <Input id="brand-name" value={f.brandName} onChange={e => setF({ ...f, brandName: e.target.value })} data-testid="input-brand-name" />
          <p className="text-[12px] text-gray-500">The name the agency's clients know the product by.</p>
        </div>
        {showLeadSource && (
          <div className="space-y-1.5">
            <Label htmlFor="brand-source">Lead source sent to CRMs</Label>
            <Input id="brand-source" value={f.leadSourceName} onChange={e => setF({ ...f, leadSourceName: e.target.value })} placeholder={f.brandName || "Brand name"} />
            <p className="text-[12px] text-gray-500">Used when a client's LeadSquared fields are first set up.</p>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Chat widget footer</Label>
        <Select value={f.widgetFooter} onValueChange={(v) => setF({ ...f, widgetFooter: v as AgencyBranding["widgetFooter"] })}>
          <SelectTrigger className="md:w-96" data-testid="select-widget-footer"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="agency">The agency's name</SelectItem>
            <SelectItem value="hidden">Nothing</SelectItem>
            {(allowPlatform || f.widgetFooter === "platform") && <SelectItem value="platform">{allowPlatform ? "Powered by AI Chroney" : "Platform default"}</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      {f.widgetFooter === "agency" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="brand-footer-text">Footer name</Label>
            <Input id="brand-footer-text" value={f.footerText} onChange={e => setF({ ...f, footerText: e.target.value })} placeholder={f.brandName} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand-footer-url">Footer link</Label>
            <Input id="brand-footer-url" value={f.footerUrl} onChange={e => setF({ ...f, footerUrl: e.target.value })} placeholder="https://agency.com" />
          </div>
        </div>
      )}
      <div className="rounded-xl bg-gray-50 px-4 py-3">
        <p className="text-[12px] text-gray-500">Preview</p>
        <p className="mt-1 text-center text-[11px] text-gray-400">{preview || "(no footer)"}</p>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => onSave(f)} disabled={saving} data-testid="button-save-brand">{saving ? "Saving…" : "Save brand"}</Button>
      </div>
    </div>
  );
}

function BrandTab({ detail }: { detail: AgencyDetail }) {
  const save = useSaveAgency(detail.agency.id);
  return (
    <Panel title="Brand" subtitle="What the agency's clients and their website visitors see. A client can still hide the footer from its own widget settings.">
      <BrandForm branding={detail.agency.branding} saving={save.isPending} onSave={(branding) => save.mutate({ branding })} />
    </Panel>
  );
}
