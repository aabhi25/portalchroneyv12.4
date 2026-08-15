import { Sparkles, Zap, Send, Loader2, X, Mic, ChevronDown, Camera, ImageIcon, MoreVertical, MessageSquarePlus, History, ChevronLeft, GitCompare, Briefcase, Lock } from "lucide-react";
import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ProductCard } from "@/components/ProductCard";
import { KaraokeText } from "@/components/KaraokeText";
import { OrderStatusCard, normalizeOrder } from "@/components/OrderStatusCard";
import type { NormalizedOrder } from "@/components/OrderStatusCard";
import { OrderDetailOverlay } from "@/components/OrderDetailOverlay";
import { ConversationStarters } from "@/components/ConversationStarters";
import { ChatImageCropOverlay } from "@/components/ChatImageCropOverlay";
import { TryOnOverlay } from "@/components/TryOnOverlay";
import { useUrgencyOffer } from "@/hooks/useUrgencyOffer";
import { QuickBrowseButtons } from "@/components/QuickBrowseButtons";
import { ResumeUploadProgress } from "@/components/ResumeUploadProgress";
import { ImageUploadProgress } from "@/components/ImageUploadProgress";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { convertLatexDelimiters } from '@/lib/convertLatexDelimiters';

// Lazy-loaded components for optional features (reduces initial bundle)
const VoiceMode = lazy(() => import("@/components/VoiceMode").then(m => ({ default: m.VoiceMode })));
const InlineVoiceMode = lazy(() => import("@/components/InlineVoiceMode").then(m => ({ default: m.InlineVoiceMode })));

const AppointmentCalendar = lazy(() => import("@/components/AppointmentCalendar").then(m => ({ default: m.AppointmentCalendar })));
const FormStep = lazy(() => import("@/components/FormStep").then(m => ({ default: m.FormStep })));
const ProductCarousel = lazy(() => import("@/components/ProductCarousel").then(m => ({ default: m.ProductCarousel })));
const ProductComparisonView = lazy(() => import("@/components/ProductComparisonView").then(m => ({ default: m.ProductComparisonView })));
const ChatMenuNavigation = lazy(() => import("@/components/ChatMenuNavigation").then(m => ({ default: m.ChatMenuNavigation })));
const JobCarousel = lazy(() => import("@/components/JobCarousel").then(m => ({ default: m.JobCarousel })));

// Loading fallback for lazy components
const LazyLoadingFallback = () => (
  <div className="flex items-center justify-center p-4">
    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
  </div>
);

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

// Language configuration with names in their native script (50+ languages)
const LANGUAGE_CONFIG: Record<string, { name: string; nativeName: string; shortLabel: string }> = {
  auto: { name: 'Auto-detect', nativeName: 'Auto', shortLabel: 'Auto' },
  en: { name: 'English', nativeName: 'English', shortLabel: 'Eng' },
  hi: { name: 'Hindi', nativeName: 'हिंदी', shortLabel: 'Hind' },
  hinglish: { name: 'Hinglish', nativeName: 'Hinglish', shortLabel: 'Hing' },
  kn: { name: 'Kannada', nativeName: 'ಕನ್ನಡ', shortLabel: 'Kann' },
  ta: { name: 'Tamil', nativeName: 'தமிழ்', shortLabel: 'Tam' },
  mr: { name: 'Marathi', nativeName: 'मराठी', shortLabel: 'Mar' },
  te: { name: 'Telugu', nativeName: 'తెలుగు', shortLabel: 'Tel' },
  bn: { name: 'Bengali', nativeName: 'বাংলা', shortLabel: 'Beng' },
  gu: { name: 'Gujarati', nativeName: 'ગુજરાતી', shortLabel: 'Guj' },
  ml: { name: 'Malayalam', nativeName: 'മലയാളം', shortLabel: 'Mal' },
  pa: { name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', shortLabel: 'Punj' },
  ur: { name: 'Urdu', nativeName: 'اردو', shortLabel: 'Urdu' },
  or: { name: 'Odia', nativeName: 'ଓଡ଼ିଆ', shortLabel: 'Odia' },
  as: { name: 'Assamese', nativeName: 'অসমীয়া', shortLabel: 'Asm' },
  ne: { name: 'Nepali', nativeName: 'नेपाली', shortLabel: 'Nep' },
  es: { name: 'Spanish', nativeName: 'Español', shortLabel: 'Esp' },
  fr: { name: 'French', nativeName: 'Français', shortLabel: 'Fra' },
  de: { name: 'German', nativeName: 'Deutsch', shortLabel: 'Deu' },
  pt: { name: 'Portuguese', nativeName: 'Português', shortLabel: 'Port' },
  it: { name: 'Italian', nativeName: 'Italiano', shortLabel: 'Ita' },
  ar: { name: 'Arabic', nativeName: 'العربية', shortLabel: 'Arab' },
  zh: { name: 'Chinese', nativeName: '中文', shortLabel: '中文' },
  ja: { name: 'Japanese', nativeName: '日本語', shortLabel: '日本' },
  ko: { name: 'Korean', nativeName: '한국어', shortLabel: '한국' },
  ru: { name: 'Russian', nativeName: 'Русский', shortLabel: 'Рус' },
  th: { name: 'Thai', nativeName: 'ไทย', shortLabel: 'ไทย' },
  vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt', shortLabel: 'Việt' },
  id: { name: 'Indonesian', nativeName: 'Bahasa Indonesia', shortLabel: 'Indo' },
  ms: { name: 'Malay', nativeName: 'Bahasa Melayu', shortLabel: 'Mly' },
  tr: { name: 'Turkish', nativeName: 'Türkçe', shortLabel: 'Türk' },
};

interface ProductPagination {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
  showing: number;
}

interface AppointmentSlotsData {
  slots: Record<string, string[]>;
  durationMinutes: number;
}

interface FormStepData {
  stepId: string;
  questionText: string;
  questionType: string;
  isRequired: boolean;
  options?: string[];
  placeholder?: string;
  stepType?: string;
  completionButtonText?: string;
  journeyId?: string;
  conversationId?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  products?: any[];
  productPagination?: ProductPagination;
  productSearchQuery?: string;
  imageUrl?: string;
  matchedProducts?: any[];
  imageDescription?: string;
  appointmentSlots?: AppointmentSlotsData;
  formStep?: FormStepData;
  tryOnResult?: string;
  jobs?: any[];
  applicantId?: string | null;
  orders?: any[];
  lookupOptions?: boolean;
  lookupMode?: 'track' | 'return_exchange';
  quickReplies?: string[];
}

interface WidgetSettings {
  id: string;
  businessAccountId: string;
  chatColor: string;
  chatColorEnd: string;
  widgetHeaderText: string;
  welcomeMessageType: string;
  welcomeMessage: string;
  buttonStyle: string;
  buttonAnimation: string;
  personality: string;
  currency: string;
  voiceModeEnabled?: boolean;
  visualSearchEnabled?: boolean;
  voiceModeStyle?: string;
  chatMode?: string;
  avatarType?: string;
  avatarUrl?: string;
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
  languageSelectorEnabled?: string;
  availableLanguages?: string;
  productCarouselEnabled?: string;
  productCarouselTitle?: string;
  quickBrowseEnabled?: string;
  quickBrowseButtons?: string | { label: string; action: string }[];
  productComparisonEnabled?: string;
  whatsappOrderEnabled?: string;
  whatsappOrderNumber?: string;
  whatsappOrderMessage?: string;
  addToCartEnabled?: string;
  chatFontSize?: string;
  footerLabelEnabled?: string;
  footerLabelText?: string;
  poweredByEnabled?: string;
  jobPortalEnabled?: boolean;
  k12EducationEnabled?: boolean;
  k12ImageUploadEnabled?: boolean;
  // Task #23: pre-chat OTP gate — when true, the widget shows a phone-entry
  // modal that blocks the chat composer until the visitor verifies their
  // mobile via OTP. phoneValidation drives client-side digit-count check
  // (server re-validates on /otp/start).
  requirePreChatOtp?: boolean;
  phoneValidation?: '10' | '12' | '8-12' | 'any';
  // Task #3: OTP delivery channels available to this visitor and which one
  // should be preselected. Empty array when gate is inactive.
  otpChannels?: Array<'sms' | 'whatsapp'>;
  defaultOtpChannel?: 'sms' | 'whatsapp';
  // Demo/sample OTP: when true, the OTP modal shows a hint that the fixed
  // sample code is accepted (no real SMS is sent). For client demos only.
  otpDemoActive?: boolean;
  // Pre-chat CAPTCHA gate (mutually exclusive with OTP). When true, the widget
  // shows a phone-entry + reCAPTCHA v2 modal that blocks the chat until the
  // visitor passes the challenge. captchaSiteKey is the public reCAPTCHA site
  // key (safe to expose); the secret key stays server-side.
  requirePreChatCaptcha?: boolean;
  // True when CAPTCHA was selected by the admin but the site/secret key is not
  // configured. The gate stays active (chat locked) and the widget shows a
  // "verification unavailable" notice instead of silently unlocking.
  captchaMisconfigured?: boolean;
  captchaProvider?: 'recaptcha_v2';
  captchaSiteKey?: string;
  createdAt: string;
  updatedAt: string;
}

// Helper functions for visitor tracking
const getDeviceInfo = () => {
  const ua = navigator.userAgent;
  
  // Detect device type
  let deviceType = 'desktop';
  if (/Mobi|Android/i.test(ua)) {
    deviceType = /Tablet|iPad/i.test(ua) ? 'tablet' : 'mobile';
  }
  
  // Detect browser
  let browser = 'Unknown';
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('SamsungBrowser')) browser = 'Samsung';
  else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera';
  else if (ua.includes('Trident')) browser = 'IE';
  else if (ua.includes('Edge')) browser = 'Edge';
  else if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';
  
  // Detect OS
  let os = 'Unknown';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  
  return { deviceType, browser, os, userAgent: ua };
};

const getUTMParams = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get('utm_source') || undefined,
    utmMedium: params.get('utm_medium') || undefined,
    utmCampaign: params.get('utm_campaign') || undefined,
  };
};

type OtpStateSnapshot = {
  awaiting_otp: boolean;
  locked: boolean;
  phone_masked?: string | null;
  attempts_remaining?: number | null;
  resends_remaining?: number | null;
  resend_available_at?: string | null;
  locked_until?: string | null;
  expires_at?: string | null;
};

export default function EmbedChat() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [otpState, setOtpState] = useState<OtpStateSnapshot>({ awaiting_otp: false, locked: false });
  const [otpLockRemaining, setOtpLockRemaining] = useState(0);
  // Task #19: OTP modal owns its own input + error + busy state so the
  // composer's `message` state and the AI chat stream are never involved.
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpResending, setOtpResending] = useState(false);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const [otpStatus, setOtpStatus] = useState<string | null>(null);
  // Task #23: pre-chat OTP gate — phone-entry modal state. Shown when
  // settings.requirePreChatOtp is true AND no conversation has started yet
  // AND no OTP challenge is active. On submit we POST /otp/start which
  // creates the conversation server-side, sets conversationIdRef, and
  // transitions otpState→awaiting_otp so the existing OTP modal takes over.
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  // Task #3: visitor's chosen OTP delivery channel. Lazy-initialised from
  // settings.defaultOtpChannel once settings load (effect below). Null until
  // settings arrive so we don't lock in 'sms' before knowing if that's even
  // available for this business.
  const [selectedOtpChannel, setSelectedOtpChannel] = useState<'sms' | 'whatsapp' | null>(null);
  // Channel the LAST OTP was actually sent through (per server response).
  // Drives the "Code sent via X" subtitle + "try [other] instead" CTA.
  const [lastDeliveryChannel, setLastDeliveryChannel] = useState<'sms' | 'whatsapp' | null>(null);
  // Tracks conversationIdRef in state-form so the phone-entry modal closes
  // immediately on /otp/start success (refs alone don't trigger re-renders).
  const [hasConversation, setHasConversation] = useState(false);
  // Task #23: when /otp/start returns { gate: false } (admin disabled OTP
  // after the widget cached settings, or MSG91 became unconfigured), we
  // suppress the phone-entry modal for the rest of this session so the
  // visitor can chat normally instead of being stranded behind a stale gate.
  const [preChatGateDisabled, setPreChatGateDisabled] = useState(false);
  // Task #23: explicit "this visitor has cleared the pre-chat OTP gate" flag.
  // We CANNOT key the gate on `hasConversation` alone because /otp/start
  // creates the conversation BEFORE the OTP is verified — using
  // hasConversation would unlock all the gated surfaces (intro, menu,
  // transcript) as soon as the phone modal is submitted, well before the
  // visitor has actually entered their code. This flag flips true only on
  // successful /otp/verify (or when a restored conversation is already past
  // verification — i.e. has prior messages and no awaiting_otp/locked state).
  const [preChatOtpVerified, setPreChatOtpVerified] = useState(false);
  const otpInputRef = useRef<HTMLInputElement | null>(null);

  // Pre-chat CAPTCHA gate state (mutually exclusive with OTP).
  // captchaToken: the reCAPTCHA v2 response token from the visitor's checkbox.
  // preChatCaptchaVerified: flips true on a successful /captcha/verify.
  // preChatCaptchaGateDisabled: suppresses the modal when the server reports the
  //   gate is no longer active (admin disabled CAPTCHA after settings cached).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [preChatCaptchaVerified, setPreChatCaptchaVerified] = useState(false);
  const [preChatCaptchaGateDisabled, setPreChatCaptchaGateDisabled] = useState(false);
  const [captchaSubmitting, setCaptchaSubmitting] = useState(false);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = useRef<number | null>(null);

  // Mid-chat CAPTCHA gate state (captureStrategy custom/intent/keyword). Unlike
  // the pre-chat gate (driven by cached widget-settings), this is driven by a
  // `captcha_state` SSE event the server emits when it refuses the model because
  // the conversation is awaiting_verification. siteKey/provider/misconfigured
  // ride on the event so the widget can render the checkbox without relying on
  // the pre-chat settings (which only carry start-strategy keys).
  const [midChatCaptcha, setMidChatCaptcha] = useState<{
    required: boolean;
    siteKey: string | null;
    provider: 'recaptcha_v2' | null;
    misconfigured: boolean;
  }>({ required: false, siteKey: null, provider: null, misconfigured: false });

  // Map OTP error reasons to user-facing copy.
  const otpReasonToMessage = (reason: string | undefined | null): string => {
    switch (reason) {
      case 'wrong_code': return 'That code didn\'t match. Please check and try again.';
      case 'expired': return 'This code has expired. Tap Resend to get a new one.';
      case 'no_active_challenge': return 'This verification is no longer active. Tap Resend to get a new code.';
      case 'locked': return 'Too many incorrect attempts. Verification is temporarily locked.';
      case 'invalid_format': return 'Please enter the 6-digit code.';
      case 'cooldown': return 'Please wait a moment before requesting another code.';
      case 'max_resends': return 'You\'ve reached the maximum number of resends. Please try again later.';
      case 'send_failed': return 'We couldn\'t send the code. Please try again in a moment.';
      default: return 'Something went wrong. Please try again.';
    }
  };

  // Tick down resend cooldown (independent of lockout countdown).
  useEffect(() => {
    if (otpResendCooldown <= 0) return;
    const t = setInterval(() => {
      setOtpResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [otpResendCooldown]);

  // Clear modal-local state when the OTP step ends (verified or no longer awaiting).
  useEffect(() => {
    if (!otpState.awaiting_otp && !otpState.locked) {
      setOtpInput("");
      setOtpError(null);
      setOtpStatus(null);
      setOtpSubmitting(false);
      setOtpResending(false);
      setOtpResendCooldown(0);
    }
  }, [otpState.awaiting_otp, otpState.locked]);

  // Initialize resend cooldown from the server-provided resend_available_at
  // so the button is correctly disabled if the modal re-opens or the snapshot
  // changes (e.g., page refresh mid-cooldown).
  useEffect(() => {
    if (!otpState.resend_available_at) return;
    const secs = Math.max(0, Math.ceil((new Date(otpState.resend_available_at).getTime() - Date.now()) / 1000));
    setOtpResendCooldown(prev => (secs > prev ? secs : prev));
  }, [otpState.resend_available_at]);

  // Tick down the lockout countdown each second
  useEffect(() => {
    if (!otpState.locked || otpLockRemaining <= 0) return;
    const t = setInterval(() => {
      setOtpLockRemaining(prev => {
        const next = Math.max(0, prev - 1);
        if (next === 0) setOtpState(s => ({ ...s, locked: false, awaiting_otp: false }));
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [otpState.locked, otpLockRemaining]);

  type LookupPhase =
    | { phase: 'idle' }
    | { phase: 'input'; type: 'mobile' | 'email' | 'order'; messageId: string }
    | { phase: 'otp'; type: 'mobile' | 'email'; value: string; messageId: string; error: boolean };
  const [lookupState, setLookupState] = useState<LookupPhase>({ phase: 'idle' });
  const [lookupInputValue, setLookupInputValue] = useState('');
  const [lookupOtpValue, setLookupOtpValue] = useState('');
  const lookupReturnExchangeContextRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false);
  const [isInlineVoiceActive, setIsInlineVoiceActive] = useState(false);
  const inlineVoiceAIMessagesRef = useRef<Map<string, string>>(new Map());
  // Karaoke highlight for the bubble currently being spoken aloud in inline
  // voice mode: which bubble, and how many characters the audio clock says
  // have been heard. Null when nothing is playing.
  const [voiceHighlight, setVoiceHighlight] = useState<{ messageId: string; offset: number } | null>(null);
  // The raw spoken transcript per voice bubble. Kept separately from
  // inlineVoiceAIMessagesRef because formatted_transcript may overwrite the
  // bubble's content with Markdown *while the answer is still playing* —
  // the highlight offset is only meaningful against the raw spoken text.
  const voiceSpokenTextRef = useRef<Map<string, string>>(new Map());
  const [selectedLanguage, setSelectedLanguage] = useState<string>('auto');
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showCropOverlay, setShowCropOverlay] = useState(false);
  const [pendingSearchImageUrl, setPendingSearchImageUrl] = useState<string | null>(null);
  const [showTryOnOverlay, setShowTryOnOverlay] = useState(false);
  const [tryOnProduct, setTryOnProduct] = useState<{imageUrl: string; name: string; type?: string} | null>(null);
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const [visitorSessionId, setVisitorSessionId] = useState<string | null>(null);
  const [parentPageUrl, setParentPageUrl] = useState<string | null>(null);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [conversationsList, setConversationsList] = useState<Array<{id: string; title: string; updatedAt: string; messageCount: number}>>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [activeFormStep, setActiveFormStep] = useState<FormStepData | null>(null);
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);
  const [isFormJourneyComplete, setIsFormJourneyComplete] = useState(false); // Track when form journey is complete - disables chat input
  const [introLoaded, setIntroLoaded] = useState(false); // Track when intro has been fetched
  const [compareProducts, setCompareProducts] = useState<Set<string>>(new Set());
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [showComparisonView, setShowComparisonView] = useState(false);
  const [featuredProducts, setFeaturedProducts] = useState<any[]>([]);
  const [featuredProductsTitle, setFeaturedProductsTitle] = useState('Featured Products');
  const [cleanModeEnabled, setCleanModeEnabled] = useState(false);
  const [proactiveGuidanceChecked, setProactiveGuidanceChecked] = useState(false);
  const [ruleConversationStarters, setRuleConversationStarters] = useState<string[] | null>(null);
  // TopScholar doubt-resolution prompt (Task #5). doubtSessionRef is set from a
  // `doubt_session` SSE event the server emits after answering a doubt-scoped
  // session; the widget then waits `cooldownSeconds` of student inactivity before
  // showing a Yes/No "Did this resolve your doubt?" prompt. Yes -> mark the doubt
  // resolved on the client portal; No -> escalate to a support ticket. Only ever
  // active for the TopScholar tenant's doubt sessions (no-op everywhere else).
  const doubtSessionRef = useRef<{ active: boolean; cooldownSeconds: number }>({ active: false, cooldownSeconds: 120 });
  const doubtPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doubtAnsweredRef = useRef(false);
  // Simulation-only preview (admin Widget Tester): when set via ?previewDoubt=1,
  // the doubt-resolution prompt is armed locally after every tutor answer (the
  // server never emits a real doubt_session event here) and Yes/No are made
  // side-effect-free (no portal call, no ticket). Never set for real visitors.
  const doubtPreviewRef = useRef(false);
  // Preview-only: tracks whether the simulated retry-once has been consumed, so
  // the Tester mirrors production (first "No" = retry, second "No" = escalate).
  const doubtPreviewRetryUsedRef = useRef(false);
  const [doubtPromptStatus, setDoubtPromptStatus] = useState<'hidden' | 'visible' | 'resolving' | 'resolved' | 'escalating' | 'escalated' | 'error'>('hidden');
  // A doubt maps 1:1 to one chat session, so once the student answers the
  // resolution prompt the session is over and the chat locks: no typing, no
  // sending, no photo upload, no voice. Set from the Yes/escalate result, and
  // restored from the server on reload so the lock survives a refresh, a cleared
  // cache, or opening the same doubt on another device. `null` = still open.
  const [doubtLock, setDoubtLock] = useState<'resolved' | 'escalated' | null>(null);
  // Mirror into a ref so send paths can check it without being re-created.
  const doubtLockRef = useRef<'resolved' | 'escalated' | null>(null);
  useEffect(() => { doubtLockRef.current = doubtLock; }, [doubtLock]);
  const [isMenuMode, setIsMenuMode] = useState(false);
  const [menuEnabled, setMenuEnabled] = useState<boolean | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<NormalizedOrder | null>(null);
  const proactiveGuidanceAppliedRef = useRef(false);
  const sentChatMenuItemsRef = useRef<Set<string>>(new Set());
  const menuDropdownRef = useRef<HTMLDivElement>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  // Detect mobile device once on mount
  const isMobileDevice = useRef(getDeviceInfo().deviceType === 'mobile').current;
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
  const { toast } = useToast();

  // Session ID for conversation persistence (stored per businessAccountId)
  const sessionIdRef = useRef<string>('');
  const [isRestoringHistory, setIsRestoringHistory] = useState(true);
  
  // Generate unique user ID for widget (persists across session for voice mode)
  const widgetUserIdRef = useRef<string>(`widget_${crypto.randomUUID()}`);
  
  // Visitor session tracking token (persisted in localStorage for return visitors)
  const visitorSessionTokenRef = useRef<string>('');
  // TopScholar curriculum handoff: signed launch token (or UAT plain cp_id) read
  // from the URL on mount; forwarded with every chat stream request so the
  // server can bind the conversation to one student's curriculum.
  const topscholarTokenRef = useRef<string>('');
  const topscholarCpIdRef = useRef<string>('');
  // Grade-scoped widget (Option A): the student's board/medium/grade, injected by
  // the client portal as widget data attributes and forwarded into this iframe URL.
  const studentBoardRef = useRef<string>('');
  const studentMediumRef = useRef<string>('');
  const studentGradeRef = useRef<string>('');
  const studentSubjectRef = useRef<string>('');
  // Optional chapter narrowing forwarded by the widget tester / embed (data-chapter).
  const studentChapterRef = useRef<string>('');
  // Grade-scoped (non-secure) student identity. Plain attributes forwarded by the
  // grade-scoped embed so history, conversation listing, and per-student rollups
  // work like the signed-token embed. A valid signed token wins server-side.
  const studentIdRef = useRef<string>('');
  const studentNameRef = useRef<string>('');
  
  // Track session start time for duration calculation
  const sessionStartTimeRef = useRef<number>(Date.now());

  // Task #14: TopScholar subject-scoped session storage. For the curriculum widget
  // the conversation id (and its creation time) are persisted per subject so that
  // switching subject swaps to that subject's own thread + history and switching
  // back restores it, while chapter changes keep the same thread. A subject session
  // expires 24h after creation. Non-curriculum widgets keep the single global key
  // and the 30-minute welcome-back behavior, completely unchanged.
  const TOPSCHOLAR_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  // A curriculum (TopScholar) embed always carries the full four-part scope
  // (board + medium + grade + subject) — this is exactly what the server treats as a
  // valid curriculum request (a partial scope is refused). Gating on the full scope
  // (rather than just `?subject=`) keeps every other tenant on the unchanged single
  // global key + 30-minute welcome-back behavior even if their URL happens to carry
  // a stray `subject` param. The server independently gates on ragEnabled, so this is
  // purely about the client matching that scope for localStorage keying.
  const isSubjectScopedEmbed = () =>
    !!(
      (studentBoardRef.current || '').trim() &&
      (studentMediumRef.current || '').trim() &&
      (studentGradeRef.current || '').trim() &&
      (studentSubjectRef.current || '').trim()
    );
  // The session identity is content scope + subject. The client can't see the
  // server's cp_id, so it mirrors the scope with the normalized board+medium+grade
  // tuple (which maps 1:1 to a cp_id). Including it keeps two scopes that share a
  // subject label (e.g. "Math" across grades) on separate localStorage threads.
  const getScopeKeyPart = () => {
    const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '_');
    const b = norm(studentBoardRef.current || '');
    const m = norm(studentMediumRef.current || '');
    const g = norm(studentGradeRef.current || '');
    const s = norm(studentSubjectRef.current || '');
    return `${b}_${m}_${g}__subj_${s}`;
  };

  // Task #4 (cross-subject history leak fix): decode the doubtId from a signed
  // token's payload client-side — no signature verification needed here, we only
  // use it to namespace localStorage keys. Each distinct doubtId gets its own
  // slot so Maths and English sessions never share the generic key.
  // Safe: the server is the authoritative security gate; this is a UX/isolation
  // layer only. A tampered doubtId would simply key a fresh localStorage slot.
  const getDoubtIdFromToken = (token: string): string | null => {
    try {
      const [encoded] = token.split('.');
      if (!encoded) return null;
      const pad = encoded.length % 4 === 0 ? '' : '='.repeat(4 - (encoded.length % 4));
      const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + pad);
      const payload = JSON.parse(json) as { doubtId?: unknown };
      return typeof payload?.doubtId === 'string' && payload.doubtId ? payload.doubtId : null;
    } catch {
      return null;
    }
  };

  const getConvKey = () => {
    // Prefer the full scope key when all four parts (board/medium/grade/subject)
    // are present in the URL (grade-scoped embed without a signed token).
    if (isSubjectScopedEmbed()) {
      return `chroney_conversation_${businessAccountId}__scope_${getScopeKeyPart()}`;
    }
    // Doubt-scoped (signed token): decode the doubtId from the token payload and
    // use it as the localStorage key discriminator. This prevents different doubt
    // sessions (e.g. Maths → English) from sharing the generic fallback key and
    // leaking each other's conversationId / history. Using doubtId (not a token
    // hash) ensures the same doubt re-opens correctly even with a freshly minted
    // token (new iat/signature, same doubtId).
    if (topscholarTokenRef.current) {
      const doubtId = getDoubtIdFromToken(topscholarTokenRef.current);
      if (doubtId) {
        return `chroney_conversation_${businessAccountId}__doubt_${doubtId}`;
      }
    }
    return `chroney_conversation_${businessAccountId}`;
  };
  const getConvCreatedKey = () => {
    if (isSubjectScopedEmbed()) {
      return `chroney_ts_created_${businessAccountId}__scope_${getScopeKeyPart()}`;
    }
    // Doubt-scoped: per-doubt creation timestamp for 24h expiry tracking.
    if (topscholarTokenRef.current) {
      const doubtId = getDoubtIdFromToken(topscholarTokenRef.current);
      if (doubtId) {
        return `chroney_ts_created_${businessAccountId}__doubt_${doubtId}`;
      }
    }
    return '';
  };
  // Stamp the per-subject (or per-doubt) creation time once, when a conversation
  // first appears. No-op for non-curriculum widgets (empty created key).
  const stampConvCreatedIfNeeded = () => {
    const ck = getConvCreatedKey();
    if (ck && !localStorage.getItem(ck)) localStorage.setItem(ck, Date.now().toString());
  };
  
  // Get businessAccountId for urgency offer hook
  const [urgencyBusinessId, setUrgencyBusinessId] = useState<string | undefined>(undefined);
  
  // Urgency offer hook for AI-powered intent detection
  const {
    activeOffer,
    redeemOffer,
    dismissOffer,
    acknowledgeRedemption,
    checkMessageIntent,
  } = useUrgencyOffer({
    businessAccountId: urgencyBusinessId,
    sessionId: sessionIdRef.current,
    enabled: !!urgencyBusinessId,
  });
  
  // Mobile viewport height updater with Visual Viewport API for stable keyboard handling
  useEffect(() => {
    // Update custom property for mobile viewport height
    function updateViewportHeight() {
      if (window.innerWidth <= 480) {
        // Use visualViewport if available (better for keyboard handling)
        const height = window.visualViewport?.height ?? window.innerHeight;
        const vh = height * 0.01;
        document.documentElement.style.setProperty('--hichroney-vh', `${vh}px`);
      }
    }

    // Debounced resize handler for window resize events
    let resizeTimeout: NodeJS.Timeout;
    function handleResize() {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateViewportHeight, 50);
    }

    // Update on mount
    updateViewportHeight();
    
    // Use Visual Viewport API for precise keyboard handling (if available)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewportHeight);
      window.visualViewport.addEventListener('scroll', updateViewportHeight);
    }
    
    // Fallback to window events
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', updateViewportHeight);
    
    // Also update when keyboard shows/hides (focus/blur events)
    window.addEventListener('focus', updateViewportHeight, true);
    window.addEventListener('blur', updateViewportHeight, true);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewportHeight);
        window.visualViewport.removeEventListener('scroll', updateViewportHeight);
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', updateViewportHeight);
      window.removeEventListener('focus', updateViewportHeight, true);
      window.removeEventListener('blur', updateViewportHeight, true);
    };
  }, []);
  
  // Track if visitor session has been started
  const visitorSessionStartedRef = useRef<boolean>(false);
  
  // Get businessAccountId from URL params using React state to ensure it reads correctly
  const [businessAccountId, setBusinessAccountId] = useState<string | null>(null);
  
  // Track if auto-open is requested
  const shouldAutoOpenVoiceRef = useRef(false);
  
  // Track if EMBED_READY has been sent
  const hasSignaledReadyRef = useRef(false);
  
  // Queue for pending starter messages (received before businessAccountId is ready)
  // Using state instead of ref so React re-renders and queue processor effect runs
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  
  // Inactivity nudge tracking - supports sequential messages
  const lastAIMessageTimeRef = useRef<number | null>(null);
  const inactivityNudgeSentRef = useRef<boolean>(false);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityNudgeIndexRef = useRef<number>(0); // Track which message in sequence we're on
  
  // Conversion tracking (Google Ads): dedupe set keyed by conversationId so the
  // hidden conversion iframe fires at most once per conversation in this browser
  // (defends against StrictMode double-render, SSE reconnects, and repeated
  // verify-response signals). The server-side marker is the source of truth; this
  // is a client-side belt-and-suspenders guard.
  const conversionFiredRef = useRef<Set<string>>(new Set());
  const [conversionBadge, setConversionBadge] = useState<{ url: string } | null>(null);

  // Welcome back tracking - for returning visitors after 30+ minutes
  const isWelcomeBackRef = useRef<boolean>(false);
  
  // External guidance mode - when parent sends PROACTIVE_GUIDANCE, skip normal welcome/history
  const externalGuidanceModeRef = useRef<boolean>(false);

  useEffect(() => {
    // Get businessAccountId, autoOpenVoice, and guidanceMode from URL params
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('businessAccountId');
    let autoOpenVoice = urlParams.get('autoOpenVoice');
    let guidanceMode = urlParams.get('guidanceMode');
    let tsToken = urlParams.get('token') || urlParams.get('topscholarToken');
    let tsCpId = urlParams.get('cpId') || urlParams.get('topscholarCpId');
    let stBoard = urlParams.get('board') || urlParams.get('studentBoard');
    let stMedium = urlParams.get('medium') || urlParams.get('studentMedium');
    let stGrade = urlParams.get('grade') || urlParams.get('studentGrade');
    let stSubject = urlParams.get('subject') || urlParams.get('studentSubject');
    let stChapter = urlParams.get('chapter') || urlParams.get('studentChapter');
    let stStudentId = urlParams.get('studentId') || urlParams.get('student_id');
    let stStudentName = urlParams.get('name') || urlParams.get('studentName');
    let previewDoubt = urlParams.get('previewDoubt');
    let previewDoubtCooldown = urlParams.get('previewDoubtCooldown');
    
    // If not in search params, try hash (for client-side routing)
    if (!id && window.location.hash) {
      const hash = window.location.hash;
      if (hash.includes('?')) {
        const hashParams = new URLSearchParams(hash.split('?')[1]);
        id = hashParams.get('businessAccountId');
        autoOpenVoice = hashParams.get('autoOpenVoice');
        guidanceMode = hashParams.get('guidanceMode');
        tsToken = tsToken || hashParams.get('token') || hashParams.get('topscholarToken');
        tsCpId = tsCpId || hashParams.get('cpId') || hashParams.get('topscholarCpId');
        stBoard = stBoard || hashParams.get('board') || hashParams.get('studentBoard');
        stMedium = stMedium || hashParams.get('medium') || hashParams.get('studentMedium');
        stGrade = stGrade || hashParams.get('grade') || hashParams.get('studentGrade');
        stSubject = stSubject || hashParams.get('subject') || hashParams.get('studentSubject');
        stChapter = stChapter || hashParams.get('chapter') || hashParams.get('studentChapter');
        stStudentId = stStudentId || hashParams.get('studentId') || hashParams.get('student_id');
        stStudentName = stStudentName || hashParams.get('name') || hashParams.get('studentName');
        previewDoubt = previewDoubt || hashParams.get('previewDoubt');
        previewDoubtCooldown = previewDoubtCooldown || hashParams.get('previewDoubtCooldown');
      }
    }
    
    if (id) {
      setBusinessAccountId(id);
      setUrgencyBusinessId(id);
    }

    if (tsToken) topscholarTokenRef.current = tsToken;
    if (tsCpId) topscholarCpIdRef.current = tsCpId;
    if (stBoard) studentBoardRef.current = stBoard;
    if (stMedium) studentMediumRef.current = stMedium;
    if (stGrade) studentGradeRef.current = stGrade;
    if (stSubject) studentSubjectRef.current = stSubject;
    if (stChapter) studentChapterRef.current = stChapter;
    if (stStudentId) studentIdRef.current = stStudentId;
    if (stStudentName) studentNameRef.current = stStudentName;

    // Admin Widget Tester preview: simulate a doubt-scoped session locally so the
    // "Did this resolve your doubt?" prompt can be previewed without a real
    // portal-launched doubt. Purely client-side — no server signal, no side effects.
    // Hard-gated to the absence of a signed TopScholar token: a REAL doubt session
    // always carries a signed launch token (the Tester never does), so a tampered
    // real-session URL can never be downgraded into no-op preview mode. Real doubt
    // sessions always take precedence and keep their live resolve/escalate calls.
    if ((previewDoubt === '1' || previewDoubt === 'true') && !tsToken) {
      doubtPreviewRef.current = true;
      const secs = Number(previewDoubtCooldown);
      doubtSessionRef.current = {
        active: true,
        cooldownSeconds: Number.isFinite(secs) && secs > 0 ? secs : 120,
      };
    }
    
    if (autoOpenVoice === 'true') {
      shouldAutoOpenVoiceRef.current = true;
    }
    
    // CRITICAL: If guidanceMode=true is set, immediately enable clean mode
    // This ensures optional elements (featured products, default conversation starters,
    // quick browse buttons, nudges) are NEVER rendered - no race conditions
    if (guidanceMode === 'true') {
      console.log('[EmbedChat] 🎯 Guidance mode enabled via URL param - clean mode activated');
      setCleanModeEnabled(true);
      setProactiveGuidanceChecked(true); // Mark as checked so we don't wait for rules fetch
      externalGuidanceModeRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!businessAccountId) return;
    if (visitorSessionTokenRef.current) return;
    const perBusinessKey = `chroney_visitor_${businessAccountId}`;
    const globalKey = 'chroney_visitor_token';
    let token = localStorage.getItem(perBusinessKey) || localStorage.getItem(globalKey);
    if (!token) {
      token = crypto.randomUUID();
    }
    localStorage.setItem(perBusinessKey, token);
    localStorage.setItem(globalKey, token);
    visitorSessionTokenRef.current = token;
  }, [businessAccountId]);

  // Fetch widget settings for this business account
  const { data: settings, isLoading: isLoadingSettings } = useQuery<WidgetSettings>({
    queryKey: [`/api/widget-settings/public?businessAccountId=${businessAccountId}`],
    enabled: !!businessAccountId,
  });

  // K12/TopScholar embeds hide the header 3-dot menu (New Chat / Conversation
  // History) — the client doesn't want students to see those options.
  const hideHeaderMenu = !!(settings?.k12EducationEnabled || topscholarTokenRef.current || isSubjectScopedEmbed());
  useEffect(() => {
    // If the gate flips while the menu is open (e.g. settings just loaded),
    // reset the open state so the outside-click listener doesn't linger.
    if (hideHeaderMenu && isMenuOpen) setIsMenuOpen(false);
  }, [hideHeaderMenu, isMenuOpen]);

  // Conversion tracking (Google Ads): fire the admin-configured "thank-you" page
  // in a hidden iframe IN THE VISITOR'S BROWSER so their conversion tag executes
  // with the visitor's own cookies/gclid. Triggered by a server "lead captured"
  // signal (SSE `lead_captured` or `leadCaptured:true` on an OTP/CAPTCHA verify
  // response). Strictly guarded: requires a configured https URL and fires at most
  // once per conversation (conversionFiredRef). The URL is NEVER fetched
  // server-side. An off-screen 1px iframe (not display:none) is used so the page
  // and its scripts actually load and the conversion pixel fires.
  const fireConversion = useCallback((convId?: string | null) => {
    try {
      const cfg = (settings as any)?.leadTrainingConfig;
      const rawUrl = typeof cfg?.conversionUrl === 'string' ? cfg.conversionUrl.trim() : '';
      if (!rawUrl) return;
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return; // malformed URL → never inject
      }
      if (parsed.protocol !== 'https:') return; // https-only

      const key = convId || conversationIdRef.current || 'pending';
      if (conversionFiredRef.current.has(key)) return; // already fired this convo
      conversionFiredRef.current.add(key);

      if (typeof document !== 'undefined') {
        const iframe = document.createElement('iframe');
        iframe.src = rawUrl;
        iframe.title = 'conversion';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.tabIndex = -1;
        iframe.width = '1';
        iframe.height = '1';
        iframe.style.position = 'absolute';
        iframe.style.width = '1px';
        iframe.style.height = '1px';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        iframe.style.left = '-9999px';
        iframe.style.top = '-9999px';
        document.body.appendChild(iframe);
        // Remove after the page has had time to load and fire its tags.
        window.setTimeout(() => {
          try { iframe.remove(); } catch { /* noop */ }
        }, 8000);
      }

      if (cfg?.conversionBadgeEnabled === true) {
        setConversionBadge({ url: rawUrl });
        window.setTimeout(() => setConversionBadge(null), 6000);
      }
    } catch (e) {
      console.warn('[Conversion] fireConversion failed:', e);
    }
  }, [settings]);
  
  // Check if menu navigation is enabled for this business
  useEffect(() => {
    const checkMenuEnabled = async () => {
      if (!businessAccountId) return;
      try {
        const response = await fetch(`/api/chat-menu/public?businessAccountId=${businessAccountId}`);
        const data = await response.json();
        const enabled = data.enabled === true;
        setMenuEnabled(enabled);
      } catch (error) {
        console.error('[MenuCheck] Failed to check menu status:', error);
        setMenuEnabled(false);
      }
    };
    checkMenuEnabled();
  }, [businessAccountId]);
  
  // Track if we've already decided on initial mode (to prevent re-triggering)
  const menuModeDecidedRef = useRef(false);

  // Task #23: single source of truth for "pre-chat OTP gate is active and the
  // visitor has not yet verified". When true, the widget MUST show only the
  // phone-entry modal (and then the OTP modal) — no intro, no menu, no
  // composer. Centralising the predicate avoids partial-unlock states where
  // one surface honours the gate but another does not.
  const preChatGateActive =
    !!settings?.requirePreChatOtp && !preChatGateDisabled && !preChatOtpVerified;

  // CAPTCHA gate counterpart (mutually exclusive with OTP server-side, so at
  // most one of these is ever active). Same role: block intro/menu/composer
  // until the visitor clears the challenge.
  const preChatCaptchaActive =
    !!settings?.requirePreChatCaptcha && !preChatCaptchaGateDisabled && !preChatCaptchaVerified;

  // Mid-chat CAPTCHA modal is active whenever the server has signalled a
  // required challenge (custom/intent/keyword strategies). Independent of the
  // pre-chat gate so the two never collide.
  const midChatCaptchaActive = midChatCaptcha.required;

  // The reCAPTCHA checkbox render effect must run for EITHER the pre-chat gate
  // OR the mid-chat challenge. The effective site key/provider come from the
  // mid-chat event when present, else from cached settings (pre-chat).
  const captchaRenderActive = preChatCaptchaActive || midChatCaptchaActive;
  const effectiveCaptchaSiteKey = midChatCaptchaActive
    ? midChatCaptcha.siteKey
    : (settings?.captchaSiteKey ?? null);
  const effectiveCaptchaProvider = midChatCaptchaActive
    ? midChatCaptcha.provider
    : (settings?.captchaProvider ?? null);

  // Combined predicate for every chat surface that must stay hidden behind ANY
  // pre-chat gate (OTP or CAPTCHA). OTP-specific modals continue to key off
  // preChatGateActive; CAPTCHA-specific modal keys off preChatCaptchaActive.
  const anyPreChatGateActive = preChatGateActive || preChatCaptchaActive;

  // Task #3: once settings arrive, pin the visitor's default channel pick
  // from server-supplied defaultOtpChannel. We only set it when it's still
  // null so a visitor's explicit toggle isn't overwritten by a settings
  // re-fetch.
  useEffect(() => {
    if (selectedOtpChannel) return;
    const chs = settings?.otpChannels || [];
    const def = settings?.defaultOtpChannel;
    if (def && chs.includes(def)) setSelectedOtpChannel(def);
    else if (chs.length > 0) setSelectedOtpChannel(chs[0]);
  }, [settings?.otpChannels, settings?.defaultOtpChannel, selectedOtpChannel]);

  // Load the Google reCAPTCHA v2 script and render the checkbox widget into the
  // pre-chat modal when the CAPTCHA gate is active. Uses explicit render so we
  // control placement; the widget id is kept in a ref so we can reset() it after
  // a failed verification, letting the visitor retry without reloading.
  useEffect(() => {
    if (!captchaRenderActive) return;
    if (effectiveCaptchaProvider && effectiveCaptchaProvider !== 'recaptcha_v2') return;
    const siteKey = effectiveCaptchaSiteKey;
    if (!siteKey) return;

    let cancelled = false;
    const SCRIPT_ID = 'recaptcha-v2-script';

    const renderWidget = () => {
      if (cancelled) return;
      const g = (window as any).grecaptcha;
      if (!g || !g.render || !captchaContainerRef.current) return;
      if (captchaWidgetIdRef.current !== null) return; // already rendered
      try {
        captchaWidgetIdRef.current = g.render(captchaContainerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            setCaptchaToken(token);
            setCaptchaError(null);
          },
          'expired-callback': () => setCaptchaToken(null),
          'error-callback': () => setCaptchaToken(null),
        });
      } catch (e) {
        console.error('[CAPTCHA] render failed:', e);
      }
    };

    const whenReady = () => {
      const g = (window as any).grecaptcha;
      if (g && typeof g.ready === 'function') g.ready(renderWidget);
      else renderWidget();
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      whenReady();
    } else {
      const s = document.createElement('script');
      s.id = SCRIPT_ID;
      s.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = whenReady;
      s.onerror = () => {
        if (!cancelled) setCaptchaError('Could not load the verification challenge. Please refresh and try again.');
      };
      document.head.appendChild(s);
    }

    return () => {
      cancelled = true;
      // Allow a fresh render if the gate re-activates later in this session.
      captchaWidgetIdRef.current = null;
    };
  }, [captchaRenderActive, effectiveCaptchaProvider, effectiveCaptchaSiteKey]);

  // Reset the reCAPTCHA widget so the visitor can re-attempt the challenge.
  const resetCaptchaWidget = () => {
    setCaptchaToken(null);
    const g = (window as any).grecaptcha;
    if (g && typeof g.reset === 'function' && captchaWidgetIdRef.current !== null) {
      try { g.reset(captchaWidgetIdRef.current); } catch { /* noop */ }
    }
  };

  // Auto-switch to menu mode after history is restored if menu is enabled and no messages
  useEffect(() => {
    // Only auto-set menu mode once, after history restoration completes
    if (!menuModeDecidedRef.current && !isRestoringHistory && menuEnabled !== null) {
      // Task #23: do NOT auto-switch into menu mode while the pre-chat OTP
      // gate is active — the menu would render behind the modal and let the
      // visitor interact with menu items before verifying. We defer the
      // decision until after verification (the ref stays false so this
      // effect re-runs once preChatGateActive flips).
      if (anyPreChatGateActive) return;
      menuModeDecidedRef.current = true;
      if (menuEnabled && messages.length === 0 && !pendingMessage) {
        setIsMenuMode(true);
      }
    }
  }, [isRestoringHistory, menuEnabled, messages.length, pendingMessage, anyPreChatGateActive]);
  
  // Track conversationId for persistence (stored in localStorage after first message)
  const conversationIdRef = useRef<string>('');
  
  // Initialize sessionId from localStorage and restore conversation history
  useEffect(() => {
    if (!businessAccountId) return;
    
    const sessionStorageKey = `chroney_session_${businessAccountId}`;
    const conversationStorageKey = getConvKey();
    const lastActivityKey = `chroney_last_activity_${businessAccountId}`;
    
    let storedSessionId = localStorage.getItem(sessionStorageKey);
    let storedConversationId = localStorage.getItem(conversationStorageKey);
    const lastActivityStr = localStorage.getItem(lastActivityKey);
    
    const now = Date.now();

    // Task #14: the curriculum (TopScholar) widget keys sessions per subject with a
    // hard 24h-from-creation lifetime and does NOT use the 30-minute welcome-back
    // reset. Detected by the full curriculum scope (board+medium+grade+subject) so a
    // stray `?subject=` on a non-curriculum embed never changes its behavior.
    // Task #4: also detect doubt-scoped signed-token sessions (where board/medium/
    // grade/subject are inside the token, not URL params). Both flavours share the
    // same 24h TTL logic; the key already differentiates them via getConvKey().
    const subj = (studentSubjectRef.current || '').trim();
    const isTopscholarSubject =
      isSubjectScopedEmbed() ||
      !!(topscholarTokenRef.current && getDoubtIdFromToken(topscholarTokenRef.current));

    if (isTopscholarSubject) {
      // Expire the subject's session if it was created more than 24h ago, so the
      // next visit to this subject starts fresh. A missing creation timestamp is
      // treated leniently (no expiry) — the server still enforces 24h on reuse.
      const createdKey = getConvCreatedKey();
      const createdStr = createdKey ? localStorage.getItem(createdKey) : null;
      const createdAt = createdStr ? parseInt(createdStr, 10) : null;
      const validCreated = createdAt !== null && !Number.isNaN(createdAt);
      if (storedConversationId && validCreated && now - createdAt >= TOPSCHOLAR_SESSION_TTL_MS) {
        console.log(`[TopScholar] Subject session expired (>24h) — starting fresh for "${subj}"`);
        localStorage.removeItem(conversationStorageKey);
        if (createdKey) localStorage.removeItem(createdKey);
        storedConversationId = null;
        conversationIdRef.current = '';
        setHasConversation(false);
      }
      // Keep last-activity fresh (harmless) but never gate TopScholar on it.
      localStorage.setItem(lastActivityKey, now.toString());
    } else {
      // Non-curriculum widgets: existing 30-minute welcome-back behavior, unchanged.
      const WELCOME_BACK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

      // Parse last activity time with validity guard
      const lastActivity = lastActivityStr ? parseInt(lastActivityStr, 10) : null;
      const isValidLastActivity = lastActivity !== null && !Number.isNaN(lastActivity);

      // Check welcome back condition BEFORE updating timestamp
      if (isValidLastActivity && storedConversationId) {
        const timeSinceLastActivity = now - lastActivity;

        if (timeSinceLastActivity >= WELCOME_BACK_THRESHOLD_MS) {
          console.log(`[Welcome Back] Returning visitor after ${Math.round(timeSinceLastActivity / 60000)} minutes - starting new session`);

          // Start a fresh session for returning visitor
          const newSessionId = crypto.randomUUID();
          sessionIdRef.current = newSessionId;
          localStorage.setItem(sessionStorageKey, newSessionId);
          localStorage.removeItem(conversationStorageKey);
          conversationIdRef.current = '';
          setHasConversation(false);

          // Mark this as a welcome back scenario
          isWelcomeBackRef.current = true;

          // Update last activity time AFTER decision is made
          localStorage.setItem(lastActivityKey, now.toString());

          setIsRestoringHistory(false);
          return;
        }
      }

      // Update last activity time AFTER welcome back check (normal flow)
      localStorage.setItem(lastActivityKey, now.toString());
    }
    
    // Set up sessionId
    if (storedSessionId) {
      sessionIdRef.current = storedSessionId;
    } else {
      const newSessionId = crypto.randomUUID();
      sessionIdRef.current = newSessionId;
      localStorage.setItem(sessionStorageKey, newSessionId);
    }
    
    // If we have a stored conversationId, try to restore history.
    // Also restore for a doubt-scoped session even with NOTHING stored: the doubt
    // is the durable session key, so this is what re-locks a finished chat after
    // a cleared cache or on a second device. Without it the student would be
    // handed a blank, fully usable chat for a doubt they already closed.
    const doubtScopedLaunch = !!(topscholarTokenRef.current && getDoubtIdFromToken(topscholarTokenRef.current));
    // Skip if external guidance mode is active (demo pages control the messages)
    if ((storedConversationId || doubtScopedLaunch) && !externalGuidanceModeRef.current) {
      if (storedConversationId) {
        conversationIdRef.current = storedConversationId;
        setHasConversation(true);
      }
      
      const restoreHistory = async () => {
        try {
          // Double-check external guidance mode before restoring
          if (externalGuidanceModeRef.current) {
            console.log('[EmbedChat] Skipping history restore - external guidance mode active');
            setIsRestoringHistory(false);
            return;
          }
          
          const response = await fetch(
            `/api/chat/widget/history?businessAccountId=${encodeURIComponent(businessAccountId)}${storedConversationId ? `&conversationId=${encodeURIComponent(storedConversationId)}` : ''}&sessionId=${encodeURIComponent(sessionIdRef.current)}${topscholarTokenRef.current ? `&token=${encodeURIComponent(topscholarTokenRef.current)}` : ''}${studentIdRef.current ? `&studentId=${encodeURIComponent(studentIdRef.current)}` : ''}`
          );
          
          if (response.ok) {
            const data = await response.json();
            // Final check before setting messages
            if (externalGuidanceModeRef.current) {
              console.log('[EmbedChat] Skipping history restore - external guidance mode active');
              setIsRestoringHistory(false);
              return;
            }
            
            // Restore the doubt lock before anything else: a finished session must
            // come back locked whether or not its messages loaded.
            if (data.doubt_state?.locked) {
              const outcome = data.doubt_state.outcome === 'escalated' ? 'escalated' : 'resolved';
              setDoubtLock(outcome);
              doubtAnsweredRef.current = true;
              setDoubtPromptStatus(outcome === 'escalated' ? 'escalated' : 'resolved');
            }

            if (data.messages && data.messages.length > 0) {
              // Restore messages from history
              const restoredMessages: ChatMessage[] = data.messages.map((msg: any) => ({
                id: msg.id,
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
                imageUrl: msg.imageUrl || undefined,
                timestamp: new Date(msg.timestamp)
              }));
              setMessages(restoredMessages);
              console.log('[EmbedChat] Restored', restoredMessages.length, 'messages from history');
              
              // Update conversationId if returned
              if (data.conversationId) {
                conversationIdRef.current = data.conversationId;
                setHasConversation(true);
              }
              // Task #14: restore OTP state so refresh/reopen keeps lockout
              // and awaiting_otp UI enforced (server-driven persistence).
              if (data.otp_state && (data.otp_state.awaiting_otp || data.otp_state.locked)) {
                setOtpState(data.otp_state);
                if (data.otp_state.locked && data.otp_state.locked_until) {
                  const secs = Math.max(0, Math.ceil((new Date(data.otp_state.locked_until).getTime() - Date.now()) / 1000));
                  setOtpLockRemaining(secs);
                }
              } else {
                // Task #23: returning visitor with a real conversation and no
                // pending OTP state — they've already cleared the pre-chat
                // gate in an earlier session. Mark verified so the gate
                // doesn't re-block them on reload.
                setPreChatOtpVerified(true);
              }
            } else {
              // Conversation not found or empty - clear stored conversationId
              localStorage.removeItem(conversationStorageKey);
              // Task #14: also clear the per-subject 24h creation window.
              const _ck = getConvCreatedKey();
              if (_ck) localStorage.removeItem(_ck);
              conversationIdRef.current = '';
              setHasConversation(false);
            }
          }
        } catch (error) {
          console.error('[EmbedChat] Failed to restore conversation history:', error);
        } finally {
          setIsRestoringHistory(false);
        }
      };
      
      restoreHistory();
    } else {
      if (externalGuidanceModeRef.current) {
        console.log('[EmbedChat] Skipping history restore - external guidance mode active');
      }
      setIsRestoringHistory(false);
    }
  }, [businessAccountId]);

  useEffect(() => {
    // Never auto-open voice into a finished doubt session — that would reopen a
    // live mic on a chat the student has already closed.
    if (shouldAutoOpenVoiceRef.current && settings && !isLoadingSettings && settings.voiceModeEnabled && !doubtLock) {
      console.log('[EmbedChat] Auto-opening voice mode after settings loaded');
      if (settings.chatMode === 'voice-only') {
        setIsVoiceModeOpen(true);
      } else {
        setIsInlineVoiceActive(true);
      }
      shouldAutoOpenVoiceRef.current = false;
    }
  }, [settings, isLoadingSettings]);

  // Use actual settings values
  const chatColor = settings?.chatColor || "#9333ea";
  const chatColorEnd = settings?.chatColorEnd || "#3b82f6";
  const CHAT_FONT_SIZE_PX: Record<string, string> = { small: "13px", medium: "14px", large: "16px" };
  const chatFontSize = CHAT_FONT_SIZE_PX[settings?.chatFontSize || "medium"] || CHAT_FONT_SIZE_PX.medium;
  const widgetHeaderText = settings?.widgetHeaderText || "Hi Chroney";
  const currency = settings?.currency || "USD";
  const voiceModeStyle = settings?.voiceModeStyle || "circular";
  
  // Parse conversation starters from settings (or use rule-specific FAQs if available)
  const defaultStarters = settings?.conversationStarters 
    ? JSON.parse(settings.conversationStarters) 
    : [];
  // If rule FAQs are set (including empty array), use them; otherwise use default
  const conversationStarters = ruleConversationStarters !== null ? ruleConversationStarters : defaultStarters;
  // Clean mode only hides default starters, not rule-specific FAQs
  const isUsingRuleFaqs = ruleConversationStarters !== null && ruleConversationStarters.length > 0;
  // Wait for proactive guidance check before showing starters (unless rule FAQs are being used)
  const showStarters = settings?.conversationStartersEnabled !== 'false' && conversationStarters.length > 0 && (isUsingRuleFaqs || (!cleanModeEnabled && proactiveGuidanceChecked));
  
  // Determine if conversation starters should be visible
  const userMessages = messages.filter(m => m.role === 'user');
  const shouldShowStarters = showStarters && userMessages.length === 0 && !isLoading;
  
  // Language selector configuration
  const languageSelectorEnabled = settings?.languageSelectorEnabled !== 'false';
  const availableLanguages: string[] = settings?.availableLanguages 
    ? (() => {
        try {
          return JSON.parse(settings.availableLanguages);
        } catch {
          return ['auto', 'en', 'hi', 'kn', 'ta', 'mr'];
        }
      })()
    : ['auto', 'en', 'hi', 'kn', 'ta', 'mr'];
  
  // Close language dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
      }
    };
    
    if (isLanguageDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isLanguageDropdownOpen]);
  
  // Close menu dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuDropdownRef.current && !menuDropdownRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);
  
  // Handle compare toggle for products
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
    
    // Track product for comparison lookup
    messages.forEach(msg => {
      const products = [...(msg.products || []), ...(msg.matchedProducts || [])];
      products.forEach(p => {
        if (p.id === productId && !allProducts.find(ap => ap.id === productId)) {
          setAllProducts(prev => [...prev, p]);
        }
      });
    });
  };

  // Handle try-on for products
  const handleTryOn = (product: any) => {
    if (product.imageUrl) {
      setTryOnProduct({
        imageUrl: product.imageUrl,
        name: product.name,
        type: product.category || product.type || 'necklace'
      });
      setShowTryOnOverlay(true);
    }
  };

  // Handle quick browse button click - sends the action as a message
  const handleQuickBrowse = (action: string) => {
    if (sendMessageRef.current) {
      sendMessageRef.current(action);
    }
  };

  // Start a new chat - clear stored conversation and show welcome message
  const handleNewChat = async () => {
    if (!businessAccountId) return;
    
    if (conversationIdRef.current) {
      try {
        await fetch('/api/chat/widget/close-conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: conversationIdRef.current }),
        });
      } catch (e) {
        console.warn('[New Chat] Failed to close previous conversation:', e);
      }
    }
    
    // Generate new session and conversation IDs
    const newSessionId = crypto.randomUUID();
    sessionIdRef.current = newSessionId;
    conversationIdRef.current = '';
    setHasConversation(false);
    
    // Update localStorage
    localStorage.setItem(`chroney_session_${businessAccountId}`, newSessionId);
    localStorage.removeItem(getConvKey());
    // Task #14: reset the per-subject 24h creation window when starting a new chat.
    const _ck = getConvCreatedKey();
    if (_ck) localStorage.removeItem(_ck);
    
    // Clear messages and reset comparison state
    setMessages([]);
    setIsMenuOpen(false);
    setCompareProducts(new Set());
    setAllProducts([]);
    setShowComparisonView(false);
    setActiveFormStep(null);
    setActiveJourneyId(null);
    setIsFormJourneyComplete(false); // Reset journey complete state for new conversation
    
    // Reset inactivity nudge state to prevent old nudges from appearing
    inactivityNudgeSentRef.current = false;
    inactivityNudgeIndexRef.current = 0;
    lastAIMessageTimeRef.current = null;
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    
    // Load fresh intro message
    try {
      const langParam = selectedLanguage && selectedLanguage !== 'auto' ? `&language=${encodeURIComponent(selectedLanguage)}` : '';
      const response = await fetch(`/api/chat/widget/intro?businessAccountId=${encodeURIComponent(businessAccountId)}${langParam}`);
      if (response.ok) {
        const data = await response.json();
        
        // Check if this is a form journey that should start with a form step
        if (data.formStep) {
          console.log('[New Chat] Restarting form journey with step:', data.formStep);
          setActiveFormStep(data.formStep);
          if (data.journeyId) {
            setActiveJourneyId(data.journeyId);
          }
          // For form journeys with start-from-scratch, don't show duplicate intro text
          // The form UI already displays the question
        } else if (data.intro) {
          // Regular chat - just show intro message
          // For conversational journeys with a dropdown/radio first step, render the
          // choices as tappable quick-reply buttons on the greeting.
          const journeyOptions: string[] | undefined = Array.isArray(data.journeyOptions) && data.journeyOptions.length > 0
            ? data.journeyOptions
            : undefined;
          if (data.journeyId) {
            setActiveJourneyId(data.journeyId);
          }
          setMessages([{
            id: '1',
            role: 'assistant',
            content: data.intro,
            timestamp: new Date(),
            quickReplies: journeyOptions
          }]);
        }
      }
    } catch (error) {
      console.error('Failed to load intro:', error);
    }
  };
  
  // Load conversation history list
  const loadConversationHistory = async () => {
    if (!businessAccountId) return;
    
    setIsLoadingConversations(true);
    try {
      const visitorToken = visitorSessionTokenRef.current;
      const response = await fetch(`/api/chat/widget/conversations?businessAccountId=${encodeURIComponent(businessAccountId)}&visitorToken=${encodeURIComponent(visitorToken)}${topscholarTokenRef.current ? `&token=${encodeURIComponent(topscholarTokenRef.current)}` : ''}${studentIdRef.current ? `&studentId=${encodeURIComponent(studentIdRef.current)}` : ''}`);
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
  
  // Open history panel
  const handleOpenHistory = () => {
    setIsMenuOpen(false);
    setIsHistoryPanelOpen(true);
    loadConversationHistory();
  };
  
  // Load a specific conversation from history
  const handleLoadConversation = async (convId: string) => {
    if (!businessAccountId) return;
    
    try {
      const response = await fetch(
        `/api/chat/widget/history?businessAccountId=${encodeURIComponent(businessAccountId)}&conversationId=${encodeURIComponent(convId)}${topscholarTokenRef.current ? `&token=${encodeURIComponent(topscholarTokenRef.current)}` : ''}${studentIdRef.current ? `&studentId=${encodeURIComponent(studentIdRef.current)}` : ''}`
      );
      
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
          
          // Update stored conversation ID
          if (data.conversationId) {
            conversationIdRef.current = data.conversationId;
            setHasConversation(true);
            localStorage.setItem(getConvKey(), data.conversationId); stampConvCreatedIfNeeded();
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
  
  // Map currency code to symbol
  const currencySymbols: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹", AUD: "A$",
    CAD: "C$", CHF: "CHF", SEK: "kr", NZD: "NZ$", SGD: "S$", HKD: "HK$",
    NOK: "kr", MXN: "$", BRL: "R$", ZAR: "R", KRW: "₩", TRY: "₺",
    RUB: "₽", IDR: "Rp", THB: "฿", MYR: "RM"
  };
  const currencySymbol = currencySymbols[currency] || "$";

  // Load intro message on mount and when language changes (only for chat modes, not voice-only)
  // Skip if history is being restored or has been restored with messages
  useEffect(() => {
    if (!businessAccountId || !settings || isRestoringHistory) return;
    if (introLoaded) return;
    if (activeFormStep) { setIntroLoaded(true); return; }

    // Skip intro loading for voice-only mode
    if (settings.chatMode === 'voice-only') return;

    // Task #23: when the pre-chat OTP gate is active and the visitor hasn't
    // verified yet, do NOT fetch or render the intro. The widget should show
    // the phone-entry modal first; pulling the intro before verification
    // would (a) reveal business content behind the gate and (b) leak an
    // unsolicited assistant message into the transcript that the visitor
    // never asked for. Once verification completes (hasConversation flips
    // true) or the gate is suppressed (preChatGateDisabled), this effect
    // re-runs and loads the intro normally.
    if (anyPreChatGateActive) return;

    // Skip intro if we have restored messages (user messages present)
    const hasUserMessages = messages.some(m => m.role === 'user');
    if (hasUserMessages) {
      setIsOnline(true);
      setIntroLoaded(true);
      return;
    }
    
    const loadIntro = async () => {
      try {
        // Include language parameter for translation
        const langParam = selectedLanguage && selectedLanguage !== 'auto' ? `&language=${encodeURIComponent(selectedLanguage)}` : '';
        // Check if this is a welcome back scenario (returning after 30+ minutes)
        const welcomeBackParam = isWelcomeBackRef.current ? '&welcomeBack=true' : '';
        const response = await fetch(`/api/chat/widget/intro?businessAccountId=${encodeURIComponent(businessAccountId)}${langParam}${welcomeBackParam}`);
        if (response.ok) {
          const data = await response.json();
          if (data.intro) {
            // For conversational journeys with a dropdown/radio first step, render the
            // choices as tappable quick-reply buttons on the greeting.
            const journeyOptions: string[] | undefined = Array.isArray(data.journeyOptions) && data.journeyOptions.length > 0
              ? data.journeyOptions
              : undefined;
            if (journeyOptions && data.journeyId) {
              setActiveJourneyId(data.journeyId);
            }
            // For form journeys, don't add the intro as a chat message since the FormStep shows the question
            // Only add intro message for non-form journeys
            if (!data.formStep) {
              setMessages(prev => {
                if (prev.length === 0) {
                  return [{
                    id: '1',
                    role: 'assistant',
                    content: data.intro,
                    timestamp: new Date(),
                    quickReplies: journeyOptions
                  }];
                }
                // If first message exists and is assistant (intro), update it
                if (prev[0]?.role === 'assistant' && prev[0]?.id === '1') {
                  return [{ ...prev[0], content: data.intro, quickReplies: journeyOptions }, ...prev.slice(1)];
                }
                return prev;
              });
            }
            setIsOnline(true);
            
            // Set active form step if it's a form journey
            if (data.formStep) {
              console.log('[Form Journey] Setting active form step from intro:', data.formStep);
              setActiveFormStep(data.formStep);
              if (data.journeyId) {
                setActiveJourneyId(data.journeyId);
              }
            }
            
            // Fetch featured products for carousel
            try {
              const featuredResponse = await fetch(`/api/chat/widget/featured-products?businessAccountId=${encodeURIComponent(businessAccountId)}`);
              if (featuredResponse.ok) {
                const featuredData = await featuredResponse.json();
                if (featuredData.enabled && featuredData.products?.length > 0) {
                  setFeaturedProducts(featuredData.products);
                  setFeaturedProductsTitle(featuredData.title || 'Featured Products');
                }
              }
            } catch (err) {
              console.error('Failed to load featured products:', err);
            }
            
            // Track intro message time for inactivity nudge
            lastAIMessageTimeRef.current = Date.now();
            
            // Reset welcome back flag after loading
            if (isWelcomeBackRef.current) {
              console.log('[Welcome Back] Welcome back message shown, resetting flag');
              isWelcomeBackRef.current = false;
            }
            
            // Mark intro as loaded
            setIntroLoaded(true);
          }
        } else {
          // Even if response not ok, mark as loaded so queue can proceed
          setIntroLoaded(true);
        }
      } catch (error) {
        console.error('Failed to load intro:', error);
        setIsOnline(false);
        // Mark intro as loaded even on error so queue can proceed
        setIntroLoaded(true);
      }
    };
    
    loadIntro();
  }, [businessAccountId, settings, selectedLanguage, isRestoringHistory, introLoaded, anyPreChatGateActive]);

  // Visitor session tracking - start session and send heartbeats
  useEffect(() => {
    if (!businessAccountId || visitorSessionStartedRef.current) return;
    
    const startVisitorSession = async () => {
      try {
        const deviceInfo = getDeviceInfo();
        const utmParams = getUTMParams();
        
        // Get referrer (only if this is an embedded widget)
        const referrer = window.parent !== window ? document.referrer : document.referrer;
        
        // Start both session tracking and page visitor tracking in parallel
        // Use parentPageUrl from postMessage if available (most reliable)
        // Fall back to document.referrer if in iframe, or window.location.href otherwise
        const effectivePageUrl = parentPageUrl || (window.parent !== window ? document.referrer : window.location.href);
        console.log('[Visitor Tracking] Using pageUrl:', effectivePageUrl, '(parentPageUrl:', parentPageUrl, ')');
        
        const [sessionResponse] = await Promise.all([
          // Session tracking (for session-level analytics)
          fetch('/api/widget/session-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessAccountId,
              sessionToken: visitorSessionTokenRef.current,
              pageUrl: effectivePageUrl,
              referrer: referrer || undefined,
              ...utmParams,
              ...deviceInfo,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
          }),
          // Page visitor tracking (for unique visitor counting)
          fetch('/api/widget/page-visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessAccountId,
              visitorToken: visitorSessionTokenRef.current,
              pageUrl: effectivePageUrl,
              ...deviceInfo,
            }),
          }),
        ]);
        
        // Capture the server-returned session ID for lead tracking
        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          if (sessionData.sessionId) {
            setVisitorSessionId(sessionData.sessionId);
            console.log('[Visitor Tracking] Got server session ID:', sessionData.sessionId);
          }
        }
        
        visitorSessionStartedRef.current = true;
        console.log('[Visitor Tracking] Session and page visitor started');
      } catch (error) {
        console.error('[Visitor Tracking] Failed to start session:', error);
      }
    };
    
    startVisitorSession();
    
    // Send heartbeat every 30 seconds to track session duration
    const heartbeatInterval = setInterval(async () => {
      if (!visitorSessionStartedRef.current) return;
      
      try {
        const durationSeconds = Math.floor((Date.now() - sessionStartTimeRef.current) / 1000);
        
        await fetch('/api/widget/session-heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionToken: visitorSessionTokenRef.current,
            businessAccountId,
            widgetOpened: true, // Widget is open if this component is rendered
            durationSeconds,
          }),
        });
      } catch (error) {
        console.error('[Visitor Tracking] Heartbeat failed:', error);
      }
    }, 30000); // Every 30 seconds
    
    return () => clearInterval(heartbeatInterval);
  }, [businessAccountId]);

  // Update visitor session with parent page URL when it arrives via postMessage
  // This handles the case where the session starts before the parent URL is received
  useEffect(() => {
    if (!parentPageUrl || !businessAccountId || !visitorSessionTokenRef.current) return;
    
    console.log('[Visitor Tracking] Updating session with parent page URL:', parentPageUrl);
    
    // Update the existing session with the correct pageUrl
    fetch('/api/widget/session-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessAccountId,
        sessionToken: visitorSessionTokenRef.current,
        pageUrl: parentPageUrl,
      }),
    }).then(() => {
      console.log('[Visitor Tracking] Session updated with parent page URL');
    }).catch((error) => {
      console.error('[Visitor Tracking] Failed to update session with parent URL:', error);
    });
  }, [parentPageUrl, businessAccountId]);

  // Smart scroll: check if user is at bottom before messages change
  const checkIfAtBottom = () => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 100; // pixels from bottom to consider "at bottom"
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  };

  // Handle scroll events to track user position
  const handleScroll = () => {
    const atBottom = checkIfAtBottom();
    setIsUserAtBottom(atBottom);
  };

  // Listen for messages from parent window (floating widget)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Handle visitor session initialization
      if (event.data && event.data.type === 'SESSION_INIT') {
        const visitorSession = event.data.visitorSessionId;
        console.log('[EmbedChat] ========== SESSION_INIT RECEIVED ==========');
        console.log('[EmbedChat] Visitor Session ID:', visitorSession);
        if (visitorSession) {
          setVisitorSessionId(visitorSession);
        }
        return;
      }
      
      // Handle parent page URL for lead source tracking (LeadSquared integration)
      // This is critical because document.referrer is unreliable in iframes
      if (event.data && event.data.type === 'PARENT_URL') {
        const pageUrl = event.data.pageUrl;
        console.log('[EmbedChat] ========== PARENT_URL RECEIVED ==========');
        console.log('[EmbedChat] Parent Page URL:', pageUrl);
        if (pageUrl) {
          setParentPageUrl(pageUrl);
        }
        return;
      }
      
      if (event.data && event.data.type === 'SEND_MESSAGE') {
        const messageText = event.data.message;
        const visitorSession = event.data.visitorSessionId;
        console.log('[EmbedChat] ========== SEND_MESSAGE RECEIVED ==========');
        console.log('[EmbedChat] Message:', messageText);
        console.log('[EmbedChat] Visitor Session ID:', visitorSession);
        console.log('[EmbedChat] businessAccountId:', businessAccountId);
        console.log('[EmbedChat] settings:', settings ? 'loaded' : 'not loaded');
        console.log('[EmbedChat] isLoadingSettings:', isLoadingSettings);
        console.log('[EmbedChat] isLoading:', isLoading);
        
        // Store visitorSessionId for discount tracking
        if (visitorSession && visitorSession !== visitorSessionId) {
          setVisitorSessionId(visitorSession);
        }
        
        if (messageText && messageText.trim()) {
          // Check if chat UI is fully ready (businessAccountId + settings loaded + not loading)
          const isUIReady = businessAccountId && settings && !isLoadingSettings && !isLoading;
          
          console.log('[EmbedChat] Is UI ready?', isUIReady);
          
          if (!isUIReady) {
            console.log('[EmbedChat] ❌ UI NOT READY - Queuing message:', messageText.trim());
            console.log('[EmbedChat] Queued message will be processed by queue processor effect');
            setPendingMessage(messageText.trim());
            return;
          }
          
          // UI is ready, send immediately using sendMessageRef
          console.log('[EmbedChat] ✅ UI READY - Sending message immediately via sendMessageRef');
          console.log('[EmbedChat] sendMessageRef.current:', sendMessageRef.current ? 'EXISTS' : 'NULL');
          console.log('[EmbedChat] isLoading:', isLoading);
          console.log('[EmbedChat] businessAccountId:', businessAccountId);
          if (sendMessageRef.current) {
            console.log('[EmbedChat] 🚀 Calling sendMessageRef.current with:', messageText.trim());
            sendMessageRef.current(messageText.trim()).catch((err) => {
              console.error('[EmbedChat] Error sending message:', err);
            });
            console.log('[EmbedChat] ✅ sendMessageRef.current called successfully');
          } else {
            console.error('[EmbedChat] ❌ sendMessageRef is null, falling back to pending queue');
            setPendingMessage(messageText.trim());
          }
        }
      }
      
      // Handle message with product context from Product Page AI Mode
      if (event.data && event.data.type === 'SEND_MESSAGE_WITH_CONTEXT') {
        const messageText = event.data.message;
        const productContext = event.data.productContext;
        console.log('[EmbedChat] ========== SEND_MESSAGE_WITH_CONTEXT RECEIVED ==========');
        console.log('[EmbedChat] Message:', messageText);
        console.log('[EmbedChat] Product context:', productContext);
        
        if (messageText && messageText.trim()) {
          // Prepend product context to the message for AI understanding
          let contextualMessage = messageText.trim();
          if (productContext && productContext.name) {
            contextualMessage = `[Asking about: ${productContext.name}${productContext.price ? ` - $${productContext.price}` : ''}] ${messageText.trim()}`;
          }
          
          const isUIReady = businessAccountId && settings && !isLoadingSettings && !isLoading;
          
          if (!isUIReady) {
            setPendingMessage(contextualMessage);
            return;
          }
          
          if (sendMessageRef.current) {
            sendMessageRef.current(contextualMessage).catch((err) => {
              console.error('[EmbedChat] Error sending product context message:', err);
            });
          } else {
            setPendingMessage(contextualMessage);
          }
        }
      }
      
      // Handle discount trigger from exit intent or idle timeout
      if (event.data && event.data.type === 'HICHRONEY_DISCOUNT_TRIGGER') {
        const { message: discountMessage, triggerType, discountPercentage, expiryMinutes } = event.data;
        console.log('[EmbedChat] ========== DISCOUNT TRIGGER RECEIVED ==========');
        console.log('[EmbedChat] Trigger type:', triggerType);
        console.log('[EmbedChat] Discount:', discountPercentage, '%');
        console.log('[EmbedChat] Message:', discountMessage);
        console.log('[EmbedChat] Expiry:', expiryMinutes, 'minutes');
        
        if (discountMessage) {
          // Add discount message as an AI assistant message
          const discountChatMessage: ChatMessage = {
            id: `discount_${Date.now()}`,
            role: 'assistant',
            content: discountMessage,
            timestamp: new Date()
          };
          
          setMessages(prev => [...prev, discountChatMessage]);
          
          // Track the discount trigger time for inactivity nudge
          lastAIMessageTimeRef.current = Date.now();
          
          console.log('[EmbedChat] ✅ Discount message added to chat');
        }
      }
      
      // Handle proactive guidance messages (for demo pages)
      if (event.data && event.data.type === 'PROACTIVE_GUIDANCE') {
        const { message: guidanceMessage, clearHistory, cleanMode, conversationStarters: ruleStarters } = event.data;
        console.log('[EmbedChat] ========== PROACTIVE GUIDANCE RECEIVED ==========');
        console.log('[EmbedChat] Guidance message:', guidanceMessage);
        console.log('[EmbedChat] Clear history:', clearHistory);
        console.log('[EmbedChat] Clean mode:', cleanMode);
        console.log('[EmbedChat] Rule starters:', ruleStarters);
        
        // Enable external guidance mode - prevents welcome message from overwriting
        externalGuidanceModeRef.current = true;
        
        // Mark proactive guidance as checked (from parent widget)
        setProactiveGuidanceChecked(true);
        
        // Apply clean mode if requested
        if (cleanMode === true) {
          console.log('[EmbedChat] Clean mode enabled from parent - hiding starters, products, nudges');
          setCleanModeEnabled(true);
        }
        
        // Apply rule-specific conversation starters
        if (Array.isArray(ruleStarters)) {
          if (ruleStarters.length > 0) {
            console.log('[EmbedChat] Applying rule conversation starters:', ruleStarters.length);
            setRuleConversationStarters(ruleStarters);
          } else {
            // Rule explicitly has empty starters - hide starters section
            console.log('[EmbedChat] Rule has empty starters - hiding starters');
            setRuleConversationStarters([]);
          }
        } else {
          // Rule doesn't define starters - reset to null to use defaults
          console.log('[EmbedChat] Rule has no starters defined - using defaults');
          setRuleConversationStarters(null);
        }
        
        if (guidanceMessage) {
          const guidanceChatMessage: ChatMessage = {
            id: `guidance_${Date.now()}`,
            role: 'assistant',
            content: guidanceMessage,
            timestamp: new Date()
          };
          
          if (clearHistory) {
            // Replace all messages with just this guidance
            setMessages([guidanceChatMessage]);
          } else {
            // Add to existing messages
            setMessages(prev => [...prev, guidanceChatMessage]);
          }
          
          lastAIMessageTimeRef.current = Date.now();
          console.log('[EmbedChat] ✅ Proactive guidance message added (external guidance mode enabled)');
        }
      }
    };
    
    window.addEventListener('message', handleMessage);
    
    return () => window.removeEventListener('message', handleMessage);
  }, [isLoading, businessAccountId, settings, isLoadingSettings]);
  
  // Signal readiness to parent window once (separate effect)
  useEffect(() => {
    // Only send once and only if we're in an iframe
    if (window.parent !== window && !hasSignaledReadyRef.current) {
      console.log('[EmbedChat] Sending EMBED_READY to parent window');
      window.parent.postMessage({ type: 'EMBED_READY' }, '*');
      hasSignaledReadyRef.current = true;
    }
  }, []); // Empty deps - only run once on mount
  
  // Track if fully ready signal has been sent
  const hasSignaledFullyReadyRef = useRef(false);
  
  // Signal WIDGET_FULLY_READY after settings are loaded and history is processed
  useEffect(() => {
    if (
      window.parent !== window && 
      !hasSignaledFullyReadyRef.current && 
      businessAccountId && 
      settings && 
      !isLoadingSettings && 
      !isRestoringHistory
    ) {
      console.log('[EmbedChat] Sending WIDGET_FULLY_READY to parent window');
      window.parent.postMessage({ type: 'WIDGET_FULLY_READY' }, '*');
      hasSignaledFullyReadyRef.current = true;
    }
  }, [businessAccountId, settings, isLoadingSettings, isRestoringHistory]);

  // Track previous offer to detect transitions (show -> hide)
  const prevOfferIdRef = useRef<string | null>(null);

  // Send urgency offer data to parent page for rendering outside iframe
  useEffect(() => {
    if (window.parent === window) return;
    if (activeOffer) {
      prevOfferIdRef.current = activeOffer.offerId;
      window.parent.postMessage({
        type: 'URGENCY_OFFER_SHOW',
        offer: {
          settings: activeOffer.settings,
          offerId: activeOffer.offerId,
          startedAt: activeOffer.startedAt,
          expiresAt: activeOffer.expiresAt,
          accentColor: chatColor,
        },
      }, '*');
    } else if (prevOfferIdRef.current) {
      prevOfferIdRef.current = null;
      window.parent.postMessage({ type: 'URGENCY_OFFER_HIDE' }, '*');
    }
  }, [activeOffer, chatColor]);

  // Listen for urgency offer actions from parent page
  useEffect(() => {
    if (window.parent === window) return;
    const handleOfferAction = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!event.data || !event.data.type) return;
      if (event.data.type === 'URGENCY_OFFER_REDEEM') {
        redeemOffer(event.data.phoneNumber || '', conversationIdRef.current || undefined).then(() => {
          window.parent.postMessage({ type: 'URGENCY_OFFER_REDEEMED' }, '*');
        }).catch((err: any) => {
          window.parent.postMessage({ type: 'URGENCY_OFFER_REDEEM_ERROR', message: err.message }, '*');
        });
      } else if (event.data.type === 'URGENCY_OFFER_DISMISS') {
        dismissOffer();
      } else if (event.data.type === 'URGENCY_OFFER_ACKNOWLEDGE') {
        acknowledgeRedemption();
      }
    };
    window.addEventListener('message', handleOfferAction);
    return () => window.removeEventListener('message', handleOfferAction);
  }, [redeemOffer, dismissOffer, acknowledgeRedemption]);
  
  // Fetch and apply proactive guidance rules based on parent page URL
  useEffect(() => {
    // If we're not ready to check yet, wait
    if (!businessAccountId || !settings || isLoadingSettings || isRestoringHistory) {
      return;
    }
    
    // If guidance already applied from external source or previous check, mark as checked and skip
    if (proactiveGuidanceAppliedRef.current || externalGuidanceModeRef.current) {
      setProactiveGuidanceChecked(true);
      return;
    }
    
    // Run immediately (no 150ms delay) to prevent race conditions
    const applyProactiveGuidance = async () => {
      try {
        // Get parent page URL from various sources
        let parentUrl = '';
        const isInIframe = window.parent !== window;
        
        // First try to get from document referrer (most reliable for iframes)
        if (document.referrer) {
          try {
            const refUrl = new URL(document.referrer);
            parentUrl = refUrl.pathname + refUrl.search;
          } catch (e) {
            // If parsing fails, extract path manually
            const match = document.referrer.match(/https?:\/\/[^\/]+(\/[^\?#]*)?/);
            if (match && match[1]) {
              parentUrl = match[1];
            }
          }
        }
        
        // If in iframe, also try to get from parent URL params
        if (!parentUrl && isInIframe) {
          const urlParams = new URLSearchParams(window.location.search);
          const sourceUrl = urlParams.get('sourceUrl') || urlParams.get('parentUrl');
          if (sourceUrl) {
            parentUrl = sourceUrl;
          }
        }
        
        // FALLBACK: If NOT in an iframe (widget embedded directly on page), use current window location
        // This handles demo pages like /demo/razorpay-rize?step=1 where widget is part of the page
        if (!parentUrl && !isInIframe) {
          parentUrl = window.location.pathname + window.location.search;
          console.log('[ProactiveGuidance] Using current window URL (not in iframe):', parentUrl);
        }
        
        if (!parentUrl) {
          console.log('[ProactiveGuidance] No parent URL detected, skipping guidance check');
          return;
        }
        
        console.log('[ProactiveGuidance] Checking guidance rules for URL:', parentUrl);
        
        // Fetch active guidance rules for this business account
        const response = await fetch(`/api/public/proactive-guidance-rules/${encodeURIComponent(businessAccountId)}`);
        if (!response.ok) {
          console.log('[ProactiveGuidance] Failed to fetch rules:', response.status);
          return;
        }
        
        const rules = await response.json();
        if (!rules || rules.length === 0) {
          console.log('[ProactiveGuidance] No active guidance rules found');
          return;
        }
        
        // URL pattern matching function with safe regex handling
        const matchesPattern = (pattern: string, url: string): boolean => {
          try {
            // Exact match
            if (pattern === url) {
              return true;
            }
            
            // Wildcard pattern match (e.g., /pricing/* matches /pricing/enterprise)
            if (pattern.includes('*')) {
              // Escape all regex special chars, then convert * to .*
              // Note: We escape special chars first (not including *), then convert * to .*
              const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
              const regexPattern = escaped.replace(/\*/g, '.*');
              const regex = new RegExp(`^${regexPattern}$`);
              return regex.test(url);
            }
            
            // Prefix match (e.g., /checkout matches /checkout?step=2)
            if (url.startsWith(pattern)) {
              return true;
            }
            
            return false;
          } catch (e) {
            console.warn('[ProactiveGuidance] Pattern matching error for:', pattern, e);
            return false;
          }
        };
        
        // Find matching rule (rules are already sorted by priority)
        const matchingRule = rules.find((rule: any) => matchesPattern(rule.urlPattern, parentUrl));
        
        if (!matchingRule) {
          console.log('[ProactiveGuidance] No matching rule found for URL:', parentUrl);
          return;
        }
        
        console.log('[ProactiveGuidance] Found matching rule:', matchingRule.name);
        
        // Mark as applied
        proactiveGuidanceAppliedRef.current = true;
        externalGuidanceModeRef.current = true;
        
        // Apply clean mode if enabled (handle both string 'true' and boolean true)
        if (matchingRule.cleanMode === 'true' || matchingRule.cleanMode === true) {
          console.log('[ProactiveGuidance] Clean mode enabled - hiding starters, products, nudges');
          setCleanModeEnabled(true);
        }
        
        // Apply rule-specific FAQs if defined
        if (matchingRule.conversationStarters) {
          try {
            const ruleFaqs = typeof matchingRule.conversationStarters === 'string'
              ? JSON.parse(matchingRule.conversationStarters)
              : matchingRule.conversationStarters;
            if (Array.isArray(ruleFaqs)) {
              console.log('[ProactiveGuidance] Applying rule FAQs:', ruleFaqs.length);
              setRuleConversationStarters(ruleFaqs);
            }
          } catch (e) {
            console.warn('[ProactiveGuidance] Failed to parse rule FAQs:', e);
          }
        }
        
        // Add guidance message as first AI message
        const guidanceMessage: ChatMessage = {
          id: `guidance_${Date.now()}`,
          role: 'assistant',
          content: matchingRule.message,
          timestamp: new Date()
        };
        
        setMessages([guidanceMessage]);
        lastAIMessageTimeRef.current = Date.now();
        
        console.log('[ProactiveGuidance] Guidance message applied successfully');
        
      } catch (error) {
        console.error('[ProactiveGuidance] Error applying guidance:', error);
      } finally {
        // Mark proactive guidance check as complete regardless of outcome
        // This allows products/starters to show if no matching rule was found
        setProactiveGuidanceChecked(true);
      }
    };
    
    // Run immediately - no delay to prevent race conditions with element rendering
    applyProactiveGuidance();
  }, [businessAccountId, settings, isLoadingSettings, isRestoringHistory]);
  
  
  // Ref to hold sendMessage function for use in queue processor
  const sendMessageRef = useRef<((msg?: string) => Promise<void>) | null>(null);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Word-by-word typing animation with adaptive gating for long responses
  const animateTyping = (
    fullText: string, 
    messageId: string, 
    products?: any[], 
    pagination?: ProductPagination,
    searchQuery?: string,
    appointmentSlots?: AppointmentSlotsData,
    jobs?: any[],
    applicantId?: string | null
  ) => {
    const words = fullText.split(' ');
    const wordCount = words.length;
    
    // Adaptive animation gating for perceived performance
    // Very long responses (200+ words): show immediately
    if (wordCount >= 200) {
      setMessages(prev => prev.map(msg => 
        msg.id === messageId 
          ? { 
              ...msg, 
              content: fullText, 
              products: products || msg.products,
              productPagination: pagination || msg.productPagination,
              productSearchQuery: searchQuery || msg.productSearchQuery,
              appointmentSlots: appointmentSlots || msg.appointmentSlots,
              jobs: jobs || msg.jobs,
              applicantId: applicantId !== undefined ? applicantId : msg.applicantId
            }
          : msg
      ));
      return;
    }
    
    // Calculate adaptive delay: faster for longer responses
    // Short (<50 words): 80ms, Medium (50-100): 50ms, Long (100-200): 30ms
    const delay = wordCount < 50 ? 80 : wordCount < 100 ? 50 : 30;
    let currentIndex = 0;

    // Set initial empty message
    setMessages(prev => prev.map(msg => 
      msg.id === messageId 
        ? { 
            ...msg, 
            content: '', 
            products: products || msg.products,
            productPagination: pagination || msg.productPagination,
            productSearchQuery: searchQuery || msg.productSearchQuery,
            appointmentSlots: appointmentSlots || msg.appointmentSlots,
            jobs: jobs || msg.jobs,
            applicantId: applicantId !== undefined ? applicantId : msg.applicantId
          }
        : msg
    ));

    const typingInterval = setInterval(() => {
      if (currentIndex < words.length) {
        const currentText = words.slice(0, currentIndex + 1).join(' ');
        setMessages(prev => 
          prev.map(msg => 
            msg.id === messageId 
              ? { 
                  ...msg, 
                  content: currentText, 
                  products: products || msg.products,
                  productPagination: pagination || msg.productPagination,
                  productSearchQuery: searchQuery || msg.productSearchQuery,
                  appointmentSlots: appointmentSlots || msg.appointmentSlots,
                  jobs: jobs || msg.jobs,
                  applicantId: applicantId !== undefined ? applicantId : msg.applicantId
                }
              : msg
          )
        );
        currentIndex++;
      } else {
        clearInterval(typingInterval);
      }
    }, delay);
  };

  // Handler for conversation starter selection
  const handleStarterSelect = (question: string) => {
    // Expand the widget first (in case it's minimized)
    window.parent.postMessage({ type: 'EXPAND_WIDGET' }, '*');
    
    setMessage(question);
    // Trigger send immediately
    setTimeout(() => {
      if (question.trim() && !isLoading && businessAccountId) {
        const sendBtn = document.querySelector('[data-send-button]') as HTMLButtonElement;
        if (sendBtn) sendBtn.click();
      }
    }, 100);
  };

  // Handle image selection - automatically uploads and searches when image is selected
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
      formData.append('businessAccountId', businessAccountId || '');

      const response = await fetch('/api/chat/widget/resume-upload', {
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
    // Finished doubt session — don't even upload; the send would be refused.
    if (doubtLockRef.current) return;

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
      formData.append('businessAccountId', businessAccountId || '');
      // TopScholar doubt-sync: forward the signed launch token so the server can
      // verify the doubt binding before routing the image through the client's S3.
      if (topscholarTokenRef.current) {
        formData.append('token', topscholarTokenRef.current);
      }

      const response = await fetch('/api/chat/widget/k12-image-upload', { method: 'POST', body: formData });
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
        sendMessage(`[IMAGE_UPLOAD] ${file.name}`);
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

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please select a JPEG, PNG, GIF, or WebP image.',
        variant: 'destructive'
      });
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please select an image smaller than 10MB.',
        variant: 'destructive'
      });
      return;
    }

    // Create preview URL
    const previewUrl = URL.createObjectURL(file);
    
    // Automatically upload and show crop overlay
    if (!businessAccountId) return;

    setIsUploadingImage(true);

    try {
      // Upload the image first
      const formData = new FormData();
      formData.append('image', file);
      formData.append('businessAccountId', businessAccountId);

      const uploadResponse = await fetch('/api/chat/widget/upload-image', {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image');
      }

      const uploadResult = await uploadResponse.json();
      const uploadedImageUrl = uploadResult.imageUrl;

      // Clean up preview URL
      URL.revokeObjectURL(previewUrl);

      // Show crop overlay for user to select area
      setPendingSearchImageUrl(uploadedImageUrl);
      setShowCropOverlay(true);
      setIsUploadingImage(false);

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return; // Stop here - search will happen when user clicks in crop overlay

    } catch (error) {
      console.error('[Image Upload] Error:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload image. Please try again.',
        variant: 'destructive'
      });
      URL.revokeObjectURL(previewUrl);
      setIsUploadingImage(false);
      return;
    }
  };

  // Perform visual search after crop overlay confirms
  const performVisualSearch = async (imageUrl: string, boundingBox?: { x: number; y: number; width: number; height: number }) => {
    if (!businessAccountId) return;

    setIsLoading(true);
    setShowCropOverlay(false);

    try {
      // Add user message with image
      const userMessageId = Date.now().toString();
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: 'Find products similar to this image',
        imageUrl: imageUrl,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);

      // Add AI thinking message
      const aiMessageId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, {
        id: aiMessageId,
        role: 'assistant',
        content: 'Analyzing your image...',
        timestamp: new Date()
      }]);

      // Call visual search endpoint (Vision Warehouse) with optional bounding box
      const matchResponse = await fetch('/api/chat/widget/visual-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessAccountId,
          imageUrl: imageUrl,
          boundingBox: boundingBox
        })
      });

      if (!matchResponse.ok) {
        throw new Error('Failed to match products');
      }

      const matchResult = await matchResponse.json();
      
      // Vision Warehouse returns products array directly
      let responseContent = '';
      let matchedProducts = matchResult.products || [];
      
      if (matchedProducts.length > 0) {
        responseContent = `I found ${matchedProducts.length} similar product${matchedProducts.length > 1 ? 's' : ''} in our catalog:`;
      } else {
        responseContent = "I couldn't find any matching products in our catalog. Would you like to describe what you're looking for?";
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

      // Clean up pending search state
      setPendingSearchImageUrl(null);

    } catch (error) {
      console.error('[Image Search] Error:', error);
      toast({
        title: 'Error',
        description: 'Failed to search for similar products. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
      setPendingSearchImageUrl(null);
    }
  };

  // Clear selected image
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

  // Upload image and show crop overlay for matching products
  const uploadAndMatchImage = async () => {
    if (!selectedImage || !businessAccountId) return;

    setIsUploadingImage(true);

    try {
      // Upload the image first
      const formData = new FormData();
      formData.append('image', selectedImage);
      formData.append('businessAccountId', businessAccountId);

      const uploadResponse = await fetch('/api/chat/widget/upload-image', {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image');
      }

      const uploadResult = await uploadResponse.json();
      const uploadedImageUrl = uploadResult.imageUrl;

      // Show crop overlay for user to select area
      setPendingSearchImageUrl(uploadedImageUrl);
      setShowCropOverlay(true);
      clearSelectedImage();

    } catch (error: any) {
      console.error('[Image Upload] Error:', error);
      toast({
        title: 'Image upload failed',
        description: error.message || 'Failed to upload image',
        variant: 'destructive'
      });
    } finally {
      setIsUploadingImage(false);
    }
  };

  // TopScholar doubt-resolution prompt helpers (Task #5).
  const armDoubtPrompt = () => {
    if (doubtPromptTimerRef.current) clearTimeout(doubtPromptTimerRef.current);
    if (!doubtSessionRef.current.active || doubtAnsweredRef.current) return;
    const secs = Math.max(10, doubtSessionRef.current.cooldownSeconds || 120);
    doubtPromptTimerRef.current = setTimeout(() => setDoubtPromptStatus('visible'), secs * 1000);
  };

  const clearDoubtPromptTimer = () => {
    if (doubtPromptTimerRef.current) {
      clearTimeout(doubtPromptTimerRef.current);
      doubtPromptTimerRef.current = null;
    }
    // If the prompt was showing but the student typed instead, hide it. It can
    // re-arm after the next AI answer (they haven't explicitly answered yet).
    setDoubtPromptStatus(prev => (prev === 'visible' ? 'hidden' : prev));
  };

  // Returns the backend's confirmation of what actually happened. `ok: true`
  // only when the action succeeded (doubt mirrored as resolved / ticket created /
  // retry delivered). On escalate, the FIRST "No" returns `retry: true` with the
  // bot's one clarify-and-simplify retry message instead of escalating.
  const submitDoubtAction = async (
    path: 'resolve' | 'escalate',
  ): Promise<{ ok: boolean; retry?: boolean; message?: string; lockState?: 'resolved' | 'escalated' }> => {
    if (doubtPromptTimerRef.current) {
      clearTimeout(doubtPromptTimerRef.current);
      doubtPromptTimerRef.current = null;
    }
    // Preview/simulation (admin Widget Tester): never hit the portal or create a
    // ticket, but mirror the production flow exactly — the first "No" simulates
    // the bot's one clarify-and-simplify retry, the second "No" simulates the
    // escalation confirmation.
    if (doubtPreviewRef.current) {
      if (path === 'escalate' && !doubtPreviewRetryUsedRef.current) {
        doubtPreviewRetryUsedRef.current = true;
        return {
          ok: true,
          retry: true,
          message:
            "I'm sorry my earlier explanation didn't fully clear your doubt. Could you tell me which part is still confusing? Meanwhile, let me try explaining it in a simpler way — sometimes a different approach helps. If it's still unclear after this, I'll connect you with our support team. (Simulated retry — in a real student session this message is generated by the AI from the conversation.)",
        };
      }
      return { ok: true };
    }
    try {
      const resp = await fetch(`/api/chat/widget/doubt/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessAccountId,
          conversationId: conversationIdRef.current || undefined,
          token: topscholarTokenRef.current || undefined,
        }),
      });
      if (!resp.ok) {
        // A 409 means the session was already ended (a replayed click, or a
        // concurrent Yes/No where this request lost). The body carries the
        // outcome that actually won, so the chat can lock to the truth.
        const errData = await resp.json().catch(() => null);
        const losing = errData?.lockState === 'resolved' || errData?.lockState === 'escalated' ? errData.lockState : undefined;
        return { ok: false, lockState: losing };
      }
      const data = await resp.json().catch(() => null);
      if (!data) return { ok: false };
      if (path === 'escalate' && data.retry === true && typeof data.message === 'string' && data.message.trim()) {
        return { ok: true, retry: true, message: data.message };
      }
      // resolve -> { ok, mirrored }; escalate -> { ok, ticketId }.
      // `lockState` is reported separately from `ok` on purpose: the server ends
      // the session even when the portal mirror or the ticket call fails, so the
      // chat must lock on the server's word rather than on our success flag.
      const lockState = data.lockState === 'resolved' || data.lockState === 'escalated' ? data.lockState : undefined;
      return { ok: path === 'resolve' ? data.mirrored === true : data.ok === true, lockState };
    } catch (err) {
      console.warn('[EmbedChat] doubt action failed:', err);
      return { ok: false };
    }
  };

  const handleDoubtResolve = async () => {
    setDoubtPromptStatus('resolving');
    const result = await submitDoubtAction('resolve');
    // The doubt is answered — this session is finished. Lock the composer even
    // if the portal mirror failed: the server closed the session either way, so
    // leaving the input live would only produce messages it will refuse.
    if (result.ok || result.lockState) setDoubtLock(result.lockState ?? 'resolved');
    if (result.ok) {
      doubtAnsweredRef.current = true;
      setDoubtPromptStatus('resolved');
    } else {
      setDoubtPromptStatus('error');
    }
  };

  const handleDoubtEscalate = async () => {
    setDoubtPromptStatus('escalating');
    const result = await submitDoubtAction('escalate');
    if (result.ok && result.retry && result.message) {
      // Retry-once flow: the bot gets ONE more attempt (clarifying question +
      // simplified explanation) before a real escalation. Show the retry message
      // in the thread and re-arm the prompt so the student can answer Yes/No again.
      setMessages(prev => [
        ...prev,
        {
          id: `doubt-retry-${Date.now()}`,
          role: 'assistant',
          content: result.message!,
          timestamp: new Date(),
        } as ChatMessage,
      ]);
      doubtAnsweredRef.current = false;
      setDoubtPromptStatus('hidden');
      armDoubtPrompt();
    } else if (result.ok) {
      doubtAnsweredRef.current = true;
      setDoubtPromptStatus('escalated');
      // Ticket raised — a human takes it from here, so the bot chat is done.
      setDoubtLock('escalated');
    } else {
      setDoubtPromptStatus('error');
    }
  };

  // Clear any pending doubt-prompt timer on unmount.
  useEffect(() => () => {
    if (doubtPromptTimerRef.current) clearTimeout(doubtPromptTimerRef.current);
  }, []);

  // Admin Widget Tester "Show prompt now": the Tester embeds this widget in an
  // iframe and can postMessage to force the doubt-resolution prompt to appear
  // immediately, bypassing the cooldown. Only honored in preview/simulation mode.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!doubtPreviewRef.current) return;
      // Only honor messages from the same-origin parent (the admin Tester embeds
      // this widget same-origin). Reject cross-origin / non-parent senders.
      if (e.origin !== window.location.origin) return;
      if (e.source !== window.parent) return;
      const data = e.data;
      if (data && typeof data === 'object' && data.type === 'aichroney:preview-doubt-show') {
        doubtAnsweredRef.current = false;
        if (doubtPromptTimerRef.current) {
          clearTimeout(doubtPromptTimerRef.current);
          doubtPromptTimerRef.current = null;
        }
        setDoubtPromptStatus('visible');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const sendMessage = async (overrideMessage?: string) => {
    const messageToSend = overrideMessage ?? message;
    if (!messageToSend.trim() || isLoading || !businessAccountId) return;
    // The doubt was resolved or escalated — this session is closed. Guards the
    // send itself rather than only the UI, so the Enter key, the photo-upload
    // flow (which calls sendMessage with [IMAGE_UPLOAD]) and any programmatic
    // caller are all covered by one check. The server enforces this too.
    if (doubtLockRef.current) return;
    const isResumeFlow = messageToSend.trim().startsWith('[RESUME_UPLOAD]');
    let resumeProgressCleared = false;

    const isK12ImageFlow = messageToSend.trim().startsWith('[IMAGE_UPLOAD]');
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
    // Student is active again — cancel any pending doubt-resolution prompt.
    clearDoubtPromptTimer();
    // Tracks whether THIS turn's stream reported a doubt-scoped session. If it
    // doesn't, we clear any stale doubt state so the prompt can't appear outside a
    // doubt session (e.g. after switching context while the widget stays mounted).
    let sawDoubtSession = false;
    // Set when the server flags this turn as an explicit escalate-to-human request:
    // the resolution prompt is shown immediately instead of after the idle cooldown.
    let doubtShowNow = false;
    setLookupState({ phase: 'idle' });
    setLookupInputValue('');
    setLookupOtpValue('');
    const isReturnExchangeLookup = lookupReturnExchangeContextRef.current;
    lookupReturnExchangeContextRef.current = false;
    
    // Update last activity time for welcome back tracking
    if (businessAccountId) {
      localStorage.setItem(`chroney_last_activity_${businessAccountId}`, Date.now().toString());
    }
    
    // Check this message for purchase intent (urgency offer)
    checkMessageIntent(messageToSend.trim(), conversationIdRef.current || undefined);
    
    // Store user message ID for scrolling after AI placeholder is added
    const userMsgIdForScroll = userMessage.id;
    void userMsgIdForScroll; // Used in scroll logic below
    
    // Keep focus on input field for continuous typing
    inputRef.current?.focus();

    // Track message sent event for visitor analytics
    if (visitorSessionStartedRef.current) {
      fetch('/api/widget/session-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: visitorSessionTokenRef.current,
          businessAccountId,
          eventType: 'message_sent',
        }),
      }).catch(err => console.error('[Visitor Tracking] Event tracking failed:', err));
    }

    // Add placeholder AI message with typing indicator
    const aiMessageId = (Date.now() + 1).toString();
    setStreamingMessageId(aiMessageId);
    setMessages(prev => [...prev, {
      id: aiMessageId,
      role: 'assistant',
      content: '.....',
      timestamp: new Date()
    }]);

    // NOW scroll user's question to top - after AI placeholder adds enough height
    requestAnimationFrame(() => {
      setTimeout(() => {
        const container = messagesContainerRef.current;
        if (container) {
          const userMsgEl = container.querySelector(`[data-message-id="${userMsgIdForScroll}"]`) as HTMLElement;
          if (userMsgEl) {
            // Calculate scroll position to put user message at top
            const scrollTarget = userMsgEl.offsetTop - 16; // 16px padding from top
            container.scrollTop = scrollTarget;
          } else {
            container.scrollTop = container.scrollHeight;
          }
        }
      }, 50);
    });

    let productsData: any[] | undefined;
    let productsPagination: ProductPagination | undefined;
    let productsSearchQuery: string | undefined;
    let appointmentSlotsData: AppointmentSlotsData | undefined;
    let jobsDataItems: any[] | undefined;
    let jobsApplicantIdValue: string | null | undefined;
    let ordersDataItems: any[] | undefined;

    try {
      const response = await fetch('/api/chat/widget/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userMessage.content, 
          businessAccountId,
          sessionId: sessionIdRef.current,
          language: selectedLanguage !== 'auto' ? selectedLanguage : undefined,
          visitorSessionId: visitorSessionId || undefined,
          sessionToken: visitorSessionTokenRef.current,
          pageUrl: parentPageUrl || undefined,
          resumeContextId: pendingResumeContextIdRef.current || undefined,
          imageContextId: pendingImageContextIdRef.current || undefined,
          isReturnExchangeLookup: isReturnExchangeLookup || undefined,
          topscholarToken: topscholarTokenRef.current || undefined,
          topscholarCpId: topscholarCpIdRef.current || undefined,
          studentBoard: studentBoardRef.current || undefined,
          studentMedium: studentMediumRef.current || undefined,
          studentGrade: studentGradeRef.current || undefined,
          studentSubject: studentSubjectRef.current || undefined,
          studentChapter: studentChapterRef.current || undefined,
          studentId: studentIdRef.current || undefined,
          name: studentNameRef.current || undefined,
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

      setStreamingMessageId(aiMessageId);
      let streamedContent = '';
      let buffer = '';
      let pendingUpdate = false;
      let lookupOptionsActive = false;

      const updateStreamingMessage = () => {
        if (pendingUpdate) return;
        pendingUpdate = true;
        
        requestAnimationFrame(() => {
          setMessages(prev => {
            const existing = prev.find(m => m.id === aiMessageId);
            const filtered = prev.filter(m => m.id !== aiMessageId);
            return [...filtered, {
              ...(existing || {}),
              id: aiMessageId,
              role: 'assistant' as const,
              content: streamedContent,
              timestamp: new Date(),
              products: productsData,
              lookupOptions: lookupOptionsActive,
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
                // Store conversationId for persistence across page refreshes
                if (data.data && businessAccountId) {
                  conversationIdRef.current = data.data;
                  setHasConversation(true);
                  localStorage.setItem(getConvKey(), data.data); stampConvCreatedIfNeeded();
                  console.log('[EmbedChat] Stored conversationId:', data.data);
                }
              } else if (data.type === 'otp_state') {
                try {
                  const snap: OtpStateSnapshot = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                  setOtpState(snap);
                  if (snap.locked && snap.locked_until) {
                    const secs = Math.max(0, Math.ceil((new Date(snap.locked_until).getTime() - Date.now()) / 1000));
                    setOtpLockRemaining(secs);
                  } else if (!snap.locked) {
                    setOtpLockRemaining(0);
                  }
                } catch (e) {
                  console.warn('[EmbedChat] Failed to parse otp_state:', e);
                }
              } else if (data.type === 'doubt_session') {
                // TopScholar doubt-scoped session: record that this conversation is
                // bound to a doubt and how long to wait before the resolution prompt.
                try {
                  const snap = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                  doubtSessionRef.current = {
                    active: !!snap?.active,
                    cooldownSeconds: Number(snap?.resolutionCooldownSeconds) || 120,
                  };
                  sawDoubtSession = !!snap?.active;
                  // Student explicitly asked to escalate / talk to a human: show the
                  // resolution prompt right away instead of waiting for idle.
                  doubtShowNow = !!snap?.active && snap?.showNow === true;
                } catch (e) {
                  console.warn('[EmbedChat] Failed to parse doubt_session:', e);
                }
              } else if (data.type === 'doubt_locked') {
                // The server refused this turn because the doubt session already
                // ended. Reaching here means our lock was stale (e.g. the student
                // answered the prompt in another tab) — catch up rather than
                // leaving a composer that silently swallows messages.
                try {
                  const snap = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                  const outcome = snap?.outcome === 'escalated' ? 'escalated' : 'resolved';
                  doubtAnsweredRef.current = true;
                  setDoubtLock(outcome);
                  setDoubtPromptStatus(outcome === 'escalated' ? 'escalated' : 'resolved');
                  // Drop the just-sent user message; it was never answered.
                  setMessages(prev => prev.filter(m => m.id !== userMessage.id));
                } catch (e) {
                  console.warn('[EmbedChat] Failed to parse doubt_locked:', e);
                }
              } else if (data.type === 'captcha_state') {
                // Mid-chat CAPTCHA challenge (custom/intent/keyword strategies).
                // The server refused the model because the conversation is
                // awaiting_verification; render the reCAPTCHA checkbox modal.
                try {
                  const snap = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                  if (snap?.required) {
                    // Force a fresh widget render for this challenge.
                    captchaWidgetIdRef.current = null;
                    setCaptchaToken(null);
                    setCaptchaError(null);
                    setMidChatCaptcha({
                      required: true,
                      siteKey: snap.siteKey ?? null,
                      provider: snap.provider ?? null,
                      misconfigured: !!snap.misconfigured,
                    });
                  }
                } catch (e) {
                  console.warn('[EmbedChat] Failed to parse captcha_state:', e);
                }
              } else if (data.type === 'lead_captured') {
                // Conversion tracking: the server captured/confirmed a mobile
                // number on an ungated capture path and won the one-time fire.
                // Load the admin-configured thank-you page in a hidden iframe so
                // the visitor's Google Ads conversion tag fires in their browser.
                fireConversion(conversationIdRef.current);
              } else if (data.type === 'content') {
                if (isResumeFlow && !resumeProgressCleared) {
                  resumeProgressCleared = true;
                  setResumeUploadStage('idle');
                }
                streamedContent += data.data;
                updateStreamingMessage();
              } else if (data.type === 'products') {
                const productResponse = JSON.parse(data.data);
                // Handle both old format (array) and new format (object with items/pagination)
                if (Array.isArray(productResponse)) {
                  productsData = productResponse;
                } else {
                  productsData = productResponse.items || [];
                  productsPagination = productResponse.pagination;
                  productsSearchQuery = productResponse.searchQuery;
                }
              } else if (data.type === 'order_lookup_options') {
                lookupOptionsActive = true;
                const lookupData = data.data ? (() => { try { return JSON.parse(data.data); } catch { return {}; } })() : {};
                const lookupMode: 'track' | 'return_exchange' = lookupData.mode === 'return_exchange' ? 'return_exchange' : 'track';
                if (lookupMode === 'return_exchange' || lookupData.returnExchange) {
                  lookupReturnExchangeContextRef.current = true;
                }
                setMessages(prev => prev.map(msg =>
                  msg.id === aiMessageId ? { ...msg, lookupOptions: true, lookupMode } : msg
                ));
              } else if (data.type === 'orders') {
                const ordersResponse = JSON.parse(data.data);
                ordersDataItems = ordersResponse.items || [];
                setMessages(prev => prev.map(msg =>
                  msg.id === aiMessageId ? { ...msg, orders: ordersDataItems } : msg
                ));
                // Scroll AI message to top of view after React renders order cards
                requestAnimationFrame(() => {
                  setTimeout(() => {
                    const container = messagesContainerRef.current;
                    if (!container) return;
                    const el = container.querySelector(`[data-message-id="${aiMessageId}"]`) as HTMLElement | null;
                    if (el) {
                      container.scrollTop = el.offsetTop - 16;
                    } else {
                      container.scrollTop = container.scrollHeight;
                    }
                  }, 120);
                });
              } else if (data.type === 'jobs') {
                const jobsResponse = JSON.parse(data.data);
                jobsDataItems = jobsResponse.items || [];
                jobsApplicantIdValue = jobsResponse.applicantId || null;
                setMessages(prev => prev.map(msg =>
                  msg.id === aiMessageId
                    ? { ...msg, jobs: jobsDataItems, applicantId: jobsApplicantIdValue }
                    : msg
                ));
              } else if (data.type === 'appointment_slots') {
                // Handle appointment slots for calendar UI - update message immediately
                console.log('[Appointments] Received slots for calendar:', data.data);
                appointmentSlotsData = JSON.parse(data.data);
                // Update the current streaming message with slots immediately so calendar renders
                setMessages(prev => prev.map(msg => 
                  msg.id === aiMessageId 
                    ? { ...msg, appointmentSlots: appointmentSlotsData }
                    : msg
                ));
              } else if (data.type === 'discount_nudge') {
                // Handle discount nudge - show offer in chat
                console.log('[Discount Nudge] Received:', data.data);
                const nudge = data.data;
                const nudgeMessage = {
                  id: Date.now().toString(),
                  role: 'assistant' as const,
                  content: `🎉 **${nudge.message}**\n\n**Your Discount Code:** \`${nudge.discountCode}\`\n${nudge.expiresAt ? `Valid until: ${new Date(nudge.expiresAt).toLocaleTimeString()}` : 'Limited time offer!'}`,
                  timestamp: new Date()
                };
                setMessages(prev => [...prev, nudgeMessage]);
              } else if (data.type === 'journey_options') {
                // Conversational journey dropdown/radio step - render choices as
                // tappable quick-reply buttons on the current AI message
                try {
                  const parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                  const opts: string[] = Array.isArray(parsed?.options) ? parsed.options : [];
                  if (opts.length > 0) {
                    setMessages(prev => prev.map(msg =>
                      msg.id === aiMessageId ? { ...msg, quickReplies: opts } : msg
                    ));
                  }
                } catch (e) {
                  console.warn('[Journey Options] Failed to parse options:', e);
                }
              } else if (data.type === 'form_step') {
                // Handle form step for form journeys - show visual input UI
                console.log('[Form Journey] Received form step:', data.data);
                const formStepData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                setActiveFormStep(formStepData);
                // Set active journey ID so form step submission works
                if (formStepData.journeyId) {
                  setActiveJourneyId(formStepData.journeyId);
                }
                // Set conversation ID so form step submission uses correct conversation
                if (formStepData.conversationId) {
                  conversationIdRef.current = formStepData.conversationId;
                  setHasConversation(true);
                  console.log('[EmbedChat] Set conversationId from form_step:', formStepData.conversationId);
                }
                // Check if form journey is complete - disable chat input
                if (formStepData.journeyComplete) {
                  console.log('[Form Journey] Journey complete - disabling chat input');
                  setIsFormJourneyComplete(true);
                }
              } else if (data.type === 'final') {
                const finalText = typeof data.data === 'string' ? data.data : '';
                if (!finalText.trim() && !streamedContent) {
                  // Task #9 (Option A): the server suppressed the assistant text
                  // for this turn (e.g. a mid-chat OTP challenge was just issued and
                  // the OTP dialog is the only verification surface). Remove the
                  // typing placeholder so no empty assistant bubble is rendered.
                  setMessages(prev => prev.filter(m => m.id !== aiMessageId));
                } else if (streamedContent) {
                  // Content was already streamed token-by-token — just commit the
                  // final state (which may differ slightly from the streamed text
                  // due to server-side post-processing). Do NOT re-animate, or the
                  // text would flicker back to empty and re-type.
                  setMessages(prev => {
                    const existing = prev.find(m => m.id === aiMessageId);
                    const filtered = prev.filter(m => m.id !== aiMessageId);
                    return [...filtered, {
                      ...(existing || {}),
                      id: aiMessageId,
                      role: 'assistant' as const,
                      content: data.data,
                      timestamp: new Date(),
                      products: productsData || existing?.products,
                      productPagination: productsPagination || existing?.productPagination,
                      productSearchQuery: productsSearchQuery || existing?.productSearchQuery,
                      appointmentSlots: appointmentSlotsData || existing?.appointmentSlots,
                      jobs: jobsDataItems || existing?.jobs,
                      applicantId: jobsApplicantIdValue !== undefined ? jobsApplicantIdValue : existing?.applicantId,
                    }];
                  });
                } else {
                  // No real streaming happened — use word-by-word animation (smooth UX)
                  animateTyping(data.data, aiMessageId, productsData, productsPagination, productsSearchQuery, appointmentSlotsData, jobsDataItems, jobsApplicantIdValue);
                }
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
    } finally {
      setIsLoading(false);
      setStreamingMessageId(null);
      setLookupState({ phase: 'idle' });
      setLookupInputValue('');
      setLookupOtpValue('');
      if (isResumeFlow && !resumeProgressCleared) {
        setResumeUploadStage('idle');
      }
      
      // Track when AI finished responding for inactivity nudge
      lastAIMessageTimeRef.current = Date.now();

      // TopScholar: after the tutor answers a doubt-scoped session, arm the
      // "Did this resolve your doubt?" prompt to fire after the configured idle
      // period (unless the student already answered it this session). If this turn
      // was NOT a doubt session, clear any stale doubt state so the prompt can't
      // surface in a non-doubt context.
      if (sawDoubtSession) {
        // Real doubt session always wins: keep its live behavior (real
        // resolve/escalate), never the simulated no-op path.
        if (doubtShowNow && !doubtAnsweredRef.current) {
          // Explicit escalate-to-human request: surface the prompt immediately.
          if (doubtPromptTimerRef.current) {
            clearTimeout(doubtPromptTimerRef.current);
            doubtPromptTimerRef.current = null;
          }
          setDoubtPromptStatus('visible');
        } else {
          armDoubtPrompt();
        }
      } else if (doubtPreviewRef.current) {
        // Preview/simulation: the server never emits doubt_session in the Tester,
        // so keep the session armed locally after every tutor answer.
        doubtSessionRef.current.active = true;
        armDoubtPrompt();
      } else {
        doubtSessionRef.current.active = false;
        if (doubtPromptTimerRef.current) {
          clearTimeout(doubtPromptTimerRef.current);
          doubtPromptTimerRef.current = null;
        }
      }
      
      // Update last activity time when AI responds (for welcome back tracking)
      if (businessAccountId) {
        localStorage.setItem(`chroney_last_activity_${businessAccountId}`, Date.now().toString());
      }
    }
  };

  // Store sendMessage in ref for use in queue processor
  sendMessageRef.current = sendMessage;

  // Process queued pending message once UI is fully ready
  useEffect(() => {
    console.log('[Queue Processor] Effect triggered');
    console.log('[Queue Processor] businessAccountId:', businessAccountId);
    console.log('[Queue Processor] settings:', settings ? 'loaded' : 'not loaded');
    console.log('[Queue Processor] isLoadingSettings:', isLoadingSettings);
    console.log('[Queue Processor] isLoading:', isLoading);
    console.log('[Queue Processor] pendingMessage:', pendingMessage);
    console.log('[Queue Processor] introLoaded:', introLoaded);
    console.log('[Queue Processor] activeFormStep:', activeFormStep ? 'active' : 'null');
    
    // Wait for intro to load before processing pending message
    if (businessAccountId && settings && !isLoadingSettings && pendingMessage && !isLoading && introLoaded) {
      // If a form journey is active, discard the pending message - don't send to AI chat
      if (activeFormStep) {
        console.log('[Queue Processor] Form journey is active, discarding pending message to prevent AI chat overlay');
        setPendingMessage(null);
        return;
      }
      
      const queuedMessage = pendingMessage;
      console.log('[Queue Processor] ========== ALL CONDITIONS MET ==========');
      console.log('[Queue Processor] Processing queued message:', queuedMessage);
      
      if (sendMessageRef.current) {
        console.log('[Queue Processor] Calling sendMessage directly with:', queuedMessage);
        setPendingMessage(null);
        sendMessageRef.current(queuedMessage).catch((err) => {
          console.error('[Queue Processor] Error sending message, requeueing:', err);
          setPendingMessage(queuedMessage);
        });
      } else {
        console.error('[Queue Processor] sendMessageRef is null!');
      }
    } else {
      console.log('[Queue Processor] Conditions not met, waiting...');
    }
  }, [businessAccountId, settings, isLoadingSettings, isLoading, pendingMessage, introLoaded, activeFormStep]);

  // Inactivity nudge effect - sends sequential reminders if user stops responding
  useEffect(() => {
    if (!settings?.inactivityNudgeEnabled || settings.inactivityNudgeEnabled === 'false') return;
    if (cleanModeEnabled) return; // Skip nudges in clean mode
    if (isFormJourneyComplete) return; // Skip nudges after form journey is complete - chat is disabled
    // Task #18: never nudge while visitor is on the OTP step. The OTP modal is
    // a hard gate — pinging "still there?" mid-verification is jarring and
    // collides with the lockout/resend countdowns.
    if (otpState.awaiting_otp || otpState.locked) return;
    if (!lastAIMessageTimeRef.current) return;
    if (messages.length < 1) return; // Need at least the intro message
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== 'assistant') return; // Only trigger after AI responds
    if (isLoading) return; // Don't trigger while AI is thinking
    
    // Build full message sequence: first message + additional messages
    // When Smart Nudge is enabled, we support 2 nudges: AI-generated first, then "Are you there?"
    const isSmartNudgeEnabled = settings.smartNudgeEnabled === 'true';
    const baseDelay = parseInt(settings.inactivityNudgeDelay || "45");
    
    const allNudgeMessages: { message: string; delay: number }[] = [
      { 
        message: settings.inactivityNudgeMessage || "Still there? Let me know if you need any help!", 
        delay: baseDelay 
      }
    ];
    
    // When Smart Nudge is enabled, add a second "Are you there?" nudge
    if (isSmartNudgeEnabled) {
      allNudgeMessages.push({
        message: "Are you still there? I'm here to help if you need anything!",
        delay: baseDelay
      });
    } else if (settings.inactivityNudgeMessages && Array.isArray(settings.inactivityNudgeMessages)) {
      // For manual mode, use the configured additional messages
      allNudgeMessages.push(...settings.inactivityNudgeMessages);
    }
    
    const currentIndex = inactivityNudgeIndexRef.current;
    
    // Check if we've sent all messages (stop the sequence)
    if (currentIndex >= allNudgeMessages.length) return;
    
    const currentNudge = allNudgeMessages[currentIndex];
    const nudgeDelaySeconds = currentNudge.delay;
    const nudgeMessage = currentNudge.message;
    
    // Clear any existing timer
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    
    // Set new timer for current message in sequence
    inactivityTimerRef.current = setTimeout(async () => {
      // Check if user hasn't sent a message since last AI response
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
      const lastAIMessage = [...messages].reverse().find(m => m.role === 'assistant');
      
      if (lastAIMessage && (!lastUserMessage || lastAIMessage.timestamp > lastUserMessage.timestamp)) {
        let finalNudgeMessage = nudgeMessage;
        
        // Try smart nudge for FIRST nudge only (AI-generated contextual follow-up)
        // Second nudge uses the static "Are you there?" message
        const shouldUseSmartNudge = isSmartNudgeEnabled && currentIndex === 0;
        
        if (shouldUseSmartNudge && businessAccountId) {
          try {
            console.log('[Smart Nudge] Generating contextual follow-up...');
            
            // Prepare conversation history for smart nudge
            const conversationHistory = messages
              .filter(m => m.role === 'user' || m.role === 'assistant')
              .slice(-6)
              .map(m => ({ role: m.role, content: m.content }));

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

            const response = await fetch('/api/chat/widget/smart-nudge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                businessAccountId,
                conversationHistory,
                targetLanguage: selectedLanguage !== 'auto' ? selectedLanguage : undefined,
                visitorSessionId,
                // Task #18: let server short-circuit smart-nudge when this
                // conversation is awaiting OTP verification.
                conversationId: conversationIdRef.current || undefined,
              }),
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              const data = await response.json();
              if (data.nudgeMessage && data.isSmartNudge) {
                finalNudgeMessage = data.nudgeMessage;
                console.log('[Smart Nudge] Using AI-generated message:', finalNudgeMessage.slice(0, 50) + '...');
              } else {
                // Non-smart nudge response - treat as failure for translation purposes
                throw new Error('Smart nudge returned non-AI message');
              }
            } else {
              // HTTP error - throw to trigger fallback translation
              throw new Error(`Smart nudge failed with status ${response.status}`);
            }
          } catch (error: any) {
            if (error.name === 'AbortError') {
              console.log('[Smart Nudge] Timeout - falling back to static message');
            } else {
              console.error('[Smart Nudge] Failed - falling back to static message:', error?.message || error);
            }
            // Smart nudge failed - translate fallback message if non-English
            if (finalNudgeMessage === nudgeMessage && selectedLanguage && selectedLanguage !== 'auto' && selectedLanguage !== 'en' && businessAccountId) {
              try {
                const translateResponse = await fetch('/api/chat/widget/translate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    businessAccountId,
                    text: nudgeMessage,
                    targetLanguage: selectedLanguage
                  })
                });
                if (translateResponse.ok) {
                  const data = await translateResponse.json();
                  if (data.translatedText) {
                    finalNudgeMessage = data.translatedText;
                  }
                }
              } catch (translateError) {
                console.error('Failed to translate fallback nudge:', translateError);
              }
            }
          }
        } else if (selectedLanguage && selectedLanguage !== 'auto' && selectedLanguage !== 'en' && businessAccountId) {
          // Translate static nudge message if non-English language is selected (smart nudge disabled)
          try {
            const response = await fetch('/api/chat/widget/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                businessAccountId,
                text: nudgeMessage,
                targetLanguage: selectedLanguage
              })
            });
            if (response.ok) {
              const data = await response.json();
              if (data.translatedText) {
                finalNudgeMessage = data.translatedText;
              }
            }
          } catch (error) {
            console.error('Failed to translate nudge:', error);
          }
        }
        
        const nudgeType = isSmartNudgeEnabled 
          ? (currentIndex === 0 ? 'AI contextual' : 'follow-up') 
          : 'manual';
        console.log(`[Inactivity Nudge] Showing ${nudgeType} message ${currentIndex + 1}/${allNudgeMessages.length}`);
        
        // Add nudge message as AI message
        inactivityNudgeSentRef.current = true;
        inactivityNudgeIndexRef.current = currentIndex + 1; // Move to next message in sequence
        
        setMessages(prev => [...prev, {
          id: `nudge-${Date.now()}`,
          role: 'assistant',
          content: finalNudgeMessage,
          timestamp: new Date()
        }]);
        
        // Save nudge to conversation history in database (if we have a conversationId)
        if (conversationIdRef.current) {
          fetch('/api/chat/widget/save-nudge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversationId: conversationIdRef.current,
              message: finalNudgeMessage
            })
          }).catch(err => console.error('[Inactivity Nudge] Failed to save nudge:', err));
        }
        
        // Update the last AI message time to trigger the next nudge in sequence
        lastAIMessageTimeRef.current = Date.now();
        inactivityNudgeSentRef.current = false; // Allow next message to be scheduled
      }
    }, nudgeDelaySeconds * 1000);
    
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [messages, settings, isLoading, selectedLanguage, businessAccountId, isFormJourneyComplete, otpState.awaiting_otp, otpState.locked]);
  
  // Clear inactivity timer when form journey completes
  useEffect(() => {
    if (isFormJourneyComplete && inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
      console.log('[Inactivity Nudge] Cleared timer - form journey complete');
    }
  }, [isFormJourneyComplete]);

  // Task #18: when visitor enters the OTP step (awaiting_otp or locked),
  // proactively clear any pending nudge timer and reset the sequence index so
  // that once verification completes the nudge cadence starts cleanly.
  useEffect(() => {
    if (otpState.awaiting_otp || otpState.locked) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      inactivityNudgeIndexRef.current = 0;
      inactivityNudgeSentRef.current = false;
      console.log('[Inactivity Nudge] Suppressed — visitor is on OTP step.');
    }
  }, [otpState.awaiting_otp, otpState.locked]);
  
  // Reset inactivity nudge when user sends a new message
  useEffect(() => {
    if (messages.length === 0) return;
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user') {
      // User sent a message, reset the entire inactivity nudge sequence
      inactivityNudgeSentRef.current = false;
      inactivityNudgeIndexRef.current = 0; // Reset to first message in sequence
      lastAIMessageTimeRef.current = null;
      
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    }
  }, [messages]);
  
  // Cleanup timers on component unmount
  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, []);

  if (!businessAccountId) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8">
          <p className="text-gray-600">Missing businessAccountId parameter</p>
        </div>
      </div>
    );
  }

  // Show loading state while settings load (especially important for auto-open voice mode)
  if (isLoadingSettings || !settings) {
    // Check if this is an auto-open voice request
    const urlParams = new URLSearchParams(window.location.search);
    const isAutoOpenVoice = urlParams.get('autoOpenVoice') === 'true';
    
    if (isAutoOpenVoice) {
      // Show minimal loading state for voice mode auto-open
      return (
        <div className="h-screen w-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #9333ea, #3b82f6)' }}>
          <div className="text-center">
            <div className="w-20 h-20 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-white text-sm">Connecting...</p>
          </div>
        </div>
      );
    }
    
    // Futuristic loading skeleton for standard chat mode
    // Uses h-full to respect parent container dimensions (not force full viewport)
    return (
      <div className="flex flex-col h-full min-h-0 bg-white overflow-hidden">
        {/* Skeleton Header */}
        <div className="flex-shrink-0 text-white shadow-md relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #9333ea, #3b82f6)' }}>
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 animate-pulse" />
              <div className="space-y-2">
                <div className="w-24 h-4 bg-white/20 rounded animate-pulse" />
                <div className="w-16 h-3 bg-white/20 rounded animate-pulse" />
              </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-white/20 animate-pulse" />
          </div>
          {/* Animated scan line */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div 
              className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-white/40 to-transparent"
              style={{
                animation: 'scanLine 2s ease-in-out infinite',
              }}
            />
          </div>
        </div>
        
        {/* Skeleton Chat Area */}
        <div className="flex-1 min-h-0 p-4 space-y-4 overflow-auto">
          {/* AI Message Skeleton */}
          <div className="flex justify-start">
            <div className="max-w-[80%] space-y-2">
              <div className="w-48 h-4 bg-gray-200 rounded animate-pulse" />
              <div className="w-64 h-4 bg-gray-200 rounded animate-pulse" />
              <div className="w-40 h-4 bg-gray-200 rounded animate-pulse" />
            </div>
          </div>
          
          {/* Typing indicator skeleton */}
          <div className="flex justify-start items-center gap-1">
            <div className="flex gap-1 p-3">
              <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs text-gray-400 ml-2">AI is warming up...</span>
          </div>
        </div>
        
        {/* Skeleton Input Area */}
        <div className="flex-shrink-0 p-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-10 bg-gray-100 rounded-full animate-pulse" />
            <div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse" />
          </div>
        </div>
        
        {/* Inline keyframes for scan line animation */}
        <style>{`
          @keyframes scanLine {
            0% { transform: translateY(-100%); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translateY(400%); opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  // Function to close widget on mobile (sends message to parent)
  const handleCloseWidget = () => {
    console.log('[EmbedChat] Sending close message to parent');
    try {
      // Try to send message to parent window
      if (window.parent && window.parent !== window) {
        window.parent.postMessage('CLOSE_WIDGET', '*');
        console.log('[EmbedChat] Close message sent');
      } else {
        console.warn('[EmbedChat] No parent window found');
      }
    } catch (error) {
      console.error('[EmbedChat] Failed to send close message:', error);
    }
  };

  // If voice-only mode, render just the voice orb (not the chat interface)
  if (settings?.chatMode === 'voice-only' && settings?.voiceModeEnabled) {
    return (
      <>
        {/* Animated Voice Orb - positioned like chat bubble */}
        <div className="fixed bottom-5 right-5 w-24 h-24 z-50">
          {/* Outer pulse rings (shimmer effect) */}
          {[0, 1].map((index) => (
            <motion.div
              key={`pulse-${index}`}
              className="absolute inset-0 rounded-full border-2"
              style={{
                borderColor: `${chatColor}40`,
              }}
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.6, 0, 0.6],
              }}
              transition={{
                duration: 2.5,
                repeat: Infinity,
                delay: index * 1.25,
                ease: "easeOut"
              }}
            />
          ))}
          
          <motion.button
            // Voice-only tenants render this orb INSTEAD of the chat composer,
            // so the locked composer below never applies to them. Without this
            // guard a resolved/escalated doubt could still be talked to.
            onClick={() => { if (!doubtLock) setIsVoiceModeOpen(true); }}
            disabled={!!doubtLock}
            className={`w-24 h-24 shadow-2xl flex items-center justify-center overflow-hidden relative ${doubtLock ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
            aria-label={doubtLock ? 'This doubt is closed' : 'Start voice chat'}
            animate={{
              scale: [1, 1.02, 1],
              borderRadius: ['50%', '48%', '50%', '52%', '50%'],
            }}
            transition={{
              scale: {
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut"
              },
              borderRadius: {
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }
            }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
          {/* Animated cloud blobs inside orb */}
          <div className="absolute inset-0 z-0">
            {/* Cloud blob 1 */}
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.4) 35%, transparent 65%)',
                filter: 'blur(15px)',
              }}
              animate={{
                x: ['-20px', '15px', '-20px'],
                y: ['-15px', '10px', '-15px'],
                scale: [1, 1.2, 1],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
            
            {/* Cloud blob 2 */}
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.35) 35%, transparent 65%)',
                filter: 'blur(18px)',
              }}
              animate={{
                x: ['18px', '-18px', '18px'],
                y: ['12px', '-15px', '12px'],
                scale: [1.1, 0.9, 1.1],
              }}
              transition={{
                duration: 7,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.8
              }}
            />
            
            {/* Cloud blob 3 */}
            <motion.div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: '72px',
                height: '72px',
                background: 'radial-gradient(circle, rgba(255, 255, 255, 0.88) 0%, rgba(255, 255, 255, 0.38) 35%, transparent 65%)',
                filter: 'blur(16px)',
              }}
              animate={{
                x: ['-12px', '18px', '-12px'],
                y: ['15px', '-12px', '15px'],
                scale: [1, 1.3, 1],
              }}
              transition={{
                duration: 6.5,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 1.5
              }}
            />
          </div>

          {/* Inner glow */}
          <motion.div 
            className="absolute inset-0 rounded-full blur-2xl z-0"
            animate={{
              opacity: [0.4, 0.6, 0.4],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            style={{
              background: `radial-gradient(circle, ${chatColor}80, transparent)`,
            }}
          />
          
          {/* Avatar or mic icon */}
          {settings.avatarType && settings.avatarType !== 'none' ? (
            <div className="relative z-20 w-16 h-16 rounded-full overflow-hidden border-2 border-white/30 shadow-lg">
              <img 
                src={settings.avatarType === 'custom' ? settings.avatarUrl : `/avatars/avatar-${settings.avatarType.replace('preset-', '')}.png`}
                alt="AI Assistant"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <Mic className="relative z-20 w-10 h-10 text-white drop-shadow-lg" />
          )}
        </motion.button>

        {/* Voice Mode */}
        <Suspense fallback={<LazyLoadingFallback />}>
          <VoiceMode
            isOpen={isVoiceModeOpen}
            onClose={() => {
              setIsVoiceModeOpen(false);
              // If this was auto-opened from widget.js, notify parent to close iframe
              const urlParams = new URLSearchParams(window.location.search);
              if (urlParams.get('autoOpenVoice') === 'true') {
                handleCloseWidget();
              }
            }}
            userId={widgetUserIdRef.current}
            businessAccountId={businessAccountId}
            widgetHeaderText={widgetHeaderText}
            chatColor={chatColor}
            chatColorEnd={chatColorEnd}
            voiceModeStyle={voiceModeStyle}
            avatarType={settings?.avatarType}
            avatarUrl={settings?.avatarUrl}
            topscholarToken={topscholarTokenRef.current || undefined}
            topscholarCpId={topscholarCpIdRef.current || undefined}
          />
        </Suspense>
        </div>
      </>
    );
  }

  const LOOKUP_OPTS = [
    { type: 'mobile' as const, icon: '📱', label: 'Mobile Number', sub: 'Your 10-digit phone number', inputType: 'tel' as const, placeholder: 'e.g. 9876543210' },
    { type: 'email'  as const, icon: '✉️', label: 'Email ID', sub: 'Your registered email address', inputType: 'email' as const, placeholder: 'e.g. you@example.com' },
    { type: 'order'  as const, icon: '🔖', label: 'Order ID', sub: 'e.g., #LB1001', inputType: 'text' as const, placeholder: 'e.g. #LB1001' },
  ];

  const performDirectOrderLookup = async (identifierType: 'phone' | 'email' | 'order_id', identifierValue: string, otp?: string) => {
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: identifierValue,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLookupState({ phase: 'idle' });
    setLookupInputValue('');
    setLookupOtpValue('');

    const aiMsgId = (Date.now() + 1).toString();
    setStreamingMessageId(aiMsgId);
    setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant' as const, content: '.....', timestamp: new Date() }]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/demo-orders/widget-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessAccountId, identifierType, identifierValue, otp }),
      });
      const typeLabel = identifierType === 'phone' ? 'phone number' : identifierType === 'email' ? 'email address' : 'order ID';
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const errText = err?.error === 'OTP verification required'
          ? 'OTP verification failed. Please try again.'
          : `Sorry, something went wrong. Please try again.`;
        setMessages(prev => prev.map(msg =>
          msg.id === aiMsgId ? { ...msg, content: errText } : msg
        ));
        return;
      }
      const data = await res.json();
      if (!data.success) {
        setMessages(prev => prev.map(msg =>
          msg.id === aiMsgId ? { ...msg, content: `Sorry, something went wrong. Please try again.` } : msg
        ));
        return;
      }
      const orders: any[] = data.orders || [];
      const replyText = orders.length > 0
        ? `Here ${orders.length === 1 ? 'is' : 'are'} the order${orders.length > 1 ? 's' : ''} I found:`
        : `Sorry, I couldn't find any orders for that ${typeLabel}. Please double-check or try a different method.`;
      setMessages(prev => prev.map(msg =>
        msg.id === aiMsgId
          ? { ...msg, content: replyText, orders: orders.length > 0 ? orders : undefined }
          : msg
      ));
      // Scroll AI message to top of view after React renders the order cards
      requestAnimationFrame(() => {
        setTimeout(() => {
          const container = messagesContainerRef.current;
          if (!container) return;
          const el = container.querySelector(`[data-message-id="${aiMsgId}"]`) as HTMLElement | null;
          if (el) {
            container.scrollTop = el.offsetTop - 16;
          } else {
            container.scrollTop = container.scrollHeight;
          }
        }, 120);
      });
    } catch {
      setMessages(prev => prev.map(msg =>
        msg.id === aiMsgId ? { ...msg, content: 'Sorry, something went wrong. Please try again.' } : msg
      ));
    } finally {
      setIsLoading(false);
      setStreamingMessageId(null);
    }
  };

  const handleLookupInputSubmit = () => {
    if (!lookupInputValue.trim()) return;
    const current = lookupState as Extract<LookupPhase, { phase: 'input' }>;
    if (current.type === 'order') {
      void performDirectOrderLookup('order_id', lookupInputValue.trim());
    } else {
      setLookupState({ phase: 'otp', type: current.type, value: lookupInputValue.trim(), messageId: current.messageId, error: false });
      setLookupInputValue('');
      setLookupOtpValue('');
    }
  };

  const handleLookupOtpSubmit = () => {
    const DEMO_OTP = '7777';
    if (lookupOtpValue !== DEMO_OTP) {
      setLookupState(prev => ({ ...(prev as Extract<LookupPhase, { phase: 'otp' }>), error: true }));
      setLookupOtpValue('');
      return;
    }
    const current = lookupState as Extract<LookupPhase, { phase: 'otp' }>;
    const identifierType = current.type === 'mobile' ? 'phone' : current.type === 'email' ? 'email' : 'order_id';
    void performDirectOrderLookup(identifierType, current.value, lookupOtpValue);
  };

  return (
    <div 
      className="flex flex-col bg-gray-50"
      style={{ 
        height: '100%',
        width: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        overscrollBehavior: 'none',
        fontFamily: "'Poppins', sans-serif"
      }}
    >
      {/* Drag handle indicator for mobile bottom sheet */}
      <div className="w-full flex justify-center pt-2 pb-1 bg-transparent flex-shrink-0 md:hidden" style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}>
        <div className="w-10 h-1 bg-white/40 rounded-full"></div>
      </div>
      
      {/* Chat Header - Compact in partial mode (small viewport height) */}
      <div 
        className="embed-chat-header flex items-center gap-2 px-3 py-2 text-white shadow-lg flex-shrink-0"
        style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
      >
        <div className="embed-chat-avatar w-7 h-7 rounded-full flex items-center justify-center overflow-hidden bg-white/20">
          {settings?.avatarType && settings.avatarType !== 'none' ? (
            <img 
              src={settings.avatarType === 'custom' ? settings.avatarUrl : `/avatars/avatar-${settings.avatarType.replace('preset-', '')}.png`}
              alt="AI Assistant"
              className="w-full h-full object-cover"
            />
          ) : (
            <img src="/c_logo.png" alt="AI Chroney" className="w-5 h-5 object-contain" />
          )}
        </div>
        <div className="flex-1">
          <h2 className="embed-chat-title font-semibold text-base">{widgetHeaderText}</h2>
        </div>
        {/* Language selector - show if enabled and has multiple languages */}
        {languageSelectorEnabled && availableLanguages.length > 1 && (
          <div className="relative" ref={languageDropdownRef}>
            <button
              onClick={() => setIsLanguageDropdownOpen(!isLanguageDropdownOpen)}
              className="embed-chat-btn px-2 py-1 rounded-md hover:bg-white/20 transition-colors flex items-center gap-1 text-sm"
              aria-label="Select language"
              title={`Language: ${LANGUAGE_CONFIG[selectedLanguage]?.name || 'Auto-detect'}`}
            >
              <span>{LANGUAGE_CONFIG[selectedLanguage]?.shortLabel || 'Auto'}</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${isLanguageDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {/* Language dropdown */}
            <AnimatePresence>
              {isLanguageDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[140px] max-h-[280px] overflow-y-auto"
                  style={{ maxWidth: 'calc(100vw - 40px)' }}
                >
                  <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 border-b">
                    Languages
                  </div>
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
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center justify-between gap-2 transition-colors ${
                          selectedLanguage === langCode ? 'bg-purple-50 text-purple-700' : 'text-gray-700'
                        }`}
                      >
                        <span className="font-medium">{lang.nativeName}</span>
                        {selectedLanguage === langCode && (
                          <span className="text-purple-600">✓</span>
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {/* Voice mode button - only show if enabled and mode allows it */}
        {settings?.voiceModeEnabled && (settings?.chatMode === 'both' || settings?.chatMode === 'voice-only' || !settings?.chatMode) && (
          <button
            onClick={() => {
              if (isInlineVoiceActive) {
                setIsInlineVoiceActive(false);
              } else if (!isMenuMode && !activeFormStep && !isFormJourneyComplete && !doubtLock) {
                setIsInlineVoiceActive(true);
              }
            }}
            // Voice talks to its own WebSocket and never consults the text
            // composer, so a locked doubt session has to disable it explicitly —
            // otherwise the mic is an open back door into a closed chat.
            disabled={!!doubtLock}
            className={`embed-chat-btn p-1 rounded-full transition-colors ${isInlineVoiceActive ? 'bg-white/30' : 'hover:bg-white/20'} ${doubtLock ? 'opacity-40 cursor-not-allowed' : ''}`}
            aria-label="Voice mode"
            title={doubtLock ? 'This doubt is closed' : 'Voice mode'}
          >
            <Mic className="w-4 h-4" />
          </button>
        )}
        
        {/* Three-dot menu — hidden for K12/TopScholar embeds (client doesn't want
            students to see New Chat / Conversation History). Gated on the account's
            k12EducationEnabled flag, a signed launch token, or a full grade scope. */}
        {!hideHeaderMenu && (
        <div className="relative" ref={menuDropdownRef}>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="embed-chat-btn p-1 rounded-full hover:bg-white/20 transition-colors"
            aria-label="Menu"
            title="Menu"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[160px]"
              >
                <button
                  onClick={handleNewChat}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 text-gray-700 transition-colors"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                  <span>New Chat</span>
                </button>
                <button
                  onClick={handleOpenHistory}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 text-gray-700 transition-colors"
                >
                  <History className="w-4 h-4" />
                  <span>Conversation History</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        )}
        
        {/* Close button - only visible on mobile */}
        <button
          onClick={handleCloseWidget}
          className="embed-chat-btn md:hidden p-1 rounded-full hover:bg-white/20 transition-colors"
          aria-label="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Menu Navigation Mode - Show visual menu instead of chat */}
      {/* Task #23: suppress menu UI entirely while the pre-chat OTP gate is
          active so the visitor cannot interact with menu items (which would
          trigger journeys / send messages) before verifying. */}
      {!anyPreChatGateActive && isMenuMode && menuEnabled && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <Suspense fallback={<LazyLoadingFallback />}>
          <ChatMenuNavigation
            businessAccountId={businessAccountId}
            chatColor={chatColor}
            chatColorEnd={chatColorEnd}
            avatarUrl={settings?.avatarType && settings.avatarType !== 'none' && !(settings.avatarType === 'custom' && !settings.avatarUrl) ? (settings.avatarType === 'custom' ? settings.avatarUrl : `/avatars/avatar-${settings.avatarType.replace('preset-', '')}.png`) : undefined}
            selectedLanguage={selectedLanguage}
            pageUrl={parentPageUrl || undefined}
            conversationId={conversationIdRef.current || undefined}
            onSwitchToChat={() => setIsMenuMode(false)}
            onSendMessage={(message, itemId) => {
              setIsMenuMode(false);
              if (sentChatMenuItemsRef.current.has(itemId)) {
                return;
              }
              sentChatMenuItemsRef.current.add(itemId);
              setMessage(message);
              setTimeout(() => {
                const sendBtn = document.querySelector('[data-send-button]') as HTMLButtonElement;
                if (sendBtn) sendBtn.click();
              }, 100);
            }}
            onStartJourney={async (journeyId) => {
              try {
                const response = await fetch(`/api/journey/${journeyId}/first-step?businessAccountId=${businessAccountId}`);
                if (!response.ok) {
                  console.error('[Menu] Failed to get journey first step');
                  return;
                }
                const data = await response.json();
                if (data.formStep) {
                  setMessages([]);
                  setIntroLoaded(true);
                  setIsMenuMode(false);
                  setActiveJourneyId(journeyId);
                  setActiveFormStep(data.formStep);
                  setIsFormJourneyComplete(false);
                }
              } catch (error) {
                console.error('[Menu] Error starting journey:', error);
              }
            }}
          />
        </Suspense>
        </div>
      )}

      {/* Back to Menu button - shown when menu is enabled but user is in chat/form view */}
      {/* Task #23: hide while pre-chat OTP gate is active — visitor must not
          be able to navigate into menu mode before verifying. */}
      {!anyPreChatGateActive && !isMenuMode && menuEnabled && (
        <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center">
          <button
            onClick={() => {
              setIsMenuMode(true);
              setActiveFormStep(null);
              setIsFormJourneyComplete(false);
              setActiveJourneyId(null);
              if (messages.length === 0) {
                setIntroLoaded(false);
              }
            }}
            className="flex items-center gap-1.5 text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ color: chatColor }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Back to Menu
          </button>
        </div>
      )}

      {/* Task #23: Pre-chat phone-entry modal. Shown when the business has
          pre-chat OTP gating enabled (mobile required at start + OTP enabled
          + MSG91 configured) AND this visitor has not yet started a
          conversation AND the OTP modal isn't already active. On submit we
          POST /otp/start which creates the conversation server-side and
          issues the OTP challenge; the response transitions us into the
          existing OTP modal flow. */}
      {/* Task #23: dropped the `!isMenuMode` condition so the modal renders
          even when menu mode would otherwise be auto-enabled. The gate is
          owned by `preChatGateActive`, not by which mode happens to be
          selected. */}
      {preChatGateActive &&
        !isRestoringHistory &&
        !otpState.awaiting_otp &&
        !otpState.locked && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="phone-modal-title"
          data-testid="phone-entry-modal-overlay"
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          style={{ top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div className="w-full max-w-xs rounded-2xl bg-white shadow-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-white"
                style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <h2 id="phone-modal-title" className="text-sm font-semibold text-gray-900">
                Enter your mobile to start
              </h2>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              We'll send you a 6-digit code to verify it's really you. Chat unlocks right after.
            </p>
            {/* Task #3: channel toggle — only rendered when admin chose
                "Both" and the visitor can actually pick between SMS and
                WhatsApp. For single-channel businesses we silently send via
                the only available channel. */}
            {(settings?.otpChannels?.length || 0) > 1 && selectedOtpChannel && (
              <div
                role="radiogroup"
                aria-label="How should we send your code?"
                data-testid="otp-channel-picker"
                className="mb-3 grid grid-cols-2 gap-2"
              >
                {(['sms', 'whatsapp'] as const).map((ch) => {
                  if (!settings?.otpChannels?.includes(ch)) return null;
                  const active = selectedOtpChannel === ch;
                  return (
                    <button
                      key={ch}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid={`button-otp-channel-${ch}`}
                      onClick={() => setSelectedOtpChannel(ch)}
                      disabled={phoneSubmitting}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium transition-colors ${
                        active
                          ? 'border-purple-400 bg-purple-50 text-purple-800'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                      } disabled:opacity-60`}
                    >
                      {ch === 'sms' ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                          </svg>
                          SMS
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                          </svg>
                          WhatsApp
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (phoneSubmitting) return;
                const cleaned = phoneInput.replace(/\D/g, '');
                const rule = settings?.phoneValidation || '10';
                let valid = false;
                if (rule === '10') valid = cleaned.length === 10;
                else if (rule === '12') valid = cleaned.length === 12;
                else if (rule === '8-12') valid = cleaned.length >= 8 && cleaned.length <= 12;
                else valid = cleaned.length >= 6 && cleaned.length <= 15;
                if (!valid) {
                  setPhoneError(
                    rule === '10'
                      ? 'Please enter a 10-digit mobile number.'
                      : rule === '12'
                        ? 'Please enter a 12-digit mobile number (including country code).'
                        : rule === '8-12'
                          ? 'Please enter a valid mobile number (8–12 digits).'
                          : 'Please enter a valid mobile number.'
                  );
                  return;
                }
                if (!businessAccountId) {
                  setPhoneError('Chat is loading. Please try again in a moment.');
                  return;
                }
                setPhoneSubmitting(true);
                setPhoneError(null);
                try {
                  const resp = await fetch('/api/chat/widget/otp/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      businessAccountId,
                      phone: cleaned,
                      sessionId: sessionIdRef.current,
                      sessionToken: visitorSessionTokenRef.current || widgetUserIdRef.current,
                      // Task #3: pin visitor's choice; server ignores when
                      // only one channel is configured.
                      channel: selectedOtpChannel || undefined,
                    }),
                  });
                  const data = await resp.json().catch(() => ({}));
                  // Task #23: server returns { ok:true, gate:false } when the
                  // pre-chat gate is no longer active (admin disabled OTP or
                  // MSG91 became unconfigured after settings were cached).
                  // Dismiss the modal and let the visitor chat normally.
                  if (resp.ok && data.ok && data.gate === false) {
                    setPreChatGateDisabled(true);
                    setPhoneInput("");
                    return;
                  }
                  // Task #23: when server returns ok:false with a soft-failure
                  // reason like 'locked' (rate-limited / max attempts), it
                  // STILL gives us a conversationId + actionable otp_state.
                  // Hydrate that state and dismiss the modal so the existing
                  // OTP lockout banner / state machine takes over, matching
                  // the same UX as a mid-chat lockout. Only hard input errors
                  // (invalid_phone) stay in the modal with inline error.
                  if (resp.ok && !data.ok && data?.otp_state && data?.conversationId &&
                      (data?.reason === 'locked' || data.otp_state?.locked || data.otp_state?.awaiting_otp)) {
                    conversationIdRef.current = data.conversationId;
                    setHasConversation(true);
                    if (businessAccountId) {
                      localStorage.setItem(getConvKey(), data.conversationId); stampConvCreatedIfNeeded();
                    }
                    setOtpState(data.otp_state);
                    setPhoneInput("");
                    return;
                  }
                  if (!resp.ok || !data.ok) {
                    setPhoneError(
                      data?.reason === 'invalid_phone'
                        ? 'That mobile number doesn\'t look right. Please check and try again.'
                        : data?.reason === 'msg91_not_configured'
                          ? 'Verification is temporarily unavailable. Please try again later.'
                          : data?.reason === 'send_failed'
                            ? 'Couldn\'t send the code. Please try again in a moment.'
                            : 'Couldn\'t send the code. Please try again.'
                    );
                    return;
                  }
                  if (data.conversationId && businessAccountId) {
                    conversationIdRef.current = data.conversationId;
                    setHasConversation(true);
                    localStorage.setItem(getConvKey(), data.conversationId); stampConvCreatedIfNeeded();
                  }
                  if (data.otp_state) {
                    setOtpState(data.otp_state);
                  }
                  // Task #3: remember which channel the server actually sent
                  // through so the OTP modal can show "Code sent via X" and
                  // offer the right "try other instead" affordance.
                  if (data.delivery_channel === 'sms' || data.delivery_channel === 'whatsapp') {
                    setLastDeliveryChannel(data.delivery_channel);
                  }
                  setPhoneInput("");
                } catch (err) {
                  console.error('[Phone entry] /otp/start failed:', err);
                  setPhoneError('Network error. Please check your connection and try again.');
                } finally {
                  setPhoneSubmitting(false);
                }
              }}
            >
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                autoFocus
                data-testid="input-phone-entry"
                aria-label="Mobile number"
                value={phoneInput}
                onChange={(e) => {
                  setPhoneInput(e.target.value.replace(/[^\d+\s-]/g, ''));
                  if (phoneError) setPhoneError(null);
                }}
                className="w-full text-base px-3 py-3 rounded-xl border border-gray-300 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-200 bg-white"
                placeholder={settings?.phoneValidation === '12' ? 'e.g. 919876543210' : 'e.g. 9876543210'}
                disabled={phoneSubmitting}
              />
              {phoneError && (
                <div
                  role="alert"
                  aria-live="polite"
                  data-testid="phone-entry-error"
                  className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {phoneError}
                </div>
              )}
              <button
                type="submit"
                data-testid="button-phone-entry-submit"
                disabled={phoneSubmitting || phoneInput.replace(/\D/g, '').length < 6}
                className="mt-3 w-full h-10 rounded-xl text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                style={{
                  background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`,
                  border: 'none',
                }}
              >
                {phoneSubmitting ? 'Sending code…' : 'Send verification code'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Pre-chat CAPTCHA modal — phone entry + Google reCAPTCHA v2 checkbox.
          Mutually exclusive with the OTP gate. On submit we POST to
          /api/chat/widget/captcha/verify; success unlocks the chat, failure
          keeps the modal open (the number is still saved server-side as
          unverified) and resets the checkbox for a retry. */}
      {preChatCaptchaActive && !isRestoringHistory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="captcha-modal-title"
          data-testid="captcha-entry-modal-overlay"
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          style={{ top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div className="w-full max-w-xs rounded-2xl bg-white shadow-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-white"
                style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h2 id="captcha-modal-title" className="text-sm font-semibold text-gray-900">
                Verify to start chatting
              </h2>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              Enter your mobile number and complete the verification below. Chat unlocks right after.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (captchaSubmitting) return;
                const cleaned = phoneInput.replace(/\D/g, '');
                const rule = settings?.phoneValidation || '10';
                let valid = false;
                if (rule === '10') valid = cleaned.length === 10;
                else if (rule === '12') valid = cleaned.length === 12;
                else if (rule === '8-12') valid = cleaned.length >= 8 && cleaned.length <= 12;
                else valid = cleaned.length >= 6 && cleaned.length <= 15;
                if (!valid) {
                  setCaptchaError(
                    rule === '10'
                      ? 'Please enter a 10-digit mobile number.'
                      : rule === '12'
                        ? 'Please enter a 12-digit mobile number (including country code).'
                        : rule === '8-12'
                          ? 'Please enter a valid mobile number (8–12 digits).'
                          : 'Please enter a valid mobile number.'
                  );
                  return;
                }
                if (!captchaToken) {
                  setCaptchaError('Please complete the verification challenge.');
                  return;
                }
                if (!businessAccountId) {
                  setCaptchaError('Chat is loading. Please try again in a moment.');
                  return;
                }
                setCaptchaSubmitting(true);
                setCaptchaError(null);
                try {
                  const resp = await fetch('/api/chat/widget/captcha/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      businessAccountId,
                      phone: cleaned,
                      token: captchaToken,
                      sessionId: sessionIdRef.current,
                      sessionToken: visitorSessionTokenRef.current || widgetUserIdRef.current,
                      pageUrl: typeof window !== 'undefined' ? (window.location?.href || null) : null,
                    }),
                  });
                  const data = await resp.json().catch(() => ({}));
                  // Gate disabled after settings were cached → skip the modal.
                  if (resp.ok && data.ok && data.gate === false) {
                    setPreChatCaptchaGateDisabled(true);
                    setPhoneInput("");
                    return;
                  }
                  if (!resp.ok || !data.ok) {
                    setCaptchaError(
                      data?.reason === 'invalid_phone'
                        ? 'That mobile number doesn\'t look right. Please check and try again.'
                        : data?.message || 'Could not verify. Please try again.'
                    );
                    resetCaptchaWidget();
                    return;
                  }
                  // Server always returns a conversationId (the pending row).
                  if (data.conversationId && businessAccountId) {
                    conversationIdRef.current = data.conversationId;
                    setHasConversation(true);
                    localStorage.setItem(getConvKey(), data.conversationId); stampConvCreatedIfNeeded();
                  }
                  if (data.verified) {
                    // Cleared the gate — unlock the chat surfaces.
                    setPreChatCaptchaVerified(true);
                    setPhoneInput("");
                    // Conversion tracking: server confirmed the number → fire.
                    if (data.leadCaptured) fireConversion(data.conversationId ?? conversationIdRef.current);
                  } else {
                    // Failed: number saved as unverified, chat stays locked.
                    setCaptchaError(data?.message || 'Verification failed. Please try the challenge again.');
                    resetCaptchaWidget();
                  }
                } catch (err) {
                  console.error('[CAPTCHA entry] verify failed:', err);
                  setCaptchaError('Network error. Please check your connection and try again.');
                  resetCaptchaWidget();
                } finally {
                  setCaptchaSubmitting(false);
                }
              }}
            >
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                autoFocus
                data-testid="input-phone-captcha-entry"
                aria-label="Mobile number"
                value={phoneInput}
                onChange={(e) => {
                  setPhoneInput(e.target.value.replace(/[^\d+\s-]/g, ''));
                  if (captchaError) setCaptchaError(null);
                }}
                className="w-full text-base px-3 py-3 rounded-xl border border-gray-300 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-200 bg-white"
                placeholder={settings?.phoneValidation === '12' ? 'e.g. 919876543210' : 'e.g. 9876543210'}
                disabled={captchaSubmitting}
              />
              {settings?.captchaMisconfigured ? (
                // Fail-closed UX: CAPTCHA was selected but isn't configured. We
                // never silently unlock — show an honest "unavailable" notice
                // and keep the chat locked.
                <div
                  role="alert"
                  data-testid="captcha-unavailable-notice"
                  className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                >
                  Verification is temporarily unavailable. Please try again later.
                </div>
              ) : (
                <div
                  ref={captchaContainerRef}
                  data-testid="captcha-widget-container"
                  className="mt-3 flex justify-center"
                />
              )}
              {captchaError && (
                <div
                  role="alert"
                  aria-live="polite"
                  data-testid="captcha-entry-error"
                  className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {captchaError}
                </div>
              )}
              <button
                type="submit"
                data-testid="button-captcha-entry-submit"
                disabled={
                  captchaSubmitting ||
                  !!settings?.captchaMisconfigured ||
                  phoneInput.replace(/\D/g, '').length < 6 ||
                  !captchaToken
                }
                className="mt-3 w-full h-10 rounded-xl text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                style={{
                  background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`,
                  border: 'none',
                }}
              >
                {captchaSubmitting ? 'Verifying…' : 'Verify & start chatting'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Mid-chat CAPTCHA modal — reCAPTCHA v2 checkbox only (NO phone input).
          Shown when the server emits a captcha_state because the conversation is
          awaiting_verification (custom/intent/keyword strategies). The phone was
          already captured mid-chat, so we only need the challenge. We POST the
          conversationId to /api/chat/widget/captcha/verify; success unlocks the
          chat (clears `required`), failure resets the checkbox for a retry. */}
      {midChatCaptchaActive && !isRestoringHistory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="midchat-captcha-modal-title"
          data-testid="midchat-captcha-modal-overlay"
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          style={{ top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div className="w-full max-w-xs rounded-2xl bg-white shadow-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-white"
                style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h2 id="midchat-captcha-modal-title" className="text-sm font-semibold text-gray-900">
                Verify to continue
              </h2>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              Please complete the verification below to continue chatting.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (captchaSubmitting) return;
                if (!captchaToken) {
                  setCaptchaError('Please complete the verification challenge.');
                  return;
                }
                if (!businessAccountId) {
                  setCaptchaError('Chat is loading. Please try again in a moment.');
                  return;
                }
                if (!conversationIdRef.current) {
                  setCaptchaError('Could not find your chat session. Please refresh and try again.');
                  return;
                }
                setCaptchaSubmitting(true);
                setCaptchaError(null);
                try {
                  const resp = await fetch('/api/chat/widget/captcha/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      businessAccountId,
                      token: captchaToken,
                      conversationId: conversationIdRef.current,
                      sessionToken: visitorSessionTokenRef.current || widgetUserIdRef.current,
                      pageUrl: typeof window !== 'undefined' ? (window.location?.href || null) : null,
                    }),
                  });
                  const data = await resp.json().catch(() => ({}));
                  // Gate disabled after settings were cached → skip and resume.
                  if (resp.ok && data.ok && data.gate === false) {
                    setMidChatCaptcha({ required: false, siteKey: null, provider: null, misconfigured: false });
                    return;
                  }
                  if (!resp.ok || !data.ok) {
                    setCaptchaError(data?.message || 'Could not verify. Please try again.');
                    resetCaptchaWidget();
                    return;
                  }
                  if (data.verified) {
                    // Cleared the gate — unlock and let the visitor continue.
                    setMidChatCaptcha({ required: false, siteKey: null, provider: null, misconfigured: false });
                    setCaptchaToken(null);
                    // Conversion tracking: server confirmed the number → fire.
                    if (data.leadCaptured) fireConversion(data.conversationId ?? conversationIdRef.current);
                  } else {
                    // Failed: chat stays locked, reset for a retry.
                    setCaptchaError(data?.message || 'Verification failed. Please try the challenge again.');
                    resetCaptchaWidget();
                  }
                } catch (err) {
                  console.error('[CAPTCHA mid-chat] verify failed:', err);
                  setCaptchaError('Network error. Please check your connection and try again.');
                  resetCaptchaWidget();
                } finally {
                  setCaptchaSubmitting(false);
                }
              }}
            >
              {midChatCaptcha.misconfigured ? (
                <div
                  role="alert"
                  data-testid="midchat-captcha-unavailable-notice"
                  className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                >
                  Verification is temporarily unavailable. Please try again later.
                </div>
              ) : (
                <div
                  ref={captchaContainerRef}
                  data-testid="midchat-captcha-widget-container"
                  className="mt-1 flex justify-center"
                />
              )}
              {captchaError && (
                <div
                  role="alert"
                  aria-live="polite"
                  data-testid="midchat-captcha-error"
                  className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {captchaError}
                </div>
              )}
              <button
                type="submit"
                data-testid="button-midchat-captcha-submit"
                disabled={captchaSubmitting || midChatCaptcha.misconfigured || !captchaToken}
                className="mt-3 w-full h-10 rounded-xl text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                style={{
                  background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`,
                  border: 'none',
                }}
              >
                {captchaSubmitting ? 'Verifying…' : 'Verify & continue'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Task #18: OTP modal overlay (inside chatbox). Rendered above the messages
          area so the rest of the chat is visually blocked until verification or
          lockout resolves. Reuses existing otpState (server-driven via SSE) and
          the existing `message`/`sendMessage` flow so the verify path is
          untouched — only presentation changes. */}
      {/* Task #23: also render during pre-chat gate even if isMenuMode would
          otherwise be true — the OTP step must always be reachable once a
          challenge is active. */}
      {(!isMenuMode || preChatGateActive) && (otpState.awaiting_otp || otpState.locked) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="otp-modal-title"
          data-testid="otp-modal-overlay"
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          style={{ top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <div className="w-full max-w-xs rounded-2xl bg-white shadow-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-white"
                style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h2 id="otp-modal-title" className="text-sm font-semibold text-gray-900">
                Verify your mobile
              </h2>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              {otpState.locked
                ? 'Too many incorrect attempts. Verification is temporarily locked.'
                : (
                  <>
                    We sent a 6-digit code{' '}
                    {/* Task #3: surface delivery channel so visitors know
                        where to look for the code (WhatsApp vs SMS inbox). */}
                    {lastDeliveryChannel === 'whatsapp'
                      ? <>via <strong>WhatsApp</strong> to </>
                      : lastDeliveryChannel === 'sms'
                        ? <>via <strong>SMS</strong> to </>
                        : 'to '}
                    <strong>{otpState.phone_masked || 'your mobile'}</strong>. Enter it below to continue.
                  </>
                )}
            </p>
            {settings?.otpDemoActive && !otpState.locked && (
              <div
                data-testid="otp-modal-demo-hint"
                className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                Demo mode — enter <strong>111111</strong> to continue. No SMS is sent.
              </div>
            )}
            {otpState.locked ? (
              <div
                role="alert"
                aria-live="polite"
                data-testid="otp-modal-lockout"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                Try again in{' '}
                <strong>
                  {Math.floor(otpLockRemaining / 60)}:{String(otpLockRemaining % 60).padStart(2, '0')}
                </strong>
                .
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const cleaned = otpInput.replace(/\D/g, '');
                  if (cleaned.length !== 6 || otpSubmitting) return;
                  if (!businessAccountId || !conversationIdRef.current) {
                    setOtpError('Verification is unavailable right now. Please reload and try again.');
                    return;
                  }
                  setOtpSubmitting(true);
                  setOtpError(null);
                  try {
                    const resp = await fetch('/api/chat/widget/otp/verify', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        businessAccountId,
                        conversationId: conversationIdRef.current,
                        code: cleaned,
                        // Task #10: ask the server for a post-verify confirmation
                        // message ONLY for mid-chat verifications. In the
                        // pre-chat gate the intro renders instead, so suppress it.
                        injectConfirmation: !preChatGateActive,
                        language: selectedLanguage !== 'auto' ? selectedLanguage : undefined,
                      }),
                    });
                    const data = await resp.json().catch(() => ({}));
                    // Treat 5xx as a network-style failure so the visitor
                    // sees an actionable message instead of mystery state.
                    // 4xx (400 invalid_format) still carries a useful body.
                    if (!resp.ok && resp.status >= 500) {
                      setOtpError('Verification is temporarily unavailable. Please try again in a moment.');
                      setOtpInput("");
                      setTimeout(() => otpInputRef.current?.focus(), 0);
                      return;
                    }
                    if (data.verified) {
                      if (data.otp_state) setOtpState(data.otp_state);
                      setOtpInput("");
                      setOtpError(null);
                      setOtpStatus(null);
                      // Task #10: for a mid-chat verification the server stores
                      // a short friendly confirmation in the transcript and
                      // returns it here, so the chat doesn't look empty once the
                      // OTP modal closes. Render it as an assistant bubble. The
                      // pre-chat gate omits this (intro renders instead).
                      if (data.confirmationMessage) {
                        setMessages(prev => [...prev, {
                          id: `otp-confirm-${Date.now()}`,
                          role: 'assistant' as const,
                          content: data.confirmationMessage,
                          timestamp: new Date(),
                        }]);
                      }
                      // Task #23: flip the pre-chat gate OFF only after the
                      // server confirms verification. This unlocks the intro
                      // fetch, transcript, composer, and menu surfaces.
                      setPreChatOtpVerified(true);
                      // Conversion tracking: number confirmed via OTP → fire.
                      if (data.leadCaptured) fireConversion(conversationIdRef.current);
                    } else {
                      // On failed verify: merge useful snapshot fields
                      // (attempts/resends/locked) but DO NOT let a snapshot
                      // that says awaiting_otp=false silently close the
                      // modal — `expired` and `no_active_challenge` both
                      // return such snapshots and the visitor needs to see
                      // the error + resend guidance.
                      if (data.otp_state) {
                        setOtpState(prev => ({
                          ...prev,
                          awaiting_otp: data.otp_state.locked ? prev.awaiting_otp : true,
                          locked: !!data.otp_state.locked,
                          phone_masked: data.otp_state.phone_masked ?? prev.phone_masked,
                          attempts_remaining: data.otp_state.attempts_remaining ?? prev.attempts_remaining,
                          resends_remaining: data.otp_state.resends_remaining ?? prev.resends_remaining,
                          resend_available_at: data.otp_state.resend_available_at ?? prev.resend_available_at,
                          locked_until: data.otp_state.locked_until ?? prev.locked_until,
                          expires_at: data.otp_state.expires_at ?? prev.expires_at,
                        }));
                        if (data.otp_state.locked && data.otp_state.locked_until) {
                          const secs = Math.max(0, Math.ceil((new Date(data.otp_state.locked_until).getTime() - Date.now()) / 1000));
                          setOtpLockRemaining(secs);
                        }
                      }
                      setOtpError(otpReasonToMessage(data.reason));
                      setOtpStatus(null);
                      setOtpInput("");
                      // Refocus the input so the visitor can immediately retry
                      // (especially important for wrong_code).
                      setTimeout(() => otpInputRef.current?.focus(), 0);
                    }
                  } catch (err) {
                    console.error('[OTP modal] verify failed:', err);
                    setOtpError('Network error. Please check your connection and try again.');
                    setTimeout(() => otpInputRef.current?.focus(), 0);
                  } finally {
                    setOtpSubmitting(false);
                  }
                }}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  pattern="[0-9]*"
                  data-testid="input-otp-modal"
                  aria-label="6-digit verification code"
                  ref={otpInputRef}
                  value={otpInput}
                  onChange={(e) => {
                    setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                    if (otpError) setOtpError(null);
                    if (otpStatus) setOtpStatus(null);
                  }}
                  className="w-full text-center text-2xl font-mono tracking-[0.5em] px-3 py-3 rounded-xl border border-gray-300 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-200 bg-white"
                  style={{ fontSize: '22px', letterSpacing: '0.4em' }}
                  placeholder="••••••"
                  disabled={otpSubmitting}
                />
                {otpError && (
                  <div
                    role="alert"
                    aria-live="polite"
                    data-testid="otp-modal-error"
                    className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                  >
                    {otpError}
                  </div>
                )}
                {otpStatus && !otpError && (
                  <div
                    role="status"
                    aria-live="polite"
                    data-testid="otp-modal-status"
                    className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
                  >
                    {otpStatus}
                  </div>
                )}
                <button
                  type="submit"
                  data-testid="button-otp-modal-verify"
                  disabled={otpSubmitting || otpInput.replace(/\D/g, '').length !== 6}
                  className="mt-3 w-full h-10 rounded-xl text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                  style={{
                    background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`,
                    border: 'none',
                  }}
                >
                  {otpSubmitting ? 'Verifying…' : 'Verify'}
                </button>
                <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
                  <span data-testid="text-otp-attempts">
                    {typeof otpState.attempts_remaining === 'number'
                      ? `${otpState.attempts_remaining} attempt${otpState.attempts_remaining === 1 ? '' : 's'} left`
                      : ''}
                  </span>
                  <span data-testid="text-otp-resends">
                    {typeof otpState.resends_remaining === 'number'
                      ? `${otpState.resends_remaining} resend${otpState.resends_remaining === 1 ? '' : 's'} left`
                      : ''}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="button-otp-modal-resend"
                  disabled={
                    otpResending ||
                    otpSubmitting ||
                    otpResendCooldown > 0 ||
                    (typeof otpState.resends_remaining === 'number' && otpState.resends_remaining <= 0)
                  }
                  onClick={async () => {
                    if (!businessAccountId || !conversationIdRef.current) return;
                    setOtpResending(true);
                    setOtpError(null);
                    setOtpStatus(null);
                    try {
                      const resp = await fetch('/api/chat/widget/otp/resend', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          businessAccountId,
                          conversationId: conversationIdRef.current,
                          // Task #3: resend stays on the channel last used
                          // unless the visitor explicitly toggled — see the
                          // "try [other] instead" button below.
                          channel: lastDeliveryChannel || undefined,
                        }),
                      });
                      const data = await resp.json().catch(() => ({}));
                      if (!resp.ok && resp.status >= 500) {
                        setOtpError('Couldn\'t reach the server. Please try again in a moment.');
                        return;
                      }
                      if (data.otp_state) {
                        setOtpState(data.otp_state);
                        if (data.otp_state.locked && data.otp_state.locked_until) {
                          const secs = Math.max(0, Math.ceil((new Date(data.otp_state.locked_until).getTime() - Date.now()) / 1000));
                          setOtpLockRemaining(secs);
                        }
                      }
                      if (data.ok) {
                        setOtpInput("");
                        // Task #3: track confirmed delivery channel from server.
                        if (data.delivery_channel === 'sms' || data.delivery_channel === 'whatsapp') {
                          setLastDeliveryChannel(data.delivery_channel);
                        }
                        // Source cooldown duration from server so UI matches
                        // backend RESEND_COOLDOWN_SECONDS even if it changes.
                        setOtpResendCooldown(
                          Math.max(1, Number(data.cooldown_seconds) || 60)
                        );
                        const channelLabel = data.delivery_channel === 'whatsapp' ? ' via WhatsApp' : data.delivery_channel === 'sms' ? ' via SMS' : '';
                        setOtpStatus(
                          data.otp_state?.phone_masked
                            ? `New code sent${channelLabel} to ${data.otp_state.phone_masked}.`
                            : `New code sent${channelLabel}.`
                        );
                        setTimeout(() => otpInputRef.current?.focus(), 0);
                      } else {
                        if (data.reason === 'cooldown' && data.retry_after_seconds) {
                          setOtpResendCooldown(Math.max(1, Number(data.retry_after_seconds) || 60));
                        }
                        setOtpError(otpReasonToMessage(data.reason));
                      }
                    } catch (err) {
                      console.error('[OTP modal] resend failed:', err);
                      setOtpError('Network error. Please check your connection and try again.');
                    } finally {
                      setOtpResending(false);
                    }
                  }}
                  className="mt-2 w-full text-xs text-gray-600 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed underline-offset-2 hover:underline"
                >
                  {otpResending
                    ? 'Sending new code…'
                    : otpResendCooldown > 0
                      ? `Resend code in ${otpResendCooldown}s`
                      : 'Didn\'t get the code? Resend'}
                </button>
                {/* Task #3: "Try [other channel] instead" affordance — only
                    when the admin offers both channels AND we have an active
                    resend slot. Sends a resend pinned to the OTHER channel
                    and updates lastDeliveryChannel accordingly. */}
                {(settings?.otpChannels?.length || 0) > 1 &&
                  lastDeliveryChannel &&
                  !otpState.locked &&
                  (typeof otpState.resends_remaining !== 'number' || otpState.resends_remaining > 0) && (
                    <button
                      type="button"
                      data-testid="button-otp-modal-switch-channel"
                      disabled={otpResending || otpSubmitting || otpResendCooldown > 0}
                      onClick={async () => {
                        if (!businessAccountId || !conversationIdRef.current) return;
                        const other: 'sms' | 'whatsapp' = lastDeliveryChannel === 'sms' ? 'whatsapp' : 'sms';
                        if (!settings?.otpChannels?.includes(other)) return;
                        setOtpResending(true);
                        setOtpError(null);
                        setOtpStatus(null);
                        try {
                          const resp = await fetch('/api/chat/widget/otp/resend', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              businessAccountId,
                              conversationId: conversationIdRef.current,
                              channel: other,
                            }),
                          });
                          const data = await resp.json().catch(() => ({}));
                          if (data.otp_state) setOtpState(data.otp_state);
                          if (data.ok) {
                            if (data.delivery_channel === 'sms' || data.delivery_channel === 'whatsapp') {
                              setLastDeliveryChannel(data.delivery_channel);
                            } else {
                              setLastDeliveryChannel(other);
                            }
                            setOtpInput("");
                            setOtpResendCooldown(Math.max(1, Number(data.cooldown_seconds) || 60));
                            setOtpStatus(`New code sent via ${other === 'whatsapp' ? 'WhatsApp' : 'SMS'}.`);
                          } else {
                            if (data.reason === 'cooldown' && data.retry_after_seconds) {
                              setOtpResendCooldown(Math.max(1, Number(data.retry_after_seconds) || 60));
                            }
                            setOtpError(otpReasonToMessage(data.reason));
                          }
                        } catch (err) {
                          console.error('[OTP modal] switch-channel resend failed:', err);
                          setOtpError('Network error. Please check your connection and try again.');
                        } finally {
                          setOtpResending(false);
                        }
                      }}
                      className="mt-1 w-full text-xs text-gray-500 hover:text-gray-800 disabled:text-gray-300 disabled:cursor-not-allowed"
                    >
                      Try {lastDeliveryChannel === 'sms' ? 'WhatsApp' : 'SMS'} instead
                    </button>
                  )}
              </form>
            )}
          </div>
        </div>
      )}

      {/* Chat Messages - Takes remaining space with scroll containment */}
      {/* Task #23: hide the transcript while the pre-chat gate is active —
          there should be nothing to read or scroll until verification. */}
      {!isMenuMode && !anyPreChatGateActive && (
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-white min-h-0 relative"
        style={{ 
          overscrollBehavior: 'contain',
          overscrollBehaviorX: 'contain',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: '350px', // Extra space so any message can scroll to top
          overflowAnchor: 'none' // Prevent browser auto-adjusting scroll position
        }}
      >
        {messages.map((msg, msgIndex) => {
          const lastUserMsg = messages.slice(0, msgIndex).filter(m => m.role === 'user').at(-1)?.content || '';
          return (
          <div 
            key={msg.id}
            data-message-id={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`${(msg.products && msg.products.length > 0) || (msg.matchedProducts && msg.matchedProducts.length > 0) || (msg.jobs && msg.jobs.length > 0) ? 'w-full' : 'max-w-[85%]'} ${msg.role === 'user' ? 'order-2' : ''} ${msg.role === 'assistant' ? 'flex items-start gap-2' : ''}`}>
              {/* AI Avatar - shown for assistant messages */}
              {msg.role === 'assistant' && settings && (
                settings.avatarType && settings.avatarType !== 'none' && !(settings.avatarType === 'custom' && !settings.avatarUrl) ? (
                    <img
                      src={settings.avatarType === 'custom' ? settings.avatarUrl : `/avatars/avatar-${settings.avatarType.replace('preset-', '')}.png`}
                      alt={settings.widgetHeaderText || 'AI'}
                      className="w-8 h-8 rounded-full object-cover border border-gray-200 flex-shrink-0 mt-1"
                    />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 border border-gray-200 overflow-hidden"
                    style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                  >
                    <img src="/c_logo.png" alt="AI Chroney" className="w-6 h-6 object-contain" />
                  </div>
                )
              )}
              <div className="flex-1 min-w-0">
              <div
                className={`${
                  msg.role === 'user'
                    ? 'rounded-2xl px-4 py-3 text-white'
                    : 'py-1'
                }`}
                style={msg.role === 'user' ? { background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` } : { color: '#1e3a5f' }}
              >
                {/* Show uploaded image in user message - compact clickable thumbnail */}
                {msg.role === 'user' && msg.imageUrl && !msg.content.startsWith('[IMAGE_UPLOAD]') && (
                  <div className="mb-2">
                    <img 
                      src={msg.imageUrl} 
                      alt="Uploaded" 
                      className="w-16 h-16 object-cover rounded-lg border border-white/30 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setExpandedImageUrl(msg.imageUrl || null)}
                    />
                  </div>
                )}
                {msg.role === 'assistant' && msg.content === '.....' ? (
                  <TypingIndicator />
                ) : msg.role === 'assistant' && voiceHighlight?.messageId === msg.id ? (
                  // Voice karaoke: while this answer is being spoken aloud,
                  // show the raw spoken transcript with the heard portion
                  // highlighted, clocked off audio playback. Swaps back to
                  // normal Markdown the moment playback ends.
                  <div className="font-medium leading-relaxed" style={{ fontSize: chatFontSize }}>
                    <KaraokeText
                      text={voiceSpokenTextRef.current.get(msg.id) ?? msg.content}
                      offset={voiceHighlight.offset}
                      fontSize={chatFontSize}
                      highlightColor={chatColor}
                    />
                  </div>
                ) : msg.role === 'assistant' ? (
                  <div className="font-medium leading-relaxed prose prose-sm max-w-none prose-p:mb-2 prose-p:last:mb-0" style={{ fontSize: chatFontSize }}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0 font-medium">{children}</p>,
                        ul: ({ children }) => <ul className="mb-2 pl-4 list-disc">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-2 pl-4 list-decimal">{children}</ol>,
                        li: ({ children }) => <li className="mb-1">{children}</li>,
                        strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                        em: ({ children }) => <em className="italic">{children}</em>,
                        img: ({ src, alt }) => (
                          <img
                            src={typeof src === 'string' ? src : ''}
                            alt={alt || 'curriculum image'}
                            loading="lazy"
                            className="my-2 max-w-full h-auto rounded-lg border border-border"
                          />
                        ),
                        a: ({ href, children }) => {
                          const handleClick = (e: React.MouseEvent) => {
                            e.preventDefault();
                            if (!href || href === 'null' || href === 'undefined') return;
                            const url = href.startsWith('http') ? href : `https://${href}`;
                            try {
                              if (window.parent && window.parent !== window) {
                                window.parent.postMessage({ type: 'OPEN_URL', url }, '*');
                              } else {
                                window.open(url, '_blank', 'noopener,noreferrer');
                              }
                            } catch {
                              window.open(url, '_blank', 'noopener,noreferrer');
                            }
                          };
                          return (
                            <a
                              href={href || '#'}
                              onClick={handleClick}
                              className="text-primary underline hover:opacity-80 cursor-pointer"
                              rel="noopener noreferrer"
                            >
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {convertLatexDelimiters(msg.content)}
                    </ReactMarkdown>
                  </div>
                ) : msg.role === 'user' && msg.content.startsWith('[RESUME_UPLOAD]') ? (
                  <div className="flex items-center gap-2 text-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-90">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                      <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    <span className="font-medium">{msg.content.replace('[RESUME_UPLOAD] ', '')} uploaded</span>
                  </div>
                ) : msg.role === 'user' && msg.content.startsWith('[JOB_APPLY]') ? (
                  <div className="flex items-center gap-2 text-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-90">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                    </svg>
                    <span className="font-medium">Applying for {msg.content.replace(/^\[JOB_APPLY\]\s*/, '').replace(/\s*\|jobId:.*$/, '')}</span>
                  </div>
                ) : msg.role === 'user' && msg.content.startsWith('[IMAGE_UPLOAD]') ? (
                  <div className="flex flex-col gap-1">
                    {msg.imageUrl ? (
                      <img
                        src={msg.imageUrl}
                        alt="Uploaded question"
                        className="max-w-[220px] rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setExpandedImageUrl(msg.imageUrl || null)}
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-90">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 0 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                          <circle cx="12" cy="13" r="4"/>
                        </svg>
                        <span className="font-medium">{msg.content.replace('[IMAGE_UPLOAD] ', '')} uploaded</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words" style={{ fontSize: chatFontSize }}>{msg.content}</p>
                )}
                {msg.products && msg.products.length > 0 && (
                  <div className="mt-3">
                    <ProductCard 
                      products={msg.products} 
                      currencySymbol={currencySymbol}
                      whatsappEnabled={settings?.whatsappOrderEnabled === 'true'}
                      whatsappNumber={settings?.whatsappOrderNumber}
                      whatsappMessage={settings?.whatsappOrderMessage}
                      comparisonEnabled={settings?.productComparisonEnabled === 'true'}
                      compareProducts={compareProducts}
                      onCompareToggle={handleCompareToggle}
                      chatColor={chatColor}
                      addToCartEnabled={settings?.addToCartEnabled !== 'false'}
                      tryOnEnabled={settings?.tryOnEnabled === 'true'}
                      onTryOn={handleTryOn}
                      pagination={msg.productPagination}
                      searchQuery={msg.productSearchQuery}
                      businessAccountId={businessAccountId}
                      userMessage={lastUserMsg}
                      selectedLanguage={selectedLanguage !== 'auto' ? selectedLanguage : undefined}
                      onLoadMore={(newProducts, newPagination) => {
                        const newMessageId = `more-products-${Date.now()}`;
                        
                        // Remove Show More from current message and create a new message with additional products
                        setMessages(prev => {
                          // Update original message to remove pagination (hide Show More)
                          const updatedMessages = prev.map(m => 
                            m.id === msg.id 
                              ? { ...m, productPagination: undefined }
                              : m
                          );
                          
                          // Create a new assistant message with the additional products
                          const newMessage = {
                            id: newMessageId,
                            role: 'assistant' as const,
                            content: 'Here are more options I found for you:',
                            products: newProducts,
                            productPagination: newPagination,
                            productSearchQuery: msg.productSearchQuery,
                            timestamp: new Date()
                          };
                          
                          return [...updatedMessages, newMessage];
                        });
                        
                        // Scroll to position the new message at top of visible area
                        // Use polling to wait for element to exist after React renders
                        const scrollToNewMessage = () => {
                          let attempts = 0;
                          const maxAttempts = 20;
                          
                          const tryScroll = () => {
                            const newMessageEl = document.querySelector(`[data-message-id="${newMessageId}"]`);
                            if (newMessageEl) {
                              newMessageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            } else if (attempts < maxAttempts) {
                              attempts++;
                              requestAnimationFrame(tryScroll);
                            }
                          };
                          
                          requestAnimationFrame(tryScroll);
                        };
                        
                        scrollToNewMessage();
                      }}
                    />
                  </div>
                )}
                {/* Show matched products from image search - same style as regular products with similarity badge */}
                {msg.matchedProducts && msg.matchedProducts.length > 0 && (
                  <div className="mt-3">
                    <ProductCard 
                      products={msg.matchedProducts} 
                      currencySymbol={currencySymbol}
                      whatsappEnabled={settings?.whatsappOrderEnabled === 'true'}
                      whatsappNumber={settings?.whatsappOrderNumber}
                      whatsappMessage={settings?.whatsappOrderMessage}
                      comparisonEnabled={settings?.productComparisonEnabled === 'true'}
                      compareProducts={compareProducts}
                      onCompareToggle={handleCompareToggle}
                      chatColor={chatColor}
                      addToCartEnabled={settings?.addToCartEnabled !== 'false'}
                      tryOnEnabled={settings?.tryOnEnabled === 'true'}
                      onTryOn={handleTryOn}
                      businessAccountId={businessAccountId}
                      userMessage={lastUserMsg}
                      selectedLanguage={selectedLanguage !== 'auto' ? selectedLanguage : undefined}
                    />
                  </div>
                )}
                {msg.lookupOptions && (() => {
                  const isThisMessageActive = lookupState.phase !== 'idle' && 'messageId' in lookupState && lookupState.messageId === msg.id;
                  const activeOpt = isThisMessageActive && 'type' in lookupState ? LOOKUP_OPTS.find(o => o.type === lookupState.type) : null;

                  if (!isThisMessageActive) {
                    return (
                      <div className="mt-3 space-y-1.5 w-full">
                        <p className="text-xs text-gray-400 mb-1">{msg.lookupMode === 'return_exchange' ? 'Find your order for return/exchange' : 'Track your order via'}</p>
                        {LOOKUP_OPTS.map((opt) => (
                          <button
                            key={opt.label}
                            onClick={() => {
                              setLookupState({ phase: 'input', type: opt.type, messageId: msg.id });
                              setLookupInputValue('');
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border bg-white shadow-sm text-left transition-all hover:shadow-md active:scale-95"
                            style={{ borderColor: chatColor + '40' }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = chatColor)}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = chatColor + '40')}
                          >
                            <span className="text-base flex-shrink-0">{opt.icon}</span>
                            <div>
                              <div className="font-semibold text-gray-800 text-xs">{opt.label}</div>
                              <div className="text-[10px] text-gray-400">{opt.sub}</div>
                            </div>
                            <svg className="w-3 h-3 text-gray-300 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    );
                  }

                  if (lookupState.phase === 'input' && activeOpt) {
                    return (
                      <div className="mt-3 w-full">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-base">{activeOpt.icon}</span>
                          <p className="text-xs text-gray-500 font-medium">Enter your {activeOpt.label}</p>
                        </div>
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            type={activeOpt.inputType}
                            placeholder={activeOpt.placeholder}
                            value={lookupInputValue}
                            onChange={e => setLookupInputValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleLookupInputSubmit(); }}
                            className="flex-1 text-sm border rounded-lg px-3 py-2 outline-none"
                            style={{ borderColor: chatColor + '60' }}
                            onFocus={e => (e.currentTarget.style.borderColor = chatColor)}
                            onBlur={e => (e.currentTarget.style.borderColor = chatColor + '60')}
                          />
                          <button
                            onClick={handleLookupInputSubmit}
                            disabled={!lookupInputValue.trim()}
                            className="px-3 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-40 transition-opacity"
                            style={{ backgroundColor: chatColor }}
                          >Send</button>
                        </div>
                        <button
                          onClick={() => { setLookupState({ phase: 'idle' }); setLookupInputValue(''); }}
                          className="mt-1.5 text-[10px] text-gray-400 hover:text-gray-600"
                        >← Choose differently</button>
                      </div>
                    );
                  }

                  if (lookupState.phase === 'otp') {
                    const otpState = lookupState as Extract<LookupPhase, { phase: 'otp' }>;
                    return (
                      <div className="mt-3 w-full">
                        <p className="text-xs text-gray-500 font-medium mb-0.5">Enter OTP</p>
                        <p className="text-[10px] text-gray-400 mb-1.5">Sent to {otpState.value}</p>
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            type="text"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="• • • •"
                            value={lookupOtpValue}
                            onChange={e => setLookupOtpValue(e.target.value.replace(/\D/g, ''))}
                            onKeyDown={e => { if (e.key === 'Enter') handleLookupOtpSubmit(); }}
                            className="flex-1 text-sm border rounded-lg px-3 py-2 outline-none tracking-widest text-center"
                            style={{ borderColor: otpState.error ? '#ef4444' : chatColor + '60' }}
                            onFocus={e => (e.currentTarget.style.borderColor = chatColor)}
                            onBlur={e => (e.currentTarget.style.borderColor = otpState.error ? '#ef4444' : chatColor + '60')}
                          />
                          <button
                            onClick={handleLookupOtpSubmit}
                            disabled={lookupOtpValue.length < 4}
                            className="px-3 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-40 transition-opacity"
                            style={{ backgroundColor: chatColor }}
                          >Verify</button>
                        </div>
                        {otpState.error && (
                          <p className="mt-1 text-[10px] text-red-500">Incorrect OTP. Please try again.</p>
                        )}
                      </div>
                    );
                  }

                  return null;
                })()}
                {msg.orders && msg.orders.length > 0 && (
                  <div className="mt-2 space-y-2 w-full">
                    {msg.orders.map((order: any, idx: number) => (
                      <OrderStatusCard
                        key={idx}
                        order={normalizeOrder(order)}
                        onSelect={setSelectedOrder}
                      />
                    ))}
                  </div>
                )}
                {msg.jobs && msg.jobs.length > 0 && (
                  <Suspense fallback={<div className="h-20 animate-pulse bg-gray-100 rounded-lg" />}>
                    <JobCarousel
                      jobs={msg.jobs}
                      chatColor={chatColor}
                      applicantId={msg.applicantId}
                      onApply={(jobId, appId, jobTitle) => {
                        sendMessage(`[JOB_APPLY] ${jobTitle} |jobId:${jobId}|applicantId:${appId}`);
                      }}
                    />
                  </Suspense>
                )}
                {/* Show try-on result image */}
                {msg.tryOnResult && (
                  <div className="mt-3">
                    <div 
                      className="relative rounded-lg overflow-hidden border-2 cursor-pointer group"
                      style={{ borderColor: chatColor }}
                      onClick={() => setExpandedImageUrl(msg.tryOnResult!)}
                    >
                      <img 
                        src={msg.tryOnResult} 
                        alt="Virtual try-on result" 
                        className="w-full h-auto max-h-[300px] object-contain"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="bg-white/90 rounded-full p-2">
                          <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                          </svg>
                        </div>
                      </div>
                      <div className="absolute bottom-2 right-2 bg-white/90 rounded-full p-1.5 shadow-md">
                        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 text-center mt-1">Tap image to enlarge</p>
                    <div className="flex gap-2 mt-2">
                      <a 
                        href={msg.tryOnResult} 
                        download="try-on-result.png"
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-sm text-gray-700"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Save
                      </a>
                      <button 
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-sm text-gray-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (navigator.share) {
                            navigator.share({
                              title: 'Virtual Try-On Result',
                              text: 'Check out how this looks on me!',
                              url: msg.tryOnResult
                            }).catch(() => {});
                          } else {
                            navigator.clipboard.writeText(msg.tryOnResult || '');
                          }
                        }}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        Share
                      </button>
                    </div>
                  </div>
                )}
                {/* Show appointment calendar for slot selection */}
                {msg.appointmentSlots && Object.keys(msg.appointmentSlots.slots).length > 0 && (
                  <div className="mt-3">
                    <Suspense fallback={<LazyLoadingFallback />}>
                      <AppointmentCalendar
                        slots={msg.appointmentSlots.slots}
                        durationMinutes={msg.appointmentSlots.durationMinutes}
                        chatColor={chatColor}
                        chatColorEnd={chatColorEnd}
                        businessAccountId={businessAccountId || ''}
                        onSelectSlot={(date, time) => {
                          const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { 
                            weekday: 'long', 
                            month: 'long', 
                            day: 'numeric' 
                          });
                          const [hours, minutes] = time.split(':').map(Number);
                          const period = hours >= 12 ? 'PM' : 'AM';
                          const displayHours = hours % 12 || 12;
                          const formattedTime = `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
                          
                          const bookingMessage = `I'd like to book an appointment on ${formattedDate} at ${formattedTime}`;
                          setMessage(bookingMessage);
                          setTimeout(() => {
                            const sendBtn = document.querySelector('[data-send-button]') as HTMLButtonElement;
                            if (sendBtn) sendBtn.click();
                          }, 100);
                        }}
                      />
                    </Suspense>
                  </div>
                )}

                {/* Conversational journey dropdown/radio choices as tappable buttons.
                    Only show on the most recent message so old choices don't linger. */}
                {msg.role === 'assistant' && msg.quickReplies && msg.quickReplies.length > 0 && msgIndex === messages.length - 1 && (
                  <QuickBrowseButtons
                    buttons={msg.quickReplies.map((opt) => ({ label: opt, action: opt }))}
                    onSelect={handleQuickBrowse}
                    chatColor={chatColor}
                    chatColorEnd={chatColorEnd}
                    collapsible
                    collapsedCount={2}
                  />
                )}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              </div>
            </div>
          </div>
        ); })}
        
        {/* Conversation Starters - Show after intro message, hide when form journey is active or complete */}
        {!activeFormStep && !isFormJourneyComplete && (
          <ConversationStarters
            starters={conversationStarters}
            onSelect={handleStarterSelect}
            chatColor={chatColor}
            chatColorEnd={chatColorEnd}
            show={shouldShowStarters}
          />
        )}

        {/* Chat Now button - shown after journey form completion */}
        {isFormJourneyComplete && !activeFormStep && (
          <div className="flex justify-center py-4 px-4">
            <button
              onClick={() => handleNewChat()}
              className="flex items-center gap-2 px-6 py-3 rounded-full text-white font-medium shadow-md hover:shadow-lg transition-all"
              style={{ background: chatColorEnd ? `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` : chatColor }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Chat Now
            </button>
          </div>
        )}

        {/* Quick Browse Buttons - Show after intro message (hide only when user sends first message) */}
        {/* Wait for proactive guidance check to complete before showing */}
        {settings?.quickBrowseEnabled === 'true' && settings?.quickBrowseButtons && userMessages.length === 0 && !isLoading && !cleanModeEnabled && proactiveGuidanceChecked && (() => {
          // Parse quickBrowseButtons if it's a JSON string
          let buttons = settings.quickBrowseButtons;
          if (typeof buttons === 'string') {
            try {
              buttons = JSON.parse(buttons);
            } catch (e) {
              buttons = [];
            }
          }
          return Array.isArray(buttons) && buttons.length > 0 ? (
            <QuickBrowseButtons
              buttons={buttons}
              onSelect={handleQuickBrowse}
              chatColor={chatColor}
              chatColorEnd={chatColorEnd}
            />
          ) : null;
        })()}

        {/* Product Carousel - Show featured products after intro (hide only when user sends first message) */}
        {/* Wait for proactive guidance check to complete before showing */}
        {featuredProducts.length > 0 && userMessages.length === 0 && !isLoading && !cleanModeEnabled && proactiveGuidanceChecked && (
          <Suspense fallback={<LazyLoadingFallback />}>
            <ProductCarousel
              products={featuredProducts}
              title={featuredProductsTitle}
              currencySymbol={currencySymbol}
              chatColor={chatColor}
              onProductClick={(product) => {
                setMessage(`Tell me more about ${product.name}`);
              }}
            />
          </Suspense>
        )}
        
        {/* Form Step UI - Show visual form input at the end of messages when form journey step is active */}
        {activeFormStep && (
          <div className="p-3 bg-white rounded-lg shadow-sm mx-2 mb-2 border border-gray-100">
            <Suspense fallback={<LazyLoadingFallback />}>
              <FormStep
                step={activeFormStep}
                businessAccountId={businessAccountId}
                conversationId={conversationIdRef.current || undefined}
              onSubmit={async (value) => {
                // Submit directly to the journey endpoint - no AI involvement
                try {
                  setIsLoading(true);
                  setActiveFormStep(null);
                  
                  const response = await fetch(`/api/journey/submit-step`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      conversationId: conversationIdRef.current || null, 
                      answer: value, 
                      businessAccountId,
                      journeyId: activeJourneyId,
                      visitorToken: visitorSessionTokenRef.current || localStorage.getItem('chroney_visitor_token'),
                      pageUrl: parentPageUrl || (window.parent !== window ? document.referrer : window.location.href) || undefined
                    })
                  });
                  
                  const result = await response.json();
                  
                  // Update conversationId if we got a new one from the server
                  if (result.conversationId && !conversationIdRef.current) {
                    conversationIdRef.current = result.conversationId;
                    setHasConversation(true);
                    console.log('[Form Journey] Got conversationId from server:', result.conversationId);
                  }
                  
                  if (result.completed && result.nextStep?.stepType === 'journey_complete') {
                    // Journey complete step - show the completion step UI (with optional button)
                    setActiveFormStep(result.nextStep);
                    setActiveJourneyId(null); // Clear journey state on server side
                    setIsFormJourneyComplete(true); // Disable chat input after form journey completes
                  } else if (result.completed) {
                    // Journey completed - show completion message as chat message
                    const completionMessage: ChatMessage = {
                      id: (Date.now() + 1).toString(),
                      role: 'assistant',
                      content: result.completionMessage || 'Thank you for completing the form!',
                      timestamp: new Date()
                    };
                    setMessages(prev => [...prev, completionMessage]);
                    setActiveFormStep(null);
                    setActiveJourneyId(null); // Clear journey state
                    setIsFormJourneyComplete(true); // Disable chat input after form journey completes
                  } else if (result.nextStep) {
                    // Show next form step
                    setActiveFormStep(result.nextStep);
                  }
                } catch (error) {
                  console.error('[FormStep] Error submitting:', error);
                } finally {
                  setIsLoading(false);
                }
              }}
              isSubmitting={isLoading}
              primaryColor={chatColor}
              onContinueExploring={() => {
                setActiveFormStep(null);
                setActiveJourneyId(null);
              }}
            />
            </Suspense>
          </div>
        )}
        
        {resumeUploadStage !== 'idle' && (
          <div className="flex items-start gap-2 px-3 pb-2">
            {settings?.avatar && settings.avatar !== 'none' && (
              <div className="w-8 h-8 flex-shrink-0" />
            )}
            <div className="flex-1 max-w-[85%]">
              <ResumeUploadProgress stage={resumeUploadStage} chatColor={chatColor} />
            </div>
          </div>
        )}
        {k12ImageUploadStage !== 'idle' && (
          <div className="flex items-start gap-2 px-3 pb-2">
            {settings?.avatar && settings.avatar !== 'none' && (
              <div className="w-8 h-8 flex-shrink-0" />
            )}
            <div className="flex-1 max-w-[85%]">
              <ImageUploadProgress stage={k12ImageUploadStage} chatColor={chatColor} />
            </div>
          </div>
        )}
        {doubtPromptStatus !== 'hidden' && (
          <div className="flex items-start gap-2 px-3 pb-2">
            {settings?.avatar && settings.avatar !== 'none' && (
              <div className="w-8 h-8 flex-shrink-0" />
            )}
            <div className="flex-1 max-w-[85%]">
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-3">
                {(doubtPromptStatus === 'visible' || doubtPromptStatus === 'resolving' || doubtPromptStatus === 'escalating' || doubtPromptStatus === 'error') && (
                  <>
                    <p className="text-sm text-gray-800 mb-2 font-medium">Did this resolve your doubt?</p>
                    {doubtPromptStatus === 'error' && (
                      <p className="text-xs text-red-600 mb-2">Something went wrong — please try again.</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleDoubtResolve}
                        disabled={doubtPromptStatus === 'resolving' || doubtPromptStatus === 'escalating'}
                        className="gap-1 text-white"
                        style={{ background: chatColor }}
                      >
                        {doubtPromptStatus === 'resolving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Yes
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDoubtEscalate}
                        disabled={doubtPromptStatus === 'resolving' || doubtPromptStatus === 'escalating'}
                        className="gap-1"
                      >
                        {doubtPromptStatus === 'escalating' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} No
                      </Button>
                    </div>
                  </>
                )}
                {doubtPromptStatus === 'resolved' && (
                  <p className="text-sm text-gray-700">Great — glad that helped! Ask me anything else whenever you're ready.</p>
                )}
                {doubtPromptStatus === 'escalated' && (
                  <p className="text-sm text-gray-700">Thanks for letting us know. We've escalated this so someone can help you further.</p>
                )}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      )}

      {/* Chat Input - Fixed at bottom with safe area padding - only show if mode allows it */}
      {/* Also hide when form journey is complete - user cannot continue chatting after completing form journey */}
      {!isMenuMode && (settings?.chatMode === 'both' || settings?.chatMode === 'chat-only' || !settings?.chatMode) && !activeFormStep && !isFormJourneyComplete && (
        <div 
          className="border-t border-gray-200 p-2 sm:p-3 md:p-4 bg-gray-100 flex-shrink-0 mobile-input-debug" 
          style={{ 
            paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
            position: 'relative',
            zIndex: 99999
          }}
        >
          {doubtLock ? (
            // The doubt was resolved or escalated, so this session is finished.
            // Checked FIRST: this is terminal, and no later branch (OTP, voice,
            // pre-chat gate) may hand the student a usable input again.
            // Rendered as a visibly disabled composer rather than hiding it, so
            // the chat reads as closed rather than broken.
            <div data-testid="doubt-locked-composer">
              <div
                className="w-full px-3 sm:px-4 py-2 sm:py-3 rounded-xl sm:rounded-2xl border border-gray-200 bg-gray-100 text-gray-400 text-sm sm:text-base flex items-center gap-2 cursor-not-allowed select-none"
                style={{ minHeight: isMobileDevice ? '48px' : '44px' }}
                aria-disabled="true"
              >
                <Lock className="w-4 h-4 flex-shrink-0" />
                <span>
                  {doubtLock === 'escalated'
                    ? 'This doubt has been escalated to your teacher.'
                    : 'This doubt is marked as resolved.'}
                </span>
              </div>
              <p className="text-center text-xs text-gray-500 pt-2">
                This chat is closed. Raise a new doubt to start another session.
              </p>
            </div>
          ) : (otpState.awaiting_otp || otpState.locked) ? (
            // Task #19: OTP gating wins over inline voice — verify path must
            // be the only available input while modal is up, otherwise the
            // visitor could speak the code (or other content) into a parallel
            // session and bypass the modal.
            <div
              data-testid="otp-composer-suppressed"
              className="text-center text-xs text-gray-500 py-2"
            >
              Verify your mobile in the box above to continue.
            </div>
          ) : (anyPreChatGateActive && !isRestoringHistory) ? (
            // Task #23: pre-chat OTP gate — block the composer until the
            // visitor has entered their phone in the modal above. The phone
            // modal will transition the UI to the OTP modal once submitted.
            // CAPTCHA gate behaves the same: composer is blocked until the
            // visitor passes the reCAPTCHA challenge in the modal above.
            <div
              data-testid="phone-entry-composer-suppressed"
              className="text-center text-xs text-gray-500 py-2"
            >
              {preChatCaptchaActive
                ? 'Complete the verification in the box above to start chatting.'
                : 'Enter your mobile in the box above to start chatting.'}
            </div>
          ) : isInlineVoiceActive && settings?.voiceModeEnabled && businessAccountId ? (
            <Suspense fallback={<LazyLoadingFallback />}>
              <InlineVoiceMode
                isActive={isInlineVoiceActive}
                onClose={() => {
                  setIsInlineVoiceActive(false);
                  inlineVoiceAIMessagesRef.current.clear();
                  voiceSpokenTextRef.current.clear();
                  setVoiceHighlight(null);
                  setStreamingMessageId(null);
                }}
                userId={widgetUserIdRef.current}
                businessAccountId={businessAccountId}
                chatColor={chatColor}
                chatColorEnd={chatColorEnd}
                avatarType={settings?.avatarType}
                avatarUrl={settings?.avatarUrl}
                selectedLanguage={selectedLanguage}
                textConversationId={conversationIdRef.current || undefined}
                topscholarToken={topscholarTokenRef.current || undefined}
                topscholarCpId={topscholarCpIdRef.current || undefined}
                onUserMessage={(text) => {
                  const userMsg: ChatMessage = {
                    id: 'voice-user-' + Date.now(),
                    role: 'user',
                    content: text,
                    timestamp: new Date(),
                  };
                  setMessages(prev => [...prev, userMsg]);
                }}
                onTranscriptCorrection={(original, corrected) => {
                  setMessages(prev => prev.map(m => 
                    m.role === 'user' && m.content === original 
                      ? { ...m, content: corrected } 
                      : m
                  ));
                }}
                onAIMessageStart={(messageId) => {
                  inlineVoiceAIMessagesRef.current.set(messageId, '');
                  const aiMsg: ChatMessage = {
                    id: messageId,
                    role: 'assistant',
                    content: '',
                    timestamp: new Date(),
                  };
                  setMessages(prev => [...prev, aiMsg]);
                  setStreamingMessageId(messageId);
                }}
                onAIMessageChunk={(messageId, text) => {
                  const existing = inlineVoiceAIMessagesRef.current.get(messageId) || '';
                  const updated = existing + text;
                  inlineVoiceAIMessagesRef.current.set(messageId, updated);
                  // Raw spoken transcript — the karaoke highlight's source of
                  // truth, immune to formatted-Markdown replacement mid-answer.
                  voiceSpokenTextRef.current.set(messageId, (voiceSpokenTextRef.current.get(messageId) || '') + text);
                  setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: updated } : m));
                }}
                onAIMessageDone={(messageId) => {
                  setStreamingMessageId(null);
                  inlineVoiceAIMessagesRef.current.delete(messageId);
                  voiceSpokenTextRef.current.delete(messageId);
                }}
                onSpeakingProgress={(messageId, charOffset, done) => {
                  if (done) {
                    setVoiceHighlight(prev => (prev && prev.messageId !== messageId ? prev : null));
                    // Playback for this bubble is over (finished, interrupted,
                    // or abandoned) — the raw spoken transcript is no longer
                    // needed. Covers interruption, where onAIMessageDone
                    // never fires for the bubble.
                    voiceSpokenTextRef.current.delete(messageId);
                  } else {
                    setVoiceHighlight({ messageId, offset: charOffset });
                  }
                }}
                onAIMessageReplace={(messageId, formattedMarkdown) => {
                  // Final on-screen version of a spoken answer: formatted Markdown
                  // (LaTeX for math/science) with any curriculum diagrams already
                  // placed inline. The tutor never said the URLs; the pictures just
                  // appear where they belong once the answer finishes.
                  inlineVoiceAIMessagesRef.current.set(messageId, formattedMarkdown);
                  setMessages(prev => prev.map(m =>
                    m.id === messageId ? { ...m, content: formattedMarkdown } : m
                  ));
                }}
              />
            </Suspense>
          ) : (
          <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
            onChange={handleImageSelect}
            className="hidden"
          />
          
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="relative"
            style={{ 
              margin: 0,
              padding: 0
            }}
          >
            {/* Task #19: this composer branch only renders when the OTP
                modal is not up, so per-OTP placeholder/inputMode/lockout
                banner logic that lived here is unreachable and has been
                removed. The modal owns all OTP UX now. */}
            <div className="relative">
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                placeholder="Ask me anything..."
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  const textarea = e.target;
                  textarea.style.height = 'auto';
                  const minHeight = isMobileDevice ? 48 : 44;
                  const maxHeight = 120;
                  textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
                }}
                onFocus={() => {
                  window.parent.postMessage({ type: 'EXPAND_WIDGET' }, '*');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (message.trim() && !isLoading) {
                      sendMessage();
                      if (inputRef.current) {
                        inputRef.current.style.height = isMobileDevice ? '48px' : '44px';
                      }
                    }
                  }
                }}
                readOnly={isLoading}
                rows={2}
                className="w-full px-3 sm:px-4 py-2 sm:py-3 pr-12 sm:pr-14 rounded-xl sm:rounded-2xl border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 resize-none text-sm sm:text-base"
                style={{ 
                  fontSize: isMobileDevice ? '16px' : '15px',
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  minHeight: isMobileDevice ? '48px' : '44px',
                  maxHeight: '120px',
                  lineHeight: '1.4'
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !message.trim()}
                className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 h-8 w-8 sm:h-9 sm:w-9 rounded-full flex-shrink-0 disabled:opacity-40 flex items-center justify-center transition-all duration-200 hover:scale-105"
                style={{ 
                  background: message.trim() ? `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` : '#e5e7eb',
                  border: 'none',
                  cursor: isLoading || !message.trim() ? 'not-allowed' : 'pointer',
                  boxShadow: message.trim() ? '0 2px 8px rgba(0,0,0,0.15)' : 'none'
                }}
                data-send-button
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Send className={`w-4 h-4 ${message.trim() ? 'text-white' : 'text-gray-400'}`} />
                )}
              </button>
            </div>
          </form>
          
          {/* Image search button - below input field (only shown when visual search is enabled) */}
          {settings?.visualSearchEnabled && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isUploadingImage}
              className="mt-2 flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50 transition-colors w-full py-1"
              style={{ cursor: isLoading ? 'not-allowed' : 'pointer' }}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Upload image to find similar products</span>
            </button>
          )}
          {settings?.jobPortalEnabled && (
            <>
              <input
                ref={resumeInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleResumeSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => resumeInputRef.current?.click()}
                disabled={isLoading}
                className="mt-2 flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50 transition-colors w-full py-1"
                style={{ cursor: isLoading ? 'not-allowed' : 'pointer' }}
              >
                <Briefcase className="w-3.5 h-3.5" />
                <span>Upload Resume (PDF)</span>
              </button>
            </>
          )}
          {settings?.k12EducationEnabled && settings?.k12ImageUploadEnabled && (
            <>
              <input
                ref={k12ImageInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleK12ImageSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => k12ImageInputRef.current?.click()}
                disabled={isLoading || k12ImageUploadStage !== 'idle'}
                className="mt-2 flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50 transition-colors w-full py-1"
                style={{ cursor: (isLoading || k12ImageUploadStage !== 'idle') ? 'not-allowed' : 'pointer' }}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Upload a photo of your question</span>
              </button>
            </>
          )}
          {(settings?.footerLabelEnabled === "true" || settings?.poweredByEnabled !== "false") && (
            <p className="text-center pt-1 pb-1 px-3 flex items-center justify-center gap-1.5 flex-wrap" style={{ fontSize: '10px', color: '#b0b0b0' }}>
              {settings?.footerLabelEnabled === "true" && settings?.footerLabelText && (
                <span>{settings.footerLabelText}</span>
              )}
              {settings?.footerLabelEnabled === "true" && settings?.footerLabelText && settings?.poweredByEnabled !== "false" && (
                <span>·</span>
              )}
              {settings?.poweredByEnabled !== "false" && (
                <span>
                  Powered by{' '}
                  <a
                    href="https://aichroney.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#9333ea', textDecoration: 'none', fontWeight: 500 }}
                  >
                    AI Chroney
                  </a>
                </span>
              )}
            </p>
          )}
          </>
          )}
        </div>
      )}

      {/* Fallback message for voice-only mode with voice disabled */}
      {settings?.chatMode === 'voice-only' && !settings?.voiceModeEnabled && (
        <div className="border-t border-gray-200 p-6 bg-white flex-shrink-0 text-center">
          <div className="flex flex-col items-center gap-3">
            <Mic className="w-12 h-12 text-gray-300" />
            <p className="text-sm text-gray-500">Voice mode is currently unavailable</p>
            <p className="text-xs text-gray-400">Please contact support for assistance</p>
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      {expandedImageUrl && (
        <div 
          className="fixed inset-0 z-[99999] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setExpandedImageUrl(null)}
        >
          <div className="relative max-w-full max-h-full">
            <button
              onClick={() => setExpandedImageUrl(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg hover:bg-gray-100 transition-colors z-10"
            >
              <X className="w-5 h-5 text-gray-700" />
            </button>
            <img 
              src={expandedImageUrl} 
              alt="Expanded view" 
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Image Crop Overlay for Visual Search */}
      <AnimatePresence>
        {showCropOverlay && pendingSearchImageUrl && (
          <ChatImageCropOverlay
            imageUrl={pendingSearchImageUrl}
            onSearch={(boundingBox) => {
              performVisualSearch(pendingSearchImageUrl, boundingBox);
            }}
            onSearchFullImage={() => {
              performVisualSearch(pendingSearchImageUrl);
            }}
            onCancel={() => {
              setShowCropOverlay(false);
              setPendingSearchImageUrl(null);
            }}
            isSearching={isLoading}
            accentColor={chatColor}
          />
        )}
      </AnimatePresence>

      {/* Virtual Try-On Overlay */}
      <AnimatePresence>
        {showTryOnOverlay && tryOnProduct && businessAccountId && (
          <TryOnOverlay
            productImage={tryOnProduct.imageUrl}
            productName={tryOnProduct.name}
            productType={tryOnProduct.type}
            businessAccountId={businessAccountId}
            onClose={() => {
              setShowTryOnOverlay(false);
              setTryOnProduct(null);
            }}
            onResult={(resultImageUrl) => {
              // Add try-on result as a chat message
              const tryOnMessage = {
                id: `tryon-${Date.now()}`,
                role: 'assistant' as const,
                content: `Here's how ${tryOnProduct.name} looks on you!`,
                tryOnResult: resultImageUrl,
                timestamp: new Date()
              };
              setMessages(prev => [...prev, tryOnMessage]);
            }}
            accentColor={chatColor}
          />
        )}
      </AnimatePresence>


      {/* Conversation History Panel */}
      <AnimatePresence>
        {isHistoryPanelOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setIsHistoryPanelOpen(false)}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Panel Header */}
              <div 
                className="flex items-center gap-3 px-4 py-3 text-white"
                style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
              >
                <button
                  onClick={() => setIsHistoryPanelOpen(false)}
                  className="p-1 rounded-full hover:bg-white/20 transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h3 className="font-semibold text-base flex-1">Conversation History</h3>
              </div>

              {/* Conversations List */}
              <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 60px)' }}>
                {isLoadingConversations ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : conversationsList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <History className="w-12 h-12 text-gray-300 mb-3" />
                    <p className="text-gray-500 text-sm">No previous conversations</p>
                    <p className="text-gray-400 text-xs mt-1">Your chat history will appear here</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {conversationsList.map((conv) => (
                      <button
                        key={conv.id}
                        onClick={() => handleLoadConversation(conv.id)}
                        className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-800 text-sm truncate">
                              {conv.title || 'Conversation'}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {conv.messageCount} messages
                            </p>
                          </div>
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {new Date(conv.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Urgency offer renders on parent page via postMessage, not inside iframe */}

      {/* Floating Compare Button - Show when products are selected for comparison */}
      {settings?.productComparisonEnabled === 'true' && compareProducts.size > 0 && (
        <button
          onClick={() => setShowComparisonView(true)}
          className="fixed bottom-24 right-4 flex items-center gap-2 px-4 py-2 text-white rounded-full shadow-lg transition-all duration-200 hover:scale-105 z-40"
          style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
        >
          <GitCompare className="w-4 h-4" />
          Compare ({compareProducts.size})
        </button>
      )}

      {/* Order Detail Overlay */}
      <OrderDetailOverlay
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        chatColor={chatColor}
      />

      {/* Product Comparison View */}
      {showComparisonView && (
        <Suspense fallback={<LazyLoadingFallback />}>
          <ProductComparisonView
            products={allProducts.filter(p => compareProducts.has(p.id))}
            currencySymbol={currencySymbol}
            onRemove={(productId) => {
              setCompareProducts(prev => {
                const next = new Set(prev);
                next.delete(productId);
                return next;
              });
            }}
            onClose={() => setShowComparisonView(false)}
            chatColor={chatColor}
            whatsappNumber={settings?.whatsappOrderEnabled === 'true' ? settings?.whatsappOrderNumber : undefined}
            whatsappMessage={settings?.whatsappOrderMessage}
          />
        </Suspense>
      )}

      {/* Conversion-fired badge (admin opt-in). Off to the corner, NOT inside a
          chat bubble; shows the label + the actual URL that was loaded. Auto-
          dismisses. Purely informational confirmation that the hidden conversion
          iframe fired. */}
      <AnimatePresence>
        {conversionBadge && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-4 left-4 z-[60] max-w-[280px] rounded-lg bg-emerald-600 px-3 py-2 text-white shadow-lg"
            data-testid="conversion-fired-badge"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Zap className="h-3.5 w-3.5 shrink-0" />
              <span>Thank-you page fired</span>
            </div>
            <div className="mt-0.5 truncate text-[10px] text-emerald-50/90" title={conversionBadge.url}>
              {conversionBadge.url}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
