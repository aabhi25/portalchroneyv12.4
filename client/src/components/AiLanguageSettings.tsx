/**
 * Train Chroney → Language: which languages the AI replies in (website, voice, WhatsApp,
 * Instagram, Facebook), plus the K-12 / TopScholar "follow the student's medium" options.
 * Reads / saves GET/PUT /api/ai-language-settings (server/routes/aiLanguage.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, GraduationCap, Loader2, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  DEFAULT_AI_LANGUAGE_SETTINGS,
  REPLY_CHANNELS,
  REPLY_LANGUAGES,
  replyLanguageName,
  type AiLanguageSettings,
  type ReplyChannel,
} from "@shared/replyLanguages";

const QUERY_KEY = ["/api/ai-language-settings"];

const CHANNEL_LABELS: Record<ReplyChannel, string> = {
  website: "Website chat",
  voice: "Voice & video calls",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

function nativeLabel(code: string): string {
  const l = REPLY_LANGUAGES.find((x) => x.code === code);
  if (!l) return code;
  if (code === "hinglish") return "Hinglish (Hindi in English letters)";
  return l.nativeName === l.name ? l.name : `${l.name} · ${l.nativeName}`;
}

/** Multi-select of reply languages as a grid of checkboxes. */
function LanguagePicker({ value, onChange, testId }: { value: string[]; onChange: (next: string[]) => void; testId: string }) {
  const toggle = (code: string, on: boolean) => {
    const next = on ? [...value, code] : value.filter((c) => c !== code);
    onChange(REPLY_LANGUAGES.map((l) => l.code).filter((c) => next.includes(c)));
  };
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" data-testid={testId}>
      {REPLY_LANGUAGES.map((l) => {
        const checked = value.includes(l.code);
        return (
          <label
            key={l.code}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm cursor-pointer transition-colors ${checked ? "border-purple-400 bg-purple-50 dark:bg-purple-950/30" : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"}`}
          >
            <Checkbox checked={checked} onCheckedChange={(v) => toggle(l.code, v === true)} data-testid={`${testId}-${l.code}`} />
            <span className="truncate">{nativeLabel(l.code)}</span>
          </label>
        );
      })}
    </div>
  );
}

function DefaultLanguageSelect({ allowed, value, onChange, testId }: { allowed: string[]; value: string | null; onChange: (v: string) => void; testId: string }) {
  return (
    <Select value={value && allowed.includes(value) ? value : undefined} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-72" data-testid={testId}>
        <SelectValue placeholder="Choose the default language" />
      </SelectTrigger>
      <SelectContent>
        {allowed.map((code) => (
          <SelectItem key={code} value={code}>{nativeLabel(code)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Keep the default inside the allowed list when languages are unticked. */
function withValidDefault(allowed: string[], current: string | null): string | null {
  if (current && allowed.includes(current)) return current;
  return allowed[0] ?? null;
}

export default function AiLanguageSettingsPanel({ businessAccountId }: { businessAccountId?: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const url = businessAccountId ? `/api/ai-language-settings?businessAccountId=${encodeURIComponent(businessAccountId)}` : "/api/ai-language-settings";

  const { data, isLoading, isError } = useQuery<{ settings: AiLanguageSettings }>({
    queryKey: businessAccountId ? [...QUERY_KEY, businessAccountId] : QUERY_KEY,
    queryFn: () => apiRequest("GET", url),
  });

  const [draft, setDraft] = useState<AiLanguageSettings>(DEFAULT_AI_LANGUAGE_SETTINGS);
  const [mediumRows, setMediumRows] = useState<Array<{ medium: string; language: string }>>([]);
  const [showChannels, setShowChannels] = useState(false);
  const [showK12, setShowK12] = useState(false);

  const loaded = data?.settings;
  useEffect(() => {
    if (!loaded) return;
    setDraft(loaded);
    setMediumRows(Object.entries(loaded.mediumMap || {}).map(([medium, language]) => ({ medium, language })));
    setShowChannels(Object.keys(loaded.channelOverrides || {}).length > 0);
    setShowK12(!!loaded.followMedium);
  }, [loaded]);

  const toSave = useMemo<AiLanguageSettings>(() => ({
    ...draft,
    mediumMap: Object.fromEntries(mediumRows.filter((r) => r.medium.trim() && r.language).map((r) => [r.medium.trim().toLowerCase(), r.language])),
  }), [draft, mediumRows]);
  const dirty = !!loaded && JSON.stringify(toSave) !== JSON.stringify({ ...loaded, mediumMap: loaded.mediumMap || {} });
  // Problems already shown next to the field: don't send them to the server.
  const invalid = (draft.mode === "restricted" && draft.allowed.length === 0)
    || Object.values(draft.channelOverrides || {}).some((o) => !!o && Array.isArray(o.allowed) && o.allowed.length === 0);

  const save = useMutation({
    mutationFn: () => apiRequest<{ settings: AiLanguageSettings }>("PUT", url, { settings: toSave }),
    onSuccess: (res) => {
      queryClient.setQueryData(businessAccountId ? [...QUERY_KEY, businessAccountId] : QUERY_KEY, res);
      toast({ title: "Language settings saved", description: "Chroney uses them from the next message." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't save language settings", description: error.message || "Please try again.", variant: "destructive" });
    },
  });

  const set = (patch: Partial<AiLanguageSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const setAllowed = (allowed: string[]) => set({ allowed, defaultLanguage: withValidDefault(allowed, draft.defaultLanguage) ?? draft.defaultLanguage });
  const restricted = draft.mode === "restricted";
  const hindiAllowed = restricted && (draft.allowed.includes("hi") || draft.allowed.includes("hinglish"));

  const setChannel = (ch: ReplyChannel, override: { allowed: string[] | null; defaultLanguage: string | null } | null) => {
    setDraft((d) => {
      const next = { ...(d.channelOverrides || {}) };
      if (override) next[ch] = override; else delete next[ch];
      return { ...d, channelOverrides: next };
    });
  };

  if (isLoading) {
    return (
      <Card className="shadow-sm"><CardContent className="py-10 flex items-center justify-center text-sm text-gray-500"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading language settings…</CardContent></Card>
    );
  }
  if (isError) {
    return (
      <Card className="shadow-sm"><CardContent className="py-10 text-center text-sm text-red-600">Couldn't load the language settings. Please refresh the page.</CardContent></Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="ai-language-settings">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Globe2 className="w-5 h-5 text-purple-600" /> Reply language</CardTitle>
          <CardDescription>
            Choose which languages Chroney replies in. This applies to your website chat, voice and video calls, WhatsApp,
            Instagram and Facebook.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup value={draft.mode} onValueChange={(v) => set({ mode: v as AiLanguageSettings["mode"] })} className="space-y-2">
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
              <RadioGroupItem value="any" id="lang-mode-any" className="mt-0.5" data-testid="lang-mode-any" />
              <div>
                <div className="font-medium text-sm">Any language</div>
                <div className="text-xs text-gray-500">Chroney replies in the language your customer writes in (how it works today).</div>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
              <RadioGroupItem value="restricted" id="lang-mode-restricted" className="mt-0.5" data-testid="lang-mode-restricted" />
              <div>
                <div className="font-medium text-sm">Only these languages</div>
                <div className="text-xs text-gray-500">Chroney replies only in the languages you pick below, even if the customer writes in another one.</div>
              </div>
            </label>
          </RadioGroup>

          {restricted && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Languages Chroney may reply in</Label>
                <LanguagePicker value={draft.allowed} onChange={setAllowed} testId="lang-allowed" />
                {draft.allowed.length === 0 && <p className="text-xs text-red-600">Pick at least one language.</p>}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Default language</Label>
                <p className="text-xs text-gray-500">Used to start conversations and whenever the customer writes in a language that isn't allowed.</p>
                <DefaultLanguageSelect allowed={draft.allowed} value={draft.defaultLanguage} onChange={(v) => set({ defaultLanguage: v })} testId="lang-default" />
              </div>

              {hindiAllowed && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">How to write Hindi</Label>
                  <RadioGroup value={draft.hindiScript} onValueChange={(v) => set({ hindiScript: v as AiLanguageSettings["hindiScript"] })} className="space-y-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="match" /> Match the customer (हिन्दी if they write हिन्दी, English letters if they write Hinglish)</label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="devanagari" /> Always in Hindi script (हिन्दी)</label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="roman" /> Always in English letters (Hinglish)</label>
                  </RadioGroup>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-sm font-medium">When a customer writes in another language</Label>
                <RadioGroup value={draft.unsupportedBehaviour} onValueChange={(v) => set({ unsupportedBehaviour: v as AiLanguageSettings["unsupportedBehaviour"] })} className="space-y-1">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <RadioGroupItem value="default_with_note" className="mt-0.5" />
                    <span>Answer in the default language, and say once which languages Chroney can help in <span className="text-gray-500">(recommended)</span></span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <RadioGroupItem value="ask_to_switch" className="mt-0.5" />
                    <span>Politely ask the customer to continue in one of your languages</span>
                  </label>
                </RadioGroup>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">Translate my custom welcome message</div>
                  <div className="text-xs text-gray-500">Show your own welcome message in the default language too. Off: it is shown exactly as you wrote it.</div>
                </div>
                <Switch checked={draft.translateCustomWelcome} onCheckedChange={(v) => set({ translateCustomWelcome: v })} data-testid="lang-translate-welcome" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <Collapsible open={showChannels} onOpenChange={setShowChannels}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <button type="button" className="text-left w-full" data-testid="lang-channels-toggle">
                <CardTitle className="text-base">Different languages per channel {showChannels ? "▴" : "▾"}</CardTitle>
                <CardDescription>Optional — for example Hindi only on WhatsApp while the website allows English and Hindi.</CardDescription>
              </button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              {REPLY_CHANNELS.map((ch) => {
                const o = draft.channelOverrides?.[ch];
                const own = !!o?.allowed;
                return (
                  <div key={ch} className="rounded-lg border p-3 space-y-3" data-testid={`lang-channel-${ch}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-medium">{CHANNEL_LABELS[ch]}</div>
                      <Select
                        value={own ? "own" : "same"}
                        onValueChange={(v) => setChannel(ch, v === "own"
                          ? { allowed: restricted ? [...draft.allowed] : [draft.defaultLanguage], defaultLanguage: draft.defaultLanguage }
                          : null)}
                      >
                        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="same">Same as above</SelectItem>
                          <SelectItem value="own">Only these languages…</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {own && (
                      <div className="space-y-3">
                        <LanguagePicker
                          value={o!.allowed || []}
                          onChange={(allowed) => setChannel(ch, { allowed, defaultLanguage: withValidDefault(allowed, o!.defaultLanguage) })}
                          testId={`lang-channel-${ch}-allowed`}
                        />
                        {(o!.allowed || []).length === 0 && <p className="text-xs text-red-600">Pick at least one language for {CHANNEL_LABELS[ch]}.</p>}
                        <div className="space-y-1">
                          <Label className="text-xs text-gray-500">Default language on {CHANNEL_LABELS[ch]}</Label>
                          <DefaultLanguageSelect allowed={o!.allowed || []} value={o!.defaultLanguage} onChange={(v) => setChannel(ch, { allowed: o!.allowed, defaultLanguage: v })} testId={`lang-channel-${ch}-default`} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Card className="shadow-sm">
        <Collapsible open={showK12} onOpenChange={setShowK12}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger asChild>
              <button type="button" className="text-left w-full" data-testid="lang-k12-toggle">
                <CardTitle className="text-base flex items-center gap-2"><GraduationCap className="w-4 h-4 text-purple-600" /> K-12 / TopScholar {showK12 ? "▴" : "▾"}</CardTitle>
                <CardDescription>For schools: start each student in their medium's language (Hindi medium → Hindi).</CardDescription>
              </button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-5">
              <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">Follow the student's medium</div>
                  <div className="text-xs text-gray-500">The tutor starts in the language of the student's medium. Unknown medium → the default language.</div>
                </div>
                <Switch checked={draft.followMedium} onCheckedChange={(v) => set({ followMedium: v })} data-testid="lang-follow-medium" />
              </div>

              {draft.followMedium && (
                <>
                  <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                    <div>
                      <div className="text-sm font-medium">Student can switch language</div>
                      <div className="text-xs text-gray-500">On: the student can ask ("explain in English", "Hindi mein batao") or use the language menu. Off: always the medium's language.</div>
                    </div>
                    <Switch checked={draft.mediumSwitchable} onCheckedChange={(v) => set({ mediumSwitchable: v })} data-testid="lang-medium-switchable" />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Hindi medium style</Label>
                    <RadioGroup value={draft.mediumStyle} onValueChange={(v) => set({ mediumStyle: v as AiLanguageSettings["mediumStyle"] })} className="space-y-1">
                      <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="with_english_terms" /> Hindi, with the English term for technical words in brackets — प्रकाश संश्लेषण (photosynthesis)</label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="pure" /> Pure Hindi</label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer"><RadioGroupItem value="hinglish" /> Hinglish (Hindi in English letters)</label>
                    </RadioGroup>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Medium → language</Label>
                    <p className="text-xs text-gray-500">The medium name as your school system sends it (not case-sensitive), and the language to use.</p>
                    <div className="space-y-2" data-testid="lang-medium-map">
                      {mediumRows.map((row, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Input
                            value={row.medium}
                            placeholder="e.g. Semi-English"
                            className="flex-1"
                            onChange={(e) => setMediumRows((rows) => rows.map((r, j) => (j === i ? { ...r, medium: e.target.value } : r)))}
                          />
                          <Select value={row.language} onValueChange={(v) => setMediumRows((rows) => rows.map((r, j) => (j === i ? { ...r, language: v } : r)))}>
                            <SelectTrigger className="w-48"><SelectValue placeholder="Language" /></SelectTrigger>
                            <SelectContent>
                              {REPLY_LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{replyLanguageName(l.code)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button type="button" variant="ghost" size="icon" aria-label="Remove row" onClick={() => setMediumRows((rows) => rows.filter((_, j) => j !== i))}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => setMediumRows((rows) => [...rows, { medium: "", language: "en" }])} data-testid="lang-medium-add">
                        <Plus className="w-4 h-4 mr-1" /> Add medium
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || save.isPending}
          onClick={() => {
            if (!loaded) return;
            setDraft(loaded);
            setMediumRows(Object.entries(loaded.mediumMap || {}).map(([medium, language]) => ({ medium, language })));
          }}
        >
          <Undo2 className="w-4 h-4 mr-1" /> Undo changes
        </Button>
        <Button type="button" disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()} data-testid="lang-save">
          {save.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          Save language settings
        </Button>
      </div>
    </div>
  );
}
