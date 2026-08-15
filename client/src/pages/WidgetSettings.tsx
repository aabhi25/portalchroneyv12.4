import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, 
  Save, 
  Copy, 
  Check, 
  Sparkles, 
  MessageCircle, 
  Send, 
  Palette,
  Settings2,
  Code2,
  Wand2,
  Eye,
  Monitor,
  Maximize2,
  ArrowDownRight,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowUpLeft,
  Upload,
  User,
  Play,
  Volume2,
  Pencil,
  Trash2,
  Plus,
  X,
  Bell,
  Mic,
  Globe,
  Languages,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  ShoppingCart,
  MessageSquare,
  GitCompare,
  Search,
  ExternalLink
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface WidgetSettings {
  id: string;
  businessAccountId: string;
  businessName?: string | null;
  businessWebsite?: string | null;
  k12EducationEnabled?: boolean;
  chatColor: string;
  chatColorEnd: string;
  widgetHeaderText: string;
  welcomeMessageType: string;
  welcomeMessage: string;
  buttonStyle: string;
  buttonAnimation: string;
  personality: string;
  widgetWidth: string;
  widgetHeight: string;
  widgetPosition: string;
  bubbleSize: string;
  sizePreset: string;
  pillBottomOffset?: string;
  pillSideOffset?: string;
  autoOpenChat: string;
  autoOpenFrequency?: string;
  openingSoundEnabled?: string;
  openingSoundStyle?: string;
  voiceSelection: string;
  voiceModeStyle?: string;
  chatMode?: string;
  avatarType?: string;
  avatarUrl?: string;
  customAvatars?: Array<{url: string, uploadedAt: string}>;
  conversationStarters?: string;
  conversationStartersEnabled?: string;
  showStartersOnPill?: string;
  inactivityNudgeEnabled?: string;
  inactivityNudgeDelay?: string;
  inactivityNudgeMessage?: string;
  inactivityNudgeMessages?: { message: string; delay: number }[];
  smartNudgeEnabled?: string;
  proactiveNudgeEnabled?: string;
  proactiveNudgeDelay?: string;
  proactiveNudgeMessage?: string;
  proactiveNudgeMessages?: { message: string; delay: number }[];
  proactiveNudgeRepeat?: string;
  proactiveNudgeBgColor?: string;
  proactiveNudgeBgColorEnd?: string;
  proactiveNudgeTextColor?: string;
  centerBannerEnabled?: string;
  centerBannerDelay?: string;
  centerBannerTitle?: string;
  centerBannerDescription?: string;
  centerBannerButtonText?: string;
  centerBannerShowOnce?: string;
  centerBannerBackgroundStyle?: string;
  centerBannerStartColor?: string;
  centerBannerEndColor?: string;
  centerBannerTextColor?: string;
  centerBannerImageUrl?: string | null;
  reengagementBannerEnabled?: string;
  reengagementBannerDelay?: string;
  reengagementBannerTitle?: string;
  reengagementBannerDescription?: string;
  reengagementBannerButtonText?: string;
  voiceModeEnabled?: boolean;
  hasElevenLabsKey?: boolean;
  languageSelectorEnabled?: string;
  availableLanguages?: string;
  visualSimilarityThreshold?: string;
  visualSearchEnabled?: boolean;
  productPageModeEnabled?: string;
  showAiTrivia?: string;
  showSuggestedQuestions?: string;
  showReviewSummary?: string;
  // Shopping Features
  productCarouselEnabled?: string;
  productCarouselTitle?: string;
  featuredProductIds?: string[] | string;
  quickBrowseEnabled?: string;
  quickBrowseButtons?: Array<{label: string; action: string}> | string;
  productComparisonEnabled?: string;
  whatsappOrderEnabled?: string;
  whatsappOrderNumber?: string;
  addToCartEnabled?: string;
  tryOnEnabled?: string;
  whatsappOrderMessage?: string;
  launcherMode?: string;
  whatsappWidgetNumber?: string;
  whatsappWidgetLabel?: string;
  whatsappWidgetMessage?: string;
  whatsappWidgetColor?: string;
  whatsappWidgetPosition?: string;
  responseLength?: string;
  chatFontSize?: string;
  footerLabelEnabled?: string;
  footerLabelText?: string;
  poweredByEnabled?: string;
  createdAt: string;
  updatedAt: string;
}

const AVAILABLE_LANGUAGES = [
  { code: 'auto', name: 'Auto-detect', nativeName: 'Auto' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'hinglish', name: 'Hinglish', nativeName: 'Hinglish' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ' },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
];

const CHAT_FONT_SIZE_PX: Record<string, string> = {
  small: "13px",
  medium: "14px",
  large: "16px",
};

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description: string | null;
  preview_url: string | null;
  labels: Record<string, string>;
}

function ElevenLabsVoiceBrowser({
  voiceSelection,
  setVoiceSelection,
  playingVoice,
  setPlayingVoice,
  currentAudio,
  setCurrentAudio,
}: {
  voiceSelection: string;
  setVoiceSelection: (v: string) => void;
  playingVoice: string | null;
  setPlayingVoice: (v: string | null) => void;
  currentAudio: HTMLAudioElement | null;
  setCurrentAudio: (a: HTMLAudioElement | null) => void;
}) {
  const { toast } = useToast();
  const [elSearchQuery, setElSearchQuery] = useState("");
  const [elLanguageFilter, setElLanguageFilter] = useState("hi");
  const [elGenderFilter, setElGenderFilter] = useState("");
  const [elNextSortId, setElNextSortId] = useState<string | null>(null);
  const [elAllVoices, setElAllVoices] = useState<ElevenLabsVoice[]>([]);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(elSearchQuery);
      setElNextSortId(null);
      setElAllVoices([]);
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [elSearchQuery]);

  useEffect(() => {
    setElNextSortId(null);
    setElAllVoices([]);
  }, [elLanguageFilter, elGenderFilter]);

  const elVoicesQuery = useQuery({
    queryKey: ["elevenlabs-voices", debouncedSearch, elLanguageFilter, elGenderFilter, elNextSortId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (elLanguageFilter) params.set("language", elLanguageFilter);
      if (elGenderFilter) params.set("gender", elGenderFilter);
      params.set("pageSize", "20");
      if (elNextSortId) params.set("nextSortId", elNextSortId);
      const response = await fetch(`/api/elevenlabs/voices?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch voices");
      return response.json() as Promise<{ voices: ElevenLabsVoice[]; has_more: boolean; last_sort_id: string | null }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (elVoicesQuery.data?.voices) {
      if (elNextSortId) {
        setElAllVoices(prev => [...prev, ...elVoicesQuery.data!.voices]);
      } else {
        setElAllVoices(elVoicesQuery.data.voices);
      }
    }
  }, [elVoicesQuery.data]);

  const playElevenLabsPreview = async (voiceId: string, previewUrl: string | null) => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setCurrentAudio(null);
      if (playingVoice === `el:${voiceId}`) {
        setPlayingVoice(null);
        return;
      }
    }
    // Shared/community voices are not in the user's own ElevenLabs library, so the
    // /v1/voices/{id} lookup the old server proxy used returned 4xx. The shared-voices
    // search response already includes a public CDN preview_url for each voice — play
    // it directly to avoid a broken proxy hop.
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

  const selectedElVoiceName = voiceSelection.startsWith("el:")
    ? elAllVoices.find(v => v.voice_id === voiceSelection.slice(3))?.name || voiceSelection.slice(3)
    : null;

  return (
    <div className="border-t pt-4 mt-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        ElevenLabs Voices
        <span className="text-[10px] font-medium text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full normal-case tracking-normal">Premium</span>
      </p>

      {selectedElVoiceName && (
        <div className="mb-3 p-3 rounded-lg bg-purple-50 border border-purple-200 flex items-center gap-2">
          <Check className="w-4 h-4 text-purple-600" />
          <span className="text-sm text-purple-800">Selected: <strong>{selectedElVoiceName}</strong></span>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search voices..."
            value={elSearchQuery}
            onChange={(e) => setElSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <select
          value={elLanguageFilter}
          onChange={(e) => setElLanguageFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-gray-200 text-sm bg-white"
        >
          <option value="">All Languages</option>
          <option value="hi">Hindi</option>
          <option value="en">English</option>
          <option value="ta">Tamil</option>
          <option value="te">Telugu</option>
          <option value="kn">Kannada</option>
          <option value="ml">Malayalam</option>
          <option value="bn">Bengali</option>
          <option value="mr">Marathi</option>
          <option value="gu">Gujarati</option>
          <option value="pa">Punjabi</option>
        </select>
        <select
          value={elGenderFilter}
          onChange={(e) => setElGenderFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-gray-200 text-sm bg-white"
        >
          <option value="">All</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>

      {elVoicesQuery.isLoading && elAllVoices.length === 0 && (
        <div className="flex items-center justify-center py-8 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading voices...
        </div>
      )}

      {elVoicesQuery.isError && (
        <div className="py-4 text-center text-sm text-red-500">
          Failed to load voices. Check your ElevenLabs API key.
        </div>
      )}

      <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
        {elAllVoices.map((voice) => {
          const elId = `el:${voice.voice_id}`;
          const gender = voice.labels?.gender || "";
          const accent = voice.labels?.accent || "";
          const useCase = voice.labels?.use_case || voice.labels?.["use case"] || "";
          return (
            <div
              key={voice.voice_id}
              className={`flex items-start space-x-3 rounded-xl border-2 p-3 transition-all cursor-pointer ${
                voiceSelection === elId
                  ? "border-purple-500 bg-purple-50/50 shadow-md"
                  : "border-gray-200 hover:border-purple-300 bg-white"
              }`}
              onClick={() => setVoiceSelection(elId)}
            >
              <RadioGroupItem value={elId} id={elId} className="mt-1 cursor-pointer" onClick={() => setVoiceSelection(elId)} />
              <div className="flex-1 min-w-0">
                <Label htmlFor={elId} className="font-semibold cursor-pointer text-sm flex items-center gap-1.5 flex-wrap">
                  {voice.name}
                  {gender && (
                    <span className="text-[10px] font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full capitalize">{gender}</span>
                  )}
                  {accent && (
                    <span className="text-[10px] font-normal text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full capitalize">{accent}</span>
                  )}
                  {useCase && (
                    <span className="text-[10px] font-normal text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full capitalize">{useCase}</span>
                  )}
                </Label>
                {voice.description && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{voice.description}</p>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); playElevenLabsPreview(voice.voice_id, voice.preview_url); }}
                disabled={!voice.preview_url || (playingVoice !== null && playingVoice !== `el:${voice.voice_id}`)}
                className={`p-1.5 rounded-lg transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ${
                  playingVoice === `el:${voice.voice_id}`
                    ? "bg-purple-500 text-white shadow-lg"
                    : "bg-gray-100 hover:bg-purple-100 text-gray-700 hover:text-purple-700"
                }`}
                title={!voice.preview_url ? "No preview available" : (playingVoice === `el:${voice.voice_id}` ? "Stop preview" : "Play voice sample")}
              >
                {playingVoice === `el:${voice.voice_id}` ? (
                  <Volume2 className="w-4 h-4 animate-pulse" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {elAllVoices.length > 0 && elVoicesQuery.data?.has_more && (
        <button
          onClick={() => setElNextSortId(elVoicesQuery.data!.last_sort_id)}
          disabled={elVoicesQuery.isFetching}
          className="w-full mt-3 py-2 text-sm text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded-lg border border-purple-200 transition-all disabled:opacity-50"
        >
          {elVoicesQuery.isFetching ? (
            <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading...</span>
          ) : (
            "Load more voices"
          )}
        </button>
      )}

      {!elVoicesQuery.isLoading && elAllVoices.length === 0 && !elVoicesQuery.isError && (
        <div className="py-6 text-center text-sm text-gray-500">
          No voices found. Try adjusting your search or filters.
        </div>
      )}
    </div>
  );
}

export default function WidgetSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [chatColor, setChatColor] = useState("#9333ea");
  const [chatColorEnd, setChatColorEnd] = useState("#3b82f6");
  const [widgetHeaderText, setWidgetHeaderText] = useState("Hi Chroney");
  const [welcomeMessageType, setWelcomeMessageType] = useState("custom");
  const [welcomeMessage, setWelcomeMessage] = useState("Hi! How can I help you today?");
  const [buttonStyle, setButtonStyle] = useState("circular");
  const [buttonAnimation, setButtonAnimation] = useState("bounce");
  const [personality, setPersonality] = useState("friendly");
  const [responseLength, setResponseLength] = useState("balanced");
  const [chatFontSize, setChatFontSize] = useState("medium");
  const [footerLabelEnabled, setFooterLabelEnabled] = useState("false");
  const [footerLabelText, setFooterLabelText] = useState("AI may make mistakes");
  const [poweredByEnabled, setPoweredByEnabled] = useState("true");
  const [widgetWidth, setWidgetWidth] = useState("400");
  const [widgetHeight, setWidgetHeight] = useState("600");
  const [widgetPosition, setWidgetPosition] = useState("bottom-right");
  const [bubbleSize, setBubbleSize] = useState("60");
  const [sizePreset, setSizePreset] = useState("medium");
  const [pillBottomOffset, setPillBottomOffset] = useState("20");
  const [pillSideOffset, setPillSideOffset] = useState("20");
  const [autoOpenChat, setAutoOpenChat] = useState("false");
  const [autoOpenFrequency, setAutoOpenFrequency] = useState("once");
  const [openingSoundEnabled, setOpeningSoundEnabled] = useState(true);
  const [openingSoundStyle, setOpeningSoundStyle] = useState("chime");
  const [voiceSelection, setVoiceSelection] = useState("shimmer");
  const [voiceModeStyle, setVoiceModeStyle] = useState("circular");
  const [chatMode, setChatMode] = useState("both");
  const [avatarType, setAvatarType] = useState("none");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [customAvatars, setCustomAvatars] = useState<Array<{url: string, uploadedAt: string}>>([]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deletingAvatar, setDeletingAvatar] = useState<string | null>(null);
  const [avatarToDelete, setAvatarToDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [k12Copied, setK12Copied] = useState(false);
  const [k12SecureCopied, setK12SecureCopied] = useState(false);
  const [k12DevSecureCopied, setK12DevSecureCopied] = useState(false);
  const [devServerUrl, setDevServerUrl] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : ""
  );
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [conversationStarters, setConversationStarters] = useState<string[]>([]);
  const [conversationStartersEnabled, setConversationStartersEnabled] = useState(true);
  const [showStartersOnPill, setShowStartersOnPill] = useState(false);
  const [generatingStarters, setGeneratingStarters] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [newStarterText, setNewStarterText] = useState("");
  
  // Nudge settings
  const [inactivityNudgeEnabled, setInactivityNudgeEnabled] = useState(true);
  const [inactivityNudgeDelay, setInactivityNudgeDelay] = useState("45");
  const [inactivityNudgeMessage, setInactivityNudgeMessage] = useState("Still there? Let me know if you need any help!");
  const [inactivityNudgeMessages, setInactivityNudgeMessages] = useState<{ message: string; delay: number }[]>([]);
  const [smartNudgeEnabled, setSmartNudgeEnabled] = useState(false);
  const [proactiveNudgeEnabled, setProactiveNudgeEnabled] = useState(true);
  const [proactiveNudgeDelay, setProactiveNudgeDelay] = useState("15");
  const [proactiveNudgeMessage, setProactiveNudgeMessage] = useState("Need help finding something? I'm here to assist!");
  const [proactiveNudgeMessages, setProactiveNudgeMessages] = useState<{ message: string; delay: number }[]>([]);
  const [proactiveNudgeRepeat, setProactiveNudgeRepeat] = useState(false);
  const [proactiveNudgeBgColor, setProactiveNudgeBgColor] = useState("#ffffff");
  const [proactiveNudgeBgColorEnd, setProactiveNudgeBgColorEnd] = useState("#ffffff");
  const [proactiveNudgeTextColor, setProactiveNudgeTextColor] = useState("#1f2937");
  
  // Center Banner settings
  const [centerBannerEnabled, setCenterBannerEnabled] = useState(false);
  const [centerBannerDelay, setCenterBannerDelay] = useState("10");
  const [centerBannerTitle, setCenterBannerTitle] = useState("Need Help?");
  const [centerBannerDescription, setCenterBannerDescription] = useState("Let me help you find exactly what you're looking for.");
  const [centerBannerButtonText, setCenterBannerButtonText] = useState("Start Chat");
  const [centerBannerShowOnce, setCenterBannerShowOnce] = useState(true);
  const [centerBannerBackgroundStyle, setCenterBannerBackgroundStyle] = useState("gradient");
  const [centerBannerStartColor, setCenterBannerStartColor] = useState("#9333ea");
  const [centerBannerEndColor, setCenterBannerEndColor] = useState("#3b82f6");
  const [centerBannerTextColor, setCenterBannerTextColor] = useState("white");
  const [centerBannerImageUrl, setCenterBannerImageUrl] = useState<string | null>(null);
  
  // Re-engagement banner settings
  const [reengagementBannerEnabled, setReengagementBannerEnabled] = useState(false);
  const [reengagementBannerDelay, setReengagementBannerDelay] = useState("60");
  const [reengagementBannerTitle, setReengagementBannerTitle] = useState("Still looking around?");
  const [reengagementBannerDescription, setReengagementBannerDescription] = useState("I'm here whenever you're ready to chat!");
  const [reengagementBannerButtonText, setReengagementBannerButtonText] = useState("Chat Now");
  
  // Language selector settings - all 31 languages selected by default
  const [languageSelectorEnabled, setLanguageSelectorEnabled] = useState(true);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['auto', 'en', 'hi', 'hinglish', 'ta', 'te', 'kn', 'mr', 'bn', 'gu', 'ml', 'pa', 'or', 'as', 'ur', 'ne', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'ru', 'th', 'vi', 'id', 'ms', 'tr']);
  
  // Visual search settings
  const [visualSimilarityThreshold, setVisualSimilarityThreshold] = useState("50");
  
  // Product Page AI Widget Mode settings
  const [productPageModeEnabled, setProductPageModeEnabled] = useState(false);
  const [showAiTrivia, setShowAiTrivia] = useState(true);
  const [showSuggestedQuestions, setShowSuggestedQuestions] = useState(true);
  const [showReviewSummary, setShowReviewSummary] = useState(true);
  const [productPageSectionOpen, setProductPageSectionOpen] = useState(true);
  
  // Shopping Features settings
  const [productCarouselEnabled, setProductCarouselEnabled] = useState(false);
  const [productCarouselTitle, setProductCarouselTitle] = useState("Featured Products");
  const [featuredProductIds, setFeaturedProductIds] = useState<string[]>([]);
  const [quickBrowseEnabled, setQuickBrowseEnabled] = useState(false);
  const [quickBrowseButtons, setQuickBrowseButtons] = useState<Array<{label: string; action: string; icon?: string}>>([]);
  const [productComparisonEnabled, setProductComparisonEnabled] = useState(false);
  const [whatsappOrderEnabled, setWhatsappOrderEnabled] = useState(false);
  const [whatsappOrderNumber, setWhatsappOrderNumber] = useState("");
  const [addToCartEnabled, setAddToCartEnabled] = useState(false);
  const [tryOnEnabled, setTryOnEnabled] = useState(false);
  const [whatsappOrderMessage, setWhatsappOrderMessage] = useState("Hi, I'm interested in ordering {product_name} ({product_price})");
  // WhatsApp Widget Launcher settings
  const [launcherMode, setLauncherMode] = useState<"ai" | "whatsapp" | "both">("ai");
  const [whatsappWidgetNumber, setWhatsappWidgetNumber] = useState("");
  const [whatsappWidgetLabel, setWhatsappWidgetLabel] = useState("How can I help you?");
  const [whatsappWidgetMessage, setWhatsappWidgetMessage] = useState("");
  const [whatsappWidgetColor, setWhatsappWidgetColor] = useState("#25D366");
  const [whatsappWidgetPosition, setWhatsappWidgetPosition] = useState("");
  const [newQuickBrowseLabel, setNewQuickBrowseLabel] = useState("");
  const [newQuickBrowseAction, setNewQuickBrowseAction] = useState("");
  
  // Track active tab for Live Preview visibility
  const [activeTab, setActiveTab] = useState("appearance");
  
  // Collapsible section states for Nudges tab
  const [inactivitySectionOpen, setInactivitySectionOpen] = useState(true);
  const [proactiveSectionOpen, setProactiveSectionOpen] = useState(true);
  const [centerBannerSectionOpen, setCenterBannerSectionOpen] = useState(true);
  const [reengagementSectionOpen, setReengagementSectionOpen] = useState(true);
  
  // Expanding message items in timeline
  const [expandedInactivityMsg, setExpandedInactivityMsg] = useState<number | null>(null);
  const [expandedProactiveMsg, setExpandedProactiveMsg] = useState<number | null>(null);

  const proactiveMsg0Ref = useRef<HTMLTextAreaElement>(null);
  const proactiveMsgRefs = useRef<{ [key: number]: HTMLTextAreaElement | null }>({});

  const applyBold = (
    el: HTMLTextAreaElement | null,
    value: string,
    onChange: (val: string) => void
  ) => {
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const replacement = selected ? `**${selected}**` : `**bold text**`;
    const newValue = value.slice(0, start) + replacement + value.slice(end);
    onChange(newValue);
    setTimeout(() => {
      el.focus();
      const cursorStart = start + 2;
      const cursorEnd = selected ? end + 2 : start + 13;
      el.setSelectionRange(cursorStart, cursorEnd);
    }, 0);
  };

  const { data: settings, isLoading } = useQuery<WidgetSettings>({
    queryKey: ["/api/widget-settings"],
  });

  const { data: allProducts } = useQuery<Array<{id: string; name: string; imageUrl?: string; price?: string}>>({
    queryKey: ["/api/products"],
    select: (data: any) => data.filter((p: any) => p.imageUrl),
  });
  
  const [productSearchQuery, setProductSearchQuery] = useState("");

  useEffect(() => {
    if (settings) {
      setChatColor(settings.chatColor);
      setChatColorEnd(settings.chatColorEnd || "#3b82f6");
      setWidgetHeaderText(settings.widgetHeaderText || "Hi Chroney");
      setWelcomeMessageType(settings.welcomeMessageType || "custom");
      setWelcomeMessage(settings.welcomeMessage);
      setButtonStyle(settings.buttonStyle || "circular");
      setButtonAnimation(settings.buttonAnimation || "bounce");
      setPersonality(settings.personality || "friendly");
      setResponseLength(settings.responseLength || "balanced");
      setChatFontSize(settings.chatFontSize || "medium");
      setFooterLabelEnabled(settings.footerLabelEnabled || "false");
      setFooterLabelText(settings.footerLabelText || "AI may make mistakes");
      setPoweredByEnabled(settings.poweredByEnabled || "true");
      setWidgetWidth(settings.widgetWidth || "400");
      setWidgetHeight(settings.widgetHeight || "600");
      setWidgetPosition(settings.widgetPosition || "bottom-right");
      setBubbleSize(settings.bubbleSize || "60");
      setSizePreset(settings.sizePreset || "medium");
      setPillBottomOffset(settings.pillBottomOffset || "20");
      setPillSideOffset(settings.pillSideOffset || "20");
      setAutoOpenChat(settings.autoOpenChat || "false");
      setAutoOpenFrequency(settings.autoOpenFrequency || "once");
      setOpeningSoundEnabled(settings.openingSoundEnabled !== 'false');
      setOpeningSoundStyle(settings.openingSoundStyle || "chime");
      setVoiceSelection(settings.voiceSelection || "shimmer");
      setVoiceModeStyle(settings.voiceModeStyle || "circular");
      setChatMode(settings.chatMode || "both");
      setAvatarType(settings.avatarType || "none");
      setAvatarUrl(settings.avatarUrl || null);
      setCustomAvatars((settings.customAvatars as Array<{url: string, uploadedAt: string}>) || []);
      
      // Load conversation starters
      if (settings.conversationStarters) {
        try {
          const starters = JSON.parse(settings.conversationStarters);
          setConversationStarters(starters);
        } catch (e) {
          setConversationStarters([]);
        }
      }
      setConversationStartersEnabled(settings.conversationStartersEnabled !== 'false');
      setShowStartersOnPill(settings.showStartersOnPill === 'true');
      
      // Load nudge settings
      setInactivityNudgeEnabled(settings.inactivityNudgeEnabled !== 'false');
      setInactivityNudgeDelay(settings.inactivityNudgeDelay || "45");
      setInactivityNudgeMessage(settings.inactivityNudgeMessage || "Still there? Let me know if you need any help!");
      setInactivityNudgeMessages(settings.inactivityNudgeMessages || []);
      setSmartNudgeEnabled(settings.smartNudgeEnabled === 'true');
      setProactiveNudgeEnabled(settings.proactiveNudgeEnabled !== 'false');
      setProactiveNudgeDelay(settings.proactiveNudgeDelay || "15");
      setProactiveNudgeMessage(settings.proactiveNudgeMessage || "Need help finding something? I'm here to assist!");
      setProactiveNudgeMessages(settings.proactiveNudgeMessages || []);
      setProactiveNudgeRepeat(settings.proactiveNudgeRepeat === 'true');
      setProactiveNudgeBgColor(settings.proactiveNudgeBgColor || "#ffffff");
      setProactiveNudgeBgColorEnd(settings.proactiveNudgeBgColorEnd || "#ffffff");
      setProactiveNudgeTextColor(settings.proactiveNudgeTextColor || "#1f2937");
      
      // Load center banner settings
      setCenterBannerEnabled(settings.centerBannerEnabled === 'true');
      setCenterBannerDelay(settings.centerBannerDelay || "10");
      setCenterBannerTitle(settings.centerBannerTitle || "Need Help?");
      setCenterBannerDescription(settings.centerBannerDescription || "Let me help you find exactly what you're looking for.");
      setCenterBannerButtonText(settings.centerBannerButtonText || "Start Chat");
      setCenterBannerShowOnce(settings.centerBannerShowOnce !== 'false');
      setCenterBannerBackgroundStyle(settings.centerBannerBackgroundStyle || "gradient");
      setCenterBannerStartColor(settings.centerBannerStartColor || "#9333ea");
      setCenterBannerEndColor(settings.centerBannerEndColor || "#3b82f6");
      setCenterBannerTextColor(settings.centerBannerTextColor || "white");
      setCenterBannerImageUrl(settings.centerBannerImageUrl || null);
      
      // Load re-engagement banner settings
      setReengagementBannerEnabled(settings.reengagementBannerEnabled === 'true');
      setReengagementBannerDelay(settings.reengagementBannerDelay || "60");
      setReengagementBannerTitle(settings.reengagementBannerTitle || "Still looking around?");
      setReengagementBannerDescription(settings.reengagementBannerDescription || "I'm here whenever you're ready to chat!");
      setReengagementBannerButtonText(settings.reengagementBannerButtonText || "Chat Now");
      
      // Load language selector settings
      setLanguageSelectorEnabled(settings.languageSelectorEnabled !== 'false');
      
      // Load visual search settings
      setVisualSimilarityThreshold(settings.visualSimilarityThreshold || "50");
      if (settings.availableLanguages) {
        try {
          const langs = JSON.parse(settings.availableLanguages);
          if (Array.isArray(langs) && langs.length > 0) {
            setSelectedLanguages(langs);
          }
        } catch (e) {
          setSelectedLanguages(['auto', 'en', 'hi', 'hinglish', 'ta', 'te', 'kn', 'mr', 'bn', 'gu', 'ml', 'pa', 'or', 'as', 'ur', 'ne', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'ru', 'th', 'vi', 'id', 'ms', 'tr']);
        }
      }
      
      // Load product page mode settings
      setProductPageModeEnabled(settings.productPageModeEnabled === 'true');
      setShowAiTrivia(settings.showAiTrivia !== 'false');
      setShowSuggestedQuestions(settings.showSuggestedQuestions !== 'false');
      setShowReviewSummary(settings.showReviewSummary !== 'false');
      
      // Load shopping features settings
      setProductCarouselEnabled(settings.productCarouselEnabled === 'true');
      setProductCarouselTitle(settings.productCarouselTitle || "Featured Products");
      if (settings.featuredProductIds) {
        // Handle both JSONB (array) and legacy string formats
        let ids = settings.featuredProductIds;
        if (typeof ids === 'string') {
          try {
            ids = JSON.parse(ids);
            // Handle double-encoded strings
            if (typeof ids === 'string') {
              ids = JSON.parse(ids);
            }
          } catch (e) {
            ids = [];
          }
        }
        if (Array.isArray(ids)) {
          setFeaturedProductIds(ids);
        } else {
          setFeaturedProductIds([]);
        }
      }
      setQuickBrowseEnabled(settings.quickBrowseEnabled === 'true');
      if (settings.quickBrowseButtons) {
        // Handle both JSONB (array) and legacy string formats
        let buttons = settings.quickBrowseButtons;
        if (typeof buttons === 'string') {
          try {
            buttons = JSON.parse(buttons);
            // Handle double-encoded strings
            if (typeof buttons === 'string') {
              buttons = JSON.parse(buttons);
            }
          } catch (e) {
            buttons = [];
          }
        }
        if (Array.isArray(buttons)) {
          setQuickBrowseButtons(buttons);
        } else {
          setQuickBrowseButtons([]);
        }
      }
      setProductComparisonEnabled(settings.productComparisonEnabled === 'true');
      setWhatsappOrderEnabled(settings.whatsappOrderEnabled === 'true');
      setWhatsappOrderNumber(settings.whatsappOrderNumber || "");
      setWhatsappOrderMessage(settings.whatsappOrderMessage || "Hi, I'm interested in ordering {product_name} ({product_price})");
      setLauncherMode((settings.launcherMode as "ai" | "whatsapp" | "both") || "ai");
      setWhatsappWidgetNumber(settings.whatsappWidgetNumber || "");
      setWhatsappWidgetLabel(settings.whatsappWidgetLabel || "How can I help you?");
      setWhatsappWidgetMessage(settings.whatsappWidgetMessage || "");
      setWhatsappWidgetColor(settings.whatsappWidgetColor || "#25D366");
      setWhatsappWidgetPosition(settings.whatsappWidgetPosition || "");
      setAddToCartEnabled(settings.addToCartEnabled !== 'false');
      setTryOnEnabled(settings.tryOnEnabled === 'true');
    }
  }, [settings]);

  // Force chat-only mode when voice mode is disabled
  useEffect(() => {
    if (settings && settings.voiceModeEnabled === false && chatMode !== "chat-only") {
      setChatMode("chat-only");
    }
  }, [settings, chatMode]);

  // Auto-save effect with debouncing
  useEffect(() => {
    if (!settings) return;
    
    const hasChanges = 
      chatColor !== settings.chatColor ||
      chatColorEnd !== settings.chatColorEnd ||
      widgetHeaderText !== settings.widgetHeaderText ||
      welcomeMessageType !== settings.welcomeMessageType ||
      welcomeMessage !== settings.welcomeMessage ||
      buttonStyle !== settings.buttonStyle ||
      buttonAnimation !== settings.buttonAnimation ||
      personality !== settings.personality ||
      responseLength !== (settings.responseLength || "balanced") ||
      chatFontSize !== (settings.chatFontSize || "medium") ||
      widgetWidth !== settings.widgetWidth ||
      widgetHeight !== settings.widgetHeight ||
      widgetPosition !== settings.widgetPosition ||
      bubbleSize !== settings.bubbleSize ||
      sizePreset !== settings.sizePreset ||
      pillBottomOffset !== (settings.pillBottomOffset || "20") ||
      pillSideOffset !== (settings.pillSideOffset || "20") ||
      autoOpenChat !== settings.autoOpenChat ||
      autoOpenFrequency !== (settings.autoOpenFrequency || "once") ||
      (openingSoundEnabled ? "true" : "false") !== (settings.openingSoundEnabled || "true") ||
      openingSoundStyle !== (settings.openingSoundStyle || "chime") ||
      voiceSelection !== settings.voiceSelection ||
      voiceModeStyle !== settings.voiceModeStyle ||
      chatMode !== settings.chatMode ||
      footerLabelEnabled !== (settings.footerLabelEnabled || "false") ||
      footerLabelText !== (settings.footerLabelText || "AI may make mistakes") ||
      poweredByEnabled !== (settings.poweredByEnabled || "true");

    if (!hasChanges) {
      setSaveStatus("idle");
      return;
    }
    
    const timeoutId = setTimeout(() => {
      setSaveStatus("saving");
      updateMutation.mutate({ 
        chatColor, 
        chatColorEnd, 
        widgetHeaderText, 
        welcomeMessageType, 
        welcomeMessage, 
        buttonStyle, 
        buttonAnimation, 
        personality,
        responseLength,
        chatFontSize,
        footerLabelEnabled,
        footerLabelText,
        poweredByEnabled,
        widgetWidth,
        widgetHeight,
        widgetPosition,
        bubbleSize,
        sizePreset,
        pillBottomOffset,
        pillSideOffset,
        autoOpenChat,
        autoOpenFrequency,
        openingSoundEnabled: openingSoundEnabled ? "true" : "false",
        openingSoundStyle,
        voiceSelection,
        voiceModeStyle,
        chatMode
      });
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [settings, chatColor, chatColorEnd, widgetHeaderText, welcomeMessageType, welcomeMessage, buttonStyle, buttonAnimation, personality, responseLength, chatFontSize, footerLabelEnabled, footerLabelText, poweredByEnabled, widgetWidth, widgetHeight, widgetPosition, bubbleSize, sizePreset, pillBottomOffset, pillSideOffset, autoOpenChat, autoOpenFrequency, openingSoundEnabled, openingSoundStyle, voiceSelection, voiceModeStyle, chatMode]);

  // Auto-save effect for nudge settings
  useEffect(() => {
    if (!settings) return;
    
    const hasNudgeChanges = 
      (inactivityNudgeEnabled ? "true" : "false") !== (settings.inactivityNudgeEnabled || "true") ||
      inactivityNudgeDelay !== (settings.inactivityNudgeDelay || "45") ||
      inactivityNudgeMessage !== (settings.inactivityNudgeMessage || "Still there? Let me know if you need any help!") ||
      JSON.stringify(inactivityNudgeMessages) !== JSON.stringify(settings.inactivityNudgeMessages || []) ||
      (smartNudgeEnabled ? "true" : "false") !== (settings.smartNudgeEnabled || "false") ||
      (proactiveNudgeEnabled ? "true" : "false") !== (settings.proactiveNudgeEnabled || "true") ||
      proactiveNudgeDelay !== (settings.proactiveNudgeDelay || "15") ||
      proactiveNudgeMessage !== (settings.proactiveNudgeMessage || "Need help finding something? I'm here to assist!") ||
      JSON.stringify(proactiveNudgeMessages) !== JSON.stringify(settings.proactiveNudgeMessages || []) ||
      (proactiveNudgeRepeat ? "true" : "false") !== (settings.proactiveNudgeRepeat || "false") ||
      proactiveNudgeBgColor !== (settings.proactiveNudgeBgColor || "#ffffff") ||
      proactiveNudgeBgColorEnd !== (settings.proactiveNudgeBgColorEnd || "#ffffff") ||
      proactiveNudgeTextColor !== (settings.proactiveNudgeTextColor || "#1f2937") ||
      (centerBannerEnabled ? "true" : "false") !== (settings.centerBannerEnabled || "false") ||
      centerBannerDelay !== (settings.centerBannerDelay || "10") ||
      centerBannerTitle !== (settings.centerBannerTitle || "Need Help?") ||
      centerBannerDescription !== (settings.centerBannerDescription || "Let me help you find exactly what you're looking for.") ||
      centerBannerButtonText !== (settings.centerBannerButtonText || "Start Chat") ||
      (centerBannerShowOnce ? "true" : "false") !== (settings.centerBannerShowOnce || "true") ||
      centerBannerBackgroundStyle !== (settings.centerBannerBackgroundStyle || "gradient") ||
      centerBannerStartColor !== (settings.centerBannerStartColor || "#9333ea") ||
      centerBannerEndColor !== (settings.centerBannerEndColor || "#3b82f6") ||
      centerBannerTextColor !== (settings.centerBannerTextColor || "white") ||
      centerBannerImageUrl !== (settings.centerBannerImageUrl || null) ||
      (reengagementBannerEnabled ? "true" : "false") !== (settings.reengagementBannerEnabled || "false") ||
      reengagementBannerDelay !== (settings.reengagementBannerDelay || "60") ||
      reengagementBannerTitle !== (settings.reengagementBannerTitle || "Still looking around?") ||
      reengagementBannerDescription !== (settings.reengagementBannerDescription || "I'm here whenever you're ready to chat!") ||
      reengagementBannerButtonText !== (settings.reengagementBannerButtonText || "Chat Now");

    if (!hasNudgeChanges) return;
    
    const timeoutId = setTimeout(() => {
      setSaveStatus("saving");
      updateMutation.mutate({ 
        inactivityNudgeEnabled: inactivityNudgeEnabled ? "true" : "false",
        inactivityNudgeDelay,
        inactivityNudgeMessage,
        inactivityNudgeMessages,
        smartNudgeEnabled: smartNudgeEnabled ? "true" : "false",
        proactiveNudgeEnabled: proactiveNudgeEnabled ? "true" : "false",
        proactiveNudgeDelay,
        proactiveNudgeMessage,
        proactiveNudgeMessages,
        proactiveNudgeRepeat: proactiveNudgeRepeat ? "true" : "false",
        proactiveNudgeBgColor,
        proactiveNudgeBgColorEnd,
        proactiveNudgeTextColor,
        centerBannerEnabled: centerBannerEnabled ? "true" : "false",
        centerBannerDelay,
        centerBannerTitle,
        centerBannerDescription,
        centerBannerButtonText,
        centerBannerShowOnce: centerBannerShowOnce ? "true" : "false",
        centerBannerBackgroundStyle,
        centerBannerStartColor,
        centerBannerEndColor,
        centerBannerTextColor,
        centerBannerImageUrl: centerBannerImageUrl || undefined,
        reengagementBannerEnabled: reengagementBannerEnabled ? "true" : "false",
        reengagementBannerDelay,
        reengagementBannerTitle,
        reengagementBannerDescription,
        reengagementBannerButtonText
      });
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [settings, inactivityNudgeEnabled, inactivityNudgeDelay, inactivityNudgeMessage, inactivityNudgeMessages, smartNudgeEnabled, proactiveNudgeEnabled, proactiveNudgeDelay, proactiveNudgeMessage, proactiveNudgeMessages, proactiveNudgeRepeat, proactiveNudgeBgColor, proactiveNudgeBgColorEnd, proactiveNudgeTextColor, centerBannerEnabled, centerBannerDelay, centerBannerTitle, centerBannerDescription, centerBannerButtonText, centerBannerShowOnce, centerBannerBackgroundStyle, centerBannerStartColor, centerBannerEndColor, centerBannerTextColor, centerBannerImageUrl, reengagementBannerEnabled, reengagementBannerDelay, reengagementBannerTitle, reengagementBannerDescription, reengagementBannerButtonText]);

  const playVoicePreview = async (voiceId: string) => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setCurrentAudio(null);
      if (playingVoice === voiceId) {
        setPlayingVoice(null);
        return;
      }
    }

    try {
      setPlayingVoice(voiceId);
      const response = await fetch(`/api/voice-preview?voice=${voiceId}`, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load voice preview");
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        setPlayingVoice(null);
        setCurrentAudio(null);
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.onerror = () => {
        setPlayingVoice(null);
        setCurrentAudio(null);
        URL.revokeObjectURL(audioUrl);
        toast({
          title: "Error",
          description: "Failed to play voice preview",
          variant: "destructive",
        });
      };

      setCurrentAudio(audio);
      await audio.play();
    } catch (error) {
      setPlayingVoice(null);
      toast({
        title: "Error",
        description: "Failed to load voice preview",
        variant: "destructive",
      });
    }
  };

  const updateMutation = useMutation({
    mutationFn: async (data: { 
      chatColor?: string; 
      chatColorEnd?: string; 
      widgetHeaderText?: string; 
      welcomeMessageType?: string; 
      welcomeMessage?: string; 
      buttonStyle?: string; 
      buttonAnimation?: string; 
      personality?: string;
      responseLength?: string;
      chatFontSize?: string;
      widgetWidth?: string;
      widgetHeight?: string;
      widgetPosition?: string;
      bubbleSize?: string;
      sizePreset?: string;
      autoOpenChat?: string;
      autoOpenFrequency?: string;
      openingSoundEnabled?: string;
      openingSoundStyle?: string;
      voiceSelection?: string;
      voiceModeStyle?: string;
      chatMode?: string;
      inactivityNudgeEnabled?: string;
      inactivityNudgeDelay?: string;
      inactivityNudgeMessage?: string;
      inactivityNudgeMessages?: { message: string; delay: number }[];
      smartNudgeEnabled?: string;
      proactiveNudgeEnabled?: string;
      proactiveNudgeDelay?: string;
      proactiveNudgeMessage?: string;
      proactiveNudgeMessages?: { message: string; delay: number }[];
      proactiveNudgeRepeat?: string;
      proactiveNudgeBgColor?: string;
      proactiveNudgeBgColorEnd?: string;
      proactiveNudgeTextColor?: string;
      centerBannerEnabled?: string;
      centerBannerDelay?: string;
      centerBannerTitle?: string;
      centerBannerDescription?: string;
      centerBannerButtonText?: string;
      centerBannerShowOnce?: string;
      centerBannerBackgroundStyle?: string;
      centerBannerStartColor?: string;
      centerBannerEndColor?: string;
      centerBannerTextColor?: string;
      centerBannerImageUrl?: string | null;
      reengagementBannerEnabled?: string;
      reengagementBannerDelay?: string;
      reengagementBannerTitle?: string;
      reengagementBannerDescription?: string;
      reengagementBannerButtonText?: string;
      languageSelectorEnabled?: string;
      availableLanguages?: string;
      visualSimilarityThreshold?: string;
      productPageModeEnabled?: string;
      showAiTrivia?: string;
      showSuggestedQuestions?: string;
      showReviewSummary?: string;
      // Shopping Features
      productCarouselEnabled?: string;
      productCarouselTitle?: string;
      featuredProductIds?: string[] | string;
      quickBrowseEnabled?: string;
      quickBrowseButtons?: Array<{label: string; action: string}> | string;
      productComparisonEnabled?: string;
      whatsappOrderEnabled?: string;
      whatsappOrderNumber?: string;
      whatsappOrderMessage?: string;
      launcherMode?: string;
      whatsappWidgetNumber?: string;
      whatsappWidgetLabel?: string;
      whatsappWidgetMessage?: string;
      whatsappWidgetColor?: string;
      whatsappWidgetPosition?: string;
      addToCartEnabled?: string;
      tryOnEnabled?: string;
    }) => {
      const response = await fetch("/api/widget-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update settings");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["/api/widget-settings"]
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: (error: Error) => {
      setSaveStatus("idle");
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const widgetDomain = 'https://portal.aichroney.com';
  const businessId = settings?.businessAccountId || 'YOUR_BUSINESS_ID';
  const businessName = settings?.businessName || '';
  const businessWebsite = settings?.businessWebsite || '';
  
  const embedCode = `<!-- AI Chroney Widget -->
<!-- Business: ${businessName}${businessWebsite ? ` | Website: ${businessWebsite}` : ''} -->
<script src="${widgetDomain}/widget-loader.js" data-business-id="${businessId}"></script>`;

  // Grade-scoped widget (TopScholar / K12): same universal snippet plus scope
  // attributes. The host portal replaces the placeholders with the logged-in student's
  // values so the tutor only answers from that student's grade and subject. All four
  // scope attributes (board, medium, grade, subject) are REQUIRED — data-subject is
  // mandatory and the tutor refuses to answer when it is missing. data-chapter is
  // OPTIONAL — when supplied it narrows answers to a single chapter on top of the
  // subject; omit it for whole-subject scope.
  const k12EmbedCode = `<!-- AI Chroney Widget (subject-scoped for student portals) -->
<!-- Replace the placeholders with the logged-in student's values from your portal -->
<!-- All scope attributes are required — data-subject is mandatory -->
<!-- data-chapter is optional — it narrows answers to one chapter; omit for whole-subject -->
<!-- data-student-id + data-name attribute conversations to the student (history, -->
<!-- per-student reports). They are optional but recommended for a real portal. -->
<!-- INLINE MODE (optional): add data-mode="inline" + data-container="ai-tutor" to -->
<!-- render the tutor filling a <div id="ai-tutor"></div> on your page instead of a -->
<!-- floating bubble. Give that div a fixed height (e.g. style="height:600px"). -->
<script src="${widgetDomain}/widget-loader.js" data-business-id="${businessId}"
        data-board="{{ student.board }}"
        data-medium="{{ student.medium }}"
        data-grade="{{ student.grade }}"
        data-subject="{{ student.subject }}"
        data-chapter="{{ student.chapter }}"
        data-student-id="{{ student.id }}"
        data-name="{{ student.name }}"
        data-mode="inline"
        data-container="ai-tutor"></script>`;

  // Secure embed: all student scope (board/medium/grade/subject + optional chapter)
  // + studentId + name travel sealed inside one server-signed token (data-token). The
  // plain data-* attributes are NOT used — and are ignored server-side once "Require
  // signed token" is enabled. Your portal builds the token on its server with the
  // shared secret; include `chapter` in the signed payload to narrow answers to a
  // single chapter (omit it for whole-subject scope).
  const k12SecureEmbedCode = `<!-- AI Chroney Widget (secure mode — server-signed launch token) -->
<!-- Build the token on YOUR server (see the integration guide in TopScholar admin) -->
<!-- The token seals board, medium, grade, subject, chapter (optional), studentId and name -->
<!-- INLINE MODE (optional): add data-mode="inline" + data-container="ai-tutor" to -->
<!-- render the tutor filling a <div id="ai-tutor"></div> on your page instead of a -->
<!-- floating bubble. Give that div a fixed height (e.g. style="height:600px"). -->
<script src="${widgetDomain}/widget-loader.js" data-business-id="${businessId}"
        data-token="{{ signedLaunchToken }}"
        data-mode="inline"
        data-container="ai-tutor"></script>`;

  // Dev / staging embed: identical to the secure embed but loads widget-loader.js from
  // the configurable dev server URL instead of production. Embed this on your dev portal
  // so every chat request hits the dev server — logs, doubt sync, and token issues can
  // all be diagnosed in real time before switching to the production snippet.
  const k12DevSecureEmbedCode = `<!-- AI Chroney Widget — DEVELOPMENT / STAGING ONLY -->
<!-- Use on your dev portal — swap for the Secure Embed Code above in production -->
<!-- Build the signed token on your server exactly as you would for production -->
<script src="${devServerUrl}/widget-loader.js" data-business-id="${businessId}"
        data-token="{{ signedLaunchToken }}"
        data-mode="inline"
        data-container="ai-tutor"></script>`;

  const avatarSelectionMutation = useMutation({
    mutationFn: async (data: { avatarType: string; avatarUrl?: string }) => {
      const response = await fetch("/api/widget-settings/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update avatar");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["/api/widget-settings"]
      });
      toast({
        title: "Avatar updated",
        description: "Your chat avatar has been updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Generate conversation starters
  const handleGenerateStarters = async () => {
    setGeneratingStarters(true);
    try {
      const response = await fetch("/api/widget-settings/generate-starters", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate conversation starters");
      }

      const data = await response.json();
      setConversationStarters(data.starters || []);
      
      // Invalidate widget settings to refresh with new starters
      queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });
      
      toast({
        title: "Conversation starters generated!",
        description: `Generated ${data.starters?.length || 0} AI-powered conversation starters`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setGeneratingStarters(false);
    }
  };

  // Save conversation starters toggle
  const saveStartersEnabled = async (enabled: boolean) => {
    try {
      const response = await fetch("/api/widget-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          conversationStartersEnabled: enabled ? "true" : "false" 
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update conversation starters setting");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });
      
      toast({
        title: enabled ? "Conversation starters enabled" : "Conversation starters disabled",
        description: enabled 
          ? "Users will see suggested questions when chat is empty"
          : "Conversation starter suggestions are now hidden",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update setting",
        variant: "destructive",
      });
    }
  };

  const saveShowStartersOnPill = async (enabled: boolean) => {
    try {
      const response = await fetch("/api/widget-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          showStartersOnPill: enabled ? "true" : "false" 
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update setting");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });
      
      toast({
        title: enabled ? "Starters on pill enabled" : "Starters on pill disabled",
        description: enabled 
          ? "Conversation starters will appear above the chat button"
          : "Starters will only show inside the chat window",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // Save custom/edited starters to database
  const saveStartersToDatabase = async (updatedStarters: string[]) => {
    try {
      const response = await fetch("/api/widget-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          conversationStarters: JSON.stringify(updatedStarters)
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save conversation starters");
      }

      // Invalidate all queries that might contain widget settings
      queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });
      // Also refetch for public endpoints that include widget settings
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0] as string;
          return key?.includes('/api/widget-settings/public') || 
                 key?.includes('/api/public-chat/');
        }
      });
      
      setConversationStarters(updatedStarters);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }
  };

  // Edit starter - enter edit mode
  const handleEditStarter = (index: number, text: string) => {
    setEditingIndex(index);
    setEditingText(text);
  };

  // Save edited starter
  const handleSaveEdit = async (index: number) => {
    if (!editingText.trim()) {
      toast({
        title: "Error",
        description: "Conversation starter cannot be empty",
        variant: "destructive",
      });
      return;
    }

    const updatedStarters = [...conversationStarters];
    updatedStarters[index] = editingText.trim();

    try {
      await saveStartersToDatabase(updatedStarters);
      setEditingIndex(null);
      setEditingText("");
      toast({
        title: "Starter updated",
        description: "Your conversation starter has been updated successfully",
      });
    } catch (error) {
      // Error toast already shown in saveStartersToDatabase
    }
  };

  // Delete starter
  const handleDeleteStarter = async (index: number) => {
    const updatedStarters = conversationStarters.filter((_, i) => i !== index);

    // Clear edit state to prevent unexpected behavior
    setEditingIndex(null);
    setEditingText("");

    try {
      await saveStartersToDatabase(updatedStarters);
      toast({
        title: "Starter deleted",
        description: "Conversation starter has been removed",
      });
    } catch (error) {
      // Error toast already shown in saveStartersToDatabase
    }
  };

  // Add custom starter
  const handleAddCustomStarter = async () => {
    if (!newStarterText.trim()) return;

    if (conversationStarters.length >= 3) {
      toast({
        title: "Maximum reached",
        description: "You can have up to 3 conversation starters",
        variant: "destructive",
      });
      return;
    }

    const updatedStarters = [...conversationStarters, newStarterText.trim()];

    try {
      await saveStartersToDatabase(updatedStarters);
      setNewStarterText("");
      toast({
        title: "Starter added",
        description: "Your custom conversation starter has been added",
      });
    } catch (error) {
      // Error toast already shown in saveStartersToDatabase
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Avatar image must be less than 5MB",
        variant: "destructive",
      });
      return;
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a JPG, PNG, or WebP image",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploadingAvatar(true);

      // Upload avatar file
      const formData = new FormData();
      formData.append('avatar', file);

      const uploadResponse = await fetch("/api/widget-settings/avatar/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error || "Failed to upload avatar");
      }

      const { avatarUrl: newAvatarUrl, customAvatars: updatedAvatars } = await uploadResponse.json();

      // Update local state
      setAvatarType("custom");
      setAvatarUrl(newAvatarUrl);
      if (updatedAvatars) {
        setCustomAvatars(updatedAvatars);
      }
      
      // Invalidate query to sync with server (backend already saved)
      queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });

      toast({
        title: "Avatar uploaded",
        description: "Your custom avatar has been uploaded successfully",
      });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload avatar",
        variant: "destructive",
      });
    } finally {
      setUploadingAvatar(false);
      // Reset file input
      e.target.value = '';
    }
  };

  const handleDeleteAvatar = async (avatarUrlToDelete: string) => {
    try {
      setDeletingAvatar(avatarUrlToDelete);

      const response = await fetch("/api/widget-settings/avatar", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ avatarUrl: avatarUrlToDelete }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete avatar");
      }

      const { customAvatars: updatedAvatars } = await response.json();
      setCustomAvatars(updatedAvatars || []);

      // If deleted avatar was the selected one, update selection
      if (avatarUrl === avatarUrlToDelete) {
        if (updatedAvatars && updatedAvatars.length > 0) {
          setAvatarUrl(updatedAvatars[0].url);
          setAvatarType("custom");
        } else {
          setAvatarUrl(null);
          setAvatarType("none");
        }
      }
      
      // Invalidate query to sync with server (backend already saved)
      queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });

      toast({
        title: "Avatar deleted",
        description: "Custom avatar has been removed",
      });
    } catch (error: any) {
      toast({
        title: "Delete failed",
        description: error.message || "Failed to delete avatar",
        variant: "destructive",
      });
    } finally {
      setDeletingAvatar(null);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Embed code copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleCopyK12 = async () => {
    try {
      await navigator.clipboard.writeText(k12EmbedCode);
      setK12Copied(true);
      toast({
        title: "Copied!",
        description: "Grade-scoped embed code copied to clipboard",
      });
      setTimeout(() => setK12Copied(false), 2000);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleCopyK12Secure = async () => {
    try {
      await navigator.clipboard.writeText(k12SecureEmbedCode);
      setK12SecureCopied(true);
      toast({
        title: "Copied!",
        description: "Secure embed code copied to clipboard",
      });
      setTimeout(() => setK12SecureCopied(false), 2000);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleCopyK12DevSecure = async () => {
    try {
      await navigator.clipboard.writeText(k12DevSecureEmbedCode);
      setK12DevSecureCopied(true);
      toast({
        title: "Copied!",
        description: "Dev embed code copied to clipboard",
      });
      setTimeout(() => setK12DevSecureCopied(false), 2000);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-3" />
          <p className="text-sm text-gray-600">Loading widget settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30">
      <div className="container mx-auto p-4 md:p-6 max-w-[1600px]">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-3">
                <Wand2 className="w-8 h-8 text-purple-600" />
                Widget Studio
              </h1>
              <p className="text-muted-foreground mt-2 text-sm">
                Design and customize your AI chatbot widget in real-time
              </p>
            </div>
            
            {/* Auto-save indicator */}
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm border">
              {saveStatus === "saving" && (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  <span className="text-sm text-gray-600">Saving...</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <Check className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-gray-600">Saved</span>
                </>
              )}
              {saveStatus === "idle" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm text-gray-600">All changes saved</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tabs Component - TabsList always full width */}
        <Tabs defaultValue="appearance" className="w-full" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-6 bg-gradient-to-r from-purple-50 to-white backdrop-blur-sm shadow-md h-auto p-1 rounded-xl mb-6">
            <TabsTrigger value="appearance" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <Palette className="w-4 h-4" />
              <span className="hidden sm:inline">Style</span>
            </TabsTrigger>
            <TabsTrigger value="behavior" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <Settings2 className="w-4 h-4" />
              <span className="hidden sm:inline">Behavior</span>
            </TabsTrigger>
            <TabsTrigger value="nudges" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <Bell className="w-4 h-4" />
              <span className="hidden sm:inline">Nudges</span>
            </TabsTrigger>
            <TabsTrigger value="voice" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <Volume2 className="w-4 h-4" />
              <span className="hidden sm:inline">Voice</span>
            </TabsTrigger>
            <TabsTrigger value="avatar" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">Avatar</span>
            </TabsTrigger>
            <TabsTrigger value="shopping" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <ShoppingCart className="w-4 h-4" />
              <span className="hidden sm:inline">Shopping</span>
            </TabsTrigger>
            <TabsTrigger value="embed" className="flex items-center gap-2 rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <Code2 className="w-4 h-4" />
              <span className="hidden sm:inline">Embed</span>
            </TabsTrigger>
          </TabsList>

          {/* Split Layout - 2 columns when Live Preview is shown, full width otherwise */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Panel - Settings (spans full width when no Live Preview) */}
            <div className={`space-y-6 ${(activeTab !== "appearance" && activeTab !== "avatar") ? "lg:col-span-2" : ""}`}>
              {/* Style Tab */}
              <TabsContent value="appearance" className="space-y-4 mt-4">
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg">Colors & Branding</CardTitle>
                    <CardDescription>Customize colors to match your brand</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5 pt-6">
                    {/* Header Text */}
                    <div className="space-y-2">
                      <Label htmlFor="widgetHeaderText" className="text-sm font-semibold text-gray-700">
                        Widget Header
                      </Label>
                      <Input
                        id="widgetHeaderText"
                        type="text"
                        value={widgetHeaderText}
                        onChange={(e) => setWidgetHeaderText(e.target.value)}
                        placeholder="Hi Chroney"
                        maxLength={30}
                        className="text-base"
                      />
                      <p className="text-xs text-gray-500">
                        {widgetHeaderText.length}/30 characters
                      </p>
                    </div>

                    {/* Footer Label */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-semibold text-gray-700">Footer Label</Label>
                          <p className="text-xs text-gray-500 mt-0.5">Show a small disclaimer below the chat input</p>
                        </div>
                        <Switch
                          checked={footerLabelEnabled === "true"}
                          onCheckedChange={(checked) => setFooterLabelEnabled(checked ? "true" : "false")}
                        />
                      </div>
                      {footerLabelEnabled === "true" && (
                        <Input
                          value={footerLabelText}
                          onChange={(e) => setFooterLabelText(e.target.value)}
                          placeholder="AI may make mistakes"
                          maxLength={100}
                          className="text-sm"
                        />
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-semibold text-gray-700">Powered by AI Chroney</Label>
                          <p className="text-xs text-gray-500 mt-0.5">Show branding badge at the bottom of the widget</p>
                        </div>
                        <Switch
                          checked={poweredByEnabled === "true"}
                          onCheckedChange={(checked) => setPoweredByEnabled(checked ? "true" : "false")}
                        />
                      </div>
                    </div>

                    {/* Chat Font Size */}
                    <div className="space-y-2">
                      <div>
                        <Label className="text-sm font-semibold text-gray-700">Chat Font Size</Label>
                        <p className="text-xs text-gray-500 mt-0.5">Text size of the chat messages in the widget</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: "small", label: "Small" },
                          { id: "medium", label: "Medium" },
                          { id: "large", label: "Large" },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setChatFontSize(opt.id)}
                            className={`rounded-lg border-2 py-2 transition-all ${
                              chatFontSize === opt.id
                                ? "border-purple-500 bg-purple-50/50 text-purple-700 shadow-sm"
                                : "border-gray-200 hover:border-purple-300 text-gray-600 bg-white"
                            }`}
                            data-testid={`button-font-size-${opt.id}`}
                          >
                            <span style={{ fontSize: CHAT_FONT_SIZE_PX[opt.id] }} className="font-medium leading-none">Aa</span>
                            <span className="block text-xs mt-0.5">{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Gradient Colors */}
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-gray-700">Brand Gradient</Label>
                      
                      <div className="grid grid-cols-2 gap-3">
                        {/* Start Color */}
                        <div className="space-y-2">
                          <Label htmlFor="chatColor" className="text-xs text-gray-600">
                            Start Color
                          </Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              id="chatColor"
                              value={chatColor}
                              onChange={(e) => setChatColor(e.target.value)}
                              className="h-11 w-16 rounded-lg border-2 border-gray-200 cursor-pointer"
                            />
                            <Input
                              type="text"
                              value={chatColor}
                              onChange={(e) => setChatColor(e.target.value)}
                              placeholder="#9333ea"
                              className="flex-1 text-sm font-mono"
                            />
                          </div>
                        </div>

                        {/* End Color */}
                        <div className="space-y-2">
                          <Label htmlFor="chatColorEnd" className="text-xs text-gray-600">
                            End Color
                          </Label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              id="chatColorEnd"
                              value={chatColorEnd}
                              onChange={(e) => setChatColorEnd(e.target.value)}
                              className="h-11 w-16 rounded-lg border-2 border-gray-200 cursor-pointer"
                            />
                            <Input
                              type="text"
                              value={chatColorEnd}
                              onChange={(e) => setChatColorEnd(e.target.value)}
                              placeholder="#3b82f6"
                              className="flex-1 text-sm font-mono"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Gradient Preview */}
                      <div 
                        className="h-16 rounded-xl shadow-lg relative overflow-hidden group"
                        style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                      >
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-white font-medium text-sm bg-black/30 px-3 py-1 rounded-full backdrop-blur-sm">
                            Your Brand Gradient
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg">Button Style</CardTitle>
                    <CardDescription>Choose your chat button appearance</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { id: "circular", label: "Circle", icon: "rounded-full" },
                        { id: "rounded", label: "Rounded", icon: "rounded-2xl" },
                        { id: "pill", label: "Pill", icon: "rounded-full px-4" },
                        { id: "minimal", label: "Square", icon: "rounded-xl" },
                      ].map((style) => (
                        <button
                          key={style.id}
                          onClick={() => setButtonStyle(style.id)}
                          className={`p-4 border-2 rounded-xl transition-all hover:scale-105 ${
                            buttonStyle === style.id 
                              ? "border-purple-600 bg-purple-50 shadow-lg" 
                              : "border-gray-200 hover:border-purple-300 bg-white"
                          }`}
                        >
                          <div className="flex flex-col items-center gap-2">
                            <div 
                              className={`w-12 h-12 ${style.icon} flex items-center justify-center text-white shadow-md`}
                              style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
                            >
                              <MessageCircle className="w-6 h-6" />
                            </div>
                            <span className="text-xs font-semibold text-gray-700">{style.label}</span>
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="mt-5 pt-5 border-t space-y-3">
                      <Label className="text-sm font-semibold text-gray-700">Animation</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { id: "bounce", label: "Bounce", animate: true },
                          { id: "none", label: "Static", animate: false },
                        ].map((anim) => (
                          <button
                            key={anim.id}
                            onClick={() => setButtonAnimation(anim.id)}
                            className={`p-4 border-2 rounded-xl transition-all hover:scale-105 ${
                              buttonAnimation === anim.id 
                                ? "border-purple-600 bg-purple-50 shadow-lg" 
                                : "border-gray-200 hover:border-purple-300 bg-white"
                            }`}
                          >
                            <div className="flex flex-col items-center gap-2">
                              <div 
                                className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${
                                  anim.animate ? "animate-bounce" : ""
                                }`}
                                style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
                              >
                                <MessageCircle className="w-5 h-5" />
                              </div>
                              <span className="text-xs font-semibold text-gray-700">{anim.label}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Widget Size & Position Card */}
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Maximize2 className="w-5 h-5" />
                      Widget Size & Position
                    </CardTitle>
                    <CardDescription>Control widget dimensions and placement on your website</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-6">
                    {/* Size Presets */}
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-gray-700">Size Preset</Label>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { id: "small", label: "Small", width: "350", height: "500" },
                          { id: "medium", label: "Medium", width: "400", height: "600" },
                          { id: "large", label: "Large", width: "450", height: "700" },
                          { id: "custom", label: "Custom", width: widgetWidth, height: widgetHeight },
                        ].map((preset) => (
                          <button
                            key={preset.id}
                            onClick={() => {
                              setSizePreset(preset.id);
                              if (preset.id !== "custom") {
                                setWidgetWidth(preset.width);
                                setWidgetHeight(preset.height);
                              }
                            }}
                            className={`p-3 border-2 rounded-xl transition-all hover:scale-105 ${
                              sizePreset === preset.id 
                                ? "border-purple-600 bg-purple-50 shadow-lg" 
                                : "border-gray-200 hover:border-purple-300 bg-white"
                            }`}
                          >
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-xs font-semibold text-gray-700">{preset.label}</span>
                              {preset.id !== "custom" && (
                                <span className="text-[10px] text-gray-500">{preset.width}×{preset.height}</span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Width Control */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold text-gray-700">Width</Label>
                        <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">{widgetWidth}px</span>
                      </div>
                      <Slider
                        value={[parseInt(widgetWidth)]}
                        onValueChange={(value) => {
                          setWidgetWidth(value[0].toString());
                          setSizePreset("custom");
                        }}
                        min={300}
                        max={600}
                        step={10}
                        className="w-full"
                      />
                    </div>

                    {/* Height Control */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold text-gray-700">Height</Label>
                        <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">{widgetHeight}px</span>
                      </div>
                      <Slider
                        value={[parseInt(widgetHeight)]}
                        onValueChange={(value) => {
                          setWidgetHeight(value[0].toString());
                          setSizePreset("custom");
                        }}
                        min={400}
                        max={800}
                        step={10}
                        className="w-full"
                      />
                    </div>

                    {/* Bubble Size Control */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold text-gray-700">Chat Bubble Size</Label>
                        <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">{bubbleSize}px</span>
                      </div>
                      <Slider
                        value={[parseInt(bubbleSize)]}
                        onValueChange={(value) => setBubbleSize(value[0].toString())}
                        min={40}
                        max={80}
                        step={5}
                        className="w-full"
                      />
                    </div>

                    {/* Position Selection */}
                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-gray-700">Widget Position</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { id: "bottom-right", label: "Bottom Right", icon: ArrowDownRight },
                          { id: "bottom-left", label: "Bottom Left", icon: ArrowDownLeft },
                          { id: "top-right", label: "Top Right", icon: ArrowUpRight },
                          { id: "top-left", label: "Top Left", icon: ArrowUpLeft },
                        ].map((pos) => (
                          <button
                            key={pos.id}
                            onClick={() => setWidgetPosition(pos.id)}
                            className={`p-4 border-2 rounded-xl transition-all hover:scale-105 ${
                              widgetPosition === pos.id 
                                ? "border-purple-600 bg-purple-50 shadow-lg" 
                                : "border-gray-200 hover:border-purple-300 bg-white"
                            }`}
                          >
                            <div className="flex flex-col items-center gap-2">
                              <pos.icon className="w-6 h-6 text-purple-600" />
                              <span className="text-xs font-semibold text-gray-700">{pos.label}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="border-t pt-6">
                      <Label className="text-sm font-semibold text-gray-700 mb-1 block">Pill / Launcher Offset</Label>
                      <p className="text-xs text-gray-500 mb-4">Adjust the distance of the chat pill from the screen edges. Useful when the pill overlaps buttons on your website.</p>
                      
                      <div className="space-y-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm text-gray-600">Bottom Offset</Label>
                            <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">{pillBottomOffset}px</span>
                          </div>
                          <Slider
                            value={[parseInt(pillBottomOffset)]}
                            onValueChange={(value) => setPillBottomOffset(value[0].toString())}
                            min={0}
                            max={200}
                            step={5}
                            className="w-full"
                          />
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm text-gray-600">Side Offset</Label>
                            <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">{pillSideOffset}px</span>
                          </div>
                          <Slider
                            value={[parseInt(pillSideOffset)]}
                            onValueChange={(value) => setPillSideOffset(value[0].toString())}
                            min={0}
                            max={200}
                            step={5}
                            className="w-full"
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* WhatsApp Launcher Card */}
                <Card className="shadow-md border border-gray-200 bg-white">
                  <CardHeader className="pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                        </svg>
                      </div>
                      <div>
                        <CardTitle className="text-base">Widget Launcher</CardTitle>
                        <CardDescription className="text-sm">Choose which launcher visitors see on your site</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-4">
                    <div>
                      <Label className="text-sm font-medium">Launcher Type</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                        {([
                          { value: "ai", title: "AI Chat", desc: "Chat bubble only" },
                          { value: "whatsapp", title: "WhatsApp", desc: "Click-to-chat only" },
                          { value: "both", title: "Both", desc: "Stacked together" },
                        ] as const).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setLauncherMode(opt.value);
                              updateMutation.mutate({ launcherMode: opt.value });
                            }}
                            className={`text-left rounded-lg border p-3 transition-colors ${
                              launcherMode === opt.value
                                ? "border-purple-500 bg-purple-50 ring-1 ring-purple-500"
                                : "border-gray-200 hover:border-gray-300 bg-white"
                            }`}
                            data-testid={`button-launcher-mode-${opt.value}`}
                          >
                            <div className="text-sm font-semibold text-gray-900">{opt.title}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {(launcherMode === "whatsapp" || launcherMode === "both") && (
                      <div className="space-y-4 pt-1">
                        <div>
                          <Label htmlFor="whatsappWidgetNumber" className="text-sm font-medium">WhatsApp Number</Label>
                          <Input
                            id="whatsappWidgetNumber"
                            value={whatsappWidgetNumber}
                            onChange={(e) => setWhatsappWidgetNumber(e.target.value)}
                            onBlur={() => updateMutation.mutate({ whatsappWidgetNumber: whatsappWidgetNumber })}
                            placeholder="+1234567890 (with country code)"
                            className="mt-1"
                            data-testid="input-whatsapp-widget-number"
                          />
                          <p className="text-xs text-gray-500 mt-1">Required. If missing or invalid, the AI chat launcher is shown instead.</p>
                        </div>
                        <div>
                          <Label htmlFor="whatsappWidgetLabel" className="text-sm font-medium">Pill Label</Label>
                          <Input
                            id="whatsappWidgetLabel"
                            value={whatsappWidgetLabel}
                            onChange={(e) => setWhatsappWidgetLabel(e.target.value)}
                            onBlur={() => updateMutation.mutate({ whatsappWidgetLabel: whatsappWidgetLabel })}
                            placeholder="How can I help you?"
                            className="mt-1"
                            data-testid="input-whatsapp-widget-label"
                          />
                          <p className="text-xs text-gray-500 mt-1">Shown on the WhatsApp-only pill. In "Both" mode a round icon is used instead.</p>
                        </div>
                        <div>
                          <Label htmlFor="whatsappWidgetMessage" className="text-sm font-medium">Pre-filled Message <span className="text-gray-400 font-normal">(optional)</span></Label>
                          <Textarea
                            id="whatsappWidgetMessage"
                            value={whatsappWidgetMessage}
                            onChange={(e) => setWhatsappWidgetMessage(e.target.value)}
                            onBlur={() => updateMutation.mutate({ whatsappWidgetMessage: whatsappWidgetMessage })}
                            placeholder="Hi! I have a question..."
                            className="mt-1"
                            rows={2}
                            data-testid="input-whatsapp-widget-message"
                          />
                          <p className="text-xs text-gray-500 mt-1">Text the visitor's WhatsApp opens pre-filled with.</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium">WhatsApp Position</Label>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                            {([
                              { value: "", title: "Same as chat" },
                              { value: "bottom-right", title: "Bottom-right" },
                              { value: "bottom-left", title: "Bottom-left" },
                              { value: "top-right", title: "Top-right" },
                              { value: "top-left", title: "Top-left" },
                            ] as const).map((opt) => (
                              <button
                                key={opt.value || "inherit"}
                                type="button"
                                onClick={() => {
                                  setWhatsappWidgetPosition(opt.value);
                                  updateMutation.mutate({ whatsappWidgetPosition: opt.value });
                                }}
                                className={`text-center rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                                  whatsappWidgetPosition === opt.value
                                    ? "border-purple-500 bg-purple-50 ring-1 ring-purple-500 text-gray-900"
                                    : "border-gray-200 hover:border-gray-300 bg-white text-gray-700"
                                }`}
                                data-testid={`button-whatsapp-position-${opt.value || "inherit"}`}
                              >
                                {opt.title}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">{launcherMode === "both" ? 'In "Both" mode, pick a different corner from the chat widget to separate them, or "Same as chat" to stack them.' : "Which corner the WhatsApp launcher appears in."}</p>
                        </div>
                        <div>
                          <Label htmlFor="whatsappWidgetColor" className="text-sm font-medium">Launcher Color</Label>
                          <div className="flex items-center gap-3 mt-1">
                            <input
                              type="color"
                              id="whatsappWidgetColor"
                              value={whatsappWidgetColor}
                              onChange={(e) => setWhatsappWidgetColor(e.target.value)}
                              onBlur={() => updateMutation.mutate({ whatsappWidgetColor: whatsappWidgetColor })}
                              className="h-9 w-12 rounded border border-gray-200 cursor-pointer p-0.5"
                              data-testid="input-whatsapp-widget-color"
                            />
                            <Input
                              value={whatsappWidgetColor}
                              onChange={(e) => setWhatsappWidgetColor(e.target.value)}
                              onBlur={() => updateMutation.mutate({ whatsappWidgetColor: whatsappWidgetColor })}
                              className="w-32 font-mono text-sm"
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-1">WhatsApp green (#25D366) by default.</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Behavior Tab */}
              <TabsContent value="behavior" className="mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Left Column */}
                  <div className="space-y-4">
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg">Welcome Message</CardTitle>
                    <CardDescription>First impression matters</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <RadioGroup value={welcomeMessageType} onValueChange={setWelcomeMessageType}>
                      <div className={`flex items-start space-x-3 rounded-xl border-2 p-4 cursor-pointer transition-all ${
                        welcomeMessageType === "custom" 
                          ? "border-purple-500 bg-purple-50/50 shadow-md" 
                          : "border-gray-200 hover:border-purple-300 bg-white"
                      }`} onClick={() => setWelcomeMessageType("custom")}>
                        <RadioGroupItem value="custom" id="custom" className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor="custom" className="font-semibold cursor-pointer text-base">
                            Custom Message
                          </Label>
                          <p className="text-sm text-gray-600 mt-1">
                            Write your own personalized greeting
                          </p>
                        </div>
                      </div>

                      <div className={`flex items-start space-x-3 rounded-xl border-2 p-4 cursor-pointer transition-all ${
                        welcomeMessageType === "ai_generated" 
                          ? "border-purple-500 bg-purple-50/50 shadow-md" 
                          : "border-gray-200 hover:border-purple-300 bg-white"
                      }`} onClick={() => setWelcomeMessageType("ai_generated")}>
                        <RadioGroupItem value="ai_generated" id="ai_generated" className="mt-1" />
                        <div className="flex-1">
                          <Label htmlFor="ai_generated" className="font-semibold cursor-pointer flex items-center gap-2 text-base">
                            <Sparkles className="w-5 h-5 text-purple-600" />
                            AI-Generated
                          </Label>
                          <p className="text-sm text-gray-600 mt-1">
                            Dynamic messages based on your business
                          </p>
                        </div>
                      </div>
                    </RadioGroup>

                    {welcomeMessageType === "custom" && (
                      <div className="mt-4 space-y-2">
                        <Label htmlFor="welcomeMessage" className="text-sm font-semibold text-gray-700">
                          Your Message
                        </Label>
                        <Textarea
                          id="welcomeMessage"
                          value={welcomeMessage}
                          onChange={(e) => setWelcomeMessage(e.target.value)}
                          placeholder="Hi! How can I help you today?"
                          maxLength={100}
                          className="min-h-[100px] resize-none"
                        />
                        <p className="text-xs text-gray-500">
                          {welcomeMessage.length}/100 characters
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg">AI Personality</CardTitle>
                    <CardDescription>How should Chroney interact?</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <RadioGroup value={personality} onValueChange={setPersonality} className="space-y-3">
                      {[
                        { id: "friendly", label: "Friendly", desc: "Warm and approachable, like a helpful friend", emoji: "😊" },
                        { id: "professional", label: "Professional", desc: "Business-focused and formal", emoji: "💼" },
                        { id: "funny", label: "Funny", desc: "Light-hearted with humor", emoji: "😄" },
                        { id: "polite", label: "Polite", desc: "Respectful and courteous", emoji: "🙏" },
                        { id: "casual", label: "Casual", desc: "Relaxed and easy-going", emoji: "😎" },
                      ].map((p) => (
                        <div 
                          key={p.id}
                          className={`flex items-start space-x-3 rounded-xl border-2 p-4 cursor-pointer transition-all ${
                            personality === p.id 
                              ? "border-purple-500 bg-purple-50/50 shadow-md" 
                              : "border-gray-200 hover:border-purple-300 bg-white"
                          }`}
                          onClick={() => setPersonality(p.id)}
                        >
                          <RadioGroupItem value={p.id} id={p.id} className="mt-1" />
                          <div className="flex-1">
                            <Label htmlFor={p.id} className="font-semibold cursor-pointer text-base flex items-center gap-2">
                              <span>{p.emoji}</span>
                              {p.label}
                            </Label>
                            <p className="text-sm text-gray-600 mt-1">{p.desc}</p>
                          </div>
                        </div>
                      ))}
                    </RadioGroup>
                  </CardContent>
                </Card>

                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg">Response Length</CardTitle>
                    <CardDescription>Control how detailed AI responses are</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <RadioGroup value={responseLength} onValueChange={setResponseLength} className="space-y-3">
                      {[
                        { id: "concise", label: "Concise", desc: "Short, to-the-point answers (2-3 lines)", icon: "⚡" },
                        { id: "balanced", label: "Balanced", desc: "Moderate detail with key points", icon: "⚖️" },
                        { id: "detailed", label: "Detailed", desc: "Comprehensive answers with full explanations", icon: "📋" },
                      ].map((r) => (
                        <div 
                          key={r.id}
                          className={`flex items-start space-x-3 rounded-xl border-2 p-4 cursor-pointer transition-all ${
                            responseLength === r.id 
                              ? "border-purple-500 bg-purple-50/50 shadow-md" 
                              : "border-gray-200 hover:border-purple-300 bg-white"
                          }`}
                          onClick={() => setResponseLength(r.id)}
                        >
                          <RadioGroupItem value={r.id} id={`rl-${r.id}`} className="mt-1" />
                          <div className="flex-1">
                            <Label htmlFor={`rl-${r.id}`} className="font-semibold cursor-pointer text-base flex items-center gap-2">
                              <span>{r.icon}</span>
                              {r.label}
                            </Label>
                            <p className="text-sm text-gray-600 mt-1">{r.desc}</p>
                          </div>
                        </div>
                      ))}
                    </RadioGroup>
                  </CardContent>
                </Card>

                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg">Chat Behavior</CardTitle>
                    <CardDescription>Control how the chat widget appears</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor="auto-open-chat" className="text-base font-semibold">
                          Auto-Open Chat
                        </Label>
                        <p className="text-sm text-gray-600">
                          Automatically open the chat window when the page loads
                        </p>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {[
                          { id: "off", label: "Off", desc: "Never auto-open" },
                          { id: "desktop", label: "Desktop Only", desc: "Auto-open on desktop" },
                          { id: "mobile", label: "Mobile Only", desc: "Auto-open on mobile" },
                          { id: "both", label: "Both", desc: "Auto-open everywhere" },
                        ].map((option) => (
                          <button
                            key={option.id}
                            onClick={() => setAutoOpenChat(option.id)}
                            className={`p-3 border-2 rounded-xl transition-all hover:scale-105 ${
                              (autoOpenChat === option.id || 
                               (autoOpenChat === "true" && option.id === "both") ||
                               (autoOpenChat === "false" && option.id === "off"))
                                ? "border-purple-600 bg-purple-50 shadow-lg" 
                                : "border-gray-200 hover:border-purple-300 bg-white"
                            }`}
                          >
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-xs font-semibold text-gray-700">{option.label}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                      
                      {/* Auto-Open Frequency - only show when auto-open is enabled */}
                      {autoOpenChat !== "off" && autoOpenChat !== "false" && (
                        <div className="mt-4 pt-4 border-t border-gray-100">
                          <div className="space-y-1 mb-3">
                            <Label className="text-sm font-semibold">
                              Auto-Open Frequency
                            </Label>
                            <p className="text-xs text-gray-500">
                              How often should the chat auto-open for visitors?
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => setAutoOpenFrequency("once")}
                              className={`p-3 border-2 rounded-xl transition-all hover:scale-105 ${
                                autoOpenFrequency === "once"
                                  ? "border-purple-600 bg-purple-50 shadow-lg" 
                                  : "border-gray-200 hover:border-purple-300 bg-white"
                              }`}
                            >
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-xs font-semibold text-gray-700">Once Per Visitor</span>
                                <span className="text-[10px] text-gray-500">First visit only</span>
                              </div>
                            </button>
                            <button
                              onClick={() => setAutoOpenFrequency("always")}
                              className={`p-3 border-2 rounded-xl transition-all hover:scale-105 ${
                                autoOpenFrequency === "always"
                                  ? "border-purple-600 bg-purple-50 shadow-lg" 
                                  : "border-gray-200 hover:border-purple-300 bg-white"
                              }`}
                            >
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-xs font-semibold text-gray-700">Every Page Load</span>
                                <span className="text-[10px] text-gray-500">Always auto-open</span>
                              </div>
                            </button>
                          </div>
                          <p className="text-xs text-gray-400 mt-2 italic">
                            Note: If a visitor closes the chat, it stays closed for that session
                          </p>
                        </div>
                      )}
                      
                      {/* Opening Sound Toggle */}
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-purple-50/30 to-pink-50/30 border border-purple-100">
                          <div className="space-y-1">
                            <Label htmlFor="opening-sound" className="text-sm font-semibold cursor-pointer flex items-center gap-2">
                              <Volume2 className="w-4 h-4 text-purple-600" />
                              AI Activation Sound
                            </Label>
                            <p className="text-xs text-gray-500">
                              Play a sound when chat opens
                            </p>
                          </div>
                          <Switch
                            id="opening-sound"
                            checked={openingSoundEnabled}
                            onCheckedChange={setOpeningSoundEnabled}
                          />
                        </div>
                        
                        {/* Sound Style Selector - only show when sound is enabled */}
                        {openingSoundEnabled && (
                          <div className="mt-3 p-4 rounded-xl bg-gray-50/50">
                            <Label className="text-xs font-semibold text-gray-700 mb-2 block">
                              Sound Style
                            </Label>
                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { id: "chime", label: "Chime", desc: "Rising shimmer" },
                                { id: "bell", label: "Bell", desc: "Elegant tone" },
                                { id: "pop", label: "Pop", desc: "Quick & modern" },
                              ].map((sound) => (
                                <button
                                  key={sound.id}
                                  onClick={() => setOpeningSoundStyle(sound.id)}
                                  className={`p-3 border-2 rounded-xl transition-all hover:scale-105 ${
                                    openingSoundStyle === sound.id
                                      ? "border-purple-600 bg-purple-50 shadow-lg" 
                                      : "border-gray-200 hover:border-purple-300 bg-white"
                                  }`}
                                >
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-xs font-semibold text-gray-700">{sound.label}</span>
                                    <span className="text-[10px] text-gray-500">{sound.desc}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-4">
                {/* Conversation Starters Card */}
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-purple-600" />
                      AI Conversation Starters
                    </CardTitle>
                    <CardDescription>Help users start conversations with suggested questions</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    {/* Enable/Disable Toggle */}
                    <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50/50">
                      <div className="space-y-1">
                        <Label htmlFor="enable-starters" className="text-base font-semibold cursor-pointer">
                          Show Conversation Starters
                        </Label>
                        <p className="text-sm text-gray-600">
                          Display AI-generated question suggestions when chat is empty
                        </p>
                      </div>
                      <Switch
                        id="enable-starters"
                        checked={conversationStartersEnabled}
                        onCheckedChange={(checked) => {
                          setConversationStartersEnabled(checked);
                          saveStartersEnabled(checked);
                        }}
                      />
                    </div>
                    
                    {/* Show on Chat Bubble Toggle */}
                    <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50/50">
                      <div className="space-y-1">
                        <Label htmlFor="show-starters-on-pill" className="text-base font-semibold cursor-pointer">
                          Show on Chat Bubble
                        </Label>
                        <p className="text-sm text-gray-600">
                          Display starters above the chat button when chat is closed
                        </p>
                      </div>
                      <Switch
                        id="show-starters-on-pill"
                        checked={showStartersOnPill}
                        onCheckedChange={(checked) => {
                          setShowStartersOnPill(checked);
                          saveShowStartersOnPill(checked);
                        }}
                      />
                    </div>

                    {/* Starters List with Edit/Delete Controls */}
                    {conversationStarters.length > 0 && (
                      <div className="space-y-3">
                        <Label className="text-sm font-semibold text-gray-700">
                          Current Suggestions
                        </Label>
                        <div className="space-y-2">
                          {conversationStarters.map((starter, index) => (
                            <div
                              key={index}
                              className="group relative p-3 rounded-lg text-white text-sm font-medium flex items-center gap-2"
                              style={{
                                background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`
                              }}
                            >
                              {editingIndex === index ? (
                                <>
                                  <Input
                                    value={editingText}
                                    onChange={(e) => setEditingText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSaveEdit(index);
                                      } else if (e.key === 'Escape') {
                                        setEditingIndex(null);
                                        setEditingText('');
                                      }
                                    }}
                                    className="flex-1 bg-white/20 border-white/30 text-white placeholder:text-white/60 focus:bg-white/30"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => handleSaveEdit(index)}
                                    className="p-1.5 hover:bg-white/20 rounded transition-colors"
                                    title="Save"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingIndex(null);
                                      setEditingText('');
                                    }}
                                    className="p-1.5 hover:bg-white/20 rounded transition-colors"
                                    title="Cancel"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="flex-1">{starter}</span>
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => handleEditStarter(index, starter)}
                                      className="p-1.5 hover:bg-white/20 rounded transition-colors"
                                      title="Edit"
                                    >
                                      <Pencil className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteStarter(index)}
                                      className="p-1.5 hover:bg-white/20 rounded transition-colors"
                                      title="Delete"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Add Custom Starter */}
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-gray-700">
                        Add Custom Suggestion
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Type your custom question..."
                          value={newStarterText}
                          onChange={(e) => setNewStarterText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newStarterText.trim()) {
                              handleAddCustomStarter();
                            }
                          }}
                          className="flex-1"
                        />
                        <Button
                          onClick={handleAddCustomStarter}
                          disabled={!newStarterText.trim()}
                          variant="outline"
                          className="flex-shrink-0"
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Add
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500">
                        Maximum 3 conversation starters recommended for best user experience
                      </p>
                    </div>

                    {/* Generate Button */}
                    <Button
                      onClick={handleGenerateStarters}
                      disabled={generatingStarters}
                      className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                    >
                      {generatingStarters ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Generating with AI...
                        </>
                      ) : (
                        <>
                          <Wand2 className="w-4 h-4 mr-2" />
                          {conversationStarters.length > 0 ? 'Regenerate Starters' : 'Generate Starters'}
                        </>
                      )}
                    </Button>

                    <p className="text-xs text-gray-500 text-center">
                      AI analyzes your products, FAQs, and business info to create personalized conversation starters
                    </p>
                  </CardContent>
                </Card>
                
                {/* Language Selector Card */}
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Globe className="w-5 h-5 text-purple-600" />
                      Language Selector
                    </CardTitle>
                    <CardDescription>Allow visitors to choose their preferred language</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <div className="flex items-center justify-between p-4 rounded-xl border border-gray-200 bg-gray-50/50">
                      <div className="space-y-1">
                        <Label htmlFor="language-selector" className="text-base font-semibold cursor-pointer">
                          Enable Language Selector
                        </Label>
                        <p className="text-sm text-gray-600">
                          Show a language dropdown in the chat header
                        </p>
                      </div>
                      <Switch
                        id="language-selector"
                        checked={languageSelectorEnabled}
                        onCheckedChange={(checked) => {
                          setLanguageSelectorEnabled(checked);
                          updateMutation.mutate({
                            languageSelectorEnabled: checked ? 'true' : 'false',
                            availableLanguages: JSON.stringify(selectedLanguages)
                          });
                        }}
                      />
                    </div>
                    
                    {languageSelectorEnabled && (
                      <div className="space-y-3">
                        <Label className="text-sm font-semibold text-gray-700">
                          Available Languages
                        </Label>
                        <p className="text-xs text-gray-500">
                          Select which languages visitors can choose from. Auto-detect is recommended.
                        </p>
                        <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto p-2 border rounded-lg bg-gray-50">
                          {AVAILABLE_LANGUAGES.map((lang) => (
                            <div
                              key={lang.code}
                              className={`flex items-center space-x-2 p-2 rounded-lg cursor-pointer transition-all ${
                                selectedLanguages.includes(lang.code)
                                  ? 'bg-purple-100 border border-purple-300'
                                  : 'bg-white border border-gray-200 hover:border-purple-200'
                              }`}
                              onClick={() => {
                                const newSelection = selectedLanguages.includes(lang.code)
                                  ? selectedLanguages.filter(l => l !== lang.code)
                                  : [...selectedLanguages, lang.code];
                                if (newSelection.length > 0) {
                                  setSelectedLanguages(newSelection);
                                  updateMutation.mutate({
                                    languageSelectorEnabled: 'true',
                                    availableLanguages: JSON.stringify(newSelection)
                                  });
                                }
                              }}
                            >
                              <Checkbox
                                checked={selectedLanguages.includes(lang.code)}
                                className="pointer-events-none"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{lang.name}</div>
                                <div className="text-xs text-gray-500 truncate">{lang.nativeName}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-gray-500 text-center">
                          {selectedLanguages.length} language{selectedLanguages.length !== 1 ? 's' : ''} selected
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                {/* Visual Search Settings Card - Only show if visual search is enabled */}
                {settings?.visualSearchEnabled && (
                  <Card className="shadow-lg border border-gray-200 bg-white">
                    <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                      <CardTitle className="text-lg flex items-center gap-2">
                        📷 Visual Product Search
                      </CardTitle>
                      <CardDescription>Configure how image-based product search works</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-6">
                      <div className="space-y-3">
                        <Label className="text-sm font-semibold text-gray-700 flex items-center justify-between">
                          <span>Minimum Match Threshold</span>
                          <span className="text-purple-600 font-bold text-lg">{visualSimilarityThreshold}%</span>
                        </Label>
                        <p className="text-xs text-gray-500">
                          Only show products with similarity score above this threshold
                        </p>
                        <div className="px-2">
                          <Slider
                            value={[parseInt(visualSimilarityThreshold)]}
                            onValueChange={(value) => {
                              const newValue = String(value[0]);
                              setVisualSimilarityThreshold(newValue);
                            }}
                            onValueCommit={(value) => {
                              updateMutation.mutate({
                                visualSimilarityThreshold: String(value[0])
                              });
                            }}
                            min={0}
                            max={100}
                            step={5}
                            className="w-full"
                          />
                        </div>
                        <div className="flex justify-between text-xs text-gray-400 px-2">
                          <span>0% (Show all)</span>
                          <span>50%</span>
                          <span>100% (Exact)</span>
                        </div>
                        <div className="mt-4 p-3 rounded-lg bg-purple-50 border border-purple-100">
                          <p className="text-xs text-purple-700">
                            💡 <strong>Tip:</strong> Higher threshold = fewer but more accurate matches. 
                            Lower threshold = more matches including similar products.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
                
                {/* Product Page AI Widget Mode Card */}
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <Collapsible open={productPageSectionOpen} onOpenChange={setProductPageSectionOpen}>
                    <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                      <div className="flex items-center justify-between">
                        <div 
                          className="flex-1 cursor-pointer" 
                          onClick={() => setProductPageSectionOpen(!productPageSectionOpen)}
                        >
                          <CardTitle className="text-lg flex items-center gap-2">
                            {productPageSectionOpen ? (
                              <ChevronDown className="w-4 h-4 text-purple-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-purple-600" />
                            )}
                            <Sparkles className="w-5 h-5 text-purple-600" />
                            Product Page AI Mode
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Show AI-powered product assistant on ecommerce product pages
                          </CardDescription>
                        </div>
                        <Switch
                          checked={productPageModeEnabled}
                          onCheckedChange={(checked) => {
                            setProductPageModeEnabled(checked);
                            updateMutation.mutate({
                              productPageModeEnabled: checked ? 'true' : 'false'
                            });
                          }}
                        />
                      </div>
                    </CardHeader>
                    <CollapsibleContent>
                      {productPageModeEnabled && (
                        <CardContent className="space-y-4 pt-6">
                          <p className="text-sm text-gray-600 mb-4">
                            When enabled, the widget automatically detects product pages on Shopify, WooCommerce, and other platforms to show contextual AI features.
                          </p>
                          
                          {/* AI Trivia Toggle */}
                          <div className="flex items-center justify-between p-4 rounded-xl border border-gray-200 bg-gray-50/50">
                            <div className="space-y-1">
                              <Label htmlFor="show-ai-trivia" className="text-base font-semibold cursor-pointer">
                                AI Trivia
                              </Label>
                              <p className="text-sm text-gray-600">
                                Show AI-generated fun facts about the product to spark interest
                              </p>
                            </div>
                            <Switch
                              id="show-ai-trivia"
                              checked={showAiTrivia}
                              onCheckedChange={(checked) => {
                                setShowAiTrivia(checked);
                                updateMutation.mutate({
                                  showAiTrivia: checked ? 'true' : 'false'
                                });
                              }}
                            />
                          </div>
                          
                          {/* Suggested Questions Toggle */}
                          <div className="flex items-center justify-between p-4 rounded-xl border border-gray-200 bg-gray-50/50">
                            <div className="space-y-1">
                              <Label htmlFor="show-suggested-questions" className="text-base font-semibold cursor-pointer">
                                Suggested Questions
                              </Label>
                              <p className="text-sm text-gray-600">
                                Display floating question bubbles that customers can tap to ask
                              </p>
                            </div>
                            <Switch
                              id="show-suggested-questions"
                              checked={showSuggestedQuestions}
                              onCheckedChange={(checked) => {
                                setShowSuggestedQuestions(checked);
                                updateMutation.mutate({
                                  showSuggestedQuestions: checked ? 'true' : 'false'
                                });
                              }}
                            />
                          </div>
                          
                          {/* Review Summary Toggle */}
                          <div className="flex items-center justify-between p-4 rounded-xl border border-gray-200 bg-gray-50/50">
                            <div className="space-y-1">
                              <Label htmlFor="show-review-summary" className="text-base font-semibold cursor-pointer">
                                Review Summary
                              </Label>
                              <p className="text-sm text-gray-600">
                                Show "Summarize reviews" button to generate AI summaries of customer feedback
                              </p>
                            </div>
                            <Switch
                              id="show-review-summary"
                              checked={showReviewSummary}
                              onCheckedChange={(checked) => {
                                setShowReviewSummary(checked);
                                updateMutation.mutate({
                                  showReviewSummary: checked ? 'true' : 'false'
                                });
                              }}
                            />
                          </div>
                          
                          {/* Preview/Info Box */}
                          <div className="mt-4 p-4 rounded-lg bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100">
                            <p className="text-sm text-purple-800 font-medium mb-2">
                              How it works:
                            </p>
                            <ul className="text-xs text-purple-700 space-y-1 list-disc pl-4">
                              <li>Widget auto-detects product pages via URL patterns and page data</li>
                              <li>Supports Shopify, WooCommerce, Magento, BigCommerce, and custom stores</li>
                              <li>Uses existing assistant name, colors, and theme from your settings</li>
                              <li>Falls back to regular chatbot on non-product pages</li>
                            </ul>
                          </div>
                        </CardContent>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
                  </div>
                </div>
              </TabsContent>

              {/* Nudges Tab - Redesigned */}
              <TabsContent value="nudges" className="mt-4">
                <div className="space-y-6">
                  {/* Overview Summary Banner */}
                  <Card className="border border-gray-200 bg-white shadow-sm">
                    <CardContent className="py-4 px-6">
                      <div className="flex flex-wrap items-center gap-4">
                        <span className="text-sm font-semibold text-gray-700">Nudge Status:</span>
                        <div className="flex flex-wrap gap-3">
                          <button
                            onClick={() => setInactivityNudgeEnabled(!inactivityNudgeEnabled)}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                              inactivityNudgeEnabled 
                                ? "bg-purple-100 text-purple-700 border border-purple-200" 
                                : "bg-gray-100 text-gray-500 border border-gray-200"
                            }`}
                          >
                            <Bell className="w-3.5 h-3.5" />
                            Inactivity
                            <span className={`w-2 h-2 rounded-full ${inactivityNudgeEnabled ? "bg-green-500" : "bg-gray-300"}`} />
                          </button>
                          <button
                            onClick={() => setProactiveNudgeEnabled(!proactiveNudgeEnabled)}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                              proactiveNudgeEnabled 
                                ? "bg-purple-100 text-purple-700 border border-purple-200" 
                                : "bg-gray-100 text-gray-500 border border-gray-200"
                            }`}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Proactive
                            <span className={`w-2 h-2 rounded-full ${proactiveNudgeEnabled ? "bg-green-500" : "bg-gray-300"}`} />
                          </button>
                          <button
                            onClick={() => setCenterBannerEnabled(!centerBannerEnabled)}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                              centerBannerEnabled 
                                ? "bg-purple-100 text-purple-700 border border-purple-200" 
                                : "bg-gray-100 text-gray-500 border border-gray-200"
                            }`}
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Center Banner
                            <span className={`w-2 h-2 rounded-full ${centerBannerEnabled ? "bg-green-500" : "bg-gray-300"}`} />
                          </button>
                          <button
                            onClick={() => setReengagementBannerEnabled(!reengagementBannerEnabled)}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                              reengagementBannerEnabled 
                                ? "bg-purple-100 text-purple-700 border border-purple-200" 
                                : "bg-gray-100 text-gray-500 border border-gray-200"
                            }`}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Re-engagement
                            <span className={`w-2 h-2 rounded-full ${reengagementBannerEnabled ? "bg-green-500" : "bg-gray-300"}`} />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Inactivity Nudge Section */}
                  <Collapsible open={inactivitySectionOpen} onOpenChange={setInactivitySectionOpen}>
                    <Card className="border border-gray-200 bg-white shadow-sm">
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50/50 transition-colors">
                          <div className="flex items-center gap-3">
                            {inactivitySectionOpen ? (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-gray-400" />
                            )}
                            <Bell className="w-5 h-5 text-purple-600" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold text-gray-900">Inactivity Nudge</h3>
                              <p className="text-sm font-normal text-gray-500">Re-engage visitors who stop responding</p>
                            </div>
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={inactivityNudgeEnabled}
                              onCheckedChange={setInactivityNudgeEnabled}
                            />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-6 pb-6 border-t border-gray-100">
                          {inactivityNudgeEnabled ? (
                            <div className="pt-4 flex flex-col md:flex-row gap-4">
                              {/* Left Column - Settings */}
                              <div className="md:w-3/5 space-y-4">
                                {/* Initial Delay Setting */}
                                <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg border border-gray-200">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-purple-600" />
                                    <span className="text-sm font-medium text-gray-700">Initial delay</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <Slider
                                      value={[parseInt(inactivityNudgeDelay) || 45]}
                                      onValueChange={(value) => setInactivityNudgeDelay(value[0].toString())}
                                      min={5}
                                      max={120}
                                      step={5}
                                      className="w-32"
                                    />
                                    <span className="text-sm font-semibold text-purple-700 min-w-[50px] text-right">
                                      {inactivityNudgeDelay}s
                                    </span>
                                  </div>
                                </div>

                                {/* Use AI Toggle */}
                                <div className="flex items-center justify-between py-3 px-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-purple-600" />
                                    <div>
                                      <span className="text-sm font-medium text-gray-700">Use AI</span>
                                      <p className="text-xs text-gray-500">AI generates contextual follow-ups based on conversation</p>
                                    </div>
                                  </div>
                                  <Switch
                                    checked={smartNudgeEnabled}
                                    onCheckedChange={setSmartNudgeEnabled}
                                  />
                                </div>

                                {/* Show AI indicator or manual message sequence */}
                                {smartNudgeEnabled ? (
                                  <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                                        <Sparkles className="w-5 h-5 text-purple-600" />
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium text-gray-800">AI-Powered Nudges Active</p>
                                        <p className="text-xs text-gray-500">Chroney will analyze the conversation and generate contextual follow-up questions</p>
                                      </div>
                                    </div>
                                    <div className="mt-3 text-xs text-gray-500 bg-white/60 rounded p-2">
                                      <span className="font-medium">Fallback message:</span> {inactivityNudgeMessage}
                                    </div>
                                  </div>
                                ) : (
                                <div className="space-y-2">
                                  <Label className="text-sm font-semibold text-gray-700">Message Sequence</Label>
                                  <div className="space-y-0">
                                    {/* First Message (always present) */}
                                    <div 
                                      className={`border border-gray-200 rounded-lg bg-white transition-all ${expandedInactivityMsg === 0 ? 'ring-2 ring-purple-200' : ''}`}
                                    >
                                      <div 
                                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                                        onClick={() => setExpandedInactivityMsg(expandedInactivityMsg === 0 ? null : 0)}
                                      >
                                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white text-xs flex items-center justify-center font-bold">1</span>
                                        <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">after {inactivityNudgeDelay}s</span>
                                        <span className="flex-1 text-sm text-gray-600 truncate">
                                          {inactivityNudgeMessage.substring(0, 40)}{inactivityNudgeMessage.length > 40 ? '...' : ''}
                                        </span>
                                        {expandedInactivityMsg === 0 ? (
                                          <ChevronDown className="w-4 h-4 text-gray-400" />
                                        ) : (
                                          <ChevronRight className="w-4 h-4 text-gray-400" />
                                        )}
                                      </div>
                                      {expandedInactivityMsg === 0 && (
                                        <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-3">
                                          <Textarea
                                            value={inactivityNudgeMessage}
                                            onChange={(e) => setInactivityNudgeMessage(e.target.value)}
                                            placeholder="Still there? Let me know if you need any help!"
                                            maxLength={150}
                                            className="min-h-[80px] resize-none"
                                          />
                                          <div className="flex items-center justify-between">
                                            <span className="text-xs text-gray-500">{inactivityNudgeMessage.length}/150</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Additional Messages */}
                                    {inactivityNudgeMessages.map((msg, index) => (
                                      <div 
                                        key={index}
                                        className={`border border-gray-200 rounded-lg bg-white mt-2 transition-all ${expandedInactivityMsg === index + 1 ? 'ring-2 ring-purple-200' : ''}`}
                                      >
                                        <div 
                                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                                          onClick={() => setExpandedInactivityMsg(expandedInactivityMsg === index + 1 ? null : index + 1)}
                                        >
                                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white text-xs flex items-center justify-center font-bold">{index + 2}</span>
                                          <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">+{msg.delay}s</span>
                                          <span className="flex-1 text-sm text-gray-600 truncate">
                                            {msg.message.substring(0, 40)}{msg.message.length > 40 ? '...' : ''}
                                          </span>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setInactivityNudgeMessages(inactivityNudgeMessages.filter((_, i) => i !== index));
                                            }}
                                            className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                          {expandedInactivityMsg === index + 1 ? (
                                            <ChevronDown className="w-4 h-4 text-gray-400" />
                                          ) : (
                                            <ChevronRight className="w-4 h-4 text-gray-400" />
                                          )}
                                        </div>
                                        {expandedInactivityMsg === index + 1 && (
                                          <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-3">
                                            <div className="flex items-center gap-3">
                                              <Label className="text-xs text-gray-500">Delay after previous:</Label>
                                              <Slider
                                                value={[msg.delay]}
                                                onValueChange={(value) => {
                                                  const newMessages = [...inactivityNudgeMessages];
                                                  newMessages[index] = { ...msg, delay: value[0] };
                                                  setInactivityNudgeMessages(newMessages);
                                                }}
                                                min={5}
                                                max={120}
                                                step={5}
                                                className="w-32"
                                              />
                                              <span className="text-sm font-semibold text-purple-700">{msg.delay}s</span>
                                            </div>
                                            <Textarea
                                              value={msg.message}
                                              onChange={(e) => {
                                                const newMessages = [...inactivityNudgeMessages];
                                                newMessages[index] = { ...msg, message: e.target.value };
                                                setInactivityNudgeMessages(newMessages);
                                              }}
                                              placeholder="Follow-up nudge message..."
                                              maxLength={150}
                                              className="min-h-[80px] resize-none"
                                            />
                                            <span className="text-xs text-gray-500">{msg.message.length}/150</span>
                                          </div>
                                        )}
                                      </div>
                                    ))}

                                    {/* Add Message Button */}
                                    {inactivityNudgeMessages.length < 4 && (
                                      <button
                                        onClick={() => {
                                          setInactivityNudgeMessages([
                                            ...inactivityNudgeMessages,
                                            { message: "", delay: 30 }
                                          ]);
                                          setExpandedInactivityMsg(inactivityNudgeMessages.length + 1);
                                        }}
                                        className="w-full mt-2 py-3 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50/50 transition-all flex items-center justify-center gap-2"
                                      >
                                        <Plus className="w-4 h-4" />
                                        Add follow-up message ({inactivityNudgeMessages.length + 1}/5)
                                      </button>
                                    )}
                                  </div>
                                </div>
                                )}
                              </div>

                              {/* Right Column - Live Preview */}
                              <div className="md:w-2/5">
                                <div 
                                  className="border border-gray-200 rounded-lg bg-gray-50 p-3 h-full"
                                  aria-label="Inactivity nudge preview"
                                >
                                  <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 block">Preview</Label>
                                  <div className="flex justify-center">
                                    <div className="w-[200px] h-[280px] bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden flex flex-col">
                                      {/* Mini Chat Header */}
                                      <div 
                                        className="h-10 flex items-center px-3 gap-2"
                                        style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                                      >
                                        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                                          <MessageCircle className="w-3.5 h-3.5 text-white" />
                                        </div>
                                        <span className="text-xs font-medium text-white truncate">Chat Assistant</span>
                                      </div>
                                      
                                      {/* Chat Content Area */}
                                      <div className="flex-1 p-3 flex flex-col justify-end bg-gray-50/50">
                                        {/* Previous message placeholder */}
                                        <div className="flex justify-end mb-2">
                                          <div className="bg-gray-200 rounded-xl rounded-br-sm px-2.5 py-1.5 max-w-[140px]">
                                            <p className="text-[10px] text-gray-600">...</p>
                                          </div>
                                        </div>
                                        
                                        {/* Delay indicator */}
                                        <div className="flex items-center justify-center gap-1.5 my-2">
                                          <Clock className="w-3 h-3 text-purple-500" />
                                          <span className="text-[9px] text-purple-600 font-medium">After {inactivityNudgeDelay}s of inactivity</span>
                                        </div>
                                        
                                        {/* Nudge message bubble */}
                                        <div className="flex justify-start">
                                          <div 
                                            className="rounded-xl rounded-bl-sm px-2.5 py-1.5 max-w-[160px] shadow-sm"
                                            style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                                          >
                                            {smartNudgeEnabled ? (
                                              <div className="flex items-start gap-1">
                                                <Sparkles className="w-2.5 h-2.5 text-white/80 mt-0.5 flex-shrink-0" />
                                                <p className="text-[10px] text-white leading-tight break-words italic">
                                                  AI-generated contextual follow-up...
                                                </p>
                                              </div>
                                            ) : (
                                              <p className="text-[10px] text-white leading-tight break-words">
                                                {inactivityNudgeMessage || "Still there? Let me know if you need any help!"}
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      </div>

                                      {/* Mini Input Bar */}
                                      <div className="h-8 border-t border-gray-200 bg-white flex items-center px-2 gap-1.5">
                                        <div className="flex-1 h-5 bg-gray-100 rounded-full px-2 flex items-center">
                                          <span className="text-[8px] text-gray-400">Type a message...</span>
                                        </div>
                                        <div 
                                          className="w-5 h-5 rounded-full flex items-center justify-center"
                                          style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                                        >
                                          <Send className="w-2.5 h-2.5 text-white" />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="pt-4 text-center py-8">
                              <p className="text-sm text-gray-500">Enable this nudge to configure message sequence</p>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>

                  {/* Proactive Engagement Section */}
                  <Collapsible open={proactiveSectionOpen} onOpenChange={setProactiveSectionOpen}>
                    <Card className="border border-gray-200 bg-white shadow-sm">
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50/50 transition-colors">
                          <div className="flex items-center gap-3">
                            {proactiveSectionOpen ? (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-gray-400" />
                            )}
                            <MessageCircle className="w-5 h-5 text-purple-600" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold text-gray-900">Proactive Engagement</h3>
                              <p className="text-sm font-normal text-gray-500">Pop up a message to visitors who haven't started chatting</p>
                            </div>
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={proactiveNudgeEnabled}
                              onCheckedChange={setProactiveNudgeEnabled}
                            />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-6 pb-6 border-t border-gray-100">
                          {proactiveNudgeEnabled ? (
                            <div className="pt-4 flex flex-col md:flex-row gap-4">
                              {/* Left Column - Settings */}
                              <div className="md:w-3/5 space-y-4">
                                {/* Initial Delay Setting */}
                                <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg border border-gray-200">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-purple-600" />
                                    <span className="text-sm font-medium text-gray-700">Initial delay</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <Slider
                                      value={[parseInt(proactiveNudgeDelay) || 15]}
                                      onValueChange={(value) => setProactiveNudgeDelay(value[0].toString())}
                                      min={5}
                                      max={60}
                                      step={5}
                                      className="w-32"
                                    />
                                    <span className="text-sm font-semibold text-purple-700 min-w-[50px] text-right">
                                      {proactiveNudgeDelay}s
                                    </span>
                                  </div>
                                </div>

                                {/* Timeline Message Sequence */}
                                <div className="space-y-2">
                                  <Label className="text-sm font-semibold text-gray-700">Message Sequence</Label>
                                  <div className="space-y-0">
                                    {/* First Message (always present) */}
                                    <div 
                                      className={`border border-gray-200 rounded-lg bg-white transition-all ${expandedProactiveMsg === 0 ? 'ring-2 ring-purple-200' : ''}`}
                                    >
                                      <div 
                                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                                        onClick={() => setExpandedProactiveMsg(expandedProactiveMsg === 0 ? null : 0)}
                                      >
                                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white text-xs flex items-center justify-center font-bold">1</span>
                                        <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">after {proactiveNudgeDelay}s</span>
                                        <span className="flex-1 text-sm text-gray-600 truncate">
                                          {proactiveNudgeMessage.substring(0, 40)}{proactiveNudgeMessage.length > 40 ? '...' : ''}
                                        </span>
                                        {expandedProactiveMsg === 0 ? (
                                          <ChevronDown className="w-4 h-4 text-gray-400" />
                                        ) : (
                                          <ChevronRight className="w-4 h-4 text-gray-400" />
                                        )}
                                      </div>
                                      {expandedProactiveMsg === 0 && (
                                        <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-3">
                                          <div className="flex items-center gap-1 pb-1">
                                            <button
                                              type="button"
                                              onMouseDown={(e) => {
                                                e.preventDefault();
                                                applyBold(proactiveMsg0Ref.current, proactiveNudgeMessage, setProactiveNudgeMessage);
                                              }}
                                              className="px-2 py-0.5 text-xs font-bold border border-gray-200 rounded hover:bg-gray-100 text-gray-700"
                                              title="Bold"
                                            >
                                              B
                                            </button>
                                          </div>
                                          <Textarea
                                            ref={proactiveMsg0Ref}
                                            value={proactiveNudgeMessage}
                                            onChange={(e) => setProactiveNudgeMessage(e.target.value)}
                                            placeholder="Need help finding something? I'm here to assist!"
                                            maxLength={100}
                                            className="min-h-[80px] resize-none"
                                          />
                                          <div className="flex items-center justify-between">
                                            <span className="text-xs text-gray-500">{proactiveNudgeMessage.length}/100</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Additional Messages */}
                                    {proactiveNudgeMessages.map((msg, index) => (
                                      <div 
                                        key={index}
                                        className={`border border-gray-200 rounded-lg bg-white mt-2 transition-all ${expandedProactiveMsg === index + 1 ? 'ring-2 ring-purple-200' : ''}`}
                                      >
                                        <div 
                                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                                          onClick={() => setExpandedProactiveMsg(expandedProactiveMsg === index + 1 ? null : index + 1)}
                                        >
                                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white text-xs flex items-center justify-center font-bold">{index + 2}</span>
                                          <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">+{msg.delay}s</span>
                                          <span className="flex-1 text-sm text-gray-600 truncate">
                                            {msg.message.substring(0, 40)}{msg.message.length > 40 ? '...' : ''}
                                          </span>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setProactiveNudgeMessages(proactiveNudgeMessages.filter((_, i) => i !== index));
                                            }}
                                            className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                          {expandedProactiveMsg === index + 1 ? (
                                            <ChevronDown className="w-4 h-4 text-gray-400" />
                                          ) : (
                                            <ChevronRight className="w-4 h-4 text-gray-400" />
                                          )}
                                        </div>
                                        {expandedProactiveMsg === index + 1 && (
                                          <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-3">
                                            <div className="flex items-center gap-3">
                                              <Label className="text-xs text-gray-500">Delay after previous:</Label>
                                              <Slider
                                                value={[msg.delay]}
                                                onValueChange={(value) => {
                                                  const newMessages = [...proactiveNudgeMessages];
                                                  newMessages[index] = { ...msg, delay: value[0] };
                                                  setProactiveNudgeMessages(newMessages);
                                                }}
                                                min={5}
                                                max={120}
                                                step={5}
                                                className="w-32"
                                              />
                                              <span className="text-sm font-semibold text-purple-700">{msg.delay}s</span>
                                            </div>
                                            <div className="flex items-center gap-1 pb-1">
                                              <button
                                                type="button"
                                                onMouseDown={(e) => {
                                                  e.preventDefault();
                                                  applyBold(
                                                    proactiveMsgRefs.current[index],
                                                    msg.message,
                                                    (val) => {
                                                      const newMessages = [...proactiveNudgeMessages];
                                                      newMessages[index] = { ...msg, message: val };
                                                      setProactiveNudgeMessages(newMessages);
                                                    }
                                                  );
                                                }}
                                                className="px-2 py-0.5 text-xs font-bold border border-gray-200 rounded hover:bg-gray-100 text-gray-700"
                                                title="Bold"
                                              >
                                                B
                                              </button>
                                            </div>
                                            <Textarea
                                              ref={(el) => { proactiveMsgRefs.current[index] = el; }}
                                              value={msg.message}
                                              onChange={(e) => {
                                                const newMessages = [...proactiveNudgeMessages];
                                                newMessages[index] = { ...msg, message: e.target.value };
                                                setProactiveNudgeMessages(newMessages);
                                              }}
                                              placeholder="Follow-up message..."
                                              maxLength={100}
                                              className="min-h-[80px] resize-none"
                                            />
                                            <span className="text-xs text-gray-500">{msg.message.length}/100</span>
                                          </div>
                                        )}
                                      </div>
                                    ))}

                                    {/* Add Message Button */}
                                    {proactiveNudgeMessages.length < 4 && (
                                      <button
                                        onClick={() => {
                                          setProactiveNudgeMessages([
                                            ...proactiveNudgeMessages,
                                            { message: "", delay: 10 }
                                          ]);
                                          setExpandedProactiveMsg(proactiveNudgeMessages.length + 1);
                                        }}
                                        className="w-full mt-2 py-3 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50/50 transition-all flex items-center justify-center gap-2"
                                      >
                                        <Plus className="w-4 h-4" />
                                        Add follow-up message ({proactiveNudgeMessages.length + 1}/5)
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Show on every page toggle */}
                                <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg border border-gray-200">
                                  <div>
                                    <span className="text-sm font-medium text-gray-700">Show on every page</span>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                      {proactiveNudgeRepeat 
                                        ? "Pop-up shows on each new page" 
                                        : "Once per session"}
                                    </p>
                                  </div>
                                  <Switch
                                    checked={proactiveNudgeRepeat}
                                    onCheckedChange={setProactiveNudgeRepeat}
                                  />
                                </div>

                                {/* Popup Colors */}
                                <div className="space-y-3 py-3 px-4 bg-gray-50 rounded-lg border border-gray-200">
                                  <Label className="text-sm font-medium text-gray-700">Popup Colors</Label>
                                  <div className="grid grid-cols-3 gap-3">
                                    <div className="space-y-1.5">
                                      <Label className="text-xs text-gray-500">Background Start</Label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="color"
                                          value={proactiveNudgeBgColor}
                                          onChange={(e) => setProactiveNudgeBgColor(e.target.value)}
                                          className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                                        />
                                        <Input
                                          value={proactiveNudgeBgColor}
                                          onChange={(e) => setProactiveNudgeBgColor(e.target.value)}
                                          className="h-8 text-xs font-mono"
                                        />
                                      </div>
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label className="text-xs text-gray-500">Background End</Label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="color"
                                          value={proactiveNudgeBgColorEnd}
                                          onChange={(e) => setProactiveNudgeBgColorEnd(e.target.value)}
                                          className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                                        />
                                        <Input
                                          value={proactiveNudgeBgColorEnd}
                                          onChange={(e) => setProactiveNudgeBgColorEnd(e.target.value)}
                                          className="h-8 text-xs font-mono"
                                        />
                                      </div>
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label className="text-xs text-gray-500">Text Color</Label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="color"
                                          value={proactiveNudgeTextColor}
                                          onChange={(e) => setProactiveNudgeTextColor(e.target.value)}
                                          className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                                        />
                                        <Input
                                          value={proactiveNudgeTextColor}
                                          onChange={(e) => setProactiveNudgeTextColor(e.target.value)}
                                          className="h-8 text-xs font-mono"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Right Column - Live Preview */}
                              <div className="md:w-2/5">
                                <div 
                                  className="border border-gray-200 rounded-lg bg-gray-50 p-3 h-full"
                                  aria-label="Proactive engagement preview"
                                >
                                  <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 block">Preview</Label>
                                  <div className="flex justify-center">
                                    <div className="w-[220px] h-[180px] bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl border border-gray-300 relative overflow-hidden">
                                      {/* Simulated website background */}
                                      <div className="absolute inset-0 p-2">
                                        <div className="w-full h-3 bg-gray-300/50 rounded mb-1.5" />
                                        <div className="w-3/4 h-2 bg-gray-300/40 rounded mb-3" />
                                        <div className="grid grid-cols-3 gap-1.5">
                                          <div className="h-10 bg-gray-300/30 rounded" />
                                          <div className="h-10 bg-gray-300/30 rounded" />
                                          <div className="h-10 bg-gray-300/30 rounded" />
                                        </div>
                                        <div className="w-full h-2 bg-gray-300/40 rounded mt-2" />
                                        <div className="w-2/3 h-2 bg-gray-300/40 rounded mt-1" />
                                      </div>

                                      {/* Speech bubble popup */}
                                      <div className="absolute bottom-14 right-3 max-w-[150px] animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <div 
                                          className="rounded-xl rounded-br-sm px-3 py-2 shadow-lg"
                                          style={{ background: proactiveNudgeBgColor === proactiveNudgeBgColorEnd ? proactiveNudgeBgColor : `linear-gradient(135deg, ${proactiveNudgeBgColor}, ${proactiveNudgeBgColorEnd})` }}
                                        >
                                          <p className="text-[10px] leading-tight break-words" style={{ color: proactiveNudgeTextColor }}>
                                            {proactiveNudgeMessage || "Need help finding something? I'm here to assist!"}
                                          </p>
                                        </div>
                                        {/* Speech bubble tail */}
                                        <div 
                                          className="absolute -bottom-1.5 right-4 w-3 h-3 transform rotate-45"
                                          style={{ background: proactiveNudgeBgColorEnd }}
                                        />
                                      </div>

                                      {/* Chat trigger button */}
                                      <div className="absolute bottom-3 right-3">
                                        <div 
                                          className="w-11 h-11 rounded-full shadow-lg flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
                                          style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                                        >
                                          <MessageCircle className="w-5 h-5 text-white" />
                                        </div>
                                      </div>

                                      {/* Delay indicator */}
                                      <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 rounded-full px-2 py-0.5 shadow-sm">
                                        <Clock className="w-2.5 h-2.5 text-purple-500" />
                                        <span className="text-[8px] text-purple-600 font-medium">After {proactiveNudgeDelay}s</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="pt-4 text-center py-8">
                              <p className="text-sm text-gray-500">Enable this nudge to configure message sequence</p>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>

                  {/* Center Banner Section */}
                  <Collapsible open={centerBannerSectionOpen} onOpenChange={setCenterBannerSectionOpen}>
                    <Card className="border border-gray-200 bg-white shadow-sm">
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50/50 transition-colors">
                          <div className="flex items-center gap-3">
                            {centerBannerSectionOpen ? (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-gray-400" />
                            )}
                            <Sparkles className="w-5 h-5 text-purple-600" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold text-gray-900">Center Banner</h3>
                              <p className="text-sm font-normal text-gray-500">Eye-catching popup in the center of the screen</p>
                            </div>
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={centerBannerEnabled}
                              onCheckedChange={setCenterBannerEnabled}
                            />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-6 pb-6 border-t border-gray-100">
                          {centerBannerEnabled ? (
                            <div className="pt-4 flex flex-col md:flex-row gap-4">
                              {/* Left Column - Settings */}
                              <div className="md:w-3/5 space-y-4">
                                {/* Delay Setting */}
                                <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg border border-gray-200">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-purple-600" />
                                    <span className="text-sm font-medium text-gray-700">Show after</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <Slider
                                      value={[parseInt(centerBannerDelay) || 10]}
                                      onValueChange={(value) => setCenterBannerDelay(value[0].toString())}
                                      min={3}
                                      max={60}
                                      step={1}
                                      className="w-32"
                                    />
                                    <span className="text-sm font-semibold text-purple-700 min-w-[50px] text-right">
                                      {centerBannerDelay}s
                                    </span>
                                  </div>
                                </div>

                                {/* Content Fields */}
                                <div className="grid gap-4">
                                  <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700">Title</Label>
                                    <Input
                                      value={centerBannerTitle}
                                      onChange={(e) => setCenterBannerTitle(e.target.value)}
                                      placeholder="Need Help?"
                                      maxLength={50}
                                    />
                                    <p className="text-xs text-gray-500">{centerBannerTitle.length}/50</p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700">Description</Label>
                                    <Textarea
                                      value={centerBannerDescription}
                                      onChange={(e) => setCenterBannerDescription(e.target.value)}
                                      placeholder="Let me help you find exactly what you're looking for."
                                      maxLength={150}
                                      className="min-h-[60px] resize-none"
                                    />
                                    <p className="text-xs text-gray-500">{centerBannerDescription.length}/150</p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700">Button Text</Label>
                                    <Input
                                      value={centerBannerButtonText}
                                      onChange={(e) => setCenterBannerButtonText(e.target.value)}
                                      placeholder="Start Chat"
                                      maxLength={30}
                                    />
                                    <p className="text-xs text-gray-500">{centerBannerButtonText.length}/30</p>
                                  </div>
                                </div>

                                {/* Background Style */}
                                <div className="border-t border-gray-200 pt-4 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-sm font-semibold text-gray-700">Custom Image Background</Label>
                                    <Switch
                                      checked={centerBannerBackgroundStyle === "image"}
                                      onCheckedChange={(checked) => 
                                        setCenterBannerBackgroundStyle(checked ? "image" : "gradient")
                                      }
                                    />
                                  </div>
                                  
                                  {centerBannerBackgroundStyle === "image" ? (
                                    <div className="space-y-2">
                                      <Input
                                        value={centerBannerImageUrl || ""}
                                        onChange={(e) => setCenterBannerImageUrl(e.target.value || null)}
                                        placeholder="https://example.com/your-image.jpg"
                                        type="url"
                                      />
                                      <p className="text-xs text-gray-500">Use a high-quality image with good contrast</p>
                                    </div>
                                  ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-2">
                                        <Label className="text-xs text-gray-600">Start Color</Label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="color"
                                            value={centerBannerStartColor}
                                            onChange={(e) => setCenterBannerStartColor(e.target.value)}
                                            className="h-10 w-14 rounded-lg border border-gray-200 cursor-pointer"
                                          />
                                          <Input
                                            type="text"
                                            value={centerBannerStartColor}
                                            onChange={(e) => setCenterBannerStartColor(e.target.value)}
                                            className="flex-1 text-sm font-mono"
                                          />
                                        </div>
                                      </div>
                                      <div className="space-y-2">
                                        <Label className="text-xs text-gray-600">End Color</Label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="color"
                                            value={centerBannerEndColor}
                                            onChange={(e) => setCenterBannerEndColor(e.target.value)}
                                            className="h-10 w-14 rounded-lg border border-gray-200 cursor-pointer"
                                          />
                                          <Input
                                            type="text"
                                            value={centerBannerEndColor}
                                            onChange={(e) => setCenterBannerEndColor(e.target.value)}
                                            className="flex-1 text-sm font-mono"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Text Color */}
                                <div className="border-t border-gray-200 pt-4">
                                  <Label className="text-sm font-semibold text-gray-700 block mb-2">Text Color</Label>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setCenterBannerTextColor("white")}
                                      className={`flex-1 py-2 px-4 rounded-lg border transition-all ${
                                        centerBannerTextColor === "white"
                                          ? "border-purple-500 bg-purple-50"
                                          : "border-gray-200 bg-white hover:border-gray-300"
                                      }`}
                                    >
                                      <span className="flex items-center justify-center gap-2">
                                        <span className="w-4 h-4 rounded-full bg-white border border-gray-300" />
                                        <span className="text-sm font-medium">White</span>
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setCenterBannerTextColor("black")}
                                      className={`flex-1 py-2 px-4 rounded-lg border transition-all ${
                                        centerBannerTextColor === "black"
                                          ? "border-purple-500 bg-purple-50"
                                          : "border-gray-200 bg-white hover:border-gray-300"
                                      }`}
                                    >
                                      <span className="flex items-center justify-center gap-2">
                                        <span className="w-4 h-4 rounded-full bg-gray-900" />
                                        <span className="text-sm font-medium">Black</span>
                                      </span>
                                    </button>
                                  </div>
                                </div>

                                {/* Show Once Toggle */}
                                <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg border border-gray-200">
                                  <div>
                                    <span className="text-sm font-medium text-gray-700">Show once per session</span>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                      {centerBannerShowOnce 
                                        ? "Banner shows only once" 
                                        : "Shows on every page load"}
                                    </p>
                                  </div>
                                  <Switch
                                    checked={centerBannerShowOnce}
                                    onCheckedChange={setCenterBannerShowOnce}
                                  />
                                </div>
                              </div>

                              {/* Right Column - Live Preview */}
                              <div className="md:w-2/5">
                                <div 
                                  className="border border-gray-200 rounded-lg bg-gray-50 p-3 h-full"
                                  aria-label="Center banner preview"
                                >
                                  <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 block">Preview</Label>
                                  <div className="flex justify-center">
                                    <div className="w-[220px] h-[180px] bg-gray-800/80 rounded-lg flex items-center justify-center relative overflow-hidden">
                                      {/* Dimmed overlay background */}
                                      <div className="absolute inset-0 bg-black/50" />
                                      
                                      {/* Delay indicator badge */}
                                      <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 rounded-full px-2 py-0.5 shadow-sm z-20">
                                        <Clock className="w-2.5 h-2.5 text-purple-500" />
                                        <span className="text-[8px] text-purple-600 font-medium">After {centerBannerDelay}s</span>
                                      </div>
                                      
                                      {/* Banner card */}
                                      <div 
                                        className="relative z-10 w-[180px] rounded-lg p-3 text-center shadow-xl overflow-hidden"
                                        style={
                                          centerBannerBackgroundStyle === "image" && centerBannerImageUrl
                                            ? {
                                                backgroundImage: `url(${centerBannerImageUrl})`,
                                                backgroundSize: "cover",
                                                backgroundPosition: "center",
                                              }
                                            : { background: `linear-gradient(135deg, ${centerBannerStartColor}, ${centerBannerEndColor})` }
                                        }
                                      >
                                        {centerBannerBackgroundStyle === "image" && (
                                          <div className="absolute inset-0 bg-black/40" />
                                        )}
                                        <div className="relative z-10">
                                          <div className="mb-2 flex justify-center">
                                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                                              <MessageCircle className={`w-4 h-4 ${centerBannerTextColor === "black" ? "text-gray-900" : "text-white"}`} />
                                            </div>
                                          </div>
                                          <h3 className={`text-xs font-bold mb-1 truncate ${centerBannerTextColor === "black" ? "text-gray-900" : "text-white"}`}>
                                            {centerBannerTitle || "Need Help?"}
                                          </h3>
                                          <p className={`text-[9px] mb-2 line-clamp-2 ${centerBannerTextColor === "black" ? "text-gray-800" : "text-white/90"}`}>
                                            {centerBannerDescription || "Let me help you find exactly what you're looking for."}
                                          </p>
                                          <button className="bg-white text-gray-900 px-3 py-1 rounded-full font-semibold text-[9px] shadow-md">
                                            {centerBannerButtonText || "Start Chat"}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="pt-4 text-center py-8">
                              <p className="text-sm text-gray-500">Enable this banner to configure its appearance</p>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>

                  {/* Re-engagement Banner Section (Separate) */}
                  <Collapsible open={reengagementSectionOpen} onOpenChange={setReengagementSectionOpen}>
                    <Card className="border border-gray-200 bg-white shadow-sm">
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50/50 transition-colors">
                          <div className="flex items-center gap-3">
                            {reengagementSectionOpen ? (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-gray-400" />
                            )}
                            <RefreshCw className="w-5 h-5 text-purple-600" />
                            <div className="text-left">
                              <h3 className="text-base font-semibold text-gray-900">Re-engagement Banner</h3>
                              <p className="text-sm font-normal text-gray-500">Show a second banner after the first is dismissed</p>
                            </div>
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={reengagementBannerEnabled}
                              onCheckedChange={setReengagementBannerEnabled}
                            />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-6 pb-6 border-t border-gray-100">
                          {reengagementBannerEnabled ? (
                            <div className="pt-4 flex flex-col md:flex-row gap-4">
                              {/* Left Column - Settings */}
                              <div className="md:w-3/5 space-y-4">
                                {/* Delay Setting */}
                                <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg border border-gray-200">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-purple-600" />
                                    <span className="text-sm font-medium text-gray-700">Wait after dismissal</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <Slider
                                      value={[parseInt(reengagementBannerDelay) || 60]}
                                      onValueChange={(value) => setReengagementBannerDelay(value[0].toString())}
                                      min={30}
                                      max={180}
                                      step={5}
                                      className="w-32"
                                    />
                                    <span className="text-sm font-semibold text-purple-700 min-w-[50px] text-right">
                                      {reengagementBannerDelay}s
                                    </span>
                                  </div>
                                </div>

                                {/* Content Fields */}
                                <div className="grid gap-4">
                                  <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700">Title</Label>
                                    <Input
                                      value={reengagementBannerTitle}
                                      onChange={(e) => setReengagementBannerTitle(e.target.value)}
                                      placeholder="Still looking around?"
                                      maxLength={50}
                                    />
                                    <p className="text-xs text-gray-500">{reengagementBannerTitle.length}/50</p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700">Description</Label>
                                    <Textarea
                                      value={reengagementBannerDescription}
                                      onChange={(e) => setReengagementBannerDescription(e.target.value)}
                                      placeholder="I'm here whenever you're ready to chat!"
                                      maxLength={150}
                                      className="min-h-[60px] resize-none"
                                    />
                                    <p className="text-xs text-gray-500">{reengagementBannerDescription.length}/150</p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label className="text-sm font-semibold text-gray-700">Button Text</Label>
                                    <Input
                                      value={reengagementBannerButtonText}
                                      onChange={(e) => setReengagementBannerButtonText(e.target.value)}
                                      placeholder="Chat Now"
                                      maxLength={30}
                                    />
                                    <p className="text-xs text-gray-500">{reengagementBannerButtonText.length}/30</p>
                                  </div>
                                </div>

                                <p className="text-xs text-purple-600 bg-purple-50 border border-purple-200 p-3 rounded-lg">
                                  Uses the same visual style as the Center Banner above
                                </p>
                              </div>

                              {/* Right Column - Live Preview */}
                              <div className="md:w-2/5">
                                <div 
                                  className="border border-gray-200 rounded-lg bg-gray-50 p-3 h-full"
                                  aria-label="Re-engagement banner preview"
                                >
                                  <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 block">Preview</Label>
                                  <div className="flex justify-center">
                                    <div className="w-[220px] h-[180px] bg-gray-800/80 rounded-lg flex items-center justify-center relative overflow-hidden">
                                      {/* Dimmed overlay background */}
                                      <div className="absolute inset-0 bg-black/50" />
                                      
                                      {/* After dismissal label */}
                                      <div className="absolute top-2 left-2 flex items-center gap-1 bg-orange-100 rounded-full px-2 py-0.5 shadow-sm z-20">
                                        <RefreshCw className="w-2.5 h-2.5 text-orange-600" />
                                        <span className="text-[7px] text-orange-700 font-medium">After dismissal</span>
                                      </div>
                                      
                                      {/* Delay indicator badge */}
                                      <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 rounded-full px-2 py-0.5 shadow-sm z-20">
                                        <Clock className="w-2.5 h-2.5 text-purple-500" />
                                        <span className="text-[8px] text-purple-600 font-medium">+{reengagementBannerDelay}s</span>
                                      </div>
                                      
                                      {/* Banner card - uses same gradient as Center Banner */}
                                      <div 
                                        className="relative z-10 w-[180px] rounded-lg p-3 text-center shadow-xl overflow-hidden"
                                        style={{ background: `linear-gradient(135deg, ${centerBannerStartColor}, ${centerBannerEndColor})` }}
                                      >
                                        <div className="relative z-10">
                                          <div className="mb-2 flex justify-center">
                                            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                                              <RefreshCw className={`w-4 h-4 ${centerBannerTextColor === "black" ? "text-gray-900" : "text-white"}`} />
                                            </div>
                                          </div>
                                          <h3 className={`text-xs font-bold mb-1 truncate ${centerBannerTextColor === "black" ? "text-gray-900" : "text-white"}`}>
                                            {reengagementBannerTitle || "Still looking around?"}
                                          </h3>
                                          <p className={`text-[9px] mb-2 line-clamp-2 ${centerBannerTextColor === "black" ? "text-gray-800" : "text-white/90"}`}>
                                            {reengagementBannerDescription || "I'm here whenever you're ready to chat!"}
                                          </p>
                                          <button className="bg-white text-gray-900 px-3 py-1 rounded-full font-semibold text-[9px] shadow-md">
                                            {reengagementBannerButtonText || "Chat Now"}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="pt-4 text-center py-8">
                              <p className="text-sm text-gray-500">Enable this banner to configure its content</p>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                </div>
              </TabsContent>

              {/* Voice Tab */}
              <TabsContent value="voice" className="mt-4">
                {!settings?.voiceModeEnabled ? (
                  <Card className="shadow-lg border border-amber-200 bg-amber-50/50">
                    <CardContent className="pt-6">
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                          <Mic className="w-8 h-8 text-amber-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-amber-900 mb-2">
                          Voice Mode Not Available
                        </h3>
                        <p className="text-sm text-amber-800 max-w-md">
                          Voice mode features have not been enabled for your account. Please contact your administrator to enable voice mode access.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Left Column */}
                    <div className="space-y-4">
                  {/* Chat Modes - NEW SECTION AT TOP */}
                  <Card className="shadow-lg border border-gray-200 bg-white border-2 border-purple-200">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      🎯 Chat Modes
                    </CardTitle>
                    <CardDescription>Choose which interaction modes are available in your embedded chatbot</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <RadioGroup value={chatMode} onValueChange={setChatMode} className="space-y-3">
                      {[
                        { id: "both", label: "Both Chat & Voice", desc: "Users can type messages or use voice mode", emoji: "💬🎤", recommended: true },
                        { id: "chat-only", label: "Chat Only", desc: "Only text chat available - voice button hidden", emoji: "💬" },
                        { id: "voice-only", label: "Voice Only", desc: "Only voice mode available - chat input hidden", emoji: "🎤" },
                      ].map((mode) => (
                        <div 
                          key={mode.id}
                          className={`flex items-center space-x-3 rounded-xl border-2 p-4 transition-all cursor-pointer ${
                            chatMode === mode.id 
                              ? "border-purple-500 bg-purple-50/50 shadow-md ring-2 ring-purple-200" 
                              : "border-gray-200 hover:border-purple-300 bg-white"
                          }`}
                          onClick={() => setChatMode(mode.id)}
                        >
                          <RadioGroupItem 
                            value={mode.id} 
                            id={mode.id} 
                            className="mt-1 flex-shrink-0" 
                          />
                          <div className="flex-1">
                            <Label htmlFor={mode.id} className="font-semibold cursor-pointer text-base flex items-center gap-2">
                              <span>{mode.emoji}</span>
                              {mode.label}
                              {mode.recommended && (
                                <span className="text-xs font-normal text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                                  Recommended
                                </span>
                              )}
                            </Label>
                            <p className="text-sm text-gray-600 mt-1">{mode.desc}</p>
                          </div>
                        </div>
                      ))}
                    </RadioGroup>
                  </CardContent>
                </Card>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-4">
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      🎤 Voice Selection
                    </CardTitle>
                    <CardDescription>Choose Chroney's voice for voice mode conversations</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <RadioGroup value={voiceSelection} onValueChange={setVoiceSelection} className="space-y-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">OpenAI Voices</p>
                      {[
                        { id: "alloy", label: "Alloy", desc: "Neutral and balanced voice", gender: "Neutral" },
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
                      ].map((voice) => (
                        <div 
                          key={voice.id}
                          className={`flex items-start space-x-3 rounded-xl border-2 p-4 transition-all ${
                            voiceSelection === voice.id 
                              ? "border-purple-500 bg-purple-50/50 shadow-md" 
                              : "border-gray-200 hover:border-purple-300 bg-white"
                          }`}
                        >
                          <RadioGroupItem 
                            value={voice.id} 
                            id={voice.id} 
                            className="mt-1 cursor-pointer" 
                            onClick={() => setVoiceSelection(voice.id)}
                          />
                          <div className="flex-1 cursor-pointer" onClick={() => setVoiceSelection(voice.id)}>
                            <Label htmlFor={voice.id} className="font-semibold cursor-pointer text-base flex items-center gap-2">
                              {voice.label}
                              <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                {voice.gender}
                              </span>
                            </Label>
                            <p className="text-sm text-gray-600 mt-1">{voice.desc}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              playVoicePreview(voice.id);
                            }}
                            disabled={playingVoice !== null && playingVoice !== voice.id}
                            className={`p-2 rounded-lg transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed ${
                              playingVoice === voice.id 
                                ? "bg-purple-500 text-white shadow-lg" 
                                : "bg-gray-100 hover:bg-purple-100 text-gray-700 hover:text-purple-700"
                            }`}
                            title={playingVoice === voice.id ? "Stop preview" : "Play voice sample"}
                          >
                            {playingVoice === voice.id ? (
                              <Volume2 className="w-5 h-5 animate-pulse" />
                            ) : (
                              <Play className="w-5 h-5" />
                            )}
                          </button>
                        </div>
                      ))}
                      {settings?.hasElevenLabsKey && (
                      <ElevenLabsVoiceBrowser
                        voiceSelection={voiceSelection}
                        setVoiceSelection={setVoiceSelection}
                        playingVoice={playingVoice}
                        setPlayingVoice={setPlayingVoice}
                        currentAudio={currentAudio}
                        setCurrentAudio={setCurrentAudio}
                      />
                      )}
                    </RadioGroup>
                  </CardContent>
                </Card>

                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg flex items-center gap-2">
                      ✨ Voice Mode Style
                    </CardTitle>
                    <CardDescription>Choose the visual style of the voice mode orb</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <RadioGroup value={voiceModeStyle} onValueChange={setVoiceModeStyle} className="space-y-3">
                      {[
                        { id: "circular", label: "Circular", desc: "Perfect smooth circle - clean and minimalist", emoji: "⭕" },
                        { id: "morphing", label: "Morphing", desc: "Organic breathing effect - alive and dynamic", emoji: "💫" },
                        { id: "distorted", label: "Distorted", desc: "Wavy fluid blob - expressive and playful", emoji: "🌊" },
                        { id: "angular", label: "Angular", desc: "Sharp faceted shape - modern and geometric", emoji: "🔷" },
                        { id: "ocean-wave", label: "Ocean Wave", desc: "Flowing wave motion - natural and calming", emoji: "🌊" },
                        { id: "triangle", label: "Triangle", desc: "Dynamic pyramid shape - energetic and bold", emoji: "🔺" },
                        { id: "hexagon", label: "Hexagon", desc: "Technical honeycomb - precise and structured", emoji: "⬡" },
                        { id: "diamond", label: "Diamond", desc: "Brilliant faceted gem - premium and elegant", emoji: "💎" },
                        { id: "infinity", label: "Infinity Loop", desc: "Continuous figure-8 - flowing and endless", emoji: "∞" },
                      ].map((style) => {
                        // Get animation values based on style
                        const getPreviewAnimation = () => {
                          switch (style.id) {
                            case 'circular':
                              return '50%';
                            case 'morphing':
                              return ['50%', '48% 52%', '52% 48%', '50%'];
                            case 'distorted':
                              return ['50%', '42% 58%', '58% 42%', '46% 54%', '54% 46%', '50%'];
                            case 'angular':
                              return ['45%', '40%', '45%', '50%'];
                            case 'ocean-wave':
                              return ['50% 40% 60% 40%', '40% 60% 40% 60%', '60% 40% 50% 50%', '50% 40% 60% 40%'];
                            case 'triangle':
                              return ['20% 20% 50%', '25% 25% 45%', '20% 20% 50%', '25% 25% 45%'];
                            case 'hexagon':
                              return ['30%', '28%', '30%', '32%'];
                            case 'diamond':
                              return ['25%', '30%', '25%', '30%'];
                            case 'infinity':
                              return ['50% 30%', '30% 50%', '50% 30%', '30% 50%'];
                            default:
                              return '50%';
                          }
                        };

                        return (
                          <div 
                            key={style.id}
                            className={`flex items-center space-x-3 rounded-xl border-2 p-4 transition-all ${
                              voiceModeStyle === style.id 
                                ? "border-purple-500 bg-purple-50/50 shadow-md" 
                                : "border-gray-200 hover:border-purple-300 bg-white"
                            }`}
                          >
                            <RadioGroupItem 
                              value={style.id} 
                              id={style.id} 
                              className="mt-1 cursor-pointer flex-shrink-0" 
                              onClick={() => setVoiceModeStyle(style.id)}
                            />
                            <div className="flex-1 cursor-pointer" onClick={() => setVoiceModeStyle(style.id)}>
                              <Label htmlFor={style.id} className="font-semibold cursor-pointer text-base flex items-center gap-2">
                                <span>{style.emoji}</span>
                                {style.label}
                              </Label>
                              <p className="text-sm text-gray-600 mt-1">{style.desc}</p>
                            </div>
                            {/* Live Preview Orb */}
                            <motion.div
                              className="flex-shrink-0 w-12 h-12 rounded-full relative overflow-hidden"
                              style={{
                                background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`,
                              }}
                              animate={{
                                borderRadius: getPreviewAnimation(),
                                scale: [1, 1.05, 1],
                              }}
                              transition={{
                                borderRadius: {
                                  duration: 2,
                                  repeat: Infinity,
                                  ease: "easeInOut"
                                },
                                scale: {
                                  duration: 2,
                                  repeat: Infinity,
                                  ease: "easeInOut"
                                }
                              }}
                            >
                              {/* Glow effect */}
                              <div 
                                className="absolute inset-0 opacity-60" 
                                style={{
                                  background: 'radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, transparent 70%)',
                                  filter: 'blur(8px)',
                                }}
                              />
                            </motion.div>
                          </div>
                        );
                      })}
                    </RadioGroup>
                  </CardContent>
                </Card>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Avatar Tab */}
              <TabsContent value="avatar" className="space-y-4 mt-4">
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg">Chat Avatar</CardTitle>
                    <CardDescription>Choose an avatar for your AI assistant</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-6">
                    {/* No Avatar Option */}
                    <div 
                      onClick={() => {
                        setAvatarType("none");
                        setAvatarUrl(null);
                        avatarSelectionMutation.mutate({ avatarType: "none" });
                      }}
                      className={`relative cursor-pointer p-4 border-2 rounded-xl transition-all ${
                        avatarType === "none" 
                          ? "border-purple-500 bg-purple-50" 
                          : "border-gray-200 hover:border-purple-300 bg-white"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br ${
                          avatarType === "none" ? "from-purple-500 to-blue-500" : "from-gray-200 to-gray-300"
                        }`}>
                          <Sparkles className="w-8 h-8 text-white" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900">No Avatar</h4>
                          <p className="text-sm text-gray-600">Use the default Sparkles icon</p>
                        </div>
                        {avatarType === "none" && (
                          <Check className="w-6 h-6 text-purple-600" />
                        )}
                      </div>
                    </div>

                    {/* Preset Avatars */}
                    <div>
                      <Label className="text-sm font-semibold text-gray-700 mb-3 block">Preset Avatars</Label>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { type: "preset-female-1", label: "Female 1" },
                          { type: "preset-female-2", label: "Female 2" },
                          { type: "preset-female-3", label: "Female 3" },
                          { type: "preset-male-1", label: "Male 1" },
                          { type: "preset-male-2", label: "Male 2" },
                          { type: "preset-male-3", label: "Male 3" },
                        ].map((preset) => (
                          <div
                            key={preset.type}
                            onClick={() => {
                              setAvatarType(preset.type);
                              setAvatarUrl(null);
                              avatarSelectionMutation.mutate({ avatarType: preset.type });
                            }}
                            className={`relative cursor-pointer p-3 border-2 rounded-xl transition-all ${
                              avatarType === preset.type 
                                ? "border-purple-500 bg-purple-50" 
                                : "border-gray-200 hover:border-purple-300 bg-white"
                            }`}
                          >
                            <div className="flex flex-col items-center gap-2">
                              <div className="relative">
                                <img 
                                  src={`/avatars/avatar-${preset.type.replace('preset-', '')}.png`}
                                  alt={preset.label}
                                  className="w-16 h-16 rounded-full object-cover"
                                />
                                {avatarType === preset.type && (
                                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center">
                                    <Check className="w-4 h-4 text-white" />
                                  </div>
                                )}
                              </div>
                              <span className="text-xs font-medium text-gray-700">{preset.label}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Custom Avatar Upload & Gallery */}
                    <div>
                      <Label className="text-sm font-semibold text-gray-700 mb-3 block">Custom Avatars</Label>
                      
                      {/* Custom Avatars Gallery */}
                      {customAvatars.length > 0 && (
                        <div className="grid grid-cols-3 gap-3 mb-4">
                          {customAvatars.map((avatar, index) => (
                            <div
                              key={avatar.url}
                              className={`relative cursor-pointer p-3 border-2 rounded-xl transition-all group ${
                                avatarType === "custom" && avatarUrl === avatar.url
                                  ? "border-purple-500 bg-purple-50" 
                                  : "border-gray-200 hover:border-purple-300 bg-white"
                              }`}
                              onClick={() => {
                                setAvatarType("custom");
                                setAvatarUrl(avatar.url);
                                avatarSelectionMutation.mutate({ avatarType: "custom", avatarUrl: avatar.url });
                              }}
                            >
                              <div className="flex flex-col items-center gap-2">
                                <div className="relative">
                                  <img 
                                    src={avatar.url}
                                    alt={`Custom avatar ${index + 1}`}
                                    className="w-16 h-16 rounded-full object-cover"
                                  />
                                  {avatarType === "custom" && avatarUrl === avatar.url && (
                                    <div className="absolute -top-1 -right-1 w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center">
                                      <Check className="w-4 h-4 text-white" />
                                    </div>
                                  )}
                                  {/* Delete button */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAvatarToDelete(avatar.url);
                                    }}
                                    disabled={deletingAvatar === avatar.url}
                                    className="absolute -top-2 -left-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                                  >
                                    {deletingAvatar === avatar.url ? (
                                      <Loader2 className="w-3 h-3 text-white animate-spin" />
                                    ) : (
                                      <Trash2 className="w-3 h-3 text-white" />
                                    )}
                                  </button>
                                </div>
                                <span className="text-xs font-medium text-gray-700">Custom {index + 1}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Upload Button */}
                      <div className="p-4 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 hover:border-purple-400 transition-all">
                        <div className="flex items-center justify-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                            <Upload className="w-6 h-6 text-gray-500" />
                          </div>
                          <div className="flex-1">
                            <Input
                              type="file"
                              accept="image/jpeg,image/jpg,image/png,image/webp"
                              onChange={handleAvatarUpload}
                              className="hidden"
                              id="avatar-upload"
                              disabled={uploadingAvatar}
                            />
                            <Label
                              htmlFor="avatar-upload"
                              className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
                            >
                              {uploadingAvatar ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Uploading...
                                </>
                              ) : (
                                <>
                                  <Upload className="w-4 h-4" />
                                  Upload New Avatar
                                </>
                              )}
                            </Label>
                            <p className="text-xs text-gray-600 mt-2">
                              JPG, PNG, or WebP (max 5MB)
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Shopping Tab */}
              <TabsContent value="shopping" className="mt-4 space-y-4">
                {/* Product Carousel Card */}
                <Card className="shadow-md border border-gray-200 bg-white">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                          <ShoppingCart className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                          <CardTitle className="text-base">Product Carousel</CardTitle>
                          <CardDescription className="text-sm">Show featured products after the welcome message</CardDescription>
                        </div>
                      </div>
                      <Switch
                        checked={productCarouselEnabled}
                        onCheckedChange={(checked) => {
                          setProductCarouselEnabled(checked);
                          updateMutation.mutate({
                            productCarouselEnabled: checked ? 'true' : 'false'
                          });
                        }}
                      />
                    </div>
                  </CardHeader>
                  {productCarouselEnabled && (
                    <CardContent className="pt-0 space-y-4">
                      <div>
                        <Label htmlFor="carouselTitle" className="text-sm font-medium">Carousel Title</Label>
                        <Input
                          id="carouselTitle"
                          value={productCarouselTitle}
                          onChange={(e) => setProductCarouselTitle(e.target.value)}
                          onBlur={() => {
                            updateMutation.mutate({
                              productCarouselTitle: productCarouselTitle
                            });
                          }}
                          placeholder="Featured Products"
                          className="mt-1"
                        />
                      </div>
                      
                      <div className="p-3 bg-gray-50 rounded-lg border">
                        <p className="text-xs text-gray-600 mb-3">
                          {featuredProductIds.length > 0 
                            ? `Showing ${featuredProductIds.length} selected product(s). Remove all to use automatic selection.`
                            : 'Auto-selects up to 6 products with images. Or select specific products:'}
                        </p>
                        
                        <Label className="text-sm font-medium">Select Featured Products (max 6)</Label>
                        
                        {featuredProductIds.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2 mb-3">
                            {featuredProductIds.map(id => {
                              const product = allProducts?.find(p => p.id === id);
                              return (
                                <div key={id} className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${product ? 'bg-purple-100 text-purple-800' : 'bg-orange-100 text-orange-800'}`}>
                                  <span className="truncate max-w-[120px]">{product?.name || 'Unknown product'}</span>
                                  <button
                                    onClick={() => {
                                      const newIds = featuredProductIds.filter(pid => pid !== id);
                                      setFeaturedProductIds(newIds);
                                      updateMutation.mutate({ featuredProductIds: newIds });
                                    }}
                                    className={`rounded-full p-0.5 ${product ? 'hover:bg-purple-200' : 'hover:bg-orange-200'}`}
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        
                        {featuredProductIds.length < 6 && (
                          <div className="mt-2">
                            <Input
                              placeholder="Search products..."
                              value={productSearchQuery}
                              onChange={(e) => setProductSearchQuery(e.target.value)}
                              className="text-sm"
                            />
                            {productSearchQuery && (
                              <div className="max-h-40 overflow-y-auto border rounded-lg bg-white mt-2">
                                {allProducts
                                  ?.filter(p => 
                                    p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) &&
                                    !featuredProductIds.includes(p.id)
                                  )
                                  .slice(0, 10)
                                  .map(product => (
                                    <button
                                      key={product.id}
                                      onClick={() => {
                                        const newIds = [...featuredProductIds, product.id];
                                        setFeaturedProductIds(newIds);
                                        updateMutation.mutate({ featuredProductIds: newIds });
                                        setProductSearchQuery("");
                                      }}
                                      className="w-full flex items-center gap-2 p-2 hover:bg-gray-50 text-left text-sm border-b last:border-b-0"
                                    >
                                      {product.imageUrl && (
                                        <img src={product.imageUrl} alt="" className="w-8 h-8 object-cover rounded" />
                                      )}
                                      <span className="truncate">{product.name}</span>
                                    </button>
                                  ))}
                                {allProducts?.filter(p => 
                                  p.name.toLowerCase().includes(productSearchQuery.toLowerCase()) &&
                                  !featuredProductIds.includes(p.id)
                                ).length === 0 && (
                                  <p className="p-2 text-sm text-gray-500">No products found</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Quick Browse Buttons Card */}
                <Card className="shadow-md border border-gray-200 bg-white">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                          <MessageSquare className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <CardTitle className="text-base">Quick Browse Buttons</CardTitle>
                          <CardDescription className="text-sm">Add quick action buttons for common queries</CardDescription>
                        </div>
                      </div>
                      <Switch
                        checked={quickBrowseEnabled}
                        onCheckedChange={(checked) => {
                          setQuickBrowseEnabled(checked);
                          updateMutation.mutate({
                            quickBrowseEnabled: checked ? 'true' : 'false'
                          });
                        }}
                      />
                    </div>
                  </CardHeader>
                  {quickBrowseEnabled && (
                    <CardContent className="pt-0 space-y-3">
                      {quickBrowseButtons.map((btn, index) => (
                        <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                          <span className="flex-1 font-medium text-sm">{btn.label}</span>
                          <span className="text-xs text-gray-500 truncate max-w-[150px]">{btn.action}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newButtons = quickBrowseButtons.filter((_, i) => i !== index);
                              setQuickBrowseButtons(newButtons);
                              updateMutation.mutate({ quickBrowseButtons: newButtons });
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <Label className="text-xs">Button Label</Label>
                          <Input
                            value={newQuickBrowseLabel}
                            onChange={(e) => setNewQuickBrowseLabel(e.target.value)}
                            placeholder="e.g., View Rings"
                            className="mt-1"
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="text-xs">Query to Send</Label>
                          <Input
                            value={newQuickBrowseAction}
                            onChange={(e) => setNewQuickBrowseAction(e.target.value)}
                            placeholder="e.g., Show me your rings"
                            className="mt-1"
                          />
                        </div>
                        <Button
                          size="sm"
                          onClick={() => {
                            if (newQuickBrowseLabel && newQuickBrowseAction) {
                              const newButtons = [...quickBrowseButtons, { label: newQuickBrowseLabel, action: newQuickBrowseAction }];
                              setQuickBrowseButtons(newButtons);
                              updateMutation.mutate({ quickBrowseButtons: newButtons });
                              setNewQuickBrowseLabel("");
                              setNewQuickBrowseAction("");
                            }
                          }}
                          disabled={!newQuickBrowseLabel || !newQuickBrowseAction}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Product Comparison Card */}
                <Card className="shadow-md border border-gray-200 bg-white">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                          <GitCompare className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                          <CardTitle className="text-base">Product Comparison</CardTitle>
                          <CardDescription className="text-sm">Allow customers to compare up to 3 products side-by-side</CardDescription>
                        </div>
                      </div>
                      <Switch
                        checked={productComparisonEnabled}
                        onCheckedChange={(checked) => {
                          setProductComparisonEnabled(checked);
                          updateMutation.mutate({
                            productComparisonEnabled: checked ? 'true' : 'false'
                          });
                        }}
                      />
                    </div>
                  </CardHeader>
                </Card>

                {/* WhatsApp Ordering Card */}
                <Card className="shadow-md border border-gray-200 bg-white">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
                        </div>
                        <div>
                          <CardTitle className="text-base">WhatsApp Ordering</CardTitle>
                          <CardDescription className="text-sm">Enable one-tap WhatsApp ordering from product cards</CardDescription>
                        </div>
                      </div>
                      <Switch
                        checked={whatsappOrderEnabled}
                        onCheckedChange={(checked) => {
                          setWhatsappOrderEnabled(checked);
                          updateMutation.mutate({
                            whatsappOrderEnabled: checked ? 'true' : 'false'
                          });
                        }}
                      />
                    </div>
                  </CardHeader>
                  {whatsappOrderEnabled && (
                    <CardContent className="pt-0 space-y-4">
                      <div>
                        <Label htmlFor="whatsappNumber" className="text-sm font-medium">WhatsApp Number</Label>
                        <Input
                          id="whatsappNumber"
                          value={whatsappOrderNumber}
                          onChange={(e) => setWhatsappOrderNumber(e.target.value)}
                          onBlur={() => {
                            updateMutation.mutate({
                              whatsappOrderNumber: whatsappOrderNumber
                            });
                          }}
                          placeholder="+1234567890 (with country code)"
                          className="mt-1"
                        />
                        <p className="text-xs text-gray-500 mt-1">Enter your WhatsApp business number with country code</p>
                      </div>
                      <div>
                        <Label htmlFor="whatsappMessage" className="text-sm font-medium">Order Message Template</Label>
                        <Textarea
                          id="whatsappMessage"
                          value={whatsappOrderMessage}
                          onChange={(e) => setWhatsappOrderMessage(e.target.value)}
                          onBlur={() => {
                            updateMutation.mutate({
                              whatsappOrderMessage: whatsappOrderMessage
                            });
                          }}
                          placeholder="Hi, I'm interested in ordering {product_name} ({product_price})"
                          className="mt-1"
                          rows={2}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Placeholders: <code className="bg-gray-200 px-1 rounded">{'{product_name}'}</code>, <code className="bg-gray-200 px-1 rounded">{'{product_price}'}</code>
                        </p>
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Add to Cart Card */}
                <Card className="shadow-md border border-gray-200 bg-white">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                          <ShoppingCart className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <CardTitle className="text-base">Add to Cart Button</CardTitle>
                          <CardDescription className="text-sm">Show the Add to Cart button on product cards</CardDescription>
                        </div>
                      </div>
                      <Switch
                        checked={addToCartEnabled}
                        onCheckedChange={(checked) => {
                          setAddToCartEnabled(checked);
                          updateMutation.mutate({
                            addToCartEnabled: checked ? 'true' : 'false'
                          });
                        }}
                      />
                    </div>
                  </CardHeader>
                </Card>

                {/* Virtual Try-On */}
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-pink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div>
                          <CardTitle className="text-base">Virtual Try-On</CardTitle>
                          <CardDescription className="text-sm">Let customers see how products look on them using AI</CardDescription>
                        </div>
                      </div>
                      <Switch
                        checked={tryOnEnabled}
                        onCheckedChange={(checked) => {
                          setTryOnEnabled(checked);
                          updateMutation.mutate({
                            tryOnEnabled: checked ? 'true' : 'false'
                          });
                        }}
                      />
                    </div>
                  </CardHeader>
                  {tryOnEnabled && (
                    <CardContent className="border-t bg-pink-50/30 pt-4">
                      <p className="text-sm text-gray-600">
                        Customers can upload a selfie and see AI-generated previews of jewelry on themselves. 
                        Requires Nano Banana Pro API key configured in SuperAdmin settings.
                      </p>
                    </CardContent>
                  )}
                </Card>
              </TabsContent>

              {/* Embed Tab */}
              <TabsContent value="embed" className="mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                <Card className="shadow-lg border border-gray-200 bg-white">
                  <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                    <CardTitle className="text-lg">Website Integration</CardTitle>
                    <CardDescription>Add the widget to your website</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
                    <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4 border border-blue-200">
                      <div className="flex gap-3">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                            <Code2 className="w-5 h-5 text-blue-600" />
                          </div>
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900 mb-1">How to Install</h4>
                          <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                            <li>Copy the embed code below</li>
                            <li>Paste it before the closing &lt;/body&gt; tag in your HTML</li>
                            <li>The widget will appear automatically on your site</li>
                          </ol>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-semibold text-gray-700">Embed Code</Label>
                      <div className="relative">
                        <Textarea
                          value={embedCode}
                          readOnly
                          className="font-mono text-xs min-h-[220px] bg-gray-50 border-2 pr-4 resize-none"
                        />
                        <Button
                          onClick={handleCopy}
                          size="sm"
                          className="absolute top-3 right-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                        >
                          {copied ? (
                            <>
                              <Check className="w-4 h-4 mr-2" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4 mr-2" />
                              Copy Code
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {settings?.k12EducationEnabled && (
                      <div className="space-y-2 pt-6 mt-6 border-t border-gray-200">
                        <Label className="text-sm font-semibold text-gray-700">
                          Grade-Scoped Embed Code (Student Portals)
                        </Label>
                        <p className="text-xs text-gray-500">
                          Use this snippet inside your student portal. Replace the
                          <code className="mx-1 px-1 py-0.5 bg-gray-100 rounded">{`{{ student.* }}`}</code>
                          placeholders with the logged-in student's board, medium, grade, and subject
                          so the tutor only answers from that student's curriculum. All scope
                          attributes are required — <code className="mx-1 px-1 py-0.5 bg-gray-100 rounded">data-subject</code>
                          is mandatory and the tutor refuses to answer when it is missing.
                        </p>
                        <div className="relative">
                          <Textarea
                            value={k12EmbedCode}
                            readOnly
                            className="font-mono text-xs min-h-[180px] bg-gray-50 border-2 pr-4 resize-none"
                          />
                          <Button
                            onClick={handleCopyK12}
                            size="sm"
                            className="absolute top-3 right-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                          >
                            {k12Copied ? (
                              <>
                                <Check className="w-4 h-4 mr-2" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4 mr-2" />
                                Copy Code
                              </>
                            )}
                          </Button>
                        </div>

                        <div className="space-y-2 pt-6 mt-6 border-t border-dashed border-gray-200">
                          <Label className="text-sm font-semibold text-gray-700">
                            Secure Embed Code (Signed Token)
                          </Label>
                          <p className="text-xs text-gray-500">
                            For production, build a server-signed launch token on your portal and pass it as
                            <code className="mx-1 px-1 py-0.5 bg-gray-100 rounded">data-token</code>.
                            It seals board, medium, grade, subject, chapter (optional), studentId and name so they can't be tampered with
                            in the browser. When <strong>Require signed token</strong> is enabled in TopScholar admin,
                            this is the only accepted embed. See the integration guide in TopScholar admin for how to
                            sign the token.
                          </p>
                          <div className="relative">
                            <Textarea
                              value={k12SecureEmbedCode}
                              readOnly
                              className="font-mono text-xs min-h-[120px] bg-gray-50 border-2 pr-4 resize-none"
                            />
                            <Button
                              onClick={handleCopyK12Secure}
                              size="sm"
                              className="absolute top-3 right-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                            >
                              {k12SecureCopied ? (
                                <>
                                  <Check className="w-4 h-4 mr-2" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="w-4 h-4 mr-2" />
                                  Copy Code
                                </>
                              )}
                            </Button>
                          </div>
                        </div>

                        {/* Dev / Staging Embed Code */}
                        <div className="space-y-2 pt-6 mt-6 border-t border-dashed border-amber-200">
                          <div className="flex items-center gap-2">
                            <Label className="text-sm font-semibold text-amber-700">
                              Dev / Staging Embed Code
                            </Label>
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                              Dev only
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="ml-auto border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                              onClick={() => window.open("/widget-test/topscholar", "_blank", "noopener,noreferrer")}
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              Open Widget Tester
                            </Button>
                          </div>
                          <p className="text-xs text-gray-500">
                            The Widget Tester lets you paste a signed launch token and load the widget from this
                            dev server — no embed needed.
                          </p>
                          <p className="text-xs text-gray-500">
                            Same as the secure embed above but loads the widget from your dev server. Embed this on
                            your <strong>dev portal</strong> to test conversation sync, doubt escalation, and token
                            signing end-to-end before switching your production portal to the snippet above. Sign the
                            token exactly as you would for production — the same secret and format apply.
                          </p>
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-500 shrink-0">Dev server URL</label>
                            <input
                              type="text"
                              value={devServerUrl}
                              onChange={(e) => setDevServerUrl(e.target.value)}
                              placeholder="https://your-dev-server.example.com"
                              className="flex-1 text-xs font-mono border border-amber-200 rounded px-2 py-1 bg-amber-50 focus:outline-none focus:ring-1 focus:ring-amber-400"
                            />
                          </div>
                          <div className="relative">
                            <Textarea
                              value={k12DevSecureEmbedCode}
                              readOnly
                              className="font-mono text-xs min-h-[100px] bg-amber-50 border-2 border-amber-200 pr-4 resize-none"
                            />
                            <Button
                              onClick={handleCopyK12DevSecure}
                              size="sm"
                              className="absolute top-3 right-3 bg-amber-500 hover:bg-amber-600 text-white"
                            >
                              {k12DevSecureCopied ? (
                                <>
                                  <Check className="w-4 h-4 mr-2" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="w-4 h-4 mr-2" />
                                  Copy Code
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                  </div>
                </div>
              </TabsContent>
            </div>

            {/* Right Panel - Live Preview (Sticky) - Only show on Style and Avatar tabs */}
          {(activeTab === "appearance" || activeTab === "avatar") && (
          <div className="lg:sticky lg:top-40 h-fit">
            <Card className="shadow-xl border-gray-200/60 bg-white/80 backdrop-blur-sm overflow-hidden">
              <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Eye className="w-5 h-5 text-purple-600" />
                      Live Preview
                    </CardTitle>
                    <CardDescription className="mt-1">See your changes instantly</CardDescription>
                  </div>
                  <Monitor className="w-5 h-5 text-gray-400" />
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {/* Website mockup background */}
                <div className="bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 rounded-2xl p-8 min-h-[600px] relative border-2 border-gray-200/50 shadow-inner">
                  {/* Mockup website elements */}
                  <div className="space-y-3 mb-8 opacity-40">
                    <div className="h-8 bg-gray-300 rounded-lg w-3/4"></div>
                    <div className="h-4 bg-gray-300 rounded w-full"></div>
                    <div className="h-4 bg-gray-300 rounded w-5/6"></div>
                    <div className="h-32 bg-gray-300 rounded-xl w-full mt-4"></div>
                  </div>

                  {/* Chat Widget Preview */}
                  <div className="absolute bottom-8 right-8 space-y-4">
                    {/* Floating Chat Button */}
                    <div className="flex justify-end mb-4">
                      {buttonStyle === "circular" && (
                        <button 
                          className={`w-16 h-16 rounded-full shadow-2xl flex items-center justify-center text-white transition-all hover:scale-110 cursor-pointer ${
                            buttonAnimation === "bounce" ? "animate-bounce" : ""
                          }`}
                          style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                        >
                          {avatarType && avatarType !== 'none' ? (
                            <div className="w-14 h-14 rounded-full overflow-hidden">
                              <img 
                                src={avatarType === 'custom' ? (avatarUrl || '') : `/avatars/avatar-${avatarType.replace('preset-', '')}.png`}
                                alt="AI Assistant"
                                className="w-full h-full object-cover animate-avatar-pulse"
                              />
                            </div>
                          ) : (
                            <MessageCircle className="w-8 h-8" />
                          )}
                        </button>
                      )}
                      {buttonStyle === "rounded" && (
                        <button 
                          className={`w-16 h-16 rounded-2xl shadow-2xl flex items-center justify-center text-white transition-all hover:scale-110 cursor-pointer ${
                            buttonAnimation === "bounce" ? "animate-bounce" : ""
                          }`}
                          style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                        >
                          {avatarType && avatarType !== 'none' ? (
                            <div className="w-14 h-14 rounded-full overflow-hidden">
                              <img 
                                src={avatarType === 'custom' ? (avatarUrl || '') : `/avatars/avatar-${avatarType.replace('preset-', '')}.png`}
                                alt="AI Assistant"
                                className="w-full h-full object-cover animate-avatar-pulse"
                              />
                            </div>
                          ) : (
                            <MessageCircle className="w-8 h-8" />
                          )}
                        </button>
                      )}
                      {buttonStyle === "pill" && (
                        <div 
                          className={`rounded-full shadow-2xl flex items-center transition-all cursor-pointer ${
                            buttonAnimation === "bounce" ? "animate-bounce" : ""
                          }`}
                          style={{ 
                            background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`,
                            padding: '6px',
                            width: '280px'
                          }}
                        >
                          {avatarType && avatarType !== 'none' ? (
                            <div className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 border-2 border-amber-400 shadow-lg">
                              <img 
                                src={avatarType === 'custom' ? (avatarUrl || '') : `/avatars/avatar-${avatarType.replace('preset-', '')}.png`}
                                alt="AI Assistant"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                              <MessageCircle className="w-5 h-5 text-white" />
                            </div>
                          )}
                          <div className="flex-1 flex items-center bg-white rounded-full px-4 py-2 mx-2 gap-2">
                            <span className="flex-1 text-gray-400 text-sm animate-typing-text overflow-hidden whitespace-nowrap">Ask me anything</span>
                            <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center flex-shrink-0">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="19" x2="12" y2="5"></line>
                                <polyline points="5 12 12 5 19 12"></polyline>
                              </svg>
                            </div>
                          </div>
                        </div>
                      )}
                      {buttonStyle === "minimal" && (
                        <button 
                          className={`w-14 h-14 rounded-xl shadow-2xl flex items-center justify-center text-white transition-all hover:scale-110 cursor-pointer ${
                            buttonAnimation === "bounce" ? "animate-bounce" : ""
                          }`}
                          style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                        >
                          {avatarType && avatarType !== 'none' ? (
                            <div className="w-12 h-12 rounded-full overflow-hidden">
                              <img 
                                src={avatarType === 'custom' ? (avatarUrl || '') : `/avatars/avatar-${avatarType.replace('preset-', '')}.png`}
                                alt="AI Assistant"
                                className="w-full h-full object-cover animate-avatar-pulse"
                              />
                            </div>
                          ) : (
                            <MessageCircle className="w-7 h-7" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Chat Window Preview */}
                    <div className="bg-white rounded-2xl shadow-2xl w-[340px] border border-gray-200 overflow-hidden">
                      {/* Chat header */}
                      <div 
                        className="px-5 py-4 text-white flex items-center gap-3"
                        style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                      >
                        <div 
                          className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden bg-white/20"
                        >
                          {avatarType && avatarType !== 'none' ? (
                            <img 
                              src={avatarType === 'custom' ? (avatarUrl || '') : `/avatars/avatar-${avatarType.replace('preset-', '')}.png`}
                              alt="AI Assistant"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Sparkles className="w-6 h-6" />
                          )}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-bold text-lg">{widgetHeaderText}</h3>
                          <p className="text-sm flex items-center gap-2 opacity-90">
                            <span className="w-2 h-2 bg-green-300 rounded-full animate-pulse"></span>
                            Online
                          </p>
                        </div>
                      </div>

                      {/* Chat messages */}
                      <div className="p-4 space-y-3 bg-gray-50 min-h-[320px]">
                        {/* AI Welcome Message */}
                        <div className="flex gap-3 items-start">
                          <div 
                            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white shadow-md overflow-hidden"
                            style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                          >
                            {avatarType && avatarType !== 'none' ? (
                              <img 
                                src={avatarType === 'custom' ? (avatarUrl || '') : `/avatars/avatar-${avatarType.replace('preset-', '')}.png`}
                                alt="AI Assistant"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Sparkles className="w-5 h-5" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                              <p className="text-gray-800 leading-relaxed" style={{ fontSize: CHAT_FONT_SIZE_PX[chatFontSize] || CHAT_FONT_SIZE_PX.medium }}>
                                {welcomeMessageType === "ai_generated" 
                                  ? "Hello! 👋 I'm Chroney, your AI assistant. I can help you explore products, answer questions, and capture leads. How can I assist you?"
                                  : welcomeMessage || "Hi! How can I help you today?"}
                              </p>
                            </div>
                            <span className="text-xs text-gray-400 mt-1 block ml-1">Just now</span>
                          </div>
                        </div>

                        {/* Sample user message */}
                        <div className="flex gap-3 items-start justify-end">
                          <div className="text-right">
                            <div 
                              className="rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm text-white inline-block"
                              style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                            >
                              <p style={{ fontSize: CHAT_FONT_SIZE_PX[chatFontSize] || CHAT_FONT_SIZE_PX.medium }}>Tell me more!</p>
                            </div>
                            <span className="text-xs text-gray-400 mt-1 block mr-1">Just now</span>
                          </div>
                        </div>
                      </div>

                      {/* Chat input */}
                      <div className="p-4 bg-white border-t border-gray-200">
                        <div className="flex items-center gap-2 bg-gray-100 rounded-full px-4 py-3">
                          <input 
                            type="text" 
                            placeholder="Type a message..." 
                            className="bg-transparent text-sm flex-1 outline-none text-gray-600"
                            disabled
                          />
                          <button 
                            className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-all hover:scale-105 shadow-md"
                            style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          )}
          </div>
        </Tabs>
      </div>

      {/* Delete Avatar Confirmation Dialog */}
      <AlertDialog open={!!avatarToDelete} onOpenChange={(open) => !open && setAvatarToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Avatar</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this avatar? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (avatarToDelete) {
                  handleDeleteAvatar(avatarToDelete);
                  setAvatarToDelete(null);
                }
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
