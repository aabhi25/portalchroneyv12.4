import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  AlertCircle, Send, Loader2, Sparkles, Lock, Camera, X, Globe, 
  ChevronDown, MoreVertical, MessageSquarePlus, History, Scale, Image as ImageIcon, Briefcase, Mic
} from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import { ConversationStarters } from "@/components/ConversationStarters";
import { UrgencyOfferWidget } from "@/components/UrgencyOfferWidget";
import { useUrgencyOffer } from "@/hooks/useUrgencyOffer";
import { useToast } from "@/hooks/use-toast";
import { ResumeUploadProgress } from "@/components/ResumeUploadProgress";
import { ImageUploadProgress } from "@/components/ImageUploadProgress";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CurriculumMarkdownImage } from '@/components/CurriculumMarkdownImage';

const FormStep = lazy(() => import('@/components/FormStep').then(m => ({ default: m.FormStep })));
const AppointmentCalendar = lazy(() => import('@/components/AppointmentCalendar').then(m => ({ default: m.AppointmentCalendar })));
const VoiceMode = lazy(() => import('@/components/VoiceMode').then(m => ({ default: m.VoiceMode })));
const ProductCarousel = lazy(() => import('@/components/ProductCarousel').then(m => ({ default: m.ProductCarousel })));
const ProductComparisonView = lazy(() => import('@/components/ProductComparisonView').then(m => ({ default: m.ProductComparisonView })));
const JobCarousel = lazy(() => import('@/components/JobCarousel').then(m => ({ default: m.JobCarousel })));
const ChatMenuNavigation = lazy(() => import("@/components/ChatMenuNavigation").then(m => ({ default: m.ChatMenuNavigation })));

// Animated typing indicator with rotating messages
const TYPING_MESSAGES = [
  "Thinking...",
  "Finding the best answer...",
  "Almost there...",
];

const TypingIndicator = () => {
  const [messageIndex, setMessageIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false);
      setTimeout(() => {
        setMessageIndex((prev) => (prev + 1) % TYPING_MESSAGES.length);
        setIsVisible(true);
      }, 200);
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
        <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
      </div>
      <span 
        className={`text-sm text-gray-500 italic transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      >
        {TYPING_MESSAGES[messageIndex]}
      </span>
    </div>
  );
};

interface ProductPagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  hasMore: boolean;
}

interface AppointmentSlotsData {
  slots: Array<{
    date: string;
    time: string;
    available: boolean;
  }>;
  timezone: string;
  duration: number;
  serviceType?: string;
}

interface FormStepData {
  stepIndex: number;
  totalSteps: number;
  question: string;
  inputType: 'text' | 'number' | 'email' | 'phone' | 'date' | 'select' | 'multiselect';
  options?: string[];
  required?: boolean;
  placeholder?: string;
  journeyId?: string;
  conversationId?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  products?: any[];
  matchedProducts?: any[];
  pagination?: ProductPagination;
  searchQuery?: string;
  imageUrl?: string;
  appointmentSlots?: AppointmentSlotsData;
  jobs?: any[];
  applicantId?: string | null;
}

interface ConversationItem {
  id: string;
  preview: string;
  timestamp: Date;
  messageCount: number;
}

interface PublicChatData {
  businessAccount: {
    id: string;
    name: string;
    website: string;
    description: string;
  };
  websiteAnalysis: {
    analyzedContent: any;
  } | null;
  jobPortalEnabled?: boolean;
  k12EducationEnabled?: boolean;
  k12ImageUploadEnabled?: boolean;
  widgetSettings: {
    chatColor: string;
    chatColorEnd: string;
    widgetHeaderText: string;
    currency: string;
    avatarType?: string;
    avatarUrl?: string;
    conversationStarters?: string;
    conversationStartersEnabled?: string;
    languageSelectorEnabled?: string;
    availableLanguages?: string;
    quickBrowseEnabled?: string;
    quickBrowseButtons?: string;
    visualSearchEnabled?: string;
    productComparisonEnabled?: string;
    voiceModeEnabled?: string;
  } | null;
  hasPassword: boolean;
}

interface PublicMenuData {
  enabled: boolean;
}

const LANGUAGE_CONFIG: { [key: string]: { name: string; nativeName: string; flag: string } } = {
  'auto': { name: 'Auto Detect', nativeName: 'Auto', flag: '🌐' },
  'en': { name: 'English', nativeName: 'English', flag: '🇺🇸' },
  'hi': { name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  'kn': { name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳' },
  'ta': { name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  'te': { name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳' },
  'mr': { name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳' },
  'bn': { name: 'Bengali', nativeName: 'বাংলা', flag: '🇮🇳' },
  'gu': { name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳' },
  'ml': { name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳' },
  'pa': { name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
  'or': { name: 'Odia', nativeName: 'ଓଡ଼ିଆ', flag: '🇮🇳' },
  'as': { name: 'Assamese', nativeName: 'অসমীয়া', flag: '🇮🇳' },
  'ur': { name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰' },
  'ne': { name: 'Nepali', nativeName: 'नेपाली', flag: '🇳🇵' },
  'si': { name: 'Sinhala', nativeName: 'සිංහල', flag: '🇱🇰' },
  'es': { name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  'fr': { name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  'de': { name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  'it': { name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  'pt': { name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  'nl': { name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  'pl': { name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  'ru': { name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  'uk': { name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  'cs': { name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿' },
  'ro': { name: 'Romanian', nativeName: 'Română', flag: '🇷🇴' },
  'hu': { name: 'Hungarian', nativeName: 'Magyar', flag: '🇭🇺' },
  'el': { name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },
  'sv': { name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  'da': { name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  'no': { name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
  'fi': { name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  'tr': { name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  'ar': { name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' },
  'he': { name: 'Hebrew', nativeName: 'עברית', flag: '🇮🇱' },
  'fa': { name: 'Persian', nativeName: 'فارسی', flag: '🇮🇷' },
  'zh': { name: 'Chinese (Simplified)', nativeName: '简体中文', flag: '🇨🇳' },
  'zh-TW': { name: 'Chinese (Traditional)', nativeName: '繁體中文', flag: '🇹🇼' },
  'ja': { name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  'ko': { name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  'vi': { name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
  'th': { name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭' },
  'id': { name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩' },
  'ms': { name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾' },
  'tl': { name: 'Filipino', nativeName: 'Tagalog', flag: '🇵🇭' },
  'sw': { name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪' },
  'af': { name: 'Afrikaans', nativeName: 'Afrikaans', flag: '🇿🇦' },
  'am': { name: 'Amharic', nativeName: 'አማርኛ', flag: '🇪🇹' },
  'my': { name: 'Burmese', nativeName: 'ဗမာ', flag: '🇲🇲' },
  'km': { name: 'Khmer', nativeName: 'ភាសាខ្មែរ', flag: '🇰🇭' },
  'lo': { name: 'Lao', nativeName: 'ລາວ', flag: '🇱🇦' }
};

export default function PublicChat() {
  const [, params] = useRoute("/public-chat/:token");
  const token = params?.token;
  const { toast } = useToast();

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  
  const [selectedLanguage, setSelectedLanguage] = useState<string>('auto');
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [conversationsList, setConversationsList] = useState<ConversationItem[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  
  const [activeFormStep, setActiveFormStep] = useState<FormStepData | null>(null);
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);
  
  const [compareProducts, setCompareProducts] = useState<Set<string>>(new Set());
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [showComparisonView, setShowComparisonView] = useState(false);
  
  const [featuredProducts, setFeaturedProducts] = useState<any[]>([]);
  const [featuredProductsTitle, setFeaturedProductsTitle] = useState<string>('Featured Products');
  
  const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false);
  const [isMenuMode, setIsMenuMode] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const pendingResumeContextIdRef = useRef<string | null>(null);
  const [resumeUploadStage, setResumeUploadStage] = useState<'idle' | 'uploading' | 'analyzing' | 'matching'>('idle');
  const k12ImageInputRef = useRef<HTMLInputElement>(null);
  const pendingImageContextIdRef = useRef<string | null>(null);
  const pendingK12ImagePreviewRef = useRef<string | null>(null);
  // Persisted (server) URL of the uploaded K12 question image, sent with the
  // message so it is stored on the user message and survives reload.
  const pendingK12ImageUrlRef = useRef<string | null>(null);
  const [k12ImageUploadStage, setK12ImageUploadStage] = useState<'idle' | 'uploading' | 'reading' | 'ready'>('idle');
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const menuDropdownRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const conversationIdRef = useRef<string>('');
  const sendMessageRef = useRef<((msg?: string) => Promise<void>) | null>(null);
  const menuModeInitializedRef = useRef(false);

  const [isPasswordVerified, setIsPasswordVerified] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);

  const { data, isLoading: dataLoading, error } = useQuery<PublicChatData>({
    queryKey: [`/api/public-chat/${token}`],
    queryFn: async () => {
      return await apiRequest("GET", `/api/public-chat/${token}`);
    },
    enabled: !!token,
  });

  const businessAccountId = data?.businessAccount?.id;
  const chatColor = data?.widgetSettings?.chatColor || "#9333ea";
  const chatColorEnd = data?.widgetSettings?.chatColorEnd || "#3b82f6";
  const currency = data?.widgetSettings?.currency || "USD";
  const { data: menuData } = useQuery<PublicMenuData>({
    queryKey: ["/api/chat-menu/public", businessAccountId, token],
    queryFn: async () => {
      const params = new URLSearchParams({ businessAccountId: businessAccountId! });
      if (token) params.set("token", token);
      return await apiRequest("GET", `/api/chat-menu/public?${params.toString()}`);
    },
    enabled: !!businessAccountId && !!token && (!data?.hasPassword || isPasswordVerified),
  });
  const menuEnabled = menuData?.enabled === true;

  const {
    activeOffer,
    redeemOffer,
    dismissOffer,
    acknowledgeRedemption,
    checkMessageIntent,
  } = useUrgencyOffer({
    businessAccountId,
    sessionId: sessionIdRef.current,
    enabled: !!businessAccountId && messages.length >= 2,
  });

  const conversationStarters = data?.widgetSettings?.conversationStarters 
    ? (() => { try { return JSON.parse(data.widgetSettings.conversationStarters); } catch { return []; } })()
    : [];
  const showStarters = data?.widgetSettings?.conversationStartersEnabled !== 'false' && conversationStarters.length > 0;
  const userMessages = messages.filter(m => m.role === 'user');
  const shouldShowStarters = showStarters && userMessages.length === 0 && !isLoading;

  const languageSelectorEnabled = data?.widgetSettings?.languageSelectorEnabled !== 'false';
  const availableLanguages: string[] = data?.widgetSettings?.availableLanguages 
    ? (() => { try { return JSON.parse(data.widgetSettings.availableLanguages); } catch { return ['auto', 'en', 'hi', 'kn', 'ta', 'mr']; } })()
    : ['auto', 'en', 'hi', 'kn', 'ta', 'mr'];

  const visualSearchEnabled = data?.widgetSettings?.visualSearchEnabled === 'true';
  const productComparisonEnabled = data?.widgetSettings?.productComparisonEnabled === 'true';
  const voiceModeEnabled = data?.widgetSettings?.voiceModeEnabled === 'true';
  const jobPortalEnabled = data?.jobPortalEnabled === true;
  const k12ImageUploadEnabled = data?.k12EducationEnabled === true && data?.k12ImageUploadEnabled === true;

  const quickBrowseEnabled = data?.widgetSettings?.quickBrowseEnabled === 'true';
  const quickBrowseButtons = data?.widgetSettings?.quickBrowseButtons
    ? (() => { try { return JSON.parse(data.widgetSettings.quickBrowseButtons); } catch { return []; } })()
    : [];

  const currencySymbols: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹", AUD: "A$",
    CAD: "C$", CHF: "CHF", SEK: "kr", NZD: "NZ$", SGD: "S$", HKD: "HK$",
    NOK: "kr", MXN: "$", BRL: "R$", ZAR: "R", KRW: "₩", TRY: "₺",
    RUB: "₽", IDR: "Rp", THB: "฿", MYR: "RM"
  };
  const currencySymbol = currencySymbols[currency] || "$";

  useEffect(() => {
    if (token) {
      const verified = sessionStorage.getItem(`public-chat-verified-${token}`);
      if (verified === 'true') {
        setIsPasswordVerified(true);
      }
    }
  }, [token]);

  useEffect(() => {
    if (data && (!data.hasPassword || isPasswordVerified)) {
      loadIntroMessage();
    }
  }, [data, isPasswordVerified, selectedLanguage]);

  useEffect(() => {
    if (menuEnabled && !menuModeInitializedRef.current) {
      menuModeInitializedRef.current = true;
      setIsMenuMode(true);
    }
  }, [menuEnabled]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
      }
    };
    if (isLanguageDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isLanguageDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuDropdownRef.current && !menuDropdownRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const handleCompareToggle = (productId: string) => {
    setCompareProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else if (next.size < 3) {
        next.add(productId);
      }
      return next;
    });
    
    messages.forEach(msg => {
      const products = [...(msg.products || []), ...(msg.matchedProducts || [])];
      products.forEach(p => {
        if (p.id === productId && !allProducts.find(ap => ap.id === productId)) {
          setAllProducts(prev => [...prev, p]);
        }
      });
    });
  };

  const handleQuickBrowse = (action: string) => {
    if (sendMessageRef.current) {
      sendMessageRef.current(action);
    }
  };

  const handleNewChat = async () => {
    const newSessionId = crypto.randomUUID();
    sessionIdRef.current = newSessionId;
    conversationIdRef.current = '';
    
    setMessages([]);
    setIsMenuOpen(false);
    setCompareProducts(new Set());
    setAllProducts([]);
    setShowComparisonView(false);
    setActiveFormStep(null);
    setActiveJourneyId(null);
    if (menuEnabled) setIsMenuMode(true);
    
    await loadIntroMessage();
  };

  const loadConversationHistory = async () => {
    if (!token) return;
    
    setIsLoadingConversations(true);
    try {
      const response = await fetch(`/api/public-chat/${token}/conversations?sessionId=${encodeURIComponent(sessionIdRef.current)}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setConversationsList(data.conversations || []);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const handleOpenHistory = () => {
    setIsMenuOpen(false);
    setIsHistoryPanelOpen(true);
    loadConversationHistory();
  };

  const handleLoadConversation = async (convId: string) => {
    if (!token) return;
    
    try {
      const response = await fetch(`/api/public-chat/${token}/history?conversationId=${encodeURIComponent(convId)}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.messages && data.messages.length > 0) {
          const restoredMessages: ChatMessage[] = data.messages.map((msg: any) => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            imageUrl: msg.imageUrl || undefined,
            timestamp: new Date(msg.timestamp)
          }));
          setMessages(restoredMessages);
          
          if (data.conversationId) {
            conversationIdRef.current = data.conversationId;
          }
          
          setIsHistoryPanelOpen(false);
          toast({
            title: "Conversation Loaded",
            description: "Previous conversation restored",
          });
        }
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
      toast({
        title: "Error",
        description: "Failed to load conversation",
        variant: "destructive",
      });
    }
  };

  const verifyPassword = async () => {
    if (!passwordInput.trim() || !token) return;

    try {
      setIsVerifyingPassword(true);
      setPasswordError("");

      const response = await fetch(`/api/public-chat/${token}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
        credentials: 'include'
      });

      const result = await response.json();

      if (!response.ok || !result.verified) {
        setPasswordError("Incorrect password. Please try again.");
        return;
      }

      sessionStorage.setItem(`public-chat-verified-${token}`, 'true');
      setIsPasswordVerified(true);
      setPasswordInput("");
    } catch (error) {
      setPasswordError("Failed to verify password. Please try again.");
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  const handlePasswordKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      verifyPassword();
    }
  };

  const loadIntroMessage = async () => {
    if (!token) return;
    
    try {
      const langParam = selectedLanguage && selectedLanguage !== 'auto' ? `?language=${encodeURIComponent(selectedLanguage)}` : '';
      const response = await fetch(`/api/public-chat/${token}/intro${langParam}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const introData = await response.json();
      
      if (introData.formStep) {
        setActiveFormStep(introData.formStep);
        if (introData.journeyId) {
          setActiveJourneyId(introData.journeyId);
        }
      } else if (introData.intro) {
        setMessages([{
          id: '1',
          role: 'assistant',
          content: introData.intro,
          timestamp: new Date()
        }]);
      }
    } catch (error) {
      console.error('Failed to load intro:', error);
      setMessages([{
        id: '1',
        role: 'assistant',
        content: `Hey there! Welcome to ${data?.businessAccount.name}—happy to help you find exactly what you're looking for. 😊`,
        timestamp: new Date()
      }]);
    }
  };

  const animateTyping = (
    fullText: string, 
    messageId: string, 
    products?: any[], 
    pagination?: ProductPagination, 
    searchQuery?: string,
    appointmentSlots?: AppointmentSlotsData,
    jobsItems?: any[],
    jobsApplicantId?: string | null
  ) => {
    const words = fullText.split(' ');
    let currentIndex = 0;

    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { ...msg, content: '', products, pagination, searchQuery, appointmentSlots, jobs: jobsItems, applicantId: jobsApplicantId }
        : msg
    ));

    const typingInterval = setInterval(() => {
      if (currentIndex < words.length) {
        const currentText = words.slice(0, currentIndex + 1).join(' ');
        setMessages(prev => 
          prev.map(msg => 
            msg.id === messageId 
              ? { ...msg, content: currentText }
              : msg
          )
        );
        currentIndex++;
      } else {
        clearInterval(typingInterval);
        setStreamingMessageId(null);
      }
    }, 60);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file',
        description: 'Please select an image file',
        variant: 'destructive'
      });
      return;
    }

    setSelectedImage(file);
    const previewUrl = URL.createObjectURL(file);
    setImagePreviewUrl(previewUrl);
  };

  const handleResumeSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast({
        title: 'Invalid file',
        description: 'Please select a PDF file',
        variant: 'destructive'
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Resume must be under 10MB',
        variant: 'destructive'
      });
      return;
    }

    if (resumeUploadStage !== 'idle' || isLoading) return;

    try {
      setResumeUploadStage('uploading');

      const formData = new FormData();
      formData.append('resume', file);

      const response = await fetch(`/api/public-chat/${token}/resume-upload`, {
        method: 'POST',
        body: formData,
      });

      setResumeUploadStage('analyzing');

      let result: any;
      try {
        result = await response.json();
      } catch {
        throw new Error('Could not process your resume. Please try again.');
      }

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      if (result.status === 'failed' || !result.resumeContextId) {
        throw new Error(result.warning || 'Could not extract text from this resume. Please try a different file.');
      }

      if (result.warning) {
        toast({
          title: 'Resume processed with note',
          description: result.warning,
        });
      }

      setResumeUploadStage('matching');
      pendingResumeContextIdRef.current = result.resumeContextId;
      sendMessage(`[RESUME_UPLOAD] ${file.name}`);
    } catch (err: any) {
      setResumeUploadStage('idle');
      toast({
        title: 'Upload failed',
        description: err.message || 'Could not process your resume. Please try again.',
        variant: 'destructive'
      });
    }

    if (resumeInputRef.current) {
      resumeInputRef.current.value = '';
    }
  };

  const handleK12ImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      toast({ title: 'Invalid file', description: 'Please select a JPEG, PNG, or WebP image', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Image must be under 5MB', variant: 'destructive' });
      return;
    }
    if (k12ImageUploadStage !== 'idle' || isLoading) return;

    try {
      setK12ImageUploadStage('uploading');
      // Reset stale pending state from any prior upload so a failed/retried
      // upload can never carry a previous image's URL onto a later message.
      pendingK12ImageUrlRef.current = null;
      pendingImageContextIdRef.current = null;
      const previewUrl = URL.createObjectURL(file);
      pendingK12ImagePreviewRef.current = previewUrl;

      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`/api/public-chat/${token}/k12-image-upload`, { method: 'POST', body: formData });
      setK12ImageUploadStage('reading');

      let result: any;
      try { result = await response.json(); } catch { throw new Error('Could not process your image. Please try again.'); }

      if (!response.ok) throw new Error(result.error || 'Upload failed');
      if (result.status === 'failed' || !result.imageContextId) {
        throw new Error(result.warning || 'Could not read text from this image. Please try a clearer photo.');
      }

      pendingImageContextIdRef.current = result.imageContextId;
      if (typeof result.imageUrl === 'string' && result.imageUrl) {
        pendingK12ImageUrlRef.current = result.imageUrl;
      }
      setK12ImageUploadStage('ready');
      setTimeout(() => {
        if (sendMessageRef.current) sendMessageRef.current(`[IMAGE_UPLOAD] ${file.name}`);
      }, 600);
    } catch (err: any) {
      setK12ImageUploadStage('idle');
      pendingK12ImageUrlRef.current = null;
      pendingImageContextIdRef.current = null;
      pendingK12ImagePreviewRef.current = null;
      toast({ title: 'Upload failed', description: err.message || 'Could not process your image.', variant: 'destructive' });
    }

    if (k12ImageInputRef.current) k12ImageInputRef.current.value = '';
  };

  const clearSelectedImage = () => {
    setSelectedImage(null);
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadAndMatchImage = async () => {
    if (!selectedImage || !token) return;

    setIsUploadingImage(true);
    setIsLoading(true);

    try {
      const userMessageId = Date.now().toString();
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: 'Find products similar to this image',
        imageUrl: imagePreviewUrl || undefined,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);

      const formData = new FormData();
      formData.append('image', selectedImage);

      const uploadResponse = await fetch(`/api/public-chat/${token}/upload-image`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image');
      }

      const uploadResult = await uploadResponse.json();
      const uploadedImageUrl = uploadResult.imageUrl;

      setMessages(prev => prev.map(msg => 
        msg.id === userMessageId 
          ? { ...msg, imageUrl: uploadedImageUrl }
          : msg
      ));

      const aiMessageId = (Date.now() + 1).toString();
      setStreamingMessageId(aiMessageId);
      setMessages(prev => [...prev, {
        id: aiMessageId,
        role: 'assistant',
        content: 'Analyzing your image...',
        timestamp: new Date()
      }]);

      const matchResponse = await fetch(`/api/public-chat/${token}/match-products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: uploadedImageUrl }),
        credentials: 'include'
      });

      if (!matchResponse.ok) {
        throw new Error('Failed to find matching products');
      }

      const matchResult = await matchResponse.json();

      let matchedProducts = matchResult.matches || [];
      if (matchResult.exactMatch) {
        const exactMatchId = matchResult.exactMatch.id;
        const filteredMatches = matchedProducts.filter((m: any) => m.id !== exactMatchId);
        matchedProducts = [matchResult.exactMatch, ...filteredMatches];
      }
      
      let responseContent = '';
      if (matchResult.imageDescription) {
        responseContent = `I can see: ${matchResult.imageDescription}\n\n`;
      }

      if (matchedProducts.length > 0) {
        responseContent += `Here are some similar products from our catalog:`;
      } else {
        responseContent += "I couldn't find any matching products in our catalog. Would you like to describe what you're looking for?";
      }

      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId 
          ? { 
              ...msg, 
              content: responseContent,
              matchedProducts: matchedProducts
            }
          : msg
      ));

      setStreamingMessageId(null);
      clearSelectedImage();

    } catch (error: any) {
      console.error('[Image Match] Error:', error);
      toast({
        title: 'Image search failed',
        description: error.message || 'Failed to search for similar products',
        variant: 'destructive'
      });
    } finally {
      setIsUploadingImage(false);
      setIsLoading(false);
    }
  };

  const sendMessage = async (overrideMessage?: string) => {
    const messageToSend = overrideMessage ?? message;
    if (!messageToSend.trim() || isLoading || !token) return;
    const isResumeFlow = messageToSend.trim().startsWith('[RESUME_UPLOAD]');
    const isK12ImageFlow = messageToSend.trim().startsWith('[IMAGE_UPLOAD]');
    let resumeProgressCleared = false;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: messageToSend.trim(),
      timestamp: new Date(),
      ...(isK12ImageFlow && (pendingK12ImageUrlRef.current || pendingK12ImagePreviewRef.current) ? { imageUrl: pendingK12ImageUrlRef.current || pendingK12ImagePreviewRef.current || undefined } : {})
    };
    if (isK12ImageFlow) pendingK12ImagePreviewRef.current = null;

    setMessages(prev => [...prev, userMessage]);
    setMessage("");
    setIsLoading(true);
    
    checkMessageIntent(messageToSend.trim(), conversationIdRef.current || undefined);
    inputRef.current?.focus();

    const aiMessageId = (Date.now() + 1).toString();
    setStreamingMessageId(aiMessageId);
    setMessages(prev => [...prev, {
      id: aiMessageId,
      role: 'assistant',
      content: '.....',
      timestamp: new Date()
    }]);

    let productsData: any[] | undefined;
    let productsPagination: ProductPagination | undefined;
    let productsSearchQuery: string | undefined;
    let appointmentSlotsData: AppointmentSlotsData | undefined;
    let jobsDataItems: any[] | undefined;
    let jobsApplicantIdValue: string | null | undefined;

    try {
      const response = await fetch(`/api/public-chat/${token}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          message: userMessage.content,
          sessionId: sessionIdRef.current,
          language: selectedLanguage !== 'auto' ? selectedLanguage : undefined,
          resumeContextId: pendingResumeContextIdRef.current || undefined,
          imageContextId: pendingImageContextIdRef.current || undefined,
        }),
      });
      if (!response.ok) throw new Error('Chat request failed');
      pendingResumeContextIdRef.current = null;
      pendingImageContextIdRef.current = null;
      pendingK12ImageUrlRef.current = null;
      setK12ImageUploadStage('idle');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No response reader');

      let streamedContent = '';
      let buffer = '';
      let pendingUpdate = false;

      const updateStreamingMessage = () => {
        if (pendingUpdate) return;
        pendingUpdate = true;
        
        requestAnimationFrame(() => {
          setMessages(prev => {
            const filtered = prev.filter(m => m.id !== aiMessageId);
            return [...filtered, {
              id: aiMessageId,
              role: 'assistant',
              content: streamedContent,
              timestamp: new Date(),
              products: productsData
            }];
          });
          pendingUpdate = false;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') continue;

            try {
              const data = JSON.parse(jsonStr);
              if (data.type === 'conversation_id') {
                if (data.data) {
                  conversationIdRef.current = data.data;
                }
              } else if (data.type === 'content') {
                if (isResumeFlow && !resumeProgressCleared) {
                  resumeProgressCleared = true;
                  setResumeUploadStage('idle');
                }
                streamedContent += data.data;
                updateStreamingMessage();
              } else if (data.type === 'products') {
                const productResponse = JSON.parse(data.data);
                if (Array.isArray(productResponse)) {
                  productsData = productResponse;
                } else {
                  productsData = productResponse.items || [];
                  productsPagination = productResponse.pagination;
                  productsSearchQuery = productResponse.searchQuery;
                }
              } else if (data.type === 'appointment_slots') {
                appointmentSlotsData = JSON.parse(data.data);
                setMessages(prev => prev.map(msg => 
                  msg.id === aiMessageId 
                    ? { ...msg, appointmentSlots: appointmentSlotsData }
                    : msg
                ));
              } else if (data.type === 'jobs') {
                const jobsResponse = JSON.parse(data.data);
                jobsDataItems = jobsResponse.items || [];
                jobsApplicantIdValue = jobsResponse.applicantId || null;
                setMessages(prev => prev.map(msg =>
                  msg.id === aiMessageId
                    ? { ...msg, jobs: jobsDataItems, applicantId: jobsApplicantIdValue }
                    : msg
                ));
              } else if (data.type === 'form_step') {
                const formStepData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                setActiveFormStep(formStepData);
                if (formStepData.journeyId) {
                  setActiveJourneyId(formStepData.journeyId);
                }
                if (formStepData.conversationId) {
                  conversationIdRef.current = formStepData.conversationId;
                }
              } else if (data.type === 'final') {
                animateTyping(data.data, aiMessageId, productsData, productsPagination, productsSearchQuery, appointmentSlotsData, jobsDataItems, jobsApplicantIdValue);
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Chat error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      });
      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId 
          ? { ...msg, content: "Sorry, I'm having trouble connecting right now. Please try again." }
          : msg
      ));
    } finally {
      setIsLoading(false);
      setStreamingMessageId(null);
      if (isResumeFlow && !resumeProgressCleared) {
        setResumeUploadStage('idle');
      }
    }
  };

  sendMessageRef.current = sendMessage;

  const handleFormStepSubmit = async (value: string | string[]) => {
    if (!activeFormStep || !token) return;
    
    const displayValue = Array.isArray(value) ? value.join(', ') : value;
    
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: displayValue,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    
    const aiMessageId = (Date.now() + 1).toString();
    setStreamingMessageId(aiMessageId);
    setMessages(prev => [...prev, {
      id: aiMessageId,
      role: 'assistant',
      content: '.....',
      timestamp: new Date()
    }]);
    
    try {
      const response = await fetch(`/api/public-chat/${token}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: displayValue,
          sessionId: sessionIdRef.current,
          language: selectedLanguage !== 'auto' ? selectedLanguage : undefined,
          journeyId: activeJourneyId,
          conversationId: conversationIdRef.current
        })
      });
      
      if (!response.ok) throw new Error('Form submission failed');
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) throw new Error('No response reader');
      
      let streamedContent = '';
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') continue;
            
            try {
              const data = JSON.parse(jsonStr);
              if (data.type === 'content') {
                streamedContent += data.data;
                setMessages(prev => prev.map(msg => 
                  msg.id === aiMessageId ? { ...msg, content: streamedContent } : msg
                ));
              } else if (data.type === 'form_step') {
                const formStepData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                setActiveFormStep(formStepData);
              } else if (data.type === 'form_complete') {
                setActiveFormStep(null);
                setActiveJourneyId(null);
              } else if (data.type === 'final') {
                animateTyping(data.data, aiMessageId);
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Form submission error:', error);
      toast({
        title: "Error",
        description: "Failed to submit form response",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
      setStreamingMessageId(null);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleStarterSelect = (question: string) => {
    sendMessage(question);
  };

  const handleAppointmentSelect = async (slot: { date: string; time: string }) => {
    const confirmMessage = `I'd like to book the appointment on ${slot.date} at ${slot.time}`;
    await sendMessage(confirmMessage);
  };

  if (dataLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-blue-50 p-4">
        <div className="text-center w-full max-w-md mx-auto">
          <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground text-base">Loading chat...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-blue-50 p-4">
        <Card className="max-w-md w-full mx-auto">
          <CardHeader>
            <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-6 h-6 text-destructive" />
            </div>
            <CardTitle className="text-center">Chat Link Not Available</CardTitle>
            <CardDescription className="text-center">
              This chat link doesn't exist, has been disabled, or has expired
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (data.hasPassword && !isPasswordVerified) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30 p-4">
        <Card className="max-w-md w-full mx-auto shadow-2xl">
          <CardHeader className="space-y-4">
            <div 
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto shadow-md"
              style={{ background: `linear-gradient(135deg, ${chatColor} 0%, ${chatColorEnd} 100%)` }}
            >
              <Lock className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <CardTitle className="text-2xl mb-2">{data.businessAccount.name}</CardTitle>
              <CardDescription className="text-base">
                This chat is password protected. Please enter the password to continue.
              </CardDescription>
            </div>
          </CardHeader>
          <div className="px-6 pb-6 space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Enter password..."
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyPress={handlePasswordKeyPress}
                disabled={isVerifyingPassword}
                className="text-base"
              />
              {passwordError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {passwordError}
                </p>
              )}
            </div>
            <Button
              onClick={verifyPassword}
              disabled={isVerifyingPassword || !passwordInput.trim()}
              className="w-full text-white"
              size="lg"
              style={{ background: `linear-gradient(135deg, ${chatColor} 0%, ${chatColorEnd} 100%)` }}
            >
              {isVerifyingPassword ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Verifying...
                </>
              ) : (
                "Continue to Chat"
              )}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-0 sm:p-6">
      <div className="w-full max-w-3xl h-screen sm:h-[min(760px,calc(100vh-3rem))] flex flex-col bg-white sm:rounded-2xl border-0 sm:border sm:border-slate-200 shadow-none sm:shadow-2xl overflow-hidden relative">
        {/* Header */}
        <div 
          className="flex-shrink-0 shadow-lg"
          style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
        >
          <div className="px-3 py-2 flex items-center gap-2 text-white">
            <div className="w-7 h-7 rounded-full flex items-center justify-center overflow-hidden bg-white/20">
              {data?.widgetSettings?.avatarType && data.widgetSettings.avatarType !== 'none' ? (
                <img 
                  src={data.widgetSettings.avatarType === 'custom' ? data.widgetSettings.avatarUrl : `/avatars/avatar-${data.widgetSettings.avatarType.replace('preset-', '')}.png`}
                  alt="AI Assistant"
                  className="w-full h-full object-cover"
                />
              ) : (
                <img src="/c_logo.png" alt="AI Chroney" className="w-5 h-5 object-contain" />
              )}
            </div>
            <div className="flex-1">
              <h1 className="font-semibold text-base truncate">
                {data.widgetSettings?.widgetHeaderText || data.businessAccount.name}
              </h1>
            </div>
            
            {/* Language Selector */}
            {languageSelectorEnabled && availableLanguages.length > 1 && (
              <div className="relative" ref={languageDropdownRef}>
                <button
                  onClick={() => setIsLanguageDropdownOpen(!isLanguageDropdownOpen)}
                  className="px-2 py-1 rounded-md hover:bg-white/20 transition-colors flex items-center gap-1 text-sm"
                  aria-label="Select language"
                >
                  <span>{LANGUAGE_CONFIG[selectedLanguage]?.nativeName || 'Auto'}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${isLanguageDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {isLanguageDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 max-h-80 overflow-y-auto">
                    {availableLanguages.map((langCode) => {
                      const lang = LANGUAGE_CONFIG[langCode];
                      if (!lang) return null;
                      return (
                        <button
                          key={langCode}
                          onClick={() => {
                            setSelectedLanguage(langCode);
                            setIsLanguageDropdownOpen(false);
                          }}
                          className={`w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3 ${
                            selectedLanguage === langCode ? 'bg-gray-50' : ''
                          }`}
                        >
                          <span className="text-lg">{lang.flag}</span>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{lang.name}</div>
                            <div className="text-xs text-gray-500">{lang.nativeName}</div>
                          </div>
                          {selectedLanguage === langCode && (
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: chatColor }}></div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {voiceModeEnabled && (
              <button
                onClick={() => setIsVoiceModeOpen(true)}
                className="p-1 rounded-full hover:bg-white/20 transition-colors"
                aria-label="Voice mode"
                title="Voice mode"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
            
            {/* Menu Dropdown */}
            <div className="relative" ref={menuDropdownRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-1 rounded-full hover:bg-white/20 transition-colors"
                aria-label="Menu"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              
              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
                  <button
                    onClick={handleNewChat}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                  >
                    <MessageSquarePlus className="w-4 h-4" />
                    <span>New Chat</span>
                  </button>
                  <button
                    onClick={handleOpenHistory}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 text-gray-700"
                  >
                    <History className="w-4 h-4" />
                    <span>Chat History</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {isMenuMode && menuEnabled && !activeFormStep ? (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>}>
              <ChatMenuNavigation
                businessAccountId={businessAccountId!}
                publicChatToken={token}
                chatColor={chatColor}
                chatColorEnd={chatColorEnd}
                avatarUrl={data?.widgetSettings?.avatarType && data.widgetSettings.avatarType !== 'none'
                  ? (data.widgetSettings.avatarType === 'custom'
                    ? data.widgetSettings.avatarUrl
                    : `/avatars/avatar-${data.widgetSettings.avatarType.replace('preset-', '')}.png`)
                  : undefined}
                selectedLanguage={selectedLanguage}
                pageUrl={new URLSearchParams(window.location.search).get('sourceUrl') || new URLSearchParams(window.location.search).get('parentUrl') || window.location.href}
                conversationId={conversationIdRef.current || undefined}
                onSwitchToChat={() => setIsMenuMode(false)}
                onSendMessage={(menuMessage) => {
                  setIsMenuMode(false);
                  window.setTimeout(() => sendMessage(menuMessage), 0);
                }}
                onStartJourney={async (journeyId) => {
                  try {
                    const response = await fetch(`/api/journey/${journeyId}/first-step?businessAccountId=${encodeURIComponent(businessAccountId!)}`);
                    if (!response.ok) return;
                    const journey = await response.json();
                    if (journey.formStep) {
                      setMessages([]);
                      setActiveJourneyId(journeyId);
                      setActiveFormStep(journey.formStep);
                      setIsMenuMode(false);
                    }
                  } catch (error) {
                    console.error("Failed to start menu journey:", error);
                  }
                }}
              />
            </Suspense>
          </div>
        ) : (
          <>
        {menuEnabled && (
          <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center">
            <button
              onClick={() => setIsMenuMode(true)}
              className="flex items-center gap-1.5 text-sm font-medium hover:opacity-80 transition-opacity"
              style={{ color: chatColor }}
            >
              <span aria-hidden="true">←</span>
              Back to Menu
            </button>
          </div>
        )}

        {/* Chat Messages */}
        <div 
          ref={messagesContainerRef}
          className={`flex-1 overflow-y-auto overflow-x-hidden bg-white min-h-0 ${activeFormStep ? 'hidden' : ''}`}
        >
          <div className="p-4 space-y-4">
            {/* Featured Products Carousel */}
            {featuredProducts.length > 0 && userMessages.length === 0 && !activeFormStep && (
              <Suspense fallback={<div className="h-32 animate-pulse bg-gray-100 rounded-lg" />}>
                <ProductCarousel
                  products={featuredProducts}
                  title={featuredProductsTitle}
                  currencySymbol={currencySymbol}
                  chatColor={chatColor}
                />
              </Suspense>
            )}
            
            {/* Conversation Starters */}
            <ConversationStarters
              starters={conversationStarters}
              onSelect={handleStarterSelect}
              chatColor={chatColor}
              chatColorEnd={chatColorEnd}
              show={shouldShowStarters && !activeFormStep}
            />

            {/* Quick Browse Buttons */}
            {quickBrowseEnabled && quickBrowseButtons.length > 0 && userMessages.length === 0 && !activeFormStep && (
              <div className="flex flex-wrap gap-2 justify-center">
                {quickBrowseButtons.map((btn: { label: string; action: string }, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => handleQuickBrowse(btn.action)}
                    className="px-4 py-2 rounded-full text-sm font-medium border transition-all hover:scale-105"
                    style={{ 
                      borderColor: chatColor,
                      color: chatColor,
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            )}
            
            {messages.map((msg, msgIndex) => {
              const lastUserMsg = messages.slice(0, msgIndex).filter(m => m.role === 'user').at(-1)?.content || '';
              return (
              <div key={msg.id} data-message-id={msg.id}>
                {msg.role === 'assistant' ? (
                  <div className={`flex gap-3 items-start ${(msg.products && msg.products.length > 0) || (msg.matchedProducts && msg.matchedProducts.length > 0) || (msg.jobs && msg.jobs.length > 0) ? 'w-full' : 'max-w-[85%]'}`}>
                    <div 
                      className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-md overflow-hidden"
                      style={{ background: `linear-gradient(135deg, ${chatColor} 0%, ${chatColorEnd} 100%)` }}
                    >
                      {data?.widgetSettings?.avatarType && data.widgetSettings.avatarType !== 'none' ? (
                        <img 
                          src={data.widgetSettings.avatarType === 'custom' ? data.widgetSettings.avatarUrl : `/avatars/avatar-${data.widgetSettings.avatarType.replace('preset-', '')}.png`}
                          alt="AI Assistant"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Sparkles className={`w-4 h-4 text-white ${streamingMessageId === msg.id && msg.content === '.....' ? 'animate-spin' : ''}`} />
                      )}
                    </div>
                    <div className="flex-1 space-y-3">
                      <Card className="bg-white shadow-md border-slate-200">
                        <div className="p-4">
                          {msg.content === '.....' ? (
                            <TypingIndicator />
                          ) : (
                            <div className="text-slate-800 leading-relaxed prose prose-sm max-w-none prose-p:mb-2 prose-p:last:mb-0 prose-strong:font-semibold prose-em:italic">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                  ul: ({ children }) => <ul className="mb-2 pl-4 list-disc">{children}</ul>,
                                  ol: ({ children }) => <ol className="mb-2 pl-4 list-decimal">{children}</ol>,
                                  li: ({ children }) => <li className="mb-1">{children}</li>,
                                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                                  em: ({ children }) => <em className="italic">{children}</em>,
                                  img: ({ src, alt }) => (
                                    <CurriculumMarkdownImage
                                      src={typeof src === 'string' ? src : undefined}
                                      alt={alt || 'curriculum image'}
                                      loading="lazy"
                                      className="my-2 max-w-full h-auto rounded-lg border border-slate-200"
                                    />
                                  ),
                                }}
                              >
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      </Card>
                      
                      {/* Appointment Calendar */}
                      {msg.appointmentSlots && (
                        <Suspense fallback={<div className="h-48 animate-pulse bg-gray-100 rounded-lg" />}>
                          <AppointmentCalendar
                            slots={msg.appointmentSlots.slots}
                            timezone={msg.appointmentSlots.timezone}
                            duration={msg.appointmentSlots.duration}
                            onSelect={handleAppointmentSelect}
                            chatColor={chatColor}
                          />
                        </Suspense>
                      )}
                      
                      {/* Products */}
                      {msg.products && msg.products.length > 0 && (
                        <ProductCard
                          products={msg.products}
                          currencySymbol={currencySymbol}
                          pagination={msg.pagination}
                          searchQuery={msg.searchQuery}
                          businessAccountId={businessAccountId}
                          userMessage={lastUserMsg}
                          onCompareToggle={productComparisonEnabled ? handleCompareToggle : undefined}
                          compareProducts={compareProducts}
                        />
                      )}
                      
                      {/* Matched Products (from image search) */}
                      {msg.matchedProducts && msg.matchedProducts.length > 0 && (
                        <ProductCard
                          products={msg.matchedProducts}
                          currencySymbol={currencySymbol}
                          businessAccountId={businessAccountId}
                          userMessage={lastUserMsg}
                          onCompareToggle={productComparisonEnabled ? handleCompareToggle : undefined}
                          compareProducts={compareProducts}
                        />
                      )}

                      {msg.jobs && msg.jobs.length > 0 && (
                        <Suspense fallback={<div className="h-20 animate-pulse bg-gray-100 rounded-lg" />}>
                          <JobCarousel
                            jobs={msg.jobs}
                            chatColor={chatColor}
                            applicantId={msg.applicantId}
                            onApply={(jobId, appId, jobTitle) => {
                              if (sendMessageRef.current) {
                                sendMessageRef.current(`[JOB_APPLY] ${jobTitle} |jobId:${jobId}|applicantId:${appId}`);
                              }
                            }}
                          />
                        </Suspense>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] space-y-2">
                      {msg.imageUrl && !msg.content.startsWith('[IMAGE_UPLOAD]') && (
                        <div className="flex justify-end">
                          <img 
                            src={msg.imageUrl} 
                            alt="Uploaded" 
                            className="max-w-[200px] max-h-[200px] rounded-lg object-cover shadow-md"
                          />
                        </div>
                      )}
                      <div 
                        className="px-4 py-3 rounded-2xl shadow-md text-white"
                        style={{ background: `linear-gradient(135deg, ${chatColor} 0%, ${chatColorEnd} 100%)` }}
                      >
                        {msg.content.startsWith('[RESUME_UPLOAD]') ? (
                          <div className="flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-90">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                              <line x1="16" y1="13" x2="8" y2="13"/>
                              <line x1="16" y1="17" x2="8" y2="17"/>
                              <polyline points="10 9 9 9 8 9"/>
                            </svg>
                            <span className="font-medium">{msg.content.replace('[RESUME_UPLOAD] ', '')} uploaded</span>
                          </div>
                        ) : msg.content.startsWith('[JOB_APPLY]') ? (
                          <div className="flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-90">
                              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                            </svg>
                            <span className="font-medium">Applying for {msg.content.replace(/^\[JOB_APPLY\]\s*/, '').replace(/\s*\|jobId:.*$/, '')}</span>
                          </div>
                        ) : msg.content.startsWith('[IMAGE_UPLOAD]') ? (
                          <div className="flex flex-col gap-1">
                            {msg.imageUrl ? (
                              <img
                                src={msg.imageUrl}
                                alt="Uploaded question"
                                className="max-w-[220px] rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => setExpandedImageUrl(msg.imageUrl || null)}
                              />
                            ) : (
                              <div className="flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-90">
                                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 0 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                  <circle cx="12" cy="13" r="4"/>
                                </svg>
                                <span className="font-medium">{msg.content.replace('[IMAGE_UPLOAD] ', '')} uploaded</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ); })}
            {resumeUploadStage !== 'idle' && (
              <div className="flex items-start gap-2 px-3 pb-2">
                <div className="flex-1 max-w-[85%]">
                  <ResumeUploadProgress stage={resumeUploadStage} chatColor={chatColor} />
                </div>
              </div>
            )}
            {k12ImageUploadStage !== 'idle' && (
              <div className="flex items-start gap-2 px-3 pb-2">
                <div className="flex-1 max-w-[85%]">
                  <ImageUploadProgress stage={k12ImageUploadStage} chatColor={chatColor} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Journey step UI
            An active journey takes over the public chat content area. Keeping
            the form outside the message list prevents conversation starters
            and old chat content from competing with the question. */}
        {activeFormStep && (
          <div className="flex-1 min-h-0 overflow-y-auto bg-white px-3 py-4 sm:px-5 sm:py-6 flex items-center">
            <div className="w-full max-w-2xl mx-auto">
              <Suspense fallback={<div className="h-24 animate-pulse bg-gray-100 rounded-2xl" />}>
                <FormStep
                  step={activeFormStep}
                  onSubmit={handleFormStepSubmit}
                  isLoading={isLoading}
                  primaryColor={chatColor}
                />
              </Suspense>
            </div>
          </div>
        )}

        {/* Image Preview */}
        {!activeFormStep && imagePreviewUrl && (
          <div className="flex-shrink-0 border-t bg-gray-50 px-6 py-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <img 
                  src={imagePreviewUrl} 
                  alt="Selected" 
                  className="w-20 h-20 rounded-lg object-cover border"
                />
                <button
                  onClick={clearSelectedImage}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Button
                onClick={uploadAndMatchImage}
                disabled={isUploadingImage}
                style={{ background: `linear-gradient(135deg, ${chatColor} 0%, ${chatColorEnd} 100%)` }}
                className="text-white"
              >
                {isUploadingImage ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Searching...
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-4 h-4 mr-2" />
                    Find Similar Products
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Input Area */}
        {!activeFormStep && (
          <div className="flex-shrink-0 border-t border-gray-200 bg-gray-100">
            <div className="p-2 sm:p-3 md:p-4">
              <div className="flex gap-2 items-center">
                {/* Visual Search Button */}
                {visualSearchEnabled && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors"
                      title="Search with image"
                    >
                      <Camera className="w-5 h-5 text-gray-600" />
                    </button>
                  </>
                )}

                {jobPortalEnabled && (
                  <>
                    <input
                      ref={resumeInputRef}
                      type="file"
                      accept="application/pdf"
                      onChange={handleResumeSelect}
                      className="hidden"
                    />
                    <button
                      onClick={() => resumeInputRef.current?.click()}
                      className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors"
                      title="Upload Resume (PDF)"
                    >
                      <Briefcase className="w-5 h-5 text-gray-600" />
                    </button>
                  </>
                )}

                {k12ImageUploadEnabled && (
                  <>
                    <input
                      ref={k12ImageInputRef}
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={handleK12ImageSelect}
                      className="hidden"
                    />
                    <button
                      onClick={() => k12ImageInputRef.current?.click()}
                      disabled={isLoading || k12ImageUploadStage !== 'idle'}
                      className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 transition-colors disabled:opacity-50"
                      title="Upload a photo of your question"
                    >
                      <Camera className="w-5 h-5 text-gray-600" />
                    </button>
                  </>
                )}
                
                <Input
                  ref={inputRef}
                  placeholder="Ask me anything..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  readOnly={isLoading}
                  className="flex-1 text-base border-slate-300 focus:border-purple-500"
                />
                <Button
                  onClick={() => sendMessage()}
                  disabled={isLoading || !message.trim()}
                  size="lg"
                  className="text-white shadow-md"
                  style={{ background: `linear-gradient(135deg, ${chatColor} 0%, ${chatColorEnd} 100%)` }}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Product Comparison Floating Button */}
        {productComparisonEnabled && compareProducts.size > 0 && !showComparisonView && (
          <button
            onClick={() => setShowComparisonView(true)}
            className="absolute bottom-24 right-6 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg text-white font-medium transition-all hover:scale-105"
            style={{ background: `linear-gradient(135deg, ${chatColor} 0%, ${chatColorEnd} 100%)` }}
          >
            <Scale className="w-5 h-5" />
            Compare ({compareProducts.size})
          </button>
        )}

        {/* Product Comparison View */}
        {showComparisonView && (
          <Suspense fallback={<div className="fixed inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-white" /></div>}>
            <ProductComparisonView
              products={allProducts.filter(p => compareProducts.has(p.id))}
              currencySymbol={currencySymbol}
              onClose={() => setShowComparisonView(false)}
              onRemove={(productId) => {
                setCompareProducts(prev => {
                  const next = new Set(prev);
                  next.delete(productId);
                  return next;
                });
              }}
              chatColor={chatColor}
            />
          </Suspense>
        )}

        {/* Conversation History Panel */}
        {isHistoryPanelOpen && (
          <div className="absolute inset-0 z-50 flex">
            <div 
              className="flex-1 bg-black/50"
              onClick={() => setIsHistoryPanelOpen(false)}
            />
            <div className="w-80 bg-white shadow-2xl flex flex-col">
              <div 
                className="px-4 py-3 border-b flex items-center justify-between"
                style={{ background: `linear-gradient(135deg, ${chatColor} 0%, ${chatColorEnd} 100%)` }}
              >
                <h3 className="font-semibold text-white">Chat History</h3>
                <button
                  onClick={() => setIsHistoryPanelOpen(false)}
                  className="p-1 hover:bg-white/20 rounded text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {isLoadingConversations ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : conversationsList.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No previous conversations</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {conversationsList.map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => handleLoadConversation(conv.id)}
                        className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                      >
                        <p className="text-sm font-medium text-gray-900 truncate">{conv.preview}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(conv.timestamp).toLocaleDateString()} · {conv.messageCount} messages
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Voice Mode */}
        {voiceModeEnabled && isVoiceModeOpen && (
          <Suspense fallback={<div className="fixed inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-white" /></div>}>
            <VoiceMode
              onClose={() => setIsVoiceModeOpen(false)}
              onSendMessage={sendMessage}
              chatColor={chatColor}
            />
          </Suspense>
        )}

        {/* Urgency Offer Widget */}
        {activeOffer && (
          <UrgencyOfferWidget
            offer={activeOffer}
            onRedeem={(phone) => redeemOffer(phone, conversationIdRef.current || undefined)}
            onDismiss={dismissOffer}
            onAcknowledge={acknowledgeRedemption}
            chatColor={chatColor}
          />
        )}

        {/* Lightbox for expanded K12 image */}
        {expandedImageUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setExpandedImageUrl(null)}
          >
            <img
              src={expandedImageUrl}
              alt="Question (expanded)"
              className="max-w-full max-h-full rounded-xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/70 transition-colors"
              onClick={() => setExpandedImageUrl(null)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
