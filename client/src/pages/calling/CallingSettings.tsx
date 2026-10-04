import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MeResponseDto } from "@shared/dto";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, ChevronDown, Copy, Loader2, ShieldCheck, XCircle } from "lucide-react";
import {
  CALL_LIMITS,
  DEFAULT_CALL_PURPOSE,
  DEFAULT_CALLING_HOURS,
  normalizeCallPhone,
  type AiCallingSettingsView,
  type CallConsentMode,
  type CallProviderId,
} from "@shared/aiCalling";
import {
  callingApi,
  callingKeys,
  formatDateTime,
  isCallingUnavailable,
  previewOpeningLine,
  type CallingSettingsResponse,
  type CallingSettingsUpdate,
  type WhatsappTemplateOption,
} from "@/lib/aiCallingApi";
import { CallingPageHeader, CallingUnavailable } from "@/components/calling/RequireAiCalling";

const LEAD_SOURCES: { value: string; label: string }[] = [
  { value: "website", label: "Website chat" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "voice", label: "Voice chat" },
  { value: "form", label: "Lead forms" },
  { value: "import", label: "Imported leads" },
  { value: "other", label: "Other" },
];

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Riyadh",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
];

const REGIONS = [
  { value: "api.in.exotel.com", label: "India" },
  { value: "api.exotel.com", label: "Singapore" },
];

const SAMPLE_NAME = "Priya";

/** Everything editable, numbers kept as text while typing. */
interface Draft {
  enabled: boolean;
  provider: CallProviderId;
  accountSid: string;
  subdomain: string;
  callerId: string;
  flowAppId: string;
  autoCallLeads: boolean;
  autoCallDelayMinutes: string;
  autoCallSources: string[];
  consentMode: CallConsentMode;
  hoursStart: string;
  hoursEnd: string;
  hoursDays: number[];
  timezone: string;
  maxAttempts: string;
  retryGapMinutes: string;
  maxCallMinutes: string;
  monthlyMinuteLimit: string;
  concurrentCallLimit: string;
  recordCalls: boolean;
  transferNumber: string;
  callPurpose: string;
  openingLine: string;
  inboundGreeting: string;
  whatsappFollowUp: boolean;
  whatsappFollowUpTemplateId: string;
}

function toDraft(v: AiCallingSettingsView): Draft {
  const h = v.callingHours || DEFAULT_CALLING_HOURS;
  return {
    enabled: v.enabled,
    provider: v.provider,
    accountSid: v.exotel?.accountSid || "",
    subdomain: v.exotel?.subdomain || "api.in.exotel.com",
    callerId: v.exotel?.callerId || "",
    flowAppId: v.exotel?.flowAppId || "",
    autoCallLeads: v.autoCallLeads,
    autoCallDelayMinutes: String(v.autoCallDelayMinutes ?? CALL_LIMITS.autoCallDelayMinutes.default),
    autoCallSources: [...(v.autoCallSources || [])].sort(),
    consentMode: v.consentMode,
    hoursStart: h.start,
    hoursEnd: h.end,
    hoursDays: [...h.days].sort(),
    timezone: h.timezone,
    maxAttempts: String(v.maxAttempts ?? CALL_LIMITS.maxAttempts.default),
    retryGapMinutes: String(v.retryGapMinutes ?? CALL_LIMITS.retryGapMinutes.default),
    maxCallMinutes: String(v.maxCallMinutes ?? CALL_LIMITS.maxCallMinutes.default),
    monthlyMinuteLimit: v.monthlyMinuteLimit === null || v.monthlyMinuteLimit === undefined ? "" : String(v.monthlyMinuteLimit),
    concurrentCallLimit: String(v.concurrentCallLimit ?? CALL_LIMITS.concurrentCallLimit.default),
    recordCalls: v.recordCalls,
    transferNumber: v.transferNumber || "",
    callPurpose: v.callPurpose || "",
    openingLine: v.openingLine || "",
    inboundGreeting: v.inboundGreeting || "",
    whatsappFollowUp: v.whatsappFollowUp,
    whatsappFollowUpTemplateId: v.whatsappFollowUpTemplateId || "",
  };
}

type Limit = { min: number; max: number };
function intIn(text: string, lim: Limit): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= lim.min && n <= lim.max ? n : null;
}

function validate(d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  const L = CALL_LIMITS;
  if (intIn(d.autoCallDelayMinutes, L.autoCallDelayMinutes) === null) e.autoCallDelayMinutes = `Enter ${L.autoCallDelayMinutes.min}–${L.autoCallDelayMinutes.max} minutes.`;
  if (intIn(d.maxAttempts, L.maxAttempts) === null) e.maxAttempts = `Enter ${L.maxAttempts.min}–${L.maxAttempts.max}.`;
  if (intIn(d.retryGapMinutes, L.retryGapMinutes) === null) e.retryGapMinutes = `Enter ${L.retryGapMinutes.min}–${L.retryGapMinutes.max} minutes.`;
  if (intIn(d.maxCallMinutes, L.maxCallMinutes) === null) e.maxCallMinutes = `Enter ${L.maxCallMinutes.min}–${L.maxCallMinutes.max} minutes.`;
  if (intIn(d.concurrentCallLimit, L.concurrentCallLimit) === null) e.concurrentCallLimit = `Enter ${L.concurrentCallLimit.min}–${L.concurrentCallLimit.max}.`;
  if (d.monthlyMinuteLimit.trim() && intIn(d.monthlyMinuteLimit, { min: 1, max: 1_000_000 }) === null) e.monthlyMinuteLimit = "Enter a whole number of minutes, or leave it empty for no limit.";
  if (!/^\d{2}:\d{2}$/.test(d.hoursStart) || !/^\d{2}:\d{2}$/.test(d.hoursEnd)) e.hours = "Enter a start and end time.";
  else if (d.hoursStart >= d.hoursEnd) e.hours = "The end time must be after the start time.";
  if (d.hoursDays.length === 0) e.days = "Pick at least one day.";
  if (d.transferNumber.trim() && !normalizeCallPhone(d.transferNumber)) e.transferNumber = "Enter a valid phone number.";
  if (d.provider === "exotel" && d.callerId.trim() && !normalizeCallPhone(d.callerId)) e.callerId = "Enter your ExoPhone number, e.g. 080 4718 1234.";
  if (d.whatsappFollowUp && !d.whatsappFollowUpTemplateId) e.template = "Pick the WhatsApp message to send.";
  return e;
}

function buildBody(d: Draft, secrets: { apiKey: string; apiToken: string }, attest: boolean): CallingSettingsUpdate {
  const body: CallingSettingsUpdate = {
    enabled: d.enabled,
    provider: d.provider,
    exotel: {
      accountSid: d.accountSid.trim() || null,
      subdomain: d.subdomain,
      callerId: d.callerId.trim() ? normalizeCallPhone(d.callerId) : null,
      flowAppId: d.flowAppId.trim() || null,
    },
    autoCallLeads: d.autoCallLeads,
    autoCallDelayMinutes: Number(d.autoCallDelayMinutes),
    autoCallSources: d.autoCallSources,
    consentMode: d.consentMode,
    callingHours: { start: d.hoursStart, end: d.hoursEnd, days: d.hoursDays, timezone: d.timezone },
    maxAttempts: Number(d.maxAttempts),
    retryGapMinutes: Number(d.retryGapMinutes),
    maxCallMinutes: Number(d.maxCallMinutes),
    monthlyMinuteLimit: d.monthlyMinuteLimit.trim() ? Number(d.monthlyMinuteLimit) : null,
    concurrentCallLimit: Number(d.concurrentCallLimit),
    recordCalls: d.recordCalls,
    transferNumber: d.transferNumber.trim() ? normalizeCallPhone(d.transferNumber) : null,
    callPurpose: d.callPurpose.trim(),
    openingLine: d.openingLine.trim() || null,
    inboundGreeting: d.inboundGreeting.trim() || null,
    whatsappFollowUp: d.whatsappFollowUp,
    whatsappFollowUpTemplateId: d.whatsappFollowUpTemplateId || null,
  };
  if (secrets.apiKey.trim()) body.exotelApiKey = secrets.apiKey.trim();
  if (secrets.apiToken.trim()) body.exotelApiToken = secrets.apiToken.trim();
  if (attest) body.attestConsent = true;
  return body;
}

/** Warn before leaving with unsaved changes: browser close/reload and in-app navigation. */
function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    // In-app links navigate with history.pushState (wouter); ask before letting them through.
    const original = window.history.pushState;
    window.history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
      if (window.confirm("You have unsaved changes to your calling settings. Leave without saving?")) {
        window.history.pushState = original;
        return original.apply(this, args);
      }
    } as History["pushState"];
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (window.history.pushState !== original) window.history.pushState = original;
    };
  }, [dirty]);
}

function Field({ label, htmlFor, help, error, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : help ? <p className="text-xs text-gray-500">{help}</p> : null}
    </div>
  );
}

function SecretField({ id, label, set, mask, value, onChange }: { id: string; label: string; set: boolean; mask: string | null; value: string; onChange: (v: string) => void }) {
  const [replacing, setReplacing] = useState(false);
  useEffect(() => { if (!set) setReplacing(false); }, [set]);
  if (set && !replacing) {
    return (
      <Field label={label}>
        <div className="flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center rounded-md border bg-gray-50 px-3 font-mono text-sm text-gray-600">{mask || "••••"}</div>
          <Button type="button" variant="outline" onClick={() => setReplacing(true)} data-testid={`button-replace-${id}`}>Replace</Button>
        </div>
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor={id} help={set ? "Leave empty to keep the saved one." : undefined}>
      <div className="flex items-center gap-2">
        <Input id={id} type="password" autoComplete="off" value={value} onChange={e => onChange(e.target.value)} placeholder={set ? "Paste the new value" : "Paste from Exotel"} data-testid={`input-${id}`} />
        {set && (
          <Button type="button" variant="ghost" onClick={() => { onChange(""); setReplacing(false); }}>Cancel</Button>
        )}
      </div>
    </Field>
  );
}

function CopyRow({ label, value }: { label: string; value: string | null }) {
  const { toast } = useToast();
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-gray-600">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border bg-white px-2 py-1.5 text-xs">{value || "Save your settings to get this link"}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!value}
          onClick={() => {
            if (!value) return;
            navigator.clipboard.writeText(value).then(
              () => toast({ title: "Copied" }),
              () => toast({ title: "Couldn't copy", description: "Select the text and copy it manually.", variant: "destructive" }),
            );
          }}
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function CallingSettings() {
  const { toast } = useToast();
  const { data: me } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const settingsQuery = useQuery<CallingSettingsResponse>({
    queryKey: callingKeys.settings,
    queryFn: callingApi.getSettings,
    staleTime: 0,
    retry: false,
  });
  const saved = settingsQuery.data;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [attest, setAttest] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const initial = useRef<string>("");

  // Load (and reload after a save) — never clobber edits in progress.
  useEffect(() => {
    if (!saved) return;
    const d = toDraft(saved);
    const snapshot = JSON.stringify(d);
    if (!draft || JSON.stringify(draft) === initial.current) setDraft(d);
    initial.current = snapshot;
    if (saved.exotel?.flowAppId) setAdvancedOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const marketingEnabled = me?.businessAccount?.whatsappEnabled === true && me?.businessAccount?.whatsappMarketingEnabled === true;
  const templates = useQuery<WhatsappTemplateOption[]>({
    queryKey: ["/api/whatsapp/templates"],
    queryFn: callingApi.whatsappTemplates,
    enabled: marketingEnabled,
    retry: false,
  });
  const approved = (templates.data || []).filter(t => t.status === "approved");

  const dirty = !!draft && (JSON.stringify(draft) !== initial.current || !!apiKey.trim() || !!apiToken.trim());
  useUnsavedChangesGuard(dirty);

  const errors = useMemo(() => (draft ? validate(draft) : {}), [draft]);
  const needsAttest = !!draft && draft.consentMode === "business_attested" && saved?.consentMode !== "business_attested";
  const attestMissing = needsAttest && !attest;

  const save = useMutation({
    mutationFn: () => callingApi.saveSettings(buildBody(draft!, { apiKey, apiToken }, needsAttest && attest)),
    onSuccess: view => {
      setApiKey("");
      setApiToken("");
      setAttest(false);
      setShowErrors(false);
      const d = toDraft(view);
      initial.current = JSON.stringify(d);
      setDraft(d);
      queryClient.setQueryData(callingKeys.settings, view);
      queryClient.invalidateQueries({ queryKey: callingKeys.incoming });
      toast({ title: "Settings saved", description: view.enabled ? "AI Calling is on." : "AI Calling is off — no calls will be made." });
    },
    onError: (e: Error) => toast({ title: "Couldn't save settings", description: e.message, variant: "destructive" }),
  });

  const verify = useMutation({
    mutationFn: () => callingApi.verify(),
    onSuccess: r => {
      setVerifyResult({ ok: !!r.ok, detail: r.detail || (r.ok ? "Connected to Exotel." : "Exotel didn't accept these details.") });
      queryClient.invalidateQueries({ queryKey: callingKeys.settings });
    },
    onError: (e: Error) => setVerifyResult({ ok: false, detail: e.message }),
  });

  if (isCallingUnavailable(settingsQuery.error)) return <CallingUnavailable />;
  if (settingsQuery.isError) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <CallingPageHeader title="Calling settings" />
        <p className="text-sm text-gray-600">Couldn't load your settings: {(settingsQuery.error as Error).message}</p>
        <Button className="mt-3" variant="outline" onClick={() => settingsQuery.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!saved || !draft) {
    return <div className="py-24 text-center"><Loader2 className="inline h-6 w-6 animate-spin text-gray-400" /></div>;
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => (prev ? { ...prev, [key]: value } : prev));
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const businessName = me?.businessAccount?.name || "your business";
  const openingPreview = draft.openingLine.trim()
    ? previewOpeningLine(draft.openingLine, { name: SAMPLE_NAME, business: businessName, assistant: "your assistant" })
    : null;
  const timezones = COMMON_TIMEZONES.includes(draft.timezone) ? COMMON_TIMEZONES : [draft.timezone, ...COMMON_TIMEZONES];
  const exotel = draft.provider === "exotel";
  const minutesUsed = Math.round(saved.minutesThisMonth || 0);
  const effectiveCap = [saved.superAdminMinuteCap, saved.monthlyMinuteLimit].filter((n): n is number => typeof n === "number").sort((a, b) => a - b)[0];

  const onSave = () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) {
      toast({ title: "Please fix the highlighted fields", variant: "destructive" });
      return;
    }
    if (attestMissing) {
      toast({ title: "Please confirm your lead forms mention calls", description: "Tick the box under “Who can be called automatically”.", variant: "destructive" });
      return;
    }
    save.mutate();
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-28">
      <CallingPageHeader title="Calling settings" description="How the AI phones your leads and answers your number." />

      <div className="space-y-5">
        {/* On / off */}
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">AI Calling</p>
              <p className="text-sm text-gray-600">
                {draft.enabled ? "On — the AI makes and answers calls using the settings below." : "Off — the AI won't make or answer any calls."}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {minutesUsed.toLocaleString()} minutes used this month{effectiveCap ? ` of ${effectiveCap.toLocaleString()}` : ""}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={draft.enabled} onCheckedChange={v => set("enabled", v)} data-testid="switch-calling-enabled" />
              <span className="text-sm font-medium">{draft.enabled ? "On" : "Off"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Provider */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Phone provider</CardTitle>
            <CardDescription>Start in test mode to try everything in the portal. Switch to Exotel when your account is ready.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <RadioGroup value={draft.provider} onValueChange={v => set("provider", v as CallProviderId)} className="grid gap-2 sm:grid-cols-2">
              <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${!exotel ? "border-purple-300 bg-purple-50/50" : ""}`}>
                <RadioGroupItem value="simulator" className="mt-0.5" data-testid="radio-provider-simulator" />
                <span>
                  <span className="block text-sm font-medium">Test mode</span>
                  <span className="block text-xs text-gray-500">Rings here in the portal — no real phone calls.</span>
                </span>
              </label>
              <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${exotel ? "border-purple-300 bg-purple-50/50" : ""}`}>
                <RadioGroupItem value="exotel" className="mt-0.5" data-testid="radio-provider-exotel" />
                <span>
                  <span className="block text-sm font-medium">Exotel</span>
                  <span className="block text-xs text-gray-500">Real calls through your Exotel number.</span>
                </span>
              </label>
            </RadioGroup>

            {exotel && (
              <div className="space-y-4 rounded-lg border p-4">
                <p className="text-xs text-gray-500">Find these in your Exotel dashboard → API settings.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <SecretField id="exotel-api-key" label="API key" set={saved.exotel.apiKeySet} mask={saved.exotel.apiKeyMask} value={apiKey} onChange={setApiKey} />
                  <SecretField id="exotel-api-token" label="API token" set={saved.exotel.apiTokenSet} mask={saved.exotel.apiTokenMask} value={apiToken} onChange={setApiToken} />
                  <Field label="Account SID" htmlFor="exotel-sid" help="Shown next to your API key.">
                    <Input id="exotel-sid" value={draft.accountSid} onChange={e => set("accountSid", e.target.value)} autoComplete="off" data-testid="input-exotel-sid" />
                  </Field>
                  <Field label="Region" help="Where your Exotel account is hosted.">
                    <Select value={draft.subdomain} onValueChange={v => set("subdomain", v)}>
                      <SelectTrigger data-testid="select-exotel-region"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {REGIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                        {!REGIONS.some(r => r.value === draft.subdomain) && <SelectItem value={draft.subdomain}>{draft.subdomain}</SelectItem>}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="ExoPhone number" htmlFor="exotel-callerid" help="The number your customers see when the AI calls." error={err("callerId")}>
                    <Input id="exotel-callerid" value={draft.callerId} onChange={e => set("callerId", e.target.value)} inputMode="tel" placeholder="e.g. 080 4718 1234" data-testid="input-exotel-callerid" />
                  </Field>
                </div>

                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium text-gray-700">
                    <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "" : "-rotate-90"}`} /> Advanced
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <Field label="Call flow ID (optional)" htmlFor="exotel-flow" help="Needed only to pass calls to your team. Create a call flow in Exotel with a Voicebot step followed by a Connect step to your team's number, and paste its ID here.">
                      <Input id="exotel-flow" value={draft.flowAppId} onChange={e => set("flowAppId", e.target.value)} autoComplete="off" data-testid="input-exotel-flow" />
                    </Field>
                  </CollapsibleContent>
                </Collapsible>

                <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center">
                  <Button type="button" variant="outline" onClick={() => { setVerifyResult(null); verify.mutate(); }} disabled={verify.isPending || dirty} data-testid="button-verify-exotel">
                    {verify.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />} Check connection
                  </Button>
                  <div className="text-xs text-gray-500">
                    {dirty ? "Save your changes first, then check." : saved.exotel.verifiedAt ? `Last checked ${formatDateTime(saved.exotel.verifiedAt)}.` : "Not checked yet."}
                  </div>
                </div>
                {verifyResult && (
                  <p className={`flex items-start gap-1.5 rounded p-2 text-sm ${verifyResult.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} data-testid="text-verify-result">
                    {verifyResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                    {verifyResult.detail}
                  </p>
                )}

                <div className="space-y-3 rounded-lg bg-gray-50 p-3">
                  <p className="text-sm font-medium">Set up incoming calls in Exotel</p>
                  <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600">
                    <li>In Exotel, open <b>App Bazaar</b> and create a call flow with a <b>Voicebot</b> step.</li>
                    <li>Paste the <b>incoming call link</b> below into the Voicebot step's URL and save the flow.</li>
                    <li>Under <b>ExoPhones</b>, connect your number to that call flow. Calls to it are now answered by the AI.</li>
                  </ol>
                  <CopyRow label="Incoming call link (for the Voicebot step)" value={saved.setup.inboundStreamUrl} />
                  <CopyRow label="Status link (filled in automatically for calls the AI makes)" value={saved.setup.statusCallbackUrl} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Who to call */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Who to call</CardTitle>
            <CardDescription>Call new leads automatically, a few minutes after they reach out.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Call new leads automatically</p>
                <p className="text-xs text-gray-500">Only leads with a phone number. You can always call anyone manually from the Calls page.</p>
              </div>
              <Switch checked={draft.autoCallLeads} onCheckedChange={v => set("autoCallLeads", v)} data-testid="switch-auto-call" />
            </div>

            {draft.autoCallLeads && (
              <>
                <Field label="Wait before calling" htmlFor="auto-delay" help="Minutes after the lead comes in. A short wait feels natural; 0 calls straight away." error={err("autoCallDelayMinutes")}>
                  <div className="flex items-center gap-2">
                    <Input id="auto-delay" className="w-28" inputMode="numeric" value={draft.autoCallDelayMinutes} onChange={e => set("autoCallDelayMinutes", e.target.value)} data-testid="input-auto-delay" />
                    <span className="text-sm text-gray-600">minutes</span>
                  </div>
                </Field>
                <div className="space-y-2">
                  <Label>Leads from</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {LEAD_SOURCES.map(s => {
                      const checked = draft.autoCallSources.includes(s.value);
                      return (
                        <label key={s.value} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={v => set("autoCallSources", (v ? [...draft.autoCallSources, s.value] : draft.autoCallSources.filter(x => x !== s.value)).sort())}
                            data-testid={`checkbox-source-${s.value}`}
                          />
                          {s.label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500">{draft.autoCallSources.length === 0 ? "None ticked = leads from every source are called." : "Only leads from the ticked sources are called."}</p>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>Who can be called automatically</Label>
              <RadioGroup value={draft.consentMode} onValueChange={v => set("consentMode", v as CallConsentMode)} className="space-y-2">
                <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${draft.consentMode === "explicit" ? "border-purple-300 bg-purple-50/50" : ""}`}>
                  <RadioGroupItem value="explicit" className="mt-0.5" data-testid="radio-consent-explicit" />
                  <span>
                    <span className="block text-sm font-medium">Only people who agreed to a call</span>
                    <span className="block text-xs text-gray-500">The safest choice. The AI only auto-calls leads who asked for a call or said yes when your chat offered one.</span>
                  </span>
                </label>
                <label className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${draft.consentMode === "business_attested" ? "border-purple-300 bg-purple-50/50" : ""}`}>
                  <RadioGroupItem value="business_attested" className="mt-0.5" data-testid="radio-consent-attested" />
                  <span>
                    <span className="block text-sm font-medium">Everyone who leaves a phone number</span>
                    <span className="block text-xs text-gray-500">Use this only if your forms and chats clearly tell people they may get a call.</span>
                  </span>
                </label>
              </RadioGroup>
              {draft.consentMode === "business_attested" && (
                needsAttest ? (
                  <label className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${showErrors && attestMissing ? "border-red-300 bg-red-50" : "bg-amber-50/60 border-amber-200"}`}>
                    <Checkbox checked={attest} onCheckedChange={v => setAttest(!!v)} className="mt-0.5" data-testid="checkbox-attest-consent" />
                    <span>Our lead forms and chats tell people we may call them.</span>
                  </label>
                ) : saved.consentAttestedAt ? (
                  <p className="text-xs text-gray-500">You confirmed this on {formatDateTime(saved.consentAttestedAt)}.</p>
                ) : null
              )}
            </div>
          </CardContent>
        </Card>

        {/* When */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">When to call</CardTitle>
            <CardDescription>Calls outside these hours wait until the next allowed time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="Calling hours" error={err("hours")}>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="time" className="w-32" value={draft.hoursStart} onChange={e => set("hoursStart", e.target.value)} aria-label="Start time" data-testid="input-hours-start" />
                <span className="text-sm text-gray-600">to</span>
                <Input type="time" className="w-32" value={draft.hoursEnd} onChange={e => set("hoursEnd", e.target.value)} aria-label="End time" data-testid="input-hours-end" />
              </div>
            </Field>
            <Field label="Days" error={err("days")}>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map(d => {
                  const on = draft.hoursDays.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("hoursDays", (on ? draft.hoursDays.filter(x => x !== d.value) : [...draft.hoursDays, d.value]).sort())}
                      className={`h-9 w-12 rounded-md border text-sm ${on ? "border-purple-600 bg-purple-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                      data-testid={`button-day-${d.value}`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Time zone">
              <Select value={draft.timezone} onValueChange={v => set("timezone", v)}>
                <SelectTrigger className="sm:w-72" data-testid="select-timezone"><SelectValue /></SelectTrigger>
                <SelectContent>{timezones.map(tz => <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tries per lead" htmlFor="max-attempts" help="If nobody answers, the AI tries again — up to this many calls in total." error={err("maxAttempts")}>
                <Input id="max-attempts" className="w-28" inputMode="numeric" value={draft.maxAttempts} onChange={e => set("maxAttempts", e.target.value)} data-testid="input-max-attempts" />
              </Field>
              <Field label="Wait between tries" htmlFor="retry-gap" help="In minutes, e.g. 120 = 2 hours." error={err("retryGapMinutes")}>
                <div className="flex items-center gap-2">
                  <Input id="retry-gap" className="w-28" inputMode="numeric" value={draft.retryGapMinutes} onChange={e => set("retryGapMinutes", e.target.value)} data-testid="input-retry-gap" />
                  <span className="text-sm text-gray-600">minutes</span>
                </div>
              </Field>
              <Field label="Longest call" htmlFor="max-call" help="The AI wraps up politely before this." error={err("maxCallMinutes")}>
                <div className="flex items-center gap-2">
                  <Input id="max-call" className="w-28" inputMode="numeric" value={draft.maxCallMinutes} onChange={e => set("maxCallMinutes", e.target.value)} data-testid="input-max-call" />
                  <span className="text-sm text-gray-600">minutes</span>
                </div>
              </Field>
              <Field label="Calls at the same time" htmlFor="concurrent" help="Extra calls wait their turn." error={err("concurrentCallLimit")}>
                <Input id="concurrent" className="w-28" inputMode="numeric" value={draft.concurrentCallLimit} onChange={e => set("concurrentCallLimit", e.target.value)} data-testid="input-concurrent" />
              </Field>
              <Field
                label="Monthly minute limit"
                htmlFor="monthly-limit"
                help={saved.superAdminMinuteCap ? `Leave empty for no extra limit. Your plan allows ${saved.superAdminMinuteCap.toLocaleString()} minutes a month.` : "Leave empty for no limit. Calls stop for the month once it's reached."}
                error={err("monthlyMinuteLimit")}
              >
                <div className="flex items-center gap-2">
                  <Input id="monthly-limit" className="w-28" inputMode="numeric" value={draft.monthlyMinuteLimit} onChange={e => set("monthlyMinuteLimit", e.target.value)} placeholder="No limit" data-testid="input-monthly-limit" />
                  <span className="text-sm text-gray-600">minutes</span>
                </div>
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* What the AI says */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What the AI says</CardTitle>
            <CardDescription>It already knows everything you've trained it on. Tell it what each call is for.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="Purpose of the call" htmlFor="call-purpose" help="In your own words. Leave empty to use the suggestion shown.">
              <Textarea id="call-purpose" rows={4} value={draft.callPurpose} onChange={e => set("callPurpose", e.target.value)} placeholder={DEFAULT_CALL_PURPOSE} maxLength={2000} data-testid="input-call-purpose" />
            </Field>
            <Field
              label="Opening line (optional)"
              htmlFor="opening-line"
              help={<>Use <code>{"{name}"}</code> for the lead's name, <code>{"{business}"}</code> for your business and <code>{"{assistant}"}</code> for the assistant's name. Leave empty and the AI introduces itself naturally.</>}
            >
              <Input id="opening-line" value={draft.openingLine} onChange={e => set("openingLine", e.target.value)} maxLength={300} placeholder="Hi {name}, this is {assistant} from {business}. You enquired with us a little while ago — is now a good time?" data-testid="input-opening-line" />
            </Field>
            {openingPreview && (
              <div className="rounded-lg border bg-gray-50 p-3 text-sm" data-testid="text-opening-preview">
                <p className="text-xs font-medium text-gray-500">Preview, calling “{SAMPLE_NAME}”</p>
                <p className="mt-1 text-gray-800">“{openingPreview}”</p>
              </div>
            )}
            <Field label="Greeting when someone calls you (optional)" htmlFor="inbound-greeting" help="What the AI says when it answers your number. Leave empty for a friendly default.">
              <Textarea id="inbound-greeting" rows={2} value={draft.inboundGreeting} onChange={e => set("inboundGreeting", e.target.value)} maxLength={300} placeholder={`Thanks for calling ${businessName}. How can I help you today?`} data-testid="input-inbound-greeting" />
            </Field>
          </CardContent>
        </Card>

        {/* Team + recording */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              label="Pass calls to this number (optional)"
              htmlFor="transfer-number"
              help={exotel && !draft.flowAppId.trim() ? "To pass live calls on, also add a call flow ID under Phone provider → Advanced. Until then the AI takes a message and your team calls back." : "When a caller wants a person, the AI hands the call to this number."}
              error={err("transferNumber")}
            >
              <Input id="transfer-number" className="sm:w-72" value={draft.transferNumber} onChange={e => set("transferNumber", e.target.value)} inputMode="tel" placeholder="e.g. +91 98105 60800" data-testid="input-transfer-number" />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Record calls</p>
                <p className="text-xs text-gray-500">Recordings are kept with each call so your team can listen back.</p>
              </div>
              <Switch checked={draft.recordCalls} onCheckedChange={v => set("recordCalls", v)} data-testid="switch-record-calls" />
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp follow-up */}
        {marketingEnabled && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">WhatsApp follow-up</CardTitle>
              <CardDescription>After a call, send the person an approved WhatsApp message.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Send a WhatsApp message after answered calls</p>
                <Switch checked={draft.whatsappFollowUp} onCheckedChange={v => set("whatsappFollowUp", v)} data-testid="switch-wa-follow-up" />
              </div>
              {draft.whatsappFollowUp && (
                <Field label="Message to send" error={err("template")} help={approved.length === 0 && !templates.isLoading ? "You don't have an approved template yet. Add one under WhatsApp → Templates." : "Only templates WhatsApp has approved are listed."}>
                  <Select value={draft.whatsappFollowUpTemplateId || undefined} onValueChange={v => set("whatsappFollowUpTemplateId", v)} disabled={approved.length === 0}>
                    <SelectTrigger className="sm:w-80" data-testid="select-wa-template"><SelectValue placeholder={templates.isLoading ? "Loading…" : "Pick a template"} /></SelectTrigger>
                    <SelectContent>
                      {approved.map(t => <SelectItem key={t.id} value={t.id}>{t.name}{t.language ? ` (${t.language})` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Save bar */}
      <div className={`fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 backdrop-blur transition-transform md:left-[var(--sidebar-width)] ${dirty ? "translate-y-0" : "translate-y-full"}`}>
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="text-sm text-gray-700">You have unsaved changes.</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDraft(toDraft(saved));
                setApiKey("");
                setApiToken("");
                setAttest(false);
                setShowErrors(false);
              }}
              disabled={save.isPending}
              data-testid="button-discard-calling-settings"
            >
              Discard
            </Button>
            <Button onClick={onSave} disabled={save.isPending} data-testid="button-save-calling-settings">
              {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
