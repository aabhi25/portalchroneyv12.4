import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Play, Search, Volume2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description: string | null;
  preview_url: string | null;
  labels: Record<string, string>;
  usage_1y?: number | null;
  cloned_by_count?: number | null;
  language?: string | null;
}

type VoicePage = { voices: ElevenLabsVoice[]; has_more: boolean; next_page: number | null };

const LANGUAGES: Array<{ code: string; name: string }> = [
  { code: "hi", name: "Hindi" },
  { code: "en", name: "English" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "bn", name: "Bengali" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "pa", name: "Punjabi" },
];

const SORTS: Array<{ value: string; label: string }> = [
  { value: "usage_character_count_1y", label: "Most popular" },
  { value: "cloned_by_count", label: "Most added" },
  { value: "trending", label: "Trending" },
  { value: "created_date", label: "Newest" },
];

/** 228709 → "229K", 3795550379 → "3.8B". */
function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function VoiceTags({ voice }: { voice: ElevenLabsVoice }) {
  const gender = voice.labels?.gender || "";
  const accent = voice.labels?.accent || "";
  const useCase = voice.labels?.use_case || voice.labels?.["use case"] || "";
  return (
    <>
      {gender && <span className="text-[10px] font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full capitalize">{gender}</span>}
      {accent && <span className="text-[10px] font-normal text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full capitalize">{accent}</span>}
      {useCase && <span className="text-[10px] font-normal text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full capitalize">{useCase.replace(/_/g, " ")}</span>}
    </>
  );
}

/**
 * ElevenLabs Voice Library picker: the selected voice by name with its sample, several languages
 * at once, and sorting by popularity (most used in the last year first by default).
 */
export function ElevenLabsVoiceBrowser({
  voiceSelection,
  setVoiceSelection,
  playingVoice,
  setPlayingVoice,
  currentAudio,
  setCurrentAudio,
  accountId,
}: {
  /** Super admin setting up another account from its page: whose ElevenLabs key to use. */
  accountId?: string;
  voiceSelection: string;
  setVoiceSelection: (v: string) => void;
  playingVoice: string | null;
  setPlayingVoice: (v: string | null) => void;
  currentAudio: HTMLAudioElement | null;
  setCurrentAudio: (a: HTMLAudioElement | null) => void;
}) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [languages, setLanguages] = useState<string[]>(["hi"]);
  const [gender, setGender] = useState("");
  const [sort, setSort] = useState("usage_character_count_1y");
  const [page, setPage] = useState(0);
  const [allVoices, setAllVoices] = useState<ElevenLabsVoice[]>([]);
  /** Voices picked in this session, so the selected card shows at once (before the lookup returns). */
  const [known, setKnown] = useState<Record<string, ElevenLabsVoice>>({});
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    // Only a real change restarts the list (on mount this used to clear results already shown
    // from the cache, leaving "No voices found").
    if (searchQuery === debouncedSearch) return;
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // New search or filters → back to the first page.
  const filterKey = [debouncedSearch, languages.join(","), gender, sort].join("|");
  const lastFilterKey = useRef(filterKey);
  if (lastFilterKey.current !== filterKey) {
    lastFilterKey.current = filterKey;
    if (page !== 0) setPage(0);
  }

  const voicesQuery = useQuery({
    queryKey: ["elevenlabs-voices", accountId ?? "", debouncedSearch, languages.join(","), gender, sort, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (languages.length) params.set("languages", languages.join(","));
      if (gender) params.set("gender", gender);
      params.set("sort", sort);
      params.set("pageSize", "20");
      params.set("page", String(page));
      if (accountId) params.set("businessAccountId", accountId);
      const response = await fetch(`/api/elevenlabs/voices?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch voices");
      return response.json() as Promise<VoicePage>;
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const data = voicesQuery.data;
    if (!data?.voices) {
      if (page === 0) setAllVoices([]);
      return;
    }
    setAllVoices((prev) => {
      if (page === 0) return data.voices;
      const seen = new Set(prev.map((v) => v.voice_id));
      return [...prev, ...data.voices.filter((v) => !seen.has(v.voice_id))];
    });
  }, [voicesQuery.data, filterKey, page]);

  const selectedId = voiceSelection.startsWith("el:") ? voiceSelection.slice(3) : null;
  const selectedInList = selectedId ? allVoices.find((v) => v.voice_id === selectedId) || known[selectedId] : undefined;
  const selectedQuery = useQuery({
    queryKey: ["elevenlabs-voice", selectedId, accountId ?? ""],
    enabled: !!selectedId && !selectedInList,
    queryFn: async () => {
      const response = await fetch(`/api/elevenlabs/voices/${encodeURIComponent(selectedId!)}${accountId ? `?businessAccountId=${encodeURIComponent(accountId)}` : ""}`, { credentials: "include" });
      if (!response.ok) return null;
      return response.json() as Promise<ElevenLabsVoice>;
    },
    staleTime: 60 * 60 * 1000,
  });
  const selectedVoice = selectedInList || selectedQuery.data || null;

  const choose = (voice: ElevenLabsVoice) => {
    setKnown((k) => ({ ...k, [voice.voice_id]: voice }));
    setVoiceSelection(`el:${voice.voice_id}`);
  };

  const playPreview = async (voiceId: string, previewUrl: string | null) => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setCurrentAudio(null);
      if (playingVoice === `el:${voiceId}`) {
        setPlayingVoice(null);
        return;
      }
    }
    // Library voices are not in the account's own ElevenLabs library, so the sample is played
    // straight from the public preview_url the search returns.
    if (!previewUrl) {
      toast({ title: "No preview", description: "This voice has no preview available.", variant: "destructive" });
      return;
    }
    try {
      setPlayingVoice(`el:${voiceId}`);
      const audio = new Audio(previewUrl);
      audio.onended = () => { setPlayingVoice(null); setCurrentAudio(null); };
      audio.onerror = () => {
        setPlayingVoice(null); setCurrentAudio(null);
        toast({ title: "Error", description: "Failed to play voice preview", variant: "destructive" });
      };
      setCurrentAudio(audio);
      await audio.play();
    } catch {
      setPlayingVoice(null);
      toast({ title: "Error", description: "Failed to load voice preview", variant: "destructive" });
    }
  };

  const PlayButton = ({ voice, size = "sm" }: { voice: ElevenLabsVoice; size?: "sm" | "md" }) => {
    const playing = playingVoice === `el:${voice.voice_id}`;
    const icon = size === "md" ? "w-5 h-5" : "w-4 h-4";
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); playPreview(voice.voice_id, voice.preview_url); }}
        disabled={!voice.preview_url || (playingVoice !== null && !playing)}
        className={`${size === "md" ? "p-2.5" : "p-1.5"} rounded-lg transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ${
          playing ? "bg-purple-500 text-white shadow-lg" : "bg-white hover:bg-purple-100 text-gray-700 hover:text-purple-700 border border-gray-200"
        }`}
        title={!voice.preview_url ? "No preview available" : playing ? "Stop preview" : "Play voice sample"}
        aria-label={playing ? `Stop ${voice.name} sample` : `Play ${voice.name} sample`}
      >
        {playing ? <Volume2 className={`${icon} animate-pulse`} /> : <Play className={icon} />}
      </button>
    );
  };

  const languageLabel = languages.length === 0
    ? "All languages"
    : languages.length <= 2
      ? languages.map((c) => LANGUAGES.find((l) => l.code === c)?.name || c).join(", ")
      : `${languages.length} languages`;
  const toggleLanguage = (code: string) => setLanguages((ls) => (ls.includes(code) ? ls.filter((l) => l !== code) : [...ls, code]));

  return (
    <div className="border-t pt-4 mt-4 min-w-0 w-full">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        ElevenLabs Voices
        <span className="text-[10px] font-medium text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full normal-case tracking-normal">Premium</span>
      </p>

      {selectedId && (
        <div className="mb-4 p-3 rounded-xl bg-purple-50 border border-purple-200 flex items-center gap-3" data-testid="card-selected-voice">
          <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center flex-shrink-0">
            <Check className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-purple-700 uppercase tracking-wide">Selected voice</p>
            {selectedVoice ? (
              <>
                <p className="text-sm font-semibold text-gray-900 truncate">{selectedVoice.name}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5"><VoiceTags voice={selectedVoice} /></div>
              </>
            ) : selectedQuery.isLoading ? (
              <p className="text-sm text-gray-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading voice…</p>
            ) : (
              <p className="text-sm font-semibold text-gray-900 truncate" title="ElevenLabs voice ID">{selectedId}</p>
            )}
          </div>
          {selectedVoice && <PlayButton voice={selectedVoice} size="md" />}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search voices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-voice-search"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="h-9 px-3 rounded-md border border-gray-200 text-sm bg-white flex items-center gap-1.5 max-w-[180px]"
              data-testid="button-voice-languages"
            >
              <span className="truncate">{languageLabel}</span>
              <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-2">
            <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b">
              <span className="text-xs font-medium text-gray-500">Languages</span>
              {languages.length > 0 && (
                <button type="button" className="text-xs text-purple-600 hover:underline" onClick={() => setLanguages([])}>All</button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {LANGUAGES.map((l) => (
                <label key={l.code} className="flex items-center gap-2 px-1 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm">
                  <Checkbox checked={languages.includes(l.code)} onCheckedChange={() => toggleLanguage(l.code)} data-testid={`checkbox-voice-lang-${l.code}`} />
                  {l.name}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="h-9 px-3 rounded-md border border-gray-200 text-sm bg-white"
          aria-label="Gender"
          data-testid="select-voice-gender"
        >
          <option value="">Any gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="h-9 px-3 rounded-md border border-gray-200 text-sm bg-white"
          aria-label="Sort voices"
          data-testid="select-voice-sort"
        >
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {voicesQuery.isLoading && allVoices.length === 0 && (
        <div className="flex items-center justify-center py-8 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading voices...
        </div>
      )}

      {voicesQuery.isError && (
        <div className="py-4 text-center text-sm text-red-500">
          Failed to load voices. Check your ElevenLabs API key.
        </div>
      )}

      <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
        {allVoices.map((voice) => {
          const elId = `el:${voice.voice_id}`;
          const popularity = sort === "cloned_by_count" ? voice.cloned_by_count : voice.usage_1y;
          return (
            <div
              key={voice.voice_id}
              className={`flex items-start space-x-3 rounded-xl border-2 p-3 transition-all cursor-pointer ${
                voiceSelection === elId ? "border-purple-500 bg-purple-50/50 shadow-md" : "border-gray-200 hover:border-purple-300 bg-white"
              }`}
              onClick={() => choose(voice)}
            >
              <RadioGroupItem value={elId} id={elId} className="mt-1 cursor-pointer" onClick={() => choose(voice)} />
              <div className="flex-1 min-w-0">
                <Label htmlFor={elId} className="font-semibold cursor-pointer text-sm flex items-center gap-1.5 flex-wrap">
                  {voice.name}
                  <VoiceTags voice={voice} />
                </Label>
                {voice.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{voice.description}</p>}
                {(popularity ?? 0) > 0 && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    {sort === "cloned_by_count" ? `Added by ${compact(popularity!)} users` : `${compact(popularity!)} characters spoken this year`}
                  </p>
                )}
              </div>
              <PlayButton voice={voice} />
            </div>
          );
        })}
      </div>

      {allVoices.length > 0 && voicesQuery.data?.has_more && voicesQuery.data.next_page != null && (
        <button
          type="button"
          onClick={() => setPage(voicesQuery.data!.next_page!)}
          disabled={voicesQuery.isFetching}
          className="w-full mt-3 py-2 text-sm text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded-lg border border-purple-200 transition-all disabled:opacity-50"
        >
          {voicesQuery.isFetching ? (
            <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading...</span>
          ) : (
            "Load more voices"
          )}
        </button>
      )}

      {!voicesQuery.isLoading && allVoices.length === 0 && !voicesQuery.isError && (
        <div className="py-6 text-center text-sm text-gray-500">
          No voices found. Try adjusting your search or filters.
        </div>
      )}
    </div>
  );
}
