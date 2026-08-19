import OpenAI from 'openai';
import { llamaService, LlamaService } from './llamaService';
import { aiTools, selectRelevantTools, classifyOrderLookupIntent, classifyReturnExchangeIntent } from './aiTools';
import { ToolExecutionService } from './services/toolExecutionService';
import { conversationMemory } from './conversationMemory';
import { storage } from './storage';
import { businessContextCache, BusinessContextCache } from './services/businessContextCache';
import { autoEscalationService } from './services/autoEscalationService';
import { feedbackMonitoringService } from './services/feedbackMonitoringService';
import { journeyService } from './services/journeyService';
import { journeyOrchestrator } from './services/journeyOrchestrator';
import { vectorSearchService } from './services/vectorSearchService';
import { checkDiscountEligibility } from './services/nudgeOrchestrationService';
import { isGibberishAI } from './services/spamDetectionService';
import { categorizeAndSaveConversation } from './services/conversationCategorizationService';
import { summarizeAndSaveConversation } from './services/conversationSummarizationService';
import { buildLeadTrainingPrompt, buildPhoneValidationOverride, buildOtpGatingOverride } from './services/leadTrainingPrompt';
import { OtpService } from './services/otp';
import { claimConversionFire } from './services/conversion';
import { resolveProfile } from './services/customerProfileService';
import { composeCrossPlatformContext, triggerSnapshotUpdate } from './services/crossPlatformMemoryService';
import { validatePhoneNumber } from '../shared/validation/phone';
import { isTopscholarAccount } from './services/topscholar/config';
import { pushTextMessage, type DoubtSyncSender } from './services/topscholar/doubtSyncService';

export interface ChatContext {
  userId: string;
  businessAccountId: string;
  /**
   * Server-owned conversation binding for non-HTTP transports such as voice.
   * When supplied, the chat pipeline must use this already-authorized thread
   * instead of resolving or creating another conversation.
   */
  existingConversationId?: string;
  personality?: string;
  responseLength?: string;
  companyDescription?: string;
  openaiApiKey?: string | null;
  currency?: string;
  currencySymbol?: string;
  customInstructions?: string;
  customerName?: string;
  journeyConversationalGuidelines?: string;
  preferredLanguage?: string;
  visitorSessionId?: string;
  visitorCity?: string;
  visitorToken?: string; // Unique token for conversation history filtering
  isInternalTest?: boolean; // True when business user is testing their own chatbot from dashboard
  skipLeadTraining?: boolean; // True for guidance chatbot - skip lead collection
  starterQAContext?: string; // Pre-formatted Q&A context from guidance conversation starters
  supportsCalendarUI?: boolean; // True when client can render visual calendar for appointment slots
  pageUrl?: string; // Parent page URL where the widget is embedded (for UTM tracking)
  systemMode?: string; // 'full' | 'essential'
  k12EducationEnabled?: boolean;
  k12ContentOnlyMode?: boolean;
  k12VerbatimContentMode?: boolean;
  jobPortalEnabled?: boolean;
  demoOrdersEnabled?: boolean;
  resumeText?: string;
  resumeUrl?: string;
  imageText?: string;
  // Persisted URL of an image the user uploaded with this message (e.g. a K12
  // question photo). Stored on the user message so it renders in the conversation
  // on reload and in the admin Conversations view.
  imageUrl?: string | null;
  isReturnExchangeLookup?: boolean;
  channel?: 'widget' | 'whatsapp' | 'instagram' | 'facebook' | 'other'; // Source channel — OTP gating only runs on 'widget' in v1
  // TopScholar curriculum handoff: cp_id scopes curriculum retrieval; studentName personalizes the tutor.
  topscholarCpId?: string | null;
  topscholarStudentId?: string | null;
  studentName?: string | null;
  // TopScholar doubt-sync: the doubt this AI session is bound to on the client
  // platform (from the signed launch token). When present AND the account is the
  // TopScholar tenant, the conversation is keyed to this doubt, every message is
  // mirrored to the client's conversation-sync API, and the doubt is closed on
  // session end. Undefined/null for every other tenant/session.
  topscholarDoubtId?: string | null;
  topscholarStudentPlanMappingId?: string | null;
  topscholarPlanId?: string | null;
  // Base URL for the client's conversation-sync + doubt-close APIs. null => sync off.
  topscholarDoubtSyncBaseUrl?: string | null;
  // TopScholar grade-scoped widget (Option A): cp_id set resolved from the student's
  // board/medium/grade. null = no scope (whole-account); [] = scope matched nothing (refuse).
  topscholarCpIds?: string[] | null;
  // Human-readable scope labels the portal selected for this student. Used purely
  // to make the tutor *aware* of its scope (e.g. answer "what subject is this?"
  // confidently) — retrieval filtering is driven by topscholarCpIds, not these.
  studentBoard?: string | null;
  studentMedium?: string | null;
  studentGrade?: string | null;
  studentSubject?: string | null;
  // TopScholar: optional chapter narrowing. When supplied, curriculum retrieval is
  // further hard-filtered to this chapter on top of topscholarCpIds.
  studentChapter?: string | null;
  // TopScholar grade-scoped widget: true when a grade-scope (board/medium/grade)
  // was supplied but the mandatory subject is missing. The stream refuses with a
  // "select a subject" message instead of answering whole-grade. Only ever set for
  // the gated TopScholar account; every other tenant leaves it undefined.
  topscholarSubjectMissing?: boolean;
  // TopScholar subject-scoped sessions (Task #14): true only for the curriculum
  // account (set by the widget stream route when getTopscholarConfig().ragEnabled).
  // When true AND a studentSubject is present, the conversation is keyed per
  // subject with a 24h-from-creation lifetime instead of the default single-thread,
  // 30-minute-reuse behavior. Undefined/false for every other tenant.
  topscholarSubjectScoping?: boolean;
  // TopScholar secure mode (Task #17): a hard, student-facing refusal string set by
  // the route when the account requires a signed launch token but none/an incomplete
  // one was supplied. When present, the stream emits this message and refuses to
  // invoke the model. Only ever set for the gated TopScholar account.
  topscholarRefusalMessage?: string | null;
  /**
   * Generate normally but leave assistant persistence to the response-owning
   * transport. Voice uses this so interruption can cancel before commit.
   */
  deferAssistantPersistence?: boolean;
}

// Track active conversation IDs for each user session
const activeConversations = new Map<string, string>();
// Task #14: creation timestamps for subject-scoped (TopScholar) in-memory sessions.
// Only consulted on the no-visitor-token edge path, where the DB reuse query (which
// enforces the 24h-from-creation lifetime) can't run. Keyed by the same sessionKey
// as activeConversations. Process-local — lost on restart (fresh session after).
const subjectScopedSessionCreatedAt = new Map<string, number>();
const SUBJECT_SCOPED_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// TopScholar doubt-sync: per-conversation mirror target (client platform base URL
// + doubtId), resolved once per turn in getOrCreateConversation and consumed in
// storeMessageInDB. Only ever holds entries for the single TopScholar tenant's
// doubt-scoped sessions, so growth is naturally bounded. Process-local — lost on
// restart, in which case that session's remaining messages simply aren't mirrored
// until the next turn repopulates it.
const doubtSyncTargets = new Map<string, { baseUrl: string; doubtId: string }>();

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class ChatService {
  // Track last escalation check per conversation to prevent repeated expensive checks
  private lastEscalationCheck = new Map<string, number>();
  private readonly ESCALATION_CHECK_DEBOUNCE_MS = 5000; // Only check every 5 seconds
  
  // Cache for fallback instructions per business account (used when AI can't answer)
  private fallbackInstructionsCache = new Map<string, string[]>();
  
  // Helper function to extract the last substantive user question
  // Handles mixed messages like "my phone is 9898989898. what are your services?"
  private extractLastSubstantiveQuestion(history: ChatMessage[], currentUserMessage?: string): string {
    // Include current user message in the search
    const allMessages = currentUserMessage 
      ? [...history, { role: 'user' as const, content: currentUserMessage }]
      : history;
    
    const userMessages = allMessages.filter(msg => msg.role === 'user');
    
    // Go backwards through user messages to find the last real question
    for (let i = userMessages.length - 1; i >= 0; i--) {
      const msg = userMessages[i].content.trim();
      
      // CRITICAL: Handle mixed messages (contact info + question)
      // Example: "my phone is 9898989898. what are your services?"
      // Strategy: Remove contact info portions, check if remaining content is substantive
      
      // Remove phone numbers from message
      let cleanedMsg = msg.replace(/\b\+?[\d\s\-()]{7,15}\b/g, '').trim();
      
      // Remove emails from message
      cleanedMsg = cleanedMsg.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, '').trim();
      
      // Remove common contact info filler phrases
      cleanedMsg = cleanedMsg.replace(/\b(my|here('s| is)|the|your)?\s*(phone|mobile|number|whatsapp|contact|email|e-mail|mail|name)(\s+(is|:))?\s*/gi, '').trim();
      cleanedMsg = cleanedMsg.replace(/\b(i'm|i am|called|my name is)\s*/gi, '').trim();
      
      // Remove courtesy/acknowledgment phrases that aren't real questions
      // Remove punctuation for easier matching
      const courtesyFree = cleanedMsg.replace(/[.,!?]/g, '').trim().toLowerCase();
      const isCourtesy = /^(thanks?|thank you|okay|ok|sure|got it|great|nice|good|yes|yep|yeah|yup|fine|perfect|alright|all? ?right)$/i.test(courtesyFree);
      
      // CRITICAL: Check for interrogative cues that indicate a real question
      // If message has question marks or question words, it's substantive even if short
      const hasQuestionMark = /\?/.test(cleanedMsg);
      const hasQuestionWord = /\b(what|why|how|when|where|which|who|whose|whom|can|could|would|should|will|do|does|did|is|are|was|were|tell|show|explain|describe)\b/i.test(cleanedMsg);
      const isInterrogative = hasQuestionMark || hasQuestionWord;
      
      // Check for action/intent words that indicate a real request (not a name)
      const hasActionIntent = /\b(need|want|help|please|price|pricing|cost|tell|show|give|send|get|find|explain|describe|info|information|details|about|regarding)\b/i.test(cleanedMsg);
      
      // STRICT name detection: Only treat as name if it's TRULY just a name
      // Real names: "John Smith", "Mary Jane" (2-3 capitalized words, no verbs/action words)
      // Single words like "Need" or "Pricing" are NOT names
      const words = cleanedMsg.replace(/[.,!?]/g, '').trim().split(/\s+/);
      const looksLikeName = words.length >= 2 &&  // MUST have at least 2 words (first + last name)
                            words.length <= 3 && 
                            words.every(w => /^[A-Z][a-z]+$/.test(w)) && // Each word: Capital + lowercase
                            !isInterrogative && 
                            !hasActionIntent; // No action words
      
      // If cleaned message is empty or just courtesy, skip it
      // BUT: Allow short questions (< 5 chars) if they have interrogative cues like "fees?" or "MBA?"
      if (!cleanedMsg || isCourtesy) {
        console.log(`[Question Extraction] Skipping empty/courtesy: "${msg}"`);
        continue;
      }
      
      // Skip very short messages UNLESS they have a question mark or question word
      if (cleanedMsg.length < 5 && !isInterrogative) {
        console.log(`[Question Extraction] Skipping short non-question: "${msg}"`);
        continue;
      }
      
      // Only skip if it's STRICTLY a name (not capitalized statements)
      if (looksLikeName) {
        console.log(`[Question Extraction] Skipping name-only message: "${msg}"`);
        continue;
      }
      
      // If we have substantial content after removing contact info, use the ORIGINAL message
      // This preserves context while ensuring there's a real question
      // Also allow short interrogative messages like "fees?" or "MBA?"
      if (cleanedMsg.length >= 5 || isInterrogative) {
        console.log(`[Question Extraction] Found substantive question: "${msg}" (cleaned: "${cleanedMsg}", interrogative: ${isInterrogative})`);
        return msg; // Return original message, not cleaned version
      }
    }
    
    console.log('[Question Extraction] No substantive question found in history');
    return ''; // No substantive question found
  }
  
  // Check if required lead fields were just completed (comparing before/after state)
  private async checkLeadCompletionStatus(
    conversationId: string,
    businessAccountId: string,
    widgetSettings: any,
    leadBeforeCapture: any // Lead state BEFORE autoDetectAndCaptureLead ran
  ): Promise<{ justCompleted: boolean }> {
    try {
      // Get lead training config
      const leadTrainingConfig = widgetSettings?.leadTrainingConfig as any;
      if (!leadTrainingConfig || !leadTrainingConfig.fields || !Array.isArray(leadTrainingConfig.fields)) {
        return { justCompleted: false };
      }
      
      // Get required fields with "start" timing
      const requiredStartFields = leadTrainingConfig.fields
        .filter((f: any) => f.enabled && f.required && f.captureStrategy === 'start');
      
      if (requiredStartFields.length === 0) {
        return { justCompleted: false };
      }
      
      // Helper to check if all required fields are present in a lead
      const hasAllRequiredFields = (lead: any) => {
        if (!lead) return false;
        
        return requiredStartFields.every((field: any) => {
          const fieldId = field.id.toLowerCase();
          if (fieldId === 'mobile' || fieldId === 'phone' || fieldId === 'whatsapp') {
            return !!lead.phone;
          } else if (fieldId === 'email') {
            return !!lead.email;
          } else if (fieldId === 'name') {
            return !!lead.name;
          }
          return false;
        });
      };
      
      // Check state before and after
      const wasComplete = hasAllRequiredFields(leadBeforeCapture);
      
      // Get current lead state (after auto-detection)
      const currentLead = await storage.getLeadByConversation(conversationId, businessAccountId);
      const isNowComplete = hasAllRequiredFields(currentLead);
      
      // JUST completed = was incomplete before, but complete now
      const justCompleted = !wasComplete && isNowComplete;
      
      if (justCompleted) {
        console.log('[Lead Completion] Lead state transition detected:');
        console.log('[Lead Completion] Before:', leadBeforeCapture);
        console.log('[Lead Completion] After:', currentLead);
      }
      
      return { justCompleted };
    } catch (error) {
      console.error('[Lead Completion Check] Error:', error);
      return { justCompleted: false };
    }
  }
  
  // Get or create a conversation for the current session
  private async getOrCreateConversation(context: ChatContext): Promise<string> {
    if (context.existingConversationId) {
      const existing = await storage.getConversation(
        context.existingConversationId,
        context.businessAccountId,
      );
      if (!existing) {
        throw new Error('Existing conversation not found or access denied');
      }
      if (
        isTopscholarAccount(context.businessAccountId) &&
        context.topscholarDoubtId &&
        context.topscholarDoubtSyncBaseUrl
      ) {
        doubtSyncTargets.set(existing.id, {
          baseUrl: context.topscholarDoubtSyncBaseUrl,
          doubtId: context.topscholarDoubtId,
        });
      }
      return existing.id;
    }

    // TopScholar secure mode (Task #17): the active-conversation cache and the
    // visitor-token reuse are both bound to the signed-token student so two
    // different students on the SAME device (same userId/visitor token) never
    // collide onto each other's thread. studentId is undefined for all other tenants.
    const studentId = context.topscholarStudentId || null;

    // TopScholar subject-scoped sessions (Task #14): for the curriculum account
    // only, one conversation is kept per subject and resumed for 24h from creation.
    // Switching chapter keeps the thread (chapter is NOT part of the key); switching
    // subject starts a fresh one; returning to a prior subject resumes it. Every
    // other tenant keeps the single-thread, 30-minute-reuse behavior unchanged.
    const subjectScoped = !!context.topscholarSubjectScoping && !!String(context.studentSubject || '').trim();
    const subject = subjectScoped ? String(context.studentSubject).trim() : '';
    // Session identity (TopScholar) = content scope (cp_id, encodes board+medium+
    // grade) + subject + visitor/student. Including cp_id keeps two different scopes
    // that share a subject label (e.g. "Math" in two grades) on separate threads.
    const scopeCpId = subjectScoped ? String(context.topscholarCpId || '').trim() : '';

    // TopScholar doubt-sync: when the launch token carries a doubtId (and this is
    // the curriculum account, guaranteed by topscholarSubjectScoping being gated to
    // the tenant), the doubt is the session identity. Each doubt maps 1:1 to one AI
    // session; the client opens a fresh doubt each time. The doubt key REPLACES the
    // subject/cp_id key so switching chapter/subject within one doubt keeps the same
    // thread, and it shares the 24h-from-creation lifetime.
    const doubtId = subjectScoped ? String(context.topscholarDoubtId || '').trim() : '';
    const doubtScoped = doubtId !== '';

    const sessionKey = doubtScoped
      ? `${context.userId}_${context.businessAccountId}${studentId ? `_${studentId}` : ''}_doubt_${doubtId}`
      : `${context.userId}_${context.businessAccountId}${studentId ? `_${studentId}` : ''}${scopeCpId ? `_cp_${scopeCpId}` : ''}${subject ? `_subj_${subject}` : ''}`;

    // Resolve an existing conversation for this session.
    let conversationId: string | undefined;
    if (subjectScoped) {
      // Always resolve through the DB so the hard 24h-from-creation lifetime is
      // honored — the in-memory cache never expires and would otherwise extend a
      // session indefinitely. Reuse is bound to business + visitor + (student) +
      // subject (or doubtId when present); chapter is deliberately excluded.
      if (context.visitorToken) {
        const reusable = await storage.findReusableConversation(
          context.businessAccountId, context.visitorToken, 24 * 60, studentId,
          doubtScoped ? null : subject, true, doubtScoped ? null : (scopeCpId || null),
          doubtScoped ? doubtId : null,
        );
        if (reusable) {
          conversationId = reusable.id;
          console.log(`[Chat] Reusing ${doubtScoped ? 'doubt-scoped' : 'subject-scoped'} conversation:`, conversationId, doubtScoped ? `doubt:${doubtId}` : `subject:${subject}`);
        }
      } else {
        // No visitor token to dedup on in the DB — best-effort in-memory only, but
        // still honor the 24h-from-creation lifetime (the cache itself never expires).
        const cachedId = activeConversations.get(sessionKey);
        const cachedAt = subjectScopedSessionCreatedAt.get(sessionKey);
        if (cachedId && cachedAt && Date.now() - cachedAt < SUBJECT_SCOPED_SESSION_TTL_MS) {
          conversationId = cachedId;
        } else if (cachedId) {
          // Expired (or unknown age) — drop it so a fresh conversation is created.
          activeConversations.delete(sessionKey);
          subjectScopedSessionCreatedAt.delete(sessionKey);
        }
      }
    } else {
      conversationId = activeConversations.get(sessionKey);
      if (!conversationId && context.visitorToken) {
        const reusable = await storage.findReusableConversation(context.businessAccountId, context.visitorToken, 30, studentId);
        if (reusable) {
          conversationId = reusable.id;
          console.log('[Chat] Reusing existing conversation:', conversationId, 'for visitorToken:', context.visitorToken);
        }
      }
    }

    // TopScholar doubt-sync base URL for this turn (empty for non-doubt sessions).
    const doubtSyncBaseUrl = doubtScoped ? String(context.topscholarDoubtSyncBaseUrl || '').trim() : '';

    if (conversationId) {
      activeConversations.set(sessionKey, conversationId);
      // Refresh the doubt-sync mirror target every turn so message mirroring works
      // even after a process restart mid-session (the token re-supplies doubtId).
      if (doubtScoped && doubtSyncBaseUrl) {
        doubtSyncTargets.set(conversationId, { baseUrl: doubtSyncBaseUrl, doubtId });
      }
      return conversationId;
    }

    {
      // Use customer name if provided, otherwise 'Anonymous'
      const conversationTitle = context.customerName || 'Anonymous';

      // Task #18 + #23: determine whether this conversation must be gated
      // behind OTP verification. Gate is ON when EITHER:
      //   (a) Task #18 counting gate: mobile.otpRequiredForCounting === true
      //   (b) Task #23 pre-chat gate: derivePreChatOtpGate().active === true
      //       (mobile.enabled + captureStrategy='start' + otpEnabled +
      //        MSG91 configured). This closes the bypass where a direct
      //        /api/chat/widget/stream call could create a conversation
      //        without awaitingVerification when pre-chat OTP is configured
      //        but otpRequiredForCounting is off.
      // Internal tests bypass the gate. Fail-open on any error.
      let awaitingVerification = false;
      if (!context.isInternalTest) {
        try {
          const ws = await storage.getWidgetSettings(context.businessAccountId);
          const cfg = ws?.leadTrainingConfig as any;
          const mobileField = cfg?.fields?.find?.((f: any) => f.id === 'mobile');
          const countingGate =
            mobileField?.enabled &&
            mobileField?.captureStrategy === 'start' &&
            mobileField?.otpEnabled === true &&
            mobileField?.otpRequiredForCounting === true;
          // Task #23 (provider-readiness): both the counting gate and the
          // pre-chat gate must check that MSG91 is actually configured before
          // flagging the conversation awaiting_verification. Otherwise, if
          // creds become unavailable after settings were cached, /otp/start
          // returns { gate:false } (fallback) but /stream would still lock
          // the conversation into awaiting_verification and the SSE refusal
          // path (~line 2721-2735) would silently dead-end every message.
          if (countingGate || context.channel === 'widget') {
            try {
              const { OtpService, derivePreChatOtpGate } = await import('./services/otp');
              if (countingGate) {
                const providerOk = await OtpService.isProviderConfigured(context.businessAccountId);
                if (providerOk) awaitingVerification = true;
              } else {
                // Defense in depth against /stream bypassing /otp/start when
                // the pre-chat gate (Task #23) is on but counting gate is off.
                const preChatGate = await derivePreChatOtpGate(context.businessAccountId);
                if (preChatGate.active) awaitingVerification = true;
              }
            } catch (innerErr) {
              console.warn('[Chat] OTP gate provider/readiness check failed; defaulting to no gate:', innerErr);
            }
          }
        } catch (err) {
          console.warn('[Chat] awaitingVerification lookup failed; defaulting to false:', err);
        }
      }

      // Create a new conversation in the database
      const conversation = await storage.createConversation({
        businessAccountId: context.businessAccountId,
        title: conversationTitle,
        visitorCity: context.visitorCity || null,
        visitorToken: context.visitorToken || null,
        isInternalTest: context.isInternalTest ? 'true' : 'false',
        awaitingVerification,
        topscholarCpId: context.topscholarCpId || null,
        studentId: context.topscholarStudentId || null,
        studentName: context.studentName || null,
        // Task #14: stamp the subject only for subject-scoped (TopScholar) chats so
        // the thread can be located and resumed; null for every other tenant.
        subject: subjectScoped ? subject : null,
        // TopScholar doubt-sync: stamp the doubtId (and studentPlanMappingId) so the
        // session is locatable by doubt and messages can be mirrored/closed. Only
        // set for doubt-scoped TopScholar chats; null for every other tenant.
        topscholarDoubtId: doubtScoped ? doubtId : null,
        topscholarStudentPlanMappingId: doubtScoped ? (context.topscholarStudentPlanMappingId || null) : null,
        topscholarPlanId: doubtScoped ? (context.topscholarPlanId || null) : null,
      });
      conversationId = conversation.id;
      activeConversations.set(sessionKey, conversationId);
      // Task #14: record creation time so the no-token subject-scoped path can
      // enforce the 24h lifetime against the otherwise-never-expiring in-memory cache.
      if (subjectScoped) subjectScopedSessionCreatedAt.set(sessionKey, Date.now());
      // TopScholar doubt-sync: register the mirror target for the new conversation.
      if (doubtScoped && doubtSyncBaseUrl) {
        doubtSyncTargets.set(conversationId, { baseUrl: doubtSyncBaseUrl, doubtId });
      }
      
      console.log('[Chat] Created new conversation:', conversationId, 'for:', conversationTitle, 'city:', context.visitorCity || 'unknown', 'visitorToken:', context.visitorToken ? 'present' : 'none');
    }
    
    return conversationId!;
  }

  // Store message in database
  // Skip for temp conversations (spam detection)
  private async storeMessageInDB(
    conversationId: string, 
    role: 'user' | 'assistant', 
    content: string,
    metadata?: { productIds?: string[] },
    imageUrl?: string | null
  ): Promise<void> {
    // Skip DB storage for temporary spam conversations
    if (conversationId.startsWith('temp_')) {
      return;
    }
    
    try {
      await storage.createMessage({
        conversationId,
        role,
        content,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
        interactionSource: 'chat',
        ...(imageUrl ? { imageUrl } : {}),
      });
      
      // Update conversation timestamp
      await storage.updateConversationTimestamp(conversationId);

      // TopScholar doubt-sync: mirror this message to the client platform's
      // conversation-sync API. Only fires when this conversation is a doubt-scoped
      // TopScholar session (target populated in getOrCreateConversation); no-op for
      // every other tenant. Fire-and-forget — never blocks or fails the chat.
      this.mirrorMessageToDoubt(conversationId, role, content);
    } catch (error) {
      console.error('[Chat] Error storing message in DB:', error);
    }
  }

  async commitDeferredAssistantMessage(
    context: ChatContext,
    content: string,
    stillCurrent: () => boolean,
  ): Promise<string | null> {
    const conversationId = context.existingConversationId;
    if (!conversationId || !stillCurrent()) return null;

    const existing = await storage.getConversation(conversationId, context.businessAccountId);
    if (!existing || !stillCurrent()) return null;

    let messageId: string | null = null;
    try {
      const message = await storage.createMessage({
        conversationId,
        role: 'assistant',
        content,
        interactionSource: 'chat',
      });
      messageId = message.id;

      if (!stillCurrent()) {
        await storage.deleteMessage(message.id, context.businessAccountId);
        return null;
      }

      await storage.updateConversationTimestamp(conversationId);
      if (!stillCurrent()) {
        await storage.deleteMessage(message.id, context.businessAccountId);
        return null;
      }

      conversationMemory.storeMessage(context.userId, 'assistant', content);
      this.mirrorMessageToDoubt(conversationId, 'assistant', content);
      return message.id;
    } catch (error) {
      if (messageId && !stillCurrent()) {
        try {
          await storage.deleteMessage(messageId, context.businessAccountId);
        } catch (rollbackError) {
          console.error('[Chat] Failed to roll back abandoned deferred assistant message:', rollbackError);
        }
      }
      console.error('[Chat] Error committing deferred assistant message:', error);
      throw error;
    }
  }

  async rollbackDeferredAssistantMessage(
    context: ChatContext,
    messageId: string,
    content: string,
  ): Promise<void> {
    try {
      await storage.deleteMessage(messageId, context.businessAccountId);
    } finally {
      conversationMemory.removeLastMatchingMessage(context.userId, 'assistant', content);
    }
  }

  // TopScholar doubt-sync: push a stored message to the client platform. The
  // target (baseUrl + doubtId) is resolved once per turn in getOrCreateConversation
  // and cached by conversationId, so this is a cheap Map lookup for the common
  // (non-TopScholar) case. Fire-and-forget: failures are logged, never thrown.
  private mirrorMessageToDoubt(conversationId: string, role: 'user' | 'assistant', content: string): void {
    const target = doubtSyncTargets.get(conversationId);
    if (!target) return;
    const text = String(content || '').trim();
    if (!text) return;
    // Student is the visitor (user); the AI answers as the SME (subject-matter expert).
    const from: DoubtSyncSender = role === 'user' ? 'student' : 'sme';
    void pushTextMessage(target.baseUrl, target.doubtId, from, text).catch((err) => {
      console.warn('[Chat] TopScholar doubt-sync message mirror failed (non-fatal):', err?.message || err);
    });
  }

  // Generate a short conversation title from the first user message
  private async generateConversationTitle(userMessage: string, apiKey: string): Promise<string> {
    try {
      const openai = new OpenAI({ apiKey });
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Generate a very short 2-4 word title that summarizes the user\'s question or topic. No punctuation. Be concise and descriptive. Examples: "Product Pricing", "Delivery Options", "Account Setup", "Order Status"'
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 20,
        temperature: 0.3
      });
      
      const title = response.choices[0]?.message?.content?.trim() || 'New Chat';
      console.log('[Chat] Generated conversation title:', title);
      return title;
    } catch (error) {
      console.error('[Chat] Error generating title:', error);
      return 'New Chat';
    }
  }

  // Simple AI response for spam/gibberish messages - no DB, no tools, just natural response
  private async getSimpleAIResponse(userMessage: string, context: ChatContext): Promise<string> {
    try {
      const openai = new OpenAI({ apiKey: context.openaiApiKey! });
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a friendly customer support assistant for ${context.companyDescription || 'a business'}. The user's message appears unclear or may contain a typo. Politely ask them to clarify what they need help with. Keep your response brief and helpful.`
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 150,
        temperature: 0.7
      });
      
      return response.choices[0]?.message?.content?.trim() || "I'm sorry, I didn't quite understand that. Could you please rephrase your question?";
    } catch (error) {
      console.error('[Chat] Error in simple AI response:', error);
      return "I'm sorry, I didn't quite understand that. Could you please rephrase your question?";
    }
  }

  // Update conversation title if it's still the default "Anonymous" or "New Chat"
  private async maybeUpdateConversationTitle(
    conversationId: string, 
    businessAccountId: string, 
    userMessage: string, 
    apiKey: string
  ): Promise<void> {
    try {
      // Get current conversation to check title
      const conversation = await storage.getConversation(conversationId, businessAccountId);
      if (!conversation) return;
      
      // Only update if title is still "Anonymous" or "New Chat"
      if (conversation.title === 'Anonymous' || conversation.title === 'New Chat') {
        const newTitle = await this.generateConversationTitle(userMessage, apiKey);
        await storage.updateConversationTitle(conversationId, businessAccountId, newTitle);
        console.log('[Chat] Updated conversation title from:', conversation.title, 'to:', newTitle);
      }
    } catch (error) {
      console.error('[Chat] Error updating conversation title:', error);
    }
  }

  // Helper method to detect if AI response is a deflection/generic response
  // PRIMARY: Check for [[FALLBACK]] marker (AI-driven detection)
  // BACKUP: Pattern matching for edge cases where AI didn't use marker
  private isDeflectionResponse(response: string): boolean {
    // PRIMARY: AI-driven detection via [[FALLBACK]] marker
    if (response.includes('[[FALLBACK]]')) {
      console.log('[Deflection] Detected via [[FALLBACK]] marker');
      return true;
    }
    
    // BACKUP: Pattern-based detection for edge cases
    // BROADER PATTERNS: Use .*? to allow words between key phrases (e.g., "specific fee information")
    const deflectionPatterns = [
      // "I don't have [anything] information/details/data" - catches all variations
      /I don't have .*?(information|details|data|pricing|info)/i,
      /I don't have .*?(available|on that|about that|for that)/i,
      // "I cannot/can't [anything]" patterns
      /I (can't|cannot) .*?(answer|help|provide|find|assist)/i,
      // "I don't know" patterns
      /I don't know .*?(about|if|whether|the|that)/i,
      /I don't know\b/i,
      // Uncertainty patterns
      /I'm not sure .*?(about|if|whether|what)/i,
      /I'm not sure\b/i,
      // Outside knowledge patterns
      /that's (outside|beyond) .*?(knowledge|expertise|information)/i,
      /I'm (not|unable to) (familiar with|aware of)/i,
      // Couldn't find patterns
      /I couldn't find .*?(information|details|data|anything)/i,
      // Apologetic deflections
      /unfortunately.*?I (don't|can't|cannot)/i,
      /I apologize.*?(don't|can't|cannot|couldn't)/i,
      // Simple "no information" patterns
      /no (specific |particular )?(information|details|data) (available|on|about)/i,
    ];
    
    const isPatternMatch = deflectionPatterns.some(pattern => pattern.test(response));
    if (isPatternMatch) {
      console.log('[Deflection] Detected via backup pattern matching');
    }
    return isPatternMatch;
  }
  
  // Strip [[FALLBACK]] marker from response content
  // NOTE: Do not trim() here as it removes spaces from streaming chunks
  private stripFallbackMarker(response: string): string {
    return response.replace(/\[\[FALLBACK\]\]\s*/g, '');
  }
  
  // Process conditional placeholders in fallback templates based on lead data
  // Supports: {{if_missing_phone}}...{{/if_missing_phone}}, {{if_has_phone}}...{{/if_has_phone}}
  // Also: {{if_missing_email}}, {{if_has_email}}, {{if_missing_name}}, {{if_has_name}}
  private processFallbackPlaceholders(template: string, existingLead: any): string {
    let processed = template;
    
    // Define field mappings: placeholder field name -> lead property
    const fieldMappings: Record<string, string> = {
      'phone': 'phone',
      'mobile': 'phone',
      'email': 'email',
      'name': 'name',
      'whatsapp': 'phone'
    };
    
    // Process each field type
    for (const [placeholderField, leadProperty] of Object.entries(fieldMappings)) {
      const hasValue = existingLead?.[leadProperty] && existingLead[leadProperty].trim() !== '';
      
      // Pattern for {{if_missing_X}}...{{/if_missing_X}}
      const missingPattern = new RegExp(
        `\\{\\{if_missing_${placeholderField}\\}\\}([\\s\\S]*?)\\{\\{\\/if_missing_${placeholderField}\\}\\}`,
        'gi'
      );
      
      // Pattern for {{if_has_X}}...{{/if_has_X}}
      const hasPattern = new RegExp(
        `\\{\\{if_has_${placeholderField}\\}\\}([\\s\\S]*?)\\{\\{\\/if_has_${placeholderField}\\}\\}`,
        'gi'
      );
      
      if (hasValue) {
        // Lead has this field: remove if_missing blocks, keep if_has content
        processed = processed.replace(missingPattern, '');
        processed = processed.replace(hasPattern, '$1');
      } else {
        // Lead is missing this field: keep if_missing content, remove if_has blocks
        processed = processed.replace(missingPattern, '$1');
        processed = processed.replace(hasPattern, '');
      }
    }
    
    // Clean up any double spaces or extra newlines from removed blocks
    processed = processed.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
    
    console.log(`[Fallback Placeholders] Processed template. Lead has phone: ${!!existingLead?.phone}, email: ${!!existingLead?.email}, name: ${!!existingLead?.name}`);
    
    return processed;
  }
  
  // Enhanced fallback message with business context and sales-oriented approach
  // Gathers business info and generates a helpful response while preserving lead capture intent
  // Now accepts existingLead to ensure AI doesn't ask for contact info that already exists
  private async rephraseFallbackMessage(
    template: string, 
    userQuestion: string,
    businessAccountId: string,
    apiKey?: string,
    existingLead?: any
  ): Promise<string> {
    // Determine what contact info the lead already has (outside try so available in catch)
    const hasPhone = !!(existingLead?.phone && existingLead.phone.trim());
    const hasEmail = !!(existingLead?.email && existingLead.email.trim());
    const hasName = !!(existingLead?.name && existingLead.name.trim());
    
    // SAFETY NET: Strip phone/mobile/WhatsApp requests from template if phone already captured
    // This prevents asking for phone again even if the fallback template doesn't use {{if_has_phone}} guards
    // Hoisted outside try block so it's available in catch for error fallback
    let processedTemplate = template;
    if (hasPhone) {
      // Remove sentences asking for phone/mobile/WhatsApp
      processedTemplate = processedTemplate
        .replace(/[^.]*\b(share|provide|give|send|tell|have)\b[^.]*\b(phone|mobile|whatsapp|cell)\b[^.]*[.!?]?\s*/gi, '')
        .replace(/[^.]*\b(phone|mobile|whatsapp|cell)\b[^.]*\b(number)\b[^.]*[.!?]?\s*/gi, '')
        .trim();
      if (processedTemplate !== template) {
        console.log('[Fallback Rephrase] Stripped phone request from template since phone already captured');
      }
    }
    if (hasEmail) {
      // Remove sentences asking for email
      processedTemplate = processedTemplate
        .replace(/[^.]*\b(share|provide|give|send|tell|have)\b[^.]*\b(email)\b[^.]*[.!?]?\s*/gi, '')
        .trim();
      if (processedTemplate !== template) {
        console.log('[Fallback Rephrase] Stripped email request from template since email already captured');
      }
    }
    
    try {
      // Build restriction message for AI
      let contactRestrictions = '';
      const alreadyHas: string[] = [];
      if (hasPhone) alreadyHas.push('phone/mobile number');
      if (hasEmail) alreadyHas.push('email');
      if (hasName) alreadyHas.push('name');
      
      if (alreadyHas.length > 0) {
        contactRestrictions = `\n\nCRITICAL: The user has ALREADY provided their ${alreadyHas.join(', ')}. Do NOT ask for ${alreadyHas.join(' or ')} again under any circumstances.`;
      }
      
      // Gather business context from multiple sources
      const [businessAccount, allFaqs] = await Promise.all([
        storage.getBusinessAccount(businessAccountId),
        storage.getAllFaqs(businessAccountId)
      ]);
      
      // Get business description and name
      const businessDescription = businessAccount?.description?.trim() || '';
      const businessName = businessAccount?.name?.trim() || '';
      
      // Search FAQs for "about us" type content (general business info)
      // Safely handle null/empty FAQ fields
      const aboutKeywords = ['about', 'who we are', 'company', 'business', 'services', 'what we do', 'offer', 'specialize'];
      const aboutFaqs = allFaqs.filter(faq => {
        const questionLower = (faq.question || '').toLowerCase();
        const answerLower = (faq.answer || '').toLowerCase();
        if (!questionLower && !answerLower) return false;
        return aboutKeywords.some(keyword => 
          questionLower.includes(keyword) || answerLower.includes(keyword)
        );
      }).slice(0, 2); // Take top 2 relevant FAQs
      
      // Build business context string - skip empty sections
      let businessContext = '';
      if (businessDescription) {
        businessContext += `Business Overview: ${businessDescription}\n`;
      }
      if (aboutFaqs.length > 0) {
        businessContext += 'General Business Info:\n';
        aboutFaqs.forEach(faq => {
          if (faq.question && faq.answer) {
            const truncatedAnswer = faq.answer.length > 200 ? faq.answer.substring(0, 200) + '...' : faq.answer;
            businessContext += `- ${faq.question}: ${truncatedAnswer}\n`;
          }
        });
      }
      
      // If we have business context, generate enhanced response
      if (businessContext.trim()) {
        console.log('[Fallback Rephrase] Found business context, generating sales-oriented response. Lead has phone:', hasPhone, 'email:', hasEmail);
        
        const response = await llamaService.generateSimpleResponse(
          `You are a helpful sales assistant for ${businessName || 'this business'}. You want to be helpful and keep the user engaged.

USER'S QUESTION: "a question outside the scope of this business"

BUSINESS CONTEXT (use this to sound knowledgeable):
${businessContext}

FALLBACK MESSAGE TO USE AS BASE:
${processedTemplate}${contactRestrictions}

🚨 CRITICAL - BANNED PHRASES (NEVER USE):
❌ "I don't have information about..."
❌ "I don't have specific information..."
❌ "I don't know..."
❌ "I'm not sure about..."
❌ "I cannot answer that..."

Generate a response that:
1. Stays POSITIVE - acknowledge their interest without admitting any limitations
2. Redirects gracefully - offer to connect them with the team who can help
3. Shares 1-2 relevant highlights about YOUR business (be helpful, not salesy)
4. Follow the fallback message intent EXACTLY - only ask for contact info if it appears in the fallback message above

EXAMPLE - WRONG: "I don't have specific information about MBBS, but..."
EXAMPLE - RIGHT: "That's an interesting area! I'd be happy to connect you with our team who can guide you on this."

Keep it natural, conversational, and under 3 sentences. Sound confident and solution-oriented.`,
          apiKey
        );
        
        if (response && response.trim()) {
          const trimmed = response.trim();
          if (!/[.!?]['"]?$/.test(trimmed)) {
            console.warn('[Fallback Rephrase] Truncated response detected (no sentence end), using template directly');
            return processedTemplate;
          }
          console.log('[Fallback Rephrase] Successfully generated enhanced message with business context');
          return trimmed;
        }
      }
      
      // No business context available - fall back to simple rephrasing
      console.log('[Fallback Rephrase] No business context, using simple rephrasing. Lead has phone:', hasPhone, 'email:', hasEmail);
      const response = await llamaService.generateSimpleResponse(
        `You are a helpful assistant. Rephrase the following message in a natural, conversational way while keeping the EXACT same meaning and intent.

The user asked: "a question outside the scope of this business"

Message to rephrase:
${processedTemplate}${contactRestrictions}

🚨 BANNED PHRASES (NEVER USE):
❌ "I don't have information..."
❌ "I don't know..."
❌ "I'm not sure..."

Rephrased message (keep it concise, same length, same intent, stay POSITIVE - never say "I don't have" or "I don't know"):`,
        apiKey
      );
      
      if (response && response.trim()) {
        const trimmed = response.trim();
        if (!/[.!?]['"]?$/.test(trimmed)) {
          console.warn('[Fallback Rephrase] Truncated response detected (no sentence end), using template directly');
          return processedTemplate;
        }
        console.log('[Fallback Rephrase] Successfully varied message');
        return trimmed;
      }
      return processedTemplate;
    } catch (error) {
      console.error('[Fallback Rephrase] Error, using sanitized template:', error);
      return processedTemplate;
    }
  }
  
  // AI-driven post-capture response generation
  // Instead of complex branching logic, let AI naturally handle the conversation after lead capture
  private async generatePostCaptureResponse(
    originalQuestion: string | null,
    capturedData: { phone?: string; email?: string; name?: string },
    previousAIResponse: string | null,
    businessAccountId: string,
    apiKey?: string
  ): Promise<string> {
    try {
      // Check if previous response was asking for contact info
      // If YES: The AI already addressed the question (or said team will help), so just confirm handoff
      // NO AI CALL NEEDED - hardcoded response is more reliable and faster
      const previousAskedForContact = previousAIResponse && this.isContactRequestMessage(previousAIResponse);
      
      if (previousAskedForContact) {
        // SIMPLE HANDOFF CONFIRMATION - no AI needed, no risk of re-addressing the question
        console.log('[Post-Capture] Previous asked for contact - using simple confirmation (no AI call)');
        return "Thank you for sharing your details! Our team will reach out to you shortly with the information you need. Feel free to ask if you have any other questions!";
      }
      
      // For other cases (e.g., start-timing where AI asked for contact before answering),
      // use AI to generate a contextual response
      const capturedFields: string[] = [];
      if (capturedData.phone) capturedFields.push(`phone: ${capturedData.phone}`);
      if (capturedData.email) capturedFields.push(`email: ${capturedData.email}`);
      if (capturedData.name) capturedFields.push(`name: ${capturedData.name}`);
      
      const prompt = `You just captured the user's contact information.

CAPTURED: ${capturedFields.join(', ') || 'contact info'}

Generate a brief, warm response (1-2 sentences) that:
1. Thanks them for sharing their contact
2. Confirms our team will reach out with the details they need
3. Invites them to ask other questions

Do NOT try to answer any previous questions - just confirm the handoff.

Response:`;

      const response = await llamaService.generateSimpleResponse(prompt, apiKey);
      
      if (response && response.trim()) {
        console.log('[Post-Capture AI] Generated natural response');
        return response.trim();
      }
      
      // Fallback if AI fails
      return "Thank you for sharing your details! Our team will reach out to you shortly with the information you need.";
    } catch (error) {
      console.error('[Post-Capture AI] Error generating response:', error);
      return "Thank you for sharing your details! Our team will reach out to you shortly with the information you need.";
    }
  }
  
  // Check if a message is asking for contact information (typical fallback response)
  // Used to avoid re-processing questions that already hit fallback
  private isContactRequestMessage(message: string): boolean {
    if (!message) return false;
    const lowerMessage = message.toLowerCase();
    
    // Common patterns in fallback messages that ask for contact info
    const contactRequestPatterns = [
      /share.*(your|contact|phone|mobile|number|email|whatsapp)/i,
      /provide.*(your|contact|phone|mobile|number|email|whatsapp)/i,
      /give.*(your|contact|phone|mobile|number|email|whatsapp)/i,
      /(phone|mobile|email|whatsapp|contact).*(number|address|info|details)/i,
      /reach out to you/i,
      /get back to you/i,
      /contact you/i,
      /our team can (call|contact|reach|help)/i,
      /so we can (call|contact|reach|help)/i,
    ];
    
    return contactRequestPatterns.some(pattern => pattern.test(lowerMessage));
  }
  
  // Check if a message is a "handoff confirmation" - AI confirmed team will reach out
  // This is the POST-capture state where the question has been "resolved" (handed to human team)
  private isHandoffConfirmationMessage(message: string): boolean {
    if (!message) return false;
    
    // Patterns that indicate the conversation has been "handed off" to human team
    const handoffPatterns = [
      /team will (reach out|contact|get back|call|help)/i,
      /(will|shall) (reach out|contact|get back|call)/i,
      /someone (will|from our team)/i,
      /we('ll| will) (be in touch|contact you|reach out|get back)/i,
      /expect.*(call|contact|hear from)/i,
      /thank.*(for sharing|for providing|for your).*(contact|number|phone|details)/i,
    ];
    
    return handoffPatterns.some(pattern => pattern.test(message));
  }
  
  // Check if a user message is a simple acknowledgement (yes, ok, thanks, etc.)
  private isSimpleAcknowledgement(message: string): boolean {
    if (!message) return false;
    const cleaned = message.replace(/[.,!?]/g, '').trim().toLowerCase();
    
    // Simple acknowledgement patterns
    const ackPatterns = /^(yes|yeah|yep|yup|ok|okay|sure|fine|alright|all ?right|great|good|nice|perfect|thanks?|thank you|got it|understood|cool|awesome)$/i;
    
    return ackPatterns.test(cleaned);
  }
  
  // RELEVANCE GATE: Validates if FAQ/product results actually match the user's query
  // Returns relevance score (0-100). Gate threshold is 40% - below this, route to fallback template
  private checkRelevance(
    userQuery: string, 
    result: { question?: string; answer?: string; name?: string; description?: string },
    resultType: 'faq' | 'product'
  ): { score: number; isRelevant: boolean; reason: string } {
    const RELEVANCE_THRESHOLD = 40; // Minimum score to consider result relevant
    
    const queryLower = userQuery.toLowerCase().trim();
    const queryWords = this.extractKeyTerms(queryLower);
    
    if (queryWords.length === 0) {
      return { score: 0, isRelevant: false, reason: 'No key terms in query' };
    }
    
    // Get text to match against based on result type
    let targetText = '';
    if (resultType === 'faq') {
      targetText = `${result.question || ''} ${result.answer || ''}`.toLowerCase();
    } else {
      targetText = `${result.name || ''} ${result.description || ''}`.toLowerCase();
    }
    
    // Calculate relevance score
    let score = 0;
    let matchedTerms: string[] = [];
    let missedHighPriorityTerms: string[] = [];
    
    for (const term of queryWords) {
      const weight = this.getTermWeight(term);
      if (targetText.includes(term)) {
        score += weight;
        matchedTerms.push(term);
      } else if (weight >= 15) {
        // Track missed high-priority terms
        missedHighPriorityTerms.push(term);
      }
    }
    
    // Normalize score to 0-100 range
    const maxPossibleScore = queryWords.reduce((sum, term) => sum + this.getTermWeight(term), 0);
    const normalizedScore = maxPossibleScore > 0 ? Math.round((score / maxPossibleScore) * 100) : 0;
    
    // Special case: If a high-priority domain term is missing, penalize heavily
    // E.g., user asks about "fee" but FAQ is about "duration" - that's a mismatch
    if (missedHighPriorityTerms.length > 0 && normalizedScore < 70) {
      const penalty = missedHighPriorityTerms.length * 15;
      const penalizedScore = Math.max(0, normalizedScore - penalty);
      return {
        score: penalizedScore,
        isRelevant: penalizedScore >= RELEVANCE_THRESHOLD,
        reason: `Missing key terms: ${missedHighPriorityTerms.join(', ')}. Matched: ${matchedTerms.join(', ') || 'none'}`
      };
    }
    
    return {
      score: normalizedScore,
      isRelevant: normalizedScore >= RELEVANCE_THRESHOLD,
      reason: `Matched ${matchedTerms.length}/${queryWords.length} terms: ${matchedTerms.join(', ') || 'none'}`
    };
  }
  
  // Extract key terms from a query, filtering out stopwords and short words
  private extractKeyTerms(query: string): string[] {
    const stopwords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below', 'between',
      'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
      'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
      'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
      'am', 'about', 'also', 'how', 'why', 'when', 'where', 'please', 'tell', 'know',
      'want', 'like', 'get', 'give', 'show', 'find', 'help', 'looking'
    ]);
    
    const words = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 2 && !stopwords.has(word));
    
    return Array.from(new Set(words)); // Remove duplicates
  }
  
  // Get weight for a term - domain-specific terms get higher weight
  private getTermWeight(term: string): number {
    // High-priority domain keywords (20 points) - these MUST match
    const highPriorityTerms = new Set([
      'fee', 'fees', 'price', 'pricing', 'cost', 'costs', 'payment', 'tuition',
      'duration', 'length', 'years', 'months', 'semesters',
      'eligibility', 'eligible', 'qualification', 'requirements', 'criteria',
      'admission', 'admissions', 'apply', 'application', 'enroll', 'enrollment',
      'scholarship', 'scholarships', 'discount', 'offer', 'offers',
      'syllabus', 'curriculum', 'subjects', 'courses', 'modules',
      'placement', 'placements', 'job', 'jobs', 'career', 'careers',
      'certificate', 'degree', 'diploma', 'certification',
      'accreditation', 'accredited', 'recognition', 'approved',
      'deadline', 'last', 'date', 'dates', 'schedule',
      'faculty', 'teachers', 'professors', 'instructors',
      'exam', 'exams', 'examination', 'test', 'tests', 'assessment'
    ]);
    
    // Medium-priority terms (10 points)
    const mediumPriorityTerms = new Set([
      'online', 'offline', 'distance', 'regular', 'part-time', 'full-time',
      'mba', 'bba', 'mca', 'bca', 'pgdm', 'diploma', 'bachelor', 'master',
      'specialization', 'specializations', 'stream', 'branch',
      'semester', 'year', 'batch', 'intake', 'session',
      'process', 'procedure', 'steps', 'documents', 'documentation',
      'support', 'contact', 'helpline', 'assistance'
    ]);
    
    // Low-priority generic terms (5 points) - these alone shouldn't match
    const lowPriorityTerms = new Set([
      'structure', 'system', 'program', 'programme', 'course',
      'information', 'details', 'about', 'regarding', 'related',
      'yearly', 'monthly', 'annual', 'total', 'complete'
    ]);
    
    if (highPriorityTerms.has(term)) return 20;
    if (mediumPriorityTerms.has(term)) return 10;
    if (lowPriorityTerms.has(term)) return 5;
    return 8; // Default weight for unknown terms
  }
  
  // Check if user message is a substantive question that needs knowledge base info
  private isSubstantiveQuestion(message: string): boolean {
    const trimmed = message.trim().toLowerCase();
    
    // Short greetings and small talk - NEVER substantive, always bypass
    const casualPatterns = [
      /^(hi|hey|hello|yo|sup|hiya|howdy)[\s!?.]*$/i,
      /^(good|gm|gn)\s*(morning|afternoon|evening|night)[\s!?.]*$/i,
      /^(how are you|what's up|wassup|whats up)[\s!?.]*$/i,
      /^(thanks|thank you|thx|ty)[\s!?.]*$/i,
      /^(ok|okay|sure|great|cool|nice|awesome)[\s!?.]*$/i,
      /^(bye|goodbye|see you|later|cya)[\s!?.]*$/i,
      /^(yes|no|yeah|yep|nope|nah)[\s!?.]*$/i,
    ];
    
    if (casualPatterns.some(pattern => pattern.test(trimmed))) {
      return false;
    }
    
    // Business-related keywords - these ARE substantive even if short
    // Comprehensive list covering common business inquiries
    const businessKeywords = [
      // Pricing & costs
      /price|pricing|cost|rate|fee|charge|payment/i,
      // Logistics & delivery
      /shipping|delivery|ship|track|tracking|dispatch/i,
      // Returns & refunds
      /return|refund|exchange|cancel|cancellation/i,
      // Warranties & guarantees
      /warranty|guarantee|repair|fix/i,
      // Availability & stock
      /stock|inventory|available|availability|in\s*stock|out\s*of\s*stock/i,
      // Promotions & discounts
      /discount|sale|offer|deal|promo|promotion|coupon/i,
      // Product details
      /size|sizing|dimension|measure|specification|specs/i,
      /material|fabric|made of|ingredients/i,
      /color|colour|style|design/i,
      /product|item|model|version|variant/i,
      // Purchasing & orders
      /order|purchase|buy|checkout|cart/i,
      // Contact & business info
      /contact|phone|email|address|location|hours|open|close|store/i,
      // Policies
      /policy|policies|terms|conditions/i,
      // Support & help
      /support|assist|help me|question|issue|problem/i,
      // Appointments & booking
      /appointment|book|booking|schedule|reserve|reservation|slot|time/i,
      // Services
      /service|services|consultation|quote|estimate/i,
      // Catalog & browsing
      /catalog|catalogue|menu|list|show me|browse/i,
      // Comparison & info
      /compare|comparison|difference|versus|vs\b|feature/i,
      // Membership & accounts
      /membership|account|register|sign up|login|member/i,
    ];
    
    if (businessKeywords.some(pattern => pattern.test(trimmed))) {
      return true;
    }
    
    // Check for question indicators (question marks, question words)
    const hasQuestionMark = trimmed.includes('?');
    const hasQuestionWord = /^(what|where|when|who|why|how|can|could|would|is|are|do|does|will|should)/i.test(trimmed);
    const hasInquiryPhrase = /(tell me|explain|describe|show me|looking for|need|want to know)/i.test(trimmed);
    
    // If it's clearly a question, it's substantive
    if (hasQuestionMark || hasQuestionWord || hasInquiryPhrase) {
      return true;
    }
    
    // Longer messages (>15 chars) that aren't casual are likely substantive
    return trimmed.length > 15;
  }

  // Helper method to auto-categorize questions
  private categorizeQuestion(question: string): string {
    const lowerQuestion = question.toLowerCase();
    
    if (lowerQuestion.includes('price') || lowerQuestion.includes('cost') || lowerQuestion.includes('how much')) {
      return 'Pricing';
    }
    if (lowerQuestion.includes('feature') || lowerQuestion.includes('what is') || lowerQuestion.includes('what are')) {
      return 'Features';
    }
    if (lowerQuestion.includes('how') || lowerQuestion.includes('setup') || lowerQuestion.includes('configure')) {
      return 'Technical';
    }
    if (lowerQuestion.includes('when') || lowerQuestion.includes('delivery') || lowerQuestion.includes('shipping')) {
      return 'Logistics';
    }
    
    return 'General';
  }

  // Helper method to save unanswered question to Question Bank
  private async saveToQuestionBank(
    businessAccountId: string,
    conversationId: string,
    userMessage: string,
    aiResponse: string,
    messageId?: string
  ): Promise<void> {
    try {
      await storage.createQuestionBankEntry({
        businessAccountId,
        conversationId,
        messageId: messageId || null,
        question: userMessage,
        aiResponse,
        userContext: null,
        status: 'new',
        category: this.categorizeQuestion(userMessage),
        confidenceScore: null,
      });
      console.log('[Question Bank] Auto-saved unanswered question:', userMessage.substring(0, 50));
    } catch (error) {
      console.error('[Question Bank] Error saving to question bank:', error);
    }
  }

  // Conversion tracking (Google Ads): decide whether the widget should fire the
  // hidden conversion iframe for this conversation right now, and atomically claim
  // the one-time fire. Returns true at most ONCE per conversation. Bails early
  // (no write) when no conversion URL is configured or no mobile number has been
  // captured yet. The URL itself is NEVER fetched here — the server only flips the
  // dedupe marker; the actual page load happens in the visitor's browser.
  private async maybeFireConversion(conversationId: string, businessAccountId: string): Promise<boolean> {
    return claimConversionFire(conversationId, businessAccountId);
  }

  // INSTANT PROGRESSIVE LEAD CAPTURE: Backend auto-detection
  // Deterministically captures phone/email from messages to ensure zero data loss
  // Works alongside AI tool calls as a safety net
  private async autoDetectAndCaptureLead(
    userMessage: string,
    conversationId: string,
    businessAccountId: string,
    lastAIMessage?: string,
    visitorCity?: string,
    visitorSessionId?: string,
    pageUrl?: string,
    channel?: 'widget' | 'whatsapp' | 'instagram' | 'facebook' | 'other'
  ): Promise<void> {
    try {
      // Get widget settings to check phone validation config
      const widgetSettings = await storage.getWidgetSettings(businessAccountId);
      const leadConfig = widgetSettings?.leadTrainingConfig as any;
      
      // Get phone validation setting (check mobile field first, then whatsapp)
      let phoneValidation: '10' | '12' | '8-12' | 'any' = '10'; // Default to 10 digits
      let otpEnabledForMobile = false;
      let captchaEnabledForMobile = false;
      let sendUnverifiedLeadsToCrm = false;
      if (leadConfig?.fields && Array.isArray(leadConfig.fields)) {
        const mobileField = leadConfig.fields.find((f: any) => f.id === 'mobile' && f.enabled);
        const whatsappField = leadConfig.fields.find((f: any) => f.id === 'whatsapp' && f.enabled);
        if (mobileField?.phoneValidation) {
          phoneValidation = mobileField.phoneValidation;
        } else if (whatsappField?.phoneValidation) {
          phoneValidation = whatsappField.phoneValidation;
        }
        otpEnabledForMobile = !!(mobileField && mobileField.otpEnabled === true);
        // CAPTCHA is the mutually-exclusive alternative to OTP (OTP wins if both
        // are somehow set). When CAPTCHA is the chosen method we lock the
        // conversation after a phone is captured mid-chat so the widget renders
        // the reCAPTCHA checkbox (strategy-agnostic: custom/intent/keyword).
        captchaEnabledForMobile = !!(mobileField && mobileField.captchaEnabled === true && mobileField.otpEnabled !== true);
        sendUnverifiedLeadsToCrm = !!(mobileField && mobileField.sendUnverifiedLeadsToCrm === true);
      }

      // OTP GATE: when OTP verification is enabled for mobile AND we're on the widget channel,
      // suppress CRM sync ONLY for writes that touch the mobile number. Email-only captures,
      // name-only captures, and post-verification updates must still sync normally — only an
      // unverified phone is gated by the OTP flow (Task #14 spec).
      const otpGateActive = otpEnabledForMobile && channel === 'widget';
      // Spec parity: explicit observability when OTP is configured but the
      // channel is not the widget (v1 scope is widget-only). Helps verify
      // non-widget channels intentionally fall through to today's behavior.
      if (otpEnabledForMobile && channel && channel !== 'widget') {
        console.log(`[OTP] Skipped: channel not widget (channel=${channel}, business=${businessAccountId})`);
      }

      // CRITICAL (Task #14, fail-closed): suppress CRM sync whenever the lead
      // will end up carrying an unverified phone — regardless of whether the
      // current OTP challenge is pending, locked, expired, or invalidated by
      // a prior send_failed. Verification is conversation+phone scoped.
      const checkPhoneUnverified = async (rawPhone?: string | null): Promise<boolean> => {
        if (!otpGateActive || !conversationId || !rawPhone || !rawPhone.trim()) return false;
        try {
          const { normalizePhone } = await import('./services/otp');
          const normalized = normalizePhone(rawPhone);
          if (!normalized) return false;
          const verified = await storage.hasVerifiedOtpForConversationPhone(businessAccountId, conversationId, normalized);
          if (!verified) {
            console.log(`[OTP-Gate] Auto-detect: CRM sync blocked — lead phone …${normalized.slice(-4)} not OTP-verified for this conversation`);
          }
          return !verified;
        } catch (err) {
          console.error('[OTP-Gate] Auto-detect verification lookup failed (fail-closed):', err);
          return true;
        }
      };

      // CAPTCHA GATE: when CAPTCHA (not OTP) is the chosen mobile verification
      // method AND we're on the widget channel, a phone captured mid-chat must
      // lock the conversation pending the reCAPTCHA checkbox. Widget-only, same
      // scope as the OTP gate.
      const captchaGateActive = captchaEnabledForMobile && channel === 'widget';

      // CRM suppression for the CAPTCHA gate: don't sync a lead whose phone was
      // just captured until the conversation is captcha-verified — UNLESS the
      // admin opted in to sending unverified leads. Conversation-scoped; fails
      // closed on lookup error.
      const checkCaptchaUnverified = async (): Promise<boolean> => {
        if (!captchaGateActive || !conversationId) return false;
        if (sendUnverifiedLeadsToCrm) return false; // admin opted in to sync unverified leads
        try {
          const status = await storage.getConversationCaptchaStatus(conversationId, businessAccountId);
          if (status !== 'verified') {
            console.log('[CAPTCHA-Gate] Auto-detect: CRM sync blocked — conversation not captcha-verified');
          }
          return status !== 'verified';
        } catch (err) {
          console.error('[CAPTCHA-Gate] Auto-detect captcha status lookup failed (fail-closed):', err);
          return true;
        }
      };

      // Enhanced phone number detection: finds phone numbers WITHIN messages
      // Matches patterns like: "9876543210", "+91-9876543210", "call me at 987 654 3210", "My phone is 9999999999"
      // First, try to find phone-like patterns in the message (8-20 chars with digits, spaces, dashes, parens)
      const phonePattern = /\+?[\d\s().-]{8,20}/g;
      const phoneMatches = userMessage.match(phonePattern);
      
      let detectedPhone: string | null = null;
      
      if (phoneMatches && phoneMatches.length > 0) {
        // Clean each match and validate based on phoneValidation setting
        for (const match of phoneMatches) {
          const cleaned = match.replace(/[^\d+]/g, ''); // Keep only digits and +
          // Get only the digits (without +) for counting
          const digitsOnly = cleaned.replace(/\+/g, '');
          
          // Validate based on phoneValidation setting
          let isValid = false;
          switch (phoneValidation) {
            case '10':
              isValid = digitsOnly.length === 10;
              break;
            case '12':
              isValid = digitsOnly.length === 12;
              break;
            case '8-12':
              isValid = digitsOnly.length >= 8 && digitsOnly.length <= 12;
              break;
            case 'any':
              isValid = digitsOnly.length >= 7 && digitsOnly.length <= 15;
              break;
            default:
              isValid = digitsOnly.length === 10;
          }
          
          if (isValid) {
            const junkCheck = validatePhoneNumber(digitsOnly, phoneValidation as any);
            if (!junkCheck.isValid) {
              console.log(`[Auto Lead Capture] Junk phone rejected: ${digitsOnly} - ${junkCheck.reasonMessage}`);
              continue;
            }
            detectedPhone = cleaned;
            break; // Take first valid phone number
          }
        }
      }
      
      console.log('[Auto Lead Capture] Checking message:', userMessage, '| Phone match:', !!detectedPhone, detectedPhone || '', '| Validation:', phoneValidation);
      
      // Email pattern
      const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
      const emailMatch = userMessage.match(emailPattern);
      
      // Enhanced name detection - handles both explicit and standalone names
      // Pattern 1: "My name is [name]" - explicit name introduction
      // Pattern 2: Standalone short alphabetic responses (likely names in conversational context)
      let detectedName: string | null = null;
      
      // First try explicit "my name is" pattern
      const myNameIsPattern = /\bmy name is\s+(.+)/i;
      const myNameMatch = userMessage.match(myNameIsPattern);
      
      if (myNameMatch && myNameMatch[1]) {
        // Extract all words after "my name is"
        const afterNameIs = myNameMatch[1].trim();
        
        // Split on ANY non-letter character (space, comma, punctuation, etc.)
        const tokens = afterNameIs.split(/[^a-z'-]+/i).filter(t => t.length > 0);
        
        if (tokens.length > 0) {
          // Take only first 1-2 tokens that look like names
          const firstToken = tokens[0];
          const secondToken = tokens.length > 1 ? tokens[1] : null;
          
          // Basic validation: not a common non-name word
          const nonNameWords = ['i', 'am', 'interested', 'looking', 'need', 'want', 'have', 'yes', 'no', 'ok', 'okay', 'sure', 'hello', 'hi', 'hey', 'thanks', 'thank'];
          
          if (!nonNameWords.includes(firstToken.toLowerCase())) {
            // Accept first token
            let nameParts = [firstToken];
            
            // Accept second token if it exists and also looks like a name
            if (secondToken && !nonNameWords.includes(secondToken.toLowerCase()) && secondToken.length >= 2) {
              nameParts.push(secondToken);
            }
            
            // Capitalize and join
            detectedName = nameParts.map(w => 
              w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
            ).join(' ');
          }
        }
      }
      
      // If not found via "my name is", try CONTEXT-AWARE standalone name detection
      // Only detect standalone names if AI recently asked for the user's name
      // This prevents false positives like "cool", "awesome", "thanks" from being detected as names
      if (!detectedName && lastAIMessage) {
        // Check if the last AI message was asking for the user's PERSONAL name
        // Be very specific to avoid matching "company name", "product name", etc.
        const nameRequestPatterns = [
          /\bwhat'?s your name\b/i,
          /\byour name\?/i, // "And your name?" or "Your name please?"
          /\bmay i (have|know|get) your name\b/i,
          /\bcould you (tell|give|share) me your name\b/i,
          /\bcan i (have|know|get) your name\b/i,
          /\bplease (provide|share|give|tell) (me )?your name\b/i,
          /\bmay i please have your name\b/i,
          /\bwhat should i call you\b/i,
          /\bhow should i address you\b/i
        ];
        
        const aiAskedForName = nameRequestPatterns.some(pattern => pattern.test(lastAIMessage));
        
        // Only proceed with standalone name detection if AI asked for name
        if (aiAskedForName) {
          const trimmed = userMessage.trim();
          // Must be short (1-3 words max), only alphabetic chars + spaces/hyphens/apostrophes
          const standaloneNamePattern = /^[a-z][a-z'\-\s]{0,40}$/i;
          
          if (standaloneNamePattern.test(trimmed)) {
            const words = trimmed.split(/\s+/).filter(w => w.length > 0);
            
            // Only accept 1-3 words (not 4+, too risky for false positives)
            if (words.length >= 1 && words.length <= 3) {
              // Comprehensive list of common non-name words to filter out
              const nonNameWords = [
                // Pronouns & common words
                'i', 'me', 'my', 'you', 'your', 'he', 'she', 'it', 'we', 'they', 'them',
                // Verbs (including 2-char ones)
                'am', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
                'want', 'need', 'like', 'love', 'hate', 'know', 'think', 'see', 'look', 'get', 'got', 'go',
                // Common responses (including 2-char ones)
                'yes', 'no', 'ok', 'okay', 'sure', 'maybe', 'yep', 'nope', 'yeah', 'nah',
                // Greetings & pleasantries
                'hello', 'hi', 'hey', 'thanks', 'thank', 'please', 'sorry', 'bye', 'goodbye',
                // Articles & prepositions
                'the', 'a', 'an', 'this', 'that', 'these', 'those', 'of', 'to', 'for', 'in', 'on', 'at',
                // Adjectives & casual words
                'good', 'bad', 'great', 'nice', 'fine', 'interested', 'looking', 'here', 'there',
                'cool', 'awesome', 'wow', 'yo', 'dude', 'bro',
                // Additional 2-char common words to block
                'or', 'so', 'up', 'us', 'if', 'as', 'by'
              ];
              
              // Each word must be:
              // 1. At least 2 characters (allows short names like "Li", "Jo", "Ng")
              // 2. Not in the comprehensive stop-word list
              const validWords = words.filter(w => 
                w.length >= 2 && 
                !nonNameWords.includes(w.toLowerCase())
              );
              
              // Only accept if ALL words passed the filter AND we have 1-2 valid words
              if (validWords.length >= 1 && validWords.length <= 2 && validWords.length === words.length) {
                // Capitalize and join
                detectedName = validWords.map(w => 
                  w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                ).join(' ');
                
                console.log('[Auto Lead Capture] Context-aware standalone name detected:', detectedName);
              }
            }
          }
        }
      }
      
      // Check if we detected any contact info (detectedPhone already set above)
      const detectedEmail = emailMatch ? emailMatch[0] : null;
      
      if (!detectedPhone && !detectedEmail && !detectedName) {
        return; // No contact info detected
      }
      
      console.log('[Auto Lead Capture] Detected contact info:', {
        phone: detectedPhone,
        email: detectedEmail,
        name: detectedName
      });
      
      // Load Smart Lead Training configuration to enforce required fields
      let requiredFields: string[] = [];
      try {
        const widgetSettings = await storage.getWidgetSettings(businessAccountId);
        if (widgetSettings?.leadTrainingConfig) {
          const leadConfig = widgetSettings.leadTrainingConfig as any;
          if (leadConfig.fields && Array.isArray(leadConfig.fields)) {
            // Supported field IDs that can be auto-detected
            const supportedFieldIds = ['name', 'email', 'phone', 'mobile', 'whatsapp'];
            
            requiredFields = leadConfig.fields
              .filter((f: any) => f && f.enabled === true && f.required === true)
              .map((f: any) => f.id)
              .filter((id: string) => supportedFieldIds.includes(id)); // Sanitize: only keep supported fields
            
            const rawRequiredFields = leadConfig.fields
              .filter((f: any) => f && f.enabled === true && f.required === true)
              .map((f: any) => f.id);
            
            const unsupportedFields = rawRequiredFields.filter((id: string) => !supportedFieldIds.includes(id));
            if (unsupportedFields.length > 0) {
              console.warn(`[Auto Lead Capture] Ignoring unsupported required fields: ${unsupportedFields.join(', ')}`);
            }
          }
        }
      } catch (error) {
        console.error('[Auto Lead Capture] Error loading leadTrainingConfig:', error);
      }

      // Check if a lead already exists for this conversation
      const existingLead = await storage.getLeadByConversation(conversationId, businessAccountId);
      
      if (existingLead) {
        // Update existing lead with new info (progressive enrichment allowed)
        const updateData: any = {};
        if (detectedPhone && (!existingLead.phone || existingLead.phone !== detectedPhone)) {
          updateData.phone = detectedPhone;
        }
        if (detectedEmail && (!existingLead.email || existingLead.email !== detectedEmail)) {
          updateData.email = detectedEmail;
        }
        if (detectedName && (!existingLead.name || existingLead.name === 'Anonymous')) {
          updateData.name = detectedName;
        }
        
        if (Object.keys(updateData).length > 0) {
          await storage.updateLead(existingLead.id, businessAccountId, updateData);
          console.log(`[Auto Lead Capture] Updated lead ${existingLead.id} with:`, updateData);
          
          // Update conversation title
          const newTitle = updateData.name || detectedName || existingLead.name || detectedPhone || existingLead.phone || detectedEmail || 'Anonymous';
          if (newTitle !== 'Anonymous') {
            await storage.updateConversationTitle(conversationId, businessAccountId, newTitle);
          }

          // Task #23: existing-lead branch — when the OTP gate is active and a
          // phone was just added/changed on an EXISTING lead, issue the OTP
          // challenge here for the same reason as the new-lead branch below.
          // issueChallenge is idempotent: if there's already an unverified
          // challenge for this (conversation, phone), it's reused.
          if (otpGateActive && updateData.phone) {
            try {
              const { OtpService } = await import('./services/otp');
              // Task #23: skip re-issuance if this (conversation, phone) is
              // already verified. Without this guard, a visitor who already
              // verified earlier and later mentions their phone again would
              // get re-challenged and the chat would re-lock unexpectedly.
              const alreadyVerified = await OtpService.hasVerifiedChallenge(
                businessAccountId, conversationId, updateData.phone,
              );
              if (alreadyVerified) {
                console.log(`[OTP-Gate] Auto-detect (existing lead) skipping issueChallenge — phone already verified for conversation ${conversationId}`);
              } else {
                const issued = await OtpService.issueChallenge(businessAccountId, conversationId, updateData.phone, {
                  leadId: existingLead.id,
                  channelOrigin: 'widget',
                });
                if (issued.ok) {
                  console.log(`[OTP-Gate] Auto-detect (existing lead) issued OTP challenge for conversation ${conversationId}, phone …${updateData.phone.slice(-4)}`);
                } else {
                  console.warn(`[OTP-Gate] Auto-detect (existing lead) issueChallenge failed: ${issued.reason}`);
                }
              }
            } catch (err) {
              console.error('[OTP-Gate] Auto-detect (existing lead) issueChallenge error:', err);
            }
          }

          // CAPTCHA gate (existing-lead branch): when CAPTCHA is the chosen
          // method and a phone was just added/changed mid-chat, lock the
          // conversation so the widget renders the reCAPTCHA checkbox. No-op once
          // already captcha-verified (markConversationAwaitingCaptchaIfUnverified
          // checks the status).
          if (captchaGateActive && updateData.phone) {
            try {
              await storage.markConversationAwaitingCaptchaIfUnverified(conversationId, businessAccountId);
              console.log(`[CAPTCHA-Gate] Auto-detect (existing lead) locked conversation ${conversationId} pending CAPTCHA`);
            } catch (err) {
              console.error('[CAPTCHA-Gate] Auto-detect (existing lead) markAwaiting error:', err);
            }
          }
          
          // Sync update to LeadSquared (async, non-blocking) - only send changed fields
          // IMPORTANT: Only sync if we have at least phone OR email (LeadSquared rejects name-only leads)
          const hasPhoneOrEmail = (updateData.phone || existingLead.phone) || (updateData.email || existingLead.email);
          // Suppress whenever the resulting lead will carry an unverified phone
          // (fail-closed). The "resulting phone" is updateData.phone if present,
          // else the lead's existing phone — that's what would be synced.
          const effectivePhone = updateData.phone || existingLead.phone;
          const suppressThisSync = (await checkPhoneUnverified(effectivePhone)) || (await checkCaptchaUnverified());
          if (suppressThisSync) {
            console.log('[Verify-Gate] CRM sync suppressed for existing lead (phone change awaiting OTP/CAPTCHA verification)');
          } else if (hasPhoneOrEmail) {
            this.syncLeadToLeadSquared({
              id: existingLead.id,
              name: updateData.name || existingLead.name,
              email: updateData.email || existingLead.email,
              phone: updateData.phone || existingLead.phone,
              leadsquaredLeadId: existingLead.leadsquaredLeadId
            }, businessAccountId, true, Object.keys(updateData)).catch(err => console.error('[LeadSquared] Background sync error:', err));
          } else {
            console.log('[LeadSquared] Skipping sync - no phone or email yet (name-only leads not supported)');
          }
        }
      } else {
        // Creating NEW lead - enforce Smart Lead Training required field validation
        // Build field mapping from detected contact info
        // Note: detectedPhone satisfies phone/mobile/whatsapp (all are phone numbers)
        const fieldMap: Record<string, string | null> = {
          name: detectedName,
          email: detectedEmail,
          phone: detectedPhone,
          mobile: detectedPhone, // phone satisfies mobile requirement
          whatsapp: detectedPhone // phone satisfies whatsapp requirement
        };

        // INSTANT PROGRESSIVE CAPTURE: Create lead immediately with whatever we have
        // Don't block on missing required fields - save partial data to prevent loss
        if (detectedPhone || detectedEmail || detectedName) {
          console.log(`[Auto Lead Capture - Progressive] Creating partial lead with: ${[detectedName && 'name', detectedPhone && 'phone', detectedEmail && 'email'].filter(Boolean).join(', ')}`);
          
          // Check which required fields are still missing (for logging only)
          const missingFields = requiredFields.filter(fieldId => {
            const fieldValue = fieldMap[fieldId];
            return !fieldValue || fieldValue.trim() === '';
          });
          
          if (missingFields.length > 0) {
            console.log(`[Auto Lead Capture - Progressive] Partial lead - missing required fields: ${missingFields.join(', ')} (will be collected later)`);
          }
          
          let sourceUrl: string | null = pageUrl || null;
          
          // Create the partial lead immediately
          const newLead = await storage.createLead({
            businessAccountId,
            name: detectedName || null,
            email: detectedEmail || null,
            phone: detectedPhone || null,
            city: visitorCity || null,
            sourceUrl,
            message: 'Via Chat',
            conversationId
          });
          console.log(`[Auto Lead Capture] Created new lead ${newLead.id} with:`, {
            name: detectedName,
            phone: detectedPhone,
            email: detectedEmail
          });
          
          // Update conversation title
          const newTitle = detectedName || detectedPhone || detectedEmail || 'Anonymous';
          if (newTitle !== 'Anonymous') {
            await storage.updateConversationTitle(conversationId, businessAccountId, newTitle);
          }
          
          // Task #23: When the OTP gate is active and we just captured a phone
          // via auto-detect (visitor typed it mid-chat instead of via the pre-chat
          // modal), issue the OTP challenge HERE. Without this the buildLeadOverride
          // in llamaService would see "all required fields collected" and instruct
          // the AI to stop asking — meaning capture_lead never fires and the OTP
          // is never sent. issueChallenge is idempotent so re-issuing for an
          // already-pending phone is a no-op.
          if (otpGateActive && detectedPhone) {
            try {
              const { OtpService } = await import('./services/otp');
              // Task #23: skip re-issuance if this (conversation, phone) is
              // already verified — see existing-lead branch for rationale.
              const alreadyVerified = await OtpService.hasVerifiedChallenge(
                businessAccountId, conversationId, detectedPhone,
              );
              if (alreadyVerified) {
                console.log(`[OTP-Gate] Auto-detect skipping issueChallenge — phone already verified for conversation ${conversationId}`);
              } else {
                const issued = await OtpService.issueChallenge(businessAccountId, conversationId, detectedPhone, {
                  leadId: newLead.id,
                  channelOrigin: 'widget',
                });
                if (issued.ok) {
                  console.log(`[OTP-Gate] Auto-detect issued OTP challenge for conversation ${conversationId}, phone …${detectedPhone.slice(-4)}`);
                } else {
                  console.warn(`[OTP-Gate] Auto-detect issueChallenge failed: ${issued.reason}`);
                }
              }
            } catch (err) {
              console.error('[OTP-Gate] Auto-detect issueChallenge error:', err);
            }
          }

          // CAPTCHA gate (new-lead branch): when CAPTCHA is the chosen method and
          // we just captured a phone mid-chat, lock the conversation so the
          // widget renders the reCAPTCHA checkbox. Mirrors the OTP issue above —
          // without this the "all required fields collected" lead-override would
          // tell the AI to stop asking and the visitor would never be gated.
          if (captchaGateActive && detectedPhone) {
            try {
              await storage.markConversationAwaitingCaptchaIfUnverified(conversationId, businessAccountId);
              console.log(`[CAPTCHA-Gate] Auto-detect locked conversation ${conversationId} pending CAPTCHA (new lead)`);
            } catch (err) {
              console.error('[CAPTCHA-Gate] Auto-detect markAwaiting (new lead) error:', err);
            }
          }

          // Sync new lead to LeadSquared (async, non-blocking)
          // IMPORTANT: Only sync if we have at least phone OR email (LeadSquared rejects name-only leads)
          // Suppress when this NEW lead will carry an unverified phone (fail-closed).
          const suppressThisNewSync = (await checkPhoneUnverified(detectedPhone)) || (await checkCaptchaUnverified());
          if (suppressThisNewSync) {
            console.log('[Verify-Gate] CRM sync suppressed for new lead (phone awaiting OTP/CAPTCHA verification)');
          } else if (detectedPhone || detectedEmail) {
            this.syncLeadToLeadSquared({
              id: newLead.id,
              name: detectedName,
              email: detectedEmail,
              phone: detectedPhone
            }, businessAccountId, false).catch(err => console.error('[LeadSquared] Background sync error:', err));
          } else {
            console.log('[LeadSquared] Skipping new lead sync - no phone or email yet (name-only leads not supported)');
          }
        }
      }
    } catch (error) {
      console.error('[Auto Lead Capture] Error:', error);
    }
  }

  // Sync a lead to LeadSquared CRM (async, non-blocking)
  // Called when a lead is created or updated during chat
  private async syncLeadToLeadSquared(
    lead: { id: string; name?: string | null; email?: string | null; phone?: string | null; leadsquaredLeadId?: string | null },
    businessAccountId: string,
    isUpdate: boolean = false,
    changedFields?: string[]
  ): Promise<void> {
    try {
      // Check if LeadSquared integration is enabled
      const settings = await storage.getWidgetSettings(businessAccountId);
      if (!settings?.leadsquaredEnabled || settings.leadsquaredEnabled !== 'true') {
        return; // Auto-sync not enabled
      }
      
      if (!settings.leadsquaredAccessKey || !settings.leadsquaredSecretKey || !settings.leadsquaredRegion) {
        console.log('[LeadSquared] Auto-sync enabled but credentials not configured');
        return;
      }
      
      // Decrypt the stored secret key (it's encrypted in the database)
      const { decrypt } = await import('./services/encryptionService');
      let decryptedSecretKey: string;
      try {
        decryptedSecretKey = decrypt(settings.leadsquaredSecretKey);
      } catch (decryptError) {
        console.error('[LeadSquared] Failed to decrypt secret key:', decryptError);
        return;
      }
      
      // Import and create LeadSquared service
      const { createLeadSquaredService, extractUtmCampaign, extractUtmSource, extractUtmMedium, buildJourneyCrmContext, buildConversationCrmContext } = await import('./services/leadsquaredService');
      const leadsquaredService = await createLeadSquaredService({
        accessKey: settings.leadsquaredAccessKey,
        secretKey: decryptedSecretKey,
        region: settings.leadsquaredRegion as 'india' | 'us' | 'other',
        customHost: settings.leadsquaredCustomHost || undefined
      });
      
      // Get business account info for additional fields
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      
      // Get full lead details from database for city and createdAt
      const fullLead = await storage.getLead(lead.id, businessAccountId);
      
      // Get field mappings from database (dynamic, configurable)
      const fieldMappings = await storage.getLeadsquaredFieldMappings(businessAccountId);
      
      let urlExtraction: { university?: string | null; product?: string | null } | undefined;
      const needsUrlExtraction = fieldMappings.some(m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('urlLookup.'));
      const effectiveSourceUrl = fullLead?.sourceUrl || null;
      if (needsUrlExtraction && effectiveSourceUrl) {
        try {
          const { extractProductFromUrl } = await import('./services/urlExtractionService');
          const extractionConfig = {
            domain: settings.lsqExtractionDomain || null,
            universities: settings.lsqExtractionUniversities || null,
            products: settings.lsqExtractionProducts || null,
            fallbackUniversity: settings.lsqExtractionFallbackUniversity || null,
            fallbackProduct: settings.lsqExtractionFallbackProduct || null,
          };
          urlExtraction = await extractProductFromUrl(effectiveSourceUrl, businessAccountId, extractionConfig);
          console.log('[LeadSquared Chat Sync] URL extraction result:', urlExtraction);
        } catch (extractErr) {
          console.warn('[LeadSquared Chat Sync] URL extraction failed:', extractErr);
        }
      }

      // Journey answers (journey.* mappings) — only queried when a mapping needs them.
      let journeyContext: Record<string, string> = {};
      const needsJourney = fieldMappings.some(m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('journey.'));
      if (needsJourney) {
        const convId = (fullLead as any)?.conversationId;
        journeyContext = await buildJourneyCrmContext(convId);
      }

      // Conversation summary/topics (conversation.* mappings) — only queried when needed.
      let conversationContext: { summary?: string | null; topics?: string | null } = {};
      const needsConversation = fieldMappings.some(m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('conversation.'));
      if (needsConversation) {
        const convId = (fullLead as any)?.conversationId;
        conversationContext = await buildConversationCrmContext(convId);
      }

      const leadContext = {
        lead: {
          name: lead.name || fullLead?.name || null,
          email: lead.email || fullLead?.email || null,
          phone: lead.phone || fullLead?.phone || null,
          whatsapp: fullLead?.whatsapp || null,
          createdAt: fullLead?.createdAt || null,
          sourceUrl: fullLead?.sourceUrl || null,
        },
        session: {
          city: fullLead?.city || null,
          utmCampaign: extractUtmCampaign(fullLead?.sourceUrl) || null,
          utmSource: extractUtmSource(fullLead?.sourceUrl) || null,
          utmMedium: extractUtmMedium(fullLead?.sourceUrl) || null,
          pageUrl: fullLead?.sourceUrl || null,
        },
        business: {
          name: businessAccount?.name || null,
          website: businessAccount?.website || null,
        },
        ...(urlExtraction ? { urlExtraction } : {}),
        ...(Object.keys(journeyContext).length ? { journey: journeyContext } : {}),
        ...(conversationContext.summary || conversationContext.topics ? { conversation: conversationContext } : {}),
      };
      
      console.log('[LeadSquared] Auto-sync using dynamic field mappings, count:', fieldMappings.length);
      
      // If it's an update AND we have a LeadSquared ID, update existing record
      if (isUpdate && lead.leadsquaredLeadId) {
        console.log('[LeadSquared] Auto-syncing lead update:', lead.id, '→', lead.leadsquaredLeadId);
        const result = await leadsquaredService.updateLeadWithMappings(lead.leadsquaredLeadId, fieldMappings, leadContext, changedFields);
        
        if (result.success) {
          await storage.updateLead(lead.id, businessAccountId, {
            leadsquaredSyncStatus: 'synced',
            leadsquaredSyncedAt: new Date(),
            leadsquaredSyncPayload: result.syncPayload || null
          });
          console.log('[LeadSquared] Lead update synced successfully:', lead.id);
        } else {
          console.error('[LeadSquared] Lead update sync failed:', lead.id, result.message);
          await storage.updateLead(lead.id, businessAccountId, {
            leadsquaredSyncStatus: 'failed',
            leadsquaredSyncError: result.message
          });
        }
      } else {
        // Create new lead in LeadSquared (either new lead OR existing lead without LeadSquared ID)
        const action = isUpdate ? 'syncing existing unsynced lead' : 'syncing new lead';
        console.log(`[LeadSquared] Auto-${action}:`, lead.id);
        const result = await leadsquaredService.createLeadWithMappings(fieldMappings, leadContext);
        
        if (result.success) {
          await storage.updateLead(lead.id, businessAccountId, {
            // Only overwrite the stored ID when we actually got one (duplicates have none).
            ...(result.leadId ? { leadsquaredLeadId: result.leadId } : {}),
            leadsquaredSyncStatus: 'synced',
            leadsquaredSyncedAt: new Date(),
            leadsquaredSyncError: null,
            leadsquaredSyncPayload: result.syncPayload || null
          });
          console.log('[LeadSquared] Lead synced successfully:', lead.id, '→', result.leadId || (result.alreadyExists ? 'already exists' : 'no id'));
        } else {
          console.error('[LeadSquared] Lead sync failed:', lead.id, result.message);
          await storage.updateLead(lead.id, businessAccountId, {
            leadsquaredSyncStatus: 'failed',
            leadsquaredSyncError: result.message
          });
        }
      }
    } catch (error: any) {
      console.error('[LeadSquared] Auto-sync error:', error);
      // Don't throw - sync is non-blocking
    }
  }

  // Public method to prewarm cache for a business account
  // This loads all business context into cache without processing a message
  async prewarmCache(context: ChatContext): Promise<void> {
    try {
      console.log(`[Cache Prewarm] Starting cache warm for business: ${context.businessAccountId}`);
      const startTime = Date.now();
      
      // Trigger cache loading by calling buildEnrichedContext
      await this.buildEnrichedContext(context);
      
      const duration = Date.now() - startTime;
      console.log(`[Cache Prewarm] Cache warmed successfully in ${duration}ms`);
    } catch (error) {
      console.error('[Cache Prewarm] Error warming cache:', error);
      // Don't throw - this is fire-and-forget
    }
  }

  async processMessage(userMessage: string, context: ChatContext): Promise<string> {
    try {
      // Get conversation history to check if this is a new conversation
      const existingHistory = conversationMemory.getConversationHistory(context.userId);
      const isFirstMessage = existingHistory.length === 0;
      
      // SPAM DETECTION: Check first message - if spam, use simplified path (no DB, no journeys, just AI response)
      // Skip spam check for resume uploads, job applications, and K12 image uploads — they must go through the full AI flow
      if (isFirstMessage && context.openaiApiKey && !userMessage.startsWith('[RESUME_UPLOAD]') && !userMessage.startsWith('[JOB_APPLY]') && !userMessage.startsWith('[IMAGE_UPLOAD]') && !context.resumeText && !context.imageText) {
        const spamCheck = await isGibberishAI(userMessage, context.openaiApiKey);
        if (spamCheck.isSpam && spamCheck.confidence === 'high') {
          console.log('[Chat] Spam detected (processMessage) - using simplified response path:', userMessage.substring(0, 50));
          
          // Store in memory only (no DB)
          conversationMemory.storeMessage(context.userId, 'user', userMessage);
          
          // Call AI directly with minimal context - let it respond naturally
          const response = await this.getSimpleAIResponse(userMessage, context);
          if (!context.deferAssistantPersistence) {
            conversationMemory.storeMessage(context.userId, 'assistant', response);
          }
          
          return response;
        }
      }
      
      // Get or create conversation (normal flow)
      const conversationId = await this.getOrCreateConversation(context);
      
      // Get conversation history to check if AI recently asked for name
      const history = conversationMemory.getConversationHistory(context.userId);
      const lastAIMessage = history.length > 0 && history[history.length - 1].role === 'assistant' 
        ? history[history.length - 1].content 
        : undefined;
      
      // CRITICAL: Capture lead state BEFORE auto-detection to compare after
      // This allows us to detect if required fields JUST became complete
      const leadBeforeCaptureRaw = await storage.getLeadByConversation(conversationId, context.businessAccountId);
      const leadBeforeCapture = leadBeforeCaptureRaw ? { 
        phone: leadBeforeCaptureRaw.phone, 
        email: leadBeforeCaptureRaw.email, 
        name: leadBeforeCaptureRaw.name 
      } : null;
      
      // Auto-detect and capture contact information from user message
      // This ensures leads are captured even if AI doesn't call the capture_lead tool
      await this.autoDetectAndCaptureLead(userMessage, conversationId, context.businessAccountId, lastAIMessage, context.visitorCity, context.visitorSessionId, context.pageUrl, context.channel);
      
      // PERFORMANCE: Early check if business has any active journeys
      // Skip all journey processing if no journeys exist for this account
      const hasActiveJourneys = await journeyService.hasActiveJourneys(context.businessAccountId);
      let isJourneyActive = false;
      
      if (hasActiveJourneys) {
        // Auto-inject journey conversational guidelines if not already provided and if journey is active
        if (!context.journeyConversationalGuidelines) {
          const activeJourneyState = await journeyService.getJourneyState(conversationId);
          if (activeJourneyState && !activeJourneyState.completed) {
            const journey = await storage.getJourney(activeJourneyState.journeyId, context.businessAccountId);
            if (journey && journey.conversationalGuidelines) {
              // Parse journey instructions from JSON array and format as string
              try {
                const instructions = JSON.parse(journey.conversationalGuidelines);
                if (Array.isArray(instructions) && instructions.length > 0) {
                  context.journeyConversationalGuidelines = instructions
                    .map((inst: any, index: number) => `${index + 1}. ${inst.text}`)
                    .join('\n');
                }
              } catch {
                // Legacy format - use as-is if not JSON
                context.journeyConversationalGuidelines = journey.conversationalGuidelines;
              }
            }
          }
        }
      }
      
      // Store user message in memory and database
      conversationMemory.storeMessage(context.userId, 'user', userMessage);
      await this.storeMessageInDB(conversationId, 'user', userMessage, undefined, context.imageUrl);

      if (userMessage.startsWith('[JOB_APPLY]')) {
        const applyMatch = userMessage.match(/\|jobId:([^|]+)\|applicantId:([^|]+)/);
        const clientJobTitle = userMessage.replace(/^\[JOB_APPLY\]\s*/, '').replace(/\s*\|jobId:.*$/, '').trim();
        if (applyMatch) {
          const jobId = applyMatch[1].trim();
          const applicantId = applyMatch[2].trim();
          console.log(`[Chat processMessage] JOB_APPLY intercept: jobId=${jobId}, applicantId=${applicantId}, title="${clientJobTitle}"`);
          try {
            const result = await ToolExecutionService.executeTool(
              'apply_to_job',
              { jobId, applicantId },
              {
                businessAccountId: context.businessAccountId,
                userId: context.userId,
                conversationId: conversationId,
                visitorCity: context.visitorCity,
                userMessage: userMessage,
                selectedLanguage: context.preferredLanguage
              },
              userMessage,
              false
            );
            const resultData = result.success && 'data' in result && result.data ? result.data : {};
            const serverTitle = resultData.jobTitle || clientJobTitle;
            const reply = result.success
              ? `Your application for **${serverTitle}** has been submitted successfully! The hiring team will review your profile and get back to you soon.`
              : `Sorry, I couldn't submit your application. ${result.message || 'Please try again.'}`;
            if (!context.deferAssistantPersistence) {
              conversationMemory.storeMessage(context.userId, 'assistant', reply);
              await this.storeMessageInDB(conversationId, 'assistant', reply);
            }
            return reply;
          } catch (err) {
            console.error('[Chat] JOB_APPLY error:', err);
            const errReply = `Sorry, something went wrong while submitting your application. Please try again.`;
            if (!context.deferAssistantPersistence) {
              conversationMemory.storeMessage(context.userId, 'assistant', errReply);
              await this.storeMessageInDB(conversationId, 'assistant', errReply);
            }
            return errReply;
          }
        } else {
          const errReply = 'Sorry, the application request was malformed. Please try clicking Apply Now again.';
          if (!context.deferAssistantPersistence) {
            conversationMemory.storeMessage(context.userId, 'assistant', errReply);
            await this.storeMessageInDB(conversationId, 'assistant', errReply);
          }
          return errReply;
        }
      }

      // K12 IMAGE UPLOAD: replace placeholder with the OCR'd question text so that
      // RAG document search, K12 tool calls, FAQ matching, and the LLM all see
      // the actual academic question instead of "[IMAGE_UPLOAD] filename.jpg".
      // The original placeholder remains in conversation history (already stored above).
      // This runs AFTER reserved-prefix protocol checks (e.g. [JOB_APPLY]) so that
      // OCR text cannot spoof internal command protocols.
      if (context.imageText && userMessage.startsWith('[IMAGE_UPLOAD]')) {
        const ocrText = context.imageText.trim();
        if (ocrText.length > 0) {
          console.log(`[Chat ProcessMessage] Replacing [IMAGE_UPLOAD] placeholder with OCR'd question text (${ocrText.length} chars) for search and LLM`);
          userMessage = ocrText;
        }
      }

      try {
        const { getSmartReplyResponse } = await import('./services/smartReplyService');
        const smartReply = await getSmartReplyResponse(context.businessAccountId, "website", userMessage);
        if (smartReply) {
          console.log(`[Chat] Smart reply matched: "${smartReply.matchedKeyword}" — returning configured response directly (skipping AI)`);
          if (!context.deferAssistantPersistence) {
            conversationMemory.storeMessage(context.userId, 'assistant', smartReply.text);
            await this.storeMessageInDB(conversationId, 'assistant', smartReply.text);
          }
          return smartReply.text;
        }
      } catch (err) {
        console.error("[Chat] Smart reply error (non-fatal):", err);
      }

      // Only process journeys if business has active journeys configured
      if (hasActiveJourneys) {
        // ENGINE-DRIVEN MODE: Try processing through journey engine first
        const engineResult = await journeyOrchestrator.processUserMessageEngineDriven(
          conversationId,
          context.userId,
          context.businessAccountId,
          userMessage
        );

        // If engine handled the message, return engine's response immediately
        if (engineResult.shouldBypassAI && engineResult.response) {
          console.log('[Chat] Engine-driven journey handled message - bypassing AI');
          
          // Store engine's response
          if (!context.deferAssistantPersistence) {
            conversationMemory.storeMessage(context.userId, 'assistant', engineResult.response);
            await this.storeMessageInDB(conversationId, 'assistant', engineResult.response);
          }
          
          return engineResult.response;
        }

        // Fall back to AI-guided journey (if enabled) or normal chat
        const journeyResult = await journeyOrchestrator.processUserMessage(
          conversationId,
          context.userId,
          context.businessAccountId,
          userMessage
        );
        isJourneyActive = journeyResult.isJourneyActive;
      } else {
        console.log('[Chat] No active journeys for business - skipping journey processing');
      }
      
      // Build enriched system context with company info and all FAQs
      // This includes PDF summaries and key points - should answer most questions
      let systemContext = await this.buildEnrichedContext(context);

      // Run RAG search and DB fetches in parallel — they are fully independent
      // RAG embedding call (~200ms) now overlaps with DB reads (~50ms) instead of preceding them
      console.log('[RAG] Running document chunk search for query');
      const [ragContext, [businessAccount, widgetSettings, existingLead, products]] = await Promise.all([
        this.addRAGContext(userMessage, context.businessAccountId),
        Promise.all([
          storage.getBusinessAccount(context.businessAccountId),
          storage.getWidgetSettings(context.businessAccountId),
          storage.getLeadByConversation(conversationId, context.businessAccountId),
          storage.getAllProducts(context.businessAccountId)
        ])
      ]);
      systemContext += ragContext;

      if (context.resumeText) {
        systemContext += `\n\n=== RESUME UPLOADED BY VISITOR ===\nThe visitor has uploaded their resume. You MUST call the parse_resume_and_match tool to analyze it and find matching jobs.\n---RESUME_TEXT---\n${context.resumeText.substring(0, 8000)}\n=== END RESUME ===\n`;
        console.log(`[Chat ProcessMessage] Resume text injected into system context (${context.resumeText.length} chars)`);
      }

      if (context.imageText) {
        systemContext += `\n\n=== IMAGE UPLOADED BY STUDENT (REFERENCE) ===\nThe student uploaded a photo of their question. The text below was extracted from that photo and IS the same question now appearing as the user's message. Treat the user's message as a normal academic question: follow the K12 tutor rules above (call fetch_k12_topic first, apply Content-Only / Verbatim guardrails when enabled). Do NOT ask "what would you like to know about this?" — just answer the question.\n---IMAGE_TEXT---\n${context.imageText.substring(0, 8000)}\n=== END IMAGE TEXT ===\n`;
        console.log(`[Chat ProcessMessage] Image text injected into system context (${context.imageText.length} chars)`);
      }

      try {
        if (existingLead && (existingLead.phone || existingLead.email)) {
          const platformUserId = context.visitorToken || conversationId;
          const profile = await resolveProfile(context.businessAccountId, {
            phone: existingLead.phone || null,
            email: existingLead.email || null,
            name: existingLead.name || null,
            city: context.visitorCity || null,
            platform: "website",
            platformUserId,
          });
          if (profile) {
            const isFirstMsg = !history.some((m: any) => m.role === 'assistant');
            const crossPlatformCtx = await composeCrossPlatformContext(context.businessAccountId, "website", profile.id, isFirstMsg);
            if (crossPlatformCtx) {
              systemContext += `\n\n${crossPlatformCtx}`;
              console.log(`[Chat] Cross-platform context injected (${crossPlatformCtx.length} chars, firstMsg: ${isFirstMsg})`);
            }
            triggerSnapshotUpdate(context.businessAccountId, profile.id, "website", platformUserId);
          }
        }
      } catch (err) {
        console.error("[Chat] Cross-platform context error (non-fatal):", err);
      }

      // Appointments are enabled only if BOTH business account AND widget settings allow it
      const appointmentsEnabled = 
        businessAccount?.appointmentsEnabled === 'true' && 
        widgetSettings?.appointmentBookingEnabled === 'true';

      // Check if business has products - only include product tool if products exist
      const hasProducts = products.length > 0;

      // PHONE VALIDATION GATE (non-streaming path) — uses shared utility
      let phoneValidationFailedNS = false;
      let phoneValidationContextNS = '';
      const leadTrainingConfigNonStream = widgetSettings?.leadTrainingConfig as any;
      if (leadTrainingConfigNonStream) {
        const validationOverrideNS = buildPhoneValidationOverride(userMessage, leadTrainingConfigNonStream);
        if (validationOverrideNS) {
          phoneValidationFailedNS = true;
          phoneValidationContextNS = validationOverrideNS;
        }
      }

      // AI-GUIDED JOURNEYS: Check if journey is active and include journey tools
      // This allows AI to intelligently manage journeys while staying conversational
      // Pass conversation history to detect ongoing appointment context
      // Pass API key for AI-based product intent classification fallback
      let relevantTools = await selectRelevantTools(userMessage, appointmentsEnabled, isJourneyActive, hasProducts, history, context.openaiApiKey || undefined, context.systemMode, context.k12EducationEnabled, context.jobPortalEnabled, context.demoOrdersEnabled);

      // ─── OTP gating (non-stream parity with streamMessage, Task #14) ────────
      // Mirror the OTP strict-mode behavior here so /api/chat/widget (non-stream)
      // behaves identically to /api/chat/widget/stream when a challenge is
      // pending or locked. Without this, the non-stream fallback would let the
      // model call unrelated tools or skip the gating override entirely.
      if (context.channel === 'widget') {
        try {
          const otpStateNS = await OtpService.getLatestStateForConversation(context.businessAccountId, conversationId);
          if (otpStateNS.locked) {
            relevantTools = [];
            systemContext += buildOtpGatingOverride(otpStateNS);
          } else if (otpStateNS.awaiting_otp) {
            const fromAll = (await import('./aiTools')).aiTools;
            relevantTools = fromAll.filter((t: any) =>
              t.function.name === 'verify_phone_otp' ||
              t.function.name === 'resend_phone_otp' ||
              t.function.name === 'capture_lead'
            );
            systemContext += buildOtpGatingOverride(otpStateNS);
          }
        } catch (err) {
          console.error('[OTP] Non-stream gating failed (continuing without restriction):', err);
        }
      }

      // Get AI response with tool awareness
      // Phone validation: pass as last-position system message override (highest GPT attention weight)
      const aiResponse = await llamaService.generateToolAwareResponse(
        userMessage,
        relevantTools,
        history,
        systemContext,
        context.personality || 'friendly',
        context.openaiApiKey || undefined,
        context.businessAccountId,
        hasProducts,
        context.responseLength || 'balanced',
        phoneValidationFailedNS ? phoneValidationContextNS : undefined,
        // Top Scholar content-only K12: force the first model turn to call
        // fetch_k12_topic so academic answers are always grounded in curriculum
        // content. gpt-4o-mini ignores the prompt-only "you MUST call the tool"
        // rule and will otherwise answer from general knowledge.
        this.isK12ContentOnly(context) ? 'fetch_k12_topic' : undefined
      );

      // Log tool calls for debugging
      console.log('[Chat] User message:', userMessage);
      console.log('[Chat] Tool calls received:', aiResponse.tool_calls ? aiResponse.tool_calls.length : 0);
      if (aiResponse.tool_calls) {
        aiResponse.tool_calls.forEach((tc: any) => {
          console.log('[Chat] Tool:', tc.function.name, 'Args:', tc.function.arguments);
        });
      }

      // Handle tool calls if any
      if (aiResponse.tool_calls && aiResponse.tool_calls.length > 0) {
        const result = await this.handleToolCalls(aiResponse, context, userMessage, relevantTools, appointmentsEnabled, false, systemContext);
        
        // DEFLECTION GATE: Check if response is a deflection and route to fallback template
        if (this.isDeflectionResponse(result.response) || result.response.includes('[[FALLBACK]]')) {
          console.log('[Deflection Gate] handleToolCalls returned deflection, routing to fallback template');
          const fallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
          
          // Use custom fallback template if available, otherwise use a sensible default
          let fallbackTemplate = fallbackInstructions && fallbackInstructions.length > 0
            ? fallbackInstructions[0]
            : "I'll need to check with our team for the specific details. Could you please share your contact information so they can reach out to you?";
          
          fallbackTemplate = this.processFallbackPlaceholders(fallbackTemplate, existingLead);
          const rephrased = await this.rephraseFallbackMessage(
            fallbackTemplate,
            userMessage,
            context.businessAccountId,
            context.openaiApiKey || undefined,
            existingLead
          );
          // Update stored message with the rephrased fallback
          conversationMemory.storeMessage(context.userId, 'assistant', rephrased);
          await this.storeMessageInDB(conversationId, 'assistant', rephrased);
          return rephrased;
        }
        
        // Return just the response text
        return result.response;
      }

      // CRITICAL: Check if lead collection just completed WITHOUT the AI calling tools
      // This happens when user provides contact info and autoDetectAndCaptureLead saves it
      const leadStatus = await this.checkLeadCompletionStatus(conversationId, context.businessAccountId, widgetSettings, leadBeforeCapture);
      
      if (leadStatus.justCompleted) {
        // Extract the original user question (including current message in search)
        const originalQuestion = this.extractLastSubstantiveQuestion(history, userMessage);
        
        console.log('[Lead Completion] All required fields collected via auto-detection');
        console.log('[Lead Completion] Original question:', originalQuestion);
        
        if (originalQuestion) {
          // Inject instruction to answer the original question
          const postLeadInstruction = {
            role: 'system' as const,
            content: `🎯 POST-LEAD-CAPTURE INSTRUCTION (CRITICAL):
- You just collected all required contact information from the customer
- The customer originally asked: "${originalQuestion}"
- NOW YOU MUST:
  1. Briefly acknowledge their contact info (e.g., "Thanks for sharing your details!")
  2. IMMEDIATELY answer their original question: "${originalQuestion}"
  3. Use the appropriate tools (get_faqs, get_products) to find the answer
  4. Be helpful - they waited to provide their info, now give them valuable information
  
- DO NOT just say "I've processed your request" - this is WRONG
- DO NOT ask "How can I help?" - they ALREADY asked a question
- DO answer their original question completely and helpfully`
          };
          
          // Rebuild the conversation with the instruction
          const updatedHistory = [...history, postLeadInstruction];
          
          // Get a new response that actually answers the question
          const finalResponse = await llamaService.generateToolAwareResponse(
            originalQuestion, // Use the original question as the "new" message
            relevantTools,
            updatedHistory,
            systemContext,
            context.personality || 'friendly',
            context.openaiApiKey || undefined,
            context.businessAccountId,
            hasProducts,
            context.responseLength || 'balanced'
          );
          
          // If the new response has tool calls, handle them
          if (finalResponse.tool_calls && finalResponse.tool_calls.length > 0) {
            const result = await this.handleToolCalls(finalResponse, context, originalQuestion, relevantTools, appointmentsEnabled, true, systemContext);
            
            // Fetch fresh lead data after lead capture
            const freshLeadForPostLead = await storage.getLeadByConversation(conversationId, context.businessAccountId);
            
            // DEFLECTION GATE: Check if response is a deflection and route to fallback template
            let responseToStore = result.response;
            if (this.isDeflectionResponse(result.response) || result.response.includes('[[FALLBACK]]')) {
              console.log('[Deflection Gate] Post-lead handleToolCalls returned deflection, routing to fallback template');
              const fallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
              
              let fallbackTemplate = fallbackInstructions && fallbackInstructions.length > 0
                ? fallbackInstructions[0]
                : "I'll need to check with our team for the specific details. Could you please share your contact information so they can reach out to you?";
              
              fallbackTemplate = this.processFallbackPlaceholders(fallbackTemplate, freshLeadForPostLead);
              const rephrased = await this.rephraseFallbackMessage(
                fallbackTemplate,
                originalQuestion,
                context.businessAccountId,
                context.openaiApiKey || undefined,
                freshLeadForPostLead
              );
              responseToStore = rephrased;
            }
            
            conversationMemory.storeMessage(context.userId, 'assistant', responseToStore);
            await this.storeMessageInDB(conversationId, 'assistant', responseToStore);
            return responseToStore;
          }
          
          // Store and return the final response
          const finalContent = finalResponse.content || 'Thank you! How can I assist you further?';
          conversationMemory.storeMessage(context.userId, 'assistant', finalContent);
          await this.storeMessageInDB(conversationId, 'assistant', finalContent);
          
          return finalContent;
        }
      }

      // Simple conversational response (no lead completion)
      let responseContent = aiResponse.content || 'I apologize, but I could not generate a response.';
      
      // FALLBACK INSTRUCTION HANDLING: If AI deflects, use user-defined fallback template DIRECTLY
      if (this.isDeflectionResponse(responseContent)) {
        const fallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
        if (fallbackInstructions && fallbackInstructions.length > 0) {
          console.log('[Fallback Instruction] Using fallback template with AI rephrasing');
          
          let fallbackTemplate = fallbackInstructions[0];
          fallbackTemplate = this.processFallbackPlaceholders(fallbackTemplate, existingLead);
          
          responseContent = await this.rephraseFallbackMessage(
            fallbackTemplate, 
            userMessage, 
            context.businessAccountId,
            context.openaiApiKey || undefined,
            existingLead
          );
          console.log('[Fallback Instruction] Rephrased template applied:', responseContent.substring(0, 100) + '...');
        } else {
          responseContent = this.stripFallbackMarker(responseContent);
          console.log('[Fallback] No template configured, using stripped AI response');
        }
      }
      
      // SAFETY: Always strip [[FALLBACK]] marker before returning (in case it leaked through)
      responseContent = this.stripFallbackMarker(responseContent);
      
      conversationMemory.storeMessage(context.userId, 'assistant', responseContent);
      await this.storeMessageInDB(conversationId, 'assistant', responseContent);
      
      // Monitor post-resolution feedback (if customer responds after AI auto-resolved ticket)
      await feedbackMonitoringService.monitorPostResolutionFeedback(
        context.businessAccountId,
        conversationId,
        userMessage
      );

      // Check if we should auto-escalate to support ticket (async, non-blocking)
      this.checkAutoEscalationAsync(conversationId, context.businessAccountId, userMessage, responseContent);
      
      // Auto-detect low-confidence responses for Question Bank
      await this.detectAndLogUnansweredQuestion(
        conversationId,
        context.businessAccountId,
        userMessage,
        responseContent
      );
      
      // Auto-categorize conversation after sufficient activity (async, non-blocking).
      // Summarization is intentionally NOT run mid-chat: the idle/close sweep worker
      // (conversationSummarySweepWorker) is the single summarizer. This guarantees at
      // most one summary per quiet period and keeps total AI summary cost strictly
      // below the previous per-cadence behavior.
      this.autoCategorizeConversationAsync(conversationId, context.businessAccountId, context.openaiApiKey);
      
      return responseContent;
    } catch (error: any) {
      console.error('Chat service error:', error);
      return "I'm having trouble processing your request right now. Please try again.";
    }
  }

  private async detectAndLogUnansweredQuestion(
    conversationId: string,
    businessAccountId: string,
    userQuestion: string,
    aiResponse: string
  ): Promise<void> {
    try {
      // Check if Question Bank is enabled for this business account
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      if (businessAccount?.questionBankEnabled !== 'true') {
        return;
      }

      // Patterns that indicate the AI couldn't answer properly
      const lowConfidencePatterns = [
        /i don't (know|have|understand)/i,
        /i('m| am) (not sure|unable|sorry)/i,
        /i (can't|cannot) (help|assist|answer)/i,
        /i don't have (that|this|enough) information/i,
        /please (contact|reach out|get in touch)/i,
        /i apologize.*(couldn't|can't|cannot)/i,
        /unfortunately.*(don't|can't|cannot)/i,
        /i'm having trouble/i,
        /i don't appear to have/i,
        /not able to (find|locate|help)/i
      ];

      // Check if the response matches any low-confidence pattern
      const isLowConfidence = lowConfidencePatterns.some(pattern => pattern.test(aiResponse));
      
      if (!isLowConfidence) {
        return;
      }

      // Calculate a simple confidence score (0-1) based on response patterns
      let confidenceScore = 0.3; // Default low confidence
      if (aiResponse.length < 50) confidenceScore = 0.2; // Very short response
      if (aiResponse.includes("I apologize")) confidenceScore = 0.25;
      if (aiResponse.includes("I'm not sure")) confidenceScore = 0.15;
      if (aiResponse.includes("I don't know")) confidenceScore = 0.1;

      // Try to categorize the question based on keywords
      let category = 'general';
      if (/price|cost|payment|fee/i.test(userQuestion)) category = 'pricing';
      else if (/product|item|sell|buy/i.test(userQuestion)) category = 'product';
      else if (/shipping|deliver|ship/i.test(userQuestion)) category = 'shipping';
      else if (/return|refund|exchange/i.test(userQuestion)) category = 'returns';
      else if (/support|help|problem|issue/i.test(userQuestion)) category = 'support';
      else if (/account|login|password/i.test(userQuestion)) category = 'account';

      // Create Question Bank entry
      await storage.createQuestionBankEntry({
        businessAccountId,
        conversationId,
        messageId: null,
        question: userQuestion,
        aiResponse,
        userContext: null,
        status: 'new',
        category,
        confidenceScore: confidenceScore.toString()
      });

      console.log('[Question Bank] Auto-logged low-confidence response:', {
        question: userQuestion.substring(0, 50),
        category,
        confidenceScore
      });
    } catch (error) {
      console.error('[Question Bank] Error auto-logging question:', error);
    }
  }

  private async handleToolCalls(
    aiResponse: any,
    context: ChatContext,
    userMessage: string,
    relevantTools: any[],
    appointmentsEnabled: boolean,
    skipDBStore: boolean = false,
    systemContext?: string
  ): Promise<{ response: string; products?: any[]; pagination?: any; searchQuery?: string; appointmentSlots?: { slots: Record<string, string[]>; durationMinutes: number }; nextFormStep?: { stepId: string; questionText: string; questionType: string; isRequired: boolean; options?: string[]; placeholder?: string }; jobs?: any[]; applicantId?: string }> {
    // Get conversationId first so we can pass it to tools
    const conversationId = await this.getOrCreateConversation(context);
    
    // Rebuild conversation history to include the latest user message
    const updatedHistory = conversationMemory.getConversationHistory(context.userId);
    
    const messages: any[] = [
      ...updatedHistory,
      { role: 'assistant' as const, content: aiResponse.content || '', tool_calls: aiResponse.tool_calls }
    ];

    // Track products if get_products tool is called
    let products: any[] | undefined;
    let pagination: any | undefined;
    let searchQuery: string | undefined;
    
    // Track appointment slots if get_appointments tool is called
    let appointmentSlots: { slots: Record<string, string[]>; durationMinutes: number } | undefined;

    let jobs: any[] | undefined;
    let applicantId: string | undefined;

    // Execute all tool calls
    for (const toolCall of aiResponse.tool_calls) {
      const toolName = toolCall.function.name;
      const toolParams = JSON.parse(toolCall.function.arguments);

      if (toolName === 'parse_resume_and_match') {
        if (context.resumeText) {
          toolParams.resumeText = context.resumeText;
          toolParams.conversationId = conversationId;
          if (context.resumeUrl) toolParams.resumeUrl = context.resumeUrl;
          console.log(`[Chat] Overriding parse_resume_and_match params with actual resume text (${context.resumeText.length} chars)${context.resumeUrl ? ' + PDF URL' : ''}`);
        } else {
          console.warn(`[Chat] parse_resume_and_match called but no context.resumeText available — blocking tool call`);
          const errorResult = { success: false, message: 'No resume was uploaded yet. Please upload your resume PDF first so I can match you with relevant jobs.' };
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(errorResult) });
          continue;
        }
      }

      const result = await ToolExecutionService.executeTool(
        toolName,
        toolParams,
        {
          businessAccountId: context.businessAccountId,
          userId: context.userId,
          conversationId: conversationId,
          visitorCity: context.visitorCity,
          userMessage: userMessage,
          selectedLanguage: context.preferredLanguage,
          channel: context.channel,
          cpId: context.topscholarCpId,
          cpIds: context.topscholarCpIds,
          chapter: context.studentChapter,
        },
        userMessage,
        appointmentsEnabled
      );

      // Capture products if this was a get_products call (including pagination for "Show More")
      if (toolName === 'get_products' && result.success && 'data' in result && Array.isArray(result.data)) {
        products = result.data;
        // Capture pagination info for "Show More" functionality
        if ('pagination' in result) {
          pagination = result.pagination;
          // Get the original search query from the tool params
          searchQuery = toolParams.search || userMessage;
        }
      }
      
      if ((toolName === 'search_jobs' || toolName === 'parse_resume_and_match') && result.success && 'data' in result && Array.isArray(result.data) && result.data.length > 0) {
        if (!jobs) jobs = result.data;
        if (result.applicant) {
          applicantId = result.applicant.id;
        }
      }

      // Capture appointment slots if this was a get_appointments call
      if (toolName === 'get_appointments' && result.success && 'data' in result && result.data) {
        const data = result.data as { slots?: Record<string, string[]>; duration_minutes?: number };
        if (data.slots && Object.keys(data.slots).length > 0) {
          appointmentSlots = {
            slots: data.slots,
            durationMinutes: data.duration_minutes || 30
          };
          console.log('[Appointments] Captured slots for calendar UI:', Object.keys(data.slots).length, 'days');
        }
      }

      // RELEVANCE GATE: Check all FAQ/product candidates and keep first relevant one
      // If none are relevant, indicate no matches found to trigger fallback
      // Strip imageUrl from product data sent to AI — AI has no use for image URLs and may embed them as markdown
      let resultForAI = (toolName === 'get_products' && result.success && 'data' in result && Array.isArray(result.data))
        ? { ...result, data: result.data.map(({ imageUrl, ...rest }: any) => rest) }
        : result;
      if (toolName === 'get_products' && result.success && 'data' in result && Array.isArray(result.data) && result.data.length > 0) {
        resultForAI = {
          ...resultForAI,
          _ui_note: `IMPORTANT: Product cards are automatically displayed to the user in the chat UI. Do NOT list product names, prices, or details in your text response. Just write a brief, natural intro sentence (e.g. "Here are some great options for you!") and optionally ask a follow-up question. Never use bullet points or numbered lists for product names.`
        };
      }
      if ((toolName === 'search_jobs' || toolName === 'parse_resume_and_match') && result.success && 'data' in result && Array.isArray(result.data) && result.data.length > 0) {
        resultForAI = {
          ...resultForAI,
          _ui_note: `CRITICAL INSTRUCTION — FOLLOW EXACTLY: Job cards with full details (title, salary, location, skills, match score, Apply button) are ALREADY rendered as visual cards in the chat UI below your message. You MUST NOT list any job titles, locations, salaries, departments, or details in your text — not as bullet points, numbered lists, or inline mentions. Your ENTIRE response must be ONE short paragraph (2-3 sentences max), e.g. "Great news! I found some positions that match your profile. You can browse the cards below and click Apply Now on any role you like!" NEVER list specific job names.`
        };
      }
      let toolResultContent = JSON.stringify(resultForAI);
      
      if (result.success && 'data' in result && Array.isArray(result.data) && result.data.length > 0) {
        if (toolName === 'get_faqs') {
          // Find the first FAQ that passes relevance check
          let relevantFaq = null;
          let bestRelevanceInfo = { score: 0, reason: '' };
          
          for (const faq of result.data) {
            const relevanceCheck = this.checkRelevance(
              userMessage,
              { question: faq.question, answer: faq.answer },
              'faq'
            );
            
            if (relevanceCheck.isRelevant) {
              relevantFaq = faq;
              console.log(`[Relevance Gate] FAQ PASSED in handleToolCalls (${relevanceCheck.score}%): ${relevanceCheck.reason}`);
              break; // Use first relevant FAQ
            } else if (relevanceCheck.score > bestRelevanceInfo.score) {
              bestRelevanceInfo = { score: relevanceCheck.score, reason: relevanceCheck.reason };
            }
          }
          
          if (!relevantFaq) {
            console.log(`[Relevance Gate] All ${result.data.length} FAQs FAILED in handleToolCalls (best: ${bestRelevanceInfo.score}%): ${bestRelevanceInfo.reason}`);
            // No relevant FAQs - indicate to AI that no matches were found
            toolResultContent = JSON.stringify({
              success: true,
              data: [],
              message: 'No FAQs found that match the user\'s specific question. You should use your fallback response.'
            });
          } else {
            // Use only the relevant FAQ
            toolResultContent = JSON.stringify({
              success: true,
              data: [relevantFaq]
            });
          }
        } else if (toolName === 'get_products') {
          // Find the first product that passes relevance check
          let relevantProducts: any[] = [];
          let checkedCount = 0;
          
          for (const product of result.data) {
            const relevanceCheck = this.checkRelevance(
              userMessage,
              { name: product.name, description: product.description },
              'product'
            );
            
            if (relevanceCheck.isRelevant) {
              relevantProducts.push(product);
              if (relevantProducts.length === 1) {
                console.log(`[Relevance Gate] Product PASSED in handleToolCalls (${relevanceCheck.score}%): ${relevanceCheck.reason}`);
              }
            }
            checkedCount++;
            if (relevantProducts.length >= 5) break; // Limit to 5 relevant products
          }
          
          if (relevantProducts.length === 0) {
            console.log(`[Relevance Gate] All ${checkedCount} products FAILED in handleToolCalls`);
            // No relevant products - indicate to AI that no matches were found
            toolResultContent = JSON.stringify({
              success: true,
              data: [],
              message: 'No products found that match the user\'s specific query.'
            });
            products = undefined; // Don't show irrelevant products
          } else {
            console.log(`[Relevance Gate] Found ${relevantProducts.length} relevant products out of ${checkedCount} checked`);
            toolResultContent = JSON.stringify({
              success: true,
              data: relevantProducts
            });
            products = relevantProducts; // Only show relevant products
          }
        }
      }

      // Add tool result to messages
      messages.push({
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        content: toolResultContent
      });

      // DETERMINISTIC LEAD COMPLETION DETECTION: Check if all required fields were just collected
      // When this flag is present, inject a reminder to answer the original question
      if (result.success && 'data' in result && result.data && typeof result.data === 'object' && 'allRequiredFieldsCollected' in result.data && result.data.allRequiredFieldsCollected === true) {
        console.log('[Lead Completion] All required fields collected - injecting reminder to answer original question');
        
        // Inject system message AFTER tool results but BEFORE AI continues
        // This ensures AI remembers to answer the user's original question
        messages.push({
          role: 'system' as const,
          content: `🎯 IMPORTANT REMINDER: You just finished collecting ALL required contact information from the customer. Now, IMMEDIATELY answer their original question that they asked at the start of this conversation. Do NOT ask "How can I help you?" or "Would you like to know about [topic]?" - they ALREADY asked a question. Review the conversation history to find their initial query and answer it directly in your next response. Example: "Thank you! Now, about [their original question]..." and then provide the complete answer.`
        });
      }
    }

    // Include system context so continueToolConversation has proper persona/instructions
    const messagesForContinuation = systemContext
      ? [{ role: 'system' as const, content: systemContext }, ...messages]
      : messages;

    // When K12 tools already returned data, don't pass tools to the continuation
    // call — prevents AI from calling another tool instead of answering
    const executedToolNames = aiResponse.tool_calls.map((tc: any) => tc.function.name);
    const hasK12ToolResult = executedToolNames.some((n: string) => n === 'fetch_k12_topic' || n === 'fetch_k12_questions');
    const continuationTools = hasK12ToolResult ? [] : relevantTools;

    // Get final response from AI with tool results (using same relevant tools)
    const finalResponse = await llamaService.continueToolConversation(
      messagesForContinuation,
      continuationTools,
      context.personality || 'friendly',
      context.openaiApiKey || undefined,
      context.businessAccountId,
      context.preferredLanguage,
      context.responseLength || 'balanced'
    );

    const responseContent = finalResponse.content || 'I processed your request.';
    conversationMemory.storeMessage(context.userId, 'assistant', responseContent);
    
    // Only store to DB if not in a secondary/nested context (post-lead, post-refusal processing)
    // Those flows will store the final processed response themselves
    if (!skipDBStore) {
      await this.storeMessageInDB(conversationId, 'assistant', responseContent);
    }
    
    // Monitor post-resolution feedback (if customer responds after AI auto-resolved ticket)
    await feedbackMonitoringService.monitorPostResolutionFeedback(
      context.businessAccountId,
      conversationId,
      userMessage
    );
    
    // Check if we should auto-escalate to support ticket (async, non-blocking)
    this.checkAutoEscalationAsync(conversationId, context.businessAccountId, userMessage, responseContent);
    
    // Compute current OTP state AFTER all tool execution (capture_lead / verify_phone_otp
    // may have created / verified / locked a challenge during this turn). This metadata
    // is the source of truth the widget reads to switch composer modes — exposed both
    // as response metadata (per Task #14 contract) and as a 'otp_state' SSE event in
    // the streaming path. Non-widget channels skip to avoid leaking phone-masking.
    let otpStateMetadata: any | undefined = undefined;
    if (context.channel === 'widget') {
      try {
        const snap = await OtpService.getLatestStateForConversation(context.businessAccountId, conversationId);
        otpStateMetadata = {
          awaiting_otp: !!snap.awaiting_otp,
          locked: !!snap.locked,
          ...(snap.locked_until ? { locked_until: snap.locked_until } : {}),
          ...(snap.phone_masked ? { phone_masked: snap.phone_masked } : {}),
        };
      } catch (err) {
        console.error('[OTP] Failed to load state for response metadata:', err);
      }
    }

    // Always return object format for consistency
    return { 
      response: responseContent, 
      products: products && products.length > 0 ? products : undefined,
      pagination: pagination,
      searchQuery: searchQuery,
      appointmentSlots: appointmentSlots,
      jobs: jobs && jobs.length > 0 ? jobs : undefined,
      applicantId: applicantId,
      // Task #14 contract: OTP state metadata for the widget composer.
      // Widget reads `awaiting_otp` (switch composer to numeric, maxLength 6,
      // disable send until exactly 6 digits) and `locked_until` (disable composer
      // with countdown banner). Only present on the widget channel.
      awaiting_otp: otpStateMetadata?.awaiting_otp,
      locked_until: otpStateMetadata?.locked_until,
      otp_state: otpStateMetadata,
    };
  }

  /**
   * Check if conversation should be auto-escalated to a support ticket
   * Runs async (non-blocking) with debouncing to avoid repeated expensive checks
   */
  private checkAutoEscalationAsync(
    conversationId: string,
    businessAccountId: string,
    customerMessage: string,
    aiResponse: string
  ): void {
    // Check if we've already escalated checked recently for this conversation
    const lastCheck = this.lastEscalationCheck.get(conversationId) || 0;
    const now = Date.now();
    
    if (now - lastCheck < this.ESCALATION_CHECK_DEBOUNCE_MS) {
      return; // Skip this check, ran too recently
    }
    
    this.lastEscalationCheck.set(conversationId, now);
    
    // Run escalation check async (non-blocking)
    (async () => {
      try {
        // Get conversation history for analysis (only get last few messages, not all)
        const messages = await storage.getMessagesByConversation(conversationId, businessAccountId);
        // Only use last 10 messages to keep analysis fast
        const recentMessages = messages.slice(-10);
        const conversationHistory = recentMessages.map(m => ({
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          content: m.content
        }));

        // Analyze if escalation is needed
        const escalationAnalysis = await autoEscalationService.analyzeForEscalation(
          businessAccountId,
          conversationId,
          customerMessage,
          aiResponse,
          conversationHistory
        );

        // Get business account's escalation sensitivity setting
        const businessAccount = await storage.getBusinessAccount(businessAccountId);
        const escalationSensitivity = businessAccount?.escalationSensitivity || 'medium';

        // Apply escalation sensitivity to final decision
        let shouldActuallyEscalate = escalationAnalysis.shouldEscalate;
        
        if (escalationSensitivity === 'low') {
          shouldActuallyEscalate = escalationAnalysis.shouldEscalate && escalationAnalysis.confidence >= 0.8;
          if (escalationAnalysis.shouldEscalate && !shouldActuallyEscalate) {
            console.log(`[Chat] Escalation skipped due to low sensitivity (confidence ${escalationAnalysis.confidence} < 0.8)`);
          }
        } else if (escalationSensitivity === 'high') {
          shouldActuallyEscalate = escalationAnalysis.shouldEscalate || 
            (escalationAnalysis.confidence >= 0.5 && (escalationAnalysis.priority === 'high' || escalationAnalysis.priority === 'urgent'));
          if (!escalationAnalysis.shouldEscalate && shouldActuallyEscalate) {
            console.log(`[Chat] Escalation triggered by high sensitivity (confidence ${escalationAnalysis.confidence}, priority ${escalationAnalysis.priority})`);
          }
        }

        if (shouldActuallyEscalate) {
          console.log('[Chat] Auto-escalating conversation to support ticket. Reason:', escalationAnalysis.reason);
          
          const ticketId = await autoEscalationService.autoEscalateToTicket(
            businessAccountId,
            conversationId,
            escalationAnalysis
          );

          if (ticketId) {
            console.log('[Chat] Support ticket created and auto-resolved (if high confidence):', ticketId);
          }
        }
      } catch (error) {
        console.error('[Chat] Error in auto-escalation check:', error);
      }
    })();
  }

  /**
   * Auto-categorize conversation after it has sufficient activity
   * Runs async (non-blocking) and only categorizes if not already categorized
   * and conversation has at least 2 user messages
   */
  private autoCategorizeConversationAsync(
    conversationId: string,
    businessAccountId: string,
    openaiApiKey?: string | null
  ): void {
    // Run categorization async (non-blocking)
    (async () => {
      try {
        // Check if conversation is already categorized
        const conversation = await storage.getConversation(conversationId, businessAccountId);
        if (conversation?.category) {
          return; // Already categorized
        }

        // Count user messages to ensure sufficient activity
        const messages = await storage.getMessagesByConversation(conversationId, businessAccountId);
        const userMessageCount = messages.filter(m => m.role === 'user').length;
        
        // Only categorize if at least 1 user message exists
        if (userMessageCount < 1) {
          return;
        }

        console.log(`[AutoCategorize] Categorizing conversation ${conversationId} with ${userMessageCount} user messages`);
        
        const success = await categorizeAndSaveConversation(conversationId, businessAccountId, openaiApiKey || undefined);
        
        if (success) {
          console.log(`[AutoCategorize] Successfully categorized conversation ${conversationId}`);
        }
      } catch (error) {
        console.error('[AutoCategorize] Error:', error);
      }
    })();
  }

  /**
   * Task #8: idle/close summary entry point used by the background sweep worker.
   * This is the SINGLE summarizer — summaries are no longer produced mid-chat.
   * It is awaitable and runs no cadence gate (the sweep query has already decided
   * the summary is stale/missing). It re-runs a FULL summary of the whole
   * conversation and reuses the same change-gated LeadSquared push, so the CRM
   * only sees an update when the summary/topics actually changed. Returns true
   * when a fresh summary was saved. Best-effort: never throws.
   */
  async summarizeConversationOnIdle(
    conversationId: string,
    businessAccountId: string,
    openaiApiKey?: string | null,
  ): Promise<boolean> {
    try {
      const conversation = await storage.getConversation(conversationId, businessAccountId);
      const prevSummary = conversation?.summary ?? null;
      const prevTopics = conversation?.topicKeywords ?? null;

      const success = await summarizeAndSaveConversation(conversationId, openaiApiKey || undefined);
      if (!success) return false;

      const updated = await storage.getConversation(conversationId, businessAccountId);
      const summaryChanged = (updated?.summary ?? null) !== prevSummary;
      const topicsChanged = (updated?.topicKeywords ?? null) !== prevTopics;
      if (summaryChanged || topicsChanged) {
        await this.syncConversationSummaryToLeadSquared(conversationId, businessAccountId);
      }
      return true;
    } catch (error) {
      console.error('[IdleSummarize] Error for conversation', conversationId, error);
      return false;
    }
  }

  /**
   * Gated post-summarization CRM push: when a conversation gets a new AI summary,
   * sync it to LeadSquared so mapped conversation.summary / conversation.topics
   * fields land on the lead. Runs only when LeadSquared is enabled + configured,
   * at least one enabled conversation.* mapping exists, and the conversation has
   * an associated lead with a phone or email. Fully best-effort.
   */
  private async syncConversationSummaryToLeadSquared(
    conversationId: string,
    businessAccountId: string,
  ): Promise<void> {
    try {
      // 1) LeadSquared must be enabled + credentials present.
      const settings = await storage.getWidgetSettings(businessAccountId);
      if (!settings?.leadsquaredEnabled || settings.leadsquaredEnabled !== 'true') return;
      if (!settings.leadsquaredAccessKey || !settings.leadsquaredSecretKey || !settings.leadsquaredRegion) return;

      // 2) At least one enabled dynamic conversation.* mapping must be configured.
      const fieldMappings = await storage.getLeadsquaredFieldMappings(businessAccountId);
      const hasConversationMapping = fieldMappings.some(
        m => m.isEnabled === 'true' && m.sourceType === 'dynamic' && m.sourceField?.startsWith('conversation.'),
      );
      if (!hasConversationMapping) return;

      // 3) The conversation must have an associated lead with a phone or email
      //    that is ALREADY synced to LeadSquared (has a leadsquaredLeadId). This
      //    keeps the post-summarization push strictly an UPDATE — it never
      //    creates a new CRM lead from a summarization event. Unsynced leads get
      //    their conversation.* fields when their normal create/sync flow runs.
      const lead = await storage.getLeadByConversation(conversationId, businessAccountId);
      if (!lead || (!lead.phone && !lead.email)) return;
      if (!lead.leadsquaredLeadId) return;

      console.log('[LeadSquared] Post-summarization sync for conversation', conversationId, '→ lead', lead.id);
      await this.syncLeadToLeadSquared(
        {
          id: lead.id,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          leadsquaredLeadId: lead.leadsquaredLeadId,
        },
        businessAccountId,
        true,
        ['conversationSummary'],
      );
    } catch (error) {
      console.error('[LeadSquared] Post-summarization sync failed (continuing):', error);
    }
  }

  async *streamMessage(userMessage: string, context: ChatContext) {
    try {
      // Get conversation history to check if this is a new conversation
      const existingHistory = conversationMemory.getConversationHistory(context.userId);
      const isFirstMessage = existingHistory.length === 0;
      
      // SPAM DETECTION: Check first message - if spam, use simplified path (no DB, no journeys, just AI response)
      // Skip spam check for resume uploads, job applications, and K12 image uploads — they must go through the full AI flow
      if (isFirstMessage && context.openaiApiKey && !userMessage.startsWith('[RESUME_UPLOAD]') && !userMessage.startsWith('[JOB_APPLY]') && !userMessage.startsWith('[IMAGE_UPLOAD]') && !context.resumeText && !context.imageText) {
        const spamCheck = await isGibberishAI(userMessage, context.openaiApiKey);
        if (spamCheck.isSpam && spamCheck.confidence === 'high') {
          console.log('[Chat] Spam detected - using simplified response path:', userMessage.substring(0, 50));
          
          // Yield temp conversation ID
          yield { type: 'conversation_id' as const, data: `temp_${context.userId}_${Date.now()}` };
          
          // Store in memory only (no DB)
          conversationMemory.storeMessage(context.userId, 'user', userMessage);
          
          // Call AI directly with minimal context - let it respond naturally
          const response = await this.getSimpleAIResponse(userMessage, context);
          conversationMemory.storeMessage(context.userId, 'assistant', response);
          
          // Stream the response
          yield { type: 'content' as const, data: response };
          yield { type: 'final' as const, data: response };
          yield { type: 'done' as const, data: '' };
          return;
        }
      }
      
      // Get or create conversation (normal flow)
      const conversationId = await this.getOrCreateConversation(context);
      
      // Yield conversationId first so client can store it for persistence
      yield { type: 'conversation_id' as const, data: conversationId };

      // TopScholar secure mode (Task #17): the account requires a signed launch
      // token but the launch was unsigned / invalidly-signed / missing required
      // fields. Refuse with the route-supplied message instead of invoking the
      // model. No other tenant sets this flag.
      if (context.topscholarRefusalMessage) {
        const secureBody = context.topscholarRefusalMessage;
        yield { type: 'content' as const, data: secureBody };
        yield { type: 'final' as const, data: secureBody };
        yield { type: 'done' as const, data: '' };
        return;
      }

      // TopScholar (grade-scoped) widget: subject is mandatory. When the portal
      // supplied a grade-scope (board/medium/grade) but no subject, refuse rather
      // than answering whole-grade. Fail closed with a clear, actionable message
      // instead of a generic out-of-scope refusal. No other tenant sets this flag.
      if (context.topscholarSubjectMissing) {
        const subjectRequiredBody = 'Please select a subject to begin. Your tutor needs to know which subject you want help with before it can answer.';
        yield { type: 'content' as const, data: subjectRequiredBody };
        yield { type: 'final' as const, data: subjectRequiredBody };
        yield { type: 'done' as const, data: '' };
        return;
      }

      // ─── OTP state derivation (widget channel only, v1) ──────────────────────
      // Detect any pending/locked OTP challenge for this conversation so the AI
      // can be locked into OTP-only mode and the client can render the digits-only
      // (or locked) composer. Non-widget channels skip entirely.
      let otpState = { awaiting_otp: false, locked: false } as Awaited<ReturnType<typeof OtpService.getLatestStateForConversation>>;
      let autoDetectAwaited = false;
      // Task #9 (Option A): track whether THIS turn freshly issued an OTP challenge
      // via the deterministic phone-hit path, so we can suppress the redundant
      // assistant "I've sent a code…" message — the OTP dialog is the only surface.
      let awaitingOtpBefore = false;
      let otpChallengeJustIssued = false;
      if (context.channel === 'widget') {
        // Task #23: If the user message likely contains a phone number, await
        // auto-detect synchronously BEFORE sampling OTP state — otherwise the
        // fire-and-forget at line ~2643 would issue the OTP challenge AFTER we
        // already snapshotted state, leaving the client without an otp_state
        // event for this turn (silent OTP miss).
        if (
          userMessage.length > 2 &&
          !context.skipLeadTraining &&
          (userMessage.match(/\d/g) || []).length >= 7
        ) {
          // Task #9 (Option A): snapshot OTP state BEFORE auto-detect so we can
          // tell whether this turn freshly issued a challenge (vs one already
          // pending from a prior turn).
          try {
            const beforeState = await OtpService.getLatestStateForConversation(context.businessAccountId, conversationId);
            awaitingOtpBefore = !!beforeState.awaiting_otp;
          } catch {
            // best-effort; default awaitingOtpBefore=false
          }
          try {
            const historyForCapture = conversationMemory.getConversationHistory(context.userId);
            const lastAIForCapture = historyForCapture.length > 0 && historyForCapture[historyForCapture.length - 1].role === 'assistant'
              ? historyForCapture[historyForCapture.length - 1].content
              : undefined;
            await this.autoDetectAndCaptureLead(
              userMessage,
              conversationId,
              context.businessAccountId,
              lastAIForCapture,
              context.visitorCity,
              context.visitorSessionId,
              context.pageUrl,
              context.channel,
            );
            autoDetectAwaited = true;
          } catch (err) {
            console.error('[Chat] Phone-hit auto-detect (await) error:', err);
          }
        }

        try {
          otpState = await OtpService.getLatestStateForConversation(context.businessAccountId, conversationId);
        } catch (err) {
          console.error('[OTP] Failed to load state for conversation:', err);
        }

        // Task #9 (Option A): a freshly-issued OTP challenge this turn (was NOT
        // already awaiting before auto-detect, now is) means the OTP dialog will
        // render. Suppress the redundant assistant chat message below.
        otpChallengeJustIssued = autoDetectAwaited && !awaitingOtpBefore && !!otpState.awaiting_otp;

        // Task #23: STRICT pre-chat / awaiting-verification refusal. When the
        // conversation row is flagged awaiting_verification (set by either the
        // Task #18 counting gate OR the Task #23 /otp/start route), the visitor
        // MUST complete OTP verification before any AI processing happens.
        // Emit the OTP state and end the stream — do NOT store the user message,
        // do NOT call the model, do NOT update conversation title. The widget's
        // composer is already locked client-side; this is server defense-in-depth.
        try {
          const awaitingFlag = await storage.isConversationAwaitingVerification(conversationId, context.businessAccountId);
          if (awaitingFlag) {
            // CAPTCHA gate: when this business uses the CAPTCHA (not OTP) gate,
            // an awaiting_verification conversation means the visitor hasn't
            // passed the reCAPTCHA challenge yet (or it failed). Refuse with a
            // CAPTCHA-specific message and do NOT attempt OTP recovery (which
            // would try to issue an SMS that captcha businesses don't have
            // configured). The widget's pre-chat modal handles the retry.
            try {
              const { deriveCaptchaMethodConfig } = await import('./services/otp');
              // Strategy-agnostic: covers pre-chat (start) AND mid-chat
              // (custom/intent/keyword). When CAPTCHA is the chosen method we
              // emit a captcha_state so the widget renders the reCAPTCHA checkbox
              // (carrying the public siteKey/provider/misconfigured) and refuse
              // the model until the visitor verifies.
              const captchaCfg = await deriveCaptchaMethodConfig(context.businessAccountId);
              if (captchaCfg.enabled) {
                const captchaBody = captchaCfg.misconfigured
                  ? 'Verification is temporarily unavailable. Please try again later.'
                  : 'Please complete the verification to continue chatting. Refresh the page if you don\'t see the verification box.';
                yield { type: 'captcha_state' as const, data: JSON.stringify({ required: true, provider: captchaCfg.provider, siteKey: captchaCfg.siteKey, misconfigured: captchaCfg.misconfigured }) };
                yield { type: 'content' as const, data: captchaBody };
                yield { type: 'final' as const, data: captchaBody };
                yield { type: 'done' as const, data: '' };
                return;
              }
            } catch (captchaErr) {
              console.warn('[CAPTCHA Gate] stream-refusal check failed (continuing with OTP path):', captchaErr);
            }
            // Task #23 refusal path. Two distinct sub-cases:
            //   (a) a challenge already exists (awaiting_otp or locked) →
            //       emit it so newer widgets render the OTP/lockout UI.
            //   (b) no challenge yet (flag set but no OTP issued — e.g. an
            //       older cached widget bundle that has no phone-entry
            //       modal and skipped /otp/start, sent a normal first
            //       /stream message) → emit a synthesized otp_state with a
            //       gate_required hint AND a human-readable `final` body so
            //       even bundles without the new modal show an actionable
            //       message instead of a silent dead-end.
            let hasActionable = otpState.awaiting_otp || otpState.locked;
            let effectiveState = otpState;
            // Task #23 (round-10): old cached widget bundles only render the
            // OTP modal on `awaiting_otp` / `locked`. If we're in
            // awaiting_verification with no active challenge (e.g. the
            // visitor hit /stream directly from an old bundle that skipped
            // /otp/start), try to recover an actionable state by looking up
            // a phone on the partial lead attached to this conversation and
            // issuing a real challenge. If that succeeds, both old and new
            // bundles get a real OTP modal instead of a text-only dead-end.
            if (!hasActionable) {
              try {
                const partialLead = await storage.getLeadByConversation(conversationId, context.businessAccountId);
                const phoneForRecovery = partialLead?.phone || null;
                if (phoneForRecovery) {
                  const { OtpService } = await import('./services/otp');
                  const issued = await OtpService.issueChallenge(
                    context.businessAccountId, conversationId, phoneForRecovery,
                    { leadId: partialLead?.id || null, channelOrigin: 'widget' },
                  );
                  if (issued.ok && issued.snapshot) {
                    effectiveState = issued.snapshot;
                    hasActionable = effectiveState.awaiting_otp || effectiveState.locked;
                    console.log('[OTP Gate] Stream-refusal recovery: issued challenge for awaiting-verification conv with partial-lead phone');
                  }
                }
              } catch (recoverErr) {
                console.warn('[OTP Gate] Stream-refusal recovery failed (continuing with synthesized state):', recoverErr);
              }
            }
            const refusalBody = hasActionable
              ? 'Please complete the OTP verification above to continue.'
              : 'To start chatting, please share your mobile number so we can verify it. Refresh the page if you don\'t see the verification box.';
            const synthState: import('./services/otp').OtpStateSnapshot = hasActionable
              ? effectiveState
              : { awaiting_otp: false, locked: false, gate_required: true };
            yield { type: 'otp_state' as const, data: JSON.stringify(synthState) };
            // Emit BOTH `content` and `final` so widgets that incrementally
            // render content AND widgets that swap a typing placeholder on
            // `final` both clear correctly (no hanging placeholder artifact).
            yield { type: 'content' as const, data: refusalBody };
            yield { type: 'final' as const, data: refusalBody };
            yield { type: 'done' as const, data: '' };
            return;
          }
        } catch (err) {
          console.error('[OTP Gate] awaiting_verification lookup failed (fail-open, continuing):', err);
        }

        if (otpState.awaiting_otp || otpState.locked) {
          yield { type: 'otp_state' as const, data: JSON.stringify(otpState) };
        }

        // Task #9 (Option A): when this turn freshly issued an OTP challenge, the
        // OTP verification dialog (driven by the otp_state event above) is the ONLY
        // surface for the verification step. Persist the visitor's phone message,
        // then end the turn with NO assistant text so the transcript shows no
        // redundant "I've sent a 6-digit code…" message. The widget's composer is
        // now locked to digit-entry which goes to the verify endpoint, not /stream.
        if (otpChallengeJustIssued) {
          conversationMemory.storeMessage(context.userId, 'user', userMessage);
          await this.storeMessageInDB(conversationId, 'user', userMessage, undefined, context.imageUrl);
          yield { type: 'final' as const, data: '' };
          yield { type: 'done' as const, data: '' };
          return;
        }

        // ─── Conversion tracking signal (Google Ads) ──────────────────────────
        // Reaching here means the conversation is NOT awaiting verification (the
        // awaiting-refusal paths above all `return`). If a mobile number has been
        // captured on this conversation's lead and the business configured a
        // conversion URL, emit a one-time `lead_captured` signal so the widget
        // fires the hidden conversion iframe in the VISITOR's browser. This is
        // the single hook for every ungated capture path (mid-chat smart capture:
        // custom/intent/keyword/start). Gated paths (OTP/CAPTCHA) fire on their
        // verify endpoint instead; the atomic marker prevents any double-fire.
        try {
          const fired = await this.maybeFireConversion(conversationId, context.businessAccountId);
          if (fired) {
            yield { type: 'lead_captured' as const, data: '' };
          }
        } catch (convErr) {
          console.error('[Conversion] SSE lead-captured check failed (non-fatal):', convErr);
        }
      }
      // ─────────────────────────────────────────────────────────────────────────
      
      // Get conversation history to check if AI recently asked for name
      const history = conversationMemory.getConversationHistory(context.userId);
      const lastAIMessage = history.length > 0 && history[history.length - 1].role === 'assistant' 
        ? history[history.length - 1].content 
        : undefined;
      
      // Auto-detect and capture contact information from user message
      // Skip for very short messages (likely not containing contact info)
      // Skip lead capture entirely for guidance chatbot
      if (userMessage.length > 2 && !context.skipLeadTraining && !autoDetectAwaited) {
        // Run async to avoid blocking response. Skipped when we already awaited
        // it above for a phone-hit (Task #23) to avoid double-processing.
        this.autoDetectAndCaptureLead(userMessage, conversationId, context.businessAccountId, lastAIMessage, context.visitorCity, context.visitorSessionId, context.pageUrl, context.channel).catch(err => {
          console.error('[Chat] Error in auto lead capture:', err);
        });
      }
      
      // Generate and update conversation title from first user message (async, non-blocking)
      if (context.openaiApiKey) {
        this.maybeUpdateConversationTitle(conversationId, context.businessAccountId, userMessage, context.openaiApiKey).catch(err => {
          console.error('[Chat] Error updating conversation title:', err);
        });
      }
      
      // PERFORMANCE: Early check if business has any active journeys
      // Skip all journey processing if no journeys exist for this account
      const hasActiveJourneys = await journeyService.hasActiveJourneys(context.businessAccountId);
      let isJourneyActive = false;
      
      if (hasActiveJourneys) {
        // Auto-inject journey conversational guidelines if not already provided and if journey is active
        if (!context.journeyConversationalGuidelines) {
          const activeJourneyState = await journeyService.getJourneyState(conversationId);
          if (activeJourneyState && !activeJourneyState.completed) {
            const journey = await storage.getJourney(activeJourneyState.journeyId, context.businessAccountId);
            if (journey && journey.conversationalGuidelines) {
              // Parse journey instructions from JSON array and format as string
              try {
                const instructions = JSON.parse(journey.conversationalGuidelines);
                if (Array.isArray(instructions) && instructions.length > 0) {
                  context.journeyConversationalGuidelines = instructions
                    .map((inst: any, index: number) => `${index + 1}. ${inst.text}`)
                    .join('\n');
                }
              } catch {
                // Legacy format - use as-is if not JSON
                context.journeyConversationalGuidelines = journey.conversationalGuidelines;
              }
            }
          }
        }
      }
      
      // Store user message in memory and database
      conversationMemory.storeMessage(context.userId, 'user', userMessage);
      await this.storeMessageInDB(conversationId, 'user', userMessage, undefined, context.imageUrl);

      if (userMessage.startsWith('[JOB_APPLY]')) {
        const applyMatch = userMessage.match(/\|jobId:([^|]+)\|applicantId:([^|]+)/);
        const clientJobTitle = userMessage.replace(/^\[JOB_APPLY\]\s*/, '').replace(/\s*\|jobId:.*$/, '').trim();
        if (applyMatch) {
          const jobId = applyMatch[1].trim();
          const applicantId = applyMatch[2].trim();
          console.log(`[Chat Stream] JOB_APPLY intercept: jobId=${jobId}, applicantId=${applicantId}, title="${clientJobTitle}"`);
          try {
            const result = await ToolExecutionService.executeTool(
              'apply_to_job',
              { jobId, applicantId },
              {
                businessAccountId: context.businessAccountId,
                userId: context.userId,
                conversationId: conversationId,
                visitorCity: context.visitorCity,
                userMessage: userMessage,
                selectedLanguage: context.preferredLanguage
              },
              userMessage,
              false
            );
            const resultData = result.success && 'data' in result && result.data ? result.data : {};
            const serverTitle = resultData.jobTitle || clientJobTitle;
            const reply = result.success
              ? `Your application for **${serverTitle}** has been submitted successfully! The hiring team will review your profile and get back to you soon.`
              : `Sorry, I couldn't submit your application. ${result.message || 'Please try again.'}`;
            conversationMemory.storeMessage(context.userId, 'assistant', reply);
            await this.storeMessageInDB(conversationId, 'assistant', reply);
            yield { type: 'content' as const, data: reply };
            yield { type: 'final' as const, data: reply };
            yield { type: 'done' as const, data: '' };
            return;
          } catch (err) {
            console.error('[Chat Stream] JOB_APPLY error:', err);
            const errReply = `Sorry, something went wrong while submitting your application. Please try again.`;
            conversationMemory.storeMessage(context.userId, 'assistant', errReply);
            await this.storeMessageInDB(conversationId, 'assistant', errReply);
            yield { type: 'content' as const, data: errReply };
            yield { type: 'final' as const, data: errReply };
            yield { type: 'done' as const, data: '' };
            return;
          }
        } else {
          const errReply = 'Sorry, the application request was malformed. Please try clicking Apply Now again.';
          conversationMemory.storeMessage(context.userId, 'assistant', errReply);
          await this.storeMessageInDB(conversationId, 'assistant', errReply);
          yield { type: 'content' as const, data: errReply };
          yield { type: 'final' as const, data: errReply };
          yield { type: 'done' as const, data: '' };
          return;
        }
      }

      // K12 IMAGE UPLOAD: replace placeholder with the OCR'd question text so that
      // RAG document search, K12 tool calls, FAQ matching, and the LLM all see
      // the actual academic question instead of "[IMAGE_UPLOAD] filename.jpg".
      // The original placeholder remains in conversation history (already stored above).
      // This runs AFTER reserved-prefix protocol checks (e.g. [JOB_APPLY]) so that
      // OCR text cannot spoof internal command protocols.
      if (context.imageText && userMessage.startsWith('[IMAGE_UPLOAD]')) {
        const ocrText = context.imageText.trim();
        if (ocrText.length > 0) {
          console.log(`[Chat Stream] Replacing [IMAGE_UPLOAD] placeholder with OCR'd question text (${ocrText.length} chars) for search and LLM`);
          userMessage = ocrText;
        }
      }

      try {
        const { getSmartReplyResponse } = await import('./services/smartReplyService');
        const smartReply = await getSmartReplyResponse(context.businessAccountId, "website", userMessage);
        if (smartReply) {
          console.log(`[Chat Stream] Smart reply matched: "${smartReply.matchedKeyword}" — returning configured response directly (skipping AI)`);
          conversationMemory.storeMessage(context.userId, 'assistant', smartReply.text);
          await this.storeMessageInDB(conversationId, 'assistant', smartReply.text);
          yield { type: 'content' as const, data: smartReply.text };
          yield { type: 'final' as const, data: smartReply.text };
          yield { type: 'done' as const, data: '' };
          return;
        }
      } catch (err) {
        console.error("[Chat Stream] Smart reply error (non-fatal):", err);
      }

      // Only process journeys if business has active journeys configured
      if (hasActiveJourneys) {
        // ENGINE-DRIVEN MODE: Try processing through journey engine first
        const engineResult = await journeyOrchestrator.processUserMessageEngineDriven(
          conversationId,
          context.userId,
          context.businessAccountId,
          userMessage
        );

        // If engine handled the message, stream engine's response
        if (engineResult.shouldBypassAI && engineResult.response) {
          console.log('[Chat] Engine-driven journey handled message - bypassing AI (streaming)');
          
          // For form journeys, emit form_step SSE event for visual UI
          if (engineResult.formStep) {
            console.log('[Chat Stream] Engine returned form step - emitting form_step:', engineResult.formStep.questionText?.substring(0, 30));
            // Include conversationId so client can track which conversation to use for form step submission
            // Include isComplete flag so widget knows when to disable chat input after journey ends
            yield { type: 'form_step' as const, data: JSON.stringify({ ...engineResult.formStep, conversationId, journeyComplete: engineResult.isComplete }) };
          }

          // For conversational journeys with dropdown/radio steps, emit the choices as
          // quick-reply buttons so the visitor can tap an answer instead of typing.
          if (engineResult.options && engineResult.options.length > 0) {
            console.log('[Chat Stream] Engine returned conversational journey options - emitting journey_options:', engineResult.options.length);
            yield { type: 'journey_options' as const, data: JSON.stringify({ options: engineResult.options }) };
          }
          
          // Store engine's response
          conversationMemory.storeMessage(context.userId, 'assistant', engineResult.response);
          await this.storeMessageInDB(conversationId, 'assistant', engineResult.response);
          
          // Stream the response word-by-word for natural typing effect
          const words = engineResult.response.split(' ');
          for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const chunk = i === words.length - 1 ? word : word + ' ';
            yield { type: 'content' as const, data: chunk };
          }
          
          yield { type: 'final' as const, data: engineResult.response };
          yield { type: 'done' as const, data: '' };
          return;
        }

        // Fall back to AI-guided journey (if enabled) or normal chat
        const journeyResult = await journeyOrchestrator.processUserMessage(
          conversationId,
          context.userId,
          context.businessAccountId,
          userMessage
        );
        isJourneyActive = journeyResult.isJourneyActive;
        
        // For form journeys triggered by keyword, emit form_step SSE event for visual UI
        // Return early to prevent AI from asking the same question as text
        if (journeyResult.formStep) {
          console.log('[Chat Stream] Form journey triggered by keyword - emitting form_step:', journeyResult.formStep.questionText?.substring(0, 30));
          // Include conversationId so client can track which conversation to use for form step submission
          yield { type: 'form_step' as const, data: JSON.stringify({ ...journeyResult.formStep, conversationId }) };
          
          // Store a brief acknowledgment as AI response (not the question itself)
          const acknowledgment = "Great! Let me help you with that. Please select from the options below:";
          if (!context.deferAssistantPersistence) {
            conversationMemory.storeMessage(context.userId, 'assistant', acknowledgment);
            await this.storeMessageInDB(conversationId, 'assistant', acknowledgment);
          }
          
          // Stream the acknowledgment and return - form UI handles the question
          yield { type: 'content' as const, data: acknowledgment };
          yield { type: 'final' as const, data: acknowledgment };
          yield { type: 'done' as const, data: '' };
          return;
        }
      } else {
        console.log('[Chat] No active journeys for business - skipping journey processing (stream)');
      }
      
      let fullResponse = '';
      let hasToolCalls = false;
      const toolCalls: any[] = [];
      let bufferedContent: string[] = []; // Buffer content to conditionally stream

      // Build enriched system context with company info and all FAQs
      // This includes PDF summaries and key points - should answer most questions
      let systemContext = await this.buildEnrichedContext(context);

      // SMART TIMING: Count user messages for lead gate activation
      // Note: history was captured BEFORE the current message was stored, so add 1
      const userMessageCount = history.filter(m => m.role === 'user').length + 1;
      const isFirstUserMessage = userMessageCount <= 1;
      
      // DEBUG: Log the message count for troubleshooting
      console.log(`[Smart Timing] History length: ${history.length}, User messages in history: ${history.filter(m => m.role === 'user').length}, Total count (incl current): ${userMessageCount}, isFirst: ${isFirstUserMessage}`);
      
      // CRITICAL: Inject dynamic message count status at the BEGINNING of context
      // LLMs pay more attention to content at the start - this ensures the lead gate is noticed
      let smartTimingPrefix = '';
      if (context.skipLeadTraining) {
        // Lead collection disabled for this surface (guidance chat / TopScholar
        // tutoring where the student is already identified) — never gate answers
        // behind asking for a name.
        smartTimingPrefix = '';
      } else if (isFirstUserMessage) {
        smartTimingPrefix = `🟢 CONVERSATION STATUS: This is the user's FIRST message (message #1). Answer freely - no lead collection required yet.\n\n`;
      } else {
        smartTimingPrefix = `🔴 URGENT - LEAD GATE ACTIVE 🔴\n`;
        smartTimingPrefix += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        smartTimingPrefix += `This is user message #${userMessageCount}. YOU MUST ASK FOR THEIR NAME FIRST!\n`;
        smartTimingPrefix += `\n`;
        smartTimingPrefix += `⛔ DO NOT answer their question yet!\n`;
        smartTimingPrefix += `⛔ STOP and ask: "I'd love to help! May I know your name first?"\n`;
        smartTimingPrefix += `⛔ Only answer AFTER they provide their name.\n`;
        smartTimingPrefix += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      }
      
      // PREPEND the status to systemContext (not append) so it's at the top
      systemContext = smartTimingPrefix + systemContext;
      
      console.log(`[Smart Timing] Injected status at START: isFirst=${isFirstUserMessage}, count=${userMessageCount}`);

      // HANDOFF-AWARE GUARDRAIL: Detect if conversation is in "handoff complete" state
      // If the last assistant message was a handoff confirmation and user sends simple acknowledgement,
      // instruct AI to respond conversationally WITHOUT calling any tools
      const lastAssistantMessage = history.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
      const isHandoffComplete = this.isHandoffConfirmationMessage(lastAssistantMessage);
      const isAcknowledgement = this.isSimpleAcknowledgement(userMessage);
      
      // Track if we should skip tools entirely for this request
      let skipToolsForHandoff = false;
      
      if (isHandoffComplete && isAcknowledgement) {
        console.log(`[Handoff Guardrail] Detected acknowledgement after handoff - DISABLING tools`);
        skipToolsForHandoff = true;
        const handoffGuardrail = `
🛑 HANDOFF COMPLETE - CONVERSATION MODE 🛑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The previous question has been RESOLVED - you already confirmed our team will reach out.
The user just said "${userMessage}" - this is a simple acknowledgement, NOT a new question.

Simply acknowledge their response warmly and briefly.
Example: "Great! Is there anything else I can help you with?"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
        systemContext = handoffGuardrail + systemContext;
      } else if (isHandoffComplete) {
        console.log(`[Handoff Guardrail] Handoff complete, user asking new question: "${userMessage.substring(0, 50)}..."`);
      }

      // Run RAG search and DB fetches in parallel — they are fully independent
      // RAG embedding call (~200ms) now overlaps with DB reads (~50ms) instead of preceding them
      console.log('[RAG] Running document chunk search for query');
      const [ragContext, [businessAccount, widgetSettings, existingLead, products]] = await Promise.all([
        this.addRAGContext(userMessage, context.businessAccountId),
        Promise.all([
          storage.getBusinessAccount(context.businessAccountId),
          storage.getWidgetSettings(context.businessAccountId),
          storage.getLeadByConversation(conversationId, context.businessAccountId),
          storage.getAllProducts(context.businessAccountId)
        ])
      ]);
      // ragContext append is deferred below — skipped when lookup/return-exchange cards are shown

      if (context.resumeText) {
        systemContext += `\n\n=== RESUME UPLOADED BY VISITOR ===\nThe visitor has uploaded their resume. You MUST call the parse_resume_and_match tool to analyze it and find matching jobs.\n---RESUME_TEXT---\n${context.resumeText.substring(0, 8000)}\n=== END RESUME ===\n`;
        console.log(`[Chat Stream] Resume text injected into system context (${context.resumeText.length} chars)`);
      }

      if (context.imageText) {
        systemContext += `\n\n=== IMAGE UPLOADED BY STUDENT (REFERENCE) ===\nThe student uploaded a photo of their question. The text below was extracted from that photo and IS the same question now appearing as the user's message. Treat the user's message as a normal academic question: follow the K12 tutor rules above (call fetch_k12_topic first, apply Content-Only / Verbatim guardrails when enabled). Do NOT ask "what would you like to know about this?" — just answer the question.\n---IMAGE_TEXT---\n${context.imageText.substring(0, 8000)}\n=== END IMAGE TEXT ===\n`;
        console.log(`[Chat Stream] Image text injected into system context (${context.imageText.length} chars)`);
      }

      try {
        if (existingLead && (existingLead.phone || existingLead.email)) {
          const platformUserId = context.visitorToken || conversationId;
          const profile = await resolveProfile(context.businessAccountId, {
            phone: existingLead.phone || null,
            email: existingLead.email || null,
            name: existingLead.name || null,
            city: context.visitorCity || null,
            platform: "website",
            platformUserId,
          });
          if (profile) {
            const isFirstMsg = !history.some((m: any) => m.role === 'assistant');
            const crossPlatformCtx = await composeCrossPlatformContext(context.businessAccountId, "website", profile.id, isFirstMsg);
            if (crossPlatformCtx) {
              systemContext += `\n\n${crossPlatformCtx}`;
              console.log(`[Chat-Stream] Cross-platform context injected (${crossPlatformCtx.length} chars, firstMsg: ${isFirstMsg})`);
            }
            triggerSnapshotUpdate(context.businessAccountId, profile.id, "website", platformUserId);
          }
        }
      } catch (err) {
        console.error("[Chat-Stream] Cross-platform context error (non-fatal):", err);
      }

      // Appointments are enabled only if BOTH business account AND widget settings allow it
      const appointmentsEnabled = 
        businessAccount?.appointmentsEnabled === 'true' && 
        widgetSettings?.appointmentBookingEnabled === 'true';

      // Check if business has products - only include product tool if products exist
      const hasProducts = products.length > 0;

      // AI-GUIDED JOURNEYS: Check if journey is active and include journey tools
      // This allows AI to intelligently manage journeys while staying conversational
      // HANDOFF GUARDRAIL: Pass no tools if we're in acknowledgement-after-handoff mode
      // Pass conversation history to detect ongoing appointment context
      // Pass API key for AI-based product intent classification fallback
      //
      // Run selectRelevantTools and both intent checks in parallel to reduce latency.
      const [relevantTools, orderLookupIntent, returnExchangeIntent] = await Promise.all([
        skipToolsForHandoff
          ? Promise.resolve([] as typeof import('./aiTools').aiTools)
          : selectRelevantTools(context.resumeText ? `[RESUME_UPLOAD] Please analyze my resume and find matching jobs` : userMessage, appointmentsEnabled, isJourneyActive, hasProducts, history, context.openaiApiKey || undefined, context.systemMode, context.k12EducationEnabled, context.jobPortalEnabled, context.demoOrdersEnabled),
        context.demoOrdersEnabled
          ? classifyOrderLookupIntent(userMessage, history, context.openaiApiKey || undefined)
          : Promise.resolve(false),
        context.demoOrdersEnabled
          ? classifyReturnExchangeIntent(userMessage, history, context.openaiApiKey || undefined)
          : Promise.resolve(false),
      ]);

      if (skipToolsForHandoff) {
        console.log(`[Handoff Guardrail] Tools disabled for this request - AI will respond conversationally`);
      }

      // Extract lead training config for enforcement
      // Skip lead training entirely for guidance chatbot
      const leadTrainingConfig = context.skipLeadTraining ? null : (widgetSettings?.leadTrainingConfig as any);
      
      // PHONE VALIDATION GATE — uses shared utility
      let phoneValidationFailed = false;
      let phoneValidationContext = '';
      if (!context.skipLeadTraining && leadTrainingConfig) {
        const validationOverride = buildPhoneValidationOverride(userMessage, leadTrainingConfig);
        if (validationOverride) {
          phoneValidationFailed = true;
          phoneValidationContext = validationOverride;
        }
      }

      // Extract enabled appointment trigger rules
      const appointmentTriggerRules = widgetSettings?.appointmentSuggestRules 
        ? (widgetSettings.appointmentSuggestRules as Array<{ id: string; keywords: string[]; prompt: string; enabled: boolean }>).filter(r => r.enabled)
        : null;

      // Server-side order lookup intent detection.
      // Proactively triggers the 3-card UI (Mobile / Order ID / Email) without depending on
      // the AI voluntarily calling the show_order_lookup_options tool.
      // (Intents were already resolved in parallel above.)
      let serverSideLookupOptions = false;
      let serverSideReturnExchange = false;
      if (orderLookupIntent) {
        serverSideLookupOptions = true;
        console.log('[DemoOrders] Order lookup intent detected — will show option cards server-side');
        systemContext += `\n\n⚠️ ORDER LOOKUP CARDS ALREADY SHOWN: The system has automatically displayed three clickable option cards to the customer. Your text response must be a single brief sentence only — respond in the SAME language the customer used. Do NOT list or repeat the card options in your text. Do NOT ask for their name. Do NOT request any identifier. Do NOT call any tools.`;
      } else if (returnExchangeIntent) {
        serverSideReturnExchange = true;
        console.log('[DemoOrders] Return/exchange intent detected — will show option cards server-side');
        systemContext += `\n\n⚠️ RETURN/EXCHANGE LOOKUP CARDS ALREADY SHOWN: The system has automatically displayed three clickable option cards to the customer so they can identify their order for the return/exchange. Your text response must be a single brief sentence only — respond in the SAME language the customer used. Do NOT list or repeat the card options in your text. Do NOT ask for their name. Do NOT request any identifier. Do NOT call any tools.`;
      }

      // Conditionally append RAG context (deferred from the Promise.all above).
      // When lookup or return/exchange cards are shown the AI must reply in one brief sentence —
      // injecting knowledge-base chunks about order-tracking causes it to produce long bulleted lists.
      if (serverSideLookupOptions || serverSideReturnExchange) {
        console.log('[RAG Context] Suppressed — order lookup cards active, skipping RAG injection');
      } else {
        systemContext += ragContext;
      }

      // When the customer already identified their order via lookup and this is a return/exchange flow,
      // override the AI instructions so it skips tracking/delivery details and immediately collects
      // the return reason and desired resolution.
      if (context.isReturnExchangeLookup) {
        console.log('[DemoOrders] Return/exchange lookup context detected — injecting return-first instruction');
        systemContext += `\n\n⚠️ RETURN/EXCHANGE IDENTIFIER SUBMITTED: The customer has provided their identifier (phone number, email, or order ID) specifically to initiate a RETURN or EXCHANGE — NOT to track a shipment. After the track_order tool retrieves their orders, you MUST:
1. Show the order(s) found.
2. Immediately ask for the REASON for the return/exchange (e.g. "What is the reason for your return or exchange?").
3. Then ask for their preferred RESOLUTION: Refund or Exchange.
Do NOT mention tracking, delivery status, estimated arrival, or shipment updates. Go straight to collecting the return/exchange details.`;
      }

      // When lookup cards are shown (order tracking OR return/exchange), strip order tools
      // entirely so the AI physically cannot call them before the user provides an identifier.
      // Prompt-alone prohibitions are not reliable with GPT-4o-mini.
      let streamTools = (serverSideLookupOptions || serverSideReturnExchange)
        ? relevantTools.filter(t => !['track_order', 'initiate_return', 'show_order_lookup_options', 'get_faqs'].includes(t.function.name))
        : relevantTools;

      // OTP STRICT MODE: when the conversation is awaiting OTP, restrict the tool
      // surface to verify_phone_otp + resend_phone_otp ONLY. The override prompt
      // already instructs the model what to do. When locked, strip all tools.
      if (otpState.locked) {
        streamTools = [] as typeof streamTools;
        systemContext += buildOtpGatingOverride(otpState);
      } else if (otpState.awaiting_otp) {
        // Per Task #14 spec: when awaiting OTP, the allowed tool surface is
        // { verify_phone_otp, resend_phone_otp, capture_lead }. capture_lead is
        // included so the model can re-capture if the visitor types a corrected
        // phone number, which will re-issue a new challenge for the new number.
        const fromAll = (await import('./aiTools')).aiTools;
        streamTools = fromAll.filter(t =>
          t.function.name === 'verify_phone_otp' ||
          t.function.name === 'resend_phone_otp' ||
          t.function.name === 'capture_lead'
        );
        systemContext += buildOtpGatingOverride(otpState);
      }

      // SHORT-CIRCUIT: when lookup cards will be shown, bypass the full AI streaming pipeline.
      // The one-sentence reply is kept brief and controlled. If the user wrote in a non-English
      // language, a small targeted AI call translates just that sentence — no verbosity risk.
      if (serverSideLookupOptions || serverSideReturnExchange) {
        const BASE_TRACK = "Sure! Please choose how you'd like to look up your order:";
        const BASE_RETURN = "Of course! Please choose how you'd like to find your order so we can process your return/exchange:";
        const baseSentence = serverSideReturnExchange ? BASE_RETURN : BASE_TRACK;

        // Same LANGUAGE_NAMES map used throughout the codebase for unambiguous script specification.
        // 'hinglish' → 'Hinglish' (Roman letters), 'hi' → 'Hindi (Devanagari script)', etc.
        const LOOKUP_LANGUAGE_NAMES: Record<string, string> = {
          'hinglish': 'Hinglish (Hindi words written in Roman/Latin letters, mixed with English)',
          'hi': 'Hindi (Devanagari script)',
          'ta': 'Tamil', 'te': 'Telugu', 'kn': 'Kannada', 'mr': 'Marathi',
          'bn': 'Bengali', 'gu': 'Gujarati', 'ml': 'Malayalam', 'pa': 'Punjabi',
          'ur': 'Urdu', 'ar': 'Arabic', 'fr': 'French', 'es': 'Spanish',
          'de': 'German', 'pt': 'Portuguese', 'it': 'Italian', 'ja': 'Japanese',
          'ko': 'Korean', 'zh': 'Chinese', 'ru': 'Russian', 'tr': 'Turkish',
        };

        // Determine language: explicit user preference first, then quick heuristic detection
        const preferredLang = context.preferredLanguage;
        const isAutoMode = !preferredLang || preferredLang === 'auto';
        const detectedLang = isAutoMode
          ? LlamaService.quickDetectLanguage(userMessage)
          : preferredLang;

        let lookupSentence = baseSentence;

        if (detectedLang && detectedLang !== 'en') {
          const langName = LOOKUP_LANGUAGE_NAMES[detectedLang] ?? detectedLang;
          try {
            const translated = await llamaService.generateSimpleResponse(
              `Translate the following sentence into ${langName}. Use a natural, conversational tone — not overly formal. Do NOT add quotes or any extra text. Return ONLY the translated sentence.\n\nSentence to translate: ${baseSentence}`,
              context.openaiApiKey || undefined
            );
            if (translated && translated.trim()) {
              // Strip any surrounding quotes the model may have added
              lookupSentence = translated.trim().replace(/^["'""'']|["'""'']$/g, '').trim();
            }
          } catch (err) {
            console.warn('[DemoOrders] Translation failed, falling back to English:', err);
          }
        }

        console.log(`[DemoOrders] Lookup bypass — lang: ${detectedLang ?? 'en'}, sentence: "${lookupSentence}"`);
        if (!context.deferAssistantPersistence) {
          await this.storeMessageInDB(conversationId, 'assistant', lookupSentence);
        }
        yield { type: 'content', data: lookupSentence };
        yield { type: 'order_lookup_options', data: JSON.stringify({ mode: serverSideReturnExchange ? 'return_exchange' : 'track', returnExchange: serverSideReturnExchange }) };
        return;
      }

      // K12 CONTENT-ONLY ROUND-TRIP COLLAPSE: for content-only K12 the first LLM
      // call is always forced to call fetch_k12_topic, so skip it and execute the
      // tool deterministically — only the streaming continuation runs. Greetings
      // that would hit the streaming fast-path, handoff acks, and OTP-gated turns
      // fall back to the normal path so behaviour there is unchanged.
      const k12ContentOnly = this.isK12ContentOnly(context);
      const k12ForcedToolAvailable = k12ContentOnly && streamTools.some((t: any) => t.function?.name === 'fetch_k12_topic');
      const k12MsgLower = userMessage.toLowerCase().trim();
      const k12SimpleGreetings = ['hi', 'hey', 'hello', 'hii', 'hiii', 'heyyy', 'heyy', 'yo', 'sup'];
      const k12IsSimpleGreeting = k12SimpleGreetings.includes(k12MsgLower) || (k12MsgLower.length <= 10 && /^(hi+|hey+|hello+|yo+)!*$/i.test(k12MsgLower));
      const k12HasCustomInstr = !!(context.customInstructions && context.customInstructions.trim().length > 0);
      const k12HasLangPref = !!(context.preferredLanguage && context.preferredLanguage !== 'auto');
      const k12WouldUseGreetingFastPath = k12IsSimpleGreeting && history.length === 0 && !k12HasCustomInstr && !k12HasLangPref;
      const shortCircuitK12 = k12ForcedToolAvailable && !skipToolsForHandoff && !otpState.locked && !otpState.awaiting_otp && !k12WouldUseGreetingFastPath;

      if (shortCircuitK12) {
        const k12Query = (userMessage && userMessage.trim().length > 0)
          ? userMessage
          : (context.imageText ? context.imageText.slice(0, 1000) : userMessage);
        hasToolCalls = true;
        toolCalls.push({
          id: 'k12_forced_' + Date.now(),
          type: 'function',
          function: { name: 'fetch_k12_topic', arguments: JSON.stringify({ query: k12Query }) },
        });
        console.log('[K12 Fast Path] Skipping forced first LLM call — direct fetch_k12_topic query:', k12Query.substring(0, 80));
      } else {
      // Stream AI response (pass existing lead to avoid re-asking for captured contact info)
      // Pass raw customInstructions directly to avoid truncation during extraction
      // Pass userMessageCount for SMART timing lead gate activation
      // Phone validation: pass as last-position system message override (highest GPT attention weight)
      // instead of replacing user message, so AI has full context to respond naturally
      for await (const chunk of llamaService.streamToolAwareResponse(
        userMessage,
        streamTools,
        history,
        systemContext,
        context.personality || 'friendly',
        context.openaiApiKey || undefined,
        leadTrainingConfig,
        existingLead,
        context.preferredLanguage,
        context.businessAccountId,
        context.customInstructions,
        userMessageCount,
        hasProducts,
        context.starterQAContext,
        appointmentTriggerRules,
        context.responseLength || 'balanced',
        phoneValidationFailed ? phoneValidationContext : undefined,
        // K12 content-only never uses FAQs — skip the server-side FAQ pre-fetch
        // so greeting/fast-path turns don't pay for an unused vector search.
        serverSideLookupOptions || serverSideReturnExchange || k12ContentOnly,
        // Task #23: tell the prompt builder there's an unverified OTP for this
        // conversation so it suppresses the "all contact info collected"
        // override and leaves OTP-focused instructions in the lead position.
        // Both awaiting_otp and locked are "unverified" — locked still means
        // the phone hasn't been confirmed, just that the visitor is in a
        // cooldown. We want the same override suppression in either case.
        otpState.awaiting_otp === true || otpState.locked === true,
        // Top Scholar content-only K12: force fetch_k12_topic on the first
        // streaming turn so academic answers are always curriculum-grounded.
        this.isK12ContentOnly(context) ? 'fetch_k12_topic' : undefined
      )) {
        const delta = chunk.choices[0]?.delta;
        
        // Check for tool calls
        if (delta.tool_calls) {
          hasToolCalls = true;
          for (const toolCall of delta.tool_calls) {
            if (!toolCalls[toolCall.index]) {
              toolCalls[toolCall.index] = {
                id: toolCall.id || '',
                type: 'function',
                function: { name: toolCall.function?.name || '', arguments: '' }
              };
            }
            if (toolCall.function?.arguments) {
              toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
            }
          }
        }
        
        // Buffer text content instead of streaming immediately
        if (delta.content) {
          fullResponse += delta.content;
          bufferedContent.push(delta.content);
        }
      }
      } // end else (non-short-circuit streaming path)

      // FALLBACK INSTRUCTION HANDLING: If AI deflects, use user-defined fallback template DIRECTLY
      if (!hasToolCalls && this.isDeflectionResponse(fullResponse)) {
        const fallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
        if (fallbackInstructions && fallbackInstructions.length > 0) {
          console.log('[Fallback Instruction] Using fallback template with AI rephrasing (streaming)');
          
          let fallbackTemplate = fallbackInstructions[0];
          fallbackTemplate = this.processFallbackPlaceholders(fallbackTemplate, existingLead);
          
          fullResponse = await this.rephraseFallbackMessage(
            fallbackTemplate, 
            userMessage, 
            context.businessAccountId,
            context.openaiApiKey || undefined,
            existingLead
          );
          bufferedContent = [fullResponse];
          console.log('[Fallback Instruction] Rephrased template applied:', fullResponse.substring(0, 100) + '...');
        } else {
          fullResponse = this.stripFallbackMarker(fullResponse);
          bufferedContent = [fullResponse];
          console.log('[Fallback] No template configured, using stripped AI response (streaming)');
        }
      }
      
      // SAFETY: Always strip [[FALLBACK]] marker before streaming (in case it leaked through)
      fullResponse = this.stripFallbackMarker(fullResponse);
      bufferedContent = bufferedContent.map(content => this.stripFallbackMarker(content));

      // PHONE VALIDATION SAFETY NET: If phone validation failed but AI still accepted
      // the number (e.g., "thank you for sharing"), replace response with rejection
      if (phoneValidationFailed && !hasToolCalls) {
        const lowerResponse = fullResponse.toLowerCase();
        const looksLikeAcceptance = (lowerResponse.includes('thank') && (lowerResponse.includes('number') || lowerResponse.includes('sharing') || lowerResponse.includes('phone') || lowerResponse.includes('whatsapp'))) ||
          (lowerResponse.includes('got it') && (lowerResponse.includes('number') || lowerResponse.includes('phone'))) ||
          (lowerResponse.includes('noted') && lowerResponse.includes('number')) ||
          (lowerResponse.includes('received') && lowerResponse.includes('number'));
        if (looksLikeAcceptance) {
          console.log(`[Phone Validation Safety Net] AI accepted invalid phone despite rewrite — replacing response`);
          const safeResponse = `It looks like that number might not be correct — could you please double-check and share a valid number?`;
          fullResponse = safeResponse;
          bufferedContent = [safeResponse];
        }
      }

      // If NO tool calls detected, stream the buffered content now
      let contentAlreadyYielded = false;
      if (!hasToolCalls) {
        for (const content of bufferedContent) {
          yield { type: 'content', data: content };
        }
        contentAlreadyYielded = true;
      }
      // If tool calls ARE detected, discard buffered content (don't stream the initial text)

      // Log tool calls for debugging
      console.log('[Chat Stream] User message:', userMessage);
      console.log('[Chat Stream] Tool calls detected:', hasToolCalls);
      console.log('[Chat Stream] Tool calls count:', toolCalls.length);
      if (toolCalls.length > 0) {
        toolCalls.forEach((tc: any) => {
          console.log('[Chat Stream] Tool:', tc.function.name, 'Args:', tc.function.arguments);
        });
      }

      // RECOVERY: Gemini signaled a tool call during streaming but produced empty args.
      // When the product tool was in the request, synthesize the call so search still runs.
      if (hasToolCalls && toolCalls.length === 0) {
        const productToolWasAvailable = relevantTools.some((t: any) => t.function?.name === 'get_products');
        if (productToolWasAvailable) {
          console.log('[Chat Stream] Gemini empty tool-call recovery: auto-executing get_products for:', userMessage);
          toolCalls.push({
            id: 'auto_recovery_' + Date.now(),
            type: 'function',
            function: { name: 'get_products', arguments: JSON.stringify({ query: userMessage }) }
          });
        }
      }

      // Handle tool calls if any
      if (hasToolCalls && toolCalls.length > 0) {
        yield { type: 'tool_start', data: '' };
        
        const updatedHistory = conversationMemory.getConversationHistory(context.userId);
        const messages: any[] = [
          ...updatedHistory,
          { role: 'assistant', content: fullResponse, tool_calls: toolCalls }
        ];

        // Execute tools
        let productData: any = null;
        let productPagination: any = null;
        let productSearchQuery: string | null = null;
        let faqData: any = null;
        let appointmentSlotsData: { slots: Record<string, string[]>; durationMinutes: number } | null = null;
        let captureLeadHadRealData = false;
        let jobsData: any[] | null = null;
        let jobsApplicantId: string | null = null;
        let ordersData: any[] | null = null;
        // Initialise from server-side detection so cards fire even in tool-call path
        let showOrderLookupOptions = serverSideLookupOptions || serverSideReturnExchange;
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          const toolParams = JSON.parse(toolCall.function.arguments);

          if (toolName === 'parse_resume_and_match') {
            if (context.resumeText) {
              toolParams.resumeText = context.resumeText;
              toolParams.conversationId = conversationId;
              if (context.resumeUrl) toolParams.resumeUrl = context.resumeUrl;
              console.log(`[Chat Stream] Overriding parse_resume_and_match params with actual resume text (${context.resumeText.length} chars)${context.resumeUrl ? ' + PDF URL' : ''}`);
            } else {
              console.warn(`[Chat Stream] parse_resume_and_match called but no context.resumeText available — blocking tool call`);
              const errorResult = { success: false, message: 'No resume was uploaded yet. Please upload your resume PDF first so I can match you with relevant jobs.' };
              messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(errorResult) });
              continue;
            }
          }

          let phoneRejected = false;
          let phoneRejectionMessage = '';
          if (toolName === 'capture_lead' && toolParams.phone && toolParams.phone.trim().length > 0 && leadTrainingConfig?.fields) {
            const mobileField = leadTrainingConfig.fields.find((f: any) => f.id === 'mobile' && f.enabled);
            const whatsappField = leadTrainingConfig.fields.find((f: any) => f.id === 'whatsapp' && f.enabled);
            const phoneValidation = mobileField?.phoneValidation || whatsappField?.phoneValidation || '10';
            
            const phoneValidationResult = validatePhoneNumber(toolParams.phone, phoneValidation as any);
            
            if (!phoneValidationResult.isValid) {
              console.log(`[Chat Stream] capture_lead PRE-VALIDATION REJECTED: phone "${toolParams.phone}" - ${phoneValidationResult.reasonMessage}`);
              phoneRejected = true;
              phoneRejectionMessage = `INVALID PHONE NUMBER: ${phoneValidationResult.reasonMessage}. DO NOT save this number. Politely tell the user their number appears to be invalid and ask them to provide a valid phone/WhatsApp number.`;
              toolParams.phone = '';
            }
          }

          console.log('[Chat Stream] Executing tool:', toolName, 'with params:', toolParams);
          let result = await ToolExecutionService.executeTool(
            toolName,
            toolParams,
            {
              businessAccountId: context.businessAccountId,
              userId: context.userId,
              conversationId: conversationId,
              visitorCity: context.visitorCity,
              userMessage: userMessage,
              selectedLanguage: context.preferredLanguage,
              channel: context.channel,
              cpId: context.topscholarCpId,
              cpIds: context.topscholarCpIds,
              chapter: context.studentChapter,
            },
            userMessage,
            appointmentsEnabled
          );
          console.log('[Chat Stream] Tool result:', toolName, 'returned', JSON.stringify(result).substring(0, 100));

          // If a tool emitted an updated otp_state, forward it to the client immediately
          // so the composer can switch into OTP-digit / locked mode without waiting for
          // the final stream chunk.
          if ((result as any)?.otp_state && context.channel === 'widget') {
            yield { type: 'otp_state' as const, data: JSON.stringify((result as any).otp_state) };
          }

          // Capture product data for special rendering (including pagination for "Show More")
          if (toolName === 'get_products' && result.success && 'data' in result && result.data) {
            productData = result.data;
            productPagination = result.pagination || null;
            productSearchQuery = toolParams.search || null;
          }

          if ((toolName === 'search_jobs' || toolName === 'parse_resume_and_match') && result.success && 'data' in result && Array.isArray(result.data) && result.data.length > 0) {
            jobsData = result.data;
            if (result.applicant) {
              jobsApplicantId = result.applicant.id;
            }
          }

          if (toolName === 'show_order_lookup_options' && result.success) {
            showOrderLookupOptions = true;
          }

          if (toolName === 'track_order' && result.success && 'data' in result && (result.data as any)?.found && Array.isArray((result.data as any)?.orders)) {
            ordersData = (result.data as any).orders;
          }

          // Fallback: when a specific search returns empty, fetch popular products as alternatives
          if (
            toolName === 'get_products' &&
            result.success &&
            'data' in result &&
            Array.isArray(result.data) &&
            result.data.length === 0 &&
            toolParams.search
          ) {
            console.log('[Chat Stream] Product search empty — running fallback browse for alternatives');
            const fallbackResult = await ToolExecutionService.executeTool(
              'get_products',
              { limit: 4 },
              {
                businessAccountId: context.businessAccountId,
                userId: context.userId,
                conversationId: conversationId,
                visitorCity: context.visitorCity,
                userMessage: userMessage,
                selectedLanguage: context.preferredLanguage
              },
              userMessage,
              appointmentsEnabled
            );
            if (
              fallbackResult.success &&
              'data' in fallbackResult &&
              Array.isArray(fallbackResult.data) &&
              fallbackResult.data.length > 0
            ) {
              productData = fallbackResult.data;
              productPagination = ('pagination' in fallbackResult ? fallbackResult.pagination : null) || null;
              productSearchQuery = null; // fallback browse has no filter — Show More must not use the original failed search term
              result = {
                success: true,
                data: fallbackResult.data,
                ...('pagination' in fallbackResult ? { pagination: fallbackResult.pagination } : {}),
                _instruction: `No exact matches for "${toolParams.search}" were found. These are popular alternative products from our catalog. Tell the user we don't have "${toolParams.search}", but here are some popular products they might like instead. Write a short natural message in the same language as the user's latest message (default to English if unclear) — product cards will display automatically, do NOT list them in text.`
              };
              console.log('[Chat Stream] Fallback browse returned', fallbackResult.data.length, 'alternative products');
            }
          }
          
          // Capture FAQ data for fallback response generation
          if (toolName === 'get_faqs' && result.success && 'data' in result && result.data) {
            faqData = result.data;
          }
          
          // Capture appointment slots for calendar UI
          if (toolName === 'list_available_slots' && result.success && 'data' in result && result.data) {
            const data = result.data as { slots?: Record<string, string[]>; duration_minutes?: number };
            if (data.slots && Object.keys(data.slots).length > 0) {
              appointmentSlotsData = {
                slots: data.slots,
                durationMinutes: data.duration_minutes || 30
              };
              console.log('[Appointments] Captured slots for calendar UI:', Object.keys(data.slots).length, 'days');
            }
          }
          
          // Track if capture_lead was called with actual contact data
          // Use OR to preserve true if any capture_lead call had real data (handles multiple calls)
          let captureLeadOriginalQuestion: string | null = null;
          if (toolName === 'capture_lead') {
            // If phone was rejected by pre-validation, override result with rejection message
            if (phoneRejected) {
              result = { success: false, error: phoneRejectionMessage };
            }

            const hasName = toolParams.name && toolParams.name.trim().length > 0;
            const hasPhone = toolParams.phone && toolParams.phone.trim().length > 0;
            const hasEmail = toolParams.email && toolParams.email.trim().length > 0;
            const thisCallHadRealData = hasName || hasPhone || hasEmail;
            captureLeadHadRealData = captureLeadHadRealData || thisCallHadRealData;
            console.log('[Chat Stream] capture_lead called with real data:', thisCallHadRealData, '(cumulative:', captureLeadHadRealData, ') params:', toolParams);
            
            // If real data was captured, find the original question to include in the result
            if (thisCallHadRealData) {
              const currentHistory = conversationMemory.getConversationHistory(context.userId);
              captureLeadOriginalQuestion = this.extractLastSubstantiveQuestion(currentHistory, userMessage);
            }
          }

          // Strip imageUrl from product data sent to AI — the AI has no use for image URLs
          // and may embed them as markdown images in its response. Frontend productData retains imageUrl.
          if (toolName === 'get_products' && result.success && 'data' in result && Array.isArray(result.data)) {
            result = {
              ...result,
              data: result.data.map(({ imageUrl, ...rest }: any) => rest)
            };
          }

          // Tell AI not to list product names/details in text — product cards render automatically in the UI
          if (toolName === 'get_products' && result.success && 'data' in result && Array.isArray(result.data) && result.data.length > 0 && !('_instruction' in result)) {
            result = {
              ...result,
              _ui_note: `IMPORTANT: Product cards are automatically displayed to the user in the chat UI. Do NOT list product names, prices, or details in your text response. Just write a brief, natural intro sentence (e.g. "Here are some great options for you!") and optionally ask a follow-up question. Never use bullet points or numbered lists for product names.`
            };
          }

          if ((toolName === 'search_jobs' || toolName === 'parse_resume_and_match') && result.success && 'data' in result && Array.isArray(result.data) && result.data.length > 0) {
            result = {
              ...result,
              _ui_note: `CRITICAL INSTRUCTION — FOLLOW EXACTLY: Job cards with full details (title, salary, location, skills, match score, Apply button) are ALREADY rendered as visual cards in the chat UI below your message. You MUST NOT list any job titles, locations, salaries, departments, or details in your text — not as bullet points, numbered lists, or inline mentions. Your ENTIRE response must be ONE short paragraph (2-3 sentences max), e.g. "Great news! I found some positions that match your profile. You can browse the cards below and click Apply Now on any role you like!" NEVER list specific job names.`
            };
          }

          // For capture_lead with real data, enhance the result to include the original question context
          // K12 content-only: compact the curriculum payload (drop duplicated notes/HTML,
          // cap passages) to slash input tokens on the continuation call. Only applied to
          // fetch_k12_topic — fetch_k12_questions returns differently-shaped QuestionResult
          // objects (question/options/solution) that this compactor would strip, so it is
          // left intact (its payload is already bounded by the resolver).
          let toolResultContent = (this.isK12ContentOnly(context) && toolName === 'fetch_k12_topic')
            ? this.compactK12ToolResult(result)
            : JSON.stringify(result);
          if (toolName === 'capture_lead' && captureLeadOriginalQuestion) {
            const enhancedResult = {
              ...result,
              _instruction: `Contact info saved successfully. Now briefly thank them and IMMEDIATELY answer their original question: "${captureLeadOriginalQuestion}". Do NOT just say "How can I help?" - answer their question about ${captureLeadOriginalQuestion}.`
            };
            toolResultContent = JSON.stringify(enhancedResult);
            console.log('[Chat Stream] Enhanced capture_lead result with original question:', captureLeadOriginalQuestion);
          }
          
          // For list_available_slots with slots, tell AI that a visual calendar UI will show the options
          // Only add this note when the client supports calendar UI (chat channels, not voice/SMS)
          if (toolName === 'list_available_slots' && appointmentSlotsData && context.supportsCalendarUI) {
            const enhancedResult = {
              ...result,
              _ui_note: `IMPORTANT: A visual calendar UI will automatically display these time slots to the user. DO NOT list the individual time slots in your text response. Just give a brief friendly intro like "Here are the available appointment slots - please select a date and time that works for you!" CRITICAL: Do NOT include any bracketed placeholder text like "[Calendar will show]" or "[Visual Calendar UI will display the options]" - the calendar renders automatically, so your response should be clean natural text only.`
            };
            toolResultContent = JSON.stringify(enhancedResult);
            console.log('[Chat Stream] Enhanced list_available_slots result with calendar UI note');
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent
          });
        }

        // Send product data for special rendering (with pagination for "Show More" feature)
        if (productData) {
          yield { 
            type: 'products', 
            data: JSON.stringify({
              items: productData,
              pagination: productPagination,
              searchQuery: productSearchQuery
            })
          };
        }
        
        if (jobsData && jobsData.length > 0) {
          yield {
            type: 'jobs',
            data: JSON.stringify({
              items: jobsData,
              applicantId: jobsApplicantId
            })
          };
        }

        if (ordersData && ordersData.length > 0) {
          yield {
            type: 'orders',
            data: JSON.stringify({ items: ordersData })
          };
        }

        if (showOrderLookupOptions) {
          yield {
            type: 'order_lookup_options',
            data: JSON.stringify({ mode: serverSideReturnExchange ? 'return_exchange' : 'track' })
          };
        }

        // Send appointment slots for calendar UI rendering
        if (appointmentSlotsData) {
          yield { 
            type: 'appointment_slots', 
            data: JSON.stringify(appointmentSlotsData)
          };
        }

        // Track tool names for fallback logic
        const toolNames = toolCalls.map((tc: any) => tc.function.name);
        
        // Include system context in messages so continueToolConversation has proper
        // persona/instructions (e.g. K12 tutor prompt). Without this, the generic
        // "Chroney business chatbot" prompt is injected, which declines educational questions.
        const messagesWithSystem = [
          { role: 'system' as const, content: systemContext },
          ...messages
        ];
        
        // When K12 tools already returned data, don't pass tools to the continuation
        // call. Otherwise the AI tries to call another tool (e.g. get_faqs) instead of
        // synthesizing an answer from the K12 content already in the messages.
        const hasK12ToolResult = toolNames.some(n => n === 'fetch_k12_topic' || n === 'fetch_k12_questions');
        const continuationTools = hasK12ToolResult ? [] : relevantTools;
        
        // Stream the continuation response token-by-token so the widget can
        // display the answer in real time (instead of waiting for the entire
        // tool-call → second-LLM cycle to finish before showing anything).
        let finalContent = '';
        let streamedTokens = false;
        for await (const token of llamaService.continueToolConversationStream(
          messagesWithSystem,
          continuationTools,
          context.personality || 'friendly',
          context.openaiApiKey || undefined,
          context.businessAccountId,
          context.preferredLanguage,
          context.responseLength || 'balanced'
        )) {
          finalContent += token;
          streamedTokens = true;
          yield { type: 'content' as const, data: token };
        }
        void streamedTokens;
        
        // Context-aware fallback message if content is empty
        if (!finalContent || finalContent.trim() === '') {
          // Generate smart fallback based on what tools were called (toolNames already defined above)
          
          if (toolNames.includes('capture_lead')) {
            // Only thank them if they actually provided contact info
            // If no real data was captured, they may have just expressed a preference (e.g., "via email please")
            if (captureLeadHadRealData) {
              // AI-DRIVEN POST-CAPTURE: Smart handling based on conversation context
              console.log('[Chat Stream] Lead captured - determining post-capture strategy');
              
              const updatedHistory = conversationMemory.getConversationHistory(context.userId);
              const originalQuestion = this.extractLastSubstantiveQuestion(updatedHistory, userMessage);
              const lastAssistantMessage = updatedHistory.filter(m => m.role === 'assistant').slice(-1)[0];
              const freshLead = await storage.getLeadByConversation(conversationId, context.businessAccountId);
              
              // KEY DECISION: Was the previous response asking for contact info (fallback flow)?
              // If yes: The AI already couldn't answer, so just confirm lead capture
              // If no: The AI asked for contact as part of start-timing, so try to answer with tools
              const previousAskedForContact = lastAssistantMessage?.content && 
                this.isContactRequestMessage(lastAssistantMessage.content);
              
              if (previousAskedForContact) {
                // FALLBACK FLOW: AI previously couldn't answer and asked for contact
                // Don't re-try - just confirm team will help
                console.log('[Chat Stream] Previous response was contact request (fallback). Using AI-driven confirmation.');
                finalContent = await this.generatePostCaptureResponse(
                  originalQuestion,
                  {
                    phone: freshLead?.phone || undefined,
                    email: freshLead?.email || undefined,
                    name: freshLead?.name || undefined
                  },
                  lastAssistantMessage?.content || null,
                  context.businessAccountId,
                  context.openaiApiKey || undefined
                );
              } else if (originalQuestion) {
                // START-TIMING FLOW: AI asked for contact first, now try to answer the question
                console.log('[Chat Stream] Previous response was NOT contact request. Trying to answer:', originalQuestion);
                
                try {
                  // Use tool-aware response to actually answer the question
                  const nonLeadTools = relevantTools.filter((t: any) => t.function.name !== 'capture_lead');
                  const questionResponse = await llamaService.generateToolAwareResponse(
                    originalQuestion,
                    nonLeadTools,
                    updatedHistory,
                    '',
                    context.personality || 'friendly',
                    context.openaiApiKey || undefined,
                    context.businessAccountId,
                    false,
                    context.responseLength || 'balanced'
                  );
                  
                  if (questionResponse.tool_calls && questionResponse.tool_calls.length > 0) {
                    // AI needs tools - execute them
                    console.log('[Chat Stream] Post-lead: AI needs tools to answer');
                    const toolResult = await this.handleToolCalls(
                      questionResponse, context, originalQuestion, nonLeadTools, appointmentsEnabled, true, systemContext
                    );
                    
                    // Check if tool result is a deflection/fallback - if so, use AI confirmation instead
                    // This prevents asking for contact info again after it was just captured
                    if (this.isDeflectionResponse(toolResult.response) || toolResult.response.includes('[[FALLBACK]]')) {
                      console.log('[Chat Stream] Post-lead: Tool result was deflection, using AI confirmation');
                      finalContent = await this.generatePostCaptureResponse(
                        originalQuestion,
                        { phone: freshLead?.phone || undefined, email: freshLead?.email || undefined, name: freshLead?.name || undefined },
                        lastAssistantMessage?.content || null,
                        context.businessAccountId,
                        context.openaiApiKey || undefined
                      );
                    } else {
                      finalContent = this.stripFallbackMarker(toolResult.response);
                    }
                    
                    // Yield products if returned (with pagination and searchQuery for "Show More" feature)
                    if (toolResult.products && toolResult.products.length > 0) {
                      yield { 
                        type: 'products', 
                        data: JSON.stringify({ 
                          items: toolResult.products,
                          pagination: toolResult.pagination,
                          searchQuery: toolResult.searchQuery
                        }) 
                      };
                    }
                    
                    // Yield appointment slots if returned (for calendar UI)
                    if (toolResult.appointmentSlots) {
                      yield { type: 'appointment_slots', data: JSON.stringify(toolResult.appointmentSlots) };
                    }
                    
                    // Yield next form step if returned (for form journey UI)
                    if (toolResult.nextFormStep) {
                      console.log('[Chat Stream] Yielding next form step:', toolResult.nextFormStep.questionText?.substring(0, 30));
                      // Include conversationId so client can track which conversation to use for form step submission
                      yield { type: 'form_step', data: JSON.stringify({ ...toolResult.nextFormStep, conversationId }) };
                    }
                  } else if (questionResponse.content && questionResponse.content.trim()) {
                    // AI answered directly - check for deflection
                    if (this.isDeflectionResponse(questionResponse.content) || questionResponse.content.includes('[[FALLBACK]]')) {
                      console.log('[Chat Stream] Post-lead: Direct response was deflection, using AI confirmation');
                      finalContent = await this.generatePostCaptureResponse(
                        originalQuestion,
                        { phone: freshLead?.phone || undefined, email: freshLead?.email || undefined, name: freshLead?.name || undefined },
                        lastAssistantMessage?.content || null,
                        context.businessAccountId,
                        context.openaiApiKey || undefined
                      );
                    } else {
                      finalContent = this.stripFallbackMarker(questionResponse.content);
                    }
                  } else {
                    // AI still couldn't answer - use AI-driven confirmation
                    finalContent = await this.generatePostCaptureResponse(
                      originalQuestion,
                      { phone: freshLead?.phone || undefined, email: freshLead?.email || undefined, name: freshLead?.name || undefined },
                      lastAssistantMessage?.content || null,
                      context.businessAccountId,
                      context.openaiApiKey || undefined
                    );
                  }
                } catch (err) {
                  console.error('[Chat Stream] Error in post-lead tool-aware response:', err);
                  finalContent = "Thank you for sharing your details! I'm looking into your question now.";
                }
              } else {
                // No substantive question - just thank them
                finalContent = "Thank you for sharing your details! I'm here to help with any questions you have.";
              }
              
              console.log('[Chat Stream] Post-capture response generated');
            } else {
              // User expressed preference but didn't provide actual contact info
              // Check if they mentioned email preference
              const userMsgLower = userMessage.toLowerCase();
              if (userMsgLower.includes('mail') || userMsgLower.includes('email')) {
                finalContent = "Sure! Could you please share your email address so I can send you the details?";
              } else if (userMsgLower.includes('call') || userMsgLower.includes('phone')) {
                finalContent = "Sure! Could you please share your phone number so we can arrange a callback?";
              } else {
                finalContent = "I'd be happy to help! Could you please share your contact details?";
              }
              console.log('[Chat Stream] capture_lead called without real data, asking for contact info instead of thanking');
            }
          } else if (toolNames.includes('get_products')) {
            if (!productData || !Array.isArray(productData) || productData.length === 0) {
              // No products found - apologize naturally
              finalContent = "Sorry, I couldn't find any products matching your request.";
            }
            // Products found: pass through AI's brief acknowledgment (prompt instructs a brief reply)
          } else if (toolNames.includes('get_faqs')) {
            // RELEVANCE GATE: Check if FAQ results are actually relevant to the query
            if (showOrderLookupOptions) {
              // Lookup cards are already shown — do NOT let a FAQ answer override the
              // single-sentence prompt. This path should not normally be reached now that
              // get_faqs is stripped from streamTools during lookup, but acts as a safety net.
              console.log('[Chat Stream] Lookup cards active — skipping FAQ fallback, using lookup prompt');
              // finalContent already holds the streamed AI response — keep it as-is.
            } else if (faqData && Array.isArray(faqData) && faqData.length > 0) {
              console.log('[Chat Stream] Empty response after get_faqs, checking FAQ relevance');
              const topFaq = faqData[0];
              
              if (topFaq && topFaq.answer) {
                // Check relevance before using the FAQ
                const relevanceCheck = this.checkRelevance(
                  userMessage,
                  { question: topFaq.question, answer: topFaq.answer },
                  'faq'
                );
                
                if (relevanceCheck.isRelevant) {
                  // FAQ is relevant - use it
                  finalContent = topFaq.answer;
                  console.log(`[Relevance Gate] FAQ PASSED (${relevanceCheck.score}%): ${relevanceCheck.reason}`);
                  console.log('[Chat Stream] Using top FAQ answer:', finalContent.substring(0, 100));
                } else {
                  // FAQ doesn't match the query - use custom fallback template
                  console.log(`[Relevance Gate] FAQ FAILED (${relevanceCheck.score}%): ${relevanceCheck.reason}`);
                  console.log('[Chat Stream] FAQ does not match query, routing to custom fallback');
                  
                  const fallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
                  if (fallbackInstructions && fallbackInstructions.length > 0) {
                    let fallbackTemplate = fallbackInstructions[0];
                    fallbackTemplate = this.processFallbackPlaceholders(fallbackTemplate, existingLead);
                    const rephrased = await this.rephraseFallbackMessage(
                      fallbackTemplate,
                      userMessage,
                      context.businessAccountId,
                      context.openaiApiKey || undefined,
                      existingLead
                    );
                    finalContent = rephrased;
                  } else {
                    // No custom fallback - use positive, solution-oriented response
                    finalContent = "I'd be happy to connect you with our team who can assist you with this. Could you share your contact details so they can reach out?";
                  }
                }
              } else {
                finalContent = "I found some information but couldn't format it properly. Could you try asking again?";
              }
            } else {
              // No FAQ data at all - use fallback
              const fallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
              if (fallbackInstructions && fallbackInstructions.length > 0) {
                let fallbackTemplate = fallbackInstructions[0];
                fallbackTemplate = this.processFallbackPlaceholders(fallbackTemplate, existingLead);
                const rephrased = await this.rephraseFallbackMessage(
                  fallbackTemplate,
                  userMessage,
                  context.businessAccountId,
                  context.openaiApiKey || undefined,
                  existingLead
                );
                finalContent = rephrased;
              } else {
                finalContent = "I couldn't find specific information about that. Could you try rephrasing your question?";
              }
            }
          } else if (toolNames.includes('book_appointment')) {
            finalContent = "I've processed your appointment request.";
          } else if (toolNames.includes('list_available_slots')) {
            finalContent = "I've checked the available time slots for you.";
          } else if (toolNames.includes('fetch_k12_topic') || toolNames.includes('fetch_k12_questions')) {
            const k12ToolCallIds = toolCalls
              .filter((tc: any) => tc.function.name === 'fetch_k12_topic' || tc.function.name === 'fetch_k12_questions')
              .map((tc: any) => tc.id);
            const k12ToolMsg = messages.find(m => m.role === 'tool' && k12ToolCallIds.includes(m.tool_call_id) && m.content);
            let k12Data: any = null;
            try { k12Data = k12ToolMsg ? JSON.parse(k12ToolMsg.content) : null; } catch {}
            if (k12Data?.success && k12Data.data && k12Data.data.length > 0) {
              const topic = k12Data.data[0];
              const contentSnippet = topic.content ? topic.content.substring(0, 500) : '';
              console.log('[Chat Stream] K12 fallback: using topic content for', topic.name);
              finalContent = `Here's what I found about **${topic.name}**:\n\n${contentSnippet}`;
            } else {
              finalContent = "I couldn't find specific curriculum content for that question. Could you try rephrasing it?";
            }
          } else {
            finalContent = "How can I assist you today?";
          }
          
          // Safety: ensure finalContent is always a string before calling .trim()
          if (typeof finalContent !== 'string') finalContent = '';
          // Only log warning if we're using a fallback (not when intentionally empty for products)
          if (finalContent && finalContent.trim() !== '') {
            console.log('[Chat Stream] Using context-aware fallback:', finalContent);
          }
        }
        
        // SAFETY: Always strip [[FALLBACK]] marker before yielding (in case it leaked through)
        finalContent = this.stripFallbackMarker(finalContent);
        
        // Extract product IDs for metadata storage
        const productIds = productData && Array.isArray(productData) 
          ? productData.map((p: any) => p.id).filter(Boolean) 
          : undefined;
        if (!context.deferAssistantPersistence) {
          conversationMemory.storeMessage(context.userId, 'assistant', finalContent);
          await this.storeMessageInDB(conversationId, 'assistant', finalContent,
            productIds && productIds.length > 0 ? { productIds } : undefined);
        }
        yield { type: 'final', data: finalContent };
      } else {
        // No tool calls, store the response
        console.log('[Chat Stream] WARNING: No tool calls made for question:', userMessage);
        
        // Check if this is a refusal after a contact info request - if so, answer the pending question
        const lowerUserMessage = userMessage.toLowerCase().trim();
        const isRefusal = /^(no|nope|nah|not now|skip|later|no thanks|maybe later|not interested|i m good|i m okay|no need|pass)$/i.test(lowerUserMessage) || 
                         (lowerUserMessage.length < 20 && /\b(no|nope|skip|later|not now)\b/i.test(lowerUserMessage));
        
        if (isRefusal) {
          // Check conversation history for pending question
          const history = conversationMemory.getConversationHistory(context.userId);
          const pendingQuestion = this.extractLastSubstantiveQuestion(history, userMessage);
          
          // Check if the previous AI response was already a fallback (asked for contact info)
          // If so, skip re-processing since it will just hit the same fallback again
          const lastAssistantMessage = history.filter(m => m.role === 'assistant').slice(-1)[0];
          const previousResponseWasFallback = lastAssistantMessage?.content && 
            this.isContactRequestMessage(lastAssistantMessage.content);
          
          if (previousResponseWasFallback) {
            console.log('[Chat Stream] Skipping re-processing - previous response was already a fallback (would hit same fallback again)');
          }
          
          if (pendingQuestion && !previousResponseWasFallback) {
            console.log('[Chat Stream] Detected refusal after contact request. Re-processing pending question:', pendingQuestion);
            
            try {
              // Fetch fresh lead data in case it was captured after the initial existingLead snapshot
              const freshLeadForRefusal = await storage.getLeadByConversation(conversationId, context.businessAccountId);
              console.log(`[Chat Stream] Post-refusal: Fetched fresh lead data. Phone: ${freshLeadForRefusal?.phone ? 'YES' : 'NO'}`);
              
              // Re-process the original question with FULL knowledge tools (not refusal-stripped tools)
              // Use name-based lookup so adding/reordering tools never silently breaks this path.
              const { getToolByName } = await import('./aiTools');
              const fullTools = [getToolByName('get_products'), getToolByName('get_faqs')];
              
              const questionResponse = await llamaService.generateToolAwareResponse(
                pendingQuestion,
                fullTools,
                history,
                '',
                context.personality || 'friendly',
                context.openaiApiKey || undefined,
                context.businessAccountId,
                false,
                context.responseLength || 'balanced'
              );
              
              let finalAnswer = fullResponse; // Start with the refusal acknowledgment
              
              if (questionResponse.tool_calls && questionResponse.tool_calls.length > 0) {
                console.log('[Chat Stream] Post-refusal: AI needs tools, executing...');
                const toolResult = await this.handleToolCalls(
                  questionResponse,
                  context,
                  pendingQuestion,
                  fullTools,
                  appointmentsEnabled,
                  true,  // skipDBStore - response will be stored after processing
                  systemContext
                );
                
                // Check if the tool result is still a deflection - if so, use enhanced fallback
                if (this.isDeflectionResponse(toolResult.response)) {
                  console.log('[Chat Stream] Post-refusal: Tool result is deflection, applying enhanced fallback');
                  
                  const fallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
                  
                  let fallbackTemplate = fallbackInstructions && fallbackInstructions.length > 0
                    ? fallbackInstructions[0]
                    : "I'll need to check with our team for the specific details. Could you please share your contact information so they can reach out to you?";
                  
                  fallbackTemplate = this.processFallbackPlaceholders(fallbackTemplate, freshLeadForRefusal);
                  
                  const enhancedResponse = await this.rephraseFallbackMessage(
                    fallbackTemplate,
                    pendingQuestion,
                    context.businessAccountId,
                    context.openaiApiKey || undefined,
                    freshLeadForRefusal
                  );
                  finalAnswer = `No problem! ${enhancedResponse}`;
                } else {
                  // Strip [[FALLBACK]] marker if present
                  finalAnswer = `No problem! ${this.stripFallbackMarker(toolResult.response)}`;
                }
                
                // Track products for metadata storage
                const refusalProductIds = toolResult.products && toolResult.products.length > 0
                  ? toolResult.products.map((p: any) => p.id).filter(Boolean)
                  : undefined;
                
                if (toolResult.products && toolResult.products.length > 0) {
                  yield { 
                    type: 'products', 
                    data: JSON.stringify({ 
                      items: toolResult.products,
                      pagination: toolResult.pagination,
                      searchQuery: toolResult.searchQuery
                    }) 
                  };
                }
                
                // Yield appointment slots if returned (for calendar UI)
                if (toolResult.appointmentSlots) {
                  yield { type: 'appointment_slots', data: JSON.stringify(toolResult.appointmentSlots) };
                }
                
                // Yield next form step if returned (for form journey UI)
                if (toolResult.nextFormStep) {
                  console.log('[Chat Stream] Yielding next form step:', toolResult.nextFormStep.questionText?.substring(0, 30));
                  // Include conversationId so client can track which conversation to use for form step submission
                  yield { type: 'form_step', data: JSON.stringify({ ...toolResult.nextFormStep, conversationId }) };
                }
                
                // Store message with product IDs in metadata
                if (!context.deferAssistantPersistence) {
                  conversationMemory.storeMessage(context.userId, 'assistant', finalAnswer);
                  await this.storeMessageInDB(conversationId, 'assistant', finalAnswer,
                    refusalProductIds && refusalProductIds.length > 0 ? { productIds: refusalProductIds } : undefined);
                }
                yield { type: 'final', data: finalAnswer };
                
                // Skip the normal flow since we handled it
                yield { type: 'done', data: '' };
                return;
              } else if (questionResponse.content && questionResponse.content.trim()) {
                // Check if the content is a deflection
                if (this.isDeflectionResponse(questionResponse.content)) {
                  console.log('[Chat Stream] Post-refusal: Direct response is deflection, applying enhanced fallback');
                  const fallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
                  
                  let fallbackTemplate = fallbackInstructions && fallbackInstructions.length > 0
                    ? fallbackInstructions[0]
                    : "I'll need to check with our team for the specific details. Could you please share your contact information so they can reach out to you?";
                  
                  fallbackTemplate = this.processFallbackPlaceholders(fallbackTemplate, freshLeadForRefusal);
                  
                  const enhancedResponse = await this.rephraseFallbackMessage(
                    fallbackTemplate,
                    pendingQuestion,
                    context.businessAccountId,
                    context.openaiApiKey || undefined,
                    freshLeadForRefusal
                  );
                  finalAnswer = `No problem! ${enhancedResponse}`;
                } else {
                  // Strip [[FALLBACK]] marker if present
                  finalAnswer = `No problem! ${this.stripFallbackMarker(questionResponse.content)}`;
                }
              }
              
              if (!context.deferAssistantPersistence) {
                conversationMemory.storeMessage(context.userId, 'assistant', finalAnswer);
                await this.storeMessageInDB(conversationId, 'assistant', finalAnswer);
              }
              yield { type: 'final', data: finalAnswer };
              
              // Skip the normal flow since we handled it
              yield { type: 'done', data: '' };
              return;
            } catch (err) {
              console.error('[Chat Stream] Error re-processing after refusal:', err);
              // Fall through to normal handling
            }
          }
        }
        
        // RELEVANCE GATE: Check if AI returned empty or deflection without tool calls
        // This means AI couldn't answer the question - route to custom fallback template
        let finalResponse = fullResponse;
        
        if (!fullResponse || !fullResponse.trim() || this.isDeflectionResponse(fullResponse)) {
          console.log('[Relevance Gate] No-tools path: AI returned empty or deflection, routing to custom fallback');
          
          if (fullResponse && this.isDeflectionResponse(fullResponse)) {
            await this.saveToQuestionBank(
              context.businessAccountId,
              conversationId,
              userMessage,
              fullResponse
            );
          }
          
          const fallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
          if (fallbackInstructions && fallbackInstructions.length > 0) {
            let fallbackTemplate = fallbackInstructions[0];
            fallbackTemplate = this.processFallbackPlaceholders(fallbackTemplate, existingLead);
            const rephrased = await this.rephraseFallbackMessage(
              fallbackTemplate,
              userMessage,
              context.businessAccountId,
              context.openaiApiKey || undefined,
              existingLead
            );
            finalResponse = rephrased;
          } else if (!fullResponse || !fullResponse.trim()) {
            finalResponse = "I'd be happy to connect you with our team who can help with this. Could you share your contact details so they can reach out?";
          }
        }
        
        // SAFETY: Always strip [[FALLBACK]] marker before storing (in case it leaked through)
        finalResponse = this.stripFallbackMarker(finalResponse);
        
        if (!context.deferAssistantPersistence) {
          conversationMemory.storeMessage(context.userId, 'assistant', finalResponse);
          await this.storeMessageInDB(conversationId, 'assistant', finalResponse);
        }

        // If content was never streamed to the frontend (e.g. Gemini signaled tool calls but
        // sent no arguments, so buffered content was discarded), send the finalResponse now.
        if (!contentAlreadyYielded && finalResponse && finalResponse.trim()) {
          console.log('[Chat Stream] Yielding finalResponse that was not yet sent to frontend (Gemini empty tool-call guard)');
          yield { type: 'content', data: finalResponse };
        }

        // Emit order lookup option cards when server-side intent was detected
        // (no tool calls were made, so the cards haven't been emitted yet)
        if (serverSideLookupOptions || serverSideReturnExchange) {
          yield { type: 'order_lookup_options', data: JSON.stringify({ mode: serverSideReturnExchange ? 'return_exchange' : 'track', returnExchange: serverSideReturnExchange }) };
        }
      }

      // Check for discount eligibility and send nudge if applicable
      if (context.visitorSessionId) {
        try {
          const nudge = await checkDiscountEligibility(
            context.businessAccountId,
            context.visitorSessionId
          );
          
          if (nudge) {
            console.log('[Discount Nudge] Sending offer to session:', context.visitorSessionId, nudge);
            yield { 
              type: 'discount_nudge', 
              data: {
                offerId: nudge.offerId,
                discountCode: nudge.discountCode,
                discountPercentage: nudge.discountPercentage,
                message: nudge.message,
                expiresAt: nudge.expiresAt,
                productId: nudge.productId
              }
            };
          }
        } catch (err) {
          console.error('[Discount Nudge] Error checking eligibility:', err);
        }
      }

      // Auto-categorize conversation after sufficient activity (async, non-blocking).
      // Summarization is handled exclusively by the idle/close sweep worker — see note
      // on the other call site above.
      this.autoCategorizeConversationAsync(conversationId, context.businessAccountId, context.openaiApiKey);

      // ─── Conversion tracking signal — end-of-turn (Google Ads) ───────────────
      // Final idempotent check for this turn on the main AI path. The pre-
      // generation check above catches phones captured deterministically (auto-
      // detect is awaited for any message carrying >=7 digits) and phones captured
      // on a prior turn. THIS check additionally covers a phone captured by an AI
      // lead-capture tool call DURING this turn's model generation. The atomic
      // dedupe marker guarantees at-most-once, so this can never double-fire.
      if (context.channel === 'widget') {
        try {
          const fired = await this.maybeFireConversion(conversationId, context.businessAccountId);
          if (fired) {
            yield { type: 'lead_captured' as const, data: '' };
          }
        } catch (convErr) {
          console.error('[Conversion] end-of-turn lead-captured check failed (non-fatal):', convErr);
        }
      }

      yield { type: 'done', data: '' };
    } catch (error: any) {
      console.error('Chat streaming error:', error);
      yield { type: 'error', data: error.message };
    }
  }

  clearConversation(userId: string, businessAccountId: string, studentId?: string | null) {
    conversationMemory.clearConversation(userId);
    // Clear active conversation tracking to start a new conversation next time.
    // Task #17: when a studentId is supplied the cache key is student-suffixed
    // (see getOrCreateConversation), so clear that exact key. We also clear the
    // unsuffixed key for safety/back-compat.
    activeConversations.delete(`${userId}_${businessAccountId}`);
    if (studentId) activeConversations.delete(`${userId}_${businessAccountId}_${studentId}`);
  }

  // Get active conversation ID for a user session (returns null if no active conversation)
  async getActiveConversationId(userId: string, businessAccountId: string, studentId?: string | null): Promise<string | null> {
    // Task #17: getOrCreateConversation stores TopScholar student sessions under a
    // student-suffixed key. Prefer the suffixed key when a studentId is supplied so
    // the cache lookup aligns; fall back to the unsuffixed key for other tenants.
    if (studentId) {
      const scoped = activeConversations.get(`${userId}_${businessAccountId}_${studentId}`);
      if (scoped) return scoped;
      return null;
    }
    const sessionKey = `${userId}_${businessAccountId}`;
    return activeConversations.get(sessionKey) || null;
  }

  // Phase 3: Optimized context building with caching (5-minute TTL) and parallel loading
  /**
   * True when this account must answer academic questions strictly from
   * synced curriculum content. Forced ON for the single Top Scholar tenant by
   * identity so the per-account flag can never silently disable it; other
   * accounts honour the configurable k12ContentOnlyMode flag. Kept as one
   * predicate so the prompt guardrail and the forced-tool-call stay in lockstep.
   */
  private isK12ContentOnly(context: ChatContext): boolean {
    return context.k12EducationEnabled === true &&
      (isTopscholarAccount(context.businessAccountId) || context.k12ContentOnlyMode === true);
  }

  /**
   * Compact a K12 curriculum tool result before it is serialised into the LLM
   * message. The resolver returns up to 6 passages, each duplicating the same
   * text across `revisionNotes`, `notes[].content` and `contentHtml` — ~13k
   * input tokens. For content-only K12 we keep only the top passages, cap each
   * passage's text, and drop the duplicated `notes`/`contentHtml` fields. Image
   * markdown is already embedded inside `revisionNotes`, so curriculum images
   * survive. Only used on the content-only K12 path; other accounts are
   * unaffected.
   */
  private compactK12ToolResult(result: any): string {
    try {
      if (!result || !Array.isArray(result.data)) return JSON.stringify(result);
      const MAX_PASSAGES = 3;
      const MAX_CHARS = 1500;
      const compactData = result.data.slice(0, MAX_PASSAGES).map((r: any) => {
        const raw = typeof r?.revisionNotes === 'string' ? r.revisionNotes : '';
        const notes = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;
        const compact: any = {
          name: r?.name ?? null,
          chapterName: r?.chapterName ?? null,
          subjectName: r?.subjectName ?? null,
          revisionNotes: notes,
        };
        if (Array.isArray(r?.mediaUrls) && r.mediaUrls.length > 0) compact.mediaUrls = r.mediaUrls;
        if (Array.isArray(r?.videos) && r.videos.length > 0) {
          compact.videos = r.videos.map((v: any) => ({ title: v?.title ?? null, videoUrl: v?.videoUrl ?? '' }));
        }
        return compact;
      });
      return JSON.stringify({ ...result, data: compactData });
    } catch {
      return JSON.stringify(result);
    }
  }

  private async buildEnrichedContext(context: ChatContext): Promise<string> {
    const startTime = Date.now();
    
    // IMPORTANT: customInstructions are NOT cached because they are passed dynamically 
    // with each request and must always be fresh (user may update them at any time)
    let customInstructionsContext = '';
    let fallbackInstructions: string[] = [];
    
    if (context.customInstructions && context.customInstructions.trim()) {
      try {
        // Try to parse as JSON array (new format)
        const instructions = JSON.parse(context.customInstructions);
        if (Array.isArray(instructions) && instructions.length > 0) {
          // Separate instructions by type
          const alwaysActiveInstructions = instructions.filter((instr: any) => instr.type === 'always' || !instr.type);
          const conditionalInstructions = instructions.filter((instr: any) => instr.type === 'conditional');
          fallbackInstructions = instructions
            .filter((instr: any) => instr.type === 'fallback')
            .map((instr: any) => instr.text);
          
          // Build always-active instructions context
          if (alwaysActiveInstructions.length > 0) {
            const formattedAlwaysActive = alwaysActiveInstructions
              .map((instr: any, index: number) => `${index + 1}. ${instr.text}`)
              .join('\n');
            customInstructionsContext = `CUSTOM BUSINESS INSTRUCTIONS:\nFollow these specific instructions for this business:\n${formattedAlwaysActive}\n\n`;
          }
          
          // Add conditional instructions with their trigger keywords
          if (conditionalInstructions.length > 0) {
            const formattedConditional = conditionalInstructions
              .map((instr: any) => {
                const keywords = instr.keywords?.join(', ') || '';
                return `- When user mentions [${keywords}]: ${instr.text}`;
              })
              .join('\n');
            customInstructionsContext += `CONDITIONAL INSTRUCTIONS (apply when keywords are mentioned):\n${formattedConditional}\n\n`;
          }
          
          // Store fallback instructions in context for later use
          if (fallbackInstructions.length > 0) {
            // Fallback instructions are NOT added to regular context
            // They will be applied only when AI cannot answer
            console.log(`[Context Build] Found ${fallbackInstructions.length} fallback instruction(s) for unknown questions`);
          }
          
          console.log(`[Context Build] Loaded ${alwaysActiveInstructions.length} always-active, ${conditionalInstructions.length} conditional, ${fallbackInstructions.length} fallback instructions (FRESH, not cached)`);
        }
      } catch {
        // Fallback to plain text format (legacy)
        customInstructionsContext = `CUSTOM BUSINESS INSTRUCTIONS:\nFollow these specific instructions for this business:\n${context.customInstructions}\n\n`;
        console.log(`[Context Build] Loaded legacy custom instructions (FRESH, not cached)`);
      }
    }
    
    // Store or clear fallback instructions for use when deflection is detected
    // IMPORTANT: Always update the cache to prevent stale fallback instructions from being applied
    if (fallbackInstructions.length > 0) {
      this.fallbackInstructionsCache.set(context.businessAccountId, fallbackInstructions);
    } else {
      // Clear cache when no fallback instructions exist (user may have deleted them)
      this.fallbackInstructionsCache.delete(context.businessAccountId);
    }
    
    // Phase 3 Task 8: Use cache for business context (FAQs, settings, etc.)
    // NOTE: customInstructions are handled separately above and prepended to the final result
    // Content-only K12 (e.g. TopScholar) answers strictly from synced curriculum
    // via fetch_k12_topic. Omit sales/lead/website/training-doc blocks so the
    // system prompt stays lean and the model isn't tempted off-curriculum.
    // The lean variant MUST be cached under its own key: a non-K12 caller (the
    // widget prewarm has no K12 flags set) would otherwise populate the shared
    // `context:<id>` entry with the full website/sales context, and the K12 path
    // would then serve that bloated version, defeating the optimization.
    const k12ContentOnly = this.isK12ContentOnly(context);
    const cacheKey = k12ContentOnly
      ? BusinessContextCache.KEYS.BUSINESS_CONTEXT_K12(context.businessAccountId)
      : BusinessContextCache.KEYS.BUSINESS_CONTEXT(context.businessAccountId);
    
    const businessContext = await businessContextCache.getOrFetch(cacheKey, async () => {
      let enrichedContext = '';

      // PARALLEL DATA LOADING: Load all database queries simultaneously for 50-60% faster performance
      console.log('[Context Build] Starting parallel data loading...');
      const parallelLoadStart = Date.now();
      
      const [
        widgetSettingsResult,
        productsResult,
        faqsResult,
        websiteContentResult,
        analyzedPagesResult,
        trainingDocsResult,
        chatMenuItemsResult
      ] = await Promise.allSettled([
        storage.getWidgetSettings(context.businessAccountId),
        storage.getAllProducts(context.businessAccountId),
        storage.getAllFaqs(context.businessAccountId),
        (async () => {
          const { websiteAnalysisService } = await import("./websiteAnalysisService");
          return await websiteAnalysisService.getAnalyzedContent(context.businessAccountId);
        })(),
        storage.getAnalyzedPages(context.businessAccountId),
        storage.getTrainingDocuments(context.businessAccountId),
        storage.getChatMenuItems(context.businessAccountId)
      ]);

      // Extract results from Promise.allSettled
      const widgetSettings = widgetSettingsResult.status === 'fulfilled' ? widgetSettingsResult.value : null;
      const products = productsResult.status === 'fulfilled' ? productsResult.value : [];
      const businessFaqs = faqsResult.status === 'fulfilled' ? faqsResult.value : [];
      const websiteContent = websiteContentResult.status === 'fulfilled' ? websiteContentResult.value : null;
      const analyzedPages = analyzedPagesResult.status === 'fulfilled' ? analyzedPagesResult.value : [];
      const trainingDocs = trainingDocsResult.status === 'fulfilled' ? trainingDocsResult.value : [];

      const parallelLoadTime = Date.now() - parallelLoadStart;
      console.log(`[Context Build] Parallel data loading completed in ${parallelLoadTime}ms`);

      // Log any failures (non-blocking)
      if (widgetSettingsResult.status === 'rejected') {
        console.error('[Context Build] Failed to load widgetSettings:', widgetSettingsResult.reason);
      }
      if (productsResult.status === 'rejected') {
        console.error('[Context Build] Failed to load products:', productsResult.reason);
      }
      if (faqsResult.status === 'rejected') {
        console.error('[Context Build] Failed to load FAQs:', faqsResult.reason);
      }
      if (websiteContentResult.status === 'rejected') {
        console.error('[Context Build] Failed to load website content:', websiteContentResult.reason);
      }
      if (analyzedPagesResult.status === 'rejected') {
        console.error('[Context Build] Failed to load analyzed pages:', analyzedPagesResult.reason);
      }
      if (trainingDocsResult.status === 'rejected') {
        console.error('[Context Build] Failed to load training documents:', trainingDocsResult.reason);
      }

      const menuItems = chatMenuItemsResult.status === 'fulfilled' ? chatMenuItemsResult.value : [];
      const brochureLinks: { label: string; url: string; menuTitle: string }[] = [];
      for (const item of menuItems) {
        if (item.itemType === 'detail' && item.actionValue) {
          try {
            const config = JSON.parse(item.actionValue);
            if (config.brochureUrl) {
              brochureLinks.push({
                label: config.brochureLabel || 'Download Brochure',
                url: config.brochureUrl.startsWith('http') ? config.brochureUrl : `https://${config.brochureUrl}`,
                menuTitle: item.title
              });
            }
          } catch {}
        }
        if (item.itemType === 'url' && item.actionValue) {
          const lowerTitle = item.title.toLowerCase();
          if (lowerTitle.includes('brochure') || lowerTitle.includes('download') || lowerTitle.includes('catalog') || lowerTitle.includes('catalogue')) {
            brochureLinks.push({
              label: item.title,
              url: item.actionValue.startsWith('http') ? item.actionValue : `https://${item.actionValue}`,
              menuTitle: item.title
            });
          }
        }
      }
      if (brochureLinks.length > 0 && !k12ContentOnly) {
        enrichedContext += `\nDOWNLOADABLE RESOURCES:\n`;
        for (const link of brochureLinks) {
          enrichedContext += `- ${link.label}: ${link.url}\n`;
        }
        enrichedContext += `When users ask for brochure/catalog/download, provide the EXACT URL above as a clickable markdown link like [${brochureLinks[0].label}](${brochureLinks[0].url})\n\n`;
      }

      // Add lead training configuration (from Train Chroney page) — uses shared utility
      try {
        if (widgetSettings?.leadTrainingConfig && !k12ContentOnly) {
          const leadPrompt = buildLeadTrainingPrompt(widgetSettings.leadTrainingConfig);
          if (leadPrompt) {
            enrichedContext += leadPrompt;
          }
        }
      } catch (error) {
        console.error('[Chat Context] Error loading lead training config:', error);
      }

      // Add appointment suggest trigger rules
      try {
        if (widgetSettings?.appointmentSuggestRules && Array.isArray(widgetSettings.appointmentSuggestRules) && !k12ContentOnly) {
          const enabledRules = widgetSettings.appointmentSuggestRules.filter((r: any) => r.enabled);
          if (enabledRules.length > 0) {
            enrichedContext += `APPOINTMENT SUGGESTION TRIGGERS:\n`;
            enrichedContext += `When you detect these keywords in the user's message, proactively suggest booking an appointment using the specified prompt:\n`;
            enabledRules.forEach((rule: any, index: number) => {
              const keywords = Array.isArray(rule.keywords) ? rule.keywords.join(', ') : '';
              enrichedContext += `${index + 1}. Keywords: [${keywords}] → Respond with: "${rule.prompt}"\n`;
            });
            enrichedContext += `\nIMPORTANT: Only suggest once per conversation. After suggesting, wait for user's response before offering again.\n\n`;
          }
        }
      } catch (error) {
        console.error('[Chat Context] Error loading appointment suggest rules:', error);
      }

      // Add currency information
      if (context.currency && context.currencySymbol) {
        enrichedContext += `CURRENCY SETTINGS:\nAll prices should be referenced in ${context.currency} (${context.currencySymbol}). When discussing prices, always use ${context.currencySymbol} as the currency symbol.\n\n`;
      }

      // Add company description
      if (context.companyDescription) {
        enrichedContext += `COMPANY INFORMATION:\n${context.companyDescription}\n\n`;
      }

      // OPTIMIZATION: Product catalog removed from base context
      // The get_products tool handles product queries via semantic search
      // This reduces prompt size by ~80% and speeds up responses
      if (products.length > 0) {
        enrichedContext += `PRODUCT AVAILABILITY:\nThis business has ${products.length} products in their catalog. Use the get_products tool to search and retrieve products when customers ask about products, pricing, or recommendations.\n\n`;
      }

      // OPTIMIZATION: FAQ dump removed from base context  
      // The get_faqs tool handles FAQ queries via vector search
      // Only relevant FAQs are retrieved per query
      // TopScholar: skip FAQ/knowledge-base context — answers come from external
      // curriculum only (fetch_k12_topic). No other account is affected.
      if (businessFaqs.length > 0 && !isTopscholarAccount(context.businessAccountId) && !k12ContentOnly) {
        enrichedContext += `KNOWLEDGE BASE:\nThis business has ${businessFaqs.length} FAQ entries. Use the get_faqs tool to search for answers when customers ask questions. Answer naturally without mentioning FAQs or knowledge base.\n\n`;
      }

      // Add website analysis if available
      // Data already loaded in parallel above
      // TopScholar: skip website analysis — answers come from external curriculum only.
      try {
        if (websiteContent && !isTopscholarAccount(context.businessAccountId) && !k12ContentOnly) {
          enrichedContext += `BUSINESS KNOWLEDGE (from website analysis):\n`;
          enrichedContext += `You have comprehensive knowledge about this business extracted from their website.\n\n`;
          
          if (websiteContent.businessName) {
            enrichedContext += `Business Name: ${websiteContent.businessName}\n\n`;
          }
          
          if (websiteContent.businessDescription) {
            enrichedContext += `About: ${websiteContent.businessDescription}\n\n`;
          }
          
          if (websiteContent.targetAudience) {
            enrichedContext += `Target Audience: ${websiteContent.targetAudience}\n\n`;
          }
          
          if (websiteContent.mainProducts && websiteContent.mainProducts.length > 0) {
            enrichedContext += `Main Products:\n${websiteContent.mainProducts.map(p => `- ${p}`).join('\n')}\n\n`;
          }
          
          if (websiteContent.mainServices && websiteContent.mainServices.length > 0) {
            enrichedContext += `Main Services:\n${websiteContent.mainServices.map(s => `- ${s}`).join('\n')}\n\n`;
          }
          
          if (websiteContent.keyFeatures && websiteContent.keyFeatures.length > 0) {
            enrichedContext += `Key Features:\n${websiteContent.keyFeatures.map(f => `- ${f}`).join('\n')}\n\n`;
          }
          
          if (websiteContent.uniqueSellingPoints && websiteContent.uniqueSellingPoints.length > 0) {
            enrichedContext += `Unique Selling Points:\n${websiteContent.uniqueSellingPoints.map(u => `- ${u}`).join('\n')}\n\n`;
          }
          
          if (websiteContent.contactInfo && (websiteContent.contactInfo.email || websiteContent.contactInfo.phone || websiteContent.contactInfo.address)) {
            enrichedContext += `Contact Information:\n`;
            if (websiteContent.contactInfo.email) enrichedContext += `- Email: ${websiteContent.contactInfo.email}\n`;
            if (websiteContent.contactInfo.phone) enrichedContext += `- Phone: ${websiteContent.contactInfo.phone}\n`;
            if (websiteContent.contactInfo.address) enrichedContext += `- Address: ${websiteContent.contactInfo.address}\n`;
            enrichedContext += '\n';
          }
          
          if (websiteContent.businessHours) {
            enrichedContext += `Business Hours: ${websiteContent.businessHours}\n\n`;
          }
          
          if (websiteContent.pricingInfo) {
            enrichedContext += `Pricing: ${websiteContent.pricingInfo}\n\n`;
          }
          
          if (websiteContent.additionalInfo) {
            enrichedContext += `Additional Information: ${websiteContent.additionalInfo}\n\n`;
          }
          
          enrichedContext += `IMPORTANT: Use this website knowledge to provide accurate, context-aware responses about the business. Answer naturally without mentioning that you analyzed their website.\n\n`;
        }
      } catch (error) {
        console.error('[Chat Context] Error loading website analysis:', error);
      }

      // Add analyzed pages content (homepage, additional pages)
      // Data already loaded in parallel above
      try {
        if (analyzedPages && analyzedPages.length > 0 && !k12ContentOnly) {
          enrichedContext += `DETAILED WEBSITE CONTENT:\n`;
          enrichedContext += `Below is detailed information extracted from ${analyzedPages.length} page(s) of the business website.\n\n`;
          
          let pagesLoaded = 0;
          for (const page of analyzedPages) {
            // Skip pages with no content or generic "no info" message
            if (!page.extractedContent || 
                page.extractedContent.trim() === '' || 
                page.extractedContent === 'No relevant business information found on this page.') {
              continue;
            }
            
            try {
              // Extract page name from URL (handle both absolute and relative URLs)
              let pageName = 'Page';
              try {
                // Try parsing as absolute URL first
                const url = new URL(page.pageUrl);
                const pathParts = url.pathname.split('/').filter(Boolean);
                pageName = pathParts[pathParts.length - 1] || 'Homepage';
              } catch {
                // Fallback for relative URLs (e.g., "/privacy-policy")
                const pathParts = page.pageUrl.split('/').filter(Boolean);
                pageName = pathParts[pathParts.length - 1] || 'Homepage';
              }
              
              enrichedContext += `--- ${pageName.toUpperCase()} PAGE ---\n`;
              enrichedContext += `${page.extractedContent}\n\n`;
              pagesLoaded++;
            } catch (pageError) {
              console.error(`[Chat Context] Error processing page ${page.pageUrl}:`, pageError);
              // Continue with other pages even if one fails
            }
          }
          
          if (pagesLoaded > 0) {
            console.log(`[Chat Context] Loaded ${pagesLoaded} analyzed page(s) into context`);
            enrichedContext += `IMPORTANT: Use all the above website content to answer customer questions accurately. This information comes from their actual website pages.\n\n`;
          } else {
            console.log(`[Chat Context] No valid analyzed pages content found to load`);
          }
        }
      } catch (error) {
        console.error('[Chat Context] Error loading analyzed pages:', error);
      }

      // Add training documents (PDF knowledge)
      // Data already loaded in parallel above
      try {
        const completedDocs = trainingDocs.filter(doc => doc.uploadStatus === 'completed');
        
        if (completedDocs.length > 0 && !k12ContentOnly) {
          enrichedContext += `TRAINING DOCUMENTS KNOWLEDGE:\n`;
          enrichedContext += `The following information has been extracted from uploaded training documents:\n\n`;
          
          for (const doc of completedDocs) {
            if (doc.summary || doc.keyPoints) {
              enrichedContext += `--- ${doc.originalFilename} ---\n`;
              
              if (doc.summary) {
                enrichedContext += `Summary: ${doc.summary}\n\n`;
              }
              
              if (doc.keyPoints) {
                try {
                  const keyPoints = JSON.parse(doc.keyPoints);
                  if (Array.isArray(keyPoints) && keyPoints.length > 0) {
                    enrichedContext += `Key Points:\n`;
                    keyPoints.forEach((point: string, index: number) => {
                      enrichedContext += `${index + 1}. ${point}\n`;
                    });
                    enrichedContext += `\n`;
                  }
                } catch (parseError) {
                  console.error(`[Chat Context] Error parsing key points for ${doc.originalFilename}:`, parseError);
                }
              }
            }
          }
          
          console.log(`[Chat Context] Loaded ${completedDocs.length} training document(s) summaries into context`);
          enrichedContext += `IMPORTANT: Use this training document knowledge to provide accurate, informed responses. This information has been specifically provided to help answer customer questions.\n\n`;
        }
      } catch (error) {
        console.error('[Chat Context] Error loading training documents:', error);
      }

      return enrichedContext;
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Context Build] Business context loaded in ${elapsed}ms`);
    console.log(`[Context Build] Cached context length: ${businessContext.length} characters`);
    console.log(`[Context Build] Has FAQs: ${businessContext.includes('BUSINESS KNOWLEDGE:')}`);
    console.log(`[Context Build] Context preview: ${businessContext.substring(0, 500)}...`);

    // Prepend custom instructions (ALWAYS FRESH, not cached) to the cached business context
    // This ensures instructions are always up-to-date even when cache returns old data
    // Add current date context so AI knows today's date for appointment booking and date-related queries
    // IMPORTANT: Use IST (Asia/Kolkata) timezone explicitly to ensure consistent date interpretation
    const now = new Date();
    const istDateFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const istTimeFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    // Get ISO date in IST using formatToParts for robustness
    const istParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now);
    const getPart = (type: string) => istParts.find(p => p.type === type)?.value || '';
    const isoDate = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    
    const dateContext = `CURRENT DATE/TIME (IST - Indian Standard Time):
Today is ${istDateFormatter.format(now)} (${isoDate}) at ${istTimeFormatter.format(now)} IST.
IMPORTANT: Users booking appointments for future dates is completely normal and expected. Do NOT question, clarify, or confirm that a date is "in the future" - simply proceed with the booking flow by asking for their name and phone number.

`;

    let finalContext = dateContext + customInstructionsContext + businessContext;
    
    console.log(`[Context Build] Has Custom Instructions: ${finalContext.includes('CUSTOM BUSINESS INSTRUCTIONS')}`);
    console.log(`[Context Build] Custom instructions length: ${customInstructionsContext.length} characters`);

    if (context.k12EducationEnabled) {
      // The single TopScholar account must ALWAYS answer external-content-only —
      // enforced by account identity so the per-account flag can never silently
      // disable it. Other accounts still honour their configurable flag.
      const contentOnly = this.isK12ContentOnly(context);
      const verbatim = context.k12VerbatimContentMode === true;

      // Rule 4 changes when content-only mode is enabled — no general-knowledge fallback allowed.
      const rule4 = contentOnly
        ? `3. CONTENT-ONLY MODE IS ON. If no curriculum match is found by the tools AND nothing in the uploaded FAQs, notes, documents, or business knowledge base above answers the question, you MUST politely tell the student that this topic isn't in the curriculum yet (e.g. "Great question! That topic isn't in our curriculum yet — would you like me to look up something else?"). NEVER answer from general knowledge. NEVER guess or improvise an academic answer.`
        : `3. If no curriculum match is found, you may answer from general knowledge but mention that the specific topic wasn't found in the curriculum.`;

      // Sanitize the token-supplied name before interpolating into the system
      // prompt: a signed token proves integrity, not semantic safety. Strip
      // control chars/newlines (prompt-injection surface), collapse whitespace,
      // allow only name-plausible characters, and cap the length.
      const studentDisplayName = (context.studentName || '')
        .replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ')
        .replace(/[^\p{L}\p{M}\s.'\-]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      const studentFirstName = (studentDisplayName.split(/\s+/)[0] || '').slice(0, 40);
      console.log(`[Context Build] Student name injected: ${studentDisplayName ? `yes (${studentFirstName})` : 'no'}`);
      if (studentDisplayName) {
        finalContext += `STUDENT CONTEXT:
You are tutoring ${studentDisplayName}. They are signed in through their school portal, so you DO know who they are — their name is ${studentDisplayName}.
- If they ask "do you know my name?", "who am I?", or anything similar, answer warmly and confidently with their name (e.g. "Of course — you're ${studentFirstName}! What shall we work on today?"). NEVER say you don't have access to their name or personal information.
- Weave their first name (${studentFirstName}) naturally into the conversation from time to time — in greetings, encouragement, and transitions (e.g. "Great question, ${studentFirstName}!", "You're getting this, ${studentFirstName}!"). Aim for roughly every few messages, not every reply, so it feels personal rather than robotic.

`;
      }

      // Make the tutor explicitly aware of the curriculum scope the student's
      // portal selected (board/medium/grade/subject). Retrieval is already
      // hard-filtered to these via cp_ids; this block lets the tutor *talk about*
      // its scope confidently (e.g. answer "what subject can you help with?")
      // instead of guessing from whatever chunks it happened to retrieve.
      const scopeSubject = (context.studentSubject ?? '').trim();
      const scopeGrade = (context.studentGrade ?? '').trim();
      const scopeBoard = (context.studentBoard ?? '').trim();
      const scopeMedium = (context.studentMedium ?? '').trim();
      const gradeBoardParts = [scopeGrade, scopeBoard, scopeMedium ? `${scopeMedium} medium` : ''].filter(Boolean);
      const gradeBoardLabel = gradeBoardParts.join(', ');
      if (scopeSubject || gradeBoardLabel) {
        finalContext += `STUDENT CURRICULUM SCOPE:\n`;
        if (scopeSubject) {
          finalContext += `This student is set up for the subject "${scopeSubject}"${gradeBoardLabel ? ` (${gradeBoardLabel})` : ''}. You can ONLY help with this subject — all your curriculum content is from it.\n`;
          finalContext += `When the student asks what subject/topic you can help with, what you can do, or "what is this", answer confidently and specifically by naming the subject (e.g. "You're all set up for ${scopeSubject}${scopeGrade ? ` (${scopeGrade})` : ''} — ask me anything about it!"). Do NOT vaguely list random topics or guess; name the subject directly. Keep every academic answer anchored to ${scopeSubject}.\n`;
        } else {
          finalContext += `This student is set up for ${gradeBoardLabel}, which may cover multiple subjects.\n`;
          finalContext += `When the student asks what you can help with, mention their ${gradeBoardLabel} and that you can help across the subjects in their curriculum. Do NOT claim a single specific subject.\n`;
        }
        finalContext += `\n`;
      }

      finalContext += `K12 EDUCATION MODE — TUTOR INSTRUCTIONS:
You are a friendly, encouraging educational tutor (study buddy). Your primary role is helping students learn and practice.
MANDATORY RULES:
1. For ANY academic, educational, or study-related question, you MUST call the fetch_k12_topic tool FIRST before responding. NEVER answer academic questions from general knowledge alone.
2. Base your explanations on the revision notes and content returned by the tools. If the tool returns content, use it as your primary source.
${rule4}
4. Be supportive and clear — explain concepts in a friendly, student-friendly way with examples where helpful.
5. You can respond to greetings and casual conversation naturally without calling tools.
6. MEDIA: When a tool result item includes "mediaUrls" or a "videos" array, surface that media inline using Markdown so the student can see it. For an image URL write \`![diagram](URL)\`; for a video write a labelled link \`[▶ Watch: <title>](URL)\`. Only use URLs that actually appear in the tool result — never invent or guess a media URL.
7. MATH: Render mathematical expressions using LaTeX delimited by \\( \\) for inline and \\[ \\] (or $$) for display, so equations render cleanly. Reproduce the math exactly as it appears in the curriculum content.

⛔ STRICT RULE — NO FOLLOW-UP INVITATIONS (HIGHEST PRIORITY):
Your response MUST end immediately after you finish answering. Never append a closing invitation of any kind. The following endings are FORBIDDEN:
- "Would you like to try some practice questions?"
- "Would you like to try identifying X in some sentences?"
- "If you have any further questions or want to practice, just let me know!"
- "Shall we try some exercises?"
- "Let me know if you'd like to practice."
- Any other sentence inviting the student to practice, try exercises, attempt questions, take a quiz, or "let you know" if they want more.
Answer the question, then STOP. Do not add a friendly closing line. Only fetch or offer practice questions when the student EXPLICITLY asks (e.g. "quiz me", "give me practice questions", "test me").

`;

      if (contentOnly) {
        finalContext += `🛡️ K12 CONTENT-ONLY GUARDRAIL (MUST FOLLOW):
- Your ONLY allowed sources are: the curriculum content returned by fetch_k12_topic / fetch_k12_questions, the uploaded FAQs, the uploaded documents/notes, and the business knowledge base above.
- You are FORBIDDEN from answering academic or study-related questions using your general knowledge, training data, the public internet, or "common sense" facts that are not present in the sources above.
- If the sources do not contain the answer, respond with a friendly "this topic isn't in our curriculum yet" message and offer to help with what IS available. Do NOT attempt the answer.
- Greetings, small talk, and meta-questions about how to use the tutor are allowed without curriculum lookup.
- ⛔ NEVER end your response with an invitation to practice, try exercises, attempt questions, or take a quiz. No "would you like to try...", no "let me know if you want to practice". Answer, then stop.

`;
        console.log(`[Context Build] Added K12 Content-Only guardrail`);
      }

      if (verbatim) {
        finalContext += `📖 K12 CURRICULUM-ONLY GUARDRAIL (MUST FOLLOW):
- Your answers MUST be based SOLELY on the content returned by fetch_k12_topic / fetch_k12_questions. Every fact, example, and concept you state must be present in the tool result.
- You MAY present the curriculum content in a clear, student-friendly way: use simple language, add helpful formatting (bullet points, bold headings), and structure explanations so they are easy to understand.
- STRICT PROHIBITION: Do NOT introduce any fact, example, term, or concept that does not appear in the tool result. If the curriculum says "Potatoes and cereals are starch sources", do NOT add "Legumes" or any other example not mentioned.
- If the tool result includes images (Markdown image tags like ![image](URL)), include them in your response exactly as they appear — do not remove or skip them.
- If the tool result does not contain an answer to the student's question, respond with a friendly "This topic isn't in our curriculum yet — would you like help with something else?" Do NOT attempt an answer from your own knowledge.
- Greetings, encouragement, and meta-questions about the tutor are always allowed without a curriculum lookup.
- ⛔ NEVER end your response with an invitation to practice, try exercises, attempt questions, or take a quiz. No "would you like to try...", no "let me know if you want to practice". Answer, then stop.

`;
        console.log(`[Context Build] Added K12 Verbatim Content guardrail`);
      }

      console.log(`[Context Build] Added K12 education tutor prompt (contentOnly=${contentOnly}, verbatim=${verbatim})`);
    }

    if (context.jobPortalEnabled) {
      finalContext += `RECRUITMENT ASSISTANT MODE — JOB PORTAL INSTRUCTIONS:
You are a helpful recruitment assistant. Your primary role is helping visitors discover job openings and apply for positions.
MANDATORY RULES:
1. For ANY question about jobs, positions, openings, or careers, you MUST call the search_jobs tool FIRST. NEVER list jobs from general knowledge.
2. When a visitor uploads a resume (PDF), call parse_resume_and_match to extract their info and find matching positions.
3. When a visitor wants to apply to a specific job, use the apply_to_job tool.
4. Encourage visitors to upload their resume for better job matching — mention that you can analyze their skills and find the best fit.
5. Present job results naturally — mention key details like title, location, salary range, and job type.
6. If no matching jobs are found, let the visitor know and suggest they check back later or broaden their search.
7. You can respond to greetings and casual conversation naturally without calling tools.

`;
      console.log(`[Context Build] Added Job Portal recruitment assistant prompt`);
    }

    if (context.demoOrdersEnabled) {
      finalContext += `ORDER TRACKING & RETURNS ASSISTANT INSTRUCTIONS:
You can help customers track their orders and initiate returns/exchanges.
RULES:
1. When a customer mentions tracking an order, checking order status, "where is my order", or their package — and has NOT already provided an order ID, phone number, or email — call show_order_lookup_options IMMEDIATELY. Do NOT ask for their name. Do NOT ask for any identifier yet. Just call the tool right away.
2. After the customer selects a lookup method (they will say something like "Via Mobile Number", "Via Email ID", or "Via Order ID"), ask ONLY for that specific identifier. Then call track_order with the value they provide.
3. If the customer directly provides an order ID (e.g., "#LB1001"), phone number, or email in their first message, skip show_order_lookup_options and call track_order directly with the provided value.
4. When a customer mentions returning, exchanging, or reporting a problem with an order, guide them step by step and call the initiate_return tool once you have: order ID, reason, and preferred resolution (refund or exchange).
5. Present order status clearly and helpfully — mention the courier, tracking number, and estimated delivery date when available.
6. You can respond to greetings and other questions naturally without calling tools.

`;
      console.log(`[Context Build] Added Demo Orders assistant prompt`);
    }

    if (context.journeyConversationalGuidelines && context.journeyConversationalGuidelines.trim()) {
      finalContext += `JOURNEY-SPECIFIC CONVERSATIONAL GUIDELINES:\nWhile following the main business instructions above, also adhere to these additional guidelines specific to the current conversation journey:\n${context.journeyConversationalGuidelines}\n\n`;
      console.log(`[Context Build] Added journey-specific conversational guidelines`);
    }

    // Add starter Q&A context for guidance chatbots (per-conversation, not cached)
    // This provides predefined answers for common questions specific to the guidance rule
    if (context.starterQAContext && context.starterQAContext.trim()) {
      finalContext += `\n${context.starterQAContext}\n`;
      console.log(`[Context Build] Added guidance starter Q&A context`);
    }

    // CRITICAL: Add communication guidelines at the END for maximum AI compliance (recency bias)
    // AI models remember instructions at the end of prompts better than those at the beginning
    // Include the configured fallback message as the example response style
    const cachedFallbackInstructions = this.fallbackInstructionsCache.get(context.businessAccountId);
    const configuredFallback = cachedFallbackInstructions && cachedFallbackInstructions.length > 0
      ? cachedFallbackInstructions[0]
        .replace(/\{\{if_missing_phone\}\}/g, '')
        .replace(/\{\{\/if_missing_phone\}\}/g, '')
        .replace(/\{\{if_has_phone\}\}/g, '')
        .replace(/\{\{\/if_has_phone\}\}/g, '')
        .replace(/\{\{if_missing_email\}\}/g, '')
        .replace(/\{\{\/if_missing_email\}\}/g, '')
        .replace(/\{\{if_has_email\}\}/g, '')
        .replace(/\{\{\/if_has_email\}\}/g, '')
        .replace(/\{\{if_missing_name\}\}/g, '')
        .replace(/\{\{\/if_missing_name\}\}/g, '')
        .replace(/\{\{if_has_name\}\}/g, '')
        .replace(/\{\{\/if_has_name\}\}/g, '')
        .replace(/\n\s*\n/g, ' ')
        .trim()
      : null;
    
    const exampleResponse = configuredFallback 
      ? configuredFallback
      : "I need to pass this to our team to give you the right answer. Please share your mobile number so our team can contact you and help you quickly.";

    // K12 tutor accounts (e.g. TopScholar): students are already identified via the
    // signed launch token, so the tutor must NEVER ask for a mobile number, email,
    // or other contact details. Escalation happens through the built-in
    // "Did this resolve your doubt?" flow (retry once, then a support ticket) —
    // the widget surfaces that prompt automatically; the AI only acknowledges.
    if (this.isK12ContentOnly(context)) {
      // The "Did this resolve your doubt?" prompt only exists in doubt-scoped
      // (TopScholar) sessions — only reference it when it will actually appear.
      const doubtScoped = !!String(context.topscholarDoubtId || '').trim();
      const escalationLine = doubtScoped
        ? `✅ If the student asks to talk to a human / teacher / support, or asks you to escalate, respond in this style:
"I understand — I'm flagging this for our support team right now. You'll see a quick prompt below asking if your doubt was resolved; tap No there and a teacher will follow up with you personally."`
        : `✅ If the student asks to talk to a human / teacher / support, or asks you to escalate, respond in this style:
"I understand — I've noted this for our support team, and they'll follow up through your school portal. Meanwhile, is there anything else I can help you with?"`;
      finalContext += `

🚨 FINAL CRITICAL RULES - MUST FOLLOW 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫 NEVER ask the student for their mobile number, phone number, email, or any other contact details, under ANY circumstance. The school portal already knows who they are.
${escalationLine}
✅ If the answer isn't in the curriculum, say the topic isn't in the syllabus yet and offer help with what IS available — never ask for contact details.
🔴 WRONG: "Please share your mobile number so our team can contact you."
🟢 RIGHT: Acknowledge, reassure the student the team will follow up, and never request contact details.
This rule is MANDATORY and overrides ALL other instructions, including any earlier instruction to collect contact information.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      return finalContext;
    }

    const communicationGuidelines = `

🚨 FINAL CRITICAL RULES - MUST FOLLOW 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚫 ABSOLUTELY BANNED PHRASES - NEVER USE THESE UNDER ANY CIRCUMSTANCE:
❌ "I don't have information..."
❌ "I don't have specific information..."
❌ "I don't have [any word] information..."
❌ "I don't know..."
❌ "I'm not sure..."
❌ "I cannot answer..."
❌ "I cannot help..."
❌ "I'm unable to..."
❌ "That's outside my knowledge..."
❌ "I don't have details..."
❌ "I couldn't find..."
❌ "Unfortunately, I don't..."
❌ "I apologize, I don't have..."
❌ Any phrase starting with "I don't have" or "I cannot" or "I don't know"

⚠️ THIS IS THE #1 RULE - If you're about to say "I don't have" or "I don't know" - STOP and use the positive response below instead!

✅ WHEN YOU DON'T HAVE SPECIFIC INFORMATION, USE THIS EXACT STYLE:
"${exampleResponse}"

📝 MORE EXAMPLES OF POSITIVE RESPONSES:
✅ "Great question! Let me connect you with our team who can give you the exact details. May I have your mobile number?"
✅ "I'd be happy to help! Our team can provide you with accurate information on this. Please share your mobile number."
✅ "That's an excellent query! I'll have our team reach out with the right answer. What's your mobile number?"

🔴 WRONG: "I don't have specific fee information, but..."
🟢 RIGHT: "I need to pass this to our team to give you the right answer. Please share your mobile number."

🔴 WRONG: "I don't have information about that program..."  
🟢 RIGHT: "Great question! Let me connect you with our team who can guide you on this."

This rule is MANDATORY and overrides ALL other instructions. NEVER admit lack of knowledge - always redirect positively!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    finalContext += communicationGuidelines;

    return finalContext;
  }

  /**
   * Determine if a query needs deep RAG search for PDF documents
   * OPTIMIZED: Skip RAG by default since FAQ vector search handles most queries
   * Only use RAG when query explicitly references documents/PDFs
   */
  private shouldUseRAGSearch(userMessage: string): boolean {
    const cleanMessage = userMessage.toLowerCase().trim();
    
    // Skip RAG for short queries
    if (cleanMessage.length < 15) {
      return false;
    }

    // ONLY run RAG for queries that explicitly reference documents/PDFs
    const documentKeywords = [
      'document', 'pdf', 'file', 'uploaded', 'training document',
      'section', 'chapter', 'page', 'quote', 'said in the document',
      'according to the document', 'from the pdf', 'in the file'
    ];

    // Check if query explicitly references documents
    const referencesDocument = documentKeywords.some(keyword => cleanMessage.includes(keyword));
    
    if (referencesDocument) {
      console.log('[RAG Strategy] Query references documents - will use RAG');
      return true;
    }

    // DEFAULT: Skip RAG - FAQ vector search handles general queries
    return false;
  }

  /**
   * Add RAG-retrieved document chunks to context based on user's query
   * This runs outside the cache to use the current message for semantic search
   */
  private async addRAGContext(
    userMessage: string,
    businessAccountId: string
  ): Promise<string> {
    if (!userMessage || userMessage.trim().length < 5) {
      console.log(`[RAG] Skipping - message too short (${userMessage.trim().length} chars)`);
      return '';
    }

    // TopScholar account answers exclusively from the external curriculum API
    // (fetch_k12_topic). Skip the general document/URL vector search entirely
    // so it neither adds noise nor wastes latency. No other account is affected.
    if (isTopscholarAccount(businessAccountId)) {
      console.log('[RAG] Skipping general vector search — TopScholar account uses external curriculum only');
      return '';
    }

    try {
      console.log(`[RAG] Starting search for query: "${userMessage.substring(0, 80)}..."`);
      
      // Perform semantic search for relevant document chunks
      const relevantChunks = await vectorSearchService.search(
        userMessage,
        businessAccountId,
        5, // Top 5 chunks
        0.50 // 50% similarity threshold (lowered from 70% for better recall)
      );

      console.log(`[RAG] Search completed - found ${relevantChunks.length} chunks`);

      if (relevantChunks.length === 0) {
        console.log('[RAG] No relevant document chunks found for query');
        return '';
      }

      // Build RAG context from chunks
      let ragContext = `\n🔒 CRITICAL DOCUMENT KNOWLEDGE - HIGHEST PRIORITY:\n`;
      ragContext += `The following information was found in your business's training documents via semantic search.\n`;
      ragContext += `This is BUSINESS-SPECIFIC information that you MUST use to answer questions.\n\n`;

      relevantChunks.forEach((chunk, idx) => {
        ragContext += `[Document Excerpt ${idx + 1} from ${chunk.documentName}]:\n`;
        ragContext += `${chunk.chunkText}\n\n`;
      });

      ragContext += `🚨 MANDATORY INSTRUCTION:\n`;
      ragContext += `- The above document excerpts are BUSINESS-SPECIFIC knowledge provided by the business owner\n`;
      ragContext += `- You MUST use this information to answer the current question\n`;
      ragContext += `- This is NOT general knowledge - this is specific business documentation\n`;
      ragContext += `- Answer questions about this content naturally and accurately\n`;
      ragContext += `- Do NOT say "I don't have information" when the answer is clearly in the excerpts above\n\n`;

      console.log(`[RAG] Added ${relevantChunks.length} relevant chunks to context (avg similarity: ${(relevantChunks.reduce((sum, c) => sum + c.similarity, 0) / relevantChunks.length * 100).toFixed(1)}%)`);

      return ragContext;
    } catch (error: any) {
      console.error('[RAG] Error retrieving chunks:', error);
      return ''; // Fail gracefully - don't break chat if RAG fails
    }
  }
}

export const chatService = new ChatService();
