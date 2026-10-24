import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Video } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CallVoicePicker, useVoiceName } from "@/components/voice/CallVoicePicker";
import { videoCallProblem, type VideoCallSettings } from "@shared/videoCall";

interface VideoCallReport {
  days: number;
  calls: number;
  failedStarts: number;
  minutes: number;
  avgMinutes: number;
  leads: number;
  handoffClicks: number;
  endReasons: { reason: string; count: number }[];
  earlyDropoffs: number;
}

interface VideoCallView {
  settings: VideoCallSettings;
  avatarEnabled: boolean;
  hasElevenLabsKey: boolean;
  widgetVoice: string;
  report: VideoCallReport | null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC"];

/** Why calls ended, in plain words (avatar_sessions.end_reason). */
const END_REASONS: Record<string, string> = {
  visitor_closed: "Visitor ended the call",
  switched_to_text: "Switched to text",
  idle_timeout: "No one was talking",
  max_duration: "Reached the time limit",
  poor_connection: "Slow connection, carried on by voice",
  cap_reached: "Monthly minutes used up",
  voice_closed: "Voice connection closed",
  heartbeat_timeout: "Visitor's page stopped responding",
  provider_disconnected: "Video provider disconnected",
  provider_error: "Video provider problem",
  server_restart: "Server restarted",
  server_shutdown: "Server restarted",
  disabled: "Video avatar switched off",
  in_progress: "Still in progress",
};
const endReasonLabel = (r: string) => END_REASONS[r] || r.replace(/_/g, " ");

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      <div className="divide-y rounded-lg border px-3">{children}</div>
    </div>
  );
}

function Choice<T extends string>({ value, options, onChange, testId }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="inline-flex rounded-lg border bg-gray-50 p-0.5" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${value === o.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Video call settings of the Live AI avatar: how the call sounds and behaves, with a 30-day report.
 * Business users edit their own (Website chat › Settings › Video call); super admins edit any account's from the
 * avatar's Set up panel. `endpoint` is the GET/PUT URL; `accountId` is set for another account.
 */
export function VideoCallSettingsCard({ endpoint, accountId }: { endpoint: string; accountId?: string }) {
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<VideoCallView>({
    queryKey: [endpoint],
    queryFn: async () => {
      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load video call settings");
      return res.json();
    },
  });
  const [form, setForm] = useState<VideoCallSettings | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  // A refetch (e.g. on window focus) refreshes the form only while it has no unsaved changes.
  const loadedRef = useRef<VideoCallSettings | null>(null);
  useEffect(() => {
    if (!data) return;
    setForm((f) => (!f || !loadedRef.current || JSON.stringify(f) === JSON.stringify(loadedRef.current) ? data.settings : f));
    loadedRef.current = data.settings;
  }, [data]);
  const voiceName = useVoiceName(form?.voiceSelection ?? data?.widgetVoice, accountId);

  const save = useMutation({
    mutationFn: (settings: VideoCallSettings) => apiRequest<VideoCallView>("PUT", endpoint, settings),
    onSuccess: (view) => {
      loadedRef.current = view.settings;
      setForm(view.settings);
      queryClient.setQueryData([endpoint], view);
      toast({ title: "Video call settings saved" });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !form || !data) {
    return <div className="flex items-center justify-center py-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isError ? "Failed to load" : "Loading…"}</div>;
  }

  const set = <K extends keyof VideoCallSettings>(key: K, value: VideoCallSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const setHours = (patch: Partial<VideoCallSettings["hours"]>) => setForm((f) => (f ? { ...f, hours: { ...f.hours, ...patch } } : f));
  const setHandoff = (patch: Partial<VideoCallSettings["handoff"]>) => setForm((f) => (f ? { ...f, handoff: { ...f.handoff, ...patch } } : f));
  const problem = videoCallProblem(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const report = data.report;
  const timezones = TIMEZONES.includes(form.hours.timezone) ? TIMEZONES : [form.hours.timezone, ...TIMEZONES];

  return (
    <div className="space-y-4" data-testid="video-call-settings">
      {!data.avatarEnabled && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">The video avatar is off for this account. These settings apply once it is on.</p>
      )}

      <Section title="Sound">
        <Row title="Background sound" hint="A quiet room sound under the avatar's voice, so it feels like a real video call.">
          <Choice
            value={form.backgroundSound}
            onChange={(v) => set("backgroundSound", v)}
            options={[{ value: "off", label: "Off" }, { value: "office", label: "Office" }, { value: "call_centre", label: "Call centre" }]}
            testId="choice-video-background"
          />
        </Row>
        {form.backgroundSound !== "off" && (
          <Row title="Background volume" hint="Always well below the avatar's voice.">
            <Choice value={form.backgroundVolume} onChange={(v) => set("backgroundVolume", v)} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }]} />
          </Row>
        )}
        <Row title="Speaking pace">
          <Choice
            value={form.speakingPace}
            onChange={(v) => set("speakingPace", v)}
            options={[{ value: "slow", label: "Slow" }, { value: "normal", label: "Normal" }, { value: "fast", label: "Fast" }]}
            testId="choice-video-pace"
          />
        </Row>
        <Collapsible open={voiceOpen} onOpenChange={setVoiceOpen}>
          <div className="flex items-start justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Avatar voice</p>
              <p className="text-xs text-muted-foreground">
                {form.voiceSelection ? <><strong className="text-gray-700">{voiceName}</strong> on video calls only.</> : <>Same as the website chat (<strong className="text-gray-700">{voiceName}</strong>).</>}
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline" size="sm" data-testid="button-video-voice">
                Change <ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${voiceOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="pb-3">
            <CallVoicePicker
              value={form.voiceSelection}
              onChange={(v) => set("voiceSelection", v)}
              account={accountId ? { id: accountId, widgetVoice: data.widgetVoice, hasElevenLabsKey: data.hasElevenLabsKey } : undefined}
            />
          </CollapsibleContent>
        </Collapsible>
      </Section>

      <Section title="Conversation">
        <div className="space-y-1.5 py-2.5">
          <Label htmlFor="video-opening-line" className="text-sm font-medium">Opening line</Label>
          <p className="text-xs text-muted-foreground">Said right after the AI introduction when the video starts. Leave empty for just the introduction.</p>
          <Textarea
            id="video-opening-line"
            rows={2}
            maxLength={300}
            value={form.openingLine || ""}
            onChange={(e) => set("openingLine", e.target.value || null)}
            placeholder="Which course are you interested in? I can help with fees, eligibility and admissions."
            data-testid="input-video-opening-line"
          />
        </div>
        <Row title="Thinking sounds" hint={`Only when an answer takes more than ~3 seconds: "let me check" while it looks something up, otherwise a short "hmm".`}>
          <Switch checked={form.thinkingSounds} onCheckedChange={(v) => set("thinkingSounds", v)} />
        </Row>
        <Row title="Captions" hint="Show what the avatar says as text under the video.">
          <Switch checked={form.captions} onCheckedChange={(v) => set("captions", v)} data-testid="switch-video-captions" />
        </Row>
        <Row title="Visitor can interrupt" hint="The avatar stops and listens when the visitor talks. Off: it finishes what it is saying first.">
          <Switch checked={form.allowInterruptions} onCheckedChange={(v) => set("allowInterruptions", v)} />
        </Row>
      </Section>

      <Section title="Call control">
        <Row title={`"Are you still there?"`} hint="Asked once before a quiet call ends.">
          <Switch checked={form.idleNudge} onCheckedChange={(v) => set("idleNudge", v)} />
        </Row>
        <Row title="Switch to voice on a slow connection" hint="If the video freezes, the call carries on by voice instead of dropping.">
          <Switch checked={form.autoVoiceOnly} onCheckedChange={(v) => set("autoVoiceOnly", v)} />
        </Row>
        <div className="py-2.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Video hours</p>
              <p className="text-xs text-muted-foreground">Outside these hours the video button is hidden; chat and voice carry on.</p>
            </div>
            <Switch checked={form.hours.enabled} onCheckedChange={(v) => setHours({ enabled: v })} data-testid="switch-video-hours" />
          </div>
          {form.hours.enabled && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d, i) => {
                  const on = form.hours.days.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setHours({ days: on ? form.hours.days.filter((x) => x !== i) : [...form.hours.days, i].sort() })}
                      className={`h-8 w-11 rounded-md border text-xs font-medium ${on ? "border-purple-500 bg-purple-50 text-purple-800" : "border-gray-200 text-gray-500 hover:border-purple-300"}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div><Label className="text-xs">From</Label><Input type="time" value={form.hours.start} onChange={(e) => setHours({ start: e.target.value })} /></div>
                <div><Label className="text-xs">To</Label><Input type="time" value={form.hours.end} onChange={(e) => setHours({ end: e.target.value })} /></div>
                <div>
                  <Label className="text-xs">Time zone</Label>
                  <Select value={form.hours.timezone} onValueChange={(v) => setHours({ timezone: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{timezones.map((tz) => <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="py-2.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Talk to a person</p>
              <p className="text-xs text-muted-foreground">A button on the video call that opens WhatsApp, a phone call or a link to your team.</p>
            </div>
            <Switch checked={form.handoff.enabled} onCheckedChange={(v) => setHandoff({ enabled: v })} data-testid="switch-video-handoff" />
          </div>
          {form.handoff.enabled && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div><Label className="text-xs">Button text</Label><Input maxLength={40} value={form.handoff.label} onChange={(e) => setHandoff({ label: e.target.value })} data-testid="input-video-handoff-label" /></div>
              <div>
                <Label className="text-xs">Opens</Label>
                <Select value={form.handoff.type} onValueChange={(v) => setHandoff({ type: v as VideoCallSettings["handoff"]["type"] })}>
                  <SelectTrigger data-testid="select-video-handoff-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="call">Phone call</SelectItem>
                    <SelectItem value="link">A link</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{form.handoff.type === "link" ? "Link" : "Number with country code"}</Label>
                <Input
                  value={form.handoff.target}
                  onChange={(e) => setHandoff({ target: e.target.value })}
                  placeholder={form.handoff.type === "link" ? "https://…" : "+91 98765 43210"}
                  data-testid="input-video-handoff-target"
                />
              </div>
            </div>
          )}
        </div>
      </Section>

      {report && (
        <div data-testid="video-call-report">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Last {report.days} days</p>
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Video calls", value: report.calls },
                { label: "Minutes", value: report.minutes },
                { label: "Avg. call", value: `${report.avgMinutes} min` },
                { label: "Leads", value: report.leads },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-lg font-semibold tabular-nums">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-600">
              {report.handoffClicks} tapped "talk to a person" · {report.earlyDropoffs} left in the first 30 seconds · {report.failedStarts} didn't connect
            </p>
            {report.endReasons.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
                {report.endReasons.slice(0, 5).map((r) => <li key={r.reason}>{endReasonLabel(r.reason)}: {r.count}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {problem && <p className="text-xs text-red-600" data-testid="text-video-call-problem">{problem}</p>}
        <Button onClick={() => save.mutate(form)} disabled={!dirty || !!problem || save.isPending} data-testid="button-save-video-call">
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save video call settings
        </Button>
      </div>
    </div>
  );
}

/** Website chat › Settings › Video call (the business's own settings). */
export function VideoCallSettingsPage() {
  const { data, isLoading } = useQuery<VideoCallView>({
    queryKey: ["/api/avatar/video-call"],
    queryFn: async () => {
      const res = await fetch("/api/avatar/video-call", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load video call settings");
      return res.json();
    },
  });
  return (
    <div className="rounded-2xl border border-black/[0.07] bg-white p-5" data-testid="page-video-call-settings">
      {!isLoading && data && !data.avatarEnabled ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Video className="h-4 w-4" /> The live video avatar isn't on for this account. Contact the AI Chroney team to add it.</p>
      ) : (
        <VideoCallSettingsCard endpoint="/api/avatar/video-call" />
      )}
    </div>
  );
}
