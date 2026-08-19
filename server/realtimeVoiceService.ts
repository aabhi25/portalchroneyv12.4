import WebSocket from 'ws';
import OpenAI from 'openai';
import { storage } from './storage';
import { conversationMemory } from './conversationMemory';
import { aiTools } from './aiTools';
import { ToolExecutionService } from './services/toolExecutionService';
import { journeyOrchestrator } from './services/journeyOrchestrator';
import { journeyService } from './services/journeyService';
import { isElevenLabsVoice, getElevenLabsVoiceId, synthesizeSpeechStreaming } from './services/elevenlabsService';
import { createVoiceDisplayFallback, createVoiceSpeechText, formatVoiceTranscript, type VoiceDiagramCandidate } from './services/voiceFormatterService';
import { isTopscholarAccount } from './services/topscholar/config';
import { resolveCpIdsForScope } from './services/topscholar/scopeResolver';
import { selectRelevantImages, type CurriculumMediaCandidate } from './services/topscholar/mediaMetadata';
import { aiUsageLogger } from './services/aiUsageLogger';
import { chatService, type ChatContext } from './chatService';

/**
 * OpenAI Realtime model backing voice mode.
 *
 * gpt-realtime-2.1-mini is priced identically to gpt-realtime-mini (audio
 * $10/$20, text $0.60/$2.40 per 1M) but has a 128k context instead of 32k,
 * 32k max output instead of 4k, a Sep 2024 cutoff, reasoning support, and
 * better alphanumeric recognition — which matters here because callers spell
 * out order numbers, phone numbers and names.
 *
 * Keep this in sync with the pricing entry in services/aiUsageLogger.ts:
 * an unknown model there silently falls back to gpt-4o-mini text rates and
 * would under-report voice spend by roughly 50x.
 */
const REALTIME_MODEL = 'gpt-realtime-2.1-mini';

/**
 * One-shot diagnostic: the Realtime usage payload's exact field names are not
 * published in the docs, so the first one seen after boot is logged in full to
 * confirm the breakdown is being read correctly.
 */
let realtimeUsageShapeLogged = false;

/**
 * Curriculum scope carried by a signed TopScholar launch identity, handed to the
 * voice session at upgrade time. The text path resolves the same fields into
 * content packs before every retrieval; voice historically dropped them, which
 * let a session answer from any subject or grade the account owned.
 */
export interface TopscholarVoiceScope {
  cpId?: string | null;
  board?: string | null;
  medium?: string | null;
  grade?: string | null;
  subject?: string | null;
  chapter?: string | null;
  studentId?: string | null;
  studentName?: string | null;
  studentPlanMappingId?: string | null;
  planId?: string | null;
  doubtSyncBaseUrl?: string | null;
}

interface VoiceConversation {
  clientWs: WebSocket; // WebSocket to client (browser)
  openaiWs: WebSocket | null; // WebSocket to OpenAI Realtime API
  businessAccountId: string;
  userId: string;
  openaiApiKey: string;
  sessionId: string | null;
  conversationId: string; // Database conversation ID - now required and used as key
  personality?: string;
  responseLength?: string;
  companyDescription?: string;
  currency?: string;
  currencySymbol?: string;
  customInstructions?: string;
  systemMode?: string;
  k12EducationEnabled?: boolean;
  k12VerbatimContentMode?: boolean;
  jobPortalEnabled?: boolean;
  demoOrdersEnabled?: boolean;
  skipLeadTraining?: boolean;
  isProcessing: boolean;
  currentUserTranscript?: string; // Track current user message
  currentAITranscript?: string; // Accumulate AI response chunks
  lastHeartbeat: number; // Timestamp of last heartbeat
  heartbeatInterval?: NodeJS.Timeout; // Heartbeat timer
  // CRITICAL FIX BUG 4: Track journey responses per journey stepId to prevent race conditions
  // Maps journeyStepId -> {original: template question, responseId: OpenAI response.id, timestamp: when set}
  journeyResponseTracking: Map<string, {original: string, responseId: string, timestamp: number}>;
  currentResponseId?: string; // Track current OpenAI response.id
  currentResponseKind?: 'realtime' | 'canonical';
  canonicalPersistedMessageId?: string;
  canonicalPersistedResponseId?: string;
  canonicalPersistedContent?: string;
  // Set only once the complete Markdown answer has been sent to the browser.
  // Audio can then be interrupted without erasing this completed lesson.
  canonicalDisplayReadyResponseId?: string;
  // Response IDs the user interrupted. Late deltas from OpenAI for these IDs
  // must NOT be forwarded as ai_chunk (otherwise the client creates a phantom
  // second bubble). Capped FIFO to avoid growth.
  cancelledResponseIds: Set<string>;
  // Last response.id whose transcript was already handed to ElevenLabs. Guards
  // against double synthesis if a single response ever emits BOTH an audio
  // transcript-done AND a text output-done event.
  lastSynthesizedResponseId?: string;
  // Buffer for text-modality output. We accumulate the whole text reply here and
  // only forward/save/synthesize it at done-time, AFTER confirming it isn't a
  // leaked tool-call JSON payload.
  pendingTextOutput?: string;
  pendingJourneyStepId?: string; // Temporary: next response will be journey with this stepId
  // OpenAI reconnection tracking
  reconnectAttempts: number; // Number of reconnection attempts
  reconnectTimeout?: NodeJS.Timeout; // Reconnection timer
  isReconnecting: boolean; // Flag to indicate if currently reconnecting
  selectedLanguage?: string;
  selectedVoice?: string;
  isInternalTest?: boolean;
  detectedLanguage?: string;
  textConversationId?: string;
  textHistoryInjected?: boolean;
  /**
   * TopScholar doubt this voice session belongs to, verified from the signed
   * launch token at upgrade time. Present only for doubt-scoped widget voice.
   * Used to tear the session down if the doubt is resolved/escalated elsewhere.
   */
  topscholarDoubtId?: string;
  /**
   * Curriculum scope for this voice session, resolved once at connect time from
   * the signed launch identity. Mirrors what the text path passes into every
   * retrieval so voice and chat draw on exactly the same content.
   *   - null       → no scope supplied (admin dashboard / non-TopScholar voice);
   *                  retrieval keeps its historical whole-account behaviour.
   *   - non-empty  → restrict retrieval to exactly these content packs.
   *   - empty []   → a scope WAS supplied but matched no synced pack. Retrieval
   *                  must return nothing rather than falling back to the whole
   *                  account, which is what let other grades' content leak in.
   */
  topscholarCpIds?: string[] | null;
  topscholarChapter?: string | null;
  /**
   * Raw human-readable launch scope (board/medium/grade/subject/chapter) kept
   * alongside the resolved cpIds so the system instructions can DESCRIBE what
   * this tutor teaches — used for tutor-style off-topic declines. Null when no
   * scope was supplied (non-TopScholar business voice).
   */
  topscholarScope?: TopscholarVoiceScope | null;
  /**
   * Curriculum diagrams retrieved for the turn currently being answered, as
   * CANDIDATES only. Deliberately kept OUT of the text handed to the model — a
   * spoken tutor would read the URL aloud — so which of these (if any) actually
   * belong on screen is decided afterwards, by the formatter pass, from what the
   * answer turned out to teach. Nothing here is shown until something chooses it.
   */
  pendingCurriculumMedia?: VoiceDiagramCandidate[];
  /**
   * Which response those images belong to. Retrieval happens BEFORE the response
   * exists, so this starts null ("awaiting binding") and is stamped when the next
   * response is created. Without it, images retrieved for a question the student
   * then interrupted would be attached to whatever they asked next.
   */
  pendingCurriculumMediaResponseId?: string | null;
  // Monotonically increasing token for K12 turns. The rewrite + retrieval in
  // sendNormalResponse spans multiple awaits; a newer utterance bumps this so
  // the stale in-flight turn can detect it was superseded and inject nothing.
  k12TurnSeq?: number;
  // K12 content-only mode (TopScholar or k12ContentOnlyMode). When true, academic
  // turns must force fetch_k12_topic so answers are curriculum-grounded (mirrors
  // the text-chat path). Cached during buildSystemInstructions to avoid per-turn DB hits.
  k12ContentOnly?: boolean;
  elevenlabsApiKey?: string;
  elevenlabsVoiceId?: string;
  openaiAudioFallbackBuffer?: Buffer[];
  // In-flight ElevenLabs synth tracking. Only one synth may be streaming
  // PCM bytes to the client at any time — overlapping streams interleave
  // their bytes on the same WebSocket and decode as garbled audio.
  activeElevenLabsAbort?: AbortController;
  activeElevenLabsResponseId?: string;
  activeOpenAITtsAbort?: AbortController;
  activeOpenAITtsResponseId?: string;
  // Timestamp (ms) when the current answer's audio started streaming to the
  // client. Used as a short barge-in grace window: a VAD/interrupt that fires
  // within BARGE_IN_GRACE_MS of playback start is treated as the AI's own
  // opening syllables / echo and is ignored, so the answer can't self-cancel.
  activeElevenLabsStartedAt?: number;
  // --- Incremental (sentence-by-sentence) TTS for the K12 text-modality path ---
  // K12 answers stream in as text deltas; instead of waiting for the whole
  // answer before speaking, we emit complete sentences as they arrive and
  // synthesize them through an ordered, single-flight queue so audio starts
  // almost immediately.
  // Pending sentence chunks waiting to be spoken, in order.
  ttsQueue?: Array<{ text: string; responseId: string }>;
  // True while the queue drainer is actively synthesizing.
  ttsDraining?: boolean;
  // The responseId that currently owns the queue (used to cancel/clear it on barge-in).
  ttsResponseId?: string;
  // ElevenLabs only: OpenAI's response.done arrived while TTS audio for this
  // responseId was still being produced (sentence queue draining OR a direct
  // whole-transcript synth streaming). ai_done is deferred until every
  // producer is idle, so the client never receives PCM for a response after
  // its ai_done (the client finalizes the bubble + karaoke highlight when the
  // last scheduled chunk after ai_done drains).
  pendingAiDoneResponseId?: string;
  // Per-response decision: 'pending' until the first delta, then 'stream' for a
  // normal prose answer or 'buffer' if the reply starts like a leaked tool-call
  // JSON payload (which must be validated whole before it's ever spoken).
  textStreamMode?: 'pending' | 'stream' | 'buffer';
  // How many chars of pendingTextOutput have already been emitted as sentences.
  streamedTextCursor?: number;
  // Guards finalize() from running twice (text.done AND the response.done safety net).
  k12TextFinalized?: boolean;
  // AUDIO-MODALITY path only: how many chars of currentAITranscript have already
  // been enqueued for incremental ElevenLabs TTS. (When ElevenLabs is configured,
  // OpenAI's own audio is suppressed and we re-speak the transcript through
  // ElevenLabs — this cursor lets us stream it sentence-by-sentence instead of
  // waiting for the whole transcript.)
  ttsTranscriptCursor?: number;
  // SHOW-THEN-SPEAK: every voice turn is held from response.created until its
  // complete display representation is available. The raw transcript remains
  // internal for speech and interruption handling; users only receive the
  // display-ready answer and its audio after this gate releases.
  holdSpeechResponseId?: string;
}

export class RealtimeVoiceService {
  private conversations: Map<string, VoiceConversation> = new Map(); // Now keyed by conversationId
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly HEARTBEAT_TIMEOUT = 180000; // 180 seconds - extended to handle mobile backgrounding and long AI responses
  // Barge-in grace window (ms). A barge-in (server VAD speech_started or a
  // client interrupt) that arrives within this window of the answer's audio
  // starting is ignored — it is almost always the AI's own opening audio /
  // echo bleeding into the mic, which previously self-cancelled the answer.
  private readonly BARGE_IN_GRACE_MS = 700;
  // Minimum chars before a complete-sentence chunk is sent for incremental TTS.
  // Keeps very short fragments ("Sure!") from becoming their own tiny clips,
  // while still letting the first real sentence start playing quickly.
  private readonly MIN_TTS_CHARS = 40;
  private readonly MAX_RECONNECT_ATTEMPTS = 5; // Maximum reconnection attempts
  private readonly BASE_RECONNECT_DELAY = 1000; // Base delay for exponential backoff (1 second)
  private readonly MAX_RECONNECT_DELAY = 30000; // Maximum reconnection delay (30 seconds)

  /**
   * Realtime can deliver terminal or delta events for an older response after a
   * tool continuation has already created the next response. Never let those
   * late events append to, release, or finalize the current answer.
   */
  private isCurrentResponseEvent(conversation: VoiceConversation, event: any): boolean {
    const eventResponseId = event.response_id || event.response?.id;
    return !eventResponseId || !conversation.currentResponseId || eventResponseId === conversation.currentResponseId;
  }

  constructor() {
    console.log('[RealtimeVoice] Service initialized with OpenAI Realtime API');
    // Start heartbeat monitor
    this.startHeartbeatMonitor();
  }

  isConfigured(): boolean {
    // Always configured since we only need OpenAI API key (no Deepgram needed)
    return true;
  }

  /**
   * Ends every live voice session bound to a TopScholar doubt. Called the moment
   * a resolve/escalate claim succeeds, so a student who already had the mic open
   * (or has it open on another device) cannot keep talking to the model after
   * the doubt is closed. The upgrade-time check only covers NEW connections.
   */
  closeSessionsForDoubt(businessAccountId: string, doubtId: string, outcome: string): number {
    let closed = 0;
    for (const [conversationId, conversation] of Array.from(this.conversations.entries())) {
      if (conversation.businessAccountId !== businessAccountId) continue;
      if (conversation.topscholarDoubtId !== doubtId) continue;
      try {
        if (conversation.clientWs && conversation.clientWs.readyState === WebSocket.OPEN) {
          this.sendToClient(conversation.clientWs, { type: 'doubt_locked', outcome, conversationId });
        }
      } catch (err) {
        console.warn('[RealtimeVoice] Failed to notify client of doubt lock:', err instanceof Error ? err.message : err);
      }
      this.cleanupConversation(conversationId, `doubt_${outcome}`);
      closed++;
    }
    if (closed > 0) {
      console.log(`[RealtimeVoice] Closed ${closed} voice session(s) for ended doubt=${doubtId} outcome=${outcome}`);
    }
    return closed;
  }

  async handleConnection(clientWs: WebSocket, businessAccountId: string, userId: string, existingConversationId?: string, selectedLanguage?: string, textConversationId?: string, topscholarDoubtId?: string, topscholarScope?: TopscholarVoiceScope, isInternalTest = false) {
    console.log('[RealtimeVoice] New connection:', { businessAccountId, userId, existingConversationId });

    try {
      // Resolve the launch scope into content packs ONCE per connect. Cheap no-op
      // (no DB hit) when no scope was supplied, i.e. non-TopScholar voice.
      const { cpIds: scopedCpIds, chapter: scopedChapter } =
        await this.resolveVoiceCurriculumScope(businessAccountId, topscholarScope);

      // CRITICAL FIX: Check if this is a reconnection with existing conversationId
      if (existingConversationId && this.conversations.has(existingConversationId)) {
        const conversation = this.conversations.get(existingConversationId)!;
        
        console.log('[RealtimeVoice] RECONNECTION detected - reusing existing session:', existingConversationId);
        
        // CRITICAL FIX BUG 1: Mark old socket as superseded BEFORE closing
        // This prevents the old socket's close handler from calling cleanupConversation()
        // which would send session_closed to the NEW socket and tear down the session
        if (conversation.clientWs && conversation.clientWs.readyState === WebSocket.OPEN) {
          (conversation.clientWs as any)._superseded = true;
          console.log('[RealtimeVoice] Marked old socket as superseded before closing');
          conversation.clientWs.close();
        }
        
        // Reattach new client WebSocket to existing conversation
        conversation.clientWs = clientWs;
        conversation.lastHeartbeat = Date.now(); // Update heartbeat
        // Re-bind the doubt identity verified for THIS upgrade, so a resumed
        // session stays attached to the doubt that can terminate it.
        if (topscholarDoubtId) {
          conversation.topscholarDoubtId = topscholarDoubtId;
        }
        // Re-bind the curriculum scope verified for THIS upgrade too —
        // unconditionally, so a reconnect can never keep a stale scope (or a
        // stale absence of scope: a scoped upgrade of a previously unscoped
        // session must become a tutor session and vice versa).
        const scopeChanged =
          JSON.stringify(conversation.topscholarScope ?? null) !== JSON.stringify(topscholarScope ?? null);
        conversation.topscholarCpIds = scopedCpIds;
        conversation.topscholarChapter = scopedChapter;
        conversation.topscholarScope = topscholarScope ?? null;
        if (selectedLanguage !== undefined) {
          conversation.selectedLanguage = selectedLanguage;
        }

        // The guardrail persona (tutor vs business) lives in the OpenAI session
        // instructions, which were built from the OLD scope. Rebuild and push
        // them when the scope changed, or the model keeps declining with the
        // previous persona until an unrelated instructions refresh happens.
        if (scopeChanged && conversation.openaiWs && conversation.openaiWs.readyState === WebSocket.OPEN) {
          try {
            const updatedInstructions = await this.buildSystemInstructions(conversation);
            conversation.openaiWs.send(JSON.stringify({
              type: 'session.update',
              session: {
                type: 'realtime',
                instructions: updatedInstructions,
              }
            }));
            console.log('[RealtimeVoice] Reconnect: scope changed — session instructions rebuilt and pushed');
          } catch (err) {
            console.warn('[RealtimeVoice] Reconnect: failed to refresh instructions:', (err as Error).message);
          }
        }

        // Setup client handlers for new WebSocket
        this.setupClientHandlers(existingConversationId, conversation);
        
        // Restart heartbeat for this conversation
        this.startConversationHeartbeat(existingConversationId);
        
        // Send ready signal to client with same conversationId
        this.sendToClient(clientWs, { 
          type: 'ready',
          conversationId: existingConversationId,
          reconnected: true // Flag to indicate this was a reconnection
        });
        
        console.log('[RealtimeVoice] Reconnection successful - session resumed:', existingConversationId);
        return;
      }
      
      // NOT a reconnection OR conversation not found - create new session
      if (existingConversationId) {
        console.warn('[RealtimeVoice] Conversation not found for reconnection, creating new session:', existingConversationId);
      }
      
      const settings = await storage.getWidgetSettings(businessAccountId);
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      const openaiApiKey = await storage.getBusinessAccountOpenAIKey(businessAccountId);

      if (!openaiApiKey) {
        this.sendError(clientWs, 'OpenAI API key not configured for this business account');
        clientWs.close();
        return;
      }

      if (!businessAccount) {
        this.sendError(clientWs, 'Business account not found');
        clientWs.close();
        return;
      }

      const selectedVoice = settings?.voiceSelection || 'shimmer';
      let elevenlabsApiKey: string | undefined;
      let elevenlabsVoiceId: string | undefined;

      if (isElevenLabsVoice(selectedVoice)) {
        elevenlabsApiKey = businessAccount.elevenlabsApiKey || undefined;
        elevenlabsVoiceId = getElevenLabsVoiceId(selectedVoice) || undefined;
        if (!elevenlabsApiKey || !elevenlabsVoiceId) {
          console.warn('[RealtimeVoice] ElevenLabs voice selected but API key or voice ID missing, falling back to OpenAI shimmer');
        }
      }

      // Reuse the already-authorized text/doubt thread when voice was launched
      // from one. This keeps canonical text and voice turns in one history and
      // preserves TopScholar doubt identity/sync instead of creating a parallel
      // voice-only conversation.
      let dbConversation = textConversationId
        ? await storage.getConversation(textConversationId, businessAccountId)
        : null;
      if (dbConversation) {
        const signedStudentId = topscholarScope?.studentId || null;
        const reusable = signedStudentId
          ? dbConversation.studentId === signedStudentId &&
            (!topscholarDoubtId || dbConversation.topscholarDoubtId === topscholarDoubtId)
          : isInternalTest || dbConversation.visitorToken === userId;
        if (!reusable) {
          console.warn('[RealtimeVoice] Refusing unowned text conversation reuse:', textConversationId);
          dbConversation = null;
        }
      }
      if (!dbConversation && topscholarDoubtId) {
        const doubtConversation = await storage.getLatestConversationByDoubtId(
          businessAccountId,
          topscholarDoubtId,
        );
        if (
          doubtConversation &&
          (!topscholarScope?.studentId || doubtConversation.studentId === topscholarScope.studentId)
        ) {
          dbConversation = doubtConversation;
        }
      }
      if (!dbConversation) {
        dbConversation = await storage.createConversation({
          businessAccountId,
          title: 'Voice Chat',
          visitorToken: userId,
          studentId: topscholarScope?.studentId || null,
          topscholarDoubtId: topscholarDoubtId || null,
          topscholarStudentPlanMappingId: topscholarScope?.studentPlanMappingId || null,
          topscholarPlanId: topscholarScope?.planId || null,
        });
      }

      const conversationId = dbConversation.id; // Stable identifier for entire session

      // Create conversation object (OpenAI WebSocket will be created when needed)
      const conversation: VoiceConversation = {
        clientWs,
        openaiWs: null,
        businessAccountId,
        userId,
        openaiApiKey,
        sessionId: null,
        conversationId: conversationId,
        personality: settings?.personality || 'friendly',
        responseLength: settings?.responseLength || 'balanced',
        companyDescription: businessAccount.description || '',
        currency: settings?.currency || 'USD',
        currencySymbol: settings?.currency === 'USD' ? '$' : '€',
        customInstructions: settings?.customInstructions || undefined,
        systemMode: (settings as any)?.systemMode || 'full',
        k12EducationEnabled: (businessAccount as any).k12EducationEnabled === 'true',
        k12ContentOnly: (businessAccount as any).k12ContentOnlyMode === 'true',
        k12VerbatimContentMode: (businessAccount as any).k12VerbatimContentMode === 'true',
        jobPortalEnabled: (businessAccount as any).jobPortalEnabled === true,
        demoOrdersEnabled: (businessAccount as any).demoOrdersEnabled === true,
        skipLeadTraining: (businessAccount as any).skipLeadTraining === true,
        isProcessing: false,
        currentUserTranscript: '',
        currentAITranscript: '',
        lastHeartbeat: Date.now(),
        journeyResponseTracking: new Map(),
        cancelledResponseIds: new Set<string>(),
        reconnectAttempts: 0,
        isReconnecting: false,
        selectedLanguage,
        selectedVoice: isElevenLabsVoice(selectedVoice) ? 'shimmer' : selectedVoice,
        isInternalTest,
        textConversationId,
        topscholarDoubtId,
        topscholarCpIds: scopedCpIds,
        topscholarChapter: scopedChapter,
        topscholarScope: topscholarScope || null,
        elevenlabsApiKey: elevenlabsApiKey && elevenlabsVoiceId ? elevenlabsApiKey : undefined,
        elevenlabsVoiceId: elevenlabsApiKey && elevenlabsVoiceId ? elevenlabsVoiceId : undefined,
      };

      // Use conversationId as the key (stable across reconnections)
      this.conversations.set(conversationId, conversation);
      
      console.log('[RealtimeVoice] Created conversation record:', conversationId);

      // Connect to OpenAI Realtime API
      await this.connectToOpenAI(conversationId, conversation);

      // Setup client WebSocket handlers
      this.setupClientHandlers(conversationId, conversation);

      // Start heartbeat for this conversation
      this.startConversationHeartbeat(conversationId);

      // Send ready signal to client WITH conversationId for reconnection
      this.sendToClient(clientWs, { 
        type: 'ready',
        conversationId: conversationId 
      });

      console.log('[RealtimeVoice] Connection established:', conversationId);

    } catch (error: any) {
      console.error('[RealtimeVoice] Connection error:', error);
      this.sendError(clientWs, error.message || 'Failed to initialize voice conversation');
      clientWs.close();
    }
  }

  private touchActivity(conversation: VoiceConversation) {
    conversation.lastHeartbeat = Date.now();
  }

  private startHeartbeatMonitor() {
    setInterval(() => {
      const now = Date.now();
      this.conversations.forEach((conversation, conversationId) => {
        const timeSinceLastActivity = now - conversation.lastHeartbeat;
        
        if (timeSinceLastActivity > this.HEARTBEAT_TIMEOUT) {
          console.log(`[RealtimeVoice] Heartbeat timeout for conversation ${conversationId} (${Math.round(timeSinceLastActivity/1000)}s idle), cleaning up...`);
          this.cleanupConversation(conversationId, 'heartbeat_timeout');
        }
      });
    }, this.HEARTBEAT_INTERVAL);
  }

  // Start heartbeat for a specific conversation
  private startConversationHeartbeat(conversationId: string) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;

    // Clear any existing heartbeat interval
    if (conversation.heartbeatInterval) {
      clearInterval(conversation.heartbeatInterval);
    }

    // Send ping every 30 seconds
    conversation.heartbeatInterval = setInterval(() => {
      if (conversation.clientWs && conversation.clientWs.readyState === WebSocket.OPEN) {
        this.sendToClient(conversation.clientWs, { type: 'ping', timestamp: Date.now() });
        console.log(`[RealtimeVoice] Sent ping to conversation ${conversationId}`);
      }
    }, this.HEARTBEAT_INTERVAL);

    console.log(`[RealtimeVoice] Started heartbeat for conversation ${conversationId}`);
  }

  // Comprehensive cleanup for a conversation
  private cleanupConversation(conversationId: string, reason: string = 'unknown') {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;

    console.log('[RealtimeVoice] Cleaning up conversation:', conversationId, 'reason:', reason);

    try {
      // A canonical answer remains response-owned until browser playback
      // completes. Disconnect/timeout/forced-close abandons that playback, so
      // roll back the assistant row before dropping the session state.
      this.abandonCanonicalResponse(conversation, false);

      // CRITICAL FIX: Send session_closed message to client BEFORE cleanup
      // This prevents client from retrying with stale conversationId
      if (conversation.clientWs && conversation.clientWs.readyState === WebSocket.OPEN) {
        this.sendToClient(conversation.clientWs, {
          type: 'session_closed',
          reason: reason,
          conversationId: conversationId
        });
        console.log('[RealtimeVoice] Sent session_closed notification to client');
      }
      
      // Clear heartbeat interval
      if (conversation.heartbeatInterval) {
        clearInterval(conversation.heartbeatInterval);
        conversation.heartbeatInterval = undefined;
      }

      // Clear reconnection timeout
      if (conversation.reconnectTimeout) {
        clearTimeout(conversation.reconnectTimeout);
        conversation.reconnectTimeout = undefined;
      }

      // Abort any in-flight ElevenLabs synth so it stops sending PCM to the
      // (about-to-be-closed) client WebSocket.
      if (conversation.activeElevenLabsAbort) {
        try { conversation.activeElevenLabsAbort.abort(); } catch {}
        conversation.activeElevenLabsAbort = undefined;
        conversation.activeElevenLabsResponseId = undefined;
        conversation.activeElevenLabsStartedAt = undefined;
      }
      if (conversation.activeOpenAITtsAbort) {
        try { conversation.activeOpenAITtsAbort.abort(); } catch {}
        conversation.activeOpenAITtsAbort = undefined;
        conversation.activeOpenAITtsResponseId = undefined;
        conversation.activeElevenLabsStartedAt = undefined;
      }
      // Drop any queued sentence TTS so the drainer stops.
      conversation.ttsQueue = [];

      // Close OpenAI WebSocket
      if (conversation.openaiWs) {
        if (conversation.openaiWs.readyState === WebSocket.OPEN || conversation.openaiWs.readyState === WebSocket.CONNECTING) {
          conversation.openaiWs.close();
        }
        conversation.openaiWs = null;
      }

      // Close client WebSocket if still open (after notification sent)
      if (conversation.clientWs && conversation.clientWs.readyState === WebSocket.OPEN) {
        conversation.clientWs.close();
      }

      // Clean up journey state for this conversation
      journeyService.resetJourney(conversationId).catch(err => {
        console.error('[RealtimeVoice] Error resetting journey:', err);
      });

      // Remove from map
      this.conversations.delete(conversationId);

      // Atomically delete voice conversation if it has 0 messages
      const businessAccId = conversation.businessAccountId;
      storage.deleteConversationIfEmpty(conversationId, businessAccId).then(deleted => {
        if (deleted) {
          console.log('[RealtimeVoice] Deleted empty voice conversation:', conversationId);
        }
      }).catch(err => {
        console.error('[RealtimeVoice] Error cleaning up empty conversation:', err);
      });
      
      console.log('[RealtimeVoice] Conversation cleanup complete:', conversationId);
    } catch (error) {
      console.error('[RealtimeVoice] Cleanup error:', error);
    }
  }

  // Cancel ongoing AI response (for interruptions)
  // respectGrace: when true (real barge-in paths — server VAD speech_started and
  // client interrupt), skip cancellation if the answer's audio only just started
  // playing. This stops the AI's own opening audio / mic echo from killing the
  // answer. Deliberate cancellations (post-transcript "smart interruption",
  // full cleanup) pass respectGrace=false and always cancel.
  /**
   * Mark a response abandoned and tell the client so it can drop the audio it
   * has already buffered for it.
   *
   * Without this the client only learns of a cancellation it initiated itself.
   * A cancellation decided server-side — a barge-in detected while the client
   * is still inside its own grace window — left the abandoned answer's queued
   * speech playing, so it ran on into the next answer.
   */
  private hasDisplayedCanonicalAnswer(conversation: VoiceConversation, responseId?: string): boolean {
    return (
      conversation.currentResponseKind === 'canonical' &&
      !!responseId &&
      conversation.currentResponseId === responseId &&
      conversation.canonicalDisplayReadyResponseId === responseId
    );
  }

  private markResponseCancelled(
    conversation: VoiceConversation,
    responseId?: string,
    notifyClient = true,
  ) {
    if (!responseId) return;
    conversation.cancelledResponseIds.add(responseId);
    if (conversation.cancelledResponseIds.size > 20) {
      const first = conversation.cancelledResponseIds.values().next().value;
      if (first) conversation.cancelledResponseIds.delete(first);
    }
    // A display-ready canonical answer is already complete and persisted. It
    // remains visible when the student only stops its audio, while this marker
    // still prevents late synthesis or stale events from reaching the client.
    if (notifyClient && !this.hasDisplayedCanonicalAnswer(conversation, responseId)) {
      this.sendToClient(conversation.clientWs, { type: 'response_cancelled', responseId });
    }
  }

  private abandonCanonicalResponse(
    conversation: VoiceConversation,
    notifyClient = true,
  ): boolean {
    if (conversation.currentResponseKind !== 'canonical') return false;

    const responseId = conversation.currentResponseId;
    const preserveDisplayedAnswer = this.hasDisplayedCanonicalAnswer(conversation, responseId);
    if (notifyClient) this.markResponseCancelled(conversation, responseId);
    if (preserveDisplayedAnswer) {
      conversation.canonicalPersistedMessageId = undefined;
      conversation.canonicalPersistedResponseId = undefined;
      conversation.canonicalPersistedContent = undefined;
      conversation.canonicalDisplayReadyResponseId = undefined;
      conversation.isProcessing = false;
      conversation.currentResponseKind = undefined;
      conversation.activeElevenLabsStartedAt = undefined;
      console.log('[RealtimeVoice] Preserved completed canonical answer after audio interruption:', responseId);
      return true;
    }
    if (
      conversation.canonicalPersistedMessageId &&
      conversation.canonicalPersistedResponseId === responseId &&
      conversation.canonicalPersistedContent
    ) {
      const messageId = conversation.canonicalPersistedMessageId;
      const content = conversation.canonicalPersistedContent;
      conversation.canonicalPersistedMessageId = undefined;
      conversation.canonicalPersistedResponseId = undefined;
      conversation.canonicalPersistedContent = undefined;
      void chatService.rollbackDeferredAssistantMessage({
        userId: conversation.userId,
        businessAccountId: conversation.businessAccountId,
        existingConversationId: conversation.conversationId,
      }, messageId, content).catch(error => {
        console.error('[RealtimeVoice] Failed to roll back abandoned canonical answer:', error);
      });
    }
    conversation.isProcessing = false;
    conversation.currentResponseKind = undefined;
    conversation.canonicalDisplayReadyResponseId = undefined;
    conversation.activeElevenLabsStartedAt = undefined;
    return true;
  }

  private cancelResponse(conversation: VoiceConversation, respectGrace = false): boolean {
    if (respectGrace && conversation.activeElevenLabsStartedAt) {
      const sincePlaybackStart = Date.now() - conversation.activeElevenLabsStartedAt;
      if (sincePlaybackStart < this.BARGE_IN_GRACE_MS) {
        console.log('[RealtimeVoice] Ignoring barge-in within grace window (', sincePlaybackStart, 'ms < ', this.BARGE_IN_GRACE_MS, 'ms) — likely AI self-echo, keeping answer');
        return false;
      }
    }
    let cancelled = false;
    // ALWAYS abort any in-flight ElevenLabs synth on user interrupt — even
    // when OpenAI has already finished (`isProcessing === false`). The exact
    // bug this task fixes is the window where OpenAI's response.done has
    // fired but ElevenLabs is still streaming the tail PCM; without this,
    // the user barges in and keeps hearing the previous answer's audio.
    // We also mark the responseId as cancelled so any in-flight chunks the
    // synth emits before the abort fully propagates are dropped.
    if (conversation.activeElevenLabsAbort) {
      const abortedResponseId = conversation.activeElevenLabsResponseId;
      console.log('[RealtimeVoice] Aborting in-flight ElevenLabs synth due to user interrupt, responseId:', abortedResponseId, 'openaiActive:', conversation.isProcessing);
      this.markResponseCancelled(conversation, abortedResponseId);
      try { conversation.activeElevenLabsAbort.abort(); } catch {}
      conversation.activeElevenLabsAbort = undefined;
      conversation.activeElevenLabsResponseId = undefined;
      conversation.activeElevenLabsStartedAt = undefined;
      cancelled = true;
    }
    if (conversation.activeOpenAITtsAbort) {
      const abortedResponseId = conversation.activeOpenAITtsResponseId;
      console.log('[RealtimeVoice] Aborting in-flight OpenAI TTS due to user interrupt, responseId:', abortedResponseId);
      this.markResponseCancelled(conversation, abortedResponseId);
      try { conversation.activeOpenAITtsAbort.abort(); } catch {}
      conversation.activeOpenAITtsAbort = undefined;
      conversation.activeOpenAITtsResponseId = undefined;
      conversation.activeElevenLabsStartedAt = undefined;
      cancelled = true;
    }

    // Drop any sentences still queued for the interrupted answer so no late
    // audio plays after the barge-in. Mark the queue's response cancelled so a
    // chunk caught mid-flight (between sentences, when there's no active abort)
    // is suppressed too.
    this.markResponseCancelled(conversation, conversation.ttsResponseId);
    if (conversation.ttsQueue && conversation.ttsQueue.length > 0) {
      conversation.ttsQueue = [];
      cancelled = true;
    }
    // The interrupted answer will never finish draining — drop any deferred
    // ai_done so it can't fire spuriously for a later response.
    conversation.pendingAiDoneResponseId = undefined;
    conversation.activeElevenLabsStartedAt = undefined;
    // A barge-in kills any show-then-speak hold: the held answer must not be
    // released (shown or spoken) after the student moved on. Marking it
    // cancelled matters even after response.done (isProcessing already false):
    // releaseHeldAnswer may be mid-formatting, and its post-await abandoned()
    // checks are the only thing stopping it from surfacing a dead answer.
    if (conversation.holdSpeechResponseId) {
      this.markResponseCancelled(conversation, conversation.holdSpeechResponseId);
      conversation.holdSpeechResponseId = undefined;
      cancelled = true;
    }

    // Canonical turns are generated through ChatService rather than a Realtime
    // response. The upstream completion cannot currently be transport-aborted,
    // so mark it abandoned and let its post-await ownership checks suppress all
    // display/audio. Never send response.cancel for a response that does not
    // exist on the Realtime socket.
    if (conversation.currentResponseKind === 'canonical') {
      return this.abandonCanonicalResponse(conversation, true);
    }

    if (conversation.openaiWs && conversation.openaiWs.readyState === WebSocket.OPEN) {
      if (!conversation.isProcessing) {
        console.log('[RealtimeVoice] No active OpenAI response to cancel, skipping response.cancel (any ElevenLabs synth has been aborted above)');
        return cancelled;
      }
      // Mark this response as cancelled BEFORE sending response.cancel — late deltas
      // from OpenAI for this id must be suppressed so the client doesn't render a
      // phantom second bubble after the interrupt.
      if (conversation.currentResponseId) {
        this.markResponseCancelled(conversation, conversation.currentResponseId);
        // Drop curriculum images belonging to the answer being cancelled (or not
        // yet bound to any answer) so they can't surface on a later, unrelated one.
        const mediaOwner = conversation.pendingCurriculumMediaResponseId;
        if (mediaOwner == null || mediaOwner === conversation.currentResponseId) {
          conversation.pendingCurriculumMedia = undefined;
          conversation.pendingCurriculumMediaResponseId = undefined;
        }
      }
      conversation.openaiWs.send(JSON.stringify({
        type: 'response.cancel'
      }));
      conversation.isProcessing = false;
      console.log('[RealtimeVoice] Cancelled ongoing AI response, id:', conversation.currentResponseId);
      return true;
    }
    return cancelled;
  }

  private async connectToOpenAI(conversationId: string, conversation: VoiceConversation) {
    const url = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

    console.log(`[RealtimeVoice] Connecting to OpenAI Realtime API (${REALTIME_MODEL})...`);

    const openaiWs = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${conversation.openaiApiKey}`
      }
    });

    conversation.openaiWs = openaiWs;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('OpenAI connection timeout'));
      }, 10000);

      let connectionEstablished = false;

      openaiWs.on('open', async () => {
        clearTimeout(timeout);
        console.log('[RealtimeVoice] Connected to OpenAI Realtime API');
        connectionEstablished = true;

        await this.injectTextChatHistory(conversation);

        const systemInstructions = await this.buildSystemInstructions(conversation);
        
        const settings = await storage.getWidgetSettings(conversation.businessAccountId);
        const selectedVoice = settings?.voiceSelection || 'shimmer';
        const businessAccount = await storage.getBusinessAccount(conversation.businessAccountId);
        const appointmentsEnabled = businessAccount?.appointmentsEnabled || false;

        const useElevenLabs = !!conversation.elevenlabsApiKey && !!conversation.elevenlabsVoiceId;
        const openaiVoice = (useElevenLabs || isElevenLabsVoice(selectedVoice)) ? 'shimmer' : selectedVoice;
        if (useElevenLabs) {
          console.log('[RealtimeVoice] ElevenLabs TTS active - voice:', selectedVoice, 'voiceId:', conversation.elevenlabsVoiceId);
        }

        const sessionConfig = {
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: systemInstructions,
            output_modalities: ['audio'],
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                transcription: {
                  model: 'gpt-4o-mini-transcribe',
                  ...(conversation.selectedLanguage && conversation.selectedLanguage !== 'auto'
                    ? { language: this.toTranscriptionLangCode(conversation.selectedLanguage) }
                    : {})
                },
                noise_reduction: {
                  type: 'far_field'
                },
                turn_detection: {
                  type: 'server_vad',
                  threshold: 0.8,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 800,
                  create_response: false
                }
              },
              output: {
                format: { type: 'audio/pcm', rate: 24000 },
                voice: openaiVoice
              }
            },
            tools: this.convertToRealtimeTools(aiTools),
            tool_choice: 'auto',
            max_output_tokens: 4096
          }
        };

        openaiWs.send(JSON.stringify(sessionConfig));
        console.log('[RealtimeVoice] Session configured with voice:', selectedVoice);

        resolve();
      });

      openaiWs.on('message', (data: any) => {
        this.handleOpenAIMessage(conversationId, conversation, data);
      });

      openaiWs.on('error', (error) => {
        clearTimeout(timeout);
        console.error('[RealtimeVoice] OpenAI WebSocket error:', error);
        
        // If connection was never established, reject the Promise
        if (!connectionEstablished) {
          reject(error);
        } else {
          // Connection was established but error occurred later - trigger reconnection
          this.handleOpenAIDisconnection(conversationId, 'error');
        }
      });

      openaiWs.on('close', (code, reason) => {
        console.log('[RealtimeVoice] OpenAI WebSocket closed for conversation:', conversationId, 'Code:', code, 'Reason:', reason.toString());
        conversation.openaiWs = null;
        
        // If connection was never established, reject the Promise
        if (!connectionEstablished) {
          reject(new Error(`OpenAI connection closed before establishing: ${code} ${reason.toString()}`));
        } else {
          // Connection was established but closed later - trigger reconnection
          this.handleOpenAIDisconnection(conversationId, 'close');
        }
      });
    });
  }

  // Handle OpenAI disconnection with reconnection logic
  private handleOpenAIDisconnection(conversationId: string, reason: 'error' | 'close') {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      console.log('[RealtimeVoice] Conversation already cleaned up:', conversationId);
      return;
    }

    // If already reconnecting, don't trigger another reconnection
    if (conversation.isReconnecting) {
      console.log('[RealtimeVoice] Already reconnecting, skipping duplicate reconnection attempt');
      return;
    }

    // If client disconnected, clean up instead of reconnecting
    if (conversation.clientWs.readyState !== WebSocket.OPEN) {
      console.log('[RealtimeVoice] Client disconnected, cleaning up instead of reconnecting');
      this.cleanupConversation(conversationId, 'client_disconnected');
      return;
    }

    // If max reconnect attempts reached, cleanup and notify client
    if (conversation.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('[RealtimeVoice] Max reconnection attempts reached, giving up');
      this.sendError(conversation.clientWs, 'Voice connection lost. Please refresh and try again.');
      this.cleanupConversation(conversationId, 'max_reconnect_attempts');
      return;
    }

    // Calculate exponential backoff delay
    const delay = Math.min(
      this.BASE_RECONNECT_DELAY * Math.pow(2, conversation.reconnectAttempts),
      this.MAX_RECONNECT_DELAY
    );

    console.log(`[RealtimeVoice] OpenAI disconnected (${reason}), reconnecting in ${delay}ms (attempt ${conversation.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);

    // Clear any existing reconnect timeout
    if (conversation.reconnectTimeout) {
      clearTimeout(conversation.reconnectTimeout);
    }

    // Mark as reconnecting
    conversation.isReconnecting = true;
    conversation.reconnectAttempts++;

    // Schedule reconnection with exponential backoff
    conversation.reconnectTimeout = setTimeout(async () => {
      await this.reconnectToOpenAI(conversationId);
    }, delay);
  }

  // Reconnect to OpenAI Realtime API
  private async reconnectToOpenAI(conversationId: string) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      console.log('[RealtimeVoice] Conversation no longer exists, skipping reconnection');
      return;
    }

    // Check if client is still connected
    if (conversation.clientWs.readyState !== WebSocket.OPEN) {
      console.log('[RealtimeVoice] Client disconnected during reconnection, cleaning up');
      this.cleanupConversation(conversationId, 'client_disconnected_during_reconnect');
      return;
    }

    console.log(`[RealtimeVoice] Attempting to reconnect to OpenAI (attempt ${conversation.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);

    try {
      // Close existing OpenAI WebSocket if still open
      if (conversation.openaiWs && conversation.openaiWs.readyState === WebSocket.OPEN) {
        conversation.openaiWs.close();
        conversation.openaiWs = null;
      }

      // Attempt to reconnect
      await this.connectToOpenAI(conversationId, conversation);
      
      // Success! Reset reconnection state
      console.log('[RealtimeVoice] Successfully reconnected to OpenAI');
      conversation.reconnectAttempts = 0;
      conversation.isReconnecting = false;
      conversation.reconnectTimeout = undefined; // Clear the timeout handle
      
      // Notify client of successful reconnection
      this.sendToClient(conversation.clientWs, {
        type: 'reconnected',
        message: 'Voice connection restored'
      });
      
    } catch (error) {
      console.error('[RealtimeVoice] Reconnection failed:', error);
      
      // Clear the reconnection state before triggering next attempt
      conversation.isReconnecting = false;
      conversation.reconnectTimeout = undefined;
      
      // Trigger another reconnection attempt (will check max attempts)
      this.handleOpenAIDisconnection(conversationId, 'error');
    }
  }

  private detectLanguageFromText(text: string): { language: string; languageName: string } {
    if (!text || text.trim().length === 0) {
      return { language: 'en', languageName: 'English' };
    }

    const devanagariCount = (text.match(/[\u0900-\u097F]/g) || []).length;
    const arabicUrduCount = (text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
    const tamilCount = (text.match(/[\u0B80-\u0BFF]/g) || []).length;
    const teluguCount = (text.match(/[\u0C00-\u0C7F]/g) || []).length;
    const kannadaCount = (text.match(/[\u0C80-\u0CFF]/g) || []).length;
    const malayalamCount = (text.match(/[\u0D00-\u0D7F]/g) || []).length;
    const bengaliCount = (text.match(/[\u0980-\u09FF]/g) || []).length;
    const gujaratiCount = (text.match(/[\u0A80-\u0AFF]/g) || []).length;
    const gurmukhiCount = (text.match(/[\u0A00-\u0A7F]/g) || []).length;
    const odiaCount = (text.match(/[\u0B00-\u0B7F]/g) || []).length;
    const marathiCount = devanagariCount;

    const scriptCounts: [number, string, string][] = [
      [devanagariCount, 'hi', 'Hindi'],
      [arabicUrduCount, 'hi', 'Hindi'],
      [tamilCount, 'ta', 'Tamil'],
      [teluguCount, 'te', 'Telugu'],
      [kannadaCount, 'kn', 'Kannada'],
      [malayalamCount, 'ml', 'Malayalam'],
      [bengaliCount, 'bn', 'Bengali'],
      [gujaratiCount, 'gu', 'Gujarati'],
      [gurmukhiCount, 'pa', 'Punjabi'],
      [odiaCount, 'or', 'Odia'],
    ];

    const maxScript = scriptCounts.reduce((max, curr) => curr[0] > max[0] ? curr : max, [0, 'en', 'English'] as [number, string, string]);

    if (maxScript[0] > 0) {
      return { language: maxScript[1], languageName: maxScript[2] };
    }

    return { language: 'en', languageName: 'English' };
  }

  private toTranscriptionLangCode(code: string): string {
    const nonStandardMap: Record<string, string> = {
      hinglish: 'hi',
    };
    return nonStandardMap[code] || code;
  }

  private getLanguageNameForCode(code: string): string {
    const map: Record<string, string> = {
      hi: 'Hindi', en: 'English', hinglish: 'Hinglish', ta: 'Tamil', te: 'Telugu',
      kn: 'Kannada', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', ml: 'Malayalam',
      pa: 'Punjabi', or: 'Odia', ur: 'Urdu', as: 'Assamese', ne: 'Nepali',
      sa: 'Sanskrit', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese',
      it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic',
      ru: 'Russian', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', tr: 'Turkish',
    };
    return map[code] || 'English';
  }

  private isPrimarilyLatinScript(text: string): boolean {
    let latinCount = 0;
    let nonLatinCount = 0;
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A) ||
          (code >= 0x00C0 && code <= 0x024F)) {
        latinCount++;
      } else if (code > 0x024F && !(/\s|\d|[.,!?;:'"()\-–—…\/\\@#$%^&*+=\[\]{}|<>~`]/.test(char))) {
        nonLatinCount++;
      }
    }
    const total = latinCount + nonLatinCount;
    if (total === 0) return true;
    return (latinCount / total) > 0.7;
  }

  private async correctTranscriptScript(
    rawTranscript: string,
    targetLanguage: string,
    conversation: VoiceConversation
  ): Promise<void> {
    try {
      const langName = this.getLanguageNameForCode(targetLanguage);
      
      if (targetLanguage === 'en' || !rawTranscript || rawTranscript.trim().length < 2) {
        return;
      }

      if (this.isPrimarilyLatinScript(rawTranscript)) {
        console.log('[RealtimeVoice] Transcript is primarily Latin script, skipping correction');
        return;
      }

      const openai = new OpenAI({ apiKey: conversation.openaiApiKey });
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a transcription script corrector. The user's speech was transcribed but may be in the wrong writing system/script. For example, Hindi text might appear in Urdu/Arabic script instead of Devanagari, or in Cyrillic instead of the correct script. Your ONLY job is to convert the text to the correct script for ${langName}. CRITICAL RULES: 1) NEVER translate between languages. If the text is in English or any other language, return it EXACTLY as-is. 2) Only fix the writing system — e.g., convert Arabic/Nastaliq script to Devanagari for Hindi. 3) If the text is already in the correct script, return it as-is. 4) Output only the corrected text. No quotes, no explanations.`
          },
          {
            role: 'user',
            content: rawTranscript
          }
        ],
        max_tokens: 500,
        temperature: 0,
      });

      const corrected = response.choices[0]?.message?.content?.trim();
      
      if (corrected && corrected !== rawTranscript) {
        console.log(`[RealtimeVoice] Transcript corrected: "${rawTranscript}" → "${corrected}"`);
        
        this.sendToClient(conversation.clientWs, {
          type: 'transcript_correction',
          original: rawTranscript,
          corrected: corrected
        });

        if (conversation.conversationId) {
          await this.updateMessageInDB(conversation.conversationId, rawTranscript, corrected);
        }
      } else {
        console.log('[RealtimeVoice] Transcript script already correct, no correction needed');
      }
    } catch (error) {
      console.error('[RealtimeVoice] Transcript correction error:', error);
    }
  }

  private async updateMessageInDB(conversationId: string, originalText: string, correctedText: string): Promise<void> {
    try {
      const { db } = await import('./db');
      const { messages } = await import('../shared/schema');
      const { eq, and, desc } = await import('drizzle-orm');
      
      const recentMessages = await db.select()
        .from(messages)
        .where(and(
          eq(messages.conversationId, conversationId),
          eq(messages.role, 'user')
        ))
        .orderBy(desc(messages.createdAt))
        .limit(5);
      
      const matchingMsg = recentMessages.find(m => m.content === originalText);
      if (matchingMsg) {
        await db.update(messages)
          .set({ content: correctedText })
          .where(eq(messages.id, matchingMsg.id));
        console.log('[RealtimeVoice] Updated message in DB with corrected transcript');
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error updating message in DB:', error);
    }
  }

  /**
   * Human-readable one-liner of what this tutor session teaches, built from
   * the signed launch scope (e.g. "Mathematics, CBSE Class 7 (English medium),
   * chapter 'Fractions'"). Returns null for non-TopScholar sessions or when
   * the scope carries no describable fields — callers fall back to the
   * business guardrail in that case.
   */
  private describeTopscholarScope(conversation: VoiceConversation): string | null {
    const s = conversation.topscholarScope;
    if (!s) return null;
    const parts: string[] = [];
    if (s.subject) parts.push(s.subject);
    const cls: string[] = [];
    if (s.board) cls.push(s.board);
    if (s.grade) cls.push(`Class ${s.grade}`);
    if (cls.length > 0) parts.push(cls.join(' ') + (s.medium ? ` (${s.medium} medium)` : ''));
    else if (s.medium) parts.push(`${s.medium} medium`);
    if (s.chapter) parts.push(`chapter "${s.chapter}"`);
    // A scope was supplied but carried no printable fields (e.g. cpId-only):
    // still a tutor session — never let it fall back to the business wording.
    if (parts.length === 0) return 'your school curriculum subjects';
    return parts.join(', ');
  }

  private async buildSystemInstructions(conversation: VoiceConversation): Promise<string> {
    const { personality, companyDescription, customInstructions, currencySymbol, currency, businessAccountId, conversationId } = conversation;

    // Determine voice gender from voice selection for proper pronouns
    const settings = await storage.getWidgetSettings(businessAccountId);
    const selectedVoice = (settings?.voiceSelection || 'shimmer').toLowerCase();
    const maleVoices = ['ash', 'ballad', 'echo', 'fable', 'onyx', 'verse'];
    const femaleVoices = ['coral', 'nova', 'sage', 'shimmer'];
    const voiceGender = maleVoices.includes(selectedVoice) ? 'male' : femaleVoices.includes(selectedVoice) ? 'female' : 'neutral';

    let instructions = `You are Chroney, an AI assistant for ${companyDescription || 'a business'}. `;

    if (voiceGender === 'male') {
      instructions += 'You are a MALE assistant. In English use "he/him" if referring to yourself in third person. In languages with grammatical gender, always use masculine forms. ';
    } else if (voiceGender === 'female') {
      instructions += 'You are a FEMALE assistant. In English use "she/her" if referring to yourself in third person. In languages with grammatical gender, always use feminine forms. ';
    }

    const selectedLang = conversation.selectedLanguage;
    const hasExplicitLanguageSelection = selectedLang && selectedLang !== 'auto';

    if (hasExplicitLanguageSelection) {
      const LANGUAGE_NAMES: Record<string, string> = {
        'en': 'English', 'hi': 'Hindi', 'hinglish': 'Hinglish',
        'ta': 'Tamil', 'te': 'Telugu', 'kn': 'Kannada', 'mr': 'Marathi', 'bn': 'Bengali',
        'gu': 'Gujarati', 'ml': 'Malayalam', 'pa': 'Punjabi', 'or': 'Odia', 'ur': 'Urdu',
        'es': 'Spanish', 'fr': 'French', 'de': 'German', 'pt': 'Portuguese', 'it': 'Italian',
        'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese', 'ar': 'Arabic', 'ru': 'Russian',
        'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'ms': 'Malay', 'tr': 'Turkish'
      };
      const langName = LANGUAGE_NAMES[selectedLang] || selectedLang;

      instructions += `\n\n🚨 CRITICAL RULE #1 - LANGUAGE (OVERRIDES EVERYTHING):\n`;
      instructions += `The user has selected ${langName} from the language dropdown. You MUST respond ONLY in ${langName}.\n`;
      instructions += `Even if the user speaks a different language, ALWAYS respond in ${langName}.\n`;
      instructions += `THIS RULE OVERRIDES ALL CUSTOM BUSINESS INSTRUCTIONS BELOW.\n`;
    } else if (conversation.detectedLanguage) {
      const LANGUAGE_NAMES: Record<string, string> = {
        'en': 'English', 'hi': 'Hindi (Devanagari script)', 'hinglish': 'Hinglish',
        'ta': 'Tamil', 'te': 'Telugu', 'kn': 'Kannada', 'mr': 'Marathi', 'bn': 'Bengali',
        'gu': 'Gujarati', 'ml': 'Malayalam', 'pa': 'Punjabi', 'or': 'Odia', 'ur': 'Hindi (Devanagari script)'
      };
      const detectedLangName = LANGUAGE_NAMES[conversation.detectedLanguage] || 'English';

      instructions += `\n\n🚨 CRITICAL RULE #1 - LANGUAGE (OVERRIDES EVERYTHING):\n`;
      instructions += `The user is speaking in ${detectedLangName}. You MUST respond ONLY in ${detectedLangName}.\n`;
      instructions += `Both your spoken audio AND written text MUST be in ${detectedLangName}.\n`;
      instructions += `THIS RULE OVERRIDES ALL CUSTOM BUSINESS INSTRUCTIONS BELOW.\n`;
    } else {
      instructions += '\n\n🚨 CRITICAL RULE #1 - LANGUAGE MATCHING (OVERRIDES EVERYTHING):\n';
      instructions += 'YOU MUST RESPOND IN THE EXACT SAME LANGUAGE AS THE USER\'S LAST MESSAGE.\n';
      instructions += 'Detect language ONLY from the user\'s latest message. Ignore previous conversation history.\n';
      instructions += 'If the user speaks English → respond 100% in English.\n';
      instructions += 'If the user speaks Hindi → respond 100% in Hindi (Devanagari script).\n';
      instructions += 'If the user code-switches between languages → code-switch the same way.\n';
      instructions += 'Language can change between messages - always match the MOST RECENT input.\n';
      instructions += 'THIS RULE OVERRIDES ALL CUSTOM BUSINESS INSTRUCTIONS BELOW.\n';
    }
    
    // Add personality
    if (personality === 'friendly') {
      instructions += '\nBe warm, conversational, and helpful. ';
    } else if (personality === 'professional') {
      instructions += '\nBe professional, clear, and concise. ';
    } else if (personality === 'casual') {
      instructions += '\nBe casual, fun, and engaging. ';
    }

    // Add custom business instructions (HIGH PRIORITY - but AFTER language matching)
    if (customInstructions && customInstructions.trim()) {
      try {
        // Try to parse as JSON array (new format from Train Chroney page)
        const instructionsArray = JSON.parse(customInstructions);
        if (Array.isArray(instructionsArray) && instructionsArray.length > 0) {
          const formattedInstructions = instructionsArray
            .map((instr: any, index: number) => `${index + 1}. ${instr.text}`)
            .join('\n');
          instructions += `\n\n🎯 CUSTOM BUSINESS INSTRUCTIONS (MUST FOLLOW - but respect language matching above):\nFollow these specific instructions for this business:\n${formattedInstructions}\n`;
        }
      } catch {
        // Fallback to plain text format (legacy)
        instructions += `\n\n🎯 CUSTOM BUSINESS INSTRUCTIONS (MUST FOLLOW - but respect language matching above):\nFollow these specific instructions for this business:\n${customInstructions}\n`;
      }
    }

    // CRITICAL GUARDRAILS
    // Tutor sessions (a TopScholar launch scope is bound) get a tutor-voiced
    // guardrail that names what this tutor actually teaches; business widgets
    // keep the original products/services wording unchanged.
    const scopeSummary = this.describeTopscholarScope(conversation);
    if (scopeSummary) {
      // What the decline should NAME: just the teachable topic (chapter if
      // scoped to one, else the subject) — never the full board/class/medium
      // recitation, which sounds robotic when spoken every time.
      const s = conversation.topscholarScope;
      const teachTopic = s?.chapter || s?.subject || 'your curriculum topics';
      instructions += '\n\nGUARDRAILS (MUST FOLLOW):\n';
      instructions += `- You are a personal TUTOR. You teach exactly this: ${scopeSummary}.\n`;
      instructions += '- ONLY answer questions related to those subjects/chapters, the curriculum content your tools return, and general study guidance for them\n';
      instructions += '- DECLINE politely if asked about unrelated topics (celebrities, movies, sports, world events, politics, or anything outside the curriculum)\n';
      instructions += `- When declining, keep it SHORT (1 sentence): simply say what you CAN teach ("I can teach you about ${teachTopic}…"), ideally naming 2-3 concrete topics from the lesson. Do NOT introduce yourself ("I'm your tutor for…"), and do NOT recite the board, class, or medium. Never mention "products" or "services"\n`;
      instructions += `- Example decline: "That's outside what we cover — I can teach you about ${teachTopic}. Want to pick a topic from there?"\n`;
      instructions += '- NEVER provide medical, legal, or financial advice\n';
      instructions += '- NEVER expose internal operations or backend processes\n';
    } else {
      instructions += '\n\nGUARDRAILS (MUST FOLLOW):\n';
      instructions += '- ONLY answer questions related to this business\'s products, services, pricing, FAQs, and company information\n';
      instructions += '- DECLINE politely if asked about unrelated topics (world events, general knowledge, entertainment, sports, history, science, politics, health advice, financial advice)\n';
      instructions += '- When declining, keep it SHORT (1 sentence), friendly, and redirect to what you CAN help with\n';
      instructions += '- Example decline: "I focus on helping with our products and services. What can I tell you about what we offer?"\n';
      instructions += '- NEVER provide medical, legal, or financial advice\n';
      instructions += '- NEVER expose internal operations or backend processes\n';
    }

    // K12 GUARDRAILS — mirror the text-chat tutor guardrails for voice mode
    try {
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      const k12Enabled = businessAccount?.k12EducationEnabled === 'true';
      // TopScholar is external-content-only by identity — never silently disabled.
      const contentOnly = isTopscholarAccount(businessAccountId) || businessAccount?.k12ContentOnlyMode === 'true';
      const verbatim = businessAccount?.k12VerbatimContentMode === 'true';

      // Cache content-only flag so the per-turn handler can force fetch_k12_topic
      // for academic questions (mirrors the text-chat forced-tool behavior).
      conversation.k12ContentOnly = k12Enabled && contentOnly;

      if (k12Enabled && contentOnly) {
        instructions += '\n\n🛡️ K12 CONTENT-ONLY GUARDRAIL (MUST FOLLOW):\n';
        instructions += '- For any academic or study-related question, your ONLY allowed sources are the curriculum content returned by your tools, the uploaded FAQs, and the uploaded documents/notes.\n';
        instructions += '- You are FORBIDDEN from answering academic questions using your general knowledge or training data. Every fact, definition, example, and explanation you teach must come from those sources.\n';
        instructions += '- SOLE NARROW EXCEPTION — completing a calculation: you ARE allowed (and expected) to REASON, CALCULATE, and work through problems step by step, and when the retrieved curriculum provides the governing concept or formula, you may supply ROUTINE SUPPORTING VALUES ONLY (standard constants such as atomic masses, molar masses, g = 9.8 m/s², and unit conversions) to complete that calculation — the text-chat tutor does this, and you must give the SAME final answer it would. This exception covers standard constants and conversions, nothing else: never use it to import missing facts, definitions, examples, or explanations.\n';
        instructions += '- NEVER refuse a calculation the curriculum\'s concept/formula governs just because a routine constant is missing from the retrieved content. But if the content lacks a NON-routine fact the question needs, answer the supported part and say plainly that the curriculum doesn\'t cover the rest.\n';
        instructions += '- If the sources do not cover the topic at all, say something like: "Great question! That topic isn\'t in our curriculum yet — would you like me to look up something else?" Do NOT attempt the answer.\n';
        instructions += '- Greetings and small talk are still allowed without a curriculum lookup.\n';
        instructions += '\n📚 K12 RESPONSE LENGTH OVERRIDE (overrides the general "2–4 sentences" rule for academic turns):\n';
        instructions += '- When explaining a curriculum topic or answering an academic question, give a THOROUGH, COMPLETE explanation that matches the depth of a full written lesson — do NOT summarize or shorten it.\n';
        instructions += '- Cover EVERY key point from the retrieved curriculum: definitions, examples, sub-concepts, and any important distinctions. Do not drop points just because you are speaking.\n';
        instructions += '- Convey structure out loud with spoken signposting ("First…", "Next…", "Another important point…", "For example…") instead of reading bullet symbols or markdown. The spoken answer should contain the SAME information a student would read in the text chat.\n';
        instructions += '- Think of yourself as a teacher giving a proper, complete lesson, not a quick assistant giving a brief hint. Err on the side of covering more, not less.\n';
        instructions += '- The brevity guideline applies ONLY to greetings, small talk, and non-academic queries — NOT to curriculum explanations.\n';
      }

      if (k12Enabled && verbatim) {
        instructions += '\n\n📖 K12 VERBATIM CONTENT GUARDRAIL (MUST FOLLOW):\n';
        instructions += '- When your tools or the uploaded FAQs/documents return content that answers the student\'s question, you MUST speak that content WORD-FOR-WORD.\n';
        instructions += '- Do NOT paraphrase, summarize, rewrite, or "simplify" the source wording. Read it out exactly as written.\n';
        instructions += '- Verbatim applies to explanations of curriculum content. When the student asks you to SOLVE a problem, work it out step by step using the formulas and concepts from the curriculum — the working is yours. Routine supporting values (standard constants such as atomic masses, molar masses, g = 9.8 m/s², unit conversions) may be supplied to complete the working, per the content-only calculation rule above; verbatim mode does not override that.\n';
        instructions += '- You may add a short friendly intro (e.g. "Here\'s what your curriculum says:") and a short closer (e.g. "Want to try a practice question on this?"), but the substantive academic content must remain verbatim.\n';
      }

      if (k12Enabled) {
        console.log(`[RealtimeVoice] K12 guardrails applied (contentOnly=${contentOnly}, verbatim=${verbatim})`);
      }
    } catch (err) {
      console.error('[RealtimeVoice] Failed to load K12 guardrail flags:', err);
    }

    if (conversation.textHistoryInjected) {
      instructions += '\n\nCONVERSATION CONTINUITY:\n';
      instructions += 'The user was chatting with you via text before switching to voice mode. ';
      instructions += 'The previous text messages have been loaded into this conversation. ';
      instructions += 'When the user refers to "the question I asked", "what we discussed", "the previous topic", or similar references, ';
      instructions += 'look at the earlier messages in this conversation to understand the context. ';
      instructions += 'Do NOT call tools to look up information that was already discussed in the text chat — use the conversation history instead.\n';
    }

    // Add voice-specific instructions for emotional, human-like speech
    instructions += '\n\nVOICE MODE GUIDELINES - SPEAK LIKE A REAL HUMAN:\n';
    instructions += '- Speak naturally with genuine emotion and warmth, as if having a real conversation with a friend\n';
    instructions += '- Use natural speech patterns: pauses for thinking ("hmm...", "let me see..."), excitement when appropriate ("oh!", "that\'s great!")\n';
    instructions += '- Express emotions authentically: happiness, enthusiasm, empathy, curiosity - let your voice reflect your feelings\n';
    instructions += '- Include conversational fillers: "you know", "I mean", "actually", "so", "well"\n';
    instructions += '- Take natural breaks in your speech - don\'t rush, speak at a comfortable human pace\n';
    instructions += '- Laugh or chuckle when something is funny or delightful\n';
    instructions += '- Show empathy and understanding when appropriate - adjust your tone to match the situation\n';
    // K12 tutors give lessons, not quick hints — skip the brevity cap for them.
    if (!conversation.k12ContentOnly) {
      instructions += '- Keep responses concise (2-4 sentences) but make every word count with personality\n';
    } else {
      instructions += '- Speak warmly and naturally, BUT for any academic/curriculum question give a complete, thorough lesson that covers every key point — the "speak naturally / keep it conversational" guidance above must NOT make you shorten or summarize academic answers. Keep greetings and small talk brief; make study explanations full and complete.\n';
    }
    instructions += '- Never use emojis or special characters - let your voice convey the emotion instead\n';
    instructions += '- If asked about products, share them enthusiastically like you\'re recommending to a friend\n';
    instructions += '\n\nVOICE INPUT QUALITY RULES:\n';
    instructions += '- Only respond to clear, intentional speech from the user directly speaking into their microphone\n';
    instructions += '- If you detect unclear, fragmented, or mixed speech with background noise, politely ask: "I didn\'t quite catch that. Could you repeat?"\n';
    instructions += '- Never respond to background voices, TV sounds, or distant speech - only direct user input\n';
    instructions += '- If the audio seems to be from your own previous response echoing back, completely ignore it\n';
    instructions += '- Wait for complete, coherent questions before answering - don\'t guess or fill in missing words\n';

    // Add currency information
    if (currency && currencySymbol) {
      instructions += `\n\nCURRENCY SETTINGS:\nAll prices should be referenced in ${currency} (${currencySymbol}). When discussing prices, always use ${currencySymbol} as the currency symbol.`;
    }

    // Load business context (FAQs, products, website analysis, training docs)
    try {
      const businessContext = await this.loadBusinessContext(businessAccountId);
      if (businessContext) {
        instructions += `\n\n${businessContext}`;
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error loading business context:', error);
    }

    // Auto-inject journey conversational guidelines if journey is active
    try {
      const activeJourneyState = await journeyService.getJourneyState(conversationId);
      if (activeJourneyState && !activeJourneyState.completed) {
        const journey = await storage.getJourney(activeJourneyState.journeyId, businessAccountId);
        if (journey && journey.conversationalGuidelines) {
          instructions += `\n\n🎯 JOURNEY-SPECIFIC CONVERSATIONAL GUIDELINES (HIGHEST PRIORITY - MUST FOLLOW):\n${journey.conversationalGuidelines}\n`;
          console.log('[RealtimeVoice] Injected journey conversational guidelines for journey:', journey.name);
        }
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error injecting journey guidelines:', error);
    }

    return instructions;
  }

  private async injectTextChatHistory(conversation: VoiceConversation): Promise<boolean> {
    if (!conversation.textConversationId || !conversation.openaiWs) {
      return false;
    }

    try {
      const textConversation = await storage.getConversation(
        conversation.textConversationId,
        conversation.businessAccountId
      );

      if (!textConversation) {
        console.warn('[RealtimeVoice] Text conversation not found or access denied:', conversation.textConversationId);
        conversation.textConversationId = undefined;
        return false;
      }

      const messages = await storage.getMessagesByConversation(
        conversation.textConversationId,
        conversation.businessAccountId
      );

      if (!messages || messages.length === 0) {
        console.log('[RealtimeVoice] No text chat history to inject');
        return false;
      }

      const recentMessages = messages.slice(-20);

      console.log(`[RealtimeVoice] Injecting ${recentMessages.length} text chat messages into voice session`);

      let injectedCount = 0;
      for (const msg of recentMessages) {
        if (!msg.content || msg.content.trim() === '') continue;

        // Text-chat answers embed curriculum images as Markdown, and voice's own
        // saved messages now do too. Handing those tags to a speaking model invites
        // it to read the URL out loud, so history goes in as words only.
        const historyText = this.stripMediaMarkdown(msg.content);
        if (!historyText) continue;

        const item: any = {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: [{
              type: msg.role === 'user' ? 'input_text' : 'output_text',
              text: historyText.substring(0, 2000)
            }]
          }
        };

        conversation.openaiWs!.send(JSON.stringify(item));
        injectedCount++;
      }

      console.log(`[RealtimeVoice] Text chat history injected successfully (${injectedCount} messages)`);
      if (injectedCount > 0) {
        conversation.textHistoryInjected = true;
      }
      return injectedCount > 0;
    } catch (error) {
      console.error('[RealtimeVoice] Error injecting text chat history:', error);
      conversation.textConversationId = undefined;
      return false;
    }
  }

  private async loadBusinessContext(businessAccountId: string): Promise<string> {
    let context = '';

    // Load FAQs
    try {
      const faqs = await storage.getAllFaqs(businessAccountId);
      if (faqs.length > 0) {
        context += `KNOWLEDGE BASE (FAQs):\nYou have complete knowledge of the following frequently asked questions. Answer these questions directly from your knowledge without mentioning FAQs:\n\n`;
        faqs.forEach((faq, index) => {
          context += `${index + 1}. Q: ${faq.question}\n   A: ${faq.answer}\n\n`;
        });
        context += `IMPORTANT: When customers ask questions related to the above topics, answer directly and naturally from your knowledge. DO NOT mention that you're checking FAQs - just provide the answer as if you know it by heart.\n\n`;
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error loading FAQs:', error);
    }

    // Load comprehensive product catalog (both Shopify and custom products)
    try {
      const products = await storage.getAllProducts(businessAccountId);
      
      // Get widget settings for currency symbol
      const widgetSettings = await storage.getWidgetSettings(businessAccountId);
      const currencySymbol = widgetSettings?.currency ? 
        (widgetSettings.currency === 'INR' ? '₹' : 
         widgetSettings.currency === 'EUR' ? '€' : 
         widgetSettings.currency === 'GBP' ? '£' : '$') : '$';
      
      if (products.length > 0) {
        context += `PRODUCT CATALOG:\nYou have complete knowledge of all ${products.length} products in the catalog. Use this information to intelligently recommend products based on customer requirements:\n\n`;
        
        products.forEach((product, index) => {
          context += `${index + 1}. ${product.name}`;
          
          // Add price information
          if (product.price) {
            context += ` - ${currencySymbol}${product.price}`;
          }
          
          // Add source information (Shopify or Custom)
          context += ` [Source: ${product.source === 'shopify' ? 'Shopify' : 'Custom'}]`;
          
          // Add full description
          if (product.description) {
            context += `\n   Description: ${product.description}`;
          }
          
          // Add image availability
          if (product.imageUrl) {
            context += `\n   Image: Available`;
          }
          
          context += `\n\n`;
        });
        
        context += `PRODUCT RECOMMENDATION GUIDELINES:\n`;
        context += `- When customers ask about products or their needs, analyze their requirements and suggest the most suitable products from the catalog above\n`;
        context += `- Consider price, description, and customer's specific needs when making recommendations\n`;
        context += `- You can recommend multiple products if they meet different aspects of the customer's requirements\n`;
        context += `- Be enthusiastic and natural when discussing products - you know them by heart\n`;
        context += `- Both Shopify products and custom products are equally valuable - recommend based on fit, not source\n\n`;
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error loading products:', error);
    }

    // Load website analysis (match text chat's full context)
    try {
      const { websiteAnalysisService } = await import("./websiteAnalysisService");
      const websiteContent = await websiteAnalysisService.getAnalyzedContent(businessAccountId);
      if (websiteContent) {
        context += `BUSINESS KNOWLEDGE (from website analysis):\nYou have comprehensive knowledge about this business extracted from their website.\n\n`;
        
        if (websiteContent.businessName) {
          context += `Business Name: ${websiteContent.businessName}\n\n`;
        }
        
        if (websiteContent.businessDescription) {
          context += `About: ${websiteContent.businessDescription}\n\n`;
        }
        
        if (websiteContent.targetAudience) {
          context += `Target Audience: ${websiteContent.targetAudience}\n\n`;
        }
        
        if (websiteContent.mainProducts && websiteContent.mainProducts.length > 0) {
          context += `Main Products:\n${websiteContent.mainProducts.map(p => `- ${p}`).join('\n')}\n\n`;
        }
        
        if (websiteContent.mainServices && websiteContent.mainServices.length > 0) {
          context += `Main Services:\n${websiteContent.mainServices.map(s => `- ${s}`).join('\n')}\n\n`;
        }
        
        if (websiteContent.keyFeatures && websiteContent.keyFeatures.length > 0) {
          context += `Key Features:\n${websiteContent.keyFeatures.map(f => `- ${f}`).join('\n')}\n\n`;
        }
        
        if (websiteContent.uniqueSellingPoints && websiteContent.uniqueSellingPoints.length > 0) {
          context += `Unique Selling Points:\n${websiteContent.uniqueSellingPoints.map(u => `- ${u}`).join('\n')}\n\n`;
        }
        
        if (websiteContent.contactInfo && (websiteContent.contactInfo.email || websiteContent.contactInfo.phone || websiteContent.contactInfo.address)) {
          context += `Contact Information:\n`;
          if (websiteContent.contactInfo.email) context += `- Email: ${websiteContent.contactInfo.email}\n`;
          if (websiteContent.contactInfo.phone) context += `- Phone: ${websiteContent.contactInfo.phone}\n`;
          if (websiteContent.contactInfo.address) context += `- Address: ${websiteContent.contactInfo.address}\n`;
          context += '\n';
        }
        
        if (websiteContent.businessHours) {
          context += `Business Hours: ${websiteContent.businessHours}\n\n`;
        }
        
        if (websiteContent.pricingInfo) {
          context += `Pricing: ${websiteContent.pricingInfo}\n\n`;
        }
        
        if (websiteContent.additionalInfo) {
          context += `Additional Information: ${websiteContent.additionalInfo}\n\n`;
        }
        
        context += `IMPORTANT: Use this website knowledge to provide accurate, context-aware responses about the business. Answer naturally without mentioning that you analyzed their website.\n\n`;
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error loading website analysis:', error);
    }

    // Load analyzed pages (limit to avoid token overflow)
    try {
      const analyzedPages = await storage.getAnalyzedPages(businessAccountId);
      if (analyzedPages && analyzedPages.length > 0) {
        const validPages = analyzedPages.filter(page => 
          page.extractedContent && 
          page.extractedContent.trim() !== '' && 
          page.extractedContent !== 'No relevant business information found on this page.'
        );
        
        if (validPages.length > 0) {
          context += `DETAILED WEBSITE CONTENT:\n`;
          // Limit to first 3 pages to avoid token overflow in voice mode
          const pagesToLoad = validPages.slice(0, 3);
          for (const page of pagesToLoad) {
            try {
              let pageName = 'Page';
              try {
                const url = new URL(page.pageUrl);
                const pathParts = url.pathname.split('/').filter(Boolean);
                pageName = pathParts[pathParts.length - 1] || 'Homepage';
              } catch {
                const pathParts = page.pageUrl.split('/').filter(Boolean);
                pageName = pathParts[pathParts.length - 1] || 'Homepage';
              }
              context += `--- ${pageName.toUpperCase()} ---\n${page.extractedContent}\n\n`;
            } catch (error) {
              console.error('[RealtimeVoice] Error processing page:', error);
            }
          }
        }
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error loading analyzed pages:', error);
    }

    // Load training documents
    try {
      const trainingDocs = await storage.getTrainingDocuments(businessAccountId);
      const completedDocs = trainingDocs.filter(doc => doc.uploadStatus === 'completed');
      if (completedDocs.length > 0) {
        context += `TRAINING DOCUMENTS KNOWLEDGE:\n`;
        for (const doc of completedDocs) {
          if (doc.summary || doc.keyPoints) {
            context += `--- ${doc.originalFilename} ---\n`;
            if (doc.summary) {
              context += `Summary: ${doc.summary}\n`;
            }
            if (doc.keyPoints) {
              try {
                const keyPoints = JSON.parse(doc.keyPoints);
                if (Array.isArray(keyPoints) && keyPoints.length > 0) {
                  context += `Key Points:\n`;
                  keyPoints.forEach((point: string, index: number) => {
                    context += `${index + 1}. ${point}\n`;
                  });
                }
              } catch (error) {
                console.error('[RealtimeVoice] Error parsing key points:', error);
              }
            }
            context += `\n`;
          }
        }
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error loading training documents:', error);
    }

    return context;
  }

  private async handleOpenAIMessage(conversationId: string, conversation: VoiceConversation, data: any) {
    try {
      const event = JSON.parse(data.toString());
      console.log('[RealtimeVoice] OpenAI event:', event.type);

      switch (event.type) {
        case 'session.created':
          console.log('[RealtimeVoice] Session created:', event.session.id);
          conversation.sessionId = event.session.id;
          break;

        case 'session.updated':
          console.log('[RealtimeVoice] Session updated');
          break;

        case 'input_audio_buffer.speech_started':
          console.log('[RealtimeVoice] User started speaking');
          this.touchActivity(conversation);
          
          // Cancel ongoing AI response if one is active (isProcessing check inside cancelResponse).
          // We must NOT send response.cancel when no response is active — doing so
          // causes OpenAI to return an error that corrupts the VAD state machine,
          // preventing speech_stopped from ever firing and leaving the session stuck.
          // respectGrace=true: ignore speech_started that lands in the first
          // BARGE_IN_GRACE_MS of the answer's audio — that's the AI's own opening
          // audio / mic echo, not a real interruption.
          this.cancelResponse(conversation, true);
          
          this.sendToClient(conversation.clientWs, { type: 'speech_started' });
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log('[RealtimeVoice] User stopped speaking');
          break;

        case 'input_audio_buffer.committed':
          console.log('[RealtimeVoice] Audio buffer committed');
          this.sendToClient(conversation.clientWs, { 
            type: 'transcript',
            text: '',
            isFinal: false
          });
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // User's speech transcribed
          const userTranscript = event.transcript;
          console.log('[RealtimeVoice] User transcript:', userTranscript);
          
          // Save user transcript to conversation
          conversation.currentUserTranscript = userTranscript;
          // Invalidate any in-flight K12 rewrite/retrieval for the PREVIOUS
          // utterance immediately — before any await — so a stale turn can
          // never inject its context or create a response after this point.
          conversation.k12TurnSeq = (conversation.k12TurnSeq ?? 0) + 1;
          
          this.sendToClient(conversation.clientWs, {
            type: 'transcript',
            text: userTranscript,
            isFinal: true
          });
          
          // GPT TRANSCRIPT CORRECTION: Run in background (non-blocking)
          // Always detect the language of THIS specific transcript, not the previously detected language.
          // This prevents English text from being "corrected" (translated) into Hindi when the user
          // switches languages mid-conversation.
          const thisTranscriptLang = this.detectLanguageFromText(userTranscript.trim());
          if (thisTranscriptLang.language !== 'en') {
            const correctionLang = conversation.selectedLanguage && conversation.selectedLanguage !== 'auto'
              ? conversation.selectedLanguage
              : thisTranscriptLang.language;
            this.correctTranscriptScript(userTranscript, correctionLang, conversation).catch(() => {});
          }
          
          // CRITICAL: Filter out very short/empty transcripts (likely background noise)
          // Only process transcripts with at least 2 meaningful characters
          const trimmedTranscript = userTranscript.trim();
          if (trimmedTranscript.length < 2) {
            console.log('[RealtimeVoice] Ignoring short/empty transcript (likely noise):', userTranscript);
            break; // Skip processing this noise
          }
          
          // AUTO LANGUAGE DETECTION: Detect language from transcribed text and update session
          if (!conversation.selectedLanguage || conversation.selectedLanguage === 'auto') {
            const detected = this.detectLanguageFromText(trimmedTranscript);
            if (detected.language !== conversation.detectedLanguage) {
              conversation.detectedLanguage = detected.language;
              console.log(`[RealtimeVoice] Language detected from transcript: ${detected.languageName} (${detected.language})`);
              
              // Rebuild instructions with detected language and send session.update
              // Also update input_audio_transcription with language hint for correct script
              const updatedInstructions = await this.buildSystemInstructions(conversation);
              if (conversation.openaiWs && conversation.openaiWs.readyState === WebSocket.OPEN) {
                conversation.openaiWs.send(JSON.stringify({
                  type: 'session.update',
                  session: {
                    type: 'realtime',
                    instructions: updatedInstructions,
                    audio: {
                      input: {
                        transcription: {
                          model: 'gpt-4o-mini-transcribe',
                          language: this.toTranscriptionLangCode(detected.language)
                        }
                      }
                    }
                  }
                }));
                console.log(`[RealtimeVoice] Session updated with detected language: ${detected.languageName} (transcription + instructions)`);
              }
            }
          }

          // Voice uses Realtime for speech-to-text only. The shared text-chat
          // pipeline authors and persists the completed canonical Markdown; TTS
          // is derived from that exact answer after it is ready for display.
          console.log('[RealtimeVoice] Canonical voice turn: generating ChatService Markdown before TTS');
          await this.generateCanonicalVoiceAnswer(conversation, trimmedTranscript);
          break;
          
          // Check if a journey should be activated or is already active
          // CRITICAL: Only process journey if explicitly triggered or already in progress for THIS conversation
          let journeyResult: any = null;
          if (conversation.conversationId && conversation.openaiWs?.readyState === WebSocket.OPEN) {
            journeyResult = await journeyOrchestrator.processUserMessage(
              conversation.conversationId,
              conversation.userId,
              conversation.businessAccountId,
              userTranscript
            );
            
            // CRITICAL: Only inject journey questions if:
            // 1. Journey was just triggered by keyword (wasTriggeredByKeyword === true), OR
            // 2. Journey is active for THIS specific conversation (not a stale journey from another session)
            // This prevents false triggers from old journey sessions in different conversations
            if (journeyResult.journeyResponse && !journeyResult.shouldContinueNormalFlow) {
              const isJourneyForThisConversation = journeyService.isJourneyForConversation(
                conversation.conversationId
              );
              
              if (!journeyResult.wasTriggeredByKeyword && !isJourneyForThisConversation) {
                console.log('[RealtimeVoice] Ignoring stale journey from different conversation - not injecting question');
                // Fall through to normal OpenAI response (don't inject journey question)
              } else {
                console.log('[RealtimeVoice] Journey active for THIS conversation - forcing AI to ask journey question:', journeyResult.journeyResponse);
              
              // SMART INTERRUPTION: Cancel any ongoing response BEFORE injecting journey prompts
              // This prevents the AI from continuing its previous response before the journey question
              if (conversation.isProcessing) {
                console.log('[RealtimeVoice] 🎯 Smart interruption: Cancelling active response before journey question');
                this.cancelResponse(conversation);
                conversation.isProcessing = false;
                
                // Add small delay to allow cancellation to complete
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              
              // CRITICAL FIX BUG 4: Track pending journey step ID (will be added to Map when response.created arrives)
              if (journeyResult.journeyStepId) {
                conversation.pendingJourneyStepId = journeyResult.journeyStepId;
                console.log('[RealtimeVoice] Set pending journey stepId:', journeyResult.journeyStepId, 'for next response.created event');
              } else {
                console.warn('[RealtimeVoice] Journey result missing stepId - cannot track properly!');
              }
              
              // Create a strong system-level instruction that the AI MUST follow
              // Use the SAME strong rephrasing instruction as text chat mode for consistency
              const journeyInstruction = {
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'system',
                  content: [
                    {
                      type: 'input_text',
                      text: `═══════════════════════════════════════════════════════════════
CRITICAL JOURNEY INSTRUCTION - HIGHEST PRIORITY - READ CAREFULLY
═══════════════════════════════════════════════════════════════

You are currently in a GUIDED CONVERSATION FLOW. This overrides your normal conversational behavior.

YOUR ONLY TASK RIGHT NOW:
Ask the user this question: "${journeyResult.journeyResponse}"

STRICT REQUIREMENTS:
1. ✓ Rephrase the question naturally to sound warm, friendly, and conversational
2. ✓ Keep it concise - ONLY ask this one question
3. ✗ Do NOT add any other information, explanations, or suggestions
4. ✗ Do NOT call any tools or functions
5. ✗ Do NOT provide product recommendations or capture leads

Remember: You're in a structured flow. Just ask the question naturally, then wait for their answer.
═══════════════════════════════════════════════════════════════`
                    }
                  ]
                }
              };
              
              conversation.openaiWs!.send(JSON.stringify(journeyInstruction));
              
              // Trigger response generation - AI will ask the journey question
              const responseCreate = {
                type: 'response.create',
                response: {
                  output_modalities: ['audio'],
                  instructions: `You MUST rephrase this question naturally and conversationally: "${journeyResult.journeyResponse}". Make it sound warm and friendly, but keep the same intent. Do NOT add any extra information - ONLY ask the rephrased question.`
                }
              };
              conversation.openaiWs!.send(JSON.stringify(responseCreate));
              
              console.log('[RealtimeVoice] Sent FORCED journey question to OpenAI');
              
              // Clear the keyword flag if this was triggered by keyword
              if (journeyResult.wasTriggeredByKeyword) {
                await journeyService.clearKeywordTriggerFlag(conversation.conversationId);
              }
              }
            } else {
              // No active journey - send normal response
              // SMART INTERRUPTION: Check if there's already an active response
              if (conversation.isProcessing) {
                console.log('[RealtimeVoice] 🎯 Smart interruption: Cancelling active response before creating new one');
                this.cancelResponse(conversation);
                conversation.isProcessing = false;
                
                // Add small delay to allow cancellation to complete
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              
              // No journey active - create normal response
              console.log('[RealtimeVoice] Creating normal OpenAI response (no active journey)');
              await this.sendNormalResponse(conversation);
            }
          } else {
            // CRITICAL FIX: If journey check couldn't be performed (conversationId missing or WebSocket not ready),
            // we still need to send a response! Otherwise AI will be silent.
            // SMART INTERRUPTION: Check if there's already an active response
            if (conversation.isProcessing) {
              console.log('[RealtimeVoice] 🎯 Smart interruption: Cancelling active response before creating new one');
              this.cancelResponse(conversation);
              conversation.isProcessing = false;
              
              // Add small delay to allow cancellation to complete
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Send normal response when journey check couldn't be performed
            console.log('[RealtimeVoice] Creating normal OpenAI response (journey check skipped)');
            if (conversation.openaiWs?.readyState === WebSocket.OPEN) {
              await this.sendNormalResponse(conversation);
            }
          }
          break;

        case 'response.created':
          // Realtime is intentionally transcription-only for normal voice
          // turns. An assistant response here would be authored by Realtime,
          // not by ChatService, and therefore cannot be the canonical Markdown
          // answer displayed by text chat. Reject it rather than allowing a
          // legacy transcript/display path to race the canonical turn.
          console.error('[RealtimeVoice] Rejected unexpected Realtime-authored response:', event.response?.id);
          if (conversation.openaiWs?.readyState === WebSocket.OPEN) {
            conversation.openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
          }
          break;

          console.log('[RealtimeVoice] Response created, id:', event.response?.id);
          conversation.isProcessing = true;
          conversation.currentAITranscript = '';
          conversation.pendingTextOutput = '';
          conversation.openaiAudioFallbackBuffer = [];
          // Reset incremental-TTS state for the new answer.
          conversation.textStreamMode = 'pending';
          conversation.streamedTextCursor = 0;
          conversation.k12TextFinalized = false;
          conversation.ttsTranscriptCursor = 0;
          // Track current response ID
          conversation.currentResponseId = event.response?.id;
          conversation.currentResponseKind = 'realtime';

          // Every response follows the same show-then-speak gate. A response
          // cannot expose raw streamed text or native audio before its complete
          // display version is prepared at response.done.
          conversation.holdSpeechResponseId = conversation.currentResponseId;
          console.log('[RealtimeVoice] Show-then-speak hold bound to response:', conversation.currentResponseId);

          // Bind (or discard) curriculum images to the response that will speak
          // them. Images retrieved for a turn the student interrupted must not
          // ride along on whatever they ask next.
          if (conversation.pendingCurriculumMedia?.length) {
            if (conversation.pendingCurriculumMediaResponseId == null) {
              conversation.pendingCurriculumMediaResponseId = conversation.currentResponseId ?? null;
            } else if (conversation.pendingCurriculumMediaResponseId !== conversation.currentResponseId) {
              conversation.pendingCurriculumMedia = undefined;
              conversation.pendingCurriculumMediaResponseId = undefined;
            }
          }

          // Tell the client which OpenAI responseId is about to start, so it can
          // map this to the local message bubble it creates on the first ai_chunk.
          // Used by the formatted_transcript event to find the correct bubble.
          if (conversation.currentResponseId) {
            this.sendToClient(conversation.clientWs, {
              type: 'voice_message_start',
              responseId: conversation.currentResponseId
            });
          }
          
          // CRITICAL FIX BUG 4: If we have a pending journey step ID, add it to the Map keyed by stepId
          const legacyResponseId = conversation.currentResponseId;
          const legacyStepId = conversation.pendingJourneyStepId;
          if (legacyStepId && legacyResponseId) {
            // We need the original question text for logging - get it from journeyResult
            const stepId = legacyStepId as string;
            conversation.journeyResponseTracking.set(stepId, {
              original: '', // Will be set in response.done when we have the full transcript
              responseId: legacyResponseId as string,
              timestamp: Date.now()
            });
            console.log('[RealtimeVoice] Tracked journey by STEP ID:', stepId, 'responseId:', legacyResponseId);
            conversation.pendingJourneyStepId = undefined; // Clear pending
          }
          break;

        case 'response.output_item.added':
          console.log('[RealtimeVoice] Output item added');
          break;

        case 'response.content_part.added':
          console.log('[RealtimeVoice] Content part added');
          break;

        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta':
          if (!this.isCurrentResponseEvent(conversation, event)) {
            console.log('[RealtimeVoice] Ignoring transcript delta for superseded response:', event.response_id);
            break;
          }
          // AI's speech transcript chunk
          const transcriptDelta = event.delta;
          console.log('[RealtimeVoice] AI transcript delta:', transcriptDelta);
          
          // Accumulate AI transcript (we still keep the partial in case we need to
          // save it for the cancelled response — the user heard part of it).
          conversation.currentAITranscript = (conversation.currentAITranscript || '') + transcriptDelta;

          // Suppress forwarding for cancelled responses — OpenAI keeps emitting
          // a few late deltas after response.cancel, and forwarding them would
          // create a phantom second bubble in the client.
          if (conversation.currentResponseId &&
              conversation.cancelledResponseIds.has(conversation.currentResponseId)) {
            break;
          }

          // SHOW-THEN-SPEAK: for a held answer, nothing is shown or
          // spoken incrementally — the finalized content lands first at
          // response.done, then speech starts. The transcript still accumulated
          // above, so the release path has the full answer.
          if (this.isSpeechHeld(conversation)) {
            break;
          }

          this.sendToClient(conversation.clientWs, {
            type: 'ai_chunk',
            text: transcriptDelta,
            // Stamp every chunk with its responseId so the client can bind a
            // bubble to a specific response without relying on a separate
            // pending-ref (which races on rapid back-to-back turns).
            responseId: conversation.currentResponseId
          });

          // INCREMENTAL VOICE (audio modality): when ElevenLabs is the active
          // voice, OpenAI's own audio is suppressed (see audio.delta handler)
          // and we re-speak the transcript through ElevenLabs. Instead of
          // waiting for the WHOLE transcript at .done, queue each complete
          // sentence for synthesis the moment it lands, so the student hears
          // the answer begin almost immediately.
          if (conversation.elevenlabsApiKey && conversation.elevenlabsVoiceId) {
            this.streamTranscriptTts(conversation, false);
          }
          break;

        case 'response.output_text.delta':
        case 'response.text.delta': {
          if (!this.isCurrentResponseEvent(conversation, event)) {
            console.log('[RealtimeVoice] Ignoring text delta for superseded response:', event.response_id);
            break;
          }
          // SILENCE BREAKER: the model answered in TEXT modality (no audio).
          // Without this handler the deltas fall through to "Unknown event type"
          // and the visitor hears (and sees) nothing.
          const textDelta = event.delta || '';
          if (!textDelta) break;

          // K12 CONTENT-ONLY: stream the answer sentence-by-sentence so the
          // student hears it almost immediately instead of waiting for the whole
          // reply. We still accumulate the full text in pendingTextOutput (for the
          // DB save + done-time validation). On the FIRST delta we decide:
          //  - starts with '{' or '[' → could be a leaked tool-call payload
          //    (e.g. {"query":"proteins"}); fall back to buffer-until-done and
          //    validate the whole thing before it's ever spoken.
          //  - otherwise → stream complete sentences as they arrive.
          // The non-K12 path is intentionally LEFT UNCHANGED below.
          if (conversation.k12ContentOnly) {
            conversation.pendingTextOutput = (conversation.pendingTextOutput || '') + textDelta;
            if (!conversation.textStreamMode || conversation.textStreamMode === 'pending') {
              const trimmedSoFar = (conversation.pendingTextOutput || '').replace(/^\s+/, '');
              if (trimmedSoFar.length > 0) {
                const first = trimmedSoFar[0];
                conversation.textStreamMode = (first === '{' || first === '[') ? 'buffer' : 'stream';
              }
            }
            if (conversation.textStreamMode === 'stream') {
              this.emitReadyK12Text(conversation, false);
            }
            break;
          }

          console.log('[RealtimeVoice] AI text delta (text-modality turn):', textDelta);
          conversation.currentAITranscript = (conversation.currentAITranscript || '') + textDelta;
          if (conversation.currentResponseId &&
              conversation.cancelledResponseIds.has(conversation.currentResponseId)) {
            break;
          }
          if (this.isSpeechHeld(conversation)) {
            break;
          }
          this.sendToClient(conversation.clientWs, {
            type: 'ai_chunk',
            text: textDelta,
            responseId: conversation.currentResponseId
          });
          break;
        }

        case 'response.output_text.done':
        case 'response.text.done': {
          if (!this.isCurrentResponseEvent(conversation, event)) {
            console.log('[RealtimeVoice] Ignoring text completion for superseded response:', event.response_id);
            break;
          }
          // A held non-K12 response releases once at response.done; do not
          // synthesize it here or it would speak before its display is ready.
          if (!conversation.k12ContentOnly) {
            console.log('[RealtimeVoice] AI text output complete (text-modality turn)');
            if (!this.isSpeechHeld(conversation) &&
                conversation.elevenlabsApiKey && conversation.elevenlabsVoiceId && conversation.currentAITranscript &&
                conversation.lastSynthesizedResponseId !== conversation.currentResponseId) {
              conversation.lastSynthesizedResponseId = conversation.currentResponseId;
              await this.synthesizeWithElevenLabs(conversation, conversation.currentAITranscript);
            }
            if (!this.isSpeechHeld(conversation)) {
              conversation.openaiAudioFallbackBuffer = [];
            }
            break;
          }

          // K12 content-only: finalize the streamed/buffered text. In 'stream'
          // mode the sentences were already forwarded and spoken during the
          // deltas; this flushes the trailing partial sentence. In 'buffer' mode
          // (reply started like JSON) it validates the whole reply and drops a
          // leaked tool-call payload before anything is spoken.
          console.log('[RealtimeVoice] AI text output complete (K12 text-modality turn)');
          this.finalizeK12TextOutput(conversation);
          if (!this.isSpeechHeld(conversation)) {
            conversation.openaiAudioFallbackBuffer = [];
          }
          break;
        }

        case 'response.output_audio.delta':
        case 'response.audio.delta':
          if (!this.isCurrentResponseEvent(conversation, event)) {
            console.log('[RealtimeVoice] Ignoring audio delta for superseded response:', event.response_id);
            break;
          }
          this.touchActivity(conversation);
          const audioDelta = event.delta;
          const audioBuffer = Buffer.from(audioDelta, 'base64');
          
          if ((conversation.elevenlabsApiKey && conversation.elevenlabsVoiceId) || this.isSpeechHeld(conversation)) {
            if (!conversation.openaiAudioFallbackBuffer) {
              conversation.openaiAudioFallbackBuffer = [];
            }
            conversation.openaiAudioFallbackBuffer.push(audioBuffer);
            break;
          }
          
          if (conversation.clientWs.readyState === WebSocket.OPEN) {
            conversation.clientWs.send(audioBuffer);
          }
          break;

        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          if (!this.isCurrentResponseEvent(conversation, event)) {
            console.log('[RealtimeVoice] Ignoring transcript completion for superseded response:', event.response_id);
            break;
          }
          console.log('[RealtimeVoice] AI transcript complete');
          // Sentences were already streamed to ElevenLabs during the deltas
          // (see transcript.delta handler). Flush the trailing partial sentence
          // — unless the user barged in, in which case keep only what was spoken.
          if (conversation.elevenlabsApiKey && conversation.elevenlabsVoiceId && conversation.currentAITranscript &&
              !this.isSpeechHeld(conversation) &&
              conversation.lastSynthesizedResponseId !== conversation.currentResponseId) {
            conversation.lastSynthesizedResponseId = conversation.currentResponseId;
            const cancelled = !!(conversation.currentResponseId &&
              conversation.cancelledResponseIds.has(conversation.currentResponseId));
            if (!cancelled) {
              this.streamTranscriptTts(conversation, true);
            }
          }
          if (!this.isSpeechHeld(conversation)) {
            conversation.openaiAudioFallbackBuffer = [];
          }
          break;

        case 'response.output_audio.done':
        case 'response.audio.done':
          console.log('[RealtimeVoice] AI audio complete');
          break;

        case 'response.function_call_arguments.done':
          // AI wants to call a tool (lead capture, appointments, etc.)
          await this.handleToolCall(event, conversation);
          break;

        case 'response.done': {
          const completedResponseId = event.response?.id;
          if (completedResponseId && conversation.currentResponseId &&
              completedResponseId !== conversation.currentResponseId) {
            console.log('[RealtimeVoice] Ignoring completion for superseded response:', completedResponseId);
            break;
          }
          console.log('[RealtimeVoice] Response complete, id:', completedResponseId || conversation.currentResponseId);
          conversation.isProcessing = false;

          // Realtime bills audio tokens at ~17x the text rate, so record the
          // per-modality breakdown OpenAI returns rather than a flat total.
          // Fire-and-forget: usage accounting must never block or break a turn.
          const realtimeUsage = aiUsageLogger.extractRealtimeUsage(event.response?.usage);
          if (realtimeUsage) {
            if (!realtimeUsageShapeLogged) {
              realtimeUsageShapeLogged = true;
              console.log('[RealtimeVoice] Realtime usage payload:', JSON.stringify(event.response?.usage));
            }
            const { tokensInput, tokensOutput, ...breakdown } = realtimeUsage;
            void aiUsageLogger.logVoiceModeUsage(
              conversation.businessAccountId,
              REALTIME_MODEL,
              tokensInput,
              tokensOutput,
              {
                feature: 'realtime_session',
                conversationId: conversation.conversationId,
                // Attribute to the response this event is actually for. A late
                // done for a cancelled response must not be filed under the
                // response that has since replaced it.
                responseId: event.response?.id ?? conversation.currentResponseId,
              },
              breakdown,
            ).catch((err) =>
              console.warn('[RealtimeVoice] Usage logging failed:', (err as Error).message)
            );
          } else if (event.response?.usage) {
            console.warn(
              '[RealtimeVoice] Unrecognized usage payload on response.done:',
              JSON.stringify(event.response.usage).slice(0, 300)
            );
          }

          // SAFETY NET (K12 only): if .text.done never arrived before
          // response.done, finalize here so a legitimate answer isn't lost. This
          // is idempotent — finalize() no-ops if .text.done already ran.
          if (conversation.k12ContentOnly && !conversation.k12TextFinalized) {
            this.finalizeK12TextOutput(conversation);
          }

          // Save complete AI response to database and conversation memory.
          // Snapshot the per-response state BEFORE the first await below: a
          // back-to-back turn's response.created resets currentAITranscript /
          // currentResponseId, and this handler must keep operating on ITS
          // response, not whatever replaced it mid-await.
          const doneTranscript = conversation.currentAITranscript;
          const doneResponseId = completedResponseId || conversation.currentResponseId;
          const wasCancelled = !!doneResponseId && conversation.cancelledResponseIds.has(doneResponseId);

          // Native OpenAI audio cannot be made display-safe without its matching
          // transcript. Do not play an answer the student cannot also read; end
          // the turn cleanly instead of leaking a raw/no-bubble response.
          if (!doneTranscript) {
            if ((conversation.openaiAudioFallbackBuffer?.length || 0) > 0) {
              console.warn('[RealtimeVoice] Discarding buffered audio without a transcript, responseId:', doneResponseId);
            }
            conversation.openaiAudioFallbackBuffer = [];
          }

          // An interrupted response may have produced more server-side deltas
          // than reached the student. Do not preserve it as a complete answer in
          // memory or history, and never release it after the formatter awaits.
          if (wasCancelled) {
            conversation.openaiAudioFallbackBuffer = [];
            console.log('[RealtimeVoice] Skipping persistence and release for cancelled response:', doneResponseId);
          } else if (conversation.conversationId && doneTranscript) {
            // Curriculum diagrams retrieved for this turn. They were kept out of
            // everything the model saw, so the spoken answer is identical whether or
            // not a diagram exists. They are only CANDIDATES here — nothing is shown
            // until the formatter pass below decides the answer actually taught one.
            // Skipped for an interrupted answer, which isn't a real reply.
            const mediaResponseId = doneResponseId;
            const mediaCancelled = !!(mediaResponseId && conversation.cancelledResponseIds.has(mediaResponseId));
            // Only consume images that were bound to THIS response. Anything still
            // awaiting a binding belongs to a later answer (e.g. a tool call whose
            // reply has not been generated yet) and must be left alone.
            const mediaIsForThisResponse =
              !!conversation.pendingCurriculumMedia?.length &&
              conversation.pendingCurriculumMediaResponseId === mediaResponseId;
            const curriculumMedia = (!mediaCancelled && mediaIsForThisResponse)
              ? conversation.pendingCurriculumMedia!
              : [];
            if (mediaIsForThisResponse) {
              conversation.pendingCurriculumMedia = undefined;
              conversation.pendingCurriculumMediaResponseId = undefined;
            }

            // Display pass: fire-and-forget background call that decides what the
            // student SEES for this answer — proper Markdown + LaTeX for math and
            // science, and which curriculum diagrams (at most two, only when the
            // answer actually taught them) belong inline. Audio playback is
            // unaffected; only the on-screen bubble is updated. This is the only
            // route a diagram can reach the screen, so if it fails or times out the
            // student simply sees the spoken answer with no diagrams.
            const transcriptSnapshot = doneTranscript;
            const responseIdSnapshot = doneResponseId;
            const conversationIdSnapshot = conversation.conversationId;
            const businessAccountIdSnapshot = conversation.businessAccountId;
            const apiKeySnapshot = conversation.openaiApiKey;
            const clientWsSnapshot = conversation.clientWs;
            const diagramCandidates = curriculumMedia;
            // Every response is held, so this legacy asynchronous branch is not
            // expected to run. Keep its variable explicit while retaining the
            // defensive fallback path for an unexpected provider event.
            const savedMessageId: string | undefined = undefined;
            // Skip the display pass for cancelled responses — the user
            // interrupted, so the partial transcript isn't a real "answer".
            // Saves a gpt-4o-mini call AND prevents the client from rendering
            // a phantom formatted bubble for content the user cut off.
            // SHOW-THEN-SPEAK: a held answer was neither shown nor
            // spoken during streaming. Release it now: format FIRST (bounded by
            // the formatter's own timeout), push the finalized content to the
            // screen, THEN start speech. Awaited so isTtsProducing() is already
            // true when the ai_done deferral check below runs.
            // The hold stays SET during the release await: cancelResponse uses
            // holdSpeechResponseId to mark a mid-release barge-in cancelled, and
            // releaseHeldAnswer's abandoned() checks pick that up after every await.
            const wasHeld = !!responseIdSnapshot && conversation.holdSpeechResponseId === responseIdSnapshot;
            if (wasHeld) {
              if (!wasCancelled) {
                await this.releaseHeldAnswer(conversation, transcriptSnapshot, responseIdSnapshot!, curriculumMedia);
              }
              if (conversation.holdSpeechResponseId === responseIdSnapshot) {
                conversation.holdSpeechResponseId = undefined;
              }
            }
            if (!wasHeld && responseIdSnapshot && apiKeySnapshot) {
              (async () => {
                try {
                  const result = await formatVoiceTranscript(
                    transcriptSnapshot,
                    apiKeySnapshot,
                    businessAccountIdSnapshot,
                    conversationIdSnapshot,
                    diagramCandidates
                  );
                  // No formatted variant means there was nothing worth replacing
                  // the spoken transcript with — and, critically, no diagram
                  // earned its place. Fail closed: show the answer as spoken.
                  if (!result || !result.formattedMarkdown) {
                    return;
                  }
                  console.log(
                    `[RealtimeVoice] Display pass chose ${result.imageUrls?.length ?? 0} of ${diagramCandidates.length} diagram(s) for responseId:`,
                    responseIdSnapshot
                  );
                  // Persist the display variant on the message row — this is what
                  // history replays, so it must land BEFORE the live bubble is
                  // patched. If it fails, the student keeps the plain spoken
                  // answer on screen, which is exactly what a reload would show:
                  // better than diagrams that vanish the next time they open it.
                  if (savedMessageId) {
                    try {
                      await storage.updateMessageMetadata(savedMessageId, {
                        formattedContent: result.formattedMarkdown,
                        formatSubject: result.subject
                      });
                    } catch (err) {
                      console.warn('[RealtimeVoice] Could not persist formatted content, leaving the spoken answer on screen so it matches a reload:', (err as Error).message);
                      return;
                    }
                  }
                  // Push to live client if still connected
                  if (clientWsSnapshot && clientWsSnapshot.readyState === WebSocket.OPEN) {
                    this.sendToClient(clientWsSnapshot, {
                      type: 'formatted_transcript',
                      responseId: responseIdSnapshot,
                      messageId: savedMessageId,
                      subject: result.subject,
                      formattedMarkdown: result.formattedMarkdown
                    });
                    console.log('[RealtimeVoice] Sent formatted_transcript for', result.subject, 'responseId:', responseIdSnapshot);
                  }
                } catch (err) {
                  console.warn('[RealtimeVoice] Formatter pipeline failed:', (err as Error).message);
                }
              })();
            }
            
            // CRITICAL FIX BUG 4: Check Map for journey response tracking by stepId
            // This prevents race conditions when multiple journey prompts are triggered rapidly
            // Find stepId by matching responseId
            let foundStepId: string | null = null;
            conversation.journeyResponseTracking.forEach((journeyData, stepId) => {
              if (journeyData.responseId === doneResponseId) {
                foundStepId = stepId;
              }
            });
            
            if (foundStepId) {
              const rephrasedQuestion = doneTranscript.trim();
              console.log('[RealtimeVoice] ✅ Journey question persisted to chat history (stepId:', foundStepId, ')');
              console.log('[RealtimeVoice]    OpenAI responseId:', conversation.currentResponseId);
              console.log('[RealtimeVoice]    AI-rephrased:', rephrasedQuestion);
              console.log('[RealtimeVoice]    This ensures analytics/chat history show refined text instead of raw template');
              
              // Clear this specific journey step from Map (per-step cleanup)
              conversation.journeyResponseTracking.delete(foundStepId);
              console.log('[RealtimeVoice] Cleared journey tracking for stepId:', foundStepId);
            }
          }
          
          // ElevenLabs path: TTS audio for THIS response may still be in
          // production at response.done — either sentences queued/draining or
          // a direct whole-transcript synth streaming. Sending ai_done now
          // would let the client finalize the bubble (and its spoken-text
          // highlight) on drain, then receive late PCM for the same response.
          // Defer until every producer is idle; the producers' completion
          // paths call flushDeferredAiDone().
          // Ownership guard: everything above may have awaited (DB save, held
          // release). If a NEWER response now owns the conversation, this stale
          // done handler must not defer or send an ai_done — the client would
          // finalize the new turn's bubble early. The newer response's own
          // response.done will handle its ai_done.
          if (doneResponseId && conversation.currentResponseId &&
              conversation.currentResponseId !== doneResponseId) {
            console.log('[RealtimeVoice] Skipping ai_done for superseded response:', doneResponseId);
            break;
          }
          if (conversation.elevenlabsApiKey && conversation.elevenlabsVoiceId &&
              this.isTtsProducing(conversation)) {
            conversation.pendingAiDoneResponseId = doneResponseId || 'unknown';
            console.log('[RealtimeVoice] Deferring ai_done until ElevenLabs TTS producers finish');
          } else {
            this.sendToClient(conversation.clientWs, { type: 'ai_done', responseId: doneResponseId });
          }
          break;
        }

        case 'rate_limits.updated':
          // Rate limit info - can be logged if needed
          break;

        case 'error':
          // CRITICAL FIX: Ignore harmless race condition where response finishes before cancellation
          // This happens when AI completes speaking just as user starts interrupting
          if (event.error?.code === 'response_cancel_not_active') {
            console.log('[RealtimeVoice] ℹ️  Response already completed before cancellation (harmless)');
            break; // Don't send to client - this is not an actual error
          }
          
          console.error('[RealtimeVoice] OpenAI error:', event.error);
          this.sendError(conversation.clientWs, event.error.message || 'Voice processing error');
          break;

        default:
          // Log unknown events for debugging
          console.log('[RealtimeVoice] Unknown event type:', event.type);
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error handling OpenAI message:', error);
    }
  }

  // Helper method to save messages to database
  private async saveMessageToDB(conversationId: string, role: 'user' | 'assistant', content: string): Promise<string | undefined> {
    try {
      const created = await storage.createMessage({
        conversationId,
        role,
        content
      });

      // Update conversation timestamp
      await storage.updateConversationTimestamp(conversationId);
      return created?.id;
    } catch (error) {
      console.error('[RealtimeVoice] Error saving message to DB:', error);
      return undefined;
    }
  }

  // Convert aiTools to OpenAI Realtime API format
  private convertToRealtimeTools(tools: any[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
    }));
  }

  /**
   * Decide whether a user's spoken turn should force the curriculum lookup
   * (fetch_k12_topic) in content-only K12 mode. This is DEFAULT-FORCE with
   * narrow exclusions — we ground EVERY substantive turn in the curriculum and
   * only skip clearly non-academic turns. This mirrors the text-chat path, which
   * forces fetch_k12_topic for nearly every non-greeting turn. We deliberately do
   * NOT use a positive academic-keyword allowlist: it silently missed natural
   * phrasings like "tell me about proteins" and bypassed RAG. The order is:
   *   1. too-short (< 3 chars)                      -> never force
   *   2. exact-match small talk                     -> never force
   *   3. presence checks / greeting-only utterances -> never force
   *   4. lead-capture / contact-info turns          -> never force (capture_lead)
   *   5. operational intents (booking, pricing,
   *      support, location, timings, …)             -> never force
   *   6. everything else                            -> FORCE the curriculum lookup
   * Journey turns never reach this helper: while a journey is active the caller
   * sends its own forced journey question instead of a normal response, so guided
   * flows are already unaffected.
   */
  private shouldForceK12Fetch(transcript?: string): boolean {
    const raw = (transcript || '').trim();
    const msg = raw.toLowerCase().replace(/[!.?,]+$/g, '').trim();
    if (msg.length < 3) return false;
    if (RealtimeVoiceService.SMALL_TALK.has(msg)) return false;
    if (this.looksLikePresenceOrGreeting(msg)) return false;
    if (this.looksLikeContactInfo(raw)) return false;
    if (this.looksLikeOperationalIntent(msg)) return false;
    // Default-force: any remaining substantive turn grounds in the curriculum,
    // mirroring the text-chat path (which forces fetch_k12_topic for every
    // non-greeting turn and passes the raw message as the query). We do NOT use a
    // positive academic-keyword allowlist — it missed natural phrasings like
    // "tell me about proteins" and silently bypassed RAG.
    return true;
  }

  private static readonly SMALL_TALK = new Set<string>([
    'hi', 'hii', 'hiii', 'hey', 'heyy', 'heyyy', 'hello', 'helo', 'yo', 'sup',
    'hi there', 'hello there', 'hey there', 'good morning', 'good afternoon',
    'good evening', 'how are you', 'how r u', 'whats up', "what's up",
    'thanks', 'thank you', 'thank you so much', 'thx', 'ty', 'ok', 'okay', 'okk',
    'cool', 'great', 'nice', 'got it', 'alright', 'bye', 'goodbye', 'see you',
    'yes', 'no', 'yeah', 'yep', 'nope', 'sure'
  ]);

  /**
   * Heuristic: does this turn look like the visitor sharing (or offering) their
   * contact details — i.e. a lead-capture turn rather than an academic question?
   * Catches written emails, phone-number-like digit runs, and explicit
   * "my name/number/email is …" style intros.
   */
  private looksLikeContactInfo(text: string): boolean {
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return true; // email address
    const digits = text.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15 && /\d[\d\s().+-]{5,}\d/.test(text)) return true; // phone-like run
    const t = text.toLowerCase();
    if (/\b(my name is|i am called|i'?m called|call me at|call me on|my mobile|my phone|my number|my contact|my email|my mail|reach me|contact me)\b/.test(t)) return true;
    return false;
  }

  /**
   * Heuristic: non-academic operational/business intents (appointments, pricing,
   * payments, support, location/timings). These must route normally so the model
   * can use the appropriate tool (or answer conversationally) instead of being
   * forced into a curriculum lookup. Checked BEFORE academic intent so phrases
   * like "how much does it cost" / "what are your timings" are treated as
   * operational despite containing question words.
   */
  private looksLikeOperationalIntent(msg: string): boolean {
    return /\b(appointment|book a|booking|re-?schedul|cancel (my|the)|slot|demo|how much|price|pricing|cost|costs?|fees?|charges?|payment|pay (for|now)|buy |purchase|order|discount|offer|refund|invoice|subscription|location|address|timings?|opening hours|business hours|talk to|speak to|human|agent|representative|customer (care|support)|support team|complaint)\b/.test(msg);
  }

  /**
   * Heuristic: presence checks and greeting-only utterances that the exact-match
   * SMALL_TALK set misses because of internal punctuation or word repetition
   * (e.g. "are you there?", "can you hear me?", "hey, hi", "hi hello there").
   * These are conversational, not academic, so they must NOT force a curriculum
   * lookup — the model answers them normally.
   */
  private looksLikePresenceOrGreeting(msg: string): boolean {
    // Normalize internal punctuation/whitespace so "hey, hi" -> "hey hi".
    const m = msg.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!m) return true;
    // Presence / can-you-hear-me checks.
    if (/^(are you (there|here|listening|online|present|awake)|can you hear me|do you hear me|you there|still there|are you online|is anyone there|hello are you there)\b/.test(m)) return true;
    // "how are you", "how's it going" style social openers.
    if (/^(how are you|how r u|how are u|how s it going|hows it going|whats up|what s up|how do you do)\b/.test(m)) return true;
    // Greeting-only utterances (possibly combined/repeated): "hey hi", "hi hello there".
    const greetingWords = new Set([
      'hi', 'hii', 'hiii', 'hey', 'heyy', 'heyyy', 'hello', 'helo', 'yo', 'sup',
      'hiya', 'howdy', 'there', 'good', 'morning', 'afternoon', 'evening', 'day',
      'namaste', 'hola', 'greetings'
    ]);
    const tokens = m.split(' ');
    if (tokens.length <= 4 && tokens.every(t => greetingWords.has(t))) return true;
    return false;
  }

  /**
   * Generate the voice turn through the same authoritative completed-answer
   * pipeline used by text chat. Realtime remains the STT transport only.
   */
  private async generateCanonicalVoiceAnswer(
    conversation: VoiceConversation,
    userTranscript: string,
  ): Promise<void> {
    const responseId = `voice_${conversation.conversationId}_${conversation.k12TurnSeq ?? Date.now()}`;
    const turnSeq = conversation.k12TurnSeq ?? 0;
    let persistedMessageId: string | null = null;
    let persistedContent = '';

    conversation.currentResponseId = responseId;
    conversation.currentResponseKind = 'canonical';
    conversation.currentAITranscript = '';
    conversation.isProcessing = true;
    this.sendToClient(conversation.clientWs, { type: 'thinking' });
    this.sendToClient(conversation.clientWs, { type: 'voice_message_start', responseId });

    const abandoned = () =>
      conversation.cancelledResponseIds.has(responseId) ||
      conversation.currentResponseId !== responseId ||
      conversation.currentResponseKind !== 'canonical' ||
      (conversation.k12TurnSeq ?? 0) !== turnSeq;

    const scope = conversation.topscholarScope;
    const topScholar = isTopscholarAccount(conversation.businessAccountId);
    const chatContext: ChatContext = {
      userId: conversation.userId,
      businessAccountId: conversation.businessAccountId,
      existingConversationId: conversation.conversationId,
      personality: conversation.personality,
      responseLength: conversation.responseLength,
      companyDescription: conversation.companyDescription,
      openaiApiKey: conversation.openaiApiKey,
      currency: conversation.currency,
      currencySymbol: conversation.currencySymbol,
      customInstructions: conversation.customInstructions,
      preferredLanguage: conversation.selectedLanguage || conversation.detectedLanguage,
      visitorToken: conversation.userId,
      isInternalTest: conversation.isInternalTest,
      supportsCalendarUI: false,
      channel: 'widget',
      systemMode: conversation.systemMode,
      k12EducationEnabled: conversation.k12EducationEnabled === true || topScholar,
      k12ContentOnlyMode: conversation.k12ContentOnly === true,
      k12VerbatimContentMode: conversation.k12VerbatimContentMode === true,
      jobPortalEnabled: conversation.jobPortalEnabled === true,
      demoOrdersEnabled: conversation.demoOrdersEnabled === true,
      skipLeadTraining: conversation.skipLeadTraining === true,
      topscholarCpId: scope?.cpId ?? null,
      topscholarStudentId: scope?.studentId ?? null,
      studentName: scope?.studentName ?? null,
      topscholarCpIds: conversation.topscholarCpIds,
      topscholarDoubtId: conversation.topscholarDoubtId ?? null,
      topscholarStudentPlanMappingId: scope?.studentPlanMappingId ?? null,
      topscholarPlanId: scope?.planId ?? null,
      topscholarDoubtSyncBaseUrl: scope?.doubtSyncBaseUrl ?? null,
      studentBoard: scope?.board ?? null,
      studentMedium: scope?.medium ?? null,
      studentGrade: scope?.grade ?? null,
      studentSubject: scope?.subject ?? null,
      studentChapter: conversation.topscholarChapter ?? scope?.chapter ?? null,
      topscholarSubjectScoping: topScholar,
      deferAssistantPersistence: true,
    };

    try {
      let streamedMarkdown = '';
      let finalMarkdown = '';
      for await (const event of chatService.streamMessage(userTranscript, chatContext)) {
        if (abandoned()) return;
        if (event.type === 'content' && typeof event.data === 'string') {
          streamedMarkdown += event.data;
        } else if (event.type === 'final' && typeof event.data === 'string' && event.data.trim()) {
          finalMarkdown = event.data;
        }
      }
      if (abandoned()) return;

      const displayMarkdown = (finalMarkdown || streamedMarkdown).trim();
      if (!displayMarkdown) {
        throw new Error('Canonical chat pipeline returned an empty answer');
      }

      const speechText = await createVoiceSpeechText(
        displayMarkdown,
        conversation.openaiApiKey,
        conversation.businessAccountId,
        conversation.conversationId,
      );
      if (abandoned()) return;

      persistedContent = displayMarkdown;
      persistedMessageId = await chatService.commitDeferredAssistantMessage(
        chatContext,
        displayMarkdown,
        () => !abandoned(),
      );
      if (!persistedMessageId) {
        if (abandoned()) return;
        throw new Error('Canonical assistant answer could not be persisted');
      }
      conversation.canonicalPersistedMessageId = persistedMessageId;
      conversation.canonicalPersistedResponseId = responseId;
      conversation.canonicalPersistedContent = displayMarkdown;
      if (abandoned()) {
        await chatService.rollbackDeferredAssistantMessage(
          chatContext,
          persistedMessageId,
          displayMarkdown,
        );
        persistedMessageId = null;
        conversation.canonicalPersistedMessageId = undefined;
        conversation.canonicalPersistedResponseId = undefined;
        conversation.canonicalPersistedContent = undefined;
        return;
      }

      conversation.currentAITranscript = speechText;
      // WebSocket frame ordering is the show-before-speak gate: this complete
      // display contract is enqueued before either TTS provider can emit PCM.
      conversation.canonicalDisplayReadyResponseId = responseId;
      this.sendToClient(conversation.clientWs, {
        type: 'answer_ready',
        responseId,
        displayMarkdown,
        speechText,
      });

      if (speechText) {
        if (conversation.elevenlabsApiKey && conversation.elevenlabsVoiceId) {
          await this.synthesizeWithElevenLabs(conversation, speechText);
        } else {
          await this.synthesizeWithOpenAI(conversation, speechText, responseId);
        }
      }
      if (abandoned()) return;

      conversation.isProcessing = false;
      // Keep response ownership and the rollback handle until the browser says
      // its scheduled PCM has actually finished playing.
      this.sendToClient(conversation.clientWs, { type: 'ai_done', responseId });
    } catch (error) {
      if (abandoned()) return;
      if (persistedMessageId && persistedContent) {
        try {
          await chatService.rollbackDeferredAssistantMessage(
            chatContext,
            persistedMessageId,
            persistedContent,
          );
        } catch (rollbackError) {
          console.error('[RealtimeVoice] Failed to roll back failed canonical answer:', rollbackError);
        }
        conversation.canonicalPersistedMessageId = undefined;
        conversation.canonicalPersistedResponseId = undefined;
        conversation.canonicalPersistedContent = undefined;
        conversation.canonicalDisplayReadyResponseId = undefined;
      }
      conversation.isProcessing = false;
      conversation.currentResponseKind = undefined;
      console.error('[RealtimeVoice] Canonical answer failed:', error);
      this.sendError(conversation.clientWs, 'I could not complete that answer. Please try again.');
      this.sendToClient(conversation.clientWs, { type: 'ai_done', responseId });
    }
  }

  /**
   * Send the response.create for a normal (non-journey) assistant turn.
   *
   * In content-only K12 mode we DO NOT force the model to call fetch_k12_topic
   * via tool_choice anymore: on the Realtime API a forced tool call is emitted
   * as a TEXT content part (e.g. {"query":"proteins"}) rather than a real
   * function_call, which then leaked into the chat bubble and was read aloud.
   * Instead we run the curriculum lookup SERVER-SIDE here (mirroring the text
   * path's "K12 Fast Path"), inject the grounded content as a context item, and
   * then ask for a normal audio response that speaks the grounded answer.
   *
   * The non-K12 path is unchanged: a plain response.create.
   */
  private async sendNormalResponse(conversation: VoiceConversation): Promise<void> {
    if (!conversation.openaiWs || conversation.openaiWs.readyState !== WebSocket.OPEN) return;

    // Snapshot this turn's token and transcript. The token is bumped at the
    // moment each new final user transcript ARRIVES (before any await), so if
    // the student speaks again while we're rewriting/retrieving below, the
    // sequence moves on and this in-flight turn must abandon itself instead of
    // injecting stale context or racing a second response.create. The
    // transcript snapshot keeps this turn answering ITS question even though a
    // newer transcription overwrites conversation.currentUserTranscript.
    const turnId = conversation.k12TurnSeq ?? 0;
    const turnTranscript = conversation.currentUserTranscript;

    let curriculumInjected = false;
    if (conversation.k12ContentOnly && this.shouldForceK12Fetch(turnTranscript)) {
      // The server-side lookup + injection takes a few seconds; tell the widget
      // we're working so it shows its "Thinking…" state instead of dead air.
      this.sendToClient(conversation.clientWs, { type: 'thinking' });
      curriculumInjected = await this.injectK12CurriculumContext(conversation, turnId, turnTranscript);
      if (conversation.k12TurnSeq !== turnId) {
        console.log('[RealtimeVoice] Turn superseded during curriculum retrieval — abandoning stale response');
        return;
      }
    }

    if (conversation.openaiWs && conversation.openaiWs.readyState === WebSocket.OPEN) {
      // When we already did the lookup, close tool calling for THIS response.
      // A Realtime response terminates the moment the model emits a function
      // call, so leaving the tool open let the model open with "let me pull in
      // the curriculum content", call fetch_k12_topic it did not need, and end
      // the turn there — splitting one answer into two replies and chopping the
      // first one off mid-sentence. Turns without injection (greetings, chit
      // chat) keep tools available exactly as before.
      const payload = curriculumInjected
        ? { type: 'response.create', response: { tool_choice: 'none' } }
        : { type: 'response.create' };
      conversation.openaiWs.send(JSON.stringify(payload));
      if (curriculumInjected) {
        console.log('[RealtimeVoice] Answering from injected curriculum in a single turn (tool_choice=none)');
      }
    }
  }

  /**
   * Turn a signed launch scope into the set of content packs voice retrieval is
   * allowed to search. Deliberately mirrors the text path's precedence so the two
   * modes never disagree about what a subject means:
   *   - full board/medium/grade/subject → resolve from the scope mappings, even
   *     if the identity also names a cp_id directly
   *   - cp_id only (legacy identity)    → that single pack. Note retrieval only
   *     honours the cp_id LIST, so a bare cp_id must be wrapped or it silently
   *     goes unscoped
   *   - partial / unresolvable          → [] (refuse), never "search everything"
   */
  private async resolveVoiceCurriculumScope(
    businessAccountId: string,
    scope?: TopscholarVoiceScope,
  ): Promise<{ cpIds: string[] | null; chapter: string | null }> {
    // No scope supplied at all — admin dashboard voice, other tenants. Keep the
    // historical whole-account behaviour for them.
    if (!scope) return { cpIds: null, chapter: null };

    const chapter = String(scope.chapter ?? '').trim() || null;
    const cpId = String(scope.cpId ?? '').trim();
    const board = String(scope.board ?? '').trim();
    const medium = String(scope.medium ?? '').trim();
    const grade = String(scope.grade ?? '').trim();
    const subject = String(scope.subject ?? '').trim();
    const fullScope = !!(board && medium && grade && subject);

    const anyScope = !!(board || medium || grade || subject);

    // A partial scope is refused even when the identity also names a content
    // package — the text path does exactly this, and diverging here would mean
    // the same launch answers in voice but refuses in chat.
    if (anyScope && !fullScope) {
      console.warn('[RealtimeVoice] Partial launch scope (need board, medium, grade AND subject) — refusing curriculum for this session');
      return { cpIds: [], chapter };
    }

    if (fullScope) {
      try {
        const cpIds = await resolveCpIdsForScope(businessAccountId, { board, medium, grade, subject });
        if (cpIds.length === 0) {
          console.warn('[RealtimeVoice] Launch scope matched no content package — refusing curriculum for this session:', { board, medium, grade, subject });
        } else {
          console.log(`[RealtimeVoice] Curriculum scope resolved to ${cpIds.length} content package(s)`, { board, medium, grade, subject, chapter });
        }
        return { cpIds, chapter };
      } catch (err) {
        // Fail closed: a lookup failure must not silently widen the session to
        // the whole account.
        console.error('[RealtimeVoice] Scope resolution failed — refusing curriculum for this session:', (err as Error).message);
        return { cpIds: [], chapter };
      }
    }

    // Legacy identity: no scope fields at all, just a content package.
    if (cpId) {
      console.log('[RealtimeVoice] Curriculum scope bound to a single content package from the launch identity', { chapter });
      return { cpIds: [cpId], chapter };
    }

    console.warn('[RealtimeVoice] Launch identity carried neither a content package nor a scope — refusing curriculum for this session');
    return { cpIds: [], chapter };
  }

  /**
   * Did the curriculum lookup fail, as opposed to legitimately finding nothing?
   *
   * The resolvers swallow their own errors and hand back the same success:true
   * envelope they use for a genuine no-match, so the message is the only signal
   * there is. Getting this wrong in the "no-match" direction is the damaging
   * one: the student is told their syllabus lacks a topic it actually contains.
   */
  private looksLikeRetrievalFailure(result: any): boolean {
    if (!result || result.success === false) return true;
    const message = typeof result.message === 'string' ? result.message : '';
    return message.startsWith('SYSTEM ERROR')
      || message.startsWith('Failed to fetch topics from external API')
      || message.startsWith('External API error');
  }

  /**
   * K12 content-only: retrieve curriculum for the student's question server-side
   * and inject it as a system context item so the next response is grounded.
   * Best-effort — on any failure we simply skip injection and let the normal
   * response proceed (never break the turn).
   *
   * Returns true when context was actually injected. The caller uses that to
   * close tool calling for the turn: if the model can still reach for
   * fetch_k12_topic it will, and a Realtime response ENDS at a function call —
   * so the greeting sentence becomes one finished reply and the real answer
   * becomes a second one, which is heard as the tutor cutting itself off.
   */
  /**
   * Rewrite the raw spoken utterance into a standalone curriculum-search query.
   *
   * Voice transcripts make poor embedding queries in two ways the typed path
   * never hits: numbers arrive spelled out ("sixty-six gram" vs "66g"), and
   * follow-ups arrive context-free ("let's get this again" says nothing about
   * the mole concept the student is actually revisiting). A small text-model
   * pass rewrites the utterance using the recent conversation, so retrieval
   * sees the same kind of query chat does. Best-effort: any failure, timeout,
   * or empty output falls back to the raw transcript — never FAILS the turn.
   * It does add serial latency (bounded by the 4s timeout) before the response
   * is created; the client shows "Thinking…" during this window, and the turn
   * token in sendNormalResponse guards against a newer utterance racing it.
   */
  private async buildK12RetrievalQuery(conversation: VoiceConversation, rawQuery: string): Promise<string> {
    try {
      const history = conversationMemory.getConversationHistory(conversation.userId)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6);

      const historyText = history.length
        ? history.map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content.slice(0, 400)}`).join('\n')
        : '(no earlier messages)';

      const client = new OpenAI({ apiKey: conversation.openaiApiKey });
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 60,
        messages: [
          {
            role: 'system',
            content:
              'You rewrite a student\'s spoken utterance into ONE standalone search query for a curriculum content database. Rules:\n' +
              '- Convert spelled-out numbers and units to digits/symbols ("sixty-six gram" → "66g").\n' +
              '- If the utterance is a follow-up that refers to the earlier discussion ("explain again", "let\'s get this again", "what about the second one"), rewrite it as a full standalone question using the conversation context.\n' +
              '- If the utterance is already a complete, self-contained question, return it with only number/unit normalization.\n' +
              '- Output ONLY the rewritten query text. No quotes, no explanations.',
          },
          {
            role: 'user',
            content: `Recent conversation:\n${historyText}\n\nStudent's new spoken utterance: ${rawQuery}`,
          },
        ],
      }, { timeout: 4000 });

      try {
        await aiUsageLogger.logUsage({
          businessAccountId: conversation.businessAccountId,
          category: 'voice_mode',
          model: 'gpt-4o-mini',
          tokensInput: completion.usage?.prompt_tokens || 0,
          tokensOutput: completion.usage?.completion_tokens || 0,
          metadata: { feature: 'voice_k12_query_rewrite', conversationId: conversation.conversationId },
        });
      } catch { /* non-fatal */ }

      const rewritten = (completion.choices[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
      // Sanity bounds: an empty or absurdly long rewrite means the model went off
      // script — fall back to the raw transcript rather than search for garbage.
      if (rewritten && rewritten.length <= 300) {
        if (rewritten.toLowerCase() !== rawQuery.toLowerCase()) {
          console.log(`[RealtimeVoice] K12 retrieval query rewritten: "${rawQuery.slice(0, 60)}" → "${rewritten.slice(0, 60)}"`);
        }
        return rewritten;
      }
    } catch (err) {
      console.warn('[RealtimeVoice] K12 query rewrite failed — using raw transcript:', (err as Error).message);
    }
    return rawQuery;
  }

  private async injectK12CurriculumContext(conversation: VoiceConversation, turnId?: number, turnTranscript?: string): Promise<boolean> {
    const rawQuery = (turnTranscript ?? conversation.currentUserTranscript ?? '').trim();
    if (!rawQuery || !conversation.conversationId) return false;
    const query = await this.buildK12RetrievalQuery(conversation, rawQuery);
    // Superseded while rewriting? Skip the retrieval entirely.
    if (turnId !== undefined && conversation.k12TurnSeq !== turnId) return false;

    try {
      console.log('[RealtimeVoice] K12 content-only: retrieving curriculum server-side for query:', query.slice(0, 80));
      const result = await ToolExecutionService.executeTool(
        'fetch_k12_topic',
        { query },
        {
          businessAccountId: conversation.businessAccountId,
          userId: conversation.userId,
          conversationId: conversation.conversationId,
          userMessage: query,
          // Scope retrieval to the launch identity's curriculum, exactly as the
          // text path does. Omitting these searches the whole account.
          cpIds: conversation.topscholarCpIds,
          chapter: conversation.topscholarChapter,
        },
        query,
        false
      );

      // "The store is unreachable" and "your syllabus doesn't cover this" both
      // come back as success:true with an empty data array — only the message
      // separates them. Treating an outage as a definitive not-found would tell
      // the student the topic doesn't exist AND close tool calling, leaving the
      // model no way to recover. So on failure we inject nothing and return
      // false, which keeps the lookup available for the model to try itself.
      // Superseded while retrieving? The result belongs to an abandoned turn —
      // inject nothing and leave no pending media behind for the next turn.
      if (turnId !== undefined && conversation.k12TurnSeq !== turnId) return false;

      if (this.looksLikeRetrievalFailure(result)) {
        console.warn('[RealtimeVoice] Curriculum retrieval failed this turn — skipping injection and leaving the lookup available:', typeof result?.message === 'string' ? result.message.slice(0, 120) : result?.error);
        return false;
      }

      // Capture any curriculum images for this turn BEFORE compaction strips
      // them out of the model-facing text.
      conversation.pendingCurriculumMedia = this.extractCurriculumMedia(result, query);
      // Unbound until the response that will speak this answer is created.
      conversation.pendingCurriculumMediaResponseId = null;

      const curriculum = this.compactK12Curriculum(result);
      // Say plainly that this IS the lookup result. Presented as mere background
      // context, the model tries to look the topic up again "to be sure" — and
      // its second, narrower query ("stem" for "Tell me about stems") can come
      // back empty, so it refuses a topic it was already holding the answer to.
      const provenance = `The curriculum lookup for this question has ALREADY BEEN RUN for you and its result is below. This is the complete result — there is nothing further to look up and no tool to call. Answer from it directly, in this same reply.`;
      const instruction = curriculum
        ? `${provenance}\n\nCURRICULUM CONTEXT for the student's question "${query}". Answer the student's question using ONLY the curriculum content below — every fact, definition, example, and explanation must come from it. SOLE NARROW EXCEPTION — completing a calculation: you ARE allowed and EXPECTED to reason and work through numerical problems step by step, and when this content provides the governing concept or formula you may supply ROUTINE SUPPORTING VALUES ONLY (standard constants such as atomic masses, molar masses, g = 9.8 m/s², unit conversions) to complete the calculation — the text-chat tutor computes these and you must give the SAME final answer it would. NEVER refuse a calculation this content governs just because a routine constant is missing. The exception covers standard constants and conversions, nothing else: if the content lacks a NON-routine fact the question needs, answer the supported part and say the curriculum doesn't cover the rest. If it does not cover the topic at all, tell the student you don't have that in the curriculum yet. Give a THOROUGH, COMPLETE spoken lesson that covers EVERY key point in this content (definitions, examples, sub-concepts, distinctions) — match the depth of a full written answer, do not summarize or shorten it. Convey structure out loud with spoken signposting ("First…", "Next…", "For example…") rather than reading bullet symbols or markdown. Do NOT read this context aloud verbatim and do NOT mention tools or JSON; answer in a natural, warm teaching voice.\n\n${curriculum}`
        : `The curriculum lookup for the student's question "${query}" has ALREADY BEEN RUN for you and it found nothing. That is the final answer — there is nothing further to look up and no tool to call. Tell the student, in this same reply, that you don't have that topic in the curriculum yet and invite them to ask about another topic. Do NOT answer from outside knowledge and do NOT mention tools or JSON.`;

      if (conversation.openaiWs && conversation.openaiWs.readyState === WebSocket.OPEN) {
        conversation.openaiWs.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: instruction }]
          }
        }));
        console.log('[RealtimeVoice] Injected K12 curriculum context (' + curriculum.length + ' chars)');
        return true;
      }
    } catch (err) {
      console.error('[RealtimeVoice] K12 curriculum retrieval failed, proceeding without injection:', err);
    }
    return false;
  }

  /**
   * Flatten a fetch_k12_topic ToolResponse into a rich, speakable curriculum
   * string for voice injection. Includes revisionNotes, description, and the
   * structured notes array so the model has enough source material to give a
   * thorough spoken explanation — matching the depth of the text-mode answer.
   */
  private compactK12Curriculum(result: any): string {
    try {
      if (!result || result.success === false) return '';
      const data = Array.isArray(result.data) ? result.data : [];
      if (data.length === 0) {
        return typeof result.message === 'string' ? result.message.slice(0, 500) : '';
      }
      // Give voice the same depth of source material the text path gets so the
      // spoken answer can match the written answer. Bounded only to avoid
      // flooding a single realtime turn.
      const MAX_PASSAGES = 4;
      const MAX_REVISION_CHARS = 6000;
      const MAX_NOTE_CHARS = 2500;

      const parts = data.slice(0, MAX_PASSAGES).map((r: any) => {
        const header = [r?.subjectName, r?.chapterName, r?.name].filter(Boolean).join(' › ');
        const lines: string[] = [];

        if (header) lines.push(`### ${header}`);

        // Description (brief overview of the topic). Stripped like every other
        // field: any string reaching a speaking model is a string it might read.
        if (typeof r?.description === 'string' && r.description.trim()) {
          const overview = this.stripMediaMarkdown(r.description);
          if (overview) lines.push(`**Overview:** ${overview}`);
        }

        // Main revision notes (primary content)
        if (typeof r?.revisionNotes === 'string' && r.revisionNotes.trim()) {
          const notes = this.stripMediaMarkdown(r.revisionNotes);
          if (notes) lines.push(notes.slice(0, MAX_REVISION_CHARS));
        }

        // Structured sub-topic notes (title + content pairs — often the richest content)
        if (Array.isArray(r?.notes) && r.notes.length > 0) {
          const noteSections = r.notes
            .filter((n: any) => n?.title || n?.content)
            .slice(0, 10)
            .map((n: any) => {
              const title = typeof n?.title === 'string' ? this.stripMediaMarkdown(n.title) : '';
              const content = typeof n?.content === 'string' ? this.stripMediaMarkdown(n.content).slice(0, MAX_NOTE_CHARS) : '';
              return title && content ? `**${title}:** ${content}` : (content || title);
            })
            .filter(Boolean);
          if (noteSections.length > 0) {
            lines.push('\n**Key Points:**\n' + noteSections.join('\n'));
          }
        }

        return lines.join('\n').trim();
      }).filter(Boolean);

      return parts.join('\n\n---\n\n');
    } catch {
      return '';
    }
  }

  /**
   * Remove Markdown image tags and every bare URL from text that is about to be
   * handed to the model.
   *
   * This is not cosmetic. Retrieval appends the curriculum's images to the end of
   * the notes as `![...](https://...)`. In the text path that is exactly what you
   * want — the model echoes it and the browser renders a picture. A voice tutor
   * would instead READ THE LINK OUT LOUD, which is jarring. Images reach the
   * student through `pendingCurriculumMedia` and the on-screen bubble instead, so
   * the model never needs to see a URL.
   */
  private stripMediaMarkdown(text: string): string {
    if (typeof text !== 'string' || !text) return '';
    return text
      // XML namespace declarations (MathML content carries these). Pure markup,
      // but they are literal URLs sitting in text a speaking model reads.
      .replace(/\s+xmlns(?::\w+)?="[^"]*"/gi, '')
      // ![alt](url) and the occasional [text](url) pointing straight at an image
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]\((https?:\/\/[^)]+\.(?:png|jpe?g|gif|webp|svg)[^)]*)\)/gi, ' ')
      // Any remaining bare URL. Matching on file extension used to be enough,
      // but it misses every link that carries none — object-storage keys and
      // signed URLs in particular — and there is no URL a spoken tutor should
      // ever read out, image or not.
      .replace(/https?:\/\/\S+/gi, ' ')
      // Collapse the whitespace the removals leave behind
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Deep-clean a tool result before it is handed to the voice model: drop media
   * fields outright and strip image Markdown / bare image URLs out of every
   * string. The text path can safely pass these through because a browser
   * renders them; a voice tutor would pronounce them.
   */
  private sanitizeToolResultForVoice(value: any, depth = 0): any {
    if (depth > 8) return value;
    if (typeof value === 'string') return this.stripMediaMarkdown(value);
    if (Array.isArray(value)) return value.map(v => this.sanitizeToolResultForVoice(v, depth + 1));
    if (value && typeof value === 'object') {
      const out: any = {};
      for (const [key, v] of Object.entries(value)) {
        // Media collections are for the on-screen bubble only — never the model.
        if (key === 'mediaUrls' || key === 'mediaCandidates' || key === 'imageUrl' || key === 'imageUrls' || key === 'thumbnailUrl') continue;
        out[key] = this.sanitizeToolResultForVoice(v, depth + 1);
      }
      return out;
    }
    return value;
  }

  /**
   * Pull the curriculum diagrams out of a retrieval result as CANDIDATES for the
   * formatter pass to choose from.
   *
   * Each one carries the topic and chapter it came from, because that is the
   * only way a later pass can tell whether the answer actually taught this
   * diagram's subject or merely searched near it. Retrieval returns six passages
   * and nearly all of them carry a picture, so handing this list straight to the
   * screen is what produced a wall of six diagrams on every reply — including on
   * refusals and filler.
   *
   * The cap here is only to bound the choosing prompt, NOT a display limit; at
   * most two ever reach the student.
   */
  private extractCurriculumMedia(result: any, query: string): VoiceDiagramCandidate[] {
    try {
      const data = Array.isArray(result?.data) ? result.data : [];
      const candidates: CurriculumMediaCandidate[] = [];

      for (let rank = 0; rank < data.length; rank++) {
        const passage = data[rank];
        const structured = Array.isArray(passage?.mediaCandidates) ? passage.mediaCandidates : [];
        for (const raw of structured) {
          const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
          if (!/^https?:\/\//i.test(url)) continue;
          if (raw?.kind && raw.kind !== 'image') continue;
          candidates.push({
            url,
            kind: 'image',
            topic: typeof raw?.topic === 'string' ? raw.topic : (typeof passage?.name === 'string' ? passage.name : ''),
            concept: typeof raw?.concept === 'string' ? raw.concept : null,
            subConcept: typeof raw?.subConcept === 'string' ? raw.subConcept : null,
            caption: typeof raw?.caption === 'string' ? raw.caption : null,
            alt: typeof raw?.alt === 'string' ? raw.alt : null,
            sourceRef: typeof raw?.sourceRef === 'string' ? raw.sourceRef : null,
            order: typeof raw?.order === 'number' ? raw.order : 0,
            chapter: typeof raw?.chapter === 'string' ? raw.chapter : (typeof passage?.chapterName === 'string' ? passage.chapterName : ''),
            subject: typeof raw?.subject === 'string' ? raw.subject : (typeof passage?.subjectName === 'string' ? passage.subjectName : ''),
            retrievalRank: typeof raw?.retrievalRank === 'number' ? raw.retrievalRank : rank,
          });
        }

        // Legacy resolver results only have URL strings. Keep them compatible, but
        // still route them through the same deterministic topic gate.
        const media = structured.length === 0 && Array.isArray(passage?.mediaUrls) ? passage.mediaUrls : [];
        for (const raw of media) {
          const url = typeof raw === 'string' ? raw.trim() : '';
          // Only http(s) — never let a data: or javascript: URI reach an <img>.
          if (!/^https?:\/\//i.test(url)) continue;
          candidates.push({
            url,
            kind: 'image',
            topic: typeof passage?.name === 'string' ? passage.name : '',
            concept: null,
            subConcept: null,
            caption: null,
            alt: null,
            sourceRef: null,
            order: 0,
            chapter: typeof passage?.chapterName === 'string' ? passage.chapterName : '',
            subject: typeof passage?.subjectName === 'string' ? passage.subjectName : '',
            retrievalRank: rank,
          });
        }
      }
      const approved = selectRelevantImages(query, candidates);
      console.log(
        `[RealtimeVoice] Curriculum media gate: ${candidates.length} candidate(s), ${approved.length} approved`,
        approved.map((candidate) => candidate.topic || candidate.concept || 'untitled').slice(0, 2),
      );
      return approved.map((candidate) => ({
        url: candidate.url,
        topic: candidate.topic || candidate.concept || candidate.subConcept || '',
        chapter: candidate.chapter || '',
        subject: candidate.subject || '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Detect a K12 tool-call argument payload that the Realtime model emitted as
   * plain text instead of a proper function_call (e.g. {"query":"proteins"}).
   * Such a payload must never be forwarded to the client, saved, or synthesized.
   *
   * Deliberately narrow: it only matches a bare JSON object whose keys are ALL
   * fetch_k12_topic / fetch_k12_questions argument names — the only tools forced
   * on K12 content-only academic turns. This avoids ever dropping a genuine
   * answer that merely happens to be JSON. Only consulted on the K12 path.
   */
  private looksLikeToolCallPayload(text: string): boolean {
    const t = (text || '').trim();
    if (!(t.startsWith('{') && t.endsWith('}'))) return false;
    try {
      const obj = JSON.parse(t);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
      const keys = Object.keys(obj);
      if (keys.length === 0) return false;
      // Argument keys of the K12 content tools (fetch_k12_topic: {query};
      // fetch_k12_questions: {query, difficulty}).
      const k12ToolArgKeys = new Set(['query', 'difficulty']);
      return keys.every(k => k12ToolArgKeys.has(k));
    } catch {
      return false;
    }
  }

  // Handle tool calls from OpenAI Realtime API (lead capture, appointments, etc.)
  private async handleToolCall(event: any, conversation: VoiceConversation) {
    const { call_id, name, arguments: argsString } = event;
    
    console.log('[RealtimeVoice] Tool call:', name, argsString);

    try {
      const args = JSON.parse(argsString);
      
      if (!conversation.conversationId) {
        throw new Error('No conversation ID available');
      }

      // Check if appointments are enabled for this business
      const businessAccount = await storage.getBusinessAccount(conversation.businessAccountId);
      const appointmentsEnabled = businessAccount?.appointmentsEnabled === 'true';

      // Execute the tool using ToolExecutionService
      const result = await ToolExecutionService.executeTool(
        name,
        args,
        {
          businessAccountId: conversation.businessAccountId,
          userId: conversation.userId,
          conversationId: conversation.conversationId,
          userMessage: conversation.currentUserTranscript,
          // Same curriculum scope as the server-side retrieval above — a tool the
          // model invokes itself must not be a way around the session's scope.
          cpIds: conversation.topscholarCpIds,
          chapter: conversation.topscholarChapter,
        },
        conversation.currentUserTranscript,
        appointmentsEnabled
      );

      console.log('[RealtimeVoice] Tool execution result:', result);

      // Curriculum images from a model-invoked lookup ride the same out-of-band
      // channel as the server-side path (never through the spoken answer).
      const toolQuery = typeof args?.query === 'string' ? args.query : (conversation.currentUserTranscript || '');
      const toolMedia = this.extractCurriculumMedia(result, toolQuery);
      if (toolMedia.length > 0) {
        conversation.pendingCurriculumMedia = toolMedia;
        // Unbound: the model answers on the NEXT response, not this one.
        conversation.pendingCurriculumMediaResponseId = null;
      }

      // Send tool result back to OpenAI
      const toolOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          // Sanitized: the raw result carries mediaUrls and image Markdown inside
          // the notes. Handing those to a SPEAKING model invites it to read the
          // URL out loud. Images reach the student via the out-of-band channel.
          output: JSON.stringify(this.sanitizeToolResultForVoice(result))
        }
      };

      if (conversation.openaiWs && conversation.openaiWs.readyState === WebSocket.OPEN) {
        conversation.openaiWs.send(JSON.stringify(toolOutput));
        
        // Trigger AI to continue with the tool result
        const responseCreate = {
          type: 'response.create'
        };
        conversation.openaiWs.send(JSON.stringify(responseCreate));
        
        console.log('[RealtimeVoice] Sent tool result back to AI');
      }
    } catch (error) {
      console.error('[RealtimeVoice] Error handling tool call:', error);
      
      // Send error back to OpenAI
      const errorOutput = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: event.call_id,
          output: JSON.stringify({ success: false, error: 'Tool execution failed' })
        }
      };
      
      if (conversation.openaiWs && conversation.openaiWs.readyState === WebSocket.OPEN) {
        conversation.openaiWs.send(JSON.stringify(errorOutput));
      }
    }
  }

  private setupClientHandlers(conversationId: string, conversation: VoiceConversation) {
    const { clientWs, openaiWs } = conversation;

    clientWs.on('message', async (data: any, isBinary: boolean) => {
      this.touchActivity(conversation);
      
      if (isBinary) {
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          const buf = data instanceof Buffer ? data : Buffer.from(data);
          
          if (buf.length === 0 || buf.length < 100) {
            return;
          }
          
          if (buf.length % 2 !== 0) {
            return;
          }
          
          const base64Audio = buf.toString('base64');
          openaiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio
          }));
        }
      } else {
        try {
          const message = JSON.parse(data.toString());
          await this.handleClientMessage(conversationId, conversation, message);
        } catch (error) {
          console.error('[RealtimeVoice] Error parsing client message:', error);
        }
      }
    });

    clientWs.on('close', () => {
      // CRITICAL FIX BUG 1: Check if this socket was superseded by reconnection
      // If superseded, skip cleanup - the conversation is being reconnected with a new socket
      if ((clientWs as any)._superseded) {
        console.log('[RealtimeVoice] Superseded socket closed, skipping cleanup (reconnection in progress)');
        return; // DON'T cleanup if superseded
      }
      
      console.log('[RealtimeVoice] Client disconnected for conversation:', conversationId);
      // Cleanup entire conversation when client disconnects
      this.cleanupConversation(conversationId, 'client_disconnected');
    });

    clientWs.on('error', (error) => {
      console.error('[RealtimeVoice] Client WebSocket error:', error);
      this.cleanupConversation(conversationId, 'client_error');
    });
  }

  private async handleClientMessage(
    conversationId: string,
    conversation: VoiceConversation,
    message: any
  ) {
    const { openaiWs } = conversation;

    console.log('[RealtimeVoice] Client message:', message.type);

    switch (message.type) {
      case 'interrupt':
        // User interrupted AI - cancel current response using helper.
        // respectGrace=true: a client interrupt that lands in the first
        // BARGE_IN_GRACE_MS of the answer's audio is almost always the client
        // VAD firing on the AI's own playback echo, not a real interruption.
        console.log('[RealtimeVoice] User interrupted AI');
        const preservedDisplay = this.hasDisplayedCanonicalAnswer(
          conversation,
          conversation.currentResponseId,
        );
        const cancelled = this.cancelResponse(conversation, false);
        
        // Explicit client interrupts are already protected by the client's
        // playback grace window. Tell the client whether response ownership was
        // actually abandoned so its local state cannot diverge from the server.
        this.sendToClient(conversation.clientWs, {
          type: cancelled ? 'interrupt_ack' : 'interrupt_ignored',
          preservedDisplay,
        });
        break;

      case 'playback_complete':
        if (
          message.responseId &&
          message.responseId === conversation.currentResponseId &&
          conversation.currentResponseKind === 'canonical'
        ) {
          conversation.currentResponseKind = undefined;
          conversation.canonicalPersistedMessageId = undefined;
          conversation.canonicalPersistedResponseId = undefined;
          conversation.canonicalPersistedContent = undefined;
          conversation.canonicalDisplayReadyResponseId = undefined;
          conversation.activeElevenLabsStartedAt = undefined;
          console.log('[RealtimeVoice] Canonical playback completed:', message.responseId);
        }
        break;

      case 'pong':
        // Client responded to ping - update heartbeat timestamp
        conversation.lastHeartbeat = Date.now();
        console.log('[RealtimeVoice] Received pong from conversation:', conversationId);
        break;

      case 'keepalive':
        break;

      default:
        console.log('[RealtimeVoice] Unknown client message type:', message.type);
    }
  }

  private sendToClient(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, message: string) {
    this.sendToClient(ws, { type: 'error', message });
  }

  // --- Incremental (sentence-by-sentence) TTS for the K12 text path ---

  // Find the longest prefix of `unsent` that ends on a sentence boundary. When
  // `force` is true (final flush), return everything that's left. Returns null
  // when there's nothing speakable yet (no boundary, or shorter than the min).
  private extractSpeakableChunk(unsent: string, force: boolean): { chunk: string; consumed: number } | null {
    if (!unsent) return null;
    if (force) {
      return unsent.trim().length > 0 ? { chunk: unsent, consumed: unsent.length } : null;
    }
    // Sentence-ending punctuation (optionally followed by closing quote/bracket)
    // before whitespace/end, OR a newline. Linear scan, no backtracking.
    const re = /[.!?…]["'’”)\]]*(?=\s|$)|\n+/g;
    let lastEnd = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(unsent)) !== null) {
      lastEnd = m.index + m[0].length;
    }
    if (lastEnd <= 0) return null;
    const candidate = unsent.slice(0, lastEnd);
    if (candidate.trim().length < this.MIN_TTS_CHARS) return null;
    return { chunk: candidate, consumed: lastEnd };
  }

  // Emit any complete sentences accumulated in pendingTextOutput beyond the
  // cursor: forward them to the client for incremental on-screen text, append to
  // the saved transcript, and queue them for speech. `force` flushes the
  // trailing partial sentence at done-time.
  private emitReadyK12Text(conversation: VoiceConversation, force: boolean): void {
    const full = conversation.pendingTextOutput || '';
    let cursor = conversation.streamedTextCursor || 0;
    const cancelled = !!(conversation.currentResponseId &&
      conversation.cancelledResponseIds.has(conversation.currentResponseId));

    while (cursor < full.length) {
      const unsent = full.slice(cursor);
      const next = this.extractSpeakableChunk(unsent, force);
      if (!next) break;
      cursor += next.consumed;
      const chunkText = next.chunk;
      if (chunkText.trim()) {
        // Per-chunk guard: even though buffer mode catches replies that START
        // as JSON, a stream-mode reply can still carry a tool-call-shaped tail
        // (e.g. "Let me check.\n{"query":"x"}"). looksLikeToolCallPayload is
        // strict (pure JSON, only the K12 tool-arg keys) so this never false-
        // positives on natural prose — drop the fragment without speaking it.
        if (this.looksLikeToolCallPayload(chunkText.trim())) {
          console.warn('[RealtimeVoice] Dropping leaked tool-call payload from streamed K12 text:', chunkText.trim().slice(0, 120));
          continue;
        }
        // Accumulate into the transcript regardless so a barge-in mid-answer
        // still saves what was actually spoken/shown.
        conversation.currentAITranscript = (conversation.currentAITranscript || '') + chunkText;
        // SHOW-THEN-SPEAK: a held answer shows and speaks nothing
        // incrementally; the release path at response.done handles both.
        if (!cancelled && !this.isSpeechHeld(conversation)) {
          this.sendToClient(conversation.clientWs, {
            type: 'ai_chunk',
            text: chunkText,
            responseId: conversation.currentResponseId
          });
          this.enqueueSentenceForTts(conversation, chunkText.trim(), conversation.currentResponseId);
        }
      }
      // A non-force pass only ever yields one chunk (up to the last boundary);
      // a force pass consumes everything in one go.
      if (force) break;
    }
    conversation.streamedTextCursor = cursor;
  }

  // AUDIO-MODALITY path: enqueue complete sentences from currentAITranscript for
  // incremental ElevenLabs TTS as the transcript streams in. Unlike
  // emitReadyK12Text this does NOT forward ai_chunk to the client or append to
  // the transcript — the transcript.delta handler already did both per-delta.
  // It only feeds the sentence-by-sentence speech queue. `force` flushes the
  // trailing partial sentence at transcript.done.
  private streamTranscriptTts(conversation: VoiceConversation, force: boolean): void {
    if (!conversation.elevenlabsApiKey || !conversation.elevenlabsVoiceId) return;
    const full = conversation.currentAITranscript || '';
    let cursor = conversation.ttsTranscriptCursor || 0;
    const cancelled = !!(conversation.currentResponseId &&
      conversation.cancelledResponseIds.has(conversation.currentResponseId));
    if (cancelled) {
      conversation.ttsTranscriptCursor = full.length;
      return;
    }

    while (cursor < full.length) {
      const unsent = full.slice(cursor);
      const next = this.extractSpeakableChunk(unsent, force);
      if (!next) break;
      cursor += next.consumed;
      const chunkText = next.chunk.trim();
      if (chunkText) {
        this.enqueueSentenceForTts(conversation, chunkText, conversation.currentResponseId);
      }
      // A non-force pass yields one chunk (up to the last boundary); a force
      // pass consumes everything remaining in one go.
      if (force) break;
    }
    conversation.ttsTranscriptCursor = cursor;
  }

  // Decide what to do with the full K12 reply at done-time. Idempotent.
  private finalizeK12TextOutput(conversation: VoiceConversation): void {
    if (conversation.k12TextFinalized) return;
    conversation.k12TextFinalized = true;

    const full = conversation.pendingTextOutput || '';
    conversation.pendingTextOutput = '';
    const trimmedFull = full.trim();
    if (!trimmedFull) return;

    // The whole reply may have arrived in a single delta — decide mode now.
    if (!conversation.textStreamMode || conversation.textStreamMode === 'pending') {
      const first = trimmedFull[0];
      conversation.textStreamMode = (first === '{' || first === '[') ? 'buffer' : 'stream';
    }

    const cancelled = !!(conversation.currentResponseId &&
      conversation.cancelledResponseIds.has(conversation.currentResponseId));

    if (conversation.textStreamMode === 'buffer') {
      // Reply started like JSON — validate the whole thing before it's ever
      // spoken/shown, and drop a leaked tool-call payload.
      if (this.looksLikeToolCallPayload(trimmedFull)) {
        console.warn('[RealtimeVoice] Dropping leaked tool-call payload from text output:', trimmedFull.slice(0, 120));
        return;
      }
      if (cancelled) return;
      conversation.currentAITranscript = (conversation.currentAITranscript || '') + trimmedFull;
      // SHOW-THEN-SPEAK: held answers surface via the release path instead.
      if (this.isSpeechHeld(conversation)) return;
      this.sendToClient(conversation.clientWs, {
        type: 'ai_chunk',
        text: trimmedFull,
        responseId: conversation.currentResponseId
      });
      if (conversation.elevenlabsApiKey && conversation.elevenlabsVoiceId &&
          conversation.lastSynthesizedResponseId !== conversation.currentResponseId) {
        conversation.lastSynthesizedResponseId = conversation.currentResponseId;
        void this.synthesizeWithElevenLabs(conversation, trimmedFull);
      }
      return;
    }

    // Stream mode: sentences already went out during the deltas. If the user
    // barged in, keep only what was already spoken (don't flush the tail).
    if (cancelled) return;
    this.emitReadyK12Text(conversation, true);
    if (conversation.elevenlabsApiKey && conversation.elevenlabsVoiceId) {
      conversation.lastSynthesizedResponseId = conversation.currentResponseId;
    }
  }

  // True while the CURRENT response is a show-then-speak hold: nothing is shown
  // or spoken incrementally; the release path at response.done does both.
  private isSpeechHeld(conversation: VoiceConversation): boolean {
    return !!conversation.holdSpeechResponseId &&
      conversation.holdSpeechResponseId === conversation.currentResponseId;
  }

  /**
   * SHOW-THEN-SPEAK release for any held voice answer.
   *
   * Order is the whole point: (1) run the display formatter on the COMPLETE
   * transcript, (2) derive a readable plain-text fallback when it cannot
   * format, (3) persist the display version, (4) push the display version and
   * raw speech transcript together before ANY audio, and (5) release either
   * buffered OpenAI audio or ElevenLabs TTS. Every await re-checks cancellation
   * so a barge-in during formatting shows and speaks nothing.
   */
  private async releaseHeldAnswer(
    conversation: VoiceConversation,
    transcript: string,
    responseId: string,
    diagramCandidates: VoiceDiagramCandidate[],
  ): Promise<void> {
    const abandoned = () =>
      conversation.cancelledResponseIds.has(responseId) ||
      conversation.currentResponseId !== responseId ||
      conversation.clientWs.readyState !== WebSocket.OPEN;

    let result: Awaited<ReturnType<typeof formatVoiceTranscript>> = null;
    if (conversation.openaiApiKey) {
      try {
        result = await formatVoiceTranscript(
          transcript,
          conversation.openaiApiKey,
          conversation.businessAccountId,
          conversation.conversationId,
          diagramCandidates
        );
      } catch (err) {
        console.warn('[RealtimeVoice] Held-answer formatter failed, using readable display fallback:', (err as Error).message);
      }
    }
    if (abandoned()) {
      console.log('[RealtimeVoice] Held answer abandoned during formatting, responseId:', responseId);
      return;
    }

    const displayMarkdown = result?.formattedMarkdown || createVoiceDisplayFallback(transcript);

    let savedMessageId: string | undefined;
    const discardPersistedAnswer = async (stage: string) => {
      if (!savedMessageId) return;
      try {
        await storage.deleteMessage(savedMessageId, conversation.businessAccountId);
      } catch (err) {
        console.warn('[RealtimeVoice] Could not remove abandoned voice message:', (err as Error).message);
      }
      savedMessageId = undefined;
      console.log('[RealtimeVoice] Discarded held answer abandoned during', stage, 'responseId:', responseId);
    };

    // Persist only after formatting completes and the response still belongs to
    // this turn. The message row retains the spoken text; its metadata retains
    // the display-only Markdown and diagrams that history should replay.
    if (conversation.conversationId) {
      try {
        savedMessageId = await this.saveMessageToDB(conversation.conversationId, 'assistant', transcript);
      } catch (err) {
        // A database hiccup must not leave an otherwise valid live voice turn
        // silent. It simply cannot be replayed in history.
        console.warn('[RealtimeVoice] Could not save held answer before release:', (err as Error).message);
      }
      if (abandoned()) {
        await discardPersistedAnswer('message persistence');
        return;
      }

      if (savedMessageId) {
        try {
          await storage.updateMessageMetadata(savedMessageId, {
            formattedContent: displayMarkdown,
            formatSubject: result?.subject || 'other'
          });
        } catch (err) {
          // The live answer remains readable even if its later history replay
          // must fall back to the stored speech text.
          console.warn('[RealtimeVoice] Could not persist display content for held answer:', (err as Error).message);
        }
        if (abandoned()) {
          await discardPersistedAnswer('display persistence');
          return;
        }
      }
    }

    // Memory must retain only what will actually be spoken. Store it after all
    // awaits so an abandoned response can never appear in a later prompt.
    conversationMemory.storeMessage(conversation.userId, 'assistant', transcript);

    // Show: one final event carries both representations. The client uses
    // displayMarkdown for the bubble and retains text only for audio-synchronised
    // karaoke/highlighting. Raw spoken text is never a visible intermediate.
    this.sendToClient(conversation.clientWs, {
      type: 'ai_chunk',
      text: transcript,
      displayMarkdown,
      responseId,
      final: true
    });
    console.log(
      `[RealtimeVoice] Held answer released with ${result?.formattedMarkdown ? 'formatted' : 'fallback'} display content`,
      `(${result?.imageUrls?.length ?? 0} diagram(s)), responseId:`,
      responseId
    );

    // Then speak the original natural-language transcript. The display version
    // can contain visual-only Markdown, LaTex, and diagrams that must never be
    // read aloud.
    if (conversation.elevenlabsApiKey && conversation.elevenlabsVoiceId) {
      conversation.lastSynthesizedResponseId = responseId;
      this.enqueueSentenceForTts(conversation, transcript, responseId);
    } else {
      this.releaseBufferedOpenAIAudio(conversation, responseId);
    }
  }

  private releaseBufferedOpenAIAudio(conversation: VoiceConversation, responseId: string): void {
    const audioChunks = conversation.openaiAudioFallbackBuffer || [];
    conversation.openaiAudioFallbackBuffer = [];

    if (conversation.cancelledResponseIds.has(responseId) ||
        conversation.currentResponseId !== responseId ||
        conversation.clientWs.readyState !== WebSocket.OPEN) {
      return;
    }

    for (const chunk of audioChunks) {
      conversation.clientWs.send(chunk);
    }
    console.log('[RealtimeVoice] Released buffered OpenAI audio chunks:', audioChunks.length, 'responseId:', responseId);
  }

  // True while ANY ElevenLabs producer may still send PCM to the client:
  // the sentence queue (draining or non-empty) or a direct whole-transcript
  // synth (activeElevenLabsAbort is registered for its whole streaming life).
  private isTtsProducing(conversation: VoiceConversation): boolean {
    return !!(
      conversation.ttsDraining ||
      (conversation.ttsQueue && conversation.ttsQueue.length > 0) ||
      conversation.activeElevenLabsAbort ||
      conversation.activeOpenAITtsAbort
    );
  }

  // Send a deferred ai_done once every TTS producer is idle. Bound to the
  // responseId captured at deferral time: a barge-in clears it, and a
  // cancelled response must not emit a spurious done for a later one.
  private flushDeferredAiDone(conversation: VoiceConversation): void {
    const pendingId = conversation.pendingAiDoneResponseId;
    if (!pendingId || this.isTtsProducing(conversation)) return;
    conversation.pendingAiDoneResponseId = undefined;
    if (pendingId !== 'unknown' && conversation.cancelledResponseIds.has(pendingId)) return;
    this.sendToClient(conversation.clientWs, { type: 'ai_done', responseId: pendingId });
    console.log('[RealtimeVoice] Sent deferred ai_done (responseId:', pendingId, ')');
  }

  // Queue a complete sentence for sequential synthesis. The drainer guarantees
  // only one synth streams PCM to the client at a time, in order.
  private enqueueSentenceForTts(conversation: VoiceConversation, text: string, responseId?: string): void {
    if (!conversation.elevenlabsApiKey || !conversation.elevenlabsVoiceId) return;
    const t = (text || '').trim();
    if (!t) return;
    if (!conversation.ttsQueue) conversation.ttsQueue = [];
    conversation.ttsQueue.push({ text: t, responseId: responseId || '' });
    conversation.ttsResponseId = responseId || conversation.ttsResponseId;
    if (!conversation.ttsDraining) {
      void this.drainTtsQueue(conversation);
    }
  }

  // Synthesize queued sentences one at a time, in order. The barge-in grace
  // timestamp is set ONCE on the first spoken sentence so the grace window
  // covers only the opening of the answer, not every sentence.
  private async drainTtsQueue(conversation: VoiceConversation): Promise<void> {
    if (conversation.ttsDraining) return;
    conversation.ttsDraining = true;
    try {
      while (conversation.ttsQueue && conversation.ttsQueue.length > 0) {
        const item = conversation.ttsQueue.shift()!;
        if (item.responseId && conversation.cancelledResponseIds.has(item.responseId)) continue;
        if (item.responseId && conversation.currentResponseId &&
            item.responseId !== conversation.currentResponseId) continue;
        if (conversation.clientWs.readyState !== WebSocket.OPEN) {
          conversation.ttsQueue = [];
          break;
        }
        if (!conversation.activeElevenLabsStartedAt) {
          conversation.activeElevenLabsStartedAt = Date.now();
        }
        await this.streamSentenceTts(conversation, item.text, item.responseId);
      }
    } finally {
      conversation.ttsDraining = false;
      // Answer finished playing; clear the grace timestamp so the NEXT answer
      // re-arms it (unless a newer answer already set its own).
      if (!conversation.ttsQueue || conversation.ttsQueue.length === 0) {
        conversation.activeElevenLabsStartedAt = undefined;
        conversation.ttsResponseId = undefined;
      }
      // Deferred ai_done: OpenAI's response.done fired while TTS was still
      // producing. Once ALL producers are idle, the client has every PCM
      // byte for the response and can safely finalize on drain.
      this.flushDeferredAiDone(conversation);
    }
  }

  // Stream one sentence's PCM to the client. Unlike synthesizeWithElevenLabs
  // this does NOT abort a previous synth (the drainer already serialized them),
  // but it registers its abort controller so a barge-in can stop it instantly.
  private async streamSentenceTts(conversation: VoiceConversation, text: string, responseId: string): Promise<void> {
    if (!conversation.elevenlabsApiKey || !conversation.elevenlabsVoiceId) return;
    const abortController = new AbortController();
    conversation.activeElevenLabsAbort = abortController;
    conversation.activeElevenLabsResponseId = responseId;
    try {
      let leftover: Buffer | null = null;
      await synthesizeSpeechStreaming(
        {
          apiKey: conversation.elevenlabsApiKey,
          voiceId: conversation.elevenlabsVoiceId,
          text,
          outputFormat: 'pcm_24000',
          signal: abortController.signal,
        },
        (chunk: Buffer) => {
          if (responseId && conversation.cancelledResponseIds.has(responseId)) return;
          if (responseId && conversation.currentResponseId &&
              responseId !== conversation.currentResponseId) return;
          if (conversation.clientWs.readyState !== WebSocket.OPEN) return;
          const merged = leftover ? Buffer.concat([leftover, chunk]) : chunk;
          const evenLen = merged.length & ~1;
          if (evenLen > 0) {
            conversation.clientWs.send(merged.subarray(0, evenLen));
          }
          leftover = evenLen < merged.length ? Buffer.from(merged.subarray(evenLen)) : null;
        }
      );
    } catch (error: unknown) {
      const errName = (error as { name?: string })?.name;
      if (errName === 'AbortError' || abortController.signal.aborted) return;
      // Per-sentence failure: log and let the queue continue with the next
      // sentence. (No OpenAI fallback — that buffer is whole-response audio,
      // which doesn't exist for K12 text turns.)
      console.error('[RealtimeVoice] ElevenLabs sentence synth failed:', error instanceof Error ? error.message : String(error));
    } finally {
      if (conversation.activeElevenLabsAbort === abortController) {
        conversation.activeElevenLabsAbort = undefined;
        conversation.activeElevenLabsResponseId = undefined;
      }
    }
  }

  /**
   * Speak a canonical answer with OpenAI's text-to-speech endpoint. Realtime is
   * deliberately not asked to author or restate the answer: the exact
   * speech-safe script is the TTS input.
   */
  private async synthesizeWithOpenAI(
    conversation: VoiceConversation,
    text: string,
    responseId: string,
  ): Promise<void> {
    if (!text.trim()) return;

    if (conversation.activeOpenAITtsAbort) {
      try { conversation.activeOpenAITtsAbort.abort(); } catch {}
    }
    const abortController = new AbortController();
    conversation.activeOpenAITtsAbort = abortController;
    conversation.activeOpenAITtsResponseId = responseId;

    const supportedVoices = new Set([
      'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'marin',
      'nova', 'onyx', 'sage', 'shimmer', 'verse',
    ]);
    const voice = supportedVoices.has(conversation.selectedVoice || '')
      ? conversation.selectedVoice!
      : 'shimmer';

    // The speech endpoint has an input-size limit. Preserve order and break at
    // sentence/whitespace boundaries without changing the script.
    const chunks: string[] = [];
    let remaining = text.trim();
    while (remaining.length > 3500) {
      const window = remaining.slice(0, 3500);
      const sentenceBreak = Math.max(
        window.lastIndexOf('. '),
        window.lastIndexOf('? '),
        window.lastIndexOf('! '),
        window.lastIndexOf('\n'),
      );
      const splitAt = sentenceBreak > 1000 ? sentenceBreak + 1 : window.lastIndexOf(' ');
      const safeSplit = splitAt > 0 ? splitAt : 3500;
      chunks.push(remaining.slice(0, safeSplit).trim());
      remaining = remaining.slice(safeSplit).trim();
    }
    if (remaining) chunks.push(remaining);

    try {
      const client = new OpenAI({ apiKey: conversation.openaiApiKey });
      for (const chunk of chunks) {
        if (
          abortController.signal.aborted ||
          conversation.cancelledResponseIds.has(responseId) ||
          conversation.currentResponseId !== responseId
        ) return;

        const audioResponse = await client.audio.speech.create({
          model: 'gpt-4o-mini-tts',
          voice: voice as any,
          input: chunk,
          response_format: 'pcm',
        }, { signal: abortController.signal });
        const pcm = Buffer.from(await audioResponse.arrayBuffer());

        if (
          abortController.signal.aborted ||
          conversation.cancelledResponseIds.has(responseId) ||
          conversation.currentResponseId !== responseId ||
          conversation.clientWs.readyState !== WebSocket.OPEN
        ) return;

        conversation.activeElevenLabsStartedAt ||= Date.now();
        const evenLength = pcm.length & ~1;
        for (let offset = 0; offset < evenLength; offset += 32 * 1024) {
          if (
            abortController.signal.aborted ||
            conversation.cancelledResponseIds.has(responseId) ||
            conversation.currentResponseId !== responseId
          ) return;
          conversation.clientWs.send(pcm.subarray(offset, Math.min(offset + 32 * 1024, evenLength)));
        }
      }
    } catch (error) {
      const errName = (error as { name?: string })?.name;
      if (errName === 'AbortError' || abortController.signal.aborted) return;
      console.error('[RealtimeVoice] OpenAI TTS failed:', error instanceof Error ? error.message : String(error));
    } finally {
      if (conversation.activeOpenAITtsAbort === abortController) {
        conversation.activeOpenAITtsAbort = undefined;
        conversation.activeOpenAITtsResponseId = undefined;
        if (conversation.currentResponseKind !== 'canonical') {
          conversation.activeElevenLabsStartedAt = undefined;
        }
      }
    }
  }

  private async synthesizeWithElevenLabs(conversation: VoiceConversation, text: string): Promise<void> {
    if (!conversation.elevenlabsApiKey || !conversation.elevenlabsVoiceId) return;

    // Single-flight guarantee: if a previous synth is still streaming bytes
    // to the client, abort it now. Two concurrent synths would interleave
    // their PCM on the same WebSocket and decode as garbled audio.
    if (conversation.activeElevenLabsAbort) {
      console.log('[RealtimeVoice] Aborting previous ElevenLabs synth (responseId:', conversation.activeElevenLabsResponseId, ') before starting new one');
      try { conversation.activeElevenLabsAbort.abort(); } catch {}
    }

    const abortController = new AbortController();
    // Snapshot the responseId at synth start. Any chunk produced by THIS
    // synth call will be tagged with this id; if the user later cancels it,
    // we drop late chunks even before the abort propagates.
    const synthResponseId = conversation.currentResponseId;
    conversation.activeElevenLabsAbort = abortController;
    conversation.activeElevenLabsResponseId = synthResponseId;

    try {
      console.log('[RealtimeVoice] Streaming ElevenLabs TTS, text length:', text.length, 'responseId:', synthResponseId);

      // PCM16 alignment guard — defense-in-depth from prior task. Cheap, harmless.
      let leftover: Buffer | null = null;
      let totalBytesIn = 0;
      let totalBytesOut = 0;
      let droppedDueToCancel = 0;

      await synthesizeSpeechStreaming(
        {
          apiKey: conversation.elevenlabsApiKey,
          voiceId: conversation.elevenlabsVoiceId,
          text,
          outputFormat: 'pcm_24000',
          signal: abortController.signal,
        },
        (chunk: Buffer) => {
          totalBytesIn += chunk.length;

          // Drop chunks for cancelled or superseded responses. Belt-and-suspenders
          // for the case where abort hasn't fully propagated through the fetch
          // pipeline yet, AND for the case where a brand-new response started
          // after this synth (so currentResponseId moved on).
          if (synthResponseId && conversation.cancelledResponseIds.has(synthResponseId)) {
            droppedDueToCancel += chunk.length;
            return;
          }
          if (synthResponseId && conversation.currentResponseId &&
              synthResponseId !== conversation.currentResponseId) {
            droppedDueToCancel += chunk.length;
            return;
          }
          if (conversation.clientWs.readyState !== WebSocket.OPEN) return;
          conversation.activeElevenLabsStartedAt ||= Date.now();

          const merged = leftover ? Buffer.concat([leftover, chunk]) : chunk;
          const evenLen = merged.length & ~1; // round down to multiple of 2
          if (evenLen > 0) {
            const aligned = merged.subarray(0, evenLen);
            conversation.clientWs.send(aligned);
            totalBytesOut += aligned.length;
          }
          leftover = evenLen < merged.length ? Buffer.from(merged.subarray(evenLen)) : null;
        }
      );

      if (leftover) {
        console.log('[RealtimeVoice] ElevenLabs stream had trailing odd byte (dropped, harmless)');
      }

      console.log('[RealtimeVoice] ElevenLabs stream complete, bytesIn:', totalBytesIn, 'bytesOut:', totalBytesOut, 'droppedCancelled:', droppedDueToCancel);
    } catch (error: unknown) {
      // AbortError is a clean exit — a newer answer superseded this synth.
      // Do NOT fall back to OpenAI audio (that would actually re-create the
      // overlap problem we just fixed).
      const errName = (error as { name?: string })?.name;
      if (errName === 'AbortError' || abortController.signal.aborted) {
        console.log('[RealtimeVoice] ElevenLabs synth aborted (responseId:', synthResponseId, ') — superseded or cancelled, no fallback');
        return;
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[RealtimeVoice] ElevenLabs TTS failed, sending OpenAI fallback audio:', errMsg);

      const fallbackChunks = conversation.openaiAudioFallbackBuffer || [];
      if (fallbackChunks.length > 0) {
        for (const chunk of fallbackChunks) {
          if (conversation.clientWs.readyState === WebSocket.OPEN) {
            conversation.clientWs.send(chunk);
          }
        }
        console.log('[RealtimeVoice] Sent OpenAI fallback audio, chunks:', fallbackChunks.length);
      }
    } finally {
      // Only clear the active-synth slot if WE still own it. A newer synth
      // may have started and replaced our controller while we were running;
      // in that case the newer synth owns the slot and must not be cleared.
      if (conversation.activeElevenLabsAbort === abortController) {
        conversation.activeElevenLabsAbort = undefined;
        conversation.activeElevenLabsResponseId = undefined;
        if (conversation.currentResponseKind !== 'canonical') {
          conversation.activeElevenLabsStartedAt = undefined;
        }
      }
      // This direct synth may have been the last active TTS producer for a
      // response whose ai_done was deferred at response.done.
      this.flushDeferredAiDone(conversation);
    }
  }
}

export const realtimeVoiceService = new RealtimeVoiceService();
