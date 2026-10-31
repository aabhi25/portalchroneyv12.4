import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Mail, Package, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CredentialsDialog, FeatureSwitches, Panel, formatMoney, formatUsd } from "@/components/agency/agencyUi";
import {
  AGENCY_FEATURES, EMAIL_PROVIDERS,
  type AgencyEmailView, type AgencyFeatureKey, type AgencyPackageDto,
} from "@shared/agency";

/**
 * Agency phase 3 pieces, shared by the agency portal and the super admin agency page:
 * packages, a client's logins, prepaid credits and branded email settings.
 */

type Creds = { username: string; tempPassword: string };
type EmailResult = { ok: boolean; error?: string } | null;

// ── Packages ─────────────────────────────────────────────────────────────────

export function PackageDialog({ open, onOpenChange, initial, allowed, currency, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: AgencyPackageDto | null;
  allowed: AgencyFeatureKey[];
  currency: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [f, setF] = useState(() => ({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    features: Object.fromEntries((initial?.features ?? ["chroneyEnabled"]).filter(k => allowed.includes(k)).map(k => [k, true])) as Partial<Record<AgencyFeatureKey, boolean>>,
    limit: initial?.monthlyLimitUsd != null ? String(initial.monthlyLimitUsd) : "",
    maxLogins: initial?.maxLogins != null ? String(initial.maxLogins) : "",
    price: initial?.price != null ? String(initial.price) : "",
    applyToClients: true,
  }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name, description: f.description,
        features: Object.entries(f.features).filter(([, on]) => on).map(([k]) => k),
        monthlyLimitUsd: f.limit.trim() === "" ? null : Number(f.limit),
        maxLogins: f.maxLogins.trim() === "" ? null : Number(f.maxLogins),
        price: f.price.trim() === "" ? null : Number(f.price),
        applyToClients: f.applyToClients,
      };
      return initial ? apiRequest<{ updatedClients: number }>("PUT", `/api/agency/packages/${initial.id}`, body) : apiRequest("POST", "/api/agency/packages", body);
    },
    onSuccess: (r: { updatedClients?: number }) => {
      toast({ title: "Package saved", description: r?.updatedClients ? `${r.updatedClients} client${r.updatedClients === 1 ? "" : "s"} updated.` : undefined });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Couldn't save the package", description: e.message, variant: "destructive" }),
  });
  const sym = currency === "INR" ? "₹" : "$";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "New package"}</DialogTitle>
          <DialogDescription>A bundle you sell your clients. Applying it sets the client's features and AI limit.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pkg-name">Name</Label>
              <Input id="pkg-name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Starter" autoFocus data-testid="input-package-name" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pkg-desc">Short description <span className="font-normal text-gray-500">(optional)</span></Label>
              <Input id="pkg-desc" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-limit">Monthly AI limit ($)</Label>
              <Input id="pkg-limit" inputMode="decimal" value={f.limit} onChange={e => setF({ ...f, limit: e.target.value })} placeholder="No limit" data-testid="input-package-limit" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-logins">Logins per client</Label>
              <Input id="pkg-logins" inputMode="numeric" value={f.maxLogins} onChange={e => setF({ ...f, maxLogins: e.target.value.replace(/[^\d]/g, "") })} placeholder="Your plan's default" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pkg-price">Your price ({sym}/month)</Label>
              <Input id="pkg-price" inputMode="decimal" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} placeholder="Optional" />
              <p className="text-[12px] text-gray-500">For your own reference; clients never see it.</p>
            </div>
          </div>
          <div>
            <Label>Features included</Label>
            <FeatureSwitches value={f.features} only={allowed} onChange={(k, on) => setF({ ...f, features: { ...f.features, [k]: on } })} testIdPrefix="package-feature" />
          </div>
          {initial && initial.clients > 0 && (
            <label className="flex items-center gap-2 text-[13px] text-gray-700">
              <Checkbox checked={f.applyToClients} onCheckedChange={(v) => setF({ ...f, applyToClients: v === true })} />
              Also update the {initial.clients} client{initial.clients === 1 ? "" : "s"} on this package
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!f.name.trim() || save.isPending} data-testid="button-save-package">{save.isPending ? "Saving…" : "Save package"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PackagesList({ packages, currency, canEdit, onEdit, onDelete }: {
  packages: AgencyPackageDto[];
  currency: string;
  canEdit: boolean;
  onEdit?: (p: AgencyPackageDto) => void;
  onDelete?: (p: AgencyPackageDto) => void;
}) {
  if (packages.length === 0) {
    return <p className="text-[13px] text-gray-500">No packages yet.{canEdit ? " Create one, then pick it when you add or edit a client." : ""}</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {packages.map(p => (
        <div key={p.id} className="flex flex-col gap-2 rounded-2xl border border-black/[0.06] bg-white p-4" data-testid={`package-${p.id}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-semibold text-gray-900"><Package className="h-4 w-4 text-teal-600" />{p.name}</p>
              {p.description && <p className="text-[13px] text-gray-500">{p.description}</p>}
            </div>
            {p.price !== null && <p className="shrink-0 text-[14px] font-semibold tabular-nums text-gray-900">{formatMoney(p.price, currency)}<span className="text-[12px] font-normal text-gray-500">/mo</span></p>}
          </div>
          <p className="text-[13px] text-gray-600">{AGENCY_FEATURES.filter(f => p.features.includes(f.key)).map(f => f.label).join(", ") || "No features"}</p>
          <p className="text-[12px] text-gray-500">
            AI limit {p.monthlyLimitUsd !== null ? formatUsd(p.monthlyLimitUsd) : "none"} · {p.maxLogins !== null ? `${p.maxLogins} login${p.maxLogins === 1 ? "" : "s"}` : "default logins"} · {p.clients} client{p.clients === 1 ? "" : "s"}
          </p>
          {canEdit && (
            <div className="mt-auto flex gap-1 pt-1">
              <Button size="sm" variant="outline" onClick={() => onEdit?.(p)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete?.(p)} title="Delete package"><Trash2 className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── A client account's logins ────────────────────────────────────────────────

interface LoginRow { userId: string; username: string; isMain: boolean; lastLoginAt: string | null }

/**
 * Logins of one client account. `base` is the API path (agency: /api/agency/clients/:id/logins;
 * the client's own main login: /api/account/logins).
 */
export function AccountLoginsPanel({ base, canAdd, canReset, emailReady: emailReadyProp, welcomeByDefault, title = "Logins" }: {
  base: string;
  canAdd: boolean;
  canReset: boolean;
  emailReady: boolean;
  welcomeByDefault: boolean;
  title?: string;
}) {
  const { toast } = useToast();
  const { data } = useQuery<{ logins: LoginRow[]; max: number | null; emailReady?: boolean }>({ queryKey: [base] });
  // The client's own page learns from the server whether its agency's email is set up.
  const emailReady = data?.emailReady ?? emailReadyProp;
  const [email, setEmail] = useState("");
  const [sendEmailChoice, setSendEmail] = useState<boolean | null>(null);
  const sendEmail = sendEmailChoice ?? (emailReady && welcomeByDefault);
  const [creds, setCreds] = useState<{ c: Creds; email: EmailResult } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [base] });
  const add = useMutation({
    mutationFn: () => apiRequest<{ credentials: Creds; email: EmailResult }>("POST", base, { username: email, sendEmail: emailReady && sendEmail }),
    onSuccess: (r) => { setEmail(""); setCreds({ c: r.credentials, email: r.email }); refresh(); },
    onError: (e: Error) => toast({ title: "Couldn't add the login", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `${base}/${userId}`),
    onSuccess: () => { refresh(); toast({ title: "Login removed" }); },
    onError: (e: Error) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
  });
  const reset = useMutation({
    mutationFn: (userId: string) => apiRequest<Creds & { email: EmailResult }>("POST", `${base}/${userId}/reset-password`, { sendEmail: emailReady && sendEmail }),
    onSuccess: (r) => setCreds({ c: { username: r.username, tempPassword: r.tempPassword }, email: r.email }),
    onError: (e: Error) => toast({ title: "Couldn't reset", description: e.message, variant: "destructive" }),
  });
  const logins = data?.logins ?? [];
  const full = data?.max != null && logins.length >= data.max;
  return (
    <Panel title={title} subtitle={data?.max != null ? `${logins.length} of ${data.max} logins used. Everyone has the same access.` : "Everyone has the same access."}>
      <div className="divide-y divide-black/[0.05]">
        {logins.map(l => (
          <div key={l.userId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[14px] text-gray-900">{l.username}{l.isMain && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">Main login</span>}</p>
              <p className="text-[12px] text-gray-500">{l.lastLoginAt ? `Last login ${new Date(l.lastLoginAt).toLocaleDateString("en-IN")}` : "Hasn't logged in yet"}</p>
            </div>
            <div className="flex items-center gap-1">
              {canReset && <Button variant="ghost" size="sm" onClick={() => reset.mutate(l.userId)} title="New temporary password"><KeyRound className="h-4 w-4" /></Button>}
              {canAdd && !l.isMain && <Button variant="ghost" size="sm" onClick={() => remove.mutate(l.userId)} title="Remove login"><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        ))}
      </div>
      {canAdd && (
        <form className="mt-3 space-y-2 border-t border-black/[0.05] pt-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <Label htmlFor={`${base}-email`}>Add a login</Label>
              <Input id={`${base}-email`} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="colleague@client.com" disabled={full} data-testid="input-add-login" />
            </div>
            <Button type="submit" variant="outline" disabled={!email.trim() || add.isPending || full} data-testid="button-add-login"><Plus className="mr-1 h-4 w-4" />Add</Button>
          </div>
          {full && <p className="text-[12px] text-amber-700">All logins for this account are in use.</p>}
          {emailReady && (
            <label className="flex items-center gap-2 text-[13px] text-gray-700">
              <Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(v === true)} />Email the login details
            </label>
          )}
        </form>
      )}
      <CredentialsDialog credentials={creds?.c ?? null} email={creds?.email} title="Login details" onClose={() => setCreds(null)} />
    </Panel>
  );
}

// ── Prepaid credits ──────────────────────────────────────────────────────────

export interface CreditsView {
  enabled: boolean;
  added: number;
  used: number;
  balance: number;
  currency: string;
  startedAt: string | null;
  lowThreshold: number | null;
  low: boolean;
  entries: { id: string; amount: number; note: string; createdAt: string }[];
}

export function CreditsSummary({ credits }: { credits: CreditsView }) {
  const c = credits.currency;
  const tone = credits.balance <= 0 ? "text-red-600" : credits.low ? "text-amber-700" : "text-gray-900";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
          <p className="text-[12px] text-gray-500">Balance</p>
          <p className={`mt-1 text-[22px] font-semibold tabular-nums ${tone}`} data-testid="credits-balance">{formatMoney(credits.balance, c)}</p>
          <p className="text-[12px] text-gray-500">{credits.balance <= 0 ? "AI is paused for every client" : credits.low ? "Running low" : "AI runs while this is above zero"}</p>
        </div>
        <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
          <p className="text-[12px] text-gray-500">Added</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums text-gray-900">{formatMoney(credits.added, c)}</p>
        </div>
        <div className="rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
          <p className="text-[12px] text-gray-500">Used by AI{credits.startedAt ? ` since ${new Date(credits.startedAt).toLocaleDateString("en-IN")}` : ""}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums text-gray-900">{formatMoney(credits.used, c)}</p>
        </div>
      </div>
      {credits.entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[14px]">
            <thead><tr className="border-b border-black/[0.06] text-[12px] text-gray-500"><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Note</th><th className="py-2 text-right font-medium">Amount</th></tr></thead>
            <tbody>
              {credits.entries.map(e => (
                <tr key={e.id} className="border-b border-black/[0.04] last:border-0">
                  <td className="py-2 pr-3 text-gray-600">{new Date(e.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="py-2 pr-3 text-gray-600">{e.note || (e.amount > 0 ? "Top-up" : "Correction")}</td>
                  <td className={`py-2 text-right tabular-nums ${e.amount < 0 ? "text-red-600" : "text-gray-900"}`}>{e.amount > 0 ? "+" : ""}{formatMoney(e.amount, c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Super admin: switch credits on, set the warning level, add top-ups or corrections. */
export function SuperAdminCreditsPanel({ agencyId, enabled, lowThreshold, onSettings }: {
  agencyId: string;
  enabled: boolean;
  lowThreshold: number | null;
  onSettings: (body: Record<string, unknown>) => void;
}) {
  const { toast } = useToast();
  const key = `/api/super-admin/agencies/${agencyId}/credits`;
  const { data } = useQuery<CreditsView>({ queryKey: [key] });
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [low, setLow] = useState(lowThreshold !== null ? String(lowThreshold) : "");
  const add = useMutation({
    mutationFn: () => apiRequest("POST", key, { amount: Number(amount), note }),
    onSuccess: () => { setAmount(""); setNote(""); queryClient.invalidateQueries({ queryKey: [key] }); toast({ title: "Credits updated" }); },
    onError: (e: Error) => toast({ title: "Couldn't add", description: e.message, variant: "destructive" }),
  });
  const sym = data?.currency === "USD" ? "$" : "₹";
  return (
    <Panel
      title={<span className="inline-flex items-center gap-2"><Wallet className="h-4 w-4 text-teal-600" />Prepaid AI credits</span>}
      subtitle="When on, the agency's AI use (our cost, converted, plus its markup) is taken from its credits instead of being billed, and all its clients pause at zero."
      actions={<Switch checked={enabled} onCheckedChange={(on) => onSettings({ creditsEnabled: on })} data-testid="switch-credits" />}
    >
      {enabled ? (
        <div className="space-y-5">
          {data && <CreditsSummary credits={data} />}
          <form className="flex flex-wrap items-end gap-2 border-t border-black/[0.05] pt-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <div className="w-40 space-y-1.5">
              <Label htmlFor="credit-amount">Amount ({sym})</Label>
              <Input id="credit-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 5000" data-testid="input-credit-amount" />
            </div>
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label htmlFor="credit-note">Note</Label>
              <Input id="credit-note" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Payment received 2 Nov" />
            </div>
            <Button type="submit" disabled={!amount.trim() || Number(amount) === 0 || add.isPending} data-testid="button-add-credits">Add</Button>
          </form>
          <p className="text-[12px] text-gray-500">Use a negative amount to correct a mistake.</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); onSettings({ creditLowThreshold: low.trim() === "" ? null : Number(low) }); }}>
            <div className="w-48 space-y-1.5">
              <Label htmlFor="credit-low">Warn the agency below ({sym})</Label>
              <Input id="credit-low" inputMode="decimal" value={low} onChange={e => setLow(e.target.value)} placeholder="No warning" />
            </div>
            <Button type="submit" variant="outline">Save</Button>
          </form>
        </div>
      ) : (
        <p className="text-[13px] text-gray-500">Off: AI use is billed on the monthly statement as set on the Billing tab. Switching on starts at a zero balance, which pauses the agency's AI until you add a top-up.</p>
      )}
    </Panel>
  );
}

// ── Branded email ────────────────────────────────────────────────────────────

/** `base`: /api/agency/email or /api/super-admin/agencies/:id/email. */
export function EmailSettingsPanel({ base, view, onSaved, canEdit, defaultTestTo }: {
  base: string;
  view: AgencyEmailView;
  onSaved: () => void;
  canEdit: boolean;
  defaultTestTo: string;
}) {
  const { toast } = useToast();
  const [f, setF] = useState({ provider: view.provider, apiKey: "", fromEmail: view.fromEmail, fromName: view.fromName, replyTo: view.replyTo, welcomeByDefault: view.welcomeByDefault });
  const [testTo, setTestTo] = useState(defaultTestTo);
  const save = useMutation({
    mutationFn: () => apiRequest("PUT", base, { ...f, apiKey: f.apiKey.trim() ? f.apiKey : undefined }),
    onSuccess: () => { setF({ ...f, apiKey: "" }); onSaved(); toast({ title: "Email settings saved" }); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: () => apiRequest<{ ok: boolean; error?: string }>("POST", `${base}/test`, { to: testTo }),
    onSuccess: (r) => r.ok ? toast({ title: "Test email sent", description: `Check ${testTo}.` }) : toast({ title: "The test email wasn't sent", description: r.error, variant: "destructive" }),
    onError: (e: Error) => toast({ title: "Couldn't send", description: e.message, variant: "destructive" }),
  });
  const providerHint = EMAIL_PROVIDERS.find(p => p.key === f.provider)?.hint;
  return (
    <Panel
      title={<span className="inline-flex items-center gap-2"><Mail className="h-4 w-4 text-teal-600" />Emails in your name</span>}
      subtitle="Login details and password reset emails to your clients go out from your address, with your logo and links to your web address. Your sender address must be verified with the email service."
      actions={view.ready ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-700">Ready</span> : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[12px] font-medium text-gray-600">Not set up</span>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Email service</Label>
            <Select value={f.provider || "none"} onValueChange={(v) => setF({ ...f, provider: v === "none" ? "" : v as AgencyEmailView["provider"] })} disabled={!canEdit}>
              <SelectTrigger data-testid="select-email-provider"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {EMAIL_PROVIDERS.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {providerHint && <p className="text-[12px] text-gray-500">{providerHint}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-key">API key</Label>
            <Input id="email-key" type="password" autoComplete="off" value={f.apiKey} onChange={e => setF({ ...f, apiKey: e.target.value })} placeholder={view.hasKey ? `Saved (ends ${view.apiKeyLast4}) — type to replace` : "Paste the key"} disabled={!canEdit} data-testid="input-email-key" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-from">Sender email</Label>
            <Input id="email-from" type="email" value={f.fromEmail} onChange={e => setF({ ...f, fromEmail: e.target.value })} placeholder="hello@youragency.com" disabled={!canEdit} data-testid="input-email-from" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-name">Sender name</Label>
            <Input id="email-name" value={f.fromName} onChange={e => setF({ ...f, fromName: e.target.value })} placeholder="Your brand name" disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-reply">Replies go to <span className="font-normal text-gray-500">(optional)</span></Label>
            <Input id="email-reply" type="email" value={f.replyTo} onChange={e => setF({ ...f, replyTo: e.target.value })} disabled={!canEdit} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-gray-700">
            <Checkbox checked={f.welcomeByDefault} onCheckedChange={(v) => setF({ ...f, welcomeByDefault: v === true })} disabled={!canEdit} />
            Email login details to new clients and logins by default
          </label>
        </div>
        {canEdit && <div className="flex justify-end"><Button type="submit" disabled={save.isPending} data-testid="button-save-email">{save.isPending ? "Saving…" : "Save email settings"}</Button></div>}
      </form>
      {view.ready && canEdit && (
        <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-black/[0.05] pt-4" onSubmit={(e) => { e.preventDefault(); test.mutate(); }}>
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <Label htmlFor="email-test">Send a test email to</Label>
            <Input id="email-test" type="email" value={testTo} onChange={e => setTestTo(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={!testTo.trim() || test.isPending} data-testid="button-test-email">{test.isPending ? "Sending…" : "Send test"}</Button>
        </form>
      )}
    </Panel>
  );
}
