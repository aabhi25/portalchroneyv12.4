import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowRight, CheckCircle2, Copy, Eye, EyeOff, FileSpreadsheet, KeyRound, Loader2, Pencil, Plus, RotateCcw, TableProperties, Trash2, Undo2, XCircle, Zap } from "lucide-react";

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

/** Meritto's lists loaded for this account (server/services/merittoSetup.ts). */
interface MasterStatus {
  sheetUrl: string | null;
  programs: number;
  cities: number;
  loadedAt: string | null;
  canUndo: boolean;
  appliedAt: string | null;
}

/** What "Set up from Meritto sheet" will change. */
interface SetupPlan {
  sheetUrl: string;
  programs: number;
  cities: number;
  levels: string[];
  courseKey: string;
  courseQuestions: Array<{ kind: "journey" | "form"; stepId: string; journeyName: string; questionText: string; renames: { from: string; to: string }[]; keeps: string[]; removes: string[]; adds: string[] }>;
  fields: Array<{ field: string; action: "add" | "keep"; sends: string }>;
  resend: number;
}

const optionText = (o: string) => (o.trim() ? o : "(blank option)");

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
  { value: "meritto.state", label: "Visitor: state (from the city, Meritto's city list)" },
  { value: "meritto.campus", label: "Course: programme level (from Meritto's course list)" },
  { value: "session.utmSource", label: "Visitor: UTM source" },
  { value: "session.utmMedium", label: "Visitor: UTM medium" },
  { value: "session.utmCampaign", label: "Visitor: UTM campaign" },
  { value: "conversation.summary", label: "Chat: AI summary" },
  { value: "conversation.topics", label: "Chat: topics" },
  { value: "business.name", label: "Business: name" },
  { value: "journey", label: "Journey answer (by its \"Saved as\" name)…" },
];

/** A LeadSquared row offered by "Copy from LeadSquared" (see server/services/merittoImport.ts). */
interface CopyRow {
  leadsquaredField: string;
  displayName: string;
  merittoField: string;
  sourceType: "dynamic" | "custom";
  sourceField: string | null;
  customValue: string | null;
  fallbackValue: string | null;
  isEnabled: boolean;
  status: "matched" | "check" | "unsupported";
  note: string | null;
  existsInMeritto: boolean;
  /** Reviewer's choices. */
  include: boolean;
  replace: boolean;
}

const COPY_STATUS: Record<CopyRow["status"], { label: string; className: string }> = {
  matched: { label: "Matched", className: "bg-green-50 text-green-700 border-green-200" },
  check: { label: "Check name", className: "bg-amber-50 text-amber-800 border-amber-200" },
  unsupported: { label: "Not available", className: "bg-gray-50 text-gray-600 border-gray-200" },
};

const sourceLabel = (m: Pick<Mapping, "sourceType" | "sourceField" | "customValue">) => {
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
  const { data: master } = useQuery<MasterStatus>({ queryKey: ["/api/meritto/master-data"] });

  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [createUrl, setCreateUrl] = useState("");
  const [updateUrl, setUpdateUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [test, setTest] = useState<{ success: boolean; message: string } | null>(null);
  const [draft, setDraft] = useState<typeof emptyDraft | null>(null);
  const [copyRows, setCopyRows] = useState<CopyRow[] | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);

  useEffect(() => {
    if (settings) { setCreateUrl(settings.createUrl); setUpdateUrl(settings.updateUrl); }
  }, [settings]);

  useEffect(() => {
    if (master?.sheetUrl) setSheetUrl(u => u || master.sheetUrl!);
  }, [master?.sheetUrl]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/meritto/settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/meritto/field-mappings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/meritto/master-data"] });
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
    mutationFn: () => apiRequest<{ added: string[] }>("POST", "/api/meritto/field-mappings/seed-defaults"),
    onSuccess: (r) => {
      refresh();
      toast(r.added.length
        ? { title: `Added ${r.added.length} standard field${r.added.length === 1 ? "" : "s"}`, description: r.added.join(", ") }
        : { title: "All standard fields are already in the list" });
    },
    onError: (e: Error) => toast({ title: "Could not add the standard fields", description: e.message, variant: "destructive" }),
  });
  const openCopy = useMutation({
    mutationFn: () => apiRequest<{ rows: Omit<CopyRow, "include" | "replace">[] }>("GET", "/api/meritto/field-mappings/from-leadsquared"),
    onSuccess: (r) => setCopyRows(r.rows.map(row => ({ ...row, include: row.status !== "unsupported", replace: false }))),
    onError: (e: Error) => toast({ title: "Could not read the LeadSquared fields", description: e.message, variant: "destructive" }),
  });
  const runCopy = useMutation({
    mutationFn: (rows: CopyRow[]) => apiRequest<{ added: number; replaced: number; kept: number }>("POST", "/api/meritto/field-mappings/import", {
      rows: rows.filter(r => r.include).map(r => ({
        merittoField: r.merittoField.trim(),
        displayName: r.merittoField.trim(),
        sourceType: r.sourceType,
        sourceField: r.sourceField,
        customValue: r.customValue,
        fallbackValue: r.fallbackValue,
        isEnabled: r.isEnabled,
        replace: r.replace,
      })),
    }),
    onSuccess: (r) => {
      setCopyRows(null);
      refresh();
      const parts = [`${r.added} added`, r.replaced ? `${r.replaced} replaced` : "", r.kept ? `${r.kept} already there, kept as they were` : ""].filter(Boolean);
      toast({ title: "Copied from LeadSquared", description: parts.join(" · ") });
    },
    onError: (e: Error) => toast({ title: "Could not copy the fields", description: e.message, variant: "destructive" }),
  });
  const previewSetup = useMutation({
    mutationFn: () => apiRequest<SetupPlan>("POST", "/api/meritto/master-data/preview", { sheetUrl }),
    onSuccess: setPlan,
    onError: (e: Error) => toast({ title: "Could not read the Meritto sheet", description: e.message, variant: "destructive" }),
  });
  const applySetup = useMutation({
    mutationFn: () => apiRequest<{ questionsChanged: number; fieldsAdded: string[]; resending: number }>("POST", "/api/meritto/master-data/apply", { sheetUrl: plan?.sheetUrl || sheetUrl }),
    onSuccess: (r) => {
      setPlan(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      const parts = [
        r.questionsChanged ? `${r.questionsChanged} course question${r.questionsChanged === 1 ? "" : "s"} updated` : "",
        r.fieldsAdded.length ? `added ${r.fieldsAdded.join(", ")}` : "",
        r.resending ? `${r.resending} lead${r.resending === 1 ? "" : "s"} being sent again` : "",
      ].filter(Boolean);
      toast({ title: "Set up from the Meritto sheet", description: parts.join(" · ") || "Meritto's lists are saved." });
    },
    onError: (e: Error) => toast({ title: "Could not set up from the sheet", description: e.message, variant: "destructive" }),
  });
  const undoSetup = useMutation({
    mutationFn: () => apiRequest<{ questionsRestored: number; fieldsRemoved: number }>("POST", "/api/meritto/master-data/undo"),
    onSuccess: (r) => {
      setConfirmUndo(false);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      toast({ title: "Setup undone", description: `${r.questionsRestored} course question${r.questionsRestored === 1 ? "" : "s"} put back · ${r.fieldsRemoved} field${r.fieldsRemoved === 1 ? "" : "s"} removed` });
    },
    onError: (e: Error) => toast({ title: "Could not undo", description: e.message, variant: "destructive" }),
  });

  const updateCopyRow = (i: number, patch: Partial<CopyRow>) =>
    setCopyRows(rows => rows ? rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) : rows);
  const copyCount = copyRows?.filter(r => r.include && r.merittoField.trim()).length ?? 0;

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
          <CardTitle className="flex items-center gap-2 text-lg"><FileSpreadsheet className="h-5 w-5 text-green-600" /> Meritto's lists</CardTitle>
          <CardDescription>
            Meritto only accepts its own course and city names. Paste the master data sheet Meritto shared (or the Meritto document that links to it):
            the course question and the form's Program / Course dropdown get Meritto's courses, campus and state are filled in automatically, and leads that failed are sent again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="Meritto master data sheet link" data-testid="input-meritto-sheet" />
            <Button onClick={() => previewSetup.mutate()} disabled={!sheetUrl.trim() || previewSetup.isPending} className="shrink-0" data-testid="button-meritto-setup">
              {previewSetup.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />} Set up from Meritto sheet
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {master && (master.programs || master.cities) ? (
              <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700" data-testid="meritto-lists-loaded">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {master.programs} courses · {master.cities.toLocaleString()} cities{master.loadedAt ? ` · loaded ${new Date(master.loadedAt).toLocaleDateString()}` : ""}
              </Badge>
            ) : (
              <span className="text-muted-foreground">Not loaded yet: courses and cities are sent as the chat has them.</span>
            )}
            {master?.canUndo && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmUndo(true)} data-testid="button-meritto-setup-undo"><Undo2 className="mr-1.5 h-4 w-4" /> Undo last setup</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><TableProperties className="h-5 w-5 text-orange-600" /> Fields sent to Meritto</CardTitle>
              <CardDescription>Each row is a field in Meritto's lead API (name, mobile, course, campus, …) and what AI Chroney puts in it.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => openCopy.mutate()} disabled={openCopy.isPending} data-testid="button-meritto-copy-lsq">
                {openCopy.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Copy className="mr-1.5 h-4 w-4" />} Copy from LeadSquared
              </Button>
              <Button variant="outline" size="sm" onClick={() => restoreDefaults.mutate()} disabled={restoreDefaults.isPending} title="Adds the standard fields that are missing; your other fields stay"><RotateCcw className="mr-1.5 h-4 w-4" /> Standard fields</Button>
              <Button size="sm" onClick={() => setDraft({ ...emptyDraft })} data-testid="button-add-meritto-field"><Plus className="mr-1.5 h-4 w-4" /> Add field</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {mappings.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No fields yet. Click "Standard fields" to start with name, email, mobile and more, or "Copy from LeadSquared" to reuse this account's LeadSquared fields.</p>
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
            Fields such as state, course, specialization, campus and lead_stage must match values set up in your Meritto account. With Meritto's lists loaded, course and city are sent in Meritto's spelling
            (one that isn't in the lists is left out rather than refused), and campus and state can be filled from them.
          </p>
        </CardContent>
      </Card>

      <Dialog open={!!copyRows} onOpenChange={(o) => !o && setCopyRows(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Copy fields from LeadSquared</DialogTitle>
            <DialogDescription>
              Each LeadSquared field becomes a Meritto field with the same value. Check the names marked "Check name": they must match the field names in your Meritto account. LeadSquared is not changed, and nothing is sent to Meritto.
            </DialogDescription>
          </DialogHeader>
          {copyRows && copyRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">This account has no LeadSquared fields to copy.</p>
          ) : (
            <div className="max-h-[60vh] divide-y overflow-y-auto rounded-md border">
              {copyRows?.map((r, i) => (
                <div key={i} className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start ${r.include ? "" : "opacity-60"}`} data-testid={`copy-row-${i}`}>
                  <div className="flex min-w-0 items-start gap-2 sm:w-[42%]">
                    <Checkbox checked={r.include} onCheckedChange={(v) => updateCopyRow(i, { include: v === true })} className="mt-0.5" aria-label={`Copy ${r.leadsquaredField || r.merittoField}`} />
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm">{r.leadsquaredField || "(new)"}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {sourceLabel(r)}{r.fallbackValue ? ` · if empty: "${r.fallbackValue}"` : ""}{r.isEnabled ? "" : " · off"}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="mt-2 hidden h-4 w-4 shrink-0 text-gray-400 sm:block" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Input value={r.merittoField} onChange={(e) => updateCopyRow(i, { merittoField: e.target.value })} disabled={!r.include} className="h-8 font-mono text-sm" aria-label="Meritto field" />
                      <Badge variant="outline" className={`shrink-0 ${COPY_STATUS[r.status].className}`}>{COPY_STATUS[r.status].label}</Badge>
                    </div>
                    {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                    {r.existsInMeritto && r.include && (
                      <label className="flex items-center gap-2 text-xs text-gray-700">
                        <Checkbox checked={r.replace} onCheckedChange={(v) => updateCopyRow(i, { replace: v === true })} />
                        Already in Meritto: replace it with this one (otherwise it's kept as it is)
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyRows(null)}>Cancel</Button>
            <Button onClick={() => copyRows && runCopy.mutate(copyRows)} disabled={copyCount === 0 || runCopy.isPending} data-testid="button-meritto-copy-confirm">
              {runCopy.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Copy {copyCount} field{copyCount === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!plan} onOpenChange={(o) => !o && setPlan(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Set up from the Meritto sheet</DialogTitle>
            <DialogDescription>
              Found {plan?.programs ?? 0} courses{plan?.levels.length ? ` (${plan.levels.join(", ")})` : ""} and {(plan?.cities ?? 0).toLocaleString()} cities. Nothing has changed yet: check what will, then Apply. You can undo it afterwards.
            </DialogDescription>
          </DialogHeader>
          {plan && (
            <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1 text-sm" data-testid="meritto-setup-plan">
              <section>
                <h3 className="mb-1.5 font-semibold">Course questions</h3>
                {plan.programs === 0 ? (
                  <p className="text-muted-foreground">The sheet has no course list, so no question changes.</p>
                ) : plan.courseQuestions.length === 0 ? (
                  <p className="text-muted-foreground">No pick-one journey question saved as “{plan.courseKey}” and no form dropdown named like “Program” or “Course”, so no question changes. Courses typed in chat are still matched to Meritto's names when sent.</p>
                ) : plan.courseQuestions.map(q => (
                  <div key={q.stepId} className="mb-3 rounded-md border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[11px]">{q.kind === "form" ? "Form" : "Journey"}</Badge>
                      <span className="font-medium">{q.journeyName}</span> · <span className="text-muted-foreground">“{q.questionText}”</span>
                    </div>
                    {q.renames.length > 0 && (
                      <details open className="mb-2">
                        <summary className="cursor-pointer font-medium text-blue-700">Renamed to Meritto's name ({q.renames.length})</summary>
                        <ul className="mt-1 space-y-0.5 pl-4">{q.renames.map(r => <li key={r.from} className="text-xs"><span className="text-muted-foreground">{r.from}</span> → {r.to}</li>)}</ul>
                      </details>
                    )}
                    {q.keeps.length > 0 && <p className="mb-2 text-xs text-muted-foreground">Already Meritto's name: {q.keeps.length}</p>}
                    {q.removes.length > 0 && (
                      <details open className="mb-2">
                        <summary className="cursor-pointer font-medium text-red-700">Removed: not in Meritto's list ({q.removes.length})</summary>
                        <ul className="mt-1 space-y-0.5 pl-4">{q.removes.map((r, i) => <li key={`${r}-${i}`} className="text-xs">{optionText(r)}</li>)}</ul>
                      </details>
                    )}
                    {q.adds.length > 0 && (
                      <details open>
                        <summary className="cursor-pointer font-medium text-green-700">Added from Meritto's list ({q.adds.length})</summary>
                        <ul className="mt-1 space-y-0.5 pl-4">{q.adds.map(a => <li key={a} className="text-xs">{a}</li>)}</ul>
                      </details>
                    )}
                  </div>
                ))}
              </section>
              <section>
                <h3 className="mb-1.5 font-semibold">Fields sent to Meritto</h3>
                <div className="divide-y rounded-md border">
                  {plan.fields.map(f => (
                    <div key={f.field} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-20 font-mono">{f.field}</span>
                      <span className="flex-1 text-xs text-muted-foreground">{f.sends}</span>
                      <Badge variant="outline" className={f.action === "add" ? "border-green-200 bg-green-50 text-green-700" : "border-gray-200 bg-gray-50 text-gray-600"}>{f.action === "add" ? "Add" : "Keep"}</Badge>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">A course or city that isn't in Meritto's lists is left out of the lead, so the lead still goes through.</p>
              </section>
              <section>
                <h3 className="mb-1.5 font-semibold">Leads that didn't reach Meritto</h3>
                <p className="text-muted-foreground">{plan.resend ? `${plan.resend} lead${plan.resend === 1 ? "" : "s"} will be sent again with the new values.` : "None: nothing to send again."}</p>
              </section>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlan(null)}>Cancel</Button>
            <Button onClick={() => applySetup.mutate()} disabled={applySetup.isPending} data-testid="button-meritto-setup-apply">
              {applySetup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmUndo} onOpenChange={setConfirmUndo}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Undo the last setup?</DialogTitle>
            <DialogDescription>
              The course questions and form dropdowns get their old options back and the fields the setup added are removed.
              {master?.appliedAt ? ` Setup was applied on ${new Date(master.appliedAt).toLocaleString()}.` : ""} Leads already sent to Meritto stay there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUndo(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => undoSetup.mutate()} disabled={undoSetup.isPending} data-testid="button-meritto-setup-undo-confirm">
              {undoSetup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Undo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
