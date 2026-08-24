import { Mic, MicOff, X, Loader2 } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

// Refuse to barge-in for this long after a new answer starts playing — this is
// exactly when the AI's first syllables (and their echo bleeding into the mic)
// arrive, which previously self-cancelled the whole answer. Kept in lockstep
// with the server-side BARGE_IN_GRACE_MS in realtimeVoiceService.ts.
const BARGE_IN_GRACE_MS = 700;
const TOPSCHOLAR_LISTENING_IDLE_TIMEOUT_MS = 10_000;

interface InlineVoiceModeProps {
  isActive: boolean;
  onClose: () => void;
  userId: string;
  businessAccountId: string;
  chatColor?: string;
  chatColorEnd?: string;
  avatarType?: string;
  avatarUrl?: string;
  selectedLanguage?: string;
  textConversationId?: string;
  onUserMessage?: (text: string) => void;
  onTranscriptCorrection?: (original: string, corrected: string) => void;
  onAIMessageStart?: (messageId: string) => void;
  onAIMessageChunk?: (messageId: string, text: string) => void;
  onAIMessageDone?: (messageId: string) => void;
  onAIMessageCancelled?: (messageId: string) => void;
  /**
   * Atomic canonical answer contract. The display Markdown is inserted directly
   * into message state; spokenText is retained only for karaoke timing.
   */
  onAIMessageReady?: (messageId: string, displayMarkdown: string, spokenText: string) => void;
  /**
   * Final on-screen version of a spoken answer: formatted Markdown, with any
   * curriculum diagrams already placed inline. Diagrams travel around the model
   * rather than through it — the tutor never says a URL — so they arrive here,
   * after the answer, rather than in the spoken stream.
   */
  onAIMessageReplace?: (messageId: string, formattedMarkdown: string) => void;
  /**
   * TopScholar launch identity. The server refuses a widget voice connection on
   * this account without it, and refuses it outright once the doubt is closed.
   */
  topscholarToken?: string;
  topscholarCpId?: string;
  /**
   * Karaoke progress for the bubble that is currently being spoken aloud.
   * `charOffset` is how many characters of the raw spoken transcript the
   * audio clock says have been heard (word-snapped); `done: true` means
   * playback for that bubble ended (finished, interrupted, or abandoned)
   * and any highlight should be removed.
   */
  onSpeakingProgress?: (messageId: string, charOffset: number, done: boolean) => void;
}

export function InlineVoiceMode({
  isActive,
  onClose,
  userId,
  businessAccountId,
  textConversationId,
  chatColor = "#9333ea",
  chatColorEnd = "#3b82f6",
  avatarType = "none",
  avatarUrl,
  selectedLanguage,
  onUserMessage,
  onTranscriptCorrection,
  onAIMessageStart,
  onAIMessageChunk,
  onAIMessageDone,
  onAIMessageCancelled,
  onAIMessageReady,
  onAIMessageReplace,
  topscholarToken,
  topscholarCpId,
  onSpeakingProgress,
}: InlineVoiceModeProps) {
  const [state, setState] = useState<VoiceState>('idle');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [audioVolume, setAudioVolume] = useState(0);
  // Why voice could not start. Shown in the control itself rather than only as
  // a toast: a failure before the session is ready leaves the button looking
  // identical to an idle one, so without this it reads as simply not clicking.
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  // Whether voice has had a working session at any point since this control was
  // opened. Distinguishes "never started" (tell the user — they are waiting on a
  // click that did nothing) from "dropped mid-session" (reconnect quietly).
  // Deliberately NOT reset per connection attempt, or a flaky reconnect would
  // stop retrying and report a failure the user never saw start.
  const hadReadySessionRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingRef = useRef(false);
  // Schedule-on-arrival player tracks every BufferSourceNode that's been
  // scheduled but hasn't yet ended, so an interrupt can stop them all.
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  // One-shot diagnostic: log requested-vs-actual AudioContext sample rate
  // on the first PCM chunk so we can confirm whether the device honored
  // 24 kHz (avoiding extra resampling) or forced 48 kHz.
  const sampleRateLoggedRef = useRef(false);
  const nextPlaybackTimeRef = useRef<number>(0);
  const outboundAudioQueueRef = useRef<ArrayBuffer[]>([]);
  const maxOutboundQueueSize = 100;
  const isPausedDueToBackpressureRef = useRef(false);
  const backpressureWarningShownRef = useRef(false);
  const shouldAutoRestartRef = useRef(false);
  const isOnlineRef = useRef(true);
  const hasPermissionRef = useRef(false);
  const stateRef = useRef(state);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const resampleFractionalPositionRef = useRef<number>(0);
  const resampleLastSampleRef = useRef<number>(0);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingInterruptRef = useRef(false);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  // Timestamp (ms) when the current answer's audio started playing. Used by the
  // VAD as a short barge-in grace window so the AI's own opening words / echo
  // can't self-cancel the answer. 0 when no answer is playing.
  const playbackStartedAtRef = useRef<number>(0);
  const volumeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const busyResumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const listeningInactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastListeningActivityAtRef = useRef<number>(0);
  const sessionClosedByServerRef = useRef(false);
  const currentAIMessageIdRef = useRef<string | null>(null);
  const awaitingUserTranscriptRef = useRef(false);
  const lastAIMessageIdRef = useRef<string | null>(null);
  const bufferedTranscriptRef = useRef<{text: string, isFinal: boolean} | null>(null);
  const aiDoneReceivedRef = useRef(false);
  // Maps OpenAI responseId → client-side message bubble id, used to swap in
  // formatted Markdown for STEM voice answers when the formatter pass completes.
  // Bound directly from the responseId stamped on each ai_chunk event, so it is
  // race-free across rapid back-to-back voice turns.
  const responseIdToMessageIdRef = useRef<Map<string, string>>(new Map());
  // Buffers formatted_transcript events that arrive before we have created
  // the bubble for that responseId (rare but possible if formatter is faster
  // than the first chunk for a tiny response).
  const pendingFormattedRef = useRef<Map<string, string>>(new Map());
  // Most recent OpenAI responseId observed via ai_chunk — captured at interrupt
  // time so we know which response was cancelled even after we clear the bubble ref.
  const currentResponseIdRef = useRef<string | null>(null);
  // ResponseIds the user interrupted. Late ai_chunk / formatted_transcript events
  // for these IDs must be dropped to avoid creating a phantom second bubble or
  // overwriting a finalized partial. Capped FIFO at 20.
  const interruptedResponseIdsRef = useRef<Set<string>>(new Set());
  // Defense-in-depth for ElevenLabs PCM streaming: if a binary audio chunk
  // arrives with an odd byte length (or a future proxy fragments the WS
  // frame mid-sample), carry the trailing byte forward so we never feed an
  // unaligned buffer to `new Int16Array`. For OpenAI's already-aligned base64
  // chunks this stays null forever and the new logic is a no-op.
  const pcmLeftoverByteRef = useRef<Uint8Array | null>(null);
  // ---- Karaoke highlight timeline -----------------------------------------
  // Maps "how far has playback actually gotten" onto "how many characters of
  // the spoken transcript has the student heard", using a SPEAKING-RATE model.
  //
  // Transcript deltas arrive far ahead of the audio, so nothing may be keyed
  // to delta arrival. The earlier watermark approach ("all text received so
  // far is heard when all audio received so far finishes") carried that whole
  // text-vs-audio gap into the highlight — it ran up to a sentence ahead.
  //
  // Instead: both streams arrive in generation order, so chars-received ÷
  // audio-seconds-received estimates the true speaking rate, and
  //   offset ≈ rate × secondsActuallyPlayed
  // spreads any instantaneous gap proportionally instead of front-loading it.
  // As the answer streams in, the estimate converges on the exact rate and the
  // offset lands on the full text exactly when playback drains.
  //
  // secondsActuallyPlayed is derived from the Web Audio scheduler, not wall
  // time: scheduled audio is contiguous at the tail (each chunk starts at
  // max(now, previous end)), so played = totalScheduled − (scheduledEnd − now).
  // This stays correct across buffering stalls and tab suspension.
  const karaokeRef = useRef<{
    messageId: string | null;
    text: string;
    /** Cumulative duration (s) of audio scheduled for this bubble. */
    audioSeconds: number;
    /** AudioContext time at which the last scheduled chunk ends. */
    audioEndTime: number;
    lastEmitted: number;
    /** Un-snapped offset from the previous frame — catch-up rate limiter. */
    lastRaw: number;
    /** AudioContext time of the previous rAF tick, for per-frame dt. */
    lastTickTime: number;
    /**
     * Show-then-speak: the FULL transcript arrived in one final chunk before
     * any audio. chars-received ÷ audio-received is then an upper bound, not
     * an estimate — until all audio has arrived, cap the rate at a typical
     * speaking rate instead so the highlight can't sprint ahead.
     */
    textFinal: boolean;
    /** ai_done received ⇒ every PCM byte for this bubble has arrived. */
    audioComplete: boolean;
  }>({ messageId: null, text: '', audioSeconds: 0, audioEndTime: 0, lastEmitted: -1, lastRaw: 0, lastTickTime: 0, textFinal: false, audioComplete: false });
  const karaokeRafRef = useRef<number | null>(null);

  // The highlight deliberately trails the voice: subtracting this from played
  // seconds absorbs the residual "transcript leads audio" bias, and a slight
  // trail reads as correct where an equal lead reads as broken.
  const KARAOKE_LAG_SEC = 0.45;
  // Sanity bounds on the estimated speaking rate (chars/sec). Wide on purpose:
  // real rates range from dense Latin text (~15-20) to CJK/Indic scripts (much
  // lower). These only guard against degenerate early-stream estimates.
  const KARAOKE_MIN_RATE = 2;
  const KARAOKE_MAX_RATE = 40;
  // Catch-up ceiling: when the rate estimate corrects itself upward, advance
  // at most this multiple of the current speaking rate so the highlight eases
  // forward instead of jumping a phrase in one frame.
  const KARAOKE_CATCHUP_FACTOR = 2.5;
  // Show-then-speak turns deliver the WHOLE transcript before the first PCM
  // byte, so text ÷ audio-received massively overestimates the rate while
  // audio is still streaming in. Until ai_done says all audio has arrived,
  // cap at a typical speaking rate — trailing slightly reads as correct,
  // sprinting ahead reads as broken. Once audio is complete, text ÷ audio is
  // the EXACT rate and the cap is lifted (eased catch-up absorbs the step).
  const KARAOKE_PRELOADED_RATE = 14;

  /** Extend a raw offset to the end of the word it lands inside. */
  const snapToWordEnd = (text: string, offset: number): number => {
    if (offset <= 0) return 0;
    if (offset >= text.length) return text.length;
    let i = offset;
    while (i < text.length && !/\s/.test(text[i])) i++;
    return i;
  };

  const stopKaraokeLoop = () => {
    if (karaokeRafRef.current !== null) {
      cancelAnimationFrame(karaokeRafRef.current);
      karaokeRafRef.current = null;
    }
  };

  const startKaraokeLoop = () => {
    if (karaokeRafRef.current !== null || !onSpeakingProgress) return;
    const tick = () => {
      karaokeRafRef.current = requestAnimationFrame(tick);
      const k = karaokeRef.current;
      const ctx = audioContextRef.current;
      if (!ctx || !k.messageId) return;
      const t = ctx.currentTime;
      if (k.audioSeconds <= 0 || k.text.length === 0) return;

      // Seconds of this bubble's audio actually played. Scheduled audio is
      // contiguous at the tail, so played = total − time still ahead of now.
      const remaining = Math.max(0, k.audioEndTime - t);
      const played = Math.max(0, k.audioSeconds - remaining);

      // Speaking-rate estimate from everything received so far, then map
      // played seconds (minus the deliberate trailing lag) to characters.
      const rateCeiling = (k.textFinal && !k.audioComplete)
        ? KARAOKE_PRELOADED_RATE
        : KARAOKE_MAX_RATE;
      const rate = Math.min(
        rateCeiling,
        Math.max(KARAOKE_MIN_RATE, k.text.length / k.audioSeconds),
      );
      let raw = rate * Math.max(0, played - KARAOKE_LAG_SEC);

      // Monotonic + eased catch-up: never move backwards, and when the
      // estimate corrects upward, approach the new target at a bounded pace.
      const dt = k.lastTickTime > 0 ? Math.max(0, t - k.lastTickTime) : 0;
      k.lastTickTime = t;
      const maxStep = Math.max(1, rate * dt * KARAOKE_CATCHUP_FACTOR);
      raw = Math.max(k.lastRaw, Math.min(raw, k.lastRaw + maxStep));
      k.lastRaw = raw;

      const snapped = snapToWordEnd(k.text, Math.floor(raw));
      if (snapped > k.lastEmitted) {
        k.lastEmitted = snapped;
        onSpeakingProgress(k.messageId, snapped, false);
      }
    };
    karaokeRafRef.current = requestAnimationFrame(tick);
  };

  /**
   * End the highlight for the current bubble (playback finished, was
   * interrupted, or the response was abandoned) and reset the timeline
   * for the next response.
   */
  const finishKaraoke = () => {
    stopKaraokeLoop();
    const k = karaokeRef.current;
    if (k.messageId) {
      onSpeakingProgress?.(k.messageId, k.text.length, true);
    }
    karaokeRef.current = { messageId: null, text: '', audioSeconds: 0, audioEndTime: 0, lastEmitted: -1, lastRaw: 0, lastTickTime: 0, textFinal: false, audioComplete: false };
  };
  // --------------------------------------------------------------------------

  const markResponseInterrupted = (responseId: string | null | undefined) => {
    if (!responseId) return;
    interruptedResponseIdsRef.current.add(responseId);
    if (interruptedResponseIdsRef.current.size > 20) {
      const first = interruptedResponseIdsRef.current.values().next().value;
      if (first) interruptedResponseIdsRef.current.delete(first);
    }
  };

  /**
   * Drop every scheduled and queued sample immediately. Used when an answer is
   * abandoned — playback runs ahead of what the student has heard, so audio
   * left in the pipeline would otherwise play on into the next answer.
   */
  const flushQueuedAudio = () => {
    activeSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    activeSourcesRef.current.clear();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlaybackTimeRef.current = 0;
    pcmLeftoverByteRef.current = null;
  };

  const { toast } = useToast();

  const safeSend = useCallback((data: string | ArrayBuffer) => {
    try {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
      wsRef.current.send(data);
      return true;
    } catch (error) {
      console.error('[InlineVoice] Error sending:', error);
      return false;
    }
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (isActive && !audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      } catch (error) {
        console.error('[InlineVoice] Failed to preload AudioContext:', error);
      }
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    connectWebSocket();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          safeSend(JSON.stringify({ type: 'pong' }));
        } else if (shouldAutoRestartRef.current && conversationIdRef.current) {
          connectWebSocket();
        }
      }
    };

    const handleOnline = () => {
      if (shouldAutoRestartRef.current && conversationIdRef.current) {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      cleanup();
    };
  }, [isActive, userId, businessAccountId, selectedLanguage]);

  const startHeartbeatMonitoring = () => {
    if (heartbeatTimeoutRef.current) clearTimeout(heartbeatTimeoutRef.current);
    heartbeatTimeoutRef.current = setTimeout(() => {
      console.warn('[InlineVoice] Heartbeat timeout');
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    }, 120000);
  };

  const connectWebSocket = () => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnecting(true);
    setVoiceError(null);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    let wsUrl = `${protocol}//${host}/ws/voice?businessAccountId=${businessAccountId}&userId=${userId}`;

    // TopScholar launch identity. The server requires this to authorize widget
    // voice on that account and to refuse a doubt that is already closed.
    if (topscholarToken) wsUrl += `&token=${encodeURIComponent(topscholarToken)}`;
    if (topscholarCpId) wsUrl += `&cpId=${encodeURIComponent(topscholarCpId)}`;

    if (conversationIdRef.current) {
      wsUrl += `&conversationId=${conversationIdRef.current}`;
    }
    if (textConversationId && !conversationIdRef.current) {
      wsUrl += `&textConversationId=${encodeURIComponent(textConversationId)}`;
    }
    if (selectedLanguage) {
      wsUrl += `&language=${encodeURIComponent(selectedLanguage)}`;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnecting(false);
      setIsOnline(true);
      isOnlineRef.current = true;
      reconnectAttemptsRef.current = 0;
      startHeartbeatMonitoring();
    };

    ws.onmessage = async (event) => {
      if (event.data instanceof Blob) {
        const arrayBuffer = await event.data.arrayBuffer();
        await handleAudioChunk(arrayBuffer);
      } else {
        try {
          const data = JSON.parse(event.data);
          handleMessage(data);
        } catch (error) {
          console.error('[InlineVoice] Failed to parse message:', error);
        }
      }
    };

    ws.onerror = () => {
      setIsConnecting(false);
      setIsOnline(false);
      isOnlineRef.current = false;
      // Transport gone mid-answer: stop the highlight loop and clear the
      // highlight — ai_done will never arrive to do it.
      finishKaraoke();
    };

    ws.onclose = () => {
      finishKaraoke();
      setIsOnline(false);
      isOnlineRef.current = false;
      setIsConnecting(false);
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
        heartbeatTimeoutRef.current = null;
      }
      if (sessionClosedByServerRef.current) return;
      // Closed without ever having had a session: the server refused the
      // upgrade. A rejected upgrade carries no close reason the browser can
      // read, so the wording stays general. Say something and let them retry —
      // going quietly offline is what made this look like a dead button.
      if (!hadReadySessionRef.current) {
        console.warn('[InlineVoice] Voice socket closed before the session was ready');
        setState('idle');
        setVoiceError("Voice couldn't start. Tap to retry.");
        return;
      }
      if (shouldAutoRestartRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = setTimeout(() => connectWebSocket(), delay);
        return;
      }
      // Had a session, then lost it and ran out of retries.
      setState('idle');
      setVoiceError('Voice disconnected. Tap to reconnect.');
    };
  };

  const handleMessage = async (data: any) => {
    switch (data.type) {
      case 'ready':
        if (data.conversationId) conversationIdRef.current = data.conversationId;
        hadReadySessionRef.current = true;
        setVoiceError(null);
        sessionClosedByServerRef.current = false;
        aiDoneReceivedRef.current = false;
        // Fresh session / reconnect — discard any stale PCM carry byte from
        // the previous connection so it doesn't pair with the first byte of
        // the next answer's audio.
        pcmLeftoverByteRef.current = null;
        if (data.reconnected && outboundAudioQueueRef.current.length > 0) {
          while (outboundAudioQueueRef.current.length > 0) {
            const chunk = outboundAudioQueueRef.current.shift()!;
            if (!safeSend(chunk)) {
              outboundAudioQueueRef.current.unshift(chunk);
              break;
            }
          }
        }
        shouldAutoRestartRef.current = true;
        if (hasPermissionRef.current) {
          try { await startRecording(); } catch (error) { setState('idle'); }
        } else {
          setState('idle');
        }
        break;

      case 'ping':
        safeSend(JSON.stringify({ type: 'pong' }));
        startHeartbeatMonitoring();
        break;

      case 'speech_started':
        noteListeningActivity();
        // Respect the same barge-in grace window as the local VAD: a server VAD
        // speech_started that lands in the opening of a new answer is almost
        // always the AI's own audio / echo and must not self-cancel playback.
        if (playbackStartedAtRef.current &&
            Date.now() - playbackStartedAtRef.current < BARGE_IN_GRACE_MS) {
          break;
        }
        if (stateRef.current === 'speaking' || isPlayingRef.current || audioQueueRef.current.length > 0) {
          handleInterruption();
        }
        break;

      case 'transcript':
        noteListeningActivity();
        if (pendingInterruptRef.current && data.isFinal) {
          pendingInterruptRef.current = false;
          bufferedTranscriptRef.current = null;
        }
        if (data.isFinal) {
          onUserMessage?.(data.text);
          awaitingUserTranscriptRef.current = false;
          lastAIMessageIdRef.current = null;
          setCurrentTranscript('');
          setState('thinking');
        } else {
          setCurrentTranscript(data.text);
        }
        break;

      case 'thinking':
        // Server is retrieving curriculum / preparing the answer — show the
        // Thinking… state even if the transcript event raced past us.
        setState('thinking');
        break;

      case 'response_cancelled':
        // The server abandoned this answer — typically a barge-in it detected
        // while we were still inside our own grace window, so we never ran
        // handleInterruption. Drop what we have buffered for it; playback runs
        // ahead of the student's ears, so it would otherwise be heard on top of
        // whatever comes next.
        if (data.responseId) {
          const cancelledMessageId =
            responseIdToMessageIdRef.current.get(data.responseId) ||
            (currentResponseIdRef.current === data.responseId ? currentAIMessageIdRef.current : null);
          markResponseInterrupted(data.responseId);
          if (currentResponseIdRef.current === data.responseId) {
            flushQueuedAudio();
            // The answer was abandoned server-side — freeze/clear its highlight.
            finishKaraoke();
            currentAIMessageIdRef.current = null;
            currentResponseIdRef.current = null;
          }
          if (cancelledMessageId) onAIMessageCancelled?.(cancelledMessageId);
          responseIdToMessageIdRef.current.delete(data.responseId);
        }
        break;

      case 'transcript_correction':
        onTranscriptCorrection?.(data.original, data.corrected);
        break;

      case 'answer_ready': {
        if (data.responseId && interruptedResponseIdsRef.current.has(data.responseId)) return;
        if (pendingInterruptRef.current) return;
        if (data.responseId) currentResponseIdRef.current = data.responseId;

        setState('speaking');
        if (!vadIntervalRef.current && mediaStreamRef.current) {
          startVoiceActivityDetection();
        }

        const messageId = 'voice-ai-' + Date.now().toString();
        currentAIMessageIdRef.current = messageId;
        awaitingUserTranscriptRef.current = true;
        if (data.responseId) {
          responseIdToMessageIdRef.current.set(data.responseId, messageId);
          if (responseIdToMessageIdRef.current.size > 20) {
            const oldest = responseIdToMessageIdRef.current.keys().next().value;
            if (oldest) responseIdToMessageIdRef.current.delete(oldest);
          }
        }

        const displayMarkdown = typeof data.displayMarkdown === 'string'
          ? data.displayMarkdown
          : '';
        const spokenText = typeof data.speechText === 'string' ? data.speechText : '';

        finishKaraoke();
        karaokeRef.current.messageId = messageId;
        karaokeRef.current.text = spokenText;
        karaokeRef.current.textFinal = true;

        if (onAIMessageReady) {
          onAIMessageReady(messageId, displayMarkdown, spokenText);
        } else {
          onAIMessageStart?.(messageId);
          onAIMessageReplace?.(messageId, displayMarkdown);
        }
        break;
      }

      case 'ai_chunk':
        // Drop late chunks for responses the user already interrupted —
        // OpenAI keeps emitting a few transcript deltas after response.cancel,
        // and acting on them would create a phantom second bubble.
        if (data.responseId && interruptedResponseIdsRef.current.has(data.responseId)) {
          return;
        }
        if (pendingInterruptRef.current) return;
        if (data.responseId) {
          currentResponseIdRef.current = data.responseId;
        }

        setState('speaking');
        if (!vadIntervalRef.current && mediaStreamRef.current) {
          startVoiceActivityDetection();
        }

        if (!currentAIMessageIdRef.current) {
          const messageId = 'voice-ai-' + Date.now().toString();
          currentAIMessageIdRef.current = messageId;
          awaitingUserTranscriptRef.current = true;
          // Bind this bubble to the responseId stamped on this chunk, so any
          // later formatted_transcript event can patch the right message even
          // when responses are rapidly created back-to-back.
          if (data.responseId) {
            responseIdToMessageIdRef.current.set(data.responseId, messageId);
            // Bounded FIFO: the binding has to outlive ai_done because formatted
            // text and curriculum images both land after the answer finishes.
            if (responseIdToMessageIdRef.current.size > 20) {
              const oldest = responseIdToMessageIdRef.current.keys().next().value;
              if (oldest) responseIdToMessageIdRef.current.delete(oldest);
            }
            // If formatter beat us to it, apply the buffered formatted text now.
            const buffered = pendingFormattedRef.current.get(data.responseId);
            if (buffered) {
              pendingFormattedRef.current.delete(data.responseId);
              // Defer one tick so onAIMessageStart/Chunk are processed first.
              setTimeout(() => onAIMessageReplace?.(messageId, buffered), 0);
            }
          }
          // New bubble → fresh karaoke timeline, keyed to this bubble so the
          // offsets are always relative to exactly the text it renders.
          // finishKaraoke also clears any highlight lingering on the previous
          // bubble whose playback never formally finished.
          finishKaraoke();
          karaokeRef.current.messageId = messageId;
          onAIMessageStart?.(messageId);
          onAIMessageChunk?.(messageId, data.text);
          // A show-then-speak response carries its final display Markdown with
          // the raw speech transcript. Apply it in the same event turn so the
          // student never sees TeX/Markdown intended only for internal speech.
          if (typeof data.displayMarkdown === 'string' && data.displayMarkdown.trim()) {
            onAIMessageReplace?.(messageId, data.displayMarkdown);
          }
        } else {
          onAIMessageChunk?.(currentAIMessageIdRef.current, data.text);
          if (typeof data.displayMarkdown === 'string' && data.displayMarkdown.trim()) {
            onAIMessageReplace?.(currentAIMessageIdRef.current, data.displayMarkdown);
          }
        }
        // Track the raw spoken transcript for the audio-clocked highlight.
        karaokeRef.current.text += data.text;
        // Show-then-speak: the server marks the one-shot full-transcript chunk
        // so the rate model knows text is complete ahead of the audio.
        if (data.final) karaokeRef.current.textFinal = true;
        break;

      case 'ai_speaking':
        setState('speaking');
        const msgId = 'voice-ai-' + Date.now().toString();
        onAIMessageStart?.(msgId);
        onAIMessageChunk?.(msgId, data.text);
        onAIMessageDone?.(msgId);
        break;

      case 'ai_done':
        if (pendingInterruptRef.current) return;
        // A deferred completion for an older response must not finalize the
        // bubble that belongs to a newer response.
        if (data.responseId && currentResponseIdRef.current &&
            data.responseId !== currentResponseIdRef.current) {
          break;
        }
        // The server defers ai_done until every TTS producer is idle, so all
        // PCM for this bubble has been sent: chars ÷ audio-seconds is now the
        // exact speaking rate and the preloaded-text rate cap can lift.
        karaokeRef.current.audioComplete = true;
        if (isPlayingRef.current || audioQueueRef.current.length > 0) {
          aiDoneReceivedRef.current = true;
        } else {
          processAiDone();
        }
        break;

      case 'voice_message_start':
        // Bubble↔responseId binding is still done from ai_chunk's responseId.
        // We capture the active responseId here too, so that an interrupt
        // arriving BEFORE the first ai_chunk tags the correct response and
        // doesn't accidentally mark the previous (already-completed) response
        // as cancelled.
        if (data.responseId) {
          // A new response arriving while the previous one is still playing is
          // two different situations needing opposite handling, and only
          // ownership tells them apart — never duration:
          //
          //  - the previous answer was ABANDONED (barge-in, or a server-side
          //    cancellation). Its audio must go, or a stale answer runs on into
          //    this one. Both paths mark the response first: handleInterruption
          //    locally, 'response_cancelled' from the server.
          //  - the previous answer was NOT abandoned, so this is a legitimate
          //    continuation and the queued speech is the end of a sentence the
          //    student is still hearing. Flushing it is the mid-word chop.
          //    Audio schedules sequentially from nextPlaybackTimeRef, so
          //    letting it drain plays the two in order, not over each other.
          const previousResponseId = currentResponseIdRef.current;
          const isNewResponse = previousResponseId && previousResponseId !== data.responseId;
          const previousWasAbandoned =
            !!previousResponseId && interruptedResponseIdsRef.current.has(previousResponseId);
          if (isNewResponse && previousWasAbandoned && (isPlayingRef.current || activeSourcesRef.current.size > 0)) {
            flushQueuedAudio();
          }
          // Karaoke is NOT reset here. The timeline is keyed to the bubble
          // (messageId), not the response: a legitimate continuation appends
          // its transcript to the same bubble and schedules its audio after
          // the draining tail, so text and audio accounting stay monotonic and the
          // offsets stay valid against exactly what that bubble renders. The
          // timeline resets only when the bubble changes (first ai_chunk of a
          // new bubble) or playback ends (finishKaraoke on done/interrupt).
          currentResponseIdRef.current = data.responseId;
        }
        break;

      case 'formatted_transcript':
        // Background STEM formatter completed — swap raw transcript for
        // properly formatted Markdown + LaTeX in the matching bubble.
        // Ignore formatter results for cancelled responses (the partial bubble
        // already shows what the user heard; replacing it with the full
        // formatted answer would be misleading).
        if (data.responseId && interruptedResponseIdsRef.current.has(data.responseId)) {
          responseIdToMessageIdRef.current.delete(data.responseId);
          pendingFormattedRef.current.delete(data.responseId);
          break;
        }
        if (data.responseId && data.formattedMarkdown) {
          const targetMessageId = responseIdToMessageIdRef.current.get(data.responseId);
          if (targetMessageId) {
            onAIMessageReplace?.(targetMessageId, data.formattedMarkdown);
            // Keep the binding: curriculum images for this same response may still
            // be in flight and need to find this bubble.
          } else {
            // Bubble not created yet — buffer until first ai_chunk binds the responseId.
            pendingFormattedRef.current.set(data.responseId, data.formattedMarkdown);
          }
        }
        break;

      case 'interrupt_ack':
        pendingInterruptRef.current = false;
        currentAIMessageIdRef.current = null;
        // Reset so a brand-new response that begins after this ack starts
        // with a clean responseId slate.
        currentResponseIdRef.current = null;
        // Clear PCM carry buffer so nothing from the cancelled answer
        // bleeds into the next one's audio.
        pcmLeftoverByteRef.current = null;
        if (bufferedTranscriptRef.current) {
          onUserMessage?.(bufferedTranscriptRef.current.text);
          bufferedTranscriptRef.current = null;
          setState('thinking');
        } else {
          setState('listening');
        }
        break;

      case 'interrupt_ignored':
        pendingInterruptRef.current = false;
        bufferedTranscriptRef.current = null;
        setState('listening');
        break;

      case 'busy':
        aiDoneReceivedRef.current = false;
        finishKaraoke();
        setState('idle');
        setCurrentTranscript('');
        stopRecording();
        if (busyResumeTimeoutRef.current) clearTimeout(busyResumeTimeoutRef.current);
        busyResumeTimeoutRef.current = setTimeout(async () => {
          if (isOnlineRef.current && hasPermissionRef.current) {
            try { await startRecording(); setState('listening'); } catch {}
          }
        }, 5000);
        break;

      case 'session_closed':
        aiDoneReceivedRef.current = false;
        finishKaraoke();
        sessionClosedByServerRef.current = true;
        conversationIdRef.current = null;
        pcmLeftoverByteRef.current = null;
        setState('idle');
        stopRecording();
        toast({
          title: "Session Ended",
          description: "Tap the mic to start a new conversation.",
          duration: 5000,
        });
        break;

      case 'error':
        aiDoneReceivedRef.current = false;
        finishKaraoke();
        toast({ title: "Error", description: data.message || "Voice processing error", variant: "destructive" });
        setState('idle');
        stopRecording();
        break;
    }
  };

  const handleAudioChunk = async (arrayBuffer: ArrayBuffer) => {
    try {
      // If user has already interrupted, drop incoming bytes — don't schedule
      // any further sources for an answer that was just barged-in.
      if (pendingInterruptRef.current) return;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      // Log requested-vs-actual sample rate exactly once per session, on the
      // first received PCM chunk, regardless of which site created the
      // AudioContext (mic preload, startRecording, or this handler).
      if (!sampleRateLoggedRef.current) {
        console.log('[InlineVoice] First audio chunk — AudioContext sampleRate: requested 24000 Hz, actual', audioContextRef.current.sampleRate, 'Hz', '(resampling on playback:', audioContextRef.current.sampleRate !== 24000, ')');
        sampleRateLoggedRef.current = true;
      }
      const sourceSampleRate = 24000;

      // Carry-buffer alignment: prepend any stranded byte from a previous
      // chunk, then peel off a new trailing odd byte if present. Guarantees
      // the Int16Array view is always built from an even-length buffer.
      let bytes = new Uint8Array(arrayBuffer);
      if (pcmLeftoverByteRef.current) {
        const merged = new Uint8Array(pcmLeftoverByteRef.current.length + bytes.length);
        merged.set(pcmLeftoverByteRef.current);
        merged.set(bytes, pcmLeftoverByteRef.current.length);
        bytes = merged;
        pcmLeftoverByteRef.current = null;
      }
      if (bytes.length % 2 !== 0) {
        pcmLeftoverByteRef.current = bytes.slice(bytes.length - 1);
        bytes = bytes.slice(0, bytes.length - 1);
      }
      if (bytes.length === 0) return;

      const pcm16Data = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
      const float32Data = new Float32Array(pcm16Data.length);
      for (let i = 0; i < pcm16Data.length; i++) {
        float32Data[i] = pcm16Data[i] / (pcm16Data[i] < 0 ? 32768 : 32767);
      }
      // Build the buffer at the *source* sample rate (24 kHz) and let the
      // AudioContext's built-in resampler convert to the device rate during
      // playback. (Hand-rolled per-chunk resampling caused boundary clicks.)
      const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, sourceSampleRate);
      audioBuffer.getChannelData(0).set(float32Data);

      // Schedule-on-arrival: create the BufferSourceNode now and start it at
      // exactly nextPlaybackTime (or currentTime if we ran out of audio).
      // Web Audio's scheduler is sample-accurate, so back-to-back scheduled
      // buffers join with zero gap regardless of when JS got around to
      // building them. The previous "wait for source.onended → schedule next"
      // pattern produced a few-ms gap at every chunk boundary because
      // onended runs after a JS-event-loop hop, which summed into a buzz.
      const ctx = audioContextRef.current;
      if (!playbackAnalyserRef.current) {
        playbackAnalyserRef.current = ctx.createAnalyser();
        playbackAnalyserRef.current.fftSize = 256;
        playbackAnalyserRef.current.smoothingTimeConstant = 0.8;
        playbackAnalyserRef.current.connect(ctx.destination);
        // Mark the start of this answer's playback so the VAD can apply a short
        // barge-in grace window (the opening syllables / their echo must not
        // self-cancel the answer).
        playbackStartedAtRef.current = Date.now();
        startVolumeMonitoring();
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(playbackAnalyserRef.current);
      const scheduleTime = Math.max(ctx.currentTime, nextPlaybackTimeRef.current);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
        if (activeSourcesRef.current.size === 0) {
          isPlayingRef.current = false;
          // No more scheduled audio — tear down the analyser chain so the
          // next response gets a fresh one (matches prior behavior).
          stopVolumeMonitoring();
          if (playbackAnalyserRef.current) {
            try { playbackAnalyserRef.current.disconnect(); } catch {}
            playbackAnalyserRef.current = null;
          }
          playbackStartedAtRef.current = 0;
          if (aiDoneReceivedRef.current) {
            processAiDone();
          }
        }
      };
      activeSourcesRef.current.add(source);
      isPlayingRef.current = true;
      source.start(scheduleTime);
      nextPlaybackTimeRef.current = scheduleTime + audioBuffer.duration;

      // Karaoke bookkeeping: accumulate this bubble's scheduled audio duration
      // and its scheduled end time. The rAF loop derives seconds-played from
      // these and maps them to characters via the speaking-rate estimate.
      const k = karaokeRef.current;
      k.audioSeconds += audioBuffer.duration;
      k.audioEndTime = nextPlaybackTimeRef.current;
      startKaraokeLoop();
    } catch (error) {
      console.error('[InlineVoice] Audio chunk error:', error);
    }
  };

  const startVolumeMonitoring = () => {
    if (volumeIntervalRef.current) return;
    volumeIntervalRef.current = setInterval(() => {
      if (!playbackAnalyserRef.current) return;
      const dataArray = new Uint8Array(playbackAnalyserRef.current.frequencyBinCount);
      playbackAnalyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioVolume(Math.min(100, (average / 255) * 150));
    }, 50);
  };

  const stopVolumeMonitoring = () => {
    if (volumeIntervalRef.current) {
      clearInterval(volumeIntervalRef.current);
      volumeIntervalRef.current = null;
    }
    setAudioVolume(0);
  };

  const startVoiceActivityDetection = () => {
    if (!mediaSourceRef.current || !audioContextRef.current || vadIntervalRef.current) return;
    try {
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      mediaSourceRef.current.connect(analyser);
      vadAnalyserRef.current = analyser;
      const dataArray = new Float32Array(analyser.frequencyBinCount);
      let consecutiveSpeechFrames = 0;
      // Base mic RMS to count a frame as speech when the AI is silent.
      const baseSpeechThreshold = 0.02;
      // Sustained frames of speech required to interrupt. Frames are 100ms, so
      // 5 ≈ 500ms — long enough that brief echo blips can't trigger a barge-in,
      // short enough that a genuine interruption still feels responsive.
      const requiredFrames = 5;
      // How strongly current AI playback raises the speech threshold. The mic
      // picks up the AI's voice as echo, so during loud playback the user must
      // be clearly louder than that echo to count as a real interruption.
      const ECHO_REJECTION_FACTOR = 0.08;
      let speechActivityLatched = false;

      vadIntervalRef.current = setInterval(() => {
        if (!vadAnalyserRef.current) return;
        // Grace window: never interrupt within the opening of a new answer.
        if (playbackStartedAtRef.current &&
            Date.now() - playbackStartedAtRef.current < BARGE_IN_GRACE_MS) {
          consecutiveSpeechFrames = 0;
          return;
        }
        vadAnalyserRef.current.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
        const rms = Math.sqrt(sum / dataArray.length);

        // Estimate how loud the AI is currently playing (0..1) and raise the
        // effective speech threshold accordingly, so the AI's own echo can't
        // clear the bar while genuine speech (louder than the echo) still can.
        let playbackLevel = 0;
        if (playbackAnalyserRef.current) {
          const pb = new Uint8Array(playbackAnalyserRef.current.frequencyBinCount);
          playbackAnalyserRef.current.getByteFrequencyData(pb);
          let pbSum = 0;
          for (let i = 0; i < pb.length; i++) pbSum += pb[i];
          playbackLevel = pbSum / pb.length / 255;
        }
        const effectiveThreshold = baseSpeechThreshold + playbackLevel * ECHO_REJECTION_FACTOR;

        if (rms > effectiveThreshold) {
          consecutiveSpeechFrames++;
          if (consecutiveSpeechFrames >= requiredFrames) {
            if (stateRef.current === 'listening' && !speechActivityLatched) {
              speechActivityLatched = true;
              noteListeningActivity();
            } else if (stateRef.current === 'speaking') {
              handleInterruption();
            }
          }
        } else {
          consecutiveSpeechFrames = 0;
          speechActivityLatched = false;
        }
      }, 100);
    } catch (error) {
      console.error('[InlineVoice] VAD setup failed:', error);
    }
  };

  const stopVoiceActivityDetection = () => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    if (vadAnalyserRef.current) {
      try { vadAnalyserRef.current.disconnect(); } catch {}
      vadAnalyserRef.current = null;
    }
  };

  const handleInterruption = () => {
    pendingInterruptRef.current = true;
    aiDoneReceivedRef.current = false;
    // Clear the karaoke highlight where the audio actually stopped.
    finishKaraoke();
    // Mark the active response as interrupted BEFORE we clear the bubble ref.
    // Any late ai_chunk / formatted_transcript events stamped with this id
    // will then be dropped, preventing a phantom second bubble.
    markResponseInterrupted(currentResponseIdRef.current);
    currentResponseIdRef.current = null;
    // Discard any stranded PCM byte from the cancelled answer so it doesn't
    // pair with the first byte of the NEXT answer's audio.
    pcmLeftoverByteRef.current = null;
    if (currentAIMessageIdRef.current) {
      currentAIMessageIdRef.current = null;
    }
    bufferedTranscriptRef.current = null;
    stopVoiceActivityDetection();
    stopVolumeMonitoring();
    activeSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    activeSourcesRef.current.clear();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlaybackTimeRef.current = 0;
    if (playbackAnalyserRef.current) {
      try { playbackAnalyserRef.current.disconnect(); } catch {}
      playbackAnalyserRef.current = null;
    }
    playbackStartedAtRef.current = 0;
    safeSend(JSON.stringify({ type: 'interrupt' }));
    setState('listening');
  };

  const processAiDone = () => {
    aiDoneReceivedRef.current = false;
    if (pendingInterruptRef.current) return;
    const completedResponseId = currentResponseIdRef.current;
    // Playback fully drained — mark the whole answer as spoken and drop the
    // highlight so the bubble swaps back to normal (formatted) rendering.
    finishKaraoke();
    if (currentAIMessageIdRef.current) {
      onAIMessageDone?.(currentAIMessageIdRef.current);
      if (awaitingUserTranscriptRef.current) {
        lastAIMessageIdRef.current = currentAIMessageIdRef.current;
      }
    }
    currentAIMessageIdRef.current = null;
    if (completedResponseId) {
      safeSend(JSON.stringify({ type: 'playback_complete', responseId: completedResponseId }));
    }
    // Response fully completed — clear the active responseId so a future
    // interrupt before the next response's first chunk doesn't tag this one.
    currentResponseIdRef.current = null;
    // Defensive: if a stranded byte somehow survived to a response boundary
    // (e.g. server fix regresses), drop it now so it can't contaminate the
    // first byte of the next response.
    pcmLeftoverByteRef.current = null;
    stopVoiceActivityDetection();
    if (shouldAutoRestartRef.current && isOnlineRef.current && hasPermissionRef.current) {
      setState('listening');
    } else {
      setState('idle');
    }
  };

  const float32ToInt16 = (float32Array: Float32Array): Int16Array => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  };

  const startRecording = async () => {
    try {
      if (audioWorkletNodeRef.current || scriptProcessorRef.current) return;
      resampleFractionalPositionRef.current = 0;
      resampleLastSampleRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 24000, channelCount: 1 }
      });
      hasPermissionRef.current = true;
      mediaStreamRef.current = stream;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      const actualSampleRate = audioContextRef.current.sampleRate;
      const source = audioContextRef.current.createMediaStreamSource(stream);
      mediaSourceRef.current = source;

      if (stateRef.current === 'speaking' && !vadIntervalRef.current) {
        startVoiceActivityDetection();
      }

      let workletLoaded = false;
      if (audioContextRef.current.audioWorklet) {
        try {
          await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
          workletLoaded = true;
        } catch {}
      }

      if (workletLoaded && audioContextRef.current.audioWorklet) {
        const workletNode = new AudioWorkletNode(audioContextRef.current, 'pcm16-audio-processor', {
          processorOptions: { sampleRate: actualSampleRate }
        });
        audioWorkletNodeRef.current = workletNode;
        workletNode.port.onmessage = (event) => {
          if (event.data.type === 'audio') {
            const queueSize = outboundAudioQueueRef.current.length;
            if (queueSize >= maxOutboundQueueSize * 0.8) {
              if (!isPausedDueToBackpressureRef.current) {
                isPausedDueToBackpressureRef.current = true;
              }
              return;
            }
            if (queueSize < maxOutboundQueueSize * 0.5 && isPausedDueToBackpressureRef.current) {
              isPausedDueToBackpressureRef.current = false;
              backpressureWarningShownRef.current = false;
            }
            if (!isPausedDueToBackpressureRef.current) {
              outboundAudioQueueRef.current.push(event.data.data);
              while (outboundAudioQueueRef.current.length > 0) {
                const chunk = outboundAudioQueueRef.current.shift()!;
                if (!safeSend(chunk)) {
                  outboundAudioQueueRef.current.unshift(chunk);
                  break;
                }
              }
            }
          }
        };
        source.connect(workletNode);
      } else {
        const bufferSize = 2048;
        const processor = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
        scriptProcessorRef.current = processor;
        processor.onaudioprocess = (event) => {
          const inputData = event.inputBuffer.getChannelData(0);
          let resampledData: Float32Array = inputData;
          if (actualSampleRate !== 24000) {
            const resampleRatio = actualSampleRate / 24000;
            const output: number[] = [];
            let position = resampleFractionalPositionRef.current;
            while (true) {
              const index = Math.floor(position);
              const fraction = position - index;
              if (index >= inputData.length) break;
              let sample;
              if (index + 1 < inputData.length) {
                sample = inputData[index] * (1 - fraction) + inputData[index + 1] * fraction;
              } else {
                sample = inputData[index] * (1 - fraction) + resampleLastSampleRef.current * fraction;
              }
              output.push(sample);
              position += resampleRatio;
            }
            if (inputData.length > 0) resampleLastSampleRef.current = inputData[inputData.length - 1];
            resampleFractionalPositionRef.current = position - inputData.length;
            resampledData = new Float32Array(output);
          }
          const pcm16Data = float32ToInt16(resampledData);
          const queueSize = outboundAudioQueueRef.current.length;
          if (queueSize >= maxOutboundQueueSize * 0.8) {
            if (!isPausedDueToBackpressureRef.current) isPausedDueToBackpressureRef.current = true;
            return;
          }
          if (queueSize < maxOutboundQueueSize * 0.5 && isPausedDueToBackpressureRef.current) {
            isPausedDueToBackpressureRef.current = false;
            backpressureWarningShownRef.current = false;
          }
          if (!isPausedDueToBackpressureRef.current) {
            outboundAudioQueueRef.current.push(pcm16Data.buffer);
            while (outboundAudioQueueRef.current.length > 0) {
              const chunk = outboundAudioQueueRef.current.shift()!;
              if (!safeSend(chunk)) {
                outboundAudioQueueRef.current.unshift(chunk);
                break;
              }
            }
          }
        };
        source.connect(processor);
      }
      setState('listening');
    } catch (error: any) {
      hasPermissionRef.current = false;
      setState('idle');
      if (error.name === 'NotAllowedError') {
        toast({ title: "Microphone Access Denied", description: "Please enable microphone in your browser settings.", variant: "destructive" });
      } else {
        toast({ title: "Microphone Error", description: "Could not access microphone.", variant: "destructive" });
      }
    }
  };

  const stopRecording = (): Promise<void> => {
    return new Promise((resolve) => {
      try {
        if (audioWorkletNodeRef.current) {
          audioWorkletNodeRef.current.disconnect();
          audioWorkletNodeRef.current.port.onmessage = null;
          audioWorkletNodeRef.current = null;
        }
        if (scriptProcessorRef.current) {
          scriptProcessorRef.current.disconnect();
          scriptProcessorRef.current.onaudioprocess = null;
          scriptProcessorRef.current = null;
        }
        if (mediaSourceRef.current) {
          mediaSourceRef.current.disconnect();
          mediaSourceRef.current = null;
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
        }
        resolve();
      } catch {
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

  const clearListeningInactivityTimeout = () => {
    if (listeningInactivityTimeoutRef.current) {
      clearTimeout(listeningInactivityTimeoutRef.current);
      listeningInactivityTimeoutRef.current = null;
    }
  };

  const pauseTopScholarListening = () => {
    if (!topscholarToken || stateRef.current !== 'listening') return;

    clearListeningInactivityTimeout();
    shouldAutoRestartRef.current = false;
    stopVoiceActivityDetection();
    void stopRecording();
    setCurrentTranscript('');
    setVoiceError(null);
    stateRef.current = 'idle';
    setState('idle');
  };

  const scheduleListeningInactivityTimeout = () => {
    clearListeningInactivityTimeout();
    if (!topscholarToken || stateRef.current !== 'listening') return;

    const lastActivityAt = lastListeningActivityAtRef.current || Date.now();
    const remaining = Math.max(
      0,
      TOPSCHOLAR_LISTENING_IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt),
    );

    listeningInactivityTimeoutRef.current = setTimeout(() => {
      listeningInactivityTimeoutRef.current = null;
      if (!topscholarToken || stateRef.current !== 'listening') return;

      const elapsed = Date.now() - (lastListeningActivityAtRef.current || Date.now());
      if (elapsed < TOPSCHOLAR_LISTENING_IDLE_TIMEOUT_MS) {
        scheduleListeningInactivityTimeout();
        return;
      }

      pauseTopScholarListening();
    }, remaining);
  };

  const noteListeningActivity = () => {
    if (!topscholarToken || stateRef.current !== 'listening') return;
    lastListeningActivityAtRef.current = Date.now();
    scheduleListeningInactivityTimeout();
  };

  useEffect(() => {
    if (!topscholarToken || state !== 'listening') {
      clearListeningInactivityTimeout();
      return;
    }

    lastListeningActivityAtRef.current = Date.now();
    if (mediaStreamRef.current && !vadIntervalRef.current) {
      startVoiceActivityDetection();
    }
    scheduleListeningInactivityTimeout();

    return clearListeningInactivityTimeout;
  }, [state, topscholarToken]);

  const cleanup = () => {
    shouldAutoRestartRef.current = false;
    finishKaraoke();
    // Closing the control ends the session's history: the next open starts a
    // fresh attempt, where a failure is a genuine "never started".
    hadReadySessionRef.current = false;
    if (currentAIMessageIdRef.current) {
      onAIMessageDone?.(currentAIMessageIdRef.current);
      currentAIMessageIdRef.current = null;
    }
    try {
      if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
      if (heartbeatTimeoutRef.current) { clearTimeout(heartbeatTimeoutRef.current); heartbeatTimeoutRef.current = null; }
      if (busyResumeTimeoutRef.current) { clearTimeout(busyResumeTimeoutRef.current); busyResumeTimeoutRef.current = null; }
      clearListeningInactivityTimeout();
      stopVoiceActivityDetection();
      stopVolumeMonitoring();
      activeSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
      activeSourcesRef.current.clear();
      if (playbackAnalyserRef.current) { try { playbackAnalyserRef.current.disconnect(); } catch {} playbackAnalyserRef.current = null; }
      audioQueueRef.current = [];
      outboundAudioQueueRef.current = [];
      pcmLeftoverByteRef.current = null;
      isPlayingRef.current = false;
      nextPlaybackTimeRef.current = 0;
      stopRecording();
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) wsRef.current.close();
        wsRef.current = null;
      }
      if (audioContextRef.current) {
        if (audioContextRef.current.state !== 'closed') audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      setState('idle');
      setCurrentTranscript('');
      setVoiceError(null);
      setIsOnline(false);
      isOnlineRef.current = false;
      setIsConnecting(false);
      conversationIdRef.current = null;
      reconnectAttemptsRef.current = 0;
    } catch (error) {
      console.error('[InlineVoice] Cleanup error:', error);
    }
  };

  const handleClose = () => {
    cleanup();
    onClose();
  };

  if (!isActive) return null;

  const avatarSrc = avatarType === 'custom' ? (avatarUrl || '') :
    avatarType && avatarType !== 'none' ? `/avatars/avatar-${avatarType.replace('preset-', '')}.png` : '';

  const stateLabel = state === 'listening' ? (currentTranscript || 'Listening...') :
    state === 'thinking' ? 'Thinking...' :
    state === 'speaking' ? 'Speaking...' :
     isConnecting ? 'Connecting...' :
     voiceError ? voiceError : topscholarToken ? 'Tap to speak' : 'Tap to start';

  return (
    <div className="flex items-center gap-3 px-3 py-2 min-h-[56px]">
      <button
        onClick={handleClose}
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors"
        aria-label="Exit voice mode"
      >
        <X className="w-4 h-4 text-gray-500" />
      </button>

      <div className="flex-1 flex items-center gap-3 min-w-0">
        <button
          onClick={async () => {
            if (isConnecting) return;
            if (state === 'idle') {
              shouldAutoRestartRef.current = true;
            }
            // Offline covers both a refused session and a dropped one. Retry on
            // click instead of ignoring it — silently swallowing the click is
            // what made this read as an unresponsive button.
            if (!isOnline) {
              reconnectAttemptsRef.current = 0;
              connectWebSocket();
              return;
            }
            if (state === 'idle') {
              try { await startRecording(); } catch {}
            }
          }}
          className="relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center overflow-hidden transition-transform"
          style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})` }}
          aria-label="Voice control"
        >
          <AnimatePresence mode="wait">
            {state === 'listening' && (
              <>
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={`wave-${i}`}
                    className="absolute inset-0 rounded-full border border-white/40"
                    initial={{ scale: 1, opacity: 0.6 }}
                    animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.4, ease: "easeOut" }}
                  />
                ))}
              </>
            )}
            {state === 'speaking' && (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={`speak-${i}`}
                    className="absolute inset-0 rounded-full border border-white/50"
                    initial={{ scale: 1, opacity: 0.5 }}
                    animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3, ease: "easeOut" }}
                  />
                ))}
              </>
            )}
            {state === 'thinking' && (
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-white/30"
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            )}
          </AnimatePresence>

          {avatarSrc ? (
            <img src={avatarSrc} alt="AI" className="w-full h-full object-cover rounded-full relative z-10" />
          ) : (
            <Mic className="w-5 h-5 text-white relative z-10" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          {state === 'listening' && currentTranscript ? (
            <p className="text-sm text-gray-700 truncate">{currentTranscript}</p>
          ) : (
            <div className="flex items-center gap-2">
              {state === 'listening' && (
                <div className="flex items-center gap-0.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                      key={i}
                      className="w-0.5 rounded-full"
                      style={{ backgroundColor: chatColor }}
                      animate={{ height: ['4px', `${8 + Math.random() * 12}px`, '4px'] }}
                      transition={{ duration: 0.6 + Math.random() * 0.4, repeat: Infinity, delay: i * 0.1 }}
                    />
                  ))}
                </div>
              )}
              {state === 'speaking' && (
                <div className="flex items-center gap-0.5">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <motion.div
                      key={i}
                      className="w-0.5 rounded-full"
                      style={{ backgroundColor: chatColor }}
                      animate={{
                        height: [`${3 + audioVolume * 0.1}px`, `${6 + audioVolume * 0.2 + Math.random() * 8}px`, `${3 + audioVolume * 0.1}px`]
                      }}
                      transition={{ duration: 0.3 + Math.random() * 0.3, repeat: Infinity, delay: i * 0.05 }}
                    />
                  ))}
                </div>
              )}
              {state === 'thinking' && <Loader2 className="w-4 h-4 animate-spin" style={{ color: chatColor }} />}
              <span className={`text-sm ${voiceError && state === 'idle' && !isConnecting ? 'text-red-600' : 'text-gray-500'}`}>{stateLabel}</span>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
