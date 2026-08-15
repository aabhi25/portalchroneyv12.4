import { Sparkles, Send, Loader2, X, ChevronDown, Mic } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { VoiceMode } from "@/components/VoiceMode";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

// Language configuration with names in their native script
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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface WidgetSettings {
  id: string;
  businessAccountId: string;
  chatColor: string;
  chatColorEnd: string;
  widgetHeaderText: string;
  personality: string;
  currency: string;
  avatarType?: string;
  avatarUrl?: string;
  languageSelectorEnabled?: string;
  availableLanguages?: string;
  voiceModeEnabled?: string | boolean;
  voiceModeStyle?: string;
}

interface GuidanceRule {
  id: string;
  name: string;
  urlPattern: string;
  message: string;
  cleanMode: boolean;
  conversationStarters?: string;
  isActive: boolean;
}

export default function GuidanceChat() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [guidanceRule, setGuidanceRule] = useState<GuidanceRule | null>(null);
  interface StarterQA {
    question: string;
    answer: string;
  }
  
  const [conversationStarters, setConversationStarters] = useState<string[]>([]);
  const [starterQAPairs, setStarterQAPairs] = useState<StarterQA[]>([]);
  const [originalGuidanceMessage, setOriginalGuidanceMessage] = useState<string>('');
  const [originalStarters, setOriginalStarters] = useState<string[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const widgetUserIdRef = useRef<string>(`guidance_${crypto.randomUUID()}`);
  const pendingScrollToMessageRef = useRef<string | null>(null);
  
  // Visitor tracking - persistent token in localStorage
  const visitorTokenRef = useRef<string>('');
  const visitorTrackingStartedRef = useRef<boolean>(false);
  
  // Initialize visitor token on first render
  if (!visitorTokenRef.current) {
    const key = 'chroney_visitor_token';
    let token = localStorage.getItem(key);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(key, token);
    }
    visitorTokenRef.current = token;
  }
  
  const [businessAccountId, setBusinessAccountId] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignActive, setCampaignActive] = useState<boolean | null>(null);
  const [campaignCheckLoading, setCampaignCheckLoading] = useState(false);
  const [pendingInitialMessage, setPendingInitialMessage] = useState<string | null>(null);
  const [showHeader, setShowHeader] = useState<boolean>(false);
  const [widgetSize, setWidgetSize] = useState<"full" | "half">("half");
  const [selectedLanguage, setSelectedLanguage] = useState<string>('auto');
  const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [voiceModePosition, setVoiceModePosition] = useState<string>("in-chat");
  const [showVoiceMode, setShowVoiceMode] = useState(false);
  
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  
  // Get params from URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('businessAccountId');
    const url = urlParams.get('sourceUrl') || '';
    const campaign = urlParams.get('campaignId');
    
    if (id) {
      setBusinessAccountId(id);
    }
    setSourceUrl(url);
    if (campaign) {
      setCampaignId(campaign);
    }
    
    // Signal ready to parent
    window.parent.postMessage({ type: 'EMBED_READY' }, '*');
    
    // Listen for messages from parent (pill launcher, voice orb)
    const handleParentMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'INITIAL_MESSAGE' && event.data.message) {
        console.log('[GuidanceChat] Received initial message:', event.data.message);
        setPendingInitialMessage(event.data.message);
      }
      if (event.data && event.data.type === 'OPEN_VOICE_MODE') {
        console.log('[GuidanceChat] Opening voice mode from external button');
        setShowVoiceMode(true);
      }
    };
    
    window.addEventListener('message', handleParentMessage);
    return () => {
      window.removeEventListener('message', handleParentMessage);
    };
  }, []);
  
  // Visitor tracking - track page visit when businessAccountId is set
  useEffect(() => {
    if (!businessAccountId || visitorTrackingStartedRef.current) return;
    
    const trackPageVisit = async () => {
      try {
        const deviceInfo = getDeviceInfo();
        
        await fetch('/api/widget/page-visit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessAccountId,
            visitorToken: visitorTokenRef.current,
            ...deviceInfo,
          }),
        });
        
        visitorTrackingStartedRef.current = true;
        console.log('[GuidanceChat] Page visitor tracked');
      } catch (error) {
        console.error('[GuidanceChat] Failed to track page visit:', error);
      }
    };
    
    trackPageVisit();
  }, [businessAccountId]);
  
  // Check if campaign is active (when campaignId is present)
  useEffect(() => {
    if (!campaignId || !businessAccountId) {
      // No campaign specified, widget is always active
      setCampaignActive(true);
      return;
    }
    
    const checkCampaignStatus = async () => {
      setCampaignCheckLoading(true);
      try {
        const response = await fetch(
          `/api/public/guidance-campaign-status/${encodeURIComponent(campaignId)}?businessAccountId=${encodeURIComponent(businessAccountId)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          setCampaignActive(data.isActive);
          setShowHeader(data.showHeader === true || data.showHeader === "true");
          setWidgetSize(data.widgetSize === "full" ? "full" : "half");
          setVoiceModeEnabled(data.voiceModeEnabled === true);
          setVoiceModePosition(data.voiceModePosition || "in-chat");
          
          // If campaign is inactive, notify parent to hide the widget
          if (!data.isActive) {
            window.parent.postMessage({ type: 'CAMPAIGN_INACTIVE' }, '*');
          }
        } else {
          // On error, assume active
          setCampaignActive(true);
        }
      } catch (error) {
        console.error('[GuidanceChat] Error checking campaign status:', error);
        // On error, assume active
        setCampaignActive(true);
      } finally {
        setCampaignCheckLoading(false);
      }
    };
    
    checkCampaignStatus();
  }, [campaignId, businessAccountId]);
  
  // Fetch widget settings
  const { data: settings } = useQuery<WidgetSettings>({
    queryKey: [`/api/widget-settings/public?businessAccountId=${businessAccountId}`],
    enabled: !!businessAccountId,
  });
  
  // Sync language with widget settings when they load
  useEffect(() => {
    if (settings?.availableLanguages) {
      try {
        const available = JSON.parse(settings.availableLanguages);
        // If current selection isn't in the available list, reset to first available
        if (Array.isArray(available) && available.length > 0 && !available.includes(selectedLanguage)) {
          setSelectedLanguage(available[0]);
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
  }, [settings?.availableLanguages]);
  
  // When no campaign is specified, use widget settings for voice mode
  useEffect(() => {
    if (!campaignId && settings) {
      // Check widget settings for voice mode when not using campaign-specific settings
      const widgetVoiceEnabled = settings.voiceModeEnabled === true || settings.voiceModeEnabled === 'true';
      setVoiceModeEnabled(widgetVoiceEnabled);
    }
  }, [campaignId, settings]);
  
  // Fetch matching guidance rule for this URL
  useEffect(() => {
    if (!businessAccountId || !sourceUrl) return;
    
    const fetchGuidanceRule = async () => {
      try {
        const response = await fetch(
          `/api/public/proactive-guidance-match/${encodeURIComponent(businessAccountId)}?url=${encodeURIComponent(sourceUrl)}`
        );
        
        if (response.ok) {
          const rule = await response.json();
          if (rule) {
            setGuidanceRule(rule);
            
            // Parse conversation starters from rule (these are allowed in guidance mode)
            if (rule.conversationStarters) {
              try {
                const parsed = typeof rule.conversationStarters === 'string'
                  ? JSON.parse(rule.conversationStarters)
                  : rule.conversationStarters;
                if (Array.isArray(parsed)) {
                  // Check format: old (string[]) or new ({question, answer}[])
                  if (parsed.length > 0 && typeof parsed[0] === 'string') {
                    // Old format: string[]
                    const questionStrings = parsed as string[];
                    setConversationStarters(questionStrings);
                    setOriginalStarters(questionStrings);
                    setStarterQAPairs(questionStrings.map(q => ({ question: q, answer: '' })));
                  } else {
                    // New format: {question, answer}[]
                    const qaPairs = parsed as StarterQA[];
                    const questionStrings = qaPairs.map(qa => qa.question);
                    setConversationStarters(questionStrings);
                    setOriginalStarters(questionStrings);
                    setStarterQAPairs(qaPairs);
                  }
                }
              } catch (e) {
                console.warn('[GuidanceChat] Failed to parse conversation starters:', e);
              }
            }
            
            // Add guidance message as first AI message
            if (rule.message) {
              setOriginalGuidanceMessage(rule.message); // Store original for translation
              setMessages([{
                id: crypto.randomUUID(),
                role: 'assistant',
                content: rule.message,
                timestamp: new Date(),
              }]);
            }
          }
        }
      } catch (error) {
        console.error('[GuidanceChat] Failed to fetch guidance rule:', error);
      }
    };
    
    fetchGuidanceRule();
  }, [businessAccountId, sourceUrl]);
  
  // Translate guidance message and starters when language changes
  useEffect(() => {
    // Skip if auto-detect or English, or if no original content
    if (!selectedLanguage || selectedLanguage === 'auto' || selectedLanguage === 'en') {
      // Reset to originals when switching back to English/Auto
      if (originalGuidanceMessage && messages.length > 0 && messages[0].role === 'assistant') {
        setMessages(prev => {
          if (prev.length > 0 && prev[0].role === 'assistant') {
            return [{ ...prev[0], content: originalGuidanceMessage }, ...prev.slice(1)];
          }
          return prev;
        });
      }
      if (originalStarters.length > 0) {
        setConversationStarters(originalStarters);
      }
      return;
    }
    
    if (!businessAccountId || (!originalGuidanceMessage && originalStarters.length === 0)) return;
    
    const translateContent = async () => {
      try {
        // Translate guidance message
        if (originalGuidanceMessage) {
          const msgResponse = await fetch('/api/chat/widget/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: originalGuidanceMessage,
              targetLanguage: selectedLanguage,
              businessAccountId
            }),
          });
          
          if (msgResponse.ok) {
            const { translatedText } = await msgResponse.json();
            if (translatedText && translatedText !== originalGuidanceMessage) {
              setMessages(prev => {
                if (prev.length > 0 && prev[0].role === 'assistant') {
                  return [{ ...prev[0], content: translatedText }, ...prev.slice(1)];
                }
                return prev;
              });
            }
          }
        }
        
        // Translate conversation starters
        if (originalStarters.length > 0) {
          const translatedStarters = await Promise.all(
            originalStarters.map(async (starter) => {
              try {
                const response = await fetch('/api/chat/widget/translate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    text: starter,
                    targetLanguage: selectedLanguage,
                    businessAccountId
                  }),
                });
                
                if (response.ok) {
                  const { translatedText } = await response.json();
                  return translatedText || starter;
                }
                return starter;
              } catch {
                return starter;
              }
            })
          );
          setConversationStarters(translatedStarters);
        }
      } catch (error) {
        console.error('[GuidanceChat] Translation error:', error);
      }
    };
    
    translateContent();
  }, [selectedLanguage, businessAccountId, originalGuidanceMessage, originalStarters]);
  
  // Handle pending scroll after messages render using polling
  useEffect(() => {
    if (pendingScrollToMessageRef.current) {
      const messageIdToScroll = pendingScrollToMessageRef.current;
      pendingScrollToMessageRef.current = null; // Clear immediately to prevent re-runs
      
      // Use polling with requestAnimationFrame to wait for element to exist
      let attempts = 0;
      const maxAttempts = 30; // ~500ms max wait
      
      const tryScroll = () => {
        const container = messagesContainerRef.current;
        const userMsgEl = container?.querySelector(`[data-message-id="${messageIdToScroll}"]`) as HTMLElement;
        
        if (container && userMsgEl) {
          // Calculate position relative to container and scroll container directly
          // This avoids scrollIntoView which can scroll parent elements
          const scrollTarget = userMsgEl.offsetTop - 16; // 16px padding from top
          container.scrollTop = scrollTarget;
        } else if (attempts < maxAttempts) {
          attempts++;
          requestAnimationFrame(tryScroll);
        }
      };
      
      requestAnimationFrame(tryScroll);
    }
  }, [messages]);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setIsLanguageDropdownOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const chatColor = settings?.chatColor || "#9333ea";
  const chatColorEnd = settings?.chatColorEnd || "#3b82f6";
  const widgetHeaderText = settings?.widgetHeaderText || "Assistant";
  const currency = settings?.currency || "USD";
  
  // Language selector config (matches EmbedChat logic)
  const languageSelectorEnabled = settings?.languageSelectorEnabled !== 'false';
  const availableLanguages: string[] = settings?.availableLanguages 
    ? (() => {
        try {
          return JSON.parse(settings.availableLanguages);
        } catch {
          return ['auto', 'en', 'hi', 'hinglish', 'ta', 'te', 'kn'];
        }
      })()
    : ['auto', 'en', 'hi', 'hinglish', 'ta', 'te', 'kn'];
  
  const userMessages = messages.filter(m => m.role === 'user');
  const shouldShowStarters = conversationStarters.length > 0 && userMessages.length === 0 && !isLoading;
  
  // Process pending initial message from pill launcher
  useEffect(() => {
    // Only process when we have a pending message, businessAccountId is set, and not currently loading
    if (!pendingInitialMessage || !businessAccountId || isLoading) return;
    
    // Clear the pending message immediately to prevent re-sends
    const messageToSend = pendingInitialMessage;
    setPendingInitialMessage(null);
    
    console.log('[GuidanceChat] Processing initial message:', messageToSend);
    
    // Small delay to ensure UI is ready
    setTimeout(() => {
      handleSendMessage(messageToSend);
    }, 100);
  }, [pendingInitialMessage, businessAccountId, isLoading]);
  
  // Handle sending message
  const handleSendMessage = async (text?: string) => {
    const messageToSend = text || message.trim();
    if (!messageToSend || isLoading || !businessAccountId) return;
    
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageToSend,
      timestamp: new Date(),
    };
    
    // Set pending scroll - the useEffect will handle it after render
    pendingScrollToMessageRef.current = userMessage.id;
    
    setMessages(prev => [...prev, userMessage]);
    setMessage('');
    setIsLoading(true);
    
    // Create placeholder for AI response with typing indicator
    const assistantId = crypto.randomUUID();
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '.....',
      timestamp: new Date(),
    }]);
    setStreamingMessageId(assistantId);
    
    try {
      // Build context from Q&A pairs that have answers
      const starterContext = starterQAPairs
        .filter(qa => qa.answer && qa.answer.trim())
        .map(qa => ({ question: qa.question, answer: qa.answer }));
      
      const response = await fetch('/api/chat/widget/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageToSend,
          businessAccountId,
          sessionId: sessionIdRef.current,
          language: selectedLanguage !== 'auto' ? selectedLanguage : undefined,
          isGuidanceChat: true,
          starterQAContext: starterContext.length > 0 ? starterContext : undefined,
        }),
      });
      
      if (!response.ok) throw new Error('Chat request failed');
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      
      if (reader) {
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
                  // Streaming content chunks (for direct responses)
                  fullContent += data.data;
                  setMessages(prev => prev.map(m => 
                    m.id === assistantId ? { ...m, content: fullContent } : m
                  ));
                } else if (data.type === 'final') {
                  // Final response after tool calls complete (e.g., get_faqs for "who are you")
                  fullContent = data.data;
                  setMessages(prev => prev.map(m => 
                    m.id === assistantId ? { ...m, content: fullContent } : m
                  ));
                }
              } catch {}
            }
          }
        }
      }
    } catch (error) {
      console.error('[GuidanceChat] Chat error:', error);
      setMessages(prev => prev.map(m => 
        m.id === assistantId 
          ? { ...m, content: 'Sorry, I encountered an error. Please try again.' }
          : m
      ));
    } finally {
      setIsLoading(false);
      setStreamingMessageId(null);
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  const handleStarterClick = (starter: string) => {
    handleSendMessage(starter);
  };
  
  const handleClose = () => {
    window.parent.postMessage({ type: 'CLOSE_WIDGET' }, '*');
  };
  
  // Get avatar component - matches EmbedChat pattern for preset/custom avatars
  const getAvatarComponent = () => {
    const avatarType = settings?.avatarType;
    const avatarUrl = settings?.avatarUrl;
    
    // Show avatar if type is set and not 'none'
    if (avatarType && avatarType !== 'none') {
      // Custom avatars use avatarUrl, preset avatars use /avatars/avatar-{type}.png
      const src = avatarType === 'custom' 
        ? avatarUrl 
        : `/avatars/avatar-${avatarType.replace('preset-', '')}.png`;
      
      return (
        <img 
          src={src} 
          alt="Assistant" 
          className="w-8 h-8 rounded-full object-cover"
        />
      );
    }
    
    // Default sparkles icon
    return (
      <div 
        className="w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
      >
        <Sparkles className="w-4 h-4 text-white" />
      </div>
    );
  };
  
  // Elegant loading state while checking campaign status
  if (campaignCheckLoading || campaignActive === null) {
    return (
      <div 
        className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-gray-100"
        style={{ fontFamily: "'Poppins', sans-serif" }}
      >
        {/* Animated gradient orb */}
        <div className="relative mb-6">
          <div 
            className="w-16 h-16 rounded-full animate-pulse"
            style={{ 
              background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`,
              boxShadow: `0 8px 32px ${chatColor}40`
            }}
          />
          <div 
            className="absolute inset-0 w-16 h-16 rounded-full animate-ping opacity-30"
            style={{ 
              background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`
            }}
          />
          {/* Inner icon */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="w-7 h-7 text-white drop-shadow-sm" />
          </div>
        </div>
        
        {/* Loading text with subtle animation */}
        <div className="text-center">
          <p className="text-gray-600 text-sm font-medium mb-1">Preparing your assistant</p>
          <div className="flex items-center justify-center gap-1">
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }
  
  // If campaign is inactive, hide the entire widget
  if (campaignActive === false) {
    return null;
  }
  
  return (
    <div 
      className="flex flex-col h-screen bg-white relative"
      style={{ fontFamily: "'Poppins', sans-serif" }}
    >
      {/* Conditionally show header or floating close button based on campaign setting */}
      {showHeader ? (
        <div 
          className="flex items-center justify-between px-4 py-3 text-white shrink-0"
          style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
        >
          <div className="flex items-center gap-2">
            {getAvatarComponent()}
            <span className="font-semibold">{widgetHeaderText}</span>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Language selector - show if enabled and has multiple languages */}
            {languageSelectorEnabled && availableLanguages.length > 1 && (
              <div className="relative" ref={languageDropdownRef}>
                <button
                  onClick={() => setIsLanguageDropdownOpen(!isLanguageDropdownOpen)}
                  className="px-2 py-1 rounded-md hover:bg-white/20 transition-colors flex items-center gap-1 text-sm"
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
            
            {/* Voice mode button - only show if enabled and position is in-chat */}
            {voiceModeEnabled && voiceModePosition === "in-chat" && (
              <button
                onClick={() => setShowVoiceMode(true)}
                className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                aria-label="Voice mode"
                title="Voice mode"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
            
            <button
              onClick={handleClose}
              className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {/* Floating voice button when no header - only for in-chat position */}
          {voiceModeEnabled && voiceModePosition === "in-chat" && (
            <button
              onClick={() => setShowVoiceMode(true)}
              className="p-2 rounded-full bg-gray-100/80 hover:bg-gray-200/90 backdrop-blur-sm transition-all duration-200 shadow-sm hover:shadow group"
              style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
              aria-label="Voice mode"
              title="Voice mode"
            >
              <Mic className="w-4 h-4 text-white" />
            </button>
          )}
          <button
            onClick={handleClose}
            className="p-2 rounded-full bg-gray-100/80 hover:bg-gray-200/90 backdrop-blur-sm transition-all duration-200 shadow-sm hover:shadow group"
          >
            <X className="w-4 h-4 text-gray-500 group-hover:text-gray-700 transition-colors" />
          </button>
        </div>
      )}
      
      {/* Messages */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4 min-h-0"
        style={{ 
          paddingBottom: '350px', // Extra space so any message can scroll to top (matching EmbedChat)
          overscrollBehavior: 'contain',
          overscrollBehaviorX: 'contain',
          WebkitOverflowScrolling: 'touch',
          overflowAnchor: 'none' // Prevent browser auto-adjusting scroll position
        }}
      >
        {messages.map((msg, index) => {
          // First assistant message gets elegant welcome card treatment
          const isWelcomeCard = index === 0 && msg.role === 'assistant' && guidanceRule?.message;
          
          if (isWelcomeCard) {
            return (
              <div 
                key={msg.id} 
                data-message-id={msg.id}
                className="flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-700"
              >
                {/* Outer container for animated background */}
                <div className="relative max-w-[85%]" style={{ isolation: 'isolate' }}>
                  {/* Animated gradient orbs rotating around the card */}
                  <div 
                    className="absolute inset-0 overflow-visible pointer-events-none"
                    style={{ zIndex: 0 }}
                  >
                    {/* Orbiting glow 1 - primary color */}
                    <div 
                      className="absolute w-28 h-28 rounded-full opacity-70"
                      style={{ 
                        top: '50%',
                        left: '50%',
                        marginTop: '-56px',
                        marginLeft: '-56px',
                        background: `radial-gradient(circle, ${chatColor} 0%, ${chatColor}70 40%, transparent 70%)`,
                        filter: 'blur(25px)',
                        animation: 'orbit 8s linear infinite'
                      }}
                    />
                    {/* Orbiting glow 2 - secondary color, opposite direction */}
                    <div 
                      className="absolute w-32 h-32 rounded-full opacity-70"
                      style={{ 
                        top: '50%',
                        left: '50%',
                        marginTop: '-64px',
                        marginLeft: '-64px',
                        background: `radial-gradient(circle, ${chatColorEnd} 0%, ${chatColorEnd}70 40%, transparent 70%)`,
                        filter: 'blur(25px)',
                        animation: 'orbitReverse 10s linear infinite'
                      }}
                    />
                    {/* Central soft glow - stationary */}
                    <div 
                      className="absolute w-40 h-40 rounded-full opacity-25"
                      style={{ 
                        top: '50%',
                        left: '50%',
                        marginTop: '-80px',
                        marginLeft: '-80px',
                        background: `radial-gradient(circle, ${chatColor}60 0%, ${chatColorEnd}40 50%, transparent 70%)`,
                        filter: 'blur(35px)'
                      }}
                    />
                  </div>
                  
                  {/* Main card - more compact */}
                  <div 
                    className="relative rounded-2xl p-4 shadow-lg border border-gray-100/50"
                    style={{
                      background: 'linear-gradient(145deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)',
                      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.08), 0 2px 10px rgba(0, 0, 0, 0.04)',
                      zIndex: 1
                    }}
                  >
                  {/* Avatar centered at top - smaller */}
                  <div className="flex justify-center mb-3 animate-in zoom-in duration-500 delay-200">
                    <div 
                      className="w-11 h-11 rounded-full p-0.5 shadow-md"
                      style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                    >
                      <div className="w-full h-full rounded-full bg-white p-0.5">
                        {settings?.avatarType && settings.avatarType !== 'none' ? (
                          <img 
                            src={settings.avatarType === 'custom' 
                              ? settings.avatarUrl 
                              : `/avatars/avatar-${settings.avatarType.replace('preset-', '')}.png`
                            } 
                            alt="Assistant" 
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          <div 
                            className="w-full h-full rounded-full flex items-center justify-center"
                            style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
                          >
                            <Sparkles className="w-5 h-5 text-white" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Message content with smaller typography - left aligned */}
                  <div className="text-left animate-in fade-in duration-700 delay-300">
                    <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="my-2 space-y-1.5 pl-3">{children}</ul>,
                          li: ({ children }) => <li className="text-xs text-gray-600">{children}</li>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                  
                  {/* Decorative gradient line at bottom */}
                  <div 
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full opacity-60"
                    style={{ background: `linear-gradient(90deg, ${chatColor}, ${chatColorEnd})` }}
                  />
                  </div>
                </div>
              </div>
            );
          }
          
          // Regular message rendering
          return (
            <div key={msg.id} data-message-id={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {msg.role === 'assistant' && getAvatarComponent()}
                
                <div
                  className={`${
                    msg.role === 'user'
                      ? 'rounded-2xl px-4 py-3 text-white'
                      : 'py-1'
                  }`}
                  style={msg.role === 'user' ? { 
                    background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` 
                  } : { color: '#1e3a5f' }}
                >
                  {msg.role === 'assistant' && msg.content === '.....' ? (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  ) : msg.role === 'assistant' ? (
                    <div className="text-sm font-medium leading-relaxed prose prose-sm max-w-none prose-p:mb-2 prose-p:last:mb-0">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0 font-medium">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 pl-4 list-disc">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 pl-4 list-decimal">{children}</ol>,
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        
        {/* Rule-specific FAQs only (no default starters) - left aligned */}
        {shouldShowStarters && (
          <div className="flex flex-wrap justify-start gap-2 mt-4 px-2">
            {conversationStarters.map((starter, index) => (
              <button
                key={index}
                onClick={() => handleStarterClick(starter)}
                className="px-3 py-2 text-sm rounded-full border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors text-gray-700 text-left"
              >
                {starter}
              </button>
            ))}
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* Minimal Input area */}
      <div className="shrink-0 border-t bg-white px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            className="flex-1 resize-none border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 max-h-32"
            rows={1}
            disabled={isLoading}
          />
          
          <Button
            onClick={() => handleSendMessage()}
            disabled={!message.trim() || isLoading}
            className="shrink-0 rounded-full w-10 h-10 p-0"
            style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
      
      {/* Voice Mode Overlay */}
      {showVoiceMode && businessAccountId && (
        <VoiceMode
          isOpen={showVoiceMode}
          onClose={() => setShowVoiceMode(false)}
          userId={widgetUserIdRef.current}
          businessAccountId={businessAccountId}
          widgetHeaderText={widgetHeaderText}
          chatColor={chatColor}
          chatColorEnd={chatColorEnd}
          voiceModeStyle={settings?.voiceModeStyle}
          avatarType={settings?.avatarType}
          avatarUrl={settings?.avatarUrl}
        />
      )}
    </div>
  );
}
