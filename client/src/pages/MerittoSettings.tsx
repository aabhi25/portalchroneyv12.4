import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, RotateCcw, TableProperties, Trash2, XCircle, Zap } from "lucide-react";

interface MerittoSettingsData {
  enabled: boolean;
  hasAccessKey: boolean;
  hasSecretKey: boolean;
  createUrl: string;
  updateUrl: string;
  enabledAt: string | null;
}

interface Mapping {
  id: string;
  merittoField: string;
  sourceType: "dynamic" | "custom";
  sourceField: string | null;
  customValue: string | null;
  fallbackValue: string | null;
  displayName: string;
  isEnabled: string;
  sortOrder: number;
}

/** What a mapping can send. "journey.<saved as>" is typed in (the journey step's "Saved as" name). */
const SOURCES: { value: string; label: string }[] = [
  { value: "lead.name", label: "Lead: name" },
  { value: "lead.email", label: "Lead: email" },
  { value: "meritto.mobileNumber", label: "Lead: mobile (without country code)" },
  { value: "lead.phone", label: "Lead: mobile as captured" },
  { value: "meritto.dialCode", label: "Lead: country dial code (e.g. +91)" },
  { value: "meritto.mobileVerificationStatus", label: "Lead: mobile verified (verified / unverified)" },
  { value: "lead.sourceUrl", label: "Lead: page where it was captured" },
  { value: "lead.createdAt", label: "Lead: captured at" },
  { value: "lead.channel", label: "Lead: channel (Website)" },
  { value: "session.city", label: "Visitor: city" },
  { value: "session.utmSource", label: "Visitor: UTM source" },
  { value: "session.utmMedium", label: "Visitor: UTM medium" },
  { value: "session.utmCampaign", label: "Visitor: UTM campaign" },
  { value: "conversation.summary", label: "Chat: AI summary" },
  { value: "conversation.topics", label: "Chat: topics" },
  { value: "business.name", label: "Business: name" },
  { value: "journey", label: "Journey answer (by its \"Saved as\" name)…" },
];

const sourceLabel = (m: Mapping) => {
  if (m.sourceType === "custom") return `Fixed value: "${m.customValue ?? ""}"`;
  if (m.sourceField?.startsWith("journey.")) return `Journey answer: ${m.sourceField.slice(8)}`;
  return SOURCES.find(s => s.value === m.sourceField)?.label || m.sourceField || "";
};

const emptyDraft = { id: null as string | null, merittoField: "", sourceType: "dynamic" as "dynamic" | "custom", source: "lead.name", journeyKey: "", customValue: "", fallbackValue: "" };

/** Meritto (NoPaperForms) CRM: keys, auto-sync and field mappings. */
export default function MerittoSettings() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<MerittoSettingsData>({ queryKey: ["/api/meritto/settings"] });
  const { data: mappings = [] } = useQuery<Mapping[]>({ queryKey: ["/api/meritto/field-mappings"] });

  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [createUrl, setCreateUrl] = useState("");
  const [updateUrl, setUpdateUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [test, setTest] = useState<{ success: boolean; message: string } | null>(null);
  const [draft, setDraft] = useState<typeof emptyDraft | null>(null);

  useEffect(() => {
    if (settings) { setCreateUrl(settings.createUrl); setUpdateUrl(settings.updateUrl); }
  }, [settings]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/meritto/settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/meritto/field-mappings"] });
  };

  const saveKeys = useMutation({
    mutationFn: () => apiRequest("POST", "/api/meritto/settings", { accessKey, secretKey, createUrl, updateUrl }),
    onSuccess: () => { setAccessKey(""); setSecretKey(""); refresh(); toast({ title: "Meritto keys saved", description: "They are stored encrypted." }); },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("POST", "/api/meritto/settings", { enabled }),
    onSuccess: (_d, enabled) => { refresh(); toast({ title: enabled ? "Auto-sync is on" : "Auto-sync is off", description: enabled ? "New website leads go to Meritto about half a minute after they're ready." : undefined }); },
    onError: (e: Error) => toast({ title: "Could not change auto-sync", description: e.message, variant: "destructive" }),
  });
  const checkKeys = useMutation({
    mutationFn: () => apiRequest<{ success: boolean; message: string }>("POST", "/api/meritto/test-connection", { accessKey, secretKey }),
    onSuccess: setTest,
    onError: (e: Error) => setTest({ success: false, message: e.message }),
  });
  const saveMapping = useMutation({
    mutationFn: async (d: typeof emptyDraft) => {
      const body = {
        merittoField: d.merittoField.trim(),
        displayName: d.merittoField.trim(),
        sourceType: d.sourceType,
        sourceField: d.sourceType === "dynamic" ? (d.source === "journey" ? `journey.${d.journeyKey.trim()}` : d.source) : null,
        customValue: d.sourceType === "custom" ? d.customValue : null,
        fallbackValue: d.sourceType === "dynamic" ? d.fallbackValue : null,
      };
      return d.id ? apiRequest("PUT", `/api/meritto/field-mappings/${d.id}`, body) : apiRequest("POST", "/api/meritto/field-mappings", body);
    },
    onSuccess: () => { setDraft(null); refresh(); },
    onError: (e: Error) => toast({ title: "Could not save the field", description: e.message, variant: "destructive" }),
  });
  const removeMapping = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/meritto/field-mappings/${id}`),
    onSuccess: refresh,
  });
  const enableMapping = useMutation({
    mutationFn: (m: Mapping) => apiRequest("PUT", `/api/meritto/field-mappings/${m.id}`, { isEnabled: m.isEnabled !== "true" }),
    onSuccess: refresh,
  });
  const restoreDefaults = useMutation({
    mutationFn: () => apiRequest("POST", "/api/meritto/field-mappings/seed-defaults"),
    onSuccess: () => { refresh(); toast({ title: "Standard Meritto fields restored" }); },
  });

  if (isLoading || !settings) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  const hasKeys = settings.hasAccessKey && settings.hasSecretKey;

  const editMapping = (m: Mapping) => setDraft({
    id: m.id,
    merittoField: m.merittoField,
    sourceType: m.sourceType,
    source: m.sourceField?.startsWith("journey.") ? "journey" : (m.sourceField || "lead.name"),
    journeyKey: m.sourceField?.startsWith("journey.") ? m.sourceField.slice(8) : "",
    customValue: m.customValue || "",
    fallbackValue: m.fallbackValue || "",
  });

  return (
    <div className="max-w-4xl space-y-6 p-1" data-testid="meritto-settings">
      <div>
        <h2 className="text-2xl font-bold">Meritto CRM</h2>
        <p className="text-muted-foreground">Send website chat leads to Meritto (NoPaperForms): created when the lead is ready, updated when it changes.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-5 w-5 text-blue-600" /> Keys</CardTitle>
          <CardDescription>The access key and secret key Meritto gave you. They are stored encrypted and never shown again.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meritto-access">Access key</Label>
              <Input id="meritto-access" type={showKeys ? "text" : "password"} autoComplete="off" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} placeholder={settings.hasAccessKey ? "Saved — type to replace" : "access-key"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meritto-secret">Secret key</Label>
              <Input id="meritto-secret" type={showKeys ? "text" : "password"} autoComplete="off" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={settings.hasSecretKey ? "Saved — type to replace" : "secret-key"} />
            </div>
          </div>
          <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowKeys(v => !v)}>
            {showKeys ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {showKeys ? "Hide" : "Show"} what I type
          </button>
          <div>
            <button type="button" className="text-xs text-purple-700 hover:underline" onClick={() => setShowAdvanced(v => !v)}>{showAdvanced ? "Hide" : "Change"} API addresses</button>
            {showAdvanced && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="meritto-create">Create lead address</Label><Input id="meritto-create" value={createUrl} onChange={(e) => setCreateUrl(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="meritto-update">Update lead address</Label><Input id="meritto-update" value={updateUrl} onChange={(e) => setUpdateUrl(e.target.value)} /></div>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => saveKeys.mutate()} disabled={saveKeys.isPending || (!accessKey && !secretKey && createUrl === settings.createUrl && updateUrl === settings.updateUrl)} data-testid="button-save-meritto-keys">
              {saveKeys.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
            <Button variant="outline" onClick={() => { setTest(null); checkKeys.mutate(); }} disabled={checkKeys.isPending || (!hasKeys && !(accessKey && secretKey))} data-testid="button-check-meritto-keys">
              {checkKeys.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Check keys
            </Button>
            {hasKeys
              ? <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700"><CheckCircle2 className="mr-1 h-3 w-3" /> Keys saved</Badge>
              : <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Not set up</Badge>}
          </div>
          {test && (
            <p className={`flex items-center gap-1.5 text-sm ${test.success ? "text-green-700" : "text-red-600"}`} data-testid="meritto-check-result">
              {test.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />} {test.message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Zap className="h-5 w-5 text-purple-600" /> Auto-sync</CardTitle>
          <CardDescription>
            Website leads captured from the moment you switch this on are sent automatically, by the same rules as LeadSquared:
            a mobile or email, your mandatory details, and OTP / CAPTCHA when you use them.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm">
            {settings.enabled
              ? <>On{settings.enabledAt ? ` since ${new Date(settings.enabledAt).toLocaleDateString()}` : ""}. Changes to a lead (email added, course chosen) are sent as updates.</>
              : <>Off. Leads stay in AI Chroney until you switch it on (or use Sync on a lead).</>}
          </div>
          <Switch checked={settings.enabled} disabled={!hasKeys || toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} data-testid="switch-meritto-autosync" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><TableProperties className="h-5 w-5 text-orange-600" /> Fields sent to Meritto</CardTitle>
              <CardDescription>Each row is a field in Meritto's lead API (name, mobile, course, campus, …) and what AI Chroney puts in it.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => restoreDefaults.mutate()} disabled={restoreDefaults.isPending}><RotateCcw className="mr-1.5 h-4 w-4" /> Standard fields</Button>
              <Button size="sm" onClick={() => setDraft({ ...emptyDraft })} data-testid="button-add-meritto-field"><Plus className="mr-1.5 h-4 w-4" /> Add field</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {mappings.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No fields yet. Save your keys or click "Standard fields" to start with name, email, mobile and more.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {mappings.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2" data-testid={`meritto-field-${m.merittoField}`}>
                  <Switch checked={m.isEnabled === "true"} onCheckedChange={() => enableMapping.mutate(m)} aria-label={`Send ${m.merittoField}`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm">{m.merittoField}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {sourceLabel(m)}{m.fallbackValue ? ` · if empty: "${m.fallbackValue}"` : ""}
                    </div>
                  </div>
                  <button type="button" onClick={() => editMapping(m)} className="rounded p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => removeMapping.mutate(m.id)} className="rounded p-1.5 text-red-500 hover:bg-red-50" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Fields such as state, course, specialization, campus and lead_stage may need to match values set up in your Meritto account. Use a fixed value or a journey answer that uses those exact values.
          </p>
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{draft?.id ? "Edit field" : "Add a field"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mf-field">Meritto field</Label>
                <Input id="mf-field" value={draft.merittoField} onChange={(e) => setDraft({ ...draft, merittoField: e.target.value })} placeholder="e.g. course, specialization, campus, state" />
              </div>
              <div className="space-y-1.5">
                <Label>Send</Label>
                <Select value={draft.sourceType} onValueChange={(v) => setDraft({ ...draft, sourceType: v as "dynamic" | "custom" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dynamic">A value from the lead or chat</SelectItem>
                    <SelectItem value="custom">The same fixed value every time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.sourceType === "dynamic" ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Value</Label>
                    <Select value={draft.source} onValueChange={(v) => setDraft({ ...draft, source: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {draft.source === "journey" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="mf-journey">Journey question "Saved as" name</Label>
                      <Input id="mf-journey" value={draft.journeyKey} onChange={(e) => setDraft({ ...draft, journeyKey: e.target.value })} placeholder="e.g. course" />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="mf-fallback">If empty, send (optional)</Label>
                    <Input id="mf-fallback" value={draft.fallbackValue} onChange={(e) => setDraft({ ...draft, fallbackValue: e.target.value })} />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="mf-custom">Fixed value</Label>
                  <Input id="mf-custom" value={draft.customValue} onChange={(e) => setDraft({ ...draft, customValue: e.target.value })} placeholder="e.g. Online MBA" />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              onClick={() => draft && saveMapping.mutate(draft)}
              disabled={!draft?.merittoField.trim() || saveMapping.isPending || (draft?.sourceType === "dynamic" && draft.source === "journey" && !draft.journeyKey.trim())}
            >
              {saveMapping.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
