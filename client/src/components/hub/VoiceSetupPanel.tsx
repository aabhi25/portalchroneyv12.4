import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, Loader2, Mic, Play, TriangleAlert, Volume2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SetupPanel } from "./SetupPanel";
import { ElevenLabsVoiceBrowser } from "@/components/voice/ElevenLabsVoiceBrowser";
import { OPENAI_VOICES, useVoiceName } from "@/components/voice/CallVoicePicker";

export interface FeatureStatus {
  state: "ready" | "needs_setup" | "off";
  problem?: string;
  voiceSelection?: string;
  provider?: "openai" | "elevenlabs";
  hasElevenLabsKey?: boolean;
}

interface VoiceSetup {
  status: FeatureStatus;
  voiceSelection: string;
  hasElevenLabsKey: boolean;
  elevenLabsKeyHint: string | null;
}

export const featureStatusKey = (accountId: string) => ["/api/super-admin/accounts", accountId, "feature-status"];
const voiceSetupKey = (accountId: string) => ["/api/super-admin/accounts", accountId, "voice-setup"];

/** "ElevenLabs voice: Rachel" / "OpenAI voice: Shimmer" for a row's status line. */
export function useVoiceStatusText(status: FeatureStatus | undefined, accountId: string): string | null {
  const name = useVoiceName(status?.voiceSelection, accountId);
  if (!status || status.state === "off") return null;
  if (status.state === "needs_setup") return status.problem || "Needs setting up";
  return `${status.provider === "elevenlabs" ? "ElevenLabs" : "OpenAI"} voice: ${name ?? "…"}`;
}

/**
 * Voice mode set-up for one account (super admin): which voice the website chat speaks with,
 * OpenAI's voices or ElevenLabs' (the account's own ElevenLabs key, saved here).
 */
export function VoiceSetupPanel({ open, onOpenChange, businessAccountId, businessName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessAccountId: string;
  businessName: string;
}) {
  const { toast } = useToast();
  const setup = useQuery<VoiceSetup>({ queryKey: voiceSetupKey(businessAccountId), enabled: open, staleTime: 0 });
  const [provider, setProvider] = useState<"openai" | "elevenlabs">("openai");
  const [voice, setVoice] = useState("shimmer");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!setup.data) return;
    setVoice(setup.data.voiceSelection);
    setProvider(setup.data.voiceSelection.startsWith("el:") ? "elevenlabs" : "openai");
  }, [setup.data]);
  useEffect(() => () => { currentAudio?.pause(); }, [currentAudio]);

  const refresh = (data: VoiceSetup) => {
    queryClient.setQueryData(voiceSetupKey(businessAccountId), data);
    queryClient.invalidateQueries({ queryKey: featureStatusKey(businessAccountId) });
    queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", businessAccountId, "api-settings"] });
  };

  const saveKey = useMutation({
    mutationFn: (body: { elevenlabsApiKey?: string; removeElevenLabsKey?: boolean }) =>
      apiRequest<VoiceSetup>("PUT", `/api/super-admin/accounts/${businessAccountId}/voice-setup`, body),
    onSuccess: (data, body) => {
      refresh(data);
      setKey("");
      toast({ title: body.removeElevenLabsKey ? "ElevenLabs key removed" : "ElevenLabs key saved", description: body.removeElevenLabsKey ? undefined : "Stored for this account. Pick a voice below." });
    },
    onError: (e: Error) => toast({ title: "Couldn't save the key", description: e.message, variant: "destructive" }),
  });
  const saveVoice = useMutation({
    mutationFn: () => apiRequest<VoiceSetup>("PUT", `/api/super-admin/accounts/${businessAccountId}/voice-setup`, { voiceSelection: voice }),
    onSuccess: (data) => { refresh(data); toast({ title: "Voice saved", description: "The website chat speaks with it from the next conversation." }); onOpenChange(false); },
    onError: (e: Error) => toast({ title: "Couldn't save the voice", description: e.message, variant: "destructive" }),
  });

  const playOpenAi = async (voiceId: string) => {
    if (currentAudio) {
      currentAudio.pause();
      setCurrentAudio(null);
      if (playingVoice === voiceId) { setPlayingVoice(null); return; }
    }
    try {
      setPlayingVoice(voiceId);
      const r = await fetch(`/api/voice-preview?voice=${voiceId}&businessAccountId=${encodeURIComponent(businessAccountId)}`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "preview");
      const url = URL.createObjectURL(await r.blob());
      const audio = new Audio(url);
      audio.onended = () => { setPlayingVoice(null); setCurrentAudio(null); URL.revokeObjectURL(url); };
      setCurrentAudio(audio);
      await audio.play();
    } catch (e: any) {
      setPlayingVoice(null);
      toast({ title: "Couldn't play the sample", description: e?.message !== "preview" ? e?.message : undefined, variant: "destructive" });
    }
  };

  const data = setup.data;
  const status = data?.status;
  const hasKey = !!data?.hasElevenLabsKey;
  const chosenEleven = voice.startsWith("el:");
  const changed = !!data && voice !== data.voiceSelection;

  return (
    <SetupPanel
      open={open}
      onOpenChange={onOpenChange}
      icon={Mic}
      title={<>Voice mode · {businessName}</>}
      description="The voice the website chat speaks with when visitors talk to it: one of OpenAI's voices, or any ElevenLabs voice (with the account's own ElevenLabs key)."
      wide
      testId="panel-voice-setup"
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        <Button onClick={() => saveVoice.mutate()} disabled={!changed || saveVoice.isPending || (chosenEleven && !hasKey)} data-testid="button-save-voice">
          {saveVoice.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save voice
        </Button>
      </>}
    >
      {setup.isLoading || !data ? (
        <div className="py-10 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-gray-400" /></div>
      ) : (
        <div className="space-y-6">
          {status && status.state !== "ready" && (
            <p className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${status.state === "off" ? "border-gray-200 bg-gray-50 text-gray-600" : "border-amber-200 bg-amber-50 text-amber-800"}`} data-testid="text-voice-setup-status">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {status.state === "off" ? "Voice mode is switched off for this account. You can still choose its voice now." : status.problem}
            </p>
          )}

          <section className="space-y-2">
            <Label>Voices from</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["openai", "OpenAI", "13 built-in voices, no extra key"],
                ["elevenlabs", "ElevenLabs", "Thousands of voices, incl. native Hindi; needs a key"],
              ] as const).map(([id, title, hint]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setProvider(id)}
                  className={`rounded-xl border p-3 text-left ${provider === id ? "border-purple-500 bg-purple-50" : "border-gray-200 hover:bg-gray-50"}`}
                  data-testid={`voice-provider-${id}`}
                >
                  <span className={`block text-sm font-medium ${provider === id ? "text-purple-900" : "text-gray-800"}`}>{title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
          </section>

          {provider === "elevenlabs" && (
            <section className="space-y-2 rounded-xl border p-4" data-testid="section-elevenlabs-key">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="el-key">ElevenLabs API key</Label>
                {hasKey
                  ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> Saved {data.elevenLabsKeyHint}</span>
                  : <span className="text-xs text-amber-700">Not added yet</span>}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input id="el-key" type={showKey ? "text" : "password"} autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "Type a new key to replace it" : "sk_…"} data-testid="input-elevenlabs-key" />
                  <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" aria-label={showKey ? "Hide key" : "Show key"}>
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button onClick={() => saveKey.mutate({ elevenlabsApiKey: key })} disabled={!key.trim() || saveKey.isPending} data-testid="button-save-elevenlabs-key">
                  {saveKey.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save key
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The account's own key from elevenlabs.io (Profile › API keys). Its ElevenLabs plan pays for the voice.
                {hasKey && <> <button type="button" className="text-red-600 hover:underline" onClick={() => saveKey.mutate({ removeElevenLabsKey: true })}>Remove key</button></>}
              </p>
            </section>
          )}

          <section className="space-y-2">
            <Label>Voice</Label>
            {provider === "openai" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {OPENAI_VOICES.map((v) => (
                  <div
                    key={v.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setVoice(v.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") setVoice(v.id); }}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-2.5 ${voice === v.id ? "border-purple-500 bg-purple-50/50" : "border-gray-200 hover:border-purple-300"}`}
                    data-testid={`voice-openai-${v.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium">{v.label}<span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-500">{v.gender}</span></p>
                      <p className="truncate text-xs text-gray-500">{v.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); playOpenAi(v.id); }}
                      disabled={playingVoice !== null && playingVoice !== v.id}
                      className={`rounded-lg p-1.5 disabled:opacity-50 ${playingVoice === v.id ? "bg-purple-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-purple-100"}`}
                      aria-label={`Play ${v.label} sample`}
                    >
                      {playingVoice === v.id ? <Volume2 className="h-4 w-4 animate-pulse" /> : <Play className="h-4 w-4" />}
                    </button>
                  </div>
                ))}
              </div>
            ) : hasKey ? (
              <ElevenLabsVoiceBrowser
                accountId={businessAccountId}
                voiceSelection={voice}
                setVoiceSelection={setVoice}
                playingVoice={playingVoice}
                setPlayingVoice={setPlayingVoice}
                currentAudio={currentAudio}
                setCurrentAudio={setCurrentAudio}
              />
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Save the ElevenLabs key above, then pick a voice here.</p>
            )}
          </section>
        </div>
      )}
    </SetupPanel>
  );
}
