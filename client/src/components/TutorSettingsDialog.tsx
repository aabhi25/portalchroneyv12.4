import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CallVoicePicker, useVoiceName } from "@/components/voice/CallVoicePicker";

/** Lesson languages a teacher voice can be set for. */
const VOICE_LANGS = [
  { id: "en", label: "English lessons", hint: "An Indian-English voice reads English lessons best." },
  { id: "hi", label: "Hindi lessons", hint: "A native Hindi voice (ElevenLabs has several) — English voices read Hindi with an accent." },
  { id: "hinglish", label: "Hinglish lessons", hint: "Hindi with English school words. Uses the Hindi voice unless you pick one." },
] as const;
type VoiceLang = typeof VOICE_LANGS[number]["id"];

export type TutorAdminView = {
  eligible: boolean;
  enabled: boolean;
  dailyMinutesPerStudent: number;
  teacherName: string | null;
  voiceByLanguage: Partial<Record<VoiceLang, string>>;
  avatarMode: "auto" | "voice";
  avatarId: string | null;
  doubtTeachingEnabled: boolean;
  /** The account's Live AI avatar (provider, key, consent…), which video lessons use. */
  avatar: { enabled: boolean; provider: string; providerLabel: string; avatarId: string | null; displayName: string | null; ready: boolean; missing: string[] } | null;
  limits: { dailyMinutesPerStudent: { min: number; max: number; default: number } };
  updatedAt: string | null;
};

/** One lesson language's voice: what is chosen, and the picker when "Change" is open. */
function VoiceRow({ lang, value, open, onToggle, onChange }: {
  lang: typeof VOICE_LANGS[number]; value: string | null; open: boolean; onToggle: () => void; onChange: (v: string | null) => void;
}) {
  const name = useVoiceName(value);
  const fallback = lang.id === "hinglish" ? "Same as the Hindi voice" : "Same as the chat widget's voice";
  return (
    <div className="rounded-lg border border-gray-200" data-testid={`tutor-voice-${lang.id}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{lang.label}</p>
          <p className="truncate text-xs text-gray-500">{value ? name : fallback}</p>
        </div>
        <span className="text-xs font-medium text-purple-700">{open ? "Done" : "Change"}</span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 pb-3 pt-2">
          <p className="text-xs text-gray-500">{lang.hint}</p>
          <CallVoicePicker
            value={value}
            onChange={onChange}
            defaultOption={lang.id === "hinglish" ? { label: "Same as the Hindi voice", description: "Hinglish lessons use the voice chosen for Hindi (or the chat widget's voice)." } : undefined}
          />
        </div>
      )}
    </div>
  );
}
type UsageView = {
  day: string;
  students: number;
  totalSeconds: number;
  week?: { lessons: number; seconds: number; completed: number; students: number; checksCorrect: number; checksTotal: number };
};

export const tutorKey = (id: string) => ["/api/super-admin/tutor/accounts", id];

/**
 * Super admin: switch the AI tutor on/off for an account and set the minutes each student may
 * use per day. Video follows the account's live avatar settings.
 */
export function TutorSettingsDialog({ open, onOpenChange, businessAccountId, businessName }: {
  open: boolean; onOpenChange: (v: boolean) => void; businessAccountId: string; businessName: string;
}) {
  const { toast } = useToast();
  const settings = useQuery<TutorAdminView>({ queryKey: tutorKey(businessAccountId), enabled: open });
  const usage = useQuery<UsageView>({ queryKey: [`/api/super-admin/tutor/accounts/${businessAccountId}/usage`], enabled: open });
  const [enabled, setEnabled] = useState(false);
  const [minutes, setMinutes] = useState("20");
  const [teacherName, setTeacherName] = useState("");
  const [voices, setVoices] = useState<Partial<Record<VoiceLang, string | null>>>({});
  const [openVoice, setOpenVoice] = useState<VoiceLang | null>(null);
  const [avatarMode, setAvatarMode] = useState<"auto" | "voice">("auto");
  const [avatarId, setAvatarId] = useState("");
  const [doubtTeaching, setDoubtTeaching] = useState(false);
  const [avatarCheck, setAvatarCheck] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setMinutes(String(settings.data.dailyMinutesPerStudent));
    setTeacherName(settings.data.teacherName ?? "");
    setVoices({ ...settings.data.voiceByLanguage });
    setAvatarMode(settings.data.avatarMode ?? "auto");
    setAvatarId(settings.data.avatarId ?? "");
    setDoubtTeaching(!!settings.data.doubtTeachingEnabled);
    setAvatarCheck(null);
  }, [settings.data]);
  useEffect(() => { if (!open) setOpenVoice(null); }, [open]);

  const avatar = settings.data?.avatar ?? null;
  const checkAvatar = useMutation({
    mutationFn: () => apiRequest<{ status: "found" | "not_found" | "unchecked"; name?: string; reason?: string; message?: string; resolvedAvatarId?: string; resolvedFrom?: string }>(
      "POST", `/api/super-admin/avatar/accounts/${businessAccountId}/check-avatar`, { provider: avatar?.provider, avatarId: avatarId.trim() }),
    onSuccess: (r) => {
      // A persona id: use its avatar id (what a session needs).
      if (r.status === "found" && r.resolvedFrom === "persona" && r.resolvedAvatarId) setAvatarId(r.resolvedAvatarId);
      setAvatarCheck(
        r.status === "found" ? { ok: true, text: `Found at ${avatar?.providerLabel}${r.name ? `: ${r.name}` : ""}.` }
          : r.status === "not_found" ? { ok: false, text: r.message || `Not found at ${avatar?.providerLabel}.` }
            : { ok: true, text: r.reason || "Couldn't check right now — it will be tried when a lesson starts." });
    },
    onError: (e: any) => setAvatarCheck({ ok: false, text: e?.message || "Couldn't check the avatar id." }),
  });

  const lim = settings.data?.limits.dailyMinutesPerStudent ?? { min: 5, max: 240, default: 20 };
  const minutesNum = Number(minutes);
  const minutesError = !/^\d+$/.test(minutes.trim()) || minutesNum < lim.min || minutesNum > lim.max
    ? `Enter ${lim.min}–${lim.max} minutes.` : null;

  const save = useMutation({
    mutationFn: () => apiRequest<TutorAdminView>("PUT", `/api/super-admin/tutor/accounts/${businessAccountId}`, {
      enabled,
      dailyMinutesPerStudent: minutesNum,
      teacherName: teacherName.trim() || null,
      voiceByLanguage: Object.fromEntries(VOICE_LANGS.map((l) => [l.id, voices[l.id] || null])),
      avatarMode,
      avatarId: avatarId.trim() || null,
      doubtTeachingEnabled: doubtTeaching,
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(tutorKey(businessAccountId), data);
      toast({ title: "Tutor settings saved", description: data.enabled ? "The AI tutor is on for this account." : "The AI tutor is off for this account." });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Couldn't save tutor settings", description: e?.message || "Try again.", variant: "destructive" }),
  });

  return (
    // A side panel: room for the voice lists, and the page stays visible beside it.
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" data-testid="panel-tutor-settings">
        <SheetHeader className="border-b px-6 py-4 pr-12 text-left">
          <SheetTitle>AI tutor · {businessName}</SheetTitle>
          <SheetDescription>
            A teacher-like tutor in the chat widget that teaches a chapter from your synced content, with a live board.
            Set the teacher's name, voices and video below.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {settings.isLoading ? (
          <div className="py-8 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-gray-400" /></div>
        ) : settings.isError ? (
          <p className="text-sm text-red-600">Couldn't load the tutor settings. Close and try again.</p>
        ) : (
          <div className="space-y-5">
            {!settings.data?.eligible && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Only K12 / TopScholar accounts can use the tutor: it teaches from synced curriculum content.
              </p>
            )}
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="tutor-enabled" className="text-sm font-medium">Tutor on for this account</Label>
                <p className="text-xs text-gray-500">Students see "Teach me this chapter" in the chat.</p>
              </div>
              <Switch id="tutor-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={!settings.data?.eligible} data-testid="switch-tutor-enabled" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="tutor-doubts" className="text-sm font-medium">Teach doubts on the board</Label>
                <p className="text-xs text-gray-500">In a raised doubt, students see "Teach me this on the board" under the answer; the tutor explains it step by step, then they go back to the chat.</p>
              </div>
              <Switch id="tutor-doubts" checked={doubtTeaching} onCheckedChange={setDoubtTeaching} disabled={!settings.data?.eligible || !enabled} data-testid="switch-tutor-doubts" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tutor-minutes">Minutes per student per day</Label>
              <div className="flex items-center gap-2">
                <Input id="tutor-minutes" className="w-24" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} data-testid="input-tutor-minutes" />
                <span className="text-sm text-gray-500">minutes, resets at midnight (India time)</span>
              </div>
              {minutesError ? <p className="text-xs text-red-600">{minutesError}</p> : (
                <p className="text-xs text-gray-500">When a student reaches it, the tutor wraps up with a short recap and says goodbye.</p>
              )}
            </div>
            <p className="text-xs text-gray-500" data-testid="text-tutor-usage">
              {usage.data ? `Today: ${usage.data.students} student${usage.data.students === 1 ? "" : "s"}, ${Math.round(usage.data.totalSeconds / 60)} min in total.` : "Today: —"}
            </p>
            {usage.data?.week && usage.data.week.lessons > 0 && (
              <p className="text-xs text-gray-500" data-testid="text-tutor-week">
                Last 7 days: {usage.data.week.lessons} lesson{usage.data.week.lessons === 1 ? "" : "s"} by {usage.data.week.students} student{usage.data.week.students === 1 ? "" : "s"}, {Math.round(usage.data.week.seconds / 60)} min, {usage.data.week.completed} finished
                {usage.data.week.checksTotal > 0 ? ` · quick checks ${Math.round((100 * usage.data.week.checksCorrect) / usage.data.week.checksTotal)}% right` : ""}.
              </p>
            )}

            {/* ── The teacher ── */}
            <div className="space-y-3 border-t pt-4">
              <div>
                <p className="text-sm font-semibold">Teacher</p>
                <p className="text-xs text-gray-500">Who students learn with: a name and a voice per lesson language, so the accent fits.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tutor-teacher-name">Teacher's name</Label>
                <Input id="tutor-teacher-name" value={teacherName} maxLength={40} onChange={(e) => setTeacherName(e.target.value)} placeholder="e.g. Priya Ma'am" data-testid="input-tutor-teacher-name" />
                <p className="text-xs text-gray-500">The tutor introduces itself with it ("Hi! I'm Priya Ma'am, your tutor."). Leave empty for no introduction.</p>
              </div>
              <div className="space-y-2">
                <Label>Voices</Label>
                {VOICE_LANGS.map((l) => (
                  <VoiceRow
                    key={l.id}
                    lang={l}
                    value={voices[l.id] ?? null}
                    open={openVoice === l.id}
                    onToggle={() => setOpenVoice((v) => (v === l.id ? null : l.id))}
                    onChange={(v) => setVoices((prev) => ({ ...prev, [l.id]: v }))}
                  />
                ))}
                <p className="text-xs text-gray-500">A lesson's language follows the chapter's medium (Hindi medium → Hindi) and the student's voice language.</p>
              </div>
            </div>

            {/* ── Video ── */}
            <div className="space-y-3 border-t pt-4">
              <div>
                <p className="text-sm font-semibold">Video</p>
                <p className="text-xs text-gray-500">The video tutor uses this account's Live AI avatar: its provider, key, parental consent and monthly minutes.</p>
              </div>
              <RadioGroup value={avatarMode} onValueChange={(v) => setAvatarMode(v as "auto" | "voice")} className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3" data-testid="option-tutor-video-auto">
                  <RadioGroupItem value="auto" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">Video tutor when the avatar can start</span>
                    <span className="block text-xs text-gray-500">The teacher appears on video next to the board; if video can't start, the lesson carries on with voice.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3" data-testid="option-tutor-video-off">
                  <RadioGroupItem value="voice" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">Voice and board only</span>
                    <span className="block text-xs text-gray-500">No video in lessons (the Live AI avatar stays available in normal chat).</span>
                  </span>
                </label>
              </RadioGroup>
              {avatarMode === "auto" && (
                <>
                  {avatar?.ready ? (
                    <p className="flex items-start gap-1.5 text-xs text-emerald-700" data-testid="text-tutor-avatar-status">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> Live AI avatar is ready ({avatar.providerLabel}{avatar.avatarId ? `, avatar ${avatar.avatarId}` : ""}).
                    </p>
                  ) : (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800" data-testid="text-tutor-avatar-status">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <span>Lessons will be voice-only until the Live AI avatar is set up for this account{avatar?.missing?.length ? ` (${avatar.missing.join(", ")})` : ""}. Use "Live AI avatar → Set up" on this page.</span>
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="tutor-avatar-id">Teacher's avatar (optional)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="tutor-avatar-id"
                        value={avatarId}
                        onChange={(e) => { setAvatarCheck(null); setAvatarId(e.target.value); }}
                        placeholder={avatar?.avatarId ? `Same as the account's (${avatar.avatarId})` : "avatar id"}
                        data-testid="input-tutor-avatar-id"
                      />
                      <Button type="button" variant="outline" size="sm" className="h-10" disabled={!avatarId.trim() || !avatar || checkAvatar.isPending} onClick={() => checkAvatar.mutate()} data-testid="button-check-tutor-avatar">
                        {checkAvatar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
                      </Button>
                    </div>
                    {avatarCheck ? (
                      <p className={`text-xs ${avatarCheck.ok ? "text-emerald-700" : "text-red-600"}`}>{avatarCheck.text}</p>
                    ) : (
                      <p className="text-xs text-gray-500">A different {avatar?.providerLabel || "avatar"} look for teaching, e.g. a teacher in a classroom. Leave empty to use the account's avatar.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!!minutesError || save.isPending || settings.isLoading || settings.isError} data-testid="button-save-tutor">
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
