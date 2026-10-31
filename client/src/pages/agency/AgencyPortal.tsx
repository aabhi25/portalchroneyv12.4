import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, KeyRound, Plus, Receipt, Trash2, UsersRound, Palette, ExternalLink, Pause, Play } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import {
  CredentialsDialog, FeatureSwitches, Panel, Stat, StatusPill, UsageBar, formatUsd, monthLabel, recentMonths,
} from "@/components/agency/agencyUi";
import { BrandForm, StatementView } from "@/pages/SuperAdminAgencyPage";
import { DomainPanel, LogoPanel, type DomainInfo } from "@/components/agency/BrandingPanels";
import {
  AGENCY_FEATURES,
  type AgencyBranding, type AgencyFeatureKey, type AgencyPermissions, type AgencyStatement,
} from "@shared/agency";

/**
 * The agency's own portal (users.role 'agency_admin'): its clients, the bill, its team and the
 * widget footer. What shows depends on the permissions a super admin gave the agency.
 */

interface Overview {
  agency: {
    id: string;
    name: string;
    brandName: string;
    maxAccounts: number | null;
    allowedFeatures: AgencyFeatureKey[];
    permissions: AgencyPermissions;
    branding: AgencyBranding;
    aiCap: { monthlyAiCapUsd: number | null; action: string; warnAtPercent: number; percentUsed: number } | null;
    defaultClientLimitUsd: number | null;
    currency: string;
    domain: DomainInfo;
    logoUrl: string | null;
  };
  me: { username: string; role: "owner" | "staff" };
  month: string;
  clients: number;
  activeClients: number;
  actions: number;
  spentUsd: number | null;
  usdInrRate: number;
}

interface ClientRow {
  id: string;
  name: string;
  website: string;
  status: string;
  createdAt: string;
  login: { username: string; lastLoginAt: string | null } | null;
  features: Record<AgencyFeatureKey, boolean>;
  actions: number;
  spentUsd: number | null;
  limit: { monthlyLimitUsd: number | null; warnAtPercent: number; action: string } | null;
  percentOfLimit: number | null;
}

export const AGENCY_NAV: { key: string; label: string; href: string; icon: LucideIcon; tint: string; perm?: keyof AgencyPermissions }[] = [
  { key: "clients", label: "Clients", href: "/agency", icon: Building2, tint: "bg-teal-600" },
  { key: "statement", label: "Monthly bill", href: "/agency/statement", icon: Receipt, tint: "bg-emerald-600", perm: "seeStatement" },
  { key: "team", label: "Team", href: "/agency/team", icon: UsersRound, tint: "bg-indigo-600" },
  { key: "brand", label: "Brand", href: "/agency/brand", icon: Palette, tint: "bg-fuchsia-600", perm: "editBranding" },
];

export function useAgencyOverview() {
  return useQuery<Overview>({ queryKey: ["/api/agency/overview"] });
}

function Frame({ icon, tint, kind, title, subtitle, back, actions, children }: {
  icon: LucideIcon; tint: string; kind: string; title: ReactNode; subtitle?: ReactNode;
  back?: { label: string; href: string }; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <SaHeader icon={icon} tint={tint} kind={kind} title={title} subtitle={subtitle} back={back} actions={actions} />
      <SaBody>{children}</SaBody>
    </div>
  );
}

async function openClient(id: string) {
  await apiRequest("POST", `/api/agency/clients/${id}/open`);
  sessionStorage.removeItem("lastPath");
  queryClient.clear();
  window.location.href = "/";
}

// ── Clients ──────────────────────────────────────────────────────────────────

export function AgencyClientsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: ov } = useAgencyOverview();
  const { data, isLoading } = useQuery<{ month: string; clients: ClientRow[] }>({ queryKey: ["/api/agency/clients"] });
  const [open, setOpen] = useState(false);
  const [creds, setCreds] = useState<{ username: string; tempPassword: string } | null>(null);
  const perms = ov?.agency.permissions;
  const clients = data?.clients ?? [];
  const atLimit = ov?.agency.maxAccounts !== null && ov?.agency.maxAccounts !== undefined && ov.clients >= ov.agency.maxAccounts;

  const opening = useMutation({
    mutationFn: openClient,
    onError: (e: Error) => toast({ title: "Couldn't open the client", description: e.message, variant: "destructive" }),
  });

  return (
    <Frame
      icon={Building2}
      tint="bg-teal-600"
      kind={ov?.agency.name ?? "Agency"}
      title="Clients"
      subtitle={ov ? `${ov.clients} client${ov.clients === 1 ? "" : "s"}${ov.agency.maxAccounts !== null ? ` of ${ov.agency.maxAccounts} on your plan` : ""}` : undefined}
      actions={perms?.createAccounts ? (
        <Button onClick={() => setOpen(true)} disabled={atLimit} title={atLimit ? "Your plan's client limit is reached" : undefined} data-testid="button-new-client">
          <Plus className="mr-1 h-4 w-4" />New client
        </Button>
      ) : undefined}
    >
      {ov && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Active clients" value={ov.activeClients} hint={`${ov.clients - ov.activeClients} paused`} />
          <Stat label={`AI actions in ${monthLabel(ov.month)}`} value={ov.actions.toLocaleString("en-IN")} hint="Replies, summaries, calls and other AI work" />
          {ov.spentUsd !== null && <Stat label="AI cost this month" value={formatUsd(ov.spentUsd)} hint={ov.agency.currency === "INR" ? `≈ ₹${Math.round(ov.spentUsd * ov.usdInrRate).toLocaleString("en-IN")}` : undefined} />}
          {ov.agency.aiCap && (
            <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
              <p className="text-[12px] text-gray-500">Your monthly AI cap</p>
              <p className="mt-1 text-[22px] font-semibold tabular-nums text-gray-900">{ov.agency.aiCap.percentUsed}% used</p>
              <div className="mt-2"><UsageBar percent={ov.agency.aiCap.percentUsed} warnAt={ov.agency.aiCap.warnAtPercent} /></div>
              <p className="mt-1 text-[12px] text-gray-500">{ov.agency.aiCap.action === "block" ? "AI pauses for all clients at 100%" : "You'll be warned near the cap"}{ov.agency.aiCap.monthlyAiCapUsd !== null ? ` · cap ${formatUsd(ov.agency.aiCap.monthlyAiCapUsd)}` : ""}</p>
            </div>
          )}
        </div>
      )}

      <Panel>
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : clients.length === 0 ? (
          <div className="rounded-xl bg-gray-50 px-4 py-10 text-center">
            <p className="text-[15px] font-medium text-gray-900">No clients yet</p>
            <p className="mt-1 text-[13px] text-gray-500">{perms?.createAccounts ? "Create your first client: name, website and the email they'll log in with." : "Your account manager will add your clients."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-black/[0.06] text-[12px] text-gray-500">
                  <th className="py-2 pr-3 font-medium">Client</th>
                  <th className="py-2 pr-3 font-medium">Switched on</th>
                  <th className="py-2 pr-3 font-medium">AI this month</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id} className="cursor-pointer border-b border-black/[0.04] last:border-0 hover:bg-gray-50" onClick={() => setLocation(`/agency/clients/${c.id}`)} data-testid={`row-client-${c.id}`}>
                    <td className="py-3 pr-3">
                      <p className="font-medium text-gray-900">{c.name}</p>
                      <p className="text-[12px] text-gray-500">{c.website.replace(/^https?:\/\//, "")}</p>
                    </td>
                    <td className="py-3 pr-3 text-[13px] text-gray-600">{AGENCY_FEATURES.filter(f => c.features[f.key]).map(f => f.label).join(", ") || "—"}</td>
                    <td className="py-3 pr-3">
                      <p className="tabular-nums">{c.spentUsd !== null ? formatUsd(c.spentUsd) : `${c.actions.toLocaleString("en-IN")} actions`}{c.limit?.monthlyLimitUsd ? ` of ${formatUsd(c.limit.monthlyLimitUsd)}` : ""}</p>
                      {c.percentOfLimit !== null && <div className="mt-1 w-28"><UsageBar percent={c.percentOfLimit} warnAt={c.limit?.warnAtPercent} /></div>}
                    </td>
                    <td className="py-3 pr-3"><StatusPill status={c.status} /></td>
                    <td className="py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {perms?.openClientPortal && (
                          <Button variant="ghost" size="sm" onClick={() => opening.mutate(c.id)} disabled={opening.isPending} data-testid={`button-open-client-${c.id}`}>
                            Open<ExternalLink className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        )}
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {ov && (
        <NewClientDialog
          open={open}
          onOpenChange={setOpen}
          overview={ov}
          onCreated={(c) => { setOpen(false); setCreds(c); }}
        />
      )}
      <CredentialsDialog credentials={creds} title="Client created" onClose={() => setCreds(null)} />
    </Frame>
  );
}

function NewClientDialog({ open, onOpenChange, overview, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  overview: Overview;
  onCreated: (creds: { username: string; tempPassword: string }) => void;
}) {
  const { toast } = useToast();
  const allowed = overview.agency.allowedFeatures;
  const seeCosts = overview.agency.permissions.seeCosts;
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [username, setUsername] = useState("");
  const [features, setFeatures] = useState<Partial<Record<AgencyFeatureKey, boolean>>>(() => (allowed.includes("chroneyEnabled") ? { chroneyEnabled: true } : {}));
  const [limit, setLimit] = useState(overview.agency.defaultClientLimitUsd !== null ? String(overview.agency.defaultClientLimitUsd) : "");

  const create = useMutation({
    mutationFn: () => apiRequest<{ credentials: { username: string; tempPassword: string } }>("POST", "/api/agency/clients", {
      name,
      website: /^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`,
      username,
      features: Object.entries(features).filter(([, on]) => on).map(([k]) => k),
      ...(seeCosts && overview.agency.permissions.setLimits ? { monthlyLimitUsd: limit.trim() === "" ? null : Number(limit) } : {}),
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agency/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agency/overview"] });
      setName(""); setWebsite(""); setUsername("");
      onCreated(res.credentials);
    },
    onError: (e: Error) => toast({ title: "Couldn't create the client", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
          <DialogDescription>The client gets its own login. You can change everything later.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Business name</Label>
            <Input id="client-name" value={name} onChange={e => setName(e.target.value)} autoFocus data-testid="input-client-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-website">Website</Label>
            <Input id="client-website" value={website} onChange={e => setWebsite(e.target.value)} placeholder="example.com" data-testid="input-client-website" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-login">Client's login email</Label>
            <Input id="client-login" type="email" value={username} onChange={e => setUsername(e.target.value)} placeholder="owner@client.com" data-testid="input-client-login" />
          </div>
          {seeCosts && overview.agency.permissions.setLimits && (
            <div className="space-y-1.5">
              <Label htmlFor="client-limit">Monthly AI limit ($)</Label>
              <Input id="client-limit" inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} placeholder="No limit" />
              <p className="text-[12px] text-gray-500">The client's AI pauses when it reaches this in a month.</p>
            </div>
          )}
          <div>
            <Label>Switch on</Label>
            <FeatureSwitches value={features} only={allowed} onChange={(k, on) => setFeatures({ ...features, [k]: on })} testIdPrefix="new-client-feature" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || !website.trim() || !username.trim() || create.isPending} data-testid="button-create-client">
              {create.isPending ? "Creating…" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── One client ───────────────────────────────────────────────────────────────

export function AgencyClientPage({ clientId }: { clientId: string }) {
  const { toast } = useToast();
  const { data: ov } = useAgencyOverview();
  const { data, isLoading } = useQuery<{ month: string; client?: ClientRow }>({ queryKey: [`/api/agency/clients/${clientId}`] });
  const [creds, setCreds] = useState<{ username: string; tempPassword: string } | null>(null);
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  const [details, setDetails] = useState<{ name: string; website: string } | null>(null);
  const perms = ov?.agency.permissions;
  const c = data?.client;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/agency/clients/${clientId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/agency/clients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/agency/overview"] });
  };
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, variant: "destructive" });

  const setFeature = useMutation({
    mutationFn: ({ key, on }: { key: AgencyFeatureKey; on: boolean }) => apiRequest("PATCH", `/api/agency/clients/${clientId}/features`, { features: { [key]: on } }),
    onSuccess: refresh,
    onError: fail("Couldn't change the feature"),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/agency/clients/${clientId}/status`, { status }),
    onSuccess: (_r, status) => { refresh(); toast({ title: status === "active" ? "Client restarted" : "Client paused" }); },
    onError: fail("Couldn't change the status"),
  });
  const saveLimit = useMutation({
    mutationFn: (value: string) => value.trim() === ""
      ? apiRequest("DELETE", `/api/agency/clients/${clientId}/limit`)
      : apiRequest("PUT", `/api/agency/clients/${clientId}/limit`, { monthlyLimitUsd: Number(value), action: "block" }),
    onSuccess: () => { setLimitDraft(null); refresh(); toast({ title: "AI limit saved" }); },
    onError: fail("Couldn't save the limit"),
  });
  const saveDetails = useMutation({
    mutationFn: (d: { name: string; website: string }) => apiRequest("PATCH", `/api/agency/clients/${clientId}`, d),
    onSuccess: () => { setDetails(null); refresh(); toast({ title: "Saved" }); },
    onError: fail("Couldn't save"),
  });
  const reset = useMutation({
    mutationFn: () => apiRequest<{ username: string; tempPassword: string }>("POST", `/api/agency/clients/${clientId}/reset-password`),
    onSuccess: setCreds,
    onError: fail("Couldn't reset the password"),
  });
  const opening = useMutation({ mutationFn: () => openClient(clientId), onError: fail("Couldn't open the client") });

  if (!isLoading && !c) {
    return <Frame icon={Building2} tint="bg-teal-600" kind="Client" title="Client not found" back={{ label: "Clients", href: "/agency" }}><p className="text-sm text-gray-500">This client isn't in your agency.</p></Frame>;
  }
  const limitValue = limitDraft ?? (c?.limit?.monthlyLimitUsd ? String(c.limit.monthlyLimitUsd) : "");
  const d = details ?? (c ? { name: c.name, website: c.website } : { name: "", website: "" });

  return (
    <Frame
      icon={Building2}
      tint="bg-teal-600"
      kind="Client"
      title={c?.name ?? "Loading…"}
      subtitle={c ? <span className="inline-flex items-center gap-2"><StatusPill status={c.status} />{c.website.replace(/^https?:\/\//, "")}</span> : undefined}
      back={{ label: "Clients", href: "/agency" }}
      actions={c && (
        <>
          {perms?.openClientPortal && <Button onClick={() => opening.mutate()} disabled={opening.isPending} data-testid="button-open-client">Open their portal<ExternalLink className="ml-1 h-4 w-4" /></Button>}
          {perms?.suspendAccounts && (c.status === "active"
            ? <Button variant="outline" onClick={() => setStatus.mutate("suspended")} data-testid="button-pause-client"><Pause className="mr-1 h-4 w-4" />Pause</Button>
            : <Button variant="outline" onClick={() => setStatus.mutate("active")} data-testid="button-restart-client"><Play className="mr-1 h-4 w-4" />Restart</Button>)}
        </>
      )}
    >
      {c && ov && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Features" subtitle={perms?.editFeatures ? "Switch on what this client pays you for." : "Ask your account manager to change these."}>
            <FeatureSwitches
              value={c.features}
              only={Array.from(new Set([...ov.agency.allowedFeatures, ...AGENCY_FEATURES.filter(f => c.features[f.key]).map(f => f.key)]))}
              disabled={!perms?.editFeatures || setFeature.isPending}
              onChange={(key, on) => {
                if (!ov.agency.allowedFeatures.includes(key)) {
                  toast({ title: "Not in your plan", description: "Your account manager switched this on; only they can change it.", variant: "destructive" });
                  return;
                }
                setFeature.mutate({ key, on });
              }}
            />
          </Panel>

          <div className="space-y-5">
            <Panel title={`AI use in ${monthLabel(data!.month)}`}>
              <div className="space-y-3">
                <p className="text-[22px] font-semibold tabular-nums text-gray-900">
                  {c.spentUsd !== null ? formatUsd(c.spentUsd) : `${c.actions.toLocaleString("en-IN")} AI actions`}
                </p>
                {c.spentUsd !== null && <p className="text-[13px] text-gray-500">{c.actions.toLocaleString("en-IN")} AI actions</p>}
                {c.percentOfLimit !== null && (
                  <div><UsageBar percent={c.percentOfLimit} warnAt={c.limit?.warnAtPercent} /><p className="mt-1 text-[12px] text-gray-500">{c.percentOfLimit}% of the monthly limit{c.limit?.action === "block" ? " · AI pauses at 100%" : ""}</p></div>
                )}
                {perms?.setLimits && perms.seeCosts && (
                  <form className="flex flex-wrap items-end gap-2 border-t border-black/[0.05] pt-3" onSubmit={(e) => { e.preventDefault(); saveLimit.mutate(limitValue); }}>
                    <div className="space-y-1.5">
                      <Label htmlFor="limit">Monthly AI limit ($)</Label>
                      <Input id="limit" inputMode="decimal" className="w-40" value={limitValue} onChange={e => setLimitDraft(e.target.value)} placeholder="No limit" data-testid="input-client-limit" />
                    </div>
                    <Button type="submit" variant="outline" disabled={saveLimit.isPending}>Save limit</Button>
                  </form>
                )}
              </div>
            </Panel>

            <Panel title="Login">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-gray-900">{c.login?.username ?? "No login"}</p>
                  <p className="text-[12px] text-gray-500">{c.login?.lastLoginAt ? `Last login ${new Date(c.login.lastLoginAt).toLocaleDateString("en-IN")}` : "Hasn't logged in yet"}</p>
                </div>
                {perms?.resetClientLogins && c.login && (
                  <Button variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending}><KeyRound className="mr-1 h-4 w-4" />New temporary password</Button>
                )}
              </div>
            </Panel>

            {perms?.createAccounts && (
              <Panel title="Details">
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveDetails.mutate(d); }}>
                  <div className="space-y-1.5">
                    <Label htmlFor="d-name">Business name</Label>
                    <Input id="d-name" value={d.name} onChange={e => setDetails({ ...d, name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="d-web">Website</Label>
                    <Input id="d-web" value={d.website} onChange={e => setDetails({ ...d, website: e.target.value })} />
                  </div>
                  <div className="flex justify-end"><Button type="submit" variant="outline" disabled={!details || saveDetails.isPending}>Save details</Button></div>
                </form>
              </Panel>
            )}
          </div>
        </div>
      )}
      <CredentialsDialog credentials={creds} title="New temporary password" onClose={() => setCreds(null)} />
    </Frame>
  );
}

// ── Monthly bill ─────────────────────────────────────────────────────────────

export function AgencyStatementPage() {
  const { data: ov } = useAgencyOverview();
  const current = ov?.month;
  const [month, setMonth] = useState<string | null>(null);
  const m = month ?? current;
  const { data, isLoading } = useQuery<AgencyStatement & { notes: string }>({ queryKey: [`/api/agency/statement?month=${m}`], enabled: !!m });
  return (
    <Frame
      icon={Receipt}
      tint="bg-emerald-600"
      kind={ov?.agency.name ?? "Agency"}
      title="Monthly bill"
      subtitle="What we charge your agency. You set your own prices for your clients."
      actions={current && (
        <Select value={m!} onValueChange={setMonth}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{recentMonths(current).map(x => <SelectItem key={x} value={x}>{monthLabel(x)}</SelectItem>)}</SelectContent>
        </Select>
      )}
    >
      <Panel>
        {isLoading || !data ? <p className="text-sm text-gray-500">Loading…</p> : <StatementView statement={data} />}
        {data?.notes && <p className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-[13px] text-gray-600">{data.notes}</p>}
      </Panel>
    </Frame>
  );
}

// ── Team ─────────────────────────────────────────────────────────────────────

export function AgencyTeamPage() {
  const { toast } = useToast();
  const { data: ov } = useAgencyOverview();
  const { data } = useQuery<{ logins: { userId: string; username: string; role: string; lastLoginAt: string | null }[]; canManage: boolean }>({ queryKey: ["/api/agency/team"] });
  const [email, setEmail] = useState("");
  const [creds, setCreds] = useState<{ username: string; tempPassword: string } | null>(null);
  const add = useMutation({
    mutationFn: () => apiRequest<{ credentials: { username: string; tempPassword: string } }>("POST", "/api/agency/team", { username: email }),
    onSuccess: (res) => { setEmail(""); setCreds(res.credentials); queryClient.invalidateQueries({ queryKey: ["/api/agency/team"] }); },
    onError: (e: Error) => toast({ title: "Couldn't add the login", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/agency/team/${userId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/agency/team"] }); toast({ title: "Login removed" }); },
    onError: (e: Error) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
  });
  return (
    <Frame icon={UsersRound} tint="bg-indigo-600" kind={ov?.agency.name ?? "Agency"} title="Team" subtitle="Everyone at your agency who can manage your clients.">
      <Panel>
        <div className="divide-y divide-black/[0.05]">
          {(data?.logins ?? []).map(l => (
            <div key={l.userId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-gray-900">{l.username}{l.username === ov?.me.username && <span className="ml-2 text-[12px] text-gray-500">(you)</span>}</p>
                <p className="text-[12px] text-gray-500">{l.role === "owner" ? "Owner" : "Staff"} · {l.lastLoginAt ? `last login ${new Date(l.lastLoginAt).toLocaleDateString("en-IN")}` : "never logged in"}</p>
              </div>
              {data?.canManage && l.role !== "owner" && (
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(l.userId)} title="Remove login"><Trash2 className="h-4 w-4" /></Button>
              )}
            </div>
          ))}
        </div>
        {data?.canManage ? (
          <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-black/[0.05] pt-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <div className="min-w-[240px] flex-1 space-y-1.5">
              <Label htmlFor="staff-email">Add a staff login</Label>
              <Input id="staff-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="colleague@agency.com" />
            </div>
            <Button type="submit" disabled={!email.trim() || add.isPending}><Plus className="mr-1 h-4 w-4" />Add</Button>
          </form>
        ) : (
          <p className="mt-4 text-[13px] text-gray-500">{ov?.me.role === "owner" ? "Your plan doesn't include adding logins. Please contact your account manager." : "Only your agency's main login can add or remove people."}</p>
        )}
      </Panel>
      <CredentialsDialog credentials={creds} title="Login added" onClose={() => setCreds(null)} />
    </Frame>
  );
}

// ── Brand ────────────────────────────────────────────────────────────────────

export function AgencyBrandPage() {
  const { toast } = useToast();
  const { data: ov } = useAgencyOverview();
  const refreshBrand = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/agency/overview"] });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  };
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, variant: "destructive" });
  const save = useMutation({
    mutationFn: (branding: AgencyBranding) => apiRequest("PUT", "/api/agency/branding", branding),
    onSuccess: () => { refreshBrand(); toast({ title: "Saved" }); },
    onError: fail("Couldn't save"),
  });
  const logo = useMutation({
    mutationFn: (dataUrl: string | null) => apiRequest("PUT", "/api/agency/logo", { logo: dataUrl }),
    onSuccess: () => { refreshBrand(); toast({ title: "Logo saved" }); },
    onError: fail("Couldn't save the logo"),
  });
  const domain = useMutation({
    mutationFn: (name: string | null) => apiRequest("PUT", "/api/agency/domain", { domain: name }),
    onSuccess: () => { refreshBrand(); toast({ title: "Web address saved" }); },
    onError: fail("Couldn't save the web address"),
  });
  const check = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agency/domain/check"),
    onSuccess: refreshBrand,
    onError: fail("Couldn't check"),
  });
  const perms = ov?.agency.permissions;
  return (
    <Frame icon={Palette} tint="bg-fuchsia-600" kind={ov?.agency.name ?? "Agency"} title="Brand" subtitle="What your clients and their website visitors see.">
      {!ov ? <p className="text-sm text-gray-500">Loading…</p> : (
        <>
          <Panel>
            <BrandForm key={ov.agency.id} branding={ov.agency.branding} saving={save.isPending} onSave={(b) => save.mutate(b)} allowPlatform={false} />
          </Panel>
          <LogoPanel logoUrl={ov.agency.logoUrl} saving={logo.isPending} onSave={(d) => logo.mutate(d)} disabled={!perms?.editBranding} />
          <DomainPanel
            key={ov.agency.domain.name ?? "none"}
            domain={ov.agency.domain}
            canEdit={!!perms?.setCustomDomain}
            saving={domain.isPending}
            checking={check.isPending}
            onSave={(n) => domain.mutate(n)}
            onCheck={() => check.mutate()}
          />
        </>
      )}
    </Frame>
  );
}
