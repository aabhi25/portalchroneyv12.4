import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Video, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface KeyStatus { set: boolean; masked: string | null; updatedAt: string | null }

interface AdminView {
  businessAccountId: string;
  businessName: string;
  settings: {
    enabled: boolean;
    provider: string;
    avatarId: string | null;
    providerOptions: Record<string, unknown>;
    displayName: string | null;
    styleHint: string;
    disclosureEnabled: boolean;
    disclosureText: string | null;
    monthlyMinuteCap: number;
    maxConcurrentSessions: number;
    maxSessionMinutes: number;
    idleTimeoutSeconds: number;
    allowPlatformKey: boolean;
    voiceNote: string | null;
    commercialNotes: string | null;
    parentalConsentConfirmed: boolean;
    parentalConsentConfirmedBy: string | null;
    parentalConsentConfirmedAt: string | null;
  };
  keys: Record<string, KeyStatus>;
  platformKeys: Record<string, boolean>;
  effectiveKeySource: "business" | "platform" | null;
  canStart: boolean;
  warnings: string[];
  childrensAccount: boolean;
  voiceModeEnabled: boolean;
  providers: Array<{ id: string; label: string }>;
  usage: { month: string; minutes: number; sessions: number; liveSessions: number; costUsd: number };
  recentSessions: Array<{ id: string; provider: string; startedAt: string; seconds: number; endReason: string | null; status: string }>;
}

type Form = AdminView["settings"];

const queryKey = (id: string) => ["/api/super-admin/avatar/accounts", id];

function ProviderKeyRow({ businessAccountId, provider, label, status, prominent }: { businessAccountId: string; provider: string; label: string; status: KeyStatus | undefined; prominent: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKey(businessAccountId) });

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/super-admin/avatar/accounts/${businessAccountId}/keys/${provider}`, { apiKey: value }),
    onSuccess: () => { setValue(""); setEditing(false); setTestResult(null); refresh(); toast({ title: `${label} key saved` }); },
    onError: (e: Error) => toast({ title: "Could not save key", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/super-admin/avatar/accounts/${businessAccountId}/keys/${provider}`),
    onSuccess: () => { setTestResult(null); refresh(); toast({ title: `${label} key removed` }); },
    onError: (e: Error) => toast({ title: "Could not remove key", description: e.message, variant: "destructive" }),
  });
  const test = useMutation({
    // Tests the typed key (not saved) when editing, else the stored key.
    mutationFn: () => apiRequest<{ ok: boolean; detail?: string; error?: string }>("POST", `/api/super-admin/avatar/accounts/${businessAccountId}/keys/${provider}/test`, editing && value ? { apiKey: value } : {}),
    onSuccess: (r) => setTestResult({ ok: r.ok, text: r.ok ? `Key works${r.detail ? ` (${r.detail})` : ""}` : r.error || "Key rejected" }),
    onError: (e: Error) => setTestResult({ ok: false, text: e.message }),
  });

  return (
    <div className={`rounded-lg border p-3 ${prominent ? "border-purple-300 bg-purple-50/40" : "border-gray-200"}`} data-testid={`avatar-key-${provider}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <KeyRound className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <span className="text-sm font-medium truncate">{label}</span>
          {prominent && <Badge variant="secondary" className="text-[10px]">selected provider</Badge>}
        </div>
        {status?.set ? (
          <span className="font-mono text-xs text-gray-700" data-testid={`text-avatar-key-mask-${provider}`}>{status.masked}</span>
        ) : (
          <span className="text-xs text-gray-500">Not set</span>
        )}
      </div>
      {editing || !status?.set ? (
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
          <Input
            type="password"
            autoComplete="off"
            placeholder={`${label} API key`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid={`input-avatar-key-${provider}`}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={value.trim().length < 8 || save.isPending} data-testid={`button-save-avatar-key-${provider}`}>
              {save.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={value.trim().length < 8 || test.isPending}>Test key</Button>
            {status?.set && <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setValue(""); }}>Cancel</Button>}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => { setEditing(true); setTestResult(null); }} data-testid={`button-replace-avatar-key-${provider}`}>Replace</Button>
          <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending} data-testid={`button-test-avatar-key-${provider}`}>
            {test.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Test key
          </Button>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove.mutate()} disabled={remove.isPending} data-testid={`button-remove-avatar-key-${provider}`}>Remove</Button>
        </div>
      )}
      {testResult && (
        <p className={`mt-2 flex items-center gap-1 text-xs ${testResult.ok ? "text-emerald-700" : "text-red-700"}`}>
          {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{testResult.text}
        </p>
      )}
    </div>
  );
}

/** Super admin: the "Live AI avatar" card for one business account. */
export function LiveAvatarSettingsDialog({ businessAccountId, businessName, open, onOpenChange }: { businessAccountId: string; businessName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<AdminView>({
    queryKey: queryKey(businessAccountId),
    queryFn: async () => {
      const res = await fetch(`/api/super-admin/avatar/accounts/${businessAccountId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load avatar settings");
      return res.json();
    },
    enabled: open,
  });
  const [form, setForm] = useState<Form | null>(null);
  // Initialise once; key saves refresh `data` but must not wipe unsaved form edits.
  useEffect(() => { if (data && !form) setForm(data.settings); }, [data, form]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = useMutation({
    mutationFn: () => apiRequest<AdminView>("PUT", `/api/super-admin/avatar/accounts/${businessAccountId}`, {
      enabled: form!.enabled,
      provider: form!.provider,
      avatarId: form!.avatarId || null,
      providerOptions: form!.providerOptions || {},
      displayName: form!.displayName || null,
      styleHint: form!.styleHint,
      disclosureEnabled: form!.disclosureEnabled,
      disclosureText: form!.disclosureText || null,
      monthlyMinuteCap: Number(form!.monthlyMinuteCap),
      maxConcurrentSessions: Number(form!.maxConcurrentSessions),
      maxSessionMinutes: Number(form!.maxSessionMinutes),
      idleTimeoutSeconds: Number(form!.idleTimeoutSeconds),
      allowPlatformKey: form!.allowPlatformKey,
      voiceNote: form!.voiceNote || null,
      commercialNotes: form!.commercialNotes || null,
      ...(data?.childrensAccount ? { parentalConsentConfirmed: form!.parentalConsentConfirmed } : {}),
    }),
    onSuccess: (view) => {
      queryClient.setQueryData(queryKey(businessAccountId), view);
      setForm(view.settings);
      toast({ title: "Live AI avatar settings saved", description: businessName });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const providerLabel = (id: string) => data?.providers.find((p) => p.id === id)?.label || id;
  const opts = (form?.providerOptions || {}) as Record<string, any>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-purple-600" />Live AI avatar — {businessName}</DialogTitle>
          <DialogDescription>
            Commercial add-on. Choose the provider this account signed for, its avatar and limits. The avatar only renders our own
            voice answers (our brain and ElevenLabs voice) and starts only when a visitor taps it.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !form ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />{isError ? "Failed to load" : "Loading…"}</div>
        ) : (
          <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1" data-testid="avatar-settings-form">
            {data!.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
                {data!.warnings.map((w) => (
                  <p key={w} className="flex items-center gap-2 text-sm text-amber-900" data-testid="text-avatar-warning"><AlertTriangle className="h-4 w-4 flex-shrink-0" />{w}</p>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">Enabled</p>
                <p className="text-xs text-muted-foreground">Shows a "Talk to {form.displayName || "AI Assistant"}" button in the widget (needs voice mode).</p>
              </div>
              <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} data-testid="switch-avatar-enabled" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Provider</Label>
                <Select value={form.provider} onValueChange={(v) => setForm((f) => (f ? { ...f, provider: v, providerOptions: {} } : f))}>
                  <SelectTrigger data-testid="select-avatar-provider"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {data!.providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="avatar-id">{form.provider === "anam" ? "Anam avatar id" : "Avatar id"}</Label>
                <Input id="avatar-id" value={form.avatarId || ""} onChange={(e) => set("avatarId", e.target.value)} placeholder="from the provider's dashboard" data-testid="input-avatar-id" />
              </div>
              {form.provider === "anam" && (
                <div>
                  <Label>Anam model</Label>
                  <Select value={String(opts.avatarModel || "default")} onValueChange={(v) => set("providerOptions", v === "default" ? {} : { avatarModel: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Provider default</SelectItem>
                      <SelectItem value="cara-3">cara-3</SelectItem>
                      <SelectItem value="cara-4">cara-4</SelectItem>
                      <SelectItem value="cara-4-latest">cara-4-latest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {form.provider === "heygen_liveavatar" && (
                <div className="flex items-end gap-2 pb-2">
                  <Switch checked={opts.sandbox === true} onCheckedChange={(v) => set("providerOptions", { ...opts, sandbox: v })} />
                  <span className="text-sm">Sandbox session (testing)</span>
                </div>
              )}
              <div>
                <Label htmlFor="avatar-name">Display name</Label>
                <Input id="avatar-name" maxLength={80} value={form.displayName || ""} onChange={(e) => set("displayName", e.target.value)} placeholder="e.g. Maya" data-testid="input-avatar-display-name" />
              </div>
              <div>
                <Label>Avatar style</Label>
                <Select value={form.styleHint} onValueChange={(v) => set("styleHint", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="realistic">Realistic</SelectItem>
                    <SelectItem value="stylised">Stylised (recommended for children)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <p className="font-medium">Provider API key</p>
              <p className="text-xs text-muted-foreground">
                The business's own key for each provider. Keys are encrypted; only the last 4 characters are ever shown.
              </p>
              {data!.providers.filter((p) => p.id === form.provider).concat(data!.providers.filter((p) => p.id !== form.provider)).map((p) => (
                <ProviderKeyRow key={p.id} businessAccountId={businessAccountId} provider={p.id} label={p.label} status={data!.keys[p.id]} prominent={p.id === form.provider} />
              ))}
              <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                <div className="pr-3">
                  <p className="text-sm font-medium">Allow platform key (we pay)</p>
                  <p className="text-xs text-muted-foreground">
                    Used only when this account has no key of its own for the selected provider.
                    {data!.platformKeys[form.provider] ? "" : " No platform key is configured for this provider."}
                  </p>
                </div>
                <Switch checked={form.allowPlatformKey} onCheckedChange={(v) => set("allowPlatformKey", v)} data-testid="switch-avatar-allow-platform" />
              </div>
              <p className="text-xs text-gray-600" data-testid="text-avatar-key-source">
                {data!.effectiveKeySource === "business" ? "Sessions will use this account's own key."
                  : data!.effectiveKeySource === "platform" ? "Sessions will use the platform key (billed to us)."
                  : `No API key for ${providerLabel(data!.settings.provider)} — the avatar cannot start.`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><Label htmlFor="cap">Minutes / month</Label><Input id="cap" type="number" min={1} value={form.monthlyMinuteCap} onChange={(e) => set("monthlyMinuteCap", Number(e.target.value))} data-testid="input-avatar-cap" /></div>
              <div><Label htmlFor="conc">Max at once</Label><Input id="conc" type="number" min={1} value={form.maxConcurrentSessions} onChange={(e) => set("maxConcurrentSessions", Number(e.target.value))} /></div>
              <div><Label htmlFor="maxmin">Max call (min)</Label><Input id="maxmin" type="number" min={1} value={form.maxSessionMinutes} onChange={(e) => set("maxSessionMinutes", Number(e.target.value))} /></div>
              <div><Label htmlFor="idle">Idle end (sec)</Label><Input id="idle" type="number" min={15} value={form.idleTimeoutSeconds} onChange={(e) => set("idleTimeoutSeconds", Number(e.target.value))} /></div>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Spoken AI disclosure</p>
                  <p className="text-xs text-muted-foreground">First line of every avatar call. {"{name}"} and {"{business}"} are filled in.</p>
                </div>
                <Switch checked={form.disclosureEnabled} onCheckedChange={(v) => set("disclosureEnabled", v)} />
              </div>
              {form.disclosureEnabled && (
                <Textarea rows={2} maxLength={300} value={form.disclosureText || ""} onChange={(e) => set("disclosureText", e.target.value)} placeholder="Hi, I'm {name}, {business}'s AI assistant. You're talking to an AI avatar, so you can switch to text at any time." />
              )}
            </div>

            {data!.childrensAccount && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={form.parentalConsentConfirmed} onCheckedChange={(v) => set("parentalConsentConfirmed", v === true)} data-testid="checkbox-avatar-consent" />
                  <span>
                    This is a children's education account. I confirm verifiable parental consent covers the AI avatar (the provider receives the
                    avatar's audio only; no camera is ever used).
                    {data!.settings.parentalConsentConfirmedAt && (
                      <span className="block text-xs text-blue-800">Confirmed {new Date(data!.settings.parentalConsentConfirmedAt).toLocaleString()}</span>
                    )}
                  </span>
                </label>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label htmlFor="voice-note">Voice note</Label><Textarea id="voice-note" rows={2} maxLength={500} value={form.voiceNote || ""} onChange={(e) => set("voiceNote", e.target.value)} placeholder="We always use our ElevenLabs voice." /></div>
              <div><Label htmlFor="commercial">Commercial plan notes</Label><Textarea id="commercial" rows={2} maxLength={2000} value={form.commercialNotes || ""} onChange={(e) => set("commercialNotes", e.target.value)} placeholder="e.g. 1,500 min/month pack, signed 2026-10" /></div>
            </div>

            <div className="rounded-lg bg-gray-50 p-3 text-sm" data-testid="avatar-usage">
              <p><span className="font-medium">This month:</span> {data!.usage.minutes} of {data!.settings.monthlyMinuteCap} min · {data!.usage.sessions} sessions · {data!.usage.liveSessions} live now · est. ${data!.usage.costUsd.toFixed(2)}</p>
              {data!.recentSessions.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
                  {data!.recentSessions.slice(0, 5).map((s) => (
                    <li key={s.id}>{new Date(s.startedAt).toLocaleString()} · {providerLabel(s.provider)} · {Math.round(s.seconds)}s · {s.status === "live" ? "live" : s.endReason || s.status}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => save.mutate()} disabled={!form || save.isPending} data-testid="button-save-avatar-settings">
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
