import { Sparkles, Zap, Send, Loader2, Share2, Mic as MicIcon, Volume2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ProductCard } from "@/components/ProductCard";
import { ShareLinkModal } from "@/components/ShareLinkModal";
import { VoiceMode } from "@/components/VoiceMode";
import { ConversationStarters } from "@/components/ConversationStarters";
import { AppointmentCalendar } from "@/components/AppointmentCalendar";
import { FormStep } from "@/components/FormStep";
import type { MeResponseDto } from "@shared/dto";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { convertLatexDelimiters } from '@/lib/convertLatexDelimiters';

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
  appointmentSlots?: { slots: Record<string, string[]>; durationMinutes: number };
  isVoice?: boolean;
  audioBase64?: string;
  transcript?: string;
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
  voiceModeStyle?: string;
  avatarType?: string;
  avatarUrl?: string;
  conversationStarters?: string;
  conversationStartersEnabled?: string;
  createdAt: string;
  updatedAt: string;
}

interface User {
  id: string;
  username: string;
  role: string;
  businessAccountId: string | null;
}

export default function Home() {
  const [isExpanded, setIsExpanded] = useState(true);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // State for shareable link modal
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // State for voice mode
  const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false);

  // State for audio playback
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // State for form journeys
  const [activeFormStep, setActiveFormStep] = useState<FormStepData | null>(null);
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);
  const conversationIdRef = useRef<string>('');

  // Fetch current user for voice mode
  const { data: currentUser } = useQuery<MeResponseDto>({
    queryKey: ["/api/auth/me"],
  });

  // Fetch public chat link
  const { data: publicLink, refetch: refetchLink} = useQuery<{
    id: string;
    businessAccountId: string;
    token: string;
    isActive: string;
    password: string | null;
    url: string;
    accessCount: string;
  }>({
    queryKey: ["/api/public-chat-link"],
  });


  // Fetch widget settings (scoped by businessAccountId via session)
  const { data: settings, isLoading: settingsLoading } = useQuery<WidgetSettings>({
    queryKey: ["/api/widget-settings"],
  });

  // Fetch API key status
  const { data: apiKeyData } = useQuery<{ hasKey: boolean; maskedKey: string | null }>({
    queryKey: ["/api/settings/openai-key"],
  });

  // Use actual settings values (no defaults to prevent flash)
  const chatColor = settings?.chatColor || "#9333ea";
  const chatColorEnd = settings?.chatColorEnd || "#3b82f6";
  const widgetHeaderText = settings?.widgetHeaderText || "Hi Chroney";
  const currency = settings?.currency || "USD";
  const voiceModeStyle = settings?.voiceModeStyle || "circular";
  
  // Map currency code to symbol
  const currencySymbols: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹", AUD: "A$",
    CAD: "C$", CHF: "CHF", SEK: "kr", NZD: "NZ$", SGD: "S$", HKD: "HK$",
    NOK: "kr", MXN: "$", BRL: "R$", ZAR: "R", KRW: "₩", TRY: "₺",
    RUB: "₽", IDR: "Rp", THB: "฿", MYR: "RM"
  };
  const currencySymbol = currencySymbols[currency] || "$";
  
  // Check if chat is available (API key is configured)
  const isChatAvailable = apiKeyData?.hasKey ?? true;

  // Parse conversation starters from settings
  const conversationStarters = settings?.conversationStarters 
    ? JSON.parse(settings.conversationStarters) 
    : [];
  const showStarters = settings?.conversationStartersEnabled !== 'false' && conversationStarters.length > 0;
  
  // Determine if conversation starters should be visible (only when chat is empty or has just the intro)
  const userMessages = messages.filter(m => m.role === 'user');
  const shouldShowStarters = showStarters && userMessages.length === 0 && !isLoading;

  // Check chat status and load intro on mount (parallelized for faster loading)
  useEffect(() => {
    const init = async () => {
      // Phase 1: Reset memory on chat open to prevent context pollution
      try {
        await fetch('/api/chat/reset', {
          method: 'POST',
          credentials: 'include'
        });
        console.log('[Chat] Memory reset - starting fresh conversation');
        
        // Also reset form journey state
        setActiveFormStep(null);
        setActiveJourneyId(null);
        conversationIdRef.current = '';
      } catch (error) {
        console.error('[Chat] Failed to reset memory:', error);
      }

      // Run both calls in parallel instead of sequential
      await Promise.all([
        checkStatus(),
        loadIntroMessage()
      ]);
    };
    init();
  }, [isChatAvailable]);

  const loadIntroMessage = async () => {
    // Check if API key is available first
    if (!isChatAvailable) {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: "⚠️ Chroney is currently offline. Please configure your OpenAI API key in Settings to enable the chat functionality.",
        timestamp: new Date()
      }]);
      setIsOnline(false);
      return;
    }

    try {
      const response = await fetch('/api/chat/intro', {
        credentials: 'include'
      });
      
      console.log('Intro API response status:', response.status, response.ok);
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Response is not JSON, content-type:', contentType);
        throw new Error('Response is not JSON');
      }
      
      const data = await response.json();
      console.log('Intro API data:', data);
      
      if (data.intro) {
        // For form journeys, don't add the intro as a chat message since the FormStep shows the question
        if (!data.formStep) {
          setMessages([{
            id: '1',
            role: 'assistant',
            content: data.intro,
            timestamp: new Date()
          }]);
        }
        
        // Set form step if present (for form journeys)
        if (data.formStep) {
          console.log('[Home] Setting active form step from intro:', data.formStep);
          setActiveFormStep(data.formStep);
          if (data.journeyId) {
            setActiveJourneyId(data.journeyId);
          }
        }
      } else {
        // Fallback to default message
        setMessages([{
          id: '1',
          role: 'assistant',
          content: "Sup, human? Chroney reporting for duty 🤖. Tell me what you want—products, FAQs, or capture a lead—I'm here to help!",
          timestamp: new Date()
        }]);
      }
    } catch (error) {
      console.error('Failed to load intro:', error);
      // Fallback to default message
      setMessages([{
        id: '1',
        role: 'assistant',
        content: "Sup, human? Chroney reporting for duty 🤖. Tell me what you want—products, FAQs, or capture a lead—I'm here to help!",
        timestamp: new Date()
      }]);
    }
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/chat/status', {
        credentials: 'include'
      });
      const data = await response.json();
      setIsOnline(data.status === 'online');
    } catch (error) {
      setIsOnline(false);
    }
  };


  // Handler for conversation starter selection
  const handleStarterSelect = async (question: string) => {
    if (!question.trim() || isLoading || !isChatAvailable) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: question.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const userQuery = question.trim();
    setMessage("");
    setIsLoading(true);

    // Add placeholder AI message for streaming with context-aware typing indicator
    const aiMessageId = (Date.now() + 1).toString();
    setStreamingMessageId(aiMessageId);
    const aiMessage: ChatMessage = {
      id: aiMessageId,
      role: 'assistant',
      content: '.....',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, aiMessage]);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ message: userMessage.content })
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Stream not available');
      }

      let streamedContent = '';
      let productsData: any[] | null = null;
      let appointmentSlotsData: { slots: Record<string, string[]>; durationMinutes: number } | null = null;
      let pendingUpdate = false;
      let buffer = ''; // Buffer for incomplete lines

      const updateStreamingMessage = () => {
        if (pendingUpdate) return;
        pendingUpdate = true;
        
        requestAnimationFrame(() => {
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: streamedContent }
              : msg
          ));
          pendingUpdate = false;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'content') {
                streamedContent += data.data;
                updateStreamingMessage();
              } else if (data.type === 'products') {
                productsData = data.data;
              } else if (data.type === 'appointment_slots') {
                console.log('[Appointments] Received slots for calendar:', data.data);
                appointmentSlotsData = JSON.parse(data.data);
                setMessages(prev => prev.map(msg => 
                  msg.id === aiMessageId 
                    ? { ...msg, appointmentSlots: appointmentSlotsData || undefined }
                    : msg
                ));
              } else if (data.type === 'done') {
                break;
              }
            } catch (parseError) {
              // Skip malformed JSON chunks - they may be split across reads
              console.warn('[Stream] Skipping malformed JSON chunk:', line);
            }
          }
        }
      }

      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId 
          ? { ...msg, content: streamedContent, products: productsData || undefined, appointmentSlots: appointmentSlotsData || undefined }
          : msg
      ));

    } catch (error: any) {
      console.error('Error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to send message. Please try again.",
        variant: "destructive",
      });
      
      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId 
          ? { ...msg, content: "Sorry, I'm having trouble processing that right now. Please try again." }
          : msg
      ));
    } finally {
      setIsLoading(false);
      setStreamingMessageId(null);
    }
  };

  const sendMessage = async () => {
    if (!message.trim() || isLoading || !isChatAvailable) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const userQuery = message.trim();
    setMessage("");
    setIsLoading(true);
    
    // Keep focus on input field for continuous typing
    inputRef.current?.focus();

    // Add placeholder AI message for streaming with context-aware typing indicator
    const aiMessageId = (Date.now() + 1).toString();
    setStreamingMessageId(aiMessageId);
    const aiMessage: ChatMessage = {
      id: aiMessageId,
      role: 'assistant',
      content: '.....',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, aiMessage]);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ message: userMessage.content })
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Stream not available');
      }

      let streamedContent = '';
      let productsData: any[] | null = null; // Local variable to avoid async state issues
      let appointmentSlotsData: { slots: Record<string, string[]>; durationMinutes: number } | null = null;
      let pendingUpdate = false;
      let buffer = ''; // Buffer for incomplete lines

      // Batch streaming updates using requestAnimationFrame to reduce re-renders
      const updateStreamingMessage = () => {
        if (pendingUpdate) return;
        pendingUpdate = true;
        
        requestAnimationFrame(() => {
          setMessages(prev => prev.map(msg => 
            msg.id === aiMessageId 
              ? { ...msg, content: streamedContent }
              : msg
          ));
          pendingUpdate = false;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'content') {
                streamedContent += data.data;
                updateStreamingMessage(); // Batched update
              } else if (data.type === 'products') {
                // Capture product data for special rendering in local variable
                productsData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                console.log('[Chat] Received products data:', productsData);
              } else if (data.type === 'appointment_slots') {
                console.log('[Appointments] Received slots for calendar:', data.data);
                appointmentSlotsData = JSON.parse(data.data);
                setMessages(prev => prev.map(msg => 
                  msg.id === aiMessageId 
                    ? { ...msg, appointmentSlots: appointmentSlotsData || undefined }
                    : msg
                ));
              } else if (data.type === 'form_step') {
                console.log('[Home] Received form_step SSE event:', data.data);
                const formStepData = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
                setActiveFormStep(formStepData);
                // Set active journey ID so form step submission works
                if (formStepData.journeyId) {
                  setActiveJourneyId(formStepData.journeyId);
                }
                // Set conversation ID so form step submission uses correct conversation
                if (formStepData.conversationId) {
                  conversationIdRef.current = formStepData.conversationId;
                  console.log('[Home] Set conversationId from form_step:', formStepData.conversationId);
                }
              } else if (data.type === 'final') {
                setMessages(prev => prev.map(msg =>
                  msg.id === aiMessageId
                    ? { ...msg, content: data.data, products: productsData || undefined, appointmentSlots: appointmentSlotsData || undefined }
                    : msg
                ));
              } else if (data.type === 'error') {
                throw new Error(data.data);
              }
            } catch (parseError) {
              // Skip malformed JSON chunks - they may be split across reads
              console.warn('[Stream] Skipping malformed JSON chunk:', line);
            }
          }
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive"
      });
      
      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId 
          ? { ...msg, content: "Sorry, I'm having trouble processing that right now. Please try again." }
          : msg
      ));
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

  const handleVoiceMessage = (transcript: string, response: string, audioBase64?: string, products?: any[]) => {
    const userMessageId = Date.now().toString();
    const aiMessageId = (Date.now() + 1).toString();

    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: transcript,
      timestamp: new Date(),
      isVoice: true,
      transcript: transcript
    };

    const aiMessage: ChatMessage = {
      id: aiMessageId,
      role: 'assistant',
      content: response,
      timestamp: new Date(),
      isVoice: true,
      audioBase64: audioBase64,
      products: products
    };

    setMessages(prev => [...prev, userMessage, aiMessage]);

    if (audioBase64) {
      playAudio(audioBase64, aiMessageId);
    }
  };

  const playAudio = (base64Audio: string, messageId: string) => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      const audio = new Audio(`data:audio/wav;base64,${base64Audio}`);
      audioRef.current = audio;
      setPlayingAudioId(messageId);

      audio.onended = () => {
        setPlayingAudioId(null);
        audioRef.current = null;
      };

      audio.onerror = () => {
        toast({
          title: "Audio Error",
          description: "Failed to play audio response",
          variant: "destructive"
        });
        setPlayingAudioId(null);
        audioRef.current = null;
      };

      audio.play();
    } catch (error: any) {
      console.error('Error playing audio:', error);
      toast({
        title: "Audio Error",
        description: "Failed to play audio response",
        variant: "destructive"
      });
      setPlayingAudioId(null);
    }
  };

  const replayAudio = (audioBase64: string, messageId: string) => {
    playAudio(audioBase64, messageId);
  };

  const handleVoiceError = (error: string) => {
    toast({
      title: "Voice Error",
      description: error,
      variant: "destructive"
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };


  // Show loading state while settings are being fetched to prevent flash of default content
  if (settingsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          <p className="text-sm text-gray-500">Loading chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      <div className="container mx-auto p-4 md:p-6 w-full h-full max-w-7xl">
        {/* Minimized State - Compact Header Bar */}
        {!isExpanded && (
          <div className="bg-white rounded-full shadow-lg px-6 py-3 flex items-center justify-between max-w-2xl mx-auto">
            <div className="flex items-center gap-3">
              <div 
                className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
                style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
              >
                {settings?.avatarType && settings.avatarType !== 'none' ? (
                  <img 
                    src={settings.avatarType === 'custom' ? settings.avatarUrl : `/avatars/avatar-${settings.avatarType.replace('preset-', '')}.png`}
                    alt="AI Assistant"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Sparkles className="w-6 h-6 text-white" />
                )}
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">{widgetHeaderText}</h2>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-gray-300'}`}></div>
                  <span>{isOnline ? 'Online' : 'Offline'}</span>
                </div>
              </div>
            </div>
            <Button
              onClick={() => setIsExpanded(true)}
              className="text-white px-6 py-2 rounded-full"
              style={{ 
                background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})`,
              }}
            >
              Chat
            </Button>
          </div>
        )}

        {/* Expanded State - Full Chat Window */}
        {isExpanded && (
          <div className="bg-white rounded-2xl shadow-lg min-h-[450px] max-h-[calc(100vh-8rem)] flex flex-col overflow-hidden">
            {/* Chat Header */}
            <div 
              className="p-4 flex items-center justify-between flex-shrink-0"
              style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
            >
              <div className="flex items-center gap-3">
                <div 
                  className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden bg-white/20"
                >
                  {settings?.avatarType && settings.avatarType !== 'none' ? (
                    <img 
                      src={settings.avatarType === 'custom' ? settings.avatarUrl : `/avatars/avatar-${settings.avatarType.replace('preset-', '')}.png`}
                      alt="AI Assistant"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Sparkles className="w-6 h-6 text-white" />
                  )}
                </div>
                <div className="text-white">
                  <h2 className="font-semibold text-lg">{widgetHeaderText}</h2>
                  <div className="flex items-center gap-2 text-sm">
                    <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-gray-300'}`}></div>
                    <span className="opacity-90">{isOnline ? 'Online' : 'Offline'}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {currentUser?.businessAccount?.voiceModeEnabled && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/20"
                    onClick={() => setIsVoiceModeOpen(true)}
                    title="Voice Mode"
                    disabled={!currentUser?.id || !currentUser?.businessAccountId}
                  >
                    <MicIcon className="w-5 h-5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  onClick={() => setIsShareModalOpen(true)}
                  title="Share Chat Link"
                >
                  <Share2 className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {/* Chat Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 bg-white space-y-4 min-h-0">
            {messages.filter(msg => msg.content.trim() !== '' || msg.role === 'user' || msg.id === streamingMessageId).map((msg) => (
              <div key={msg.id} className={`flex gap-3 items-start ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {msg.role === 'assistant' && (
                  <div 
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
                    style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
                  >
                    {settings?.avatarType && settings.avatarType !== 'none' ? (
                      <img 
                        src={settings.avatarType === 'custom' ? settings.avatarUrl : `/avatars/avatar-${settings.avatarType.replace('preset-', '')}.png`}
                        alt="AI Assistant"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Sparkles className={`w-5 h-5 text-white ${msg.content === '.....' ? 'animate-spin' : ''}`} />
                    )}
                  </div>
                )}
                <div className={`flex-1 ${msg.role === 'user' ? 'flex flex-col items-end' : ''}`}>
                  <div className="relative">
                    {msg.isVoice && (
                      <div 
                        className="absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center shadow-md z-10"
                        style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
                        title="Voice Message"
                      >
                        <MicIcon className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <div 
                      className={`${
                        msg.role === 'assistant' 
                          ? 'bg-gray-100 rounded-2xl rounded-tl-sm' 
                          : 'text-white rounded-2xl rounded-tr-sm'
                      } p-4 inline-block max-w-3xl`}
                      style={msg.role === 'user' ? { background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` } : undefined}
                    >
                      {msg.role === 'assistant' && msg.content === '.....' ? (
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                      ) : (
                        <>
                          {msg.role === 'assistant' ? (
                            <div className="text-gray-900 leading-relaxed prose prose-sm max-w-none prose-p:mb-2 prose-p:last:mb-0 font-['Poppins']">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                                components={{
                                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                  ul: ({ children }) => <ul className="mb-2 pl-4 list-disc">{children}</ul>,
                                  ol: ({ children }) => <ol className="mb-2 pl-4 list-decimal">{children}</ol>,
                                  li: ({ children }) => <li className="mb-1">{children}</li>,
                                  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                                  em: ({ children }) => <em className="italic">{children}</em>,
                                  a: ({ href, children }) => (
                                    <a
                                      href={href || '#'}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 underline hover:opacity-80"
                                    >
                                      {children}
                                    </a>
                                  ),
                                }}
                              >
                                {convertLatexDelimiters(msg.content)}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-white leading-relaxed whitespace-pre-wrap font-['Poppins']">
                              {msg.content}
                            </p>
                          )}
                          {msg.audioBase64 && msg.role === 'assistant' && (
                            <div className="mt-3 flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => replayAudio(msg.audioBase64!, msg.id)}
                                className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
                              >
                                <Volume2 className={`w-4 h-4 ${playingAudioId === msg.id ? 'animate-pulse' : ''}`} />
                                <span className="text-xs">
                                  {playingAudioId === msg.id ? 'Playing...' : 'Play Audio'}
                                </span>
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                      {msg.products && msg.products.length > 0 && (
                        <div className="mt-4">
                          <ProductCard products={msg.products} currencySymbol={currencySymbol} />
                        </div>
                      )}
                      {msg.appointmentSlots && Object.keys(msg.appointmentSlots.slots).length > 0 && currentUser?.businessAccountId && (
                        <div className="mt-4">
                          <AppointmentCalendar
                            slots={msg.appointmentSlots.slots}
                            durationMinutes={msg.appointmentSlots.durationMinutes}
                            onSelectSlot={(date: string, time: string) => {
                              setMessage(`I'd like to book an appointment on ${date} at ${time}`);
                              setTimeout(() => sendMessage(), 100);
                            }}
                            chatColor={chatColor}
                            chatColorEnd={chatColorEnd}
                            businessAccountId={currentUser.activeBusinessAccountId || currentUser.businessAccountId}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">{formatTime(msg.timestamp)}</p>
                </div>
              </div>
            ))}
            
            {/* Conversation Starters - hide when form journey is active */}
            {!activeFormStep && (
              <ConversationStarters
                starters={conversationStarters}
                onSelect={handleStarterSelect}
                chatColor={chatColor}
                chatColorEnd={chatColorEnd}
                show={shouldShowStarters}
              />
            )}
            
            {/* Form Step for Form Journeys - inside scrollable area */}
            {activeFormStep && (
              <div className="p-3 bg-white rounded-lg shadow-sm mx-2 mb-2 border border-gray-100">
                <FormStep
                  step={activeFormStep}
                  businessAccountId={currentUser?.activeBusinessAccountId || currentUser?.businessAccountId || undefined}
                  conversationId={conversationIdRef.current || undefined}
                  onSubmit={async (answer) => {
                    if (!activeFormStep || !activeJourneyId) {
                      // Fallback: send as chat message if no journey context
                      setActiveFormStep(null);
                      setMessage(answer);
                      setTimeout(() => sendMessage(), 100);
                      return;
                    }

                    setIsLoading(true);
                    setActiveFormStep(null); // Clear form step immediately like EmbedChat
                    
                    try {
                      // Get businessAccountId from currentUser
                      const businessAccountId = currentUser?.activeBusinessAccountId || currentUser?.businessAccountId;
                      
                      // Call the journey step submission API (same as EmbedChat)
                      const response = await fetch('/api/journey/submit-step', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                          conversationId: conversationIdRef.current || null,
                          answer,
                          journeyId: activeJourneyId,
                          businessAccountId
                        })
                      });

                      const result = await response.json();
                      console.log('[Home FormStep] Submit result:', result);

                      // Update conversationId if we got a new one from the server
                      if (result.conversationId && !conversationIdRef.current) {
                        conversationIdRef.current = result.conversationId;
                        console.log('[Home FormStep] Got conversationId from server:', result.conversationId);
                      }

                      if (result.completed && result.nextStep?.stepType === 'journey_complete') {
                        // Journey complete step - show the completion step UI (with optional button)
                        setActiveFormStep(result.nextStep);
                        setActiveJourneyId(null);
                      } else if (result.completed) {
                        // Journey completed (including exit conditions) - show completion message
                        const completionMessage: ChatMessage = {
                          id: (Date.now() + 1).toString(),
                          role: 'assistant',
                          content: result.completionMessage || 'Thank you for completing the form!',
                          timestamp: new Date()
                        };
                        setMessages(prev => [...prev, completionMessage]);
                        setActiveFormStep(null);
                        setActiveJourneyId(null);
                      } else if (result.nextStep) {
                        // Show next form step
                        setActiveFormStep(result.nextStep);
                      }
                    } catch (error) {
                      console.error('[Home FormStep] Error submitting:', error);
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
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

            {/* Chat Input Area - hide when form step is active */}
            {!activeFormStep && (
            <div className="border-t border-gray-200 p-4 bg-white flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="text-purple-600 flex-shrink-0 p-2">
                  <Zap className="w-5 h-5" />
                </div>
                <Input
                  ref={inputRef}
                  type="text"
                  placeholder={isChatAvailable ? `Ask ${widgetHeaderText} anything... (e.g., 'Show products', 'Find FAQs')` : "Chat offline - Configure API key in Settings"}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  readOnly={isLoading}
                  disabled={!isChatAvailable}
                  className="flex-1 h-12 rounded-xl border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                />
                <Button
                  size="icon"
                  onClick={sendMessage}
                  disabled={isLoading || !message.trim() || !isChatAvailable}
                  className="h-12 w-12 rounded-xl shadow-md flex-shrink-0 disabled:opacity-50"
                  style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  ) : (
                    <Send className="w-5 h-5 text-white" />
                  )}
                </Button>
              </div>
            </div>
            )}
          </div>
        )}

        {/* Share Link Modal */}
        <ShareLinkModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          publicLink={publicLink}
          refetchLink={refetchLink}
          chatColor={chatColor}
          chatColorEnd={chatColorEnd}
        />

        {/* Voice Mode */}
        {currentUser?.id && currentUser?.businessAccountId && currentUser?.businessAccount?.voiceModeEnabled && (
          <VoiceMode
            isOpen={isVoiceModeOpen}
            onClose={() => setIsVoiceModeOpen(false)}
            userId={currentUser.id}
            businessAccountId={currentUser.activeBusinessAccountId || currentUser.businessAccountId}
            widgetHeaderText={widgetHeaderText}
            chatColor={chatColor}
            chatColorEnd={chatColorEnd}
            voiceModeStyle={voiceModeStyle}
            avatarType={settings?.avatarType}
            avatarUrl={settings?.avatarUrl}
          />
        )}
      </div>
    </div>
  );
}
