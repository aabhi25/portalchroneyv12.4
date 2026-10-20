import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Play, Volume2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ElevenLabsVoiceBrowser } from "./ElevenLabsVoiceBrowser";

export const OPENAI_VOICES: Array<{ id: string; label: string; desc: string; gender: string }> = [
  { id: "alloy", label: "Alloy", desc: "Neutral and balanced voice", gender: "Neutral" },
  { id: "marin", label: "Marin", desc: "Natural and expressive voice", gender: "Neutral" },
  { id: "cedar", label: "Cedar", desc: "Clear and natural voice", gender: "Neutral" },
  { id: "ash", label: "Ash", desc: "Clear and precise voice", gender: "Male" },
  { id: "ballad", label: "Ballad", desc: "Melodic and smooth voice", gender: "Male" },
  { id: "coral", label: "Coral", desc: "Warm and friendly voice", gender: "Female" },
  { id: "echo", label: "Echo", desc: "Warm and engaging male voice", gender: "Male" },
  { id: "fable", label: "Fable", desc: "Expressive British accent", gender: "Male" },
  { id: "onyx", label: "Onyx", desc: "Deep and authoritative male voice", gender: "Male" },
  { id: "nova", label: "Nova", desc: "Bright and energetic female voice", gender: "Female" },
  { id: "sage", label: "Sage", desc: "Calm and thoughtful voice", gender: "Female" },
  { id: "shimmer", label: "Shimmer", desc: "Warm and expressive female voice", gender: "Female" },
  { id: "verse", label: "Verse", desc: "Versatile and expressive voice", gender: "Male" },
];

const WIDGET = "__widget__";

/** "el:abc…" → the ElevenLabs voice's name; "shimmer" → "Shimmer". */
export function useVoiceName(selection: string | null | undefined): string | null {
  const elId = selection?.startsWith("el:") ? selection.slice(3) : null;
  const q = useQuery({
    queryKey: ["elevenlabs-voice", elId],
    enabled: !!elId,
    queryFn: async () => {
      const r = await fetch(`/api/elevenlabs/voices/${encodeURIComponent(elId!)}`, { credentials: "include" });
      return r.ok ? ((await r.json()) as { name: string }) : null;
    },
    staleTime: 60 * 60 * 1000,
  });
  if (!selection) return null;
  if (elId) return q.data?.name || "ElevenLabs voice";
  return OPENAI_VOICES.find((v) => v.id === selection)?.label || selection;
}

/**
 * The voice used on phone calls. `value` null = the website chat widget's voice (the default).
 * `defaultOption` relabels that first choice for other uses (e.g. the AI tutor's Hinglish voice,
 * whose default is the Hindi voice).
 */
export function CallVoicePicker({ value, onChange, defaultOption }: {
  value: string | null;
  onChange: (v: string | null) => void;
  defaultOption?: { label: string; description: string };
}) {
  const { toast } = useToast();
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [showOpenAi, setShowOpenAi] = useState(false);

  const widget = useQuery({
    queryKey: ["/api/widget-settings"],
    queryFn: async () => {
      const r = await fetch("/api/widget-settings", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load widget settings");
      return r.json() as Promise<{ voiceSelection?: string | null; hasElevenLabsKey?: boolean }>;
    },
    staleTime: 60 * 1000,
  });
  const widgetVoice = widget.data?.voiceSelection || "shimmer";
  const widgetVoiceName = useVoiceName(widgetVoice);

  useEffect(() => () => { currentAudio?.pause(); }, [currentAudio]);
  useEffect(() => {
    if (value && OPENAI_VOICES.some((v) => v.id === value)) setShowOpenAi(true);
  }, [value]);

  const playOpenAi = async (voiceId: string) => {
    if (currentAudio) {
      currentAudio.pause();
      setCurrentAudio(null);
      if (playingVoice === voiceId) { setPlayingVoice(null); return; }
    }
    try {
      setPlayingVoice(voiceId);
      const response = await fetch(`/api/voice-preview?voice=${voiceId}`, { credentials: "include" });
      if (!response.ok) throw new Error("preview");
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audio.onended = () => { setPlayingVoice(null); setCurrentAudio(null); URL.revokeObjectURL(url); };
      setCurrentAudio(audio);
      await audio.play();
    } catch {
      setPlayingVoice(null);
      toast({ title: "Error", description: "Failed to play voice preview", variant: "destructive" });
    }
  };

  const selection = value ?? WIDGET;
  const select = (v: string) => onChange(v === WIDGET ? null : v);

  return (
    <RadioGroup value={selection} onValueChange={select} className="space-y-3">
      <div
        className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer transition-all ${
          selection === WIDGET ? "border-purple-500 bg-purple-50/50" : "border-gray-200 hover:border-purple-300 bg-white"
        }`}
        onClick={() => select(WIDGET)}
        data-testid="option-call-voice-widget"
      >
        <RadioGroupItem value={WIDGET} id="call-voice-widget" className="mt-1" />
        <div className="flex-1 min-w-0">
          <Label htmlFor="call-voice-widget" className="font-semibold cursor-pointer text-sm">{defaultOption?.label ?? "Same as the website chat widget"}</Label>
          <p className="text-xs text-gray-500 mt-0.5">
            {defaultOption ? defaultOption.description : widget.isLoading ? "Loading…" : <>Currently <strong className="text-gray-700">{widgetVoiceName}</strong> — changes when the widget's voice changes.</>}
          </p>
        </div>
      </div>

      <Collapsible open={showOpenAi} onOpenChange={setShowOpenAi}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider py-1">
            OpenAI voices <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showOpenAi ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          {OPENAI_VOICES.map((voice) => (
            <div
              key={voice.id}
              className={`flex items-center gap-3 rounded-xl border-2 p-3 cursor-pointer transition-all ${
                selection === voice.id ? "border-purple-500 bg-purple-50/50" : "border-gray-200 hover:border-purple-300 bg-white"
              }`}
              onClick={() => select(voice.id)}
            >
              <RadioGroupItem value={voice.id} id={`call-voice-${voice.id}`} />
              <div className="flex-1 min-w-0">
                <Label htmlFor={`call-voice-${voice.id}`} className="font-semibold cursor-pointer text-sm flex items-center gap-2">
                  {voice.label}
                  <span className="text-[10px] font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">{voice.gender}</span>
                </Label>
                <p className="text-xs text-gray-500">{voice.desc}</p>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); playOpenAi(voice.id); }}
                disabled={playingVoice !== null && playingVoice !== voice.id}
                className={`p-1.5 rounded-lg disabled:opacity-50 ${playingVoice === voice.id ? "bg-purple-500 text-white" : "bg-gray-100 hover:bg-purple-100 text-gray-700"}`}
                aria-label={`Play ${voice.label} sample`}
              >
                {playingVoice === voice.id ? <Volume2 className="w-4 h-4 animate-pulse" /> : <Play className="w-4 h-4" />}
              </button>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      {widget.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />Loading voices…</div>
      ) : widget.data?.hasElevenLabsKey ? (
        <ElevenLabsVoiceBrowser
          voiceSelection={selection}
          setVoiceSelection={select}
          playingVoice={playingVoice}
          setPlayingVoice={setPlayingVoice}
          currentAudio={currentAudio}
          setCurrentAudio={setCurrentAudio}
        />
      ) : (
        <p className="text-xs text-gray-500 border-t pt-3">Add an ElevenLabs API key (Website chat widget → Voice) to choose from ElevenLabs voices, including native Hindi ones.</p>
      )}
    </RadioGroup>
  );
}
