import { X, Mic, Brain, Volume2, Hand } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  isFinal?: boolean;
}

interface VoiceModeProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  businessAccountId: string;
  widgetHeaderText?: string;
  chatColor?: string;
  chatColorEnd?: string;
  voiceModeStyle?: string;
  avatarType?: string;
  avatarUrl?: string;
  onStateChange?: (state: VoiceState) => void;
  headless?: boolean;
  autoStart?: boolean;
  /**
   * TopScholar launch identity. The server refuses a widget voice connection on
   * this account without it, and refuses it outright once the doubt is closed.
   */
  topscholarToken?: string;
  topscholarCpId?: string;
}

const BARGE_IN_GRACE_MS = 700;

export type { VoiceState };

export function VoiceMode({
  isOpen,
  onClose,
  userId,
  businessAccountId,
  widgetHeaderText = "Hi Chroney",
  chatColor = "#9333ea",
  chatColorEnd = "#3b82f6",
  voiceModeStyle = "circular",
  avatarType = "none",
  avatarUrl,
  onStateChange,
  headless = false,
  autoStart = false,
  topscholarToken,
  topscholarCpId
}: VoiceModeProps) {
  const [state, setState] = useState<VoiceState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [isOnline, setIsOnline] = useState(true); // Start as "Online" for customer-facing widget - only show "Offline" if connection actually fails
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [audioVolume, setAudioVolume] = useState(0); // 0-100 for audio-reactive animations
  const [busyState, setBusyState] = useState(false); // Track if server is busy
  
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const nextPlaybackTimeRef = useRef<number>(0);
  const audioChunkBufferRef = useRef<Uint8Array[]>([]);
  const shouldAutoRestartRef = useRef(false);
  const isOnlineRef = useRef(true); // Start as "Online" for customer-facing widget
  const hasPermissionRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentAIMessageIdRef = useRef<string | null>(null);
  const currentResponseIdRef = useRef<string | null>(null);
  const pendingPlaybackCompleteResponseIdRef = useRef<string | null>(null);
  const pendingInterruptedMessageIdRef = useRef<string | null>(null);
  const playbackStartedAtRef = useRef(0);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingInterruptRef = useRef(false); // Track interrupt state to ignore late chunks
  const stateRef = useRef(state); // Mutable ref for VAD to check current state
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null); // For audio-reactive animations during speaking
  const volumeIntervalRef = useRef<NodeJS.Timeout | null>(null); // For tracking playback volume
  const bufferedTranscriptRef = useRef<{text: string, isFinal: boolean} | null>(null); // Buffer transcripts during interrupt
  // Simple transcript tracking (will improve with per-turn architecture later)
  const awaitingUserTranscriptRef = useRef(false);
  const lastAIMessageIdRef = useRef<string | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null); // For capturing raw PCM audio
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null); // Fallback for older browsers
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const resampleFractionalPositionRef = useRef<number>(0); // For ScriptProcessor resampling state
  const resampleLastSampleRef = useRef<number>(0); // For ScriptProcessor resampling interpolation
  
  // Session lifecycle & reconnection
  const conversationIdRef = useRef<string | null>(null); // Stable conversation ID
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const busyResumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sessionClosedByServerRef = useRef(false); // CRITICAL FIX BUG 3: Track if session was explicitly closed by server
  
  // Audio streaming queue (bounded to prevent memory issues)
  const outboundAudioQueueRef = useRef<ArrayBuffer[]>([]);
  const maxOutboundQueueSize = 100; // Prevent infinite growth
  const isPausedDueToBackpressureRef = useRef(false); // CRITICAL FIX BUG 2: Track if recording is paused due to backpressure
  const backpressureWarningShownRef = useRef(false); // Track if warning toast was shown
  
  const { toast } = useToast();
  
  // Helper function to safely send WebSocket messages with error handling
  const safeSend = (data: string | ArrayBuffer) => {
    try {
      if (!wsRef.current) {
        console.warn('[VoiceMode] Cannot send - WebSocket ref is null');
        return false;
      }
      
      if (wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('[VoiceMode] Cannot send - WebSocket not open, state:', wsRef.current.readyState);
        return false;
      }
      
      wsRef.current.send(data);
      return true;
    } catch (error) {
      console.error('[VoiceMode] Error sending WebSocket message:', error);
      return false;
    }
  };
  
  // Keep stateRef in sync with state and notify parent
  useEffect(() => {
    stateRef.current = state;
    if (onStateChange) {
      onStateChange(state);
    }
  }, [state, onStateChange]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentTranscript]);

  // Preload AudioContext on mount to eliminate initialization delay
  // OpenAI Realtime API uses 24kHz PCM16 audio
  useEffect(() => {
    if (isOpen && !audioContextRef.current) {
      try {
        // Use 24kHz sample rate to match OpenAI Realtime API requirements
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        console.log('[VoiceMode] AudioContext preloaded, sampleRate:', audioContextRef.current.sampleRate);
      } catch (error) {
        console.error('[VoiceMode] Failed to preload AudioContext:', error);
      }
    }
  }, [isOpen]);

  // Initialize WebSocket connection
  useEffect(() => {
    if (!isOpen) return;

    connectWebSocket();

    return () => {
      cleanup();
    };
  }, [isOpen, userId, businessAccountId]);

  const connectWebSocket = () => {
    setIsConnecting(true);
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    let wsUrl = `${protocol}//${host}/ws/voice?businessAccountId=${businessAccountId}&userId=${userId}`;

    // TopScholar launch identity. The server requires this to authorize widget
    // voice on that account and to refuse a doubt that is already closed.
    if (topscholarToken) wsUrl += `&token=${encodeURIComponent(topscholarToken)}`;
    if (topscholarCpId) wsUrl += `&cpId=${encodeURIComponent(topscholarCpId)}`;

    // CRITICAL FIX: Include conversationId for reconnection to reuse existing session
    if (conversationIdRef.current) {
      wsUrl += `&conversationId=${conversationIdRef.current}`;
      console.log('[VoiceMode] Reconnecting with conversationId:', conversationIdRef.current);
    }
    
    console.log('[VoiceMode] Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[VoiceMode] WebSocket connected');
      setIsConnecting(false);
      setIsOnline(true);
      isOnlineRef.current = true;
      // Reset reconnect attempts on successful connection
      reconnectAttemptsRef.current = 0;
      
      // Start heartbeat monitoring
      startHeartbeatMonitoring();
    };

    ws.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        // Binary audio data
        const arrayBuffer = await event.data.arrayBuffer();
        await handleAudioChunk(arrayBuffer);
      } else {
        // JSON message
        try {
          const data = JSON.parse(event.data);
          handleMessage(data);
        } catch (error) {
          console.error('[VoiceMode] Failed to parse message:', error);
        }
      }
    };

    ws.onerror = (error) => {
      console.error('[VoiceMode] WebSocket error:', error);
      setIsConnecting(false);
      setIsOnline(false);
      isOnlineRef.current = false;
    };

    ws.onclose = () => {
      console.log('[VoiceMode] WebSocket closed');
      setIsOnline(false);
      isOnlineRef.current = false;
      setIsConnecting(false);
      
      // Clear heartbeat monitoring
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
        heartbeatTimeoutRef.current = null;
      }
      
      // CRITICAL FIX BUG 3: Don't auto-reconnect if session was explicitly closed by server
      if (sessionClosedByServerRef.current) {
        console.log('[VoiceMode] Session was closed by server - NOT attempting reconnection');
        console.log('[VoiceMode] User must manually restart voice mode');
        return;
      }
      
      // Attempt reconnection with exponential backoff (if we have a conversationId)
      if (conversationIdRef.current && isOpen) {
        attemptReconnect();
      }
    };
  };

  // Exponential backoff reconnection
  const attemptReconnect = () => {
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      console.error('[VoiceMode] Max reconnection attempts reached');
      toast({
        title: "Connection Lost",
        description: "Unable to reconnect. Please refresh and try again.",
        variant: "destructive"
      });
      return;
    }

    const backoffDelay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
    console.log(`[VoiceMode] Reconnecting in ${backoffDelay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
    
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectAttemptsRef.current++;
      connectWebSocket();
    }, backoffDelay);
  };

  // Heartbeat monitoring
  const startHeartbeatMonitoring = () => {
    // Reset previous timeout
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }

    // Set timeout for 60 seconds (server sends ping every 30s)
    heartbeatTimeoutRef.current = setTimeout(() => {
      console.warn('[VoiceMode] Heartbeat timeout - no ping received from server');
      
      // Close connection to trigger reconnect
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    }, 60000);
  };

  const handleMessage = async (data: any) => {
    console.log('[VoiceMode] Received message:', data.type);

    switch (data.type) {
      case 'ready':
        console.log('[VoiceMode] Service ready');
        
        // CRITICAL: Store conversationId for session persistence and reconnection
        if (data.conversationId) {
          conversationIdRef.current = data.conversationId;
          console.log('[VoiceMode] Stored conversationId:', data.conversationId);
        }
        
        // CRITICAL FIX BUG 3: Reset session closed flag on successful connection
        sessionClosedByServerRef.current = false;
        
        // CRITICAL FIX BUG 2: Flush any queued audio chunks after reconnection
        // This ensures no speech is lost if connection dropped mid-sentence
        if (data.reconnected && outboundAudioQueueRef.current.length > 0) {
          console.log(`[VoiceMode] Replaying ${outboundAudioQueueRef.current.length} buffered audio chunks after reconnection`);
          
          // Flush all queued chunks to the new WebSocket connection
          const queueLength = outboundAudioQueueRef.current.length;
          let sentCount = 0;
          
          while (outboundAudioQueueRef.current.length > 0) {
            const chunk = outboundAudioQueueRef.current.shift()!;
            if (safeSend(chunk)) {
              sentCount++;
            } else {
              // If send fails, put chunk back and stop flushing
              outboundAudioQueueRef.current.unshift(chunk);
              break;
            }
          }
          
          console.log(`[VoiceMode] Successfully replayed ${sentCount}/${queueLength} audio chunks`);
        }
        
        // Enable auto-restart for continuous conversation
        shouldAutoRestartRef.current = true;
        
        // Try auto-start, but if it fails (e.g., no user interaction yet), just stay idle
        // User can tap the orb to start manually
        if (hasPermissionRef.current === true || autoStart) {
          // We already have permission or autoStart is requested - start recording
          try {
            console.log('[VoiceMode] Auto-starting recording...', autoStart ? '(autoStart enabled)' : '(has permission)');
            await startRecording();
            console.log('[VoiceMode] Auto-start successful');
          } catch (error) {
            console.error('[VoiceMode] Auto-start failed:', error);
            setState('idle');
          }
        } else {
          // First time - need user interaction for mic permission
          console.log('[VoiceMode] Waiting for user interaction to request microphone...');
          setState('idle');
        }
        break;
      
      case 'ping':
        // Respond to server heartbeat ping with pong
        console.log('[VoiceMode] 🏓 Received ping from server, timestamp:', data.timestamp);
        if (safeSend(JSON.stringify({ type: 'pong' }))) {
          console.log('[VoiceMode] 🏓 Sent pong response to server');
        }
        // Reset heartbeat timeout on ping received
        startHeartbeatMonitoring();
        break;

      case 'speech_started':
        if (
          playbackStartedAtRef.current &&
          Date.now() - playbackStartedAtRef.current < BARGE_IN_GRACE_MS
        ) {
          break;
        }
        if (stateRef.current === 'speaking' || isPlayingRef.current || audioQueueRef.current.length > 0) {
          handleInterruption();
        }
        break;

      case 'transcript':
        // Clear interrupt flag when we get a new user transcript
        // This handles both client-side and server-side interruptions
        if (pendingInterruptRef.current && data.isFinal) {
          console.log('[VoiceMode] New user speech detected - clearing interrupt flag');
          pendingInterruptRef.current = false;
          bufferedTranscriptRef.current = null;
        }
        
        // Update current transcript
        if (data.isFinal) {
          // Add final user message
          const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            text: data.text,
            timestamp: new Date(),
            isFinal: true
          };
          
          // Check if AI response already started (transcript arrived late)
          // Prefer currentAIMessageIdRef (transcript during streaming) over lastAIMessageIdRef (transcript after ai_done)
          const aiMessageId = currentAIMessageIdRef.current || lastAIMessageIdRef.current;
          
          if (awaitingUserTranscriptRef.current && aiMessageId) {
            console.log('[VoiceMode] Late user transcript - inserting before AI message:', aiMessageId);
            setMessages(prev => {
              // Find the AI message and insert user message before it
              const aiMessageIndex = prev.findIndex(m => m.id === aiMessageId);
              if (aiMessageIndex !== -1) {
                const newMessages = [...prev];
                newMessages.splice(aiMessageIndex, 0, userMessage);
                return newMessages;
              }
              // AI message not found, add normally (shouldn't happen)
              console.warn('[VoiceMode] AI message not found for late transcript, adding to end');
              return [...prev, userMessage];
            });
          } else {
            // Normal flow - add to end
            setMessages(prev => [...prev, userMessage]);
          }
          
          // Clear reconciliation state
          awaitingUserTranscriptRef.current = false;
          lastAIMessageIdRef.current = null;
          setCurrentTranscript('');
          setState('thinking');
        } else {
          // Show interim transcript
          setCurrentTranscript(data.text);
        }
        break;

      case 'thinking':
        // Server is retrieving curriculum / preparing the answer — show the
        // Thinking… state even if the transcript event raced past us.
        setState('thinking');
        break;

      case 'answer_ready': {
        if (pendingInterruptRef.current) return;
        if (data.responseId) {
          currentResponseIdRef.current = data.responseId;
        }
        setState('speaking');
        if (!vadIntervalRef.current && mediaStreamRef.current) {
          startVoiceActivityDetection();
        }

        const messageId = Date.now().toString();
        currentAIMessageIdRef.current = messageId;
        awaitingUserTranscriptRef.current = true;
        const aiMessage: Message = {
          id: messageId,
          role: 'assistant',
          text: typeof data.displayMarkdown === 'string' ? data.displayMarkdown : '',
          timestamp: new Date(),
          isFinal: true,
        };
        setMessages(prev => [...prev, aiMessage]);
        break;
      }

      case 'ai_chunk':
        // Clear interrupt flag when AI starts responding to a new query
        // This ensures we don't block the new response after an interruption
        if (pendingInterruptRef.current && !currentAIMessageIdRef.current) {
          console.log('[VoiceMode] New AI response starting - clearing interrupt flag');
          pendingInterruptRef.current = false;
        }
        
        // Ignore late chunks if we're still pending an interrupt
        if (pendingInterruptRef.current) {
          console.log('[VoiceMode] Ignoring late ai_chunk after interrupt');
          return;
        }
        
        if (data.responseId) {
          currentResponseIdRef.current = data.responseId;
        }
        // AI streaming chunk - accumulate text for real-time display
        setState('speaking');
        
        // Start voice activity detection to allow user interruption
        if (!vadIntervalRef.current) {
          if (mediaStreamRef.current) {
            console.log('[VoiceMode] 🎤 Starting VAD - microphone ready');
            startVoiceActivityDetection();
          } else {
            console.warn('[VoiceMode] ⚠️  Cannot start VAD - microphone stream not ready');
          }
        }
        
        if (!currentAIMessageIdRef.current) {
          // First chunk - create new AI message
          const messageId = Date.now().toString();
          currentAIMessageIdRef.current = messageId;
          console.log('[VoiceMode] 🎬 First AI chunk, creating message:', messageId, 'text:', data.text);
          
          // Set flag to indicate we're expecting a user transcript that might arrive late
          awaitingUserTranscriptRef.current = true;
          
          const aiMessage: Message = {
            id: messageId,
            role: 'assistant',
            text: data.text,
            timestamp: new Date()
          };
          setMessages(prev => [...prev, aiMessage]);
        } else {
          // Subsequent chunks - append to existing message
          console.log('[VoiceMode] ➕ Appending chunk to message:', currentAIMessageIdRef.current, 'text:', data.text);
          setMessages(prev => prev.map(msg => 
            msg.id === currentAIMessageIdRef.current
              ? { ...msg, text: msg.text + data.text }
              : msg
          ));
        }
        break;

      case 'ai_speaking':
        // Legacy full-text mode (keep for backwards compatibility)
        setState('speaking');
        const aiMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          text: data.text,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, aiMessage]);
        break;

      case 'ai_done':
        // Ignore if we're pending an interrupt
        if (pendingInterruptRef.current) {
          console.log('[VoiceMode] Ignoring ai_done after interrupt');
          return;
        }
        if (data.responseId && currentResponseIdRef.current &&
            data.responseId !== currentResponseIdRef.current) {
          console.log('[VoiceMode] Ignoring ai_done for superseded response:', data.responseId);
          return;
        }
        
        console.log('[VoiceMode] ✅ AI done, message ID:', currentAIMessageIdRef.current);
        const completedResponseId = data.responseId || currentResponseIdRef.current;
        if (completedResponseId) {
          if (isPlayingRef.current || audioQueueRef.current.length > 0) {
            pendingPlaybackCompleteResponseIdRef.current = completedResponseId;
          } else {
            safeSend(JSON.stringify({ type: 'playback_complete', responseId: completedResponseId }));
            currentResponseIdRef.current = null;
          }
        }
        
        // AI finished speaking
        // Save message ID for potential late transcript reconciliation
        if (awaitingUserTranscriptRef.current && currentAIMessageIdRef.current) {
          lastAIMessageIdRef.current = currentAIMessageIdRef.current;
        }
        // Always clear the working ref
        currentAIMessageIdRef.current = null;
        
        // Stop voice activity detection
        stopVoiceActivityDetection();
        
        // Microphone is already running from when user last spoke
        // Just transition state back to listening without restarting recorder
        console.log('[VoiceMode] AI done, transitioning back to listening...');
        
        if (shouldAutoRestartRef.current && isOnlineRef.current && hasPermissionRef.current) {
          console.log('[VoiceMode] Ready for next turn (mic already active)...');
          setState('listening');
        } else {
          console.log('[VoiceMode] Not restarting - conditions not met');
          setState('idle');
        }
        break;

      case 'interrupt_ack':
        // Server acknowledged interrupt - clear pending flag and replay buffered transcript
        console.log('[VoiceMode] Interrupt acknowledged by server');
        pendingInterruptRef.current = false;
        if (pendingInterruptedMessageIdRef.current) {
          const interruptedMessageId = pendingInterruptedMessageIdRef.current;
          setMessages(prev => prev.filter(msg => msg.id !== interruptedMessageId));
          pendingInterruptedMessageIdRef.current = null;
        }
        currentAIMessageIdRef.current = null;
        
        // Replay buffered transcript if any
        if (bufferedTranscriptRef.current) {
          console.log('[VoiceMode] Replaying buffered transcript:', bufferedTranscriptRef.current.text);
          const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            text: bufferedTranscriptRef.current.text,
            timestamp: new Date(),
            isFinal: true
          };
          setMessages(prev => [...prev, userMessage]);
          bufferedTranscriptRef.current = null;
          setState('thinking');
        } else {
          setState('listening');
        }
        break;

      case 'interrupt_ignored':
        pendingInterruptRef.current = false;
        pendingInterruptedMessageIdRef.current = null;
        bufferedTranscriptRef.current = null;
        setState('listening');
        break;

      case 'response_cancelled':
        {
          const interruptedMessageId =
            pendingInterruptedMessageIdRef.current || currentAIMessageIdRef.current;
          if (interruptedMessageId) {
          setMessages(prev => prev.filter(msg => msg.id !== interruptedMessageId));
          }
          pendingInterruptedMessageIdRef.current = null;
          currentAIMessageIdRef.current = null;
          currentResponseIdRef.current = null;
        }
        break;

      case 'busy':
        // Queue is saturated - notify user with auto-resume
        console.log('[VoiceMode] Server busy, setting up auto-resume...');
        setBusyState(true);
        
        toast({
          title: "Just a moment...",
          description: "Processing previous request. Will resume automatically.",
          variant: "default"
        });
        
        setState('idle');
        setCurrentTranscript('');
        stopRecording();
        
        // Auto-resume after 5 seconds
        if (busyResumeTimeoutRef.current) {
          clearTimeout(busyResumeTimeoutRef.current);
        }
        
        busyResumeTimeoutRef.current = setTimeout(async () => {
          console.log('[VoiceMode] Auto-resuming after busy state...');
          setBusyState(false);
          
          if (isOnlineRef.current && hasPermissionRef.current) {
            try {
              await startRecording();
              setState('listening');
              toast({
                title: "Ready!",
                description: "I'm listening again.",
                duration: 1500
              });
            } catch (error) {
              console.error('[VoiceMode] Failed to auto-resume:', error);
            }
          }
        }, 5000);
        break;

      case 'processing_load':
        // Queue is getting full - subtle warning
        console.warn('[VoiceMode] High processing load, queue size:', data.queueSize);
        break;

      case 'session_closed':
        // CRITICAL FIX BUG 3: Server is closing session (heartbeat timeout, etc.)
        // Clear conversationId to prevent retry loop with stale session
        console.log('[VoiceMode] Server closed session:', data.reason);
        
        // Set flag to prevent auto-reconnection in ws.onclose handler
        sessionClosedByServerRef.current = true;
        
        // Clear conversationId to force new session if user manually restarts
        conversationIdRef.current = null;
        
        // Stop everything
        setState('idle');
        stopRecording();
        
        // Show user-friendly notification based on reason
        let notificationTitle = "Session Expired";
        let notificationDescription = "Your voice session has ended. Tap the orb to start a new conversation.";
        
        if (data.reason === 'heartbeat_timeout') {
          notificationTitle = "Session Timeout";
          notificationDescription = "Your session timed out due to inactivity. Tap the orb to start a new conversation.";
        } else if (data.reason === 'openai_connection_closed') {
          notificationTitle = "Service Disconnected";
          notificationDescription = "Voice service disconnected. Tap the orb to restart.";
        }
        
        toast({
          title: notificationTitle,
          description: notificationDescription,
          duration: 8000, // Longer duration so user sees it
          variant: "default"
        });
        
        console.log('[VoiceMode] ❌ Session closed by server - auto-reconnect disabled');
        console.log('[VoiceMode] ℹ️ User must manually tap orb to restart');
        break;

      case 'error':
        toast({
          title: "Error",
          description: data.message || "Voice processing error",
          variant: "destructive"
        });
        setState('idle');
        stopRecording();
        break;
    }
  };

  const handleAudioChunk = async (arrayBuffer: ArrayBuffer) => {
    try {
      // CRITICAL FIX: DO NOT drop audio during interrupts
      // The server will stop sending audio after response.cancel is processed
      // Dropping audio here causes gaps in playback for late-arriving chunks
      
      if (!audioContextRef.current) {
        // Create AudioContext - browser may use its preferred sample rate (often 48kHz)
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        console.log('[VoiceMode] AudioContext created for playback, sampleRate:', audioContextRef.current.sampleRate);
      }

      const actualSampleRate = audioContextRef.current.sampleRate;
      const sourceSampleRate = 24000; // OpenAI Realtime API outputs 24kHz

      // OpenAI sends PCM16 (Int16Array) audio at 24kHz
      // Convert raw bytes to Int16Array
      const pcm16Data = new Int16Array(arrayBuffer);
      
      // Convert Int16 PCM to Float32 for Web Audio API
      const float32Data = new Float32Array(pcm16Data.length);
      for (let i = 0; i < pcm16Data.length; i++) {
        // Convert from Int16 [-32768, 32767] to Float32 [-1, 1]
        float32Data[i] = pcm16Data[i] / (pcm16Data[i] < 0 ? 32768 : 32767);
      }

      // Resample if AudioContext sample rate doesn't match OpenAI's output
      let resampledData = float32Data;
      if (actualSampleRate !== sourceSampleRate) {
        const resampleRatio = actualSampleRate / sourceSampleRate;
        const outputLength = Math.floor(float32Data.length * resampleRatio);
        resampledData = new Float32Array(outputLength);
        
        // Cubic interpolation resampling for better audio quality
        // This reduces artifacts and produces smoother output than linear interpolation
        for (let i = 0; i < outputLength; i++) {
          const position = i / resampleRatio;
          const index = Math.floor(position);
          const fraction = position - index;
          
          // Get 4 surrounding samples for cubic interpolation
          const y0 = float32Data[Math.max(0, index - 1)] || 0;
          const y1 = float32Data[index] || 0;
          const y2 = float32Data[Math.min(float32Data.length - 1, index + 1)] || 0;
          const y3 = float32Data[Math.min(float32Data.length - 1, index + 2)] || 0;
          
          // Catmull-Rom cubic interpolation (smooth and artifact-free)
          const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
          const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
          const a2 = -0.5 * y0 + 0.5 * y2;
          const a3 = y1;
          
          const t = fraction;
          const t2 = t * t;
          const t3 = t2 * t;
          
          resampledData[i] = a0 * t3 + a1 * t2 + a2 * t + a3;
          
          // Clamp to prevent overshooting
          resampledData[i] = Math.max(-1, Math.min(1, resampledData[i]));
        }
      }

      // Create AudioBuffer at the actual AudioContext sample rate
      const audioBuffer = audioContextRef.current.createBuffer(
        1, // Mono
        resampledData.length,
        actualSampleRate
      );
      
      // Copy resampled Float32 data into buffer
      audioBuffer.getChannelData(0).set(resampledData);

      // Add to queue for playback
      audioQueueRef.current.push(audioBuffer);

      // Start playback if not already playing
      if (!isPlayingRef.current) {
        playNextAudioChunk();
      }
    } catch (error) {
      console.error('[VoiceMode] Audio chunk handling error:', error);
    }
  };


  // Voice Activity Detection for interruption handling
  const startVoiceActivityDetection = () => {
    if (!mediaSourceRef.current || !audioContextRef.current) {
      console.warn('[VoiceMode] Cannot start VAD - missing media source or audio context');
      return;
    }
    
    // Don't start if already running
    if (vadIntervalRef.current) {
      console.log('[VoiceMode] VAD already running');
      return;
    }
    
    try {
      // Create analyser for VAD
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      
      // Connect existing media source to analyser (don't create a new source)
      mediaSourceRef.current.connect(analyser);
      vadAnalyserRef.current = analyser;
      
      // Monitor audio levels to detect user speech
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const VOICE_THRESHOLD = 30; // Lowered from 35 for faster interruption detection (ChatGPT-style)
      const SPEECH_FRAMES_NEEDED = 1; // Interrupt immediately on first detection
      let speechFrames = 0;
      let silenceFrames = 0;
      
      vadIntervalRef.current = setInterval(() => {
        // Use ref to check state (avoid closure issues)
        if (stateRef.current !== 'speaking') {
          stopVoiceActivityDetection();
          return;
        }
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        
        // ENHANCED LOGGING: Always log to debug VAD (will remove after fixing)
        console.log('[VoiceMode] 🎤 VAD check - level:', average.toFixed(1), 'state:', stateRef.current);
        
        if (average > VOICE_THRESHOLD) {
          if (
            playbackStartedAtRef.current &&
            Date.now() - playbackStartedAtRef.current < BARGE_IN_GRACE_MS
          ) {
            speechFrames = 0;
            return;
          }
          // Speech detected - increment counter and reset silence
          speechFrames++;
          silenceFrames = 0;
          
          // INSTANT INTERRUPTION: Interrupt immediately on first detection (ChatGPT-style)
          if (speechFrames >= SPEECH_FRAMES_NEEDED) {
            console.log('[VoiceMode] 🎯 User speech detected - interrupting AI NOW!');
            
            // CRITICAL: Set pending interrupt flag FIRST to block late audio chunks
            pendingInterruptRef.current = true;
            
            // Stop VAD and trigger interruption
            stopVoiceActivityDetection();
            handleInterruption();
            speechFrames = 0; // Reset to prevent multiple triggers
          }
        } else {
          // Below threshold - increment silence counter
          silenceFrames++;
          
          // Only reset speech counter after 2 silent frames (200ms)
          // This prevents resetting on brief volume dips
          if (silenceFrames >= 2) {
            speechFrames = 0;
          }
        }
      }, 50); // Check every 50ms for instant interruption (ChatGPT-style)
      
      console.log('[VoiceMode] Voice activity detection started with threshold:', VOICE_THRESHOLD);
    } catch (error) {
      console.error('[VoiceMode] Failed to start VAD:', error);
    }
  };

  const stopVoiceActivityDetection = () => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    
    // Disconnect analyser but keep media source for recording
    if (vadAnalyserRef.current && mediaSourceRef.current) {
      try {
        mediaSourceRef.current.disconnect(vadAnalyserRef.current);
      } catch (e) {
        // Already disconnected
      }
    }
    
    vadAnalyserRef.current = null;
    console.log('[VoiceMode] Voice activity detection stopped');
  };

  const startVolumeMonitoring = () => {
    if (volumeIntervalRef.current || !playbackAnalyserRef.current) return;

    const dataArray = new Uint8Array(playbackAnalyserRef.current.frequencyBinCount);
    
    volumeIntervalRef.current = setInterval(() => {
      if (!playbackAnalyserRef.current) {
        stopVolumeMonitoring();
        return;
      }
      
      playbackAnalyserRef.current.getByteFrequencyData(dataArray);
      
      // Calculate average volume (0-255)
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      
      // Normalize to 0-100 and boost sensitivity
      const normalizedVolume = Math.min(100, (average / 255) * 150);
      setAudioVolume(normalizedVolume);
    }, 50); // Update every 50ms for smooth animations
    
    console.log('[VoiceMode] Volume monitoring started');
  };

  const stopVolumeMonitoring = () => {
    if (volumeIntervalRef.current) {
      clearInterval(volumeIntervalRef.current);
      volumeIntervalRef.current = null;
    }
    
    setAudioVolume(0); // Reset volume to 0
    console.log('[VoiceMode] Volume monitoring stopped');
  };

  const handleInterruption = () => {
    console.log('[VoiceMode] User interrupted! Stopping AI response...');
    
    // Set pending interrupt flag to ignore late chunks
    pendingInterruptRef.current = true;
    pendingPlaybackCompleteResponseIdRef.current = null;
    
    // Defer removing the interrupted AI message until the server confirms it
    // abandoned response ownership.
    if (currentAIMessageIdRef.current) {
      const interruptedMessageId = currentAIMessageIdRef.current;
      pendingInterruptedMessageIdRef.current = interruptedMessageId;
    }
    
    // Reset buffered transcript to prepare for new user speech
    bufferedTranscriptRef.current = null;
    
    // Stop VAD to prevent multiple interruptions
    stopVoiceActivityDetection();
    
    // Stop volume monitoring
    stopVolumeMonitoring();
    
    // Stop current audio playback
    if (currentAudioSourceRef.current) {
      try {
        currentAudioSourceRef.current.stop();
      } catch (e) {
        // Already stopped
      }
      currentAudioSourceRef.current = null;
    }
    
    // Clear audio queue
    audioQueueRef.current = [];
    audioChunkBufferRef.current = [];
    isPlayingRef.current = false;
    nextPlaybackTimeRef.current = 0;
    currentAIMessageIdRef.current = null;
    currentResponseIdRef.current = null;
    playbackStartedAtRef.current = 0;
    
    // Clear playback analyser
    if (playbackAnalyserRef.current) {
      try {
        playbackAnalyserRef.current.disconnect();
      } catch (e) {
        // Already disconnected
      }
      playbackAnalyserRef.current = null;
    }
    
    // Send interrupt signal to server
    safeSend(JSON.stringify({ type: 'interrupt' }));
    
    // Transition to listening state
    setState('listening');
    
    toast({
      title: "Listening",
      description: "Go ahead, I'm listening!",
      duration: 1000
    });
  };

  const playNextAudioChunk = () => {
    // Exit early if interrupt is pending - don't play residual audio
    if (pendingInterruptRef.current) {
      console.log('[VoiceMode] Skipping playback - interrupt pending');
      isPlayingRef.current = false;
      currentAudioSourceRef.current = null;
      audioQueueRef.current = [];
      return;
    }
    
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      currentAudioSourceRef.current = null;
      playbackStartedAtRef.current = 0;
      const completedResponseId = pendingPlaybackCompleteResponseIdRef.current;
      if (completedResponseId) {
        pendingPlaybackCompleteResponseIdRef.current = null;
        safeSend(JSON.stringify({ type: 'playback_complete', responseId: completedResponseId }));
        if (currentResponseIdRef.current === completedResponseId) {
          currentResponseIdRef.current = null;
        }
      }
      
      // Stop volume monitoring and clean up analyser when playback completes naturally
      stopVolumeMonitoring();
      if (playbackAnalyserRef.current) {
        try {
          playbackAnalyserRef.current.disconnect();
        } catch (e) {
          // Already disconnected
        }
        playbackAnalyserRef.current = null;
      }
      
      return;
    }

    isPlayingRef.current = true;
    const audioBuffer = audioQueueRef.current.shift()!;
    
    if (!audioContextRef.current) return;

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    
    // Create analyser for audio-reactive animations if not already created
    if (!playbackAnalyserRef.current) {
      playbackAnalyserRef.current = audioContextRef.current.createAnalyser();
      playbackAnalyserRef.current.fftSize = 256;
      playbackAnalyserRef.current.smoothingTimeConstant = 0.8;
      
      // Start monitoring volume for animations
      startVolumeMonitoring();
    }
    
    // Connect source -> analyser -> destination
    source.connect(playbackAnalyserRef.current);
    playbackAnalyserRef.current.connect(audioContextRef.current.destination);
    
    currentAudioSourceRef.current = source;
    
    // Schedule playback at precise time to avoid gaps
    const currentTime = audioContextRef.current.currentTime;
    const scheduleTime = Math.max(currentTime, nextPlaybackTimeRef.current);
    
    source.onended = () => {
      currentAudioSourceRef.current = null;
      playNextAudioChunk();
    };

    if (!playbackStartedAtRef.current) {
      playbackStartedAtRef.current = Date.now();
    }
    source.start(scheduleTime);
    
    // Advance playback time for next chunk
    nextPlaybackTimeRef.current = scheduleTime + audioBuffer.duration;
  };

  /**
   * Convert Float32 audio samples to Int16 PCM format
   */
  const float32ToInt16 = (float32Array: Float32Array): Int16Array => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp to [-1, 1] range and convert to 16-bit integer
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  };

  const startRecording = async () => {
    try {
      console.log('[VoiceMode] Starting recording...');
      
      // Safety guard: Don't create duplicate recorders
      if (audioWorkletNodeRef.current || scriptProcessorRef.current) {
        console.warn('[VoiceMode] Audio processor already active, skipping startRecording');
        return;
      }

      // Reset resampling state for clean start
      resampleFractionalPositionRef.current = 0;
      resampleLastSampleRef.current = 0;

      console.log('[VoiceMode] Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 24000, // Request 24kHz for OpenAI Realtime API
          channelCount: 1 // Mono audio
        } 
      });
      
      setHasPermission(true);
      hasPermissionRef.current = true;
      mediaStreamRef.current = stream;

      // Create AudioContext at 24kHz if not already created
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        console.log('[VoiceMode] AudioContext created, sampleRate:', audioContextRef.current.sampleRate);
      }

      // Verify we got 24kHz (some browsers might use a different rate)
      const actualSampleRate = audioContextRef.current.sampleRate;
      console.log('[VoiceMode] Actual AudioContext sample rate:', actualSampleRate);
      
      if (actualSampleRate !== 24000) {
        console.warn('[VoiceMode] Sample rate mismatch! Expected 24000, got', actualSampleRate);
        toast({
          title: "Audio Configuration Warning",
          description: `Browser is using ${actualSampleRate}Hz instead of 24kHz. Audio quality may vary.`,
          variant: "default"
        });
      }

      const source = audioContextRef.current.createMediaStreamSource(stream);
      mediaSourceRef.current = source;
      
      // CRITICAL FIX: Auto-start VAD if AI is already speaking when mic becomes ready
      // This handles the race condition when voice mode auto-opens from widget
      if (stateRef.current === 'speaking' && !vadIntervalRef.current) {
        console.log('[VoiceMode] 🎤 Microphone ready while AI speaking - auto-starting VAD for interruptions');
        startVoiceActivityDetection();
      }

      // Try to use AudioWorklet first (modern approach)
      let workletLoaded = false;
      if (audioContextRef.current.audioWorklet) {
        try {
          await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
          workletLoaded = true;
          console.log('[VoiceMode] AudioWorklet loaded successfully');
        } catch (error) {
          console.warn('[VoiceMode] AudioWorklet failed to load, falling back to ScriptProcessor:', error);
        }
      }

      if (workletLoaded && audioContextRef.current.audioWorklet) {
        // Use AudioWorklet (preferred method) with resampling support
        const workletNode = new AudioWorkletNode(
          audioContextRef.current, 
          'pcm16-audio-processor',
          {
            processorOptions: {
              sampleRate: actualSampleRate
            }
          }
        );
        audioWorkletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event) => {
          if (event.data.type === 'audio') {
            // CRITICAL FIX BUG 2: Real backpressure with pause/resume - NEVER drop audio
            const queueSize = outboundAudioQueueRef.current.length;
            
            // Check if queue is at 80% capacity - PAUSE recording
            if (queueSize >= maxOutboundQueueSize * 0.8) {
              if (!isPausedDueToBackpressureRef.current) {
                // Just hit 80% threshold - pause audio capture
                isPausedDueToBackpressureRef.current = true;
                console.warn('[VoiceMode] 🔴 PAUSING audio capture - queue at', queueSize, '/', maxOutboundQueueSize, '(80% capacity)');
                
                // Show persistent warning to user
                if (!backpressureWarningShownRef.current) {
                  backpressureWarningShownRef.current = true;
                  toast({
                    title: "Connection Slow - Pausing Audio",
                    description: "Audio capture paused while catching up. Please wait...",
                    variant: "default",
                    duration: 5000
                  });
                }
                
                // Don't add this chunk - we're paused
                return;
              } else {
                // Already paused - drop this chunk silently (we're paused, so this is expected)
                return;
              }
            }
            
            // Check if queue has drained below 50% - RESUME recording
            if (queueSize < maxOutboundQueueSize * 0.5 && isPausedDueToBackpressureRef.current) {
              // Queue drained - resume audio capture
              isPausedDueToBackpressureRef.current = false;
              backpressureWarningShownRef.current = false;
              console.log('[VoiceMode] ✅ RESUMING audio capture - queue drained to', queueSize, '/', maxOutboundQueueSize, '(below 50%)');
              
              // Show recovery message to user
              toast({
                title: "Connection Recovered - Resuming",
                description: "Audio capture resumed. You can speak normally now.",
                duration: 2000
              });
            }
            
            // If not paused, add chunk to queue and send
            if (!isPausedDueToBackpressureRef.current) {
              // Add new chunk to outbound queue
              outboundAudioQueueRef.current.push(event.data.data);
              
              // Send queued audio to server (FIFO)
              while (outboundAudioQueueRef.current.length > 0) {
                const chunk = outboundAudioQueueRef.current.shift()!;
                if (!safeSend(chunk)) {
                  // If send fails, put chunk back and stop sending
                  outboundAudioQueueRef.current.unshift(chunk);
                  break;
                }
              }
            }
          } else if (event.data.type === 'sampleRate') {
            // Log actual sample rates for diagnostics
            console.log(`[VoiceMode] AudioWorklet resampling: ${event.data.sourceSampleRate}Hz → ${event.data.targetSampleRate}Hz`);
          }
        };

        source.connect(workletNode);
        // Don't connect to destination - we don't want audio feedback
        
        console.log('[VoiceMode] Using AudioWorklet for audio capture with resampling');
      } else {
        // Fallback to ScriptProcessorNode (deprecated but widely supported)
        const bufferSize = 2048;
        const processor = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
        scriptProcessorRef.current = processor;

        processor.onaudioprocess = (event) => {
          const inputData = event.inputBuffer.getChannelData(0);
          
          // Resample to 24kHz if needed with fractional position tracking
          let resampledData = inputData;
          if (actualSampleRate !== 24000) {
            const resampleRatio = actualSampleRate / 24000; // source / target
            const output = [];
            
            // Continue from where we left off in the previous call
            let position = resampleFractionalPositionRef.current;
            
            while (true) {
              const index = Math.floor(position);
              const fraction = position - index;
              
              // Check if we've consumed all input samples
              if (index >= inputData.length) {
                break;
              }
              
              // Linear interpolation
              let sample;
              if (index + 1 < inputData.length) {
                sample = inputData[index] * (1 - fraction) + inputData[index + 1] * fraction;
              } else {
                // Use last sample from previous buffer for interpolation
                sample = inputData[index] * (1 - fraction) + resampleLastSampleRef.current * fraction;
              }
              
              output.push(sample);
              
              // Advance by the resample ratio (source samples per output sample)
              position += resampleRatio;
            }
            
            // Store the last sample for next interpolation
            if (inputData.length > 0) {
              resampleLastSampleRef.current = inputData[inputData.length - 1];
            }
            
            // Store fractional position for next call (subtract consumed samples)
            resampleFractionalPositionRef.current = position - inputData.length;
            
            resampledData = new Float32Array(output);
          }
          
          // Convert Float32 to Int16 PCM
          const pcm16Data = float32ToInt16(resampledData);
          
          // CRITICAL FIX BUG 2: Real backpressure with pause/resume (ScriptProcessor path) - NEVER drop audio
          const queueSize = outboundAudioQueueRef.current.length;
          
          // Check if queue is at 80% capacity - PAUSE recording
          if (queueSize >= maxOutboundQueueSize * 0.8) {
            if (!isPausedDueToBackpressureRef.current) {
              // Just hit 80% threshold - pause audio capture
              isPausedDueToBackpressureRef.current = true;
              console.warn('[VoiceMode] 🔴 PAUSING audio capture - queue at', queueSize, '/', maxOutboundQueueSize, '(80% capacity - ScriptProcessor)');
              
              // Show persistent warning to user
              if (!backpressureWarningShownRef.current) {
                backpressureWarningShownRef.current = true;
                toast({
                  title: "Connection Slow - Pausing Audio",
                  description: "Audio capture paused while catching up. Please wait...",
                  variant: "default",
                  duration: 5000
                });
              }
              
              // Don't add this chunk - we're paused
              return;
            } else {
              // Already paused - drop this chunk silently (we're paused, so this is expected)
              return;
            }
          }
          
          // Check if queue has drained below 50% - RESUME recording
          if (queueSize < maxOutboundQueueSize * 0.5 && isPausedDueToBackpressureRef.current) {
            // Queue drained - resume audio capture
            isPausedDueToBackpressureRef.current = false;
            backpressureWarningShownRef.current = false;
            console.log('[VoiceMode] ✅ RESUMING audio capture - queue drained to', queueSize, '/', maxOutboundQueueSize, '(below 50% - ScriptProcessor)');
            
            // Show recovery message to user
            toast({
              title: "Connection Recovered - Resuming",
              description: "Audio capture resumed. You can speak normally now.",
              duration: 2000
            });
          }
          
          // If not paused, add chunk to queue and send
          if (!isPausedDueToBackpressureRef.current) {
            // Add new chunk to outbound queue
            outboundAudioQueueRef.current.push(pcm16Data.buffer);
            
            // Send queued audio to server (FIFO)
            while (outboundAudioQueueRef.current.length > 0) {
              const chunk = outboundAudioQueueRef.current.shift()!;
              if (!safeSend(chunk)) {
                // If send fails, put chunk back and stop sending
                outboundAudioQueueRef.current.unshift(chunk);
                break;
              }
            }
          }
        };

        source.connect(processor);
        // Don't connect to destination - we don't want audio feedback
        
        console.log('[VoiceMode] Using ScriptProcessor for audio capture (fallback) with resampling');
      }

      setState('listening');
      
    } catch (error: any) {
      console.error('[VoiceMode] Microphone error:', error);
      setHasPermission(false);
      hasPermissionRef.current = false;
      setState('idle'); // Reset to idle on mic access failure
      
      if (error.name === 'NotAllowedError') {
        toast({
          title: "Microphone Access Denied",
          description: "Please allow microphone permissions in your browser settings.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Microphone Error",
          description: "Failed to access microphone. Please check your settings.",
          variant: "destructive"
        });
      }
    }
  };

  const stopRecording = (): Promise<void> => {
    return new Promise((resolve) => {
      try {
        console.log('[VoiceMode] Stopping recording...');

        // Disconnect and clean up audio nodes
        if (audioWorkletNodeRef.current) {
          audioWorkletNodeRef.current.disconnect();
          audioWorkletNodeRef.current.port.onmessage = null;
          audioWorkletNodeRef.current = null;
          console.log('[VoiceMode] AudioWorklet node cleaned up');
        }

        if (scriptProcessorRef.current) {
          scriptProcessorRef.current.disconnect();
          scriptProcessorRef.current.onaudioprocess = null;
          scriptProcessorRef.current = null;
          console.log('[VoiceMode] ScriptProcessor node cleaned up');
        }

        if (mediaSourceRef.current) {
          mediaSourceRef.current.disconnect();
          mediaSourceRef.current = null;
          console.log('[VoiceMode] MediaSource node cleaned up');
        }

        // Stop all media stream tracks to release microphone
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => {
            track.stop();
            console.log('[VoiceMode] Stopped media track:', track.kind);
          });
          mediaStreamRef.current = null;
        }

        resolve();
        
      } catch (error) {
        console.error('[VoiceMode] Error stopping recording:', error);
        // Clean up on error
        audioWorkletNodeRef.current = null;
        scriptProcessorRef.current = null;
        mediaSourceRef.current = null;
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        }
        resolve();
      }
    });
  };

  const cleanup = () => {
    console.log('[VoiceMode] Cleaning up resources...');
    
    // Disable auto-restart when cleaning up
    shouldAutoRestartRef.current = false;
    
    try {
      // Clear all timers and intervals
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
        heartbeatTimeoutRef.current = null;
      }
      
      if (busyResumeTimeoutRef.current) {
        clearTimeout(busyResumeTimeoutRef.current);
        busyResumeTimeoutRef.current = null;
      }
      
      // Stop voice activity detection
      stopVoiceActivityDetection();
      
      // Stop volume monitoring
      stopVolumeMonitoring();
      
      // Stop any ongoing audio playback
      if (currentAudioSourceRef.current) {
        try {
          currentAudioSourceRef.current.stop();
        } catch (e) {
          // Source may already be stopped
        }
        currentAudioSourceRef.current = null;
      }
      
      // Disconnect playback analyser
      if (playbackAnalyserRef.current) {
        try {
          playbackAnalyserRef.current.disconnect();
        } catch (e) {
          // Already disconnected
        }
        playbackAnalyserRef.current = null;
      }

      // Clear audio queues
      audioQueueRef.current = [];
      audioChunkBufferRef.current = [];
      outboundAudioQueueRef.current = [];
      isPlayingRef.current = false;
      nextPlaybackTimeRef.current = 0;

      // Stop recording and release microphone
      stopRecording();

      // Close WebSocket connection
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }

      // Suspend and close audio context to release audio resources
      if (audioContextRef.current) {
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().then(() => {
            console.log('[VoiceMode] AudioContext closed');
          }).catch((error) => {
            console.error('[VoiceMode] Error closing AudioContext:', error);
          });
        }
        audioContextRef.current = null;
      }

      // Reset all state
      setState('idle');
      setMessages([]);
      setCurrentTranscript('');
      setIsOnline(false);
      isOnlineRef.current = false;
      setIsConnecting(false);
      setBusyState(false);
      conversationIdRef.current = null;
      reconnectAttemptsRef.current = 0;

      console.log('[VoiceMode] Cleanup complete');
    } catch (error) {
      console.error('[VoiceMode] Error during cleanup:', error);
    }
  };

  const handleClose = () => {
    cleanup();
    onClose();
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getBorderRadiusAnimation = () => {
    switch (voiceModeStyle) {
      case 'circular':
        return '50%'; // Perfect circle always - no animation
      
      case 'morphing':
        // Organic breathing effect - gentler in idle/listening, more pronounced in speaking
        if (state === 'speaking') {
          return ['50%', '48% 52%', '52% 48%', '50%'];
        } else if (state === 'listening') {
          return ['50%', '49% 51%', '51% 49%', '50%'];
        } else {
          return ['50%', '49.5% 50.5%', '50.5% 49.5%', '50%'];
        }
      
      case 'distorted':
        // Wavy fluid blob - extreme distortion
        if (state === 'speaking') {
          return ['50%', '42% 58%', '58% 42%', '46% 54%', '54% 46%', '50%'];
        } else if (state === 'listening') {
          return ['50%', '45% 55%', '55% 45%', '48% 52%', '52% 48%', '50%'];
        } else {
          return ['50%', '47% 53%', '53% 47%', '50%'];
        }
      
      case 'angular':
        // Sharp faceted shape - polygon-like
        if (state === 'speaking') {
          return ['45%', '40%', '45%', '50%'];
        } else if (state === 'listening') {
          return ['48%', '45%', '48%', '50%'];
        } else {
          return ['49%', '47%', '49%', '50%'];
        }
      
      case 'ocean-wave':
        // Flowing wave motion - undulating like ocean waves
        if (state === 'speaking') {
          return ['50% 40% 60% 40%', '40% 60% 40% 60%', '60% 40% 50% 50%', '50% 40% 60% 40%'];
        } else if (state === 'listening') {
          return ['50% 45% 55% 45%', '45% 55% 45% 55%', '55% 45% 50% 50%', '50% 45% 55% 45%'];
        } else {
          return ['50% 48% 52% 48%', '48% 52% 48% 52%', '52% 48% 50% 50%', '50% 48% 52% 48%'];
        }
      
      case 'triangle':
        // Dynamic pyramid/triangle shape - sharp angular edges
        if (state === 'speaking') {
          return ['20% 20% 50%', '15% 15% 55%', '25% 25% 45%', '20% 20% 50%'];
        } else if (state === 'listening') {
          return ['22% 22% 48%', '18% 18% 52%', '26% 26% 44%', '22% 22% 48%'];
        } else {
          return ['25% 25% 45%', '20% 20% 50%', '28% 28% 42%', '25% 25% 45%'];
        }
      
      case 'hexagon':
        // Technical honeycomb hexagonal shape
        if (state === 'speaking') {
          return ['30%', '25%', '30%', '25%'];
        } else if (state === 'listening') {
          return ['32%', '28%', '32%', '28%'];
        } else {
          return ['35%', '32%', '35%', '32%'];
        }
      
      case 'diamond':
        // Brilliant faceted diamond/gem shape
        if (state === 'speaking') {
          return ['25%', '20%', '25%', '30%'];
        } else if (state === 'listening') {
          return ['28%', '24%', '28%', '32%'];
        } else {
          return ['30%', '27%', '30%', '33%'];
        }
      
      case 'infinity':
        // Continuous figure-8 infinity loop
        if (state === 'speaking') {
          return ['50% 30%', '30% 50%', '50% 30%', '30% 50%'];
        } else if (state === 'listening') {
          return ['50% 35%', '35% 50%', '50% 35%', '35% 50%'];
        } else {
          return ['50% 40%', '40% 50%', '50% 40%', '40% 50%'];
        }
      
      default:
        return '50%';
    }
  };

  const getOrbStyle = () => {
    const baseSize = 280;
    let scale = 1;
    let pulseSpeed = '3s';

    switch (state) {
      case 'listening':
        scale = 1.1;
        pulseSpeed = '0.8s';
        break;
      case 'thinking':
        scale = 1.05;
        pulseSpeed = '1.5s';
        break;
      case 'speaking':
        scale = 1.08;
        pulseSpeed = '1s';
        break;
      default:
        scale = 1;
        pulseSpeed = '3s';
    }

    return {
      width: `${baseSize}px`,
      height: `${baseSize}px`,
      transform: `scale(${scale})`,
      animationDuration: pulseSpeed
    };
  };

  if (!isOpen) return null;
  
  // Headless mode: run all voice logic but render nothing
  if (headless) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-gradient-to-br from-gray-50 via-white to-gray-100 flex flex-col overflow-hidden"
      >

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{widgetHeaderText}</h2>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
              <span className="text-sm text-gray-600">
                {isConnecting ? 'Connecting...' : isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="text-gray-600 hover:text-gray-900"
          >
            <X className="w-6 h-6" />
          </Button>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
          {/* Animated Orb Container */}
          <div className="flex flex-col items-center justify-center">
            {/* Animated Orb */}
            <div className="relative flex items-center justify-center">
            {/* Animated Wave Rings for Listening - Inward pulse */}
            {state === 'listening' && (
              <>
                {[0, 1, 2].map((index) => (
                  <motion.div
                    key={`listening-${index}`}
                    className="absolute rounded-full border-2 border-white/30"
                    style={{
                      width: '280px',
                      height: '280px',
                    }}
                    initial={{ scale: 1.5, opacity: 0 }}
                    animate={{
                      scale: [1.5, 1],
                      opacity: [0, 0.6, 0],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: index * 0.6,
                      ease: "easeInOut"
                    }}
                  />
                ))}
              </>
            )}

            {/* Animated Wave Rings for Speaking - Outward pulse */}
            {state === 'speaking' && (
              <>
                {[0, 1, 2, 3].map((index) => (
                  <motion.div
                    key={`speaking-${index}`}
                    className="absolute rounded-full border-2 border-white/40"
                    style={{
                      width: '280px',
                      height: '280px',
                    }}
                    initial={{ scale: 1, opacity: 0 }}
                    animate={{
                      scale: [1, 1.8],
                      opacity: [0.6, 0],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      delay: index * 0.35,
                      ease: "easeOut"
                    }}
                  />
                ))}
              </>
            )}

            {/* Animated Shimmer for Thinking */}
            {state === 'thinking' && (
              <>
                {[0, 1].map((index) => (
                  <motion.div
                    key={`thinking-${index}`}
                    className="absolute rounded-full border-2 border-white/25"
                    style={{
                      width: '280px',
                      height: '280px',
                    }}
                    animate={{
                      scale: [1, 1.15, 1],
                      opacity: [0.3, 0.6, 0.3],
                      rotate: [0, 180, 360],
                    }}
                    transition={{
                      duration: 3,
                      repeat: Infinity,
                      delay: index * 1.5,
                      ease: "linear"
                    }}
                  />
                ))}
              </>
            )}

            <motion.div
              className="rounded-full orb-pulse cursor-pointer relative flex items-center justify-center overflow-hidden"
              style={{
                background: `linear-gradient(${state === 'speaking' ? '135deg' : '135deg'}, ${chatColor}, ${chatColorEnd})`,
                ...getOrbStyle()
              }}
              animate={{
                scale: state === 'listening' 
                  ? [1, 1.05, 1] 
                  : state === 'speaking' 
                    ? [1, 1.03 + (audioVolume / 300), 1] // Audio-reactive scaling
                    : [1, 1.02, 1],
                rotate: state === 'speaking' ? [0, 360] : 0, // Gradient rotation during speaking
                borderRadius: getBorderRadiusAnimation(),
              }}
              transition={{
                scale: {
                  duration: state === 'listening' ? 0.8 : state === 'speaking' ? 0.6 : 3,
                  repeat: Infinity,
                  ease: "easeInOut"
                },
                rotate: {
                  duration: 10, // Slow gradient rotation
                  repeat: Infinity,
                  ease: "linear"
                },
                borderRadius: {
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }
              }}
              onClick={async () => {
                if (state === 'idle' && isOnline && !isConnecting) {
                  shouldAutoRestartRef.current = true;
                  setState('listening');
                  await startRecording();
                }
              }}
              data-testid="voice-orb"
            >
              {/* Avatar Display - centered inside orb */}
              {avatarType && avatarType !== 'none' && (
                <div className="absolute inset-0 z-20 flex items-center justify-center p-8">
                  <img 
                    src={avatarType === 'custom' ? (avatarUrl || '') : `/avatars/avatar-${avatarType.replace('preset-', '')}.png`}
                    alt="AI Assistant"
                    className="w-full h-full object-cover rounded-full"
                    style={{
                      filter: state === 'speaking' ? 'brightness(1.1)' : 'brightness(1)',
                      transition: 'filter 0.3s ease'
                    }}
                  />
                </div>
              )}

              {/* Animated Cloudy Blobs Inside Orb */}
              {state !== 'idle' && (
                <div className="absolute inset-0 z-0">
                  {/* Cloud blob 1 */}
                  <motion.div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full"
                    style={{
                      background: 'radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.4) 35%, transparent 65%)',
                      filter: 'blur(30px)',
                    }}
                    animate={{
                      x: ['-60px', '40px', '-60px'],
                      y: ['-50px', '30px', '-50px'],
                      scale: [1, 1.2, 1],
                    }}
                    transition={{
                      duration: state === 'speaking' ? 4 : 6,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                  />
                  
                  {/* Cloud blob 2 */}
                  <motion.div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 rounded-full"
                    style={{
                      background: 'radial-gradient(circle, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.35) 35%, transparent 65%)',
                      filter: 'blur(35px)',
                    }}
                    animate={{
                      x: ['50px', '-50px', '50px'],
                      y: ['30px', '-40px', '30px'],
                      scale: [1.1, 0.9, 1.1],
                    }}
                    transition={{
                      duration: state === 'speaking' ? 5 : 7,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: 0.8
                    }}
                  />
                  
                  {/* Cloud blob 3 */}
                  <motion.div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-52 h-52 rounded-full"
                    style={{
                      background: 'radial-gradient(circle, rgba(255, 255, 255, 0.88) 0%, rgba(255, 255, 255, 0.38) 35%, transparent 65%)',
                      filter: 'blur(32px)',
                    }}
                    animate={{
                      x: ['-30px', '50px', '-30px'],
                      y: ['40px', '-30px', '40px'],
                      scale: [1, 1.3, 1],
                    }}
                    transition={{
                      duration: state === 'speaking' ? 4.5 : 6.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: 1.5
                    }}
                  />
                  
                  {/* Cloud blob 4 - Smaller accent */}
                  <motion.div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 rounded-full"
                    style={{
                      background: 'radial-gradient(circle, rgba(255, 255, 255, 0.92) 0%, rgba(255, 255, 255, 0.45) 35%, transparent 65%)',
                      filter: 'blur(28px)',
                    }}
                    animate={{
                      x: ['35px', '-40px', '35px'],
                      y: ['-25px', '35px', '-25px'],
                      scale: [1.15, 0.85, 1.15],
                    }}
                    transition={{
                      duration: state === 'speaking' ? 3.5 : 5.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: 2.2
                    }}
                  />
                  
                  {/* Additional faster moving cloud for speaking state */}
                  {state === 'speaking' && (
                    <motion.div
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-60 h-60 rounded-full"
                      style={{
                        background: 'radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.3) 35%, transparent 65%)',
                        filter: 'blur(38px)',
                      }}
                      animate={{
                        x: ['-70px', '60px', '-70px'],
                        y: ['20px', '-50px', '20px'],
                        scale: [1, 1.4, 1],
                      }}
                      transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: 0.3
                      }}
                    />
                  )}
                </div>
              )}

              {/* Inner glow - Enhanced and audio-reactive */}
              <motion.div 
                className="absolute inset-0 rounded-full blur-3xl z-0"
                animate={{
                  opacity: state === 'speaking' 
                    ? [0.4, 0.4 + (audioVolume / 250), 0.4] 
                    : 0.4,
                  scale: state === 'speaking'
                    ? [1, 1 + (audioVolume / 500), 1]
                    : 1,
                }}
                transition={{
                  opacity: {
                    duration: 0.3,
                    ease: "easeInOut"
                  },
                  scale: {
                    duration: 0.3,
                    ease: "easeInOut"
                  }
                }}
                style={{
                  background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`,
                }}
              />

              {/* Content inside circle - Avatar or Mic Icon */}
              {avatarType !== 'none' && avatarUrl ? (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <img 
                    src={avatarUrl} 
                    alt="AI Assistant" 
                    className="w-full h-full object-cover rounded-full"
                  />
                </div>
              ) : (
                <div className="relative z-10 flex items-center justify-center">
                  <Mic className="w-20 h-20 text-white/90" strokeWidth={1.5} />
                </div>
              )}
            </motion.div>
            </div>
            {/* End Animated Orb */}

            {/* "Tap to talk" label below orb when idle */}
            {state === 'idle' && !busyState && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 text-center"
              >
                <motion.p
                  className="text-gray-600 text-lg font-medium"
                  animate={{
                    opacity: [0.6, 1, 0.6],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                >
                  Tap to talk
                </motion.p>
              </motion.div>
            )}
            
            {/* "Tap to resume" UI for busy state */}
            {busyState && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 text-center"
              >
                <Button
                  onClick={async () => {
                    console.log('[VoiceMode] Manual resume from busy state');
                    
                    // Clear auto-resume timeout
                    if (busyResumeTimeoutRef.current) {
                      clearTimeout(busyResumeTimeoutRef.current);
                      busyResumeTimeoutRef.current = null;
                    }
                    
                    setBusyState(false);
                    
                    if (isOnlineRef.current && hasPermissionRef.current) {
                      try {
                        await startRecording();
                        setState('listening');
                        toast({
                          title: "Ready!",
                          description: "I'm listening.",
                          duration: 1500
                        });
                      } catch (error) {
                        console.error('[VoiceMode] Failed to manually resume:', error);
                      }
                    }
                  }}
                  className="bg-gradient-to-r hover:opacity-90 transition-opacity"
                  style={{ 
                    background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})`,
                    color: 'white'
                  }}
                >
                  <Hand className="w-4 h-4 mr-2" />
                  Tap to resume
                </Button>
                <p className="text-sm text-gray-500 mt-2">
                  Auto-resuming in a moment...
                </p>
              </motion.div>
            )}
          </div>
          {/* End Animated Orb Container */}

          {/* Voice mode - clean interface with only orb, no text transcripts */}
        </div>

        {/* Microphone permission error */}
        {hasPermission === false && (
          <div className="p-6 bg-white/80 backdrop-blur-sm border-t border-gray-200">
            <p className="text-center text-sm text-red-600">
              Microphone access denied. Please enable it in your browser settings.
            </p>
          </div>
        )}

        <style>{`
          .orb-pulse {
            box-shadow: 0 0 60px rgba(147, 51, 234, 0.5),
                        0 0 120px rgba(59, 130, 246, 0.4),
                        0 0 180px rgba(147, 51, 234, 0.3),
                        0 0 240px rgba(147, 51, 234, 0.2);
            position: relative;
            transition: box-shadow 0.3s ease-out;
          }
          
          .orb-pulse::before {
            content: '';
            position: absolute;
            inset: -25px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(147, 51, 234, 0.15) 0%, transparent 70%);
            animation: pulse-ring 3s ease-in-out infinite;
            pointer-events: none;
          }
          
          .orb-pulse::after {
            content: '';
            position: absolute;
            inset: -35px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 80%);
            animation: pulse-ring-outer 4s ease-in-out infinite;
            pointer-events: none;
          }
          
          @keyframes pulse-ring {
            0%, 100% {
              opacity: 0.4;
              transform: scale(1);
            }
            50% {
              opacity: 0.8;
              transform: scale(1.08);
            }
          }
          
          @keyframes pulse-ring-outer {
            0%, 100% {
              opacity: 0.3;
              transform: scale(1);
            }
            50% {
              opacity: 0.6;
              transform: scale(1.12);
            }
          }
        `}</style>
      </motion.div>
    </AnimatePresence>
  );
}
