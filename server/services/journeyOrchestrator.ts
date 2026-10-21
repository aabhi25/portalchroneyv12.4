import { journeyService, type JourneyState } from './journeyService';
import { conversationMemory } from '../conversationMemory';
import { createOpenAI, OPENAI_TIMEOUTS } from "../lib/openaiClient";
import { validatePhoneNumber } from '../../shared/validation/phone';
import { autoFillKnownSteps, contactSlot, describeFilled, loadKnownAnswers, type KnownAnswer } from './journeyKnownAnswers';
import { emailInMessage, extractPhoneCandidates, isDecline, isValidEmail, isValidLeadName, nameInMessage } from './leadCapture/detectors';
import { phoneModeFor } from './leadCapture/fields';
import { upsertConversationLead } from './leadCapture/leadStore';
import { syncConversationLeadIfReady } from './leadCapture/crmGate';
import { applyMidChatPhoneGate } from './leadCapture/phoneGate';

/**
 * Journey Orchestrator - Unified middleware for conversation journey handling
 * Used by both text chat (processMessage) and voice mode (streamMessage)
 */

export interface FormStepData {
  stepId: string;
  questionText: string;
  questionType: string;
  isRequired: boolean;
  options?: string[];
  placeholder?: string;
  stepType?: string;
  journeyId?: string; // Include journey ID so client can track active journey
  conversationId?: string; // Include conversation ID so client can use correct conversation for form step submission
}

export interface JourneyResult {
  isJourneyActive: boolean;
  // For form journeys triggered by keyword, include form step data for visual UI
  formStep?: FormStepData;
  // AI-guided journeys: AI handles conversation via tools, no canned responses
  // JourneyOrchestrator only manages state (refusals, answer quality, etc.)
}

// PERFORMANCE: Track whether we've already checked for active journeys this request
// This prevents redundant journey checks within the same chat message
interface JourneyCheckCache {
  businessAccountId: string;
  hasActiveJourneys: boolean;
  timestamp: number;
}

/**
 * Configurable refusal patterns - can be extended or moved to database/config
 * Common patterns for detecting when users decline to answer questions
 */
const REFUSAL_PATTERNS = [
  /^no$/,
  /^nope$/,
  /^nah$/,
  /^skip$/,
  /^pass$/,
  /^next$/,
  /no thanks/,
  /no,?\s*thanks/,
  /no thank you/,
  /maybe later/,
  /not now/,
  /not right now/,
  /not at this time/,
  /i don'?t want/,
  /don'?t want to/,
  /prefer not/,
  /rather not/,
  /won'?t share/,
  /can'?t share/,
  /not comfortable/,
  /not interested/,
  /don'?t need/,
  /no need/,
];

/**
 * Vague/incomplete answer patterns - for quality validation
 * Detects low-quality responses that should trigger clarification
 */
const VAGUE_RESPONSE_PATTERNS = [
  /^idk$/,
  /^dunno$/,
  /^maybe$/,
  /^later$/,
  /^hmm$/,
  /^uh$/,
  /^um$/,
  /i don'?t know/,
  /don'?t know/,
  /not sure/,
  /can'?t remember/,
  /don'?t remember/,
  /will tell you later/,
  /tell you later/,
  /later maybe/,
  /maybe later/,
  /^na$/,
  /^nvm$/,
  /never mind/,
];

/**
 * Configurable contact-related keywords - can be extended or moved to database/config
 * Used to identify questions related to contact information or scheduling
 */
const CONTACT_KEYWORDS = [
  'connect',
  'reach',
  'contact',
  'call',
  'phone',
  'number',
  'email',
  'schedule',
  'appointment',
  'time to',
  'best time',
  'good time',
  'when can',
  'how can we',
  'get in touch',
  'reach you',
  'reach out',
  'reach back',
  'follow up',
  'loop back',
  'touch base',
  'email address',
  'call back',
  'text',
  'message',
  'whatsapp',
  'telegram',
  'sms',
  'availability',
];

/**
 * FEATURE 1: Answer Quality Validation
 * Detect if a user response is vague/incomplete
 */
function isVagueResponse(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"()\-…]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
    
  return VAGUE_RESPONSE_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Detect if a user message is a refusal/opt-out
 * Strips punctuation, emojis, and symbols to catch variants like "No.", "No!", "No 🙂", "No..."
 */
function isRefusal(message: string): boolean {
  // Remove punctuation, emojis, and extra whitespace
  let normalized = message
    .toLowerCase()
    .trim();
  
  // Remove common punctuation and symbols
  normalized = normalized.replace(/[.,!?;:'"()\-…]/g, '');
  
  // Remove emojis and other non-alphanumeric characters (except spaces)
  normalized = normalized.replace(/[^\w\s]/g, '');
  
  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();
    
  return REFUSAL_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Detect if a journey step is contact-related (lead capture or follow-up)
 * Checks tool trigger AND question text for contact keywords
 */
function isContactRelatedStep(step: any): boolean {
  // Steps with capture_lead trigger are definitely contact-related
  if (step.toolTrigger === 'capture_lead') {
    return true;
  }
  
  // Check question text for contact-related keywords (case-insensitive)
  const questionLower = (step.questionText || '').toLowerCase();
  return CONTACT_KEYWORDS.some(keyword => questionLower.includes(keyword));
}

/**
 * Entity extraction response schema for engine-driven journeys
 */
interface EntityExtractionResult {
  answer: string | null;
  /** Set when a contact answer was given but is not valid (e.g. a fake / short mobile number). */
  validationMessage?: string;
  is_off_topic: boolean;
  is_refusal: boolean;
  quality: 'valid' | 'needs_clarification' | 'invalid';
  brief_offtopic_answer: string | null;
  extracted_entities?: {
    name?: string;
    email?: string;
    phone?: string;
    [key: string]: any;
  };
}

/**
 * Engine-driven journey response
 */
interface EngineJourneyResponse {
  shouldBypassAI: boolean;
  response?: string;
  isComplete?: boolean;
  /** A mobile number saved by this journey locked the chat until the visitor passes the CAPTCHA. */
  captchaRequired?: boolean;
  /** Conversational journey finished: the visitor's question that started it (the AI answers it). */
  handoffQuestion?: string;
  /** Conversational journey finished: instructions for the AI's reply (answers collected, what to answer). */
  handoffNote?: string;
  formStep?: FormStepData; // For form journeys, include form step data for visual UI
  // For conversational journeys, surface dropdown/radio choices as quick-reply buttons
  options?: string[];
}

/**
 * Parse a journey step's stored multiple-choice options into a string array.
 * Returns undefined unless the step is a dropdown/radio with valid options.
 */
function parseStepChoiceOptions(step: any): string[] | undefined {
  if (!step) return undefined;
  if (step.questionType !== 'radio' && step.questionType !== 'dropdown') return undefined;
  if (!step.multipleChoiceOptions) return undefined;
  try {
    const parsed = JSON.parse(step.multipleChoiceOptions);
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter((o: any) => typeof o === 'string' && o.trim().length > 0);
      return cleaned.length > 0 ? cleaned : undefined;
    }
  } catch (e) {
    console.error('[Engine] Failed to parse choice options:', e);
  }
  return undefined;
}

/** A step the visitor doesn't answer after this many tries is left behind (never asked forever). */
const MAX_STEP_ATTEMPTS = 2;
/** After this many off-topic questions in one journey, the journey ends and the AI answers normally. */
const MAX_OFF_TOPIC = 2;

const NOT_A_NAME_ANSWER = new Set([
  'yes', 'yeah', 'yep', 'no', 'nope', 'ok', 'okay', 'k', 'sure', 'hi', 'hii', 'hello', 'hey', 'thanks', 'thank', 'what', 'why', 'how',
  'when', 'where', 'who', 'which', 'can', 'could', 'please', 'tell', 'show', 'give', 'send', 'fees', 'fee', 'price', 'cost', 'course',
  'details', 'info', 'haan', 'nahi', 'kya', 'kyu', 'kyun', 'hmm', 'skip', 'later',
]);

/** A name typed as the answer to "what's your name?" ("Rahul", "rahul sharma", "My name is Priya", "राहुल"). */
export function nameAnswer(message: string): string | null {
  const stated = nameInMessage(message);
  if (stated) return stated;
  const t = message.trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
  if (t.length < 2 || t.length > 40 || /[\d?@]/.test(t) || isDecline(t)) return null;
  if (!new RegExp(String.raw`^[\p{L}\p{M}][\p{L}\p{M}.' -]*$`, 'u').test(t)) return null;
  const words = t.split(' ');
  if (words.length > 4 || NOT_A_NAME_ANSWER.has(words[0].toLowerCase())) return null;
  return words.map(w => /^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
}

/** Does the visitor's message contain this (already saved) answer? Phones compare on the last 10 digits. */
function messageContainsAnswer(message: string, answer: string): boolean {
  const digits = answer.replace(/\D/g, '');
  if (digits.length >= 7) return message.replace(/\D/g, '').includes(digits.slice(-10));
  return !!answer.trim() && message.toLowerCase().includes(answer.trim().toLowerCase());
}

function phoneProblemMessage(mode: string): string {
  const rule = mode === '10' ? 'a 10-digit mobile number' : mode === '12' ? 'the mobile number with the country code (12 digits)' : 'a valid mobile number';
  return `That doesn't look like a valid mobile number. Could you share ${rule}?`;
}

export class JourneyOrchestrator {
  /**
   * Helper method to get OpenAI client with business account API key
   */
  private async getOpenAIClient(businessAccountId: string) {
    const storage = (await import('../storage')).storage;
    const businessAccount = await storage.getBusinessAccount(businessAccountId);
    
    const apiKey = businessAccount?.openaiApiKey || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured for this business account');
    }
    
    return createOpenAI({ businessAccountId, timeout: OPENAI_TIMEOUTS.chat, apiKey });
  }

  /**
   * ENGINE-DRIVEN MODE: Process user message through strict state machine
   * Returns a complete response if the engine handles it, or null to continue with AI
   *
   * Questions whose answer this chat already holds (the lead's mobile / name / email, answers to
   * earlier journeys) are skipped (journeyKnownAnswers). A step the visitor doesn't answer after
   * two tries is left behind instead of being asked forever; a visitor who keeps asking other
   * things gets the normal AI. When a conversational journey ends, the AI replies to the
   * question that started it (handoffQuestion / handoffNote).
   */
  async processUserMessageEngineDriven(
    conversationId: string,
    userId: string,
    businessAccountId: string,
    userMessage: string,
    opts: { channel?: string | null } = {}
  ): Promise<EngineJourneyResponse> {
    try {
      // Check if a conversation journey is active
      const journeyState = await journeyService.getOrStartJourney(conversationId, userId, businessAccountId, userMessage);
      
      if (!journeyState || journeyState.completed) {
        // No active journey - let AI handle normally
        return { shouldBypassAI: false };
      }

      console.log('[Engine] Journey active - processing through state machine');

      // Skip questions already answered in this chat (e.g. the mobile number saved by lead capture
      // while the CAPTCHA was open, or a detail another journey already asked for).
      const isFirstInteraction = journeyState.awaitingFirstUserResponse;
      if (isFirstInteraction) {
        await journeyService.markJourneyPrompted(conversationId);
        journeyState.triggerMessage ??= userMessage;
      }
      const prefill = await autoFillKnownSteps(conversationId, businessAccountId);
      const currentStep = await journeyService.getCurrentStep(conversationId);
      
      if (!currentStep) {
        // Nothing left to ask (everything was already known, or the journey had ended).
        return this.finishJourney(conversationId, journeyState, businessAccountId, opts);
      }

      // First interaction - ask the first question
      if (isFirstInteraction) {
        // For FORM journeys, return form step data for visual UI instead of text question
        if (journeyState.journeyType === 'form') {
          console.log('[Engine] Form journey first interaction - returning form step data');
          
          // Parse options if this is a dropdown/radio step
          let options: string[] | undefined;
          if ((currentStep.questionType === 'radio' || currentStep.questionType === 'dropdown') && currentStep.multipleChoiceOptions) {
            try {
              options = JSON.parse(currentStep.multipleChoiceOptions);
            } catch (e) {
              console.error('[Engine] Failed to parse choice options:', e);
            }
          }
          
          return {
            shouldBypassAI: true,
            response: "Great! Let me help you with that. Please select from the options below:",
            formStep: {
              stepId: currentStep.id,
              questionText: currentStep.questionText || '',
              questionType: currentStep.questionType || 'text',
              isRequired: currentStep.isRequired === 'true',
              options,
              placeholder: currentStep.placeholderText || undefined,
              stepType: currentStep.toolTrigger || undefined,
              journeyId: journeyState.journeyId
            }
          };
        }
        
        // For conversational journeys, use AI to rephrase question naturally
        const rephrasedQuestion = await this.rephraseQuestion(currentStep.questionText || '', businessAccountId);
        
        return {
          shouldBypassAI: true,
          response: rephrasedQuestion,
          options: parseStepChoiceOptions(currentStep)
        };
      }

      if (prefill.filled.length > 0) {
        // The question the visitor was answering is already known. When THIS message is that
        // answer (their number, saved by the chat's lead capture as it arrived), acknowledge it and
        // ask the next question; otherwise their message answers the next question.
        const last = prefill.filled[prefill.filled.length - 1];
        if (prefill.filled.some(f => messageContainsAnswer(userMessage, f.answer))) {
          console.log('[Engine] This message answered the current step (already saved by lead capture) - asking the next question');
          return this.continueJourney(conversationId, journeyState, businessAccountId, userMessage, {
            situation: 'acknowledgment', answeredQuestion: last.question, answer: last.answer,
          }, opts);
        }
        console.log('[Engine] Current step was already answered elsewhere in the chat - moved to the next question');
      }

      // Extract the answer: contact details deterministically, anything else via constrained NLU
      const extraction = await this.extractAnswer(
        userMessage,
        currentStep,
        businessAccountId
      );

      console.log('[Engine] Extraction result:', extraction);

      // Build context for natural responses (journey name, business, previous answers)
      const responseContext = await this.buildResponseContext(conversationId, journeyState, businessAccountId);
      const attempts = (journeyState.stepAttempts ??= {});
      const failedAttempt = () => (attempts[currentStep.id] = (attempts[currentStep.id] || 0) + 1);

      // Handle refusals FIRST (more important than off-topic)
      // If someone says "not interested", that's a refusal, not off-topic
      if (extraction.is_refusal) {
        if (currentStep.isRequired === 'true') {
          if (failedAttempt() >= MAX_STEP_ATTEMPTS) {
            return this.moveOnFromStep(conversationId, journeyState, businessAccountId, currentStep, userMessage, opts);
          }
          // Generate natural response for required step refusal
          const naturalResponse = await this.generateNaturalResponse(
            'refusal',
            userMessage,
            currentStep.questionText || '',
            {
              isRequired: true,
              ...responseContext
            },
            businessAccountId
          );
          
          return {
            shouldBypassAI: true,
            response: naturalResponse,
            options: parseStepChoiceOptions(currentStep)
          };
        }
        // Skip optional step
        console.log('[Engine] Optional step skipped due to refusal');
        return this.moveOnFromStep(conversationId, journeyState, businessAccountId, currentStep, userMessage, opts);
      }

      // Handle off-topic interrupts (after refusals)
      // These are genuine questions not related to the current step
      if (extraction.is_off_topic) {
        journeyState.offTopicCount = (journeyState.offTopicCount || 0) + 1;
        if (journeyState.offTopicCount >= MAX_OFF_TOPIC) {
          // The visitor keeps asking other things: stop the questions and let the AI answer.
          console.log('[Engine] Visitor keeps asking other things - ending the journey, AI answers normally');
          await journeyService.completeJourney(conversationId);
          await this.captureLeadFromJourney(conversationId, journeyState, businessAccountId, opts.channel);
          return { shouldBypassAI: false, isComplete: true };
        }
        // Generate natural off-topic response with redirect
        const naturalResponse = await this.generateNaturalResponse(
          'off_topic',
          userMessage,
          currentStep.questionText || '',
          {
            briefAnswer: extraction.brief_offtopic_answer || undefined,
            ...responseContext
          },
          businessAccountId
        );
        
        return {
          shouldBypassAI: true,
          response: naturalResponse,
          options: parseStepChoiceOptions(currentStep)
        };
      }

      // Validate answer format (email, phone, etc.)
      const validationResult = extraction.validationMessage
        ? { valid: false, message: extraction.validationMessage }
        : extraction.answer
          ? await this.validateAnswer(extraction.answer, currentStep, businessAccountId)
          : { valid: true };

      if (!validationResult.valid) {
        if (failedAttempt() >= MAX_STEP_ATTEMPTS) {
          return this.moveOnFromStep(conversationId, journeyState, businessAccountId, currentStep, userMessage, opts);
        }
        // Generate natural validation error response
        const naturalResponse = await this.generateNaturalResponse(
          'validation_error',
          userMessage,
          currentStep.questionText || '',
          {
            validationMessage: validationResult.message,
            ...responseContext
          },
          businessAccountId
        );
        
        return {
          shouldBypassAI: true,
          response: naturalResponse,
          options: parseStepChoiceOptions(currentStep)
        };
      }

      // Validate answer quality
      if (extraction.quality === 'invalid' || extraction.quality === 'needs_clarification' || !extraction.answer) {
        if (failedAttempt() >= MAX_STEP_ATTEMPTS) {
          return this.moveOnFromStep(conversationId, journeyState, businessAccountId, currentStep, userMessage, opts);
        }
        // Generate natural clarification request
        const naturalResponse = await this.generateNaturalResponse(
          'clarification',
          userMessage,
          currentStep.questionText || '',
          responseContext,
          businessAccountId
        );
        
        return {
          shouldBypassAI: true,
          response: naturalResponse,
          options: parseStepChoiceOptions(currentStep)
        };
      }

      // Record valid answer
      const { db } = await import('../db');
      const { journeyResponses } = await import('../../shared/schema');
      const answer = extraction.answer;
      
      journeyState.responses.set(currentStep.id, answer);
      
      try {
        await db.insert(journeyResponses).values({
          sessionId: journeyState.sessionId,
          journeyId: journeyState.journeyId,
          conversationId: conversationId,
          stepId: currentStep.id,
          response: answer,
        });
      } catch (error: any) {
        // Ignore duplicate errors
        if (!error.message?.includes('duplicate')) {
          console.error('[Engine] Error saving response:', error);
        }
      }

      console.log('[Engine] Recorded answer for step:', currentStep.id);

      // A contact answer goes to this chat's lead right away (same lead, checks and CRM rules as chat).
      const contact = await this.saveJourneyContact(conversationId, businessAccountId, currentStep, answer, journeyState, opts.channel);

      // Advance to next step
      await journeyService.advanceToNextStep(conversationId);
      return this.continueJourney(conversationId, journeyState, businessAccountId, userMessage, {
        situation: 'acknowledgment',
        answeredQuestion: currentStep.questionText || '',
        answer,
        captchaRequired: contact.captchaRequired,
      }, opts);
      
    } catch (error) {
      console.error('[Engine] Error in engine-driven journey:', error);
      // Fall back to AI on error
      return { shouldBypassAI: false };
    }
  }

  /**
   * After a step: skip what is already known, then ask the next question (or finish the journey).
   */
  private async continueJourney(
    conversationId: string,
    journeyState: JourneyState,
    businessAccountId: string,
    userMessage: string,
    turn: { situation: 'acknowledgment' | 'skip'; answeredQuestion?: string; answer?: string; captchaRequired?: boolean },
    opts: { channel?: string | null }
  ): Promise<EngineJourneyResponse> {
    const fill = await autoFillKnownSteps(conversationId, businessAccountId);
    const nextStep = await journeyService.getCurrentStep(conversationId);
    if (!nextStep) {
      const done = await this.finishJourney(conversationId, journeyState, businessAccountId, opts);
      return { ...done, captchaRequired: turn.captchaRequired || done.captchaRequired };
    }

    // For FORM journeys, return next step's form_step data for visual UI
    if (journeyState.journeyType === 'form') {
      console.log('[Engine] Form journey - returning next form step data');
      
      // Parse options if this is a dropdown/radio step
      let options: string[] | undefined;
      if ((nextStep.questionType === 'radio' || nextStep.questionType === 'dropdown') && nextStep.multipleChoiceOptions) {
        try {
          options = JSON.parse(nextStep.multipleChoiceOptions);
        } catch (e) {
          console.error('[Engine] Failed to parse choice options:', e);
        }
      }
      
      return {
        shouldBypassAI: true,
        response: "Great choice! Please continue with the next question:",
        captchaRequired: turn.captchaRequired,
        formStep: {
          stepId: nextStep.id,
          questionText: nextStep.questionText || '',
          questionType: nextStep.questionType || 'text',
          isRequired: nextStep.isRequired === 'true',
          options,
          placeholder: nextStep.placeholderText || undefined,
          stepType: nextStep.toolTrigger || undefined,
          journeyId: journeyState.journeyId // Include for client to track active journey
        }
      };
    }

    // For conversational journeys, generate natural acknowledgment + next question
    const responseContext = await this.buildResponseContext(conversationId, journeyState, businessAccountId);
    const naturalResponse = await this.generateNaturalResponse(
      turn.situation,
      userMessage,
      nextStep.questionText || '',
      {
        ...responseContext,
        answeredQuestion: turn.answeredQuestion,
        answer: turn.answer,
        skippedInfo: fill.filled.length ? describeFilled(fill.filled) : undefined,
      },
      businessAccountId
    );
    
    return {
      shouldBypassAI: true,
      response: naturalResponse,
      options: parseStepChoiceOptions(nextStep),
      captchaRequired: turn.captchaRequired,
    };
  }

  /** Leave an unanswered step behind (declined, or no usable answer after two tries) and go on. */
  private async moveOnFromStep(
    conversationId: string,
    journeyState: JourneyState,
    businessAccountId: string,
    step: any,
    userMessage: string,
    opts: { channel?: string | null }
  ): Promise<EngineJourneyResponse> {
    console.log('[Engine] Moving on from an unanswered step:', step.id);
    journeyState.responses.set(step.id, '[SKIPPED: not answered]');
    await journeyService.advanceToNextStep(conversationId);
    return this.continueJourney(conversationId, journeyState, businessAccountId, userMessage, { situation: 'skip' }, opts);
  }

  /** The journey has no question left: save the lead details and hand back. */
  private async finishJourney(
    conversationId: string,
    journeyState: JourneyState,
    businessAccountId: string,
    opts: { channel?: string | null }
  ): Promise<EngineJourneyResponse> {
    await journeyService.completeJourney(conversationId);
    await this.captureLeadFromJourney(conversationId, journeyState, businessAccountId, opts.channel);

    if (journeyState.journeyType === 'form') {
      return {
        shouldBypassAI: true,
        response: "Perfect! Thank you for providing all the information. Our team will review your responses and get in touch with you soon.",
        isComplete: true
      };
    }

    // CONVERSATIONAL journeys hand control back to the AI so it gives a genuinely helpful,
    // contextual reply to what the visitor asked before the questions (not to their last answer).
    console.log('[Engine] Conversational journey complete - handing off to AI for a contextual response');
    const { previousAnswers } = await this.buildResponseContext(conversationId, journeyState, businessAccountId);
    const known = await loadKnownAnswers(conversationId, businessAccountId).catch(() => new Map<string, KnownAnswer>());
    const question = journeyState.triggerMessage?.trim() || '';
    const handoffNote = [
      '=== QUESTIONS JUST FINISHED ===',
      previousAnswers ? `The visitor has just answered these questions:\n${previousAnswers}` : 'The visitor has just answered your questions.',
      known.has('phone') ? 'The visitor HAS shared their mobile number (it is saved).' : '',
      'Their latest message was an answer to your question, NOT a new question. Do not ask for any of these details again.',
      question
        ? `Now reply to what they asked before the questions: "${question}". If a business instruction says what to reply about this topic, reply with exactly that — it takes priority over saying you will forward the question to the team, and do not add that you lack the information.`
        : 'Thank them briefly and offer further help.',
    ].filter(Boolean).join('\n');
    return {
      shouldBypassAI: false,
      isComplete: true,
      handoffQuestion: question || undefined,
      handoffNote,
    };
  }

  /** The answer to the current step: contact details deterministically, anything else via NLU. */
  private async extractAnswer(userMessage: string, step: any, businessAccountId: string): Promise<EntityExtractionResult> {
    const slot = contactSlot(step);
    const message = userMessage.trim();
    const valid = (answer: string): EntityExtractionResult => ({ answer, is_off_topic: false, is_refusal: false, quality: 'valid', brief_offtopic_answer: null });
    if (slot === 'phone') {
      const candidates = extractPhoneCandidates(message);
      if (candidates.length > 0) {
        const mode = await this.phoneMode(businessAccountId);
        for (const c of candidates) {
          const r = validatePhoneNumber(c.raw, mode);
          if (r.isValid) return valid(r.normalized);
        }
        return { answer: null, is_off_topic: false, is_refusal: false, quality: 'invalid', brief_offtopic_answer: null, validationMessage: phoneProblemMessage(mode) };
      }
    } else if (slot === 'email') {
      const email = emailInMessage(message);
      if (email) return valid(email);
    } else if (slot === 'name') {
      const name = nameAnswer(message);
      if (name) return valid(name);
    }
    return this.extractEntityFromMessage(userMessage, step, businessAccountId);
  }

  private async phoneMode(businessAccountId: string) {
    const storage = (await import('../storage')).storage;
    const ws = await storage.getWidgetSettings(businessAccountId);
    return phoneModeFor(ws?.leadTrainingConfig);
  }

  /** Form journeys (POST /api/journey/submit-step): save a contact answer exactly like a chat journey does. */
  async saveFormJourneyContact(conversationId: string, businessAccountId: string, step: any, answer: string, channel?: string | null): Promise<{ captchaRequired: boolean }> {
    return this.saveJourneyContact(conversationId, businessAccountId, step, answer, null, channel);
  }

  /**
   * A journey answer that is a contact detail is saved on this conversation's lead (one lead per
   * chat, returning-visitor reuse), then gets the mobile field's OTP / CAPTCHA check and the
   * usual CRM rule (sent once every mandatory field is in and verification passed).
   */
  private async saveJourneyContact(
    conversationId: string,
    businessAccountId: string,
    step: any,
    answer: string,
    journeyState: JourneyState | null,
    channel?: string | null
  ): Promise<{ captchaRequired: boolean }> {
    const slot = contactSlot(step);
    if (!slot || !answer || conversationId.startsWith('temp_')) return { captchaRequired: false };
    try {
      const storage = (await import('../storage')).storage;
      const ws = await storage.getWidgetSettings(businessAccountId);
      const leadConfig = ws?.leadTrainingConfig as any;
      const values: { phone?: string; email?: string; name?: string } = {};
      if (slot === 'phone') {
        const r = validatePhoneNumber(answer, phoneModeFor(leadConfig));
        if (!r.isValid) return { captchaRequired: false };
        values.phone = r.normalized;
      } else if (slot === 'email') {
        if (!isValidEmail(answer)) return { captchaRequired: false };
        values.email = answer.trim().toLowerCase();
      } else {
        if (!isValidLeadName(answer)) return { captchaRequired: false };
        values.name = answer.trim();
      }
      const up = await upsertConversationLead({ businessAccountId, conversationId, values });
      if (journeyState) journeyState.leadId = up.lead.id;
      if (up.changed.length === 0) return { captchaRequired: false };
      console.log(`[Journey Lead] ${up.created ? 'Created' : 'Updated'} lead ${up.lead.id}: ${up.changed.join(', ')}`);
      let captchaRequired = false;
      if (up.changed.includes('phone') && up.lead.phone) {
        const gate = await applyMidChatPhoneGate({ businessAccountId, conversationId, leadId: up.lead.id, phone: up.lead.phone, leadConfig, channel });
        captchaRequired = gate.captchaLocked;
      }
      syncConversationLeadIfReady({ leadId: up.lead.id, businessAccountId, conversationId, changedFields: up.changed, channel, source: 'journey' })
        .catch(err => console.error('[Journey Lead] CRM sync failed:', err));
      return { captchaRequired };
    } catch (error) {
      console.error('[Journey Lead] Could not save the contact answer:', error);
      return { captchaRequired: false };
    }
  }

  /**
   * Process a user message through the journey system
   * Returns journey response if journey is active, otherwise indicates normal flow should continue
   */
  async processUserMessage(
    conversationId: string,
    userId: string,
    businessAccountId: string,
    userMessage: string
  ): Promise<JourneyResult> {
    try {
      // Check if a conversation journey is active, or trigger by keyword
      const journeyState = await journeyService.getOrStartJourney(conversationId, userId, businessAccountId, userMessage);
      
      if (!journeyState || journeyState.completed) {
        // No active journey - proceed with normal chat flow
        return { isJourneyActive: false };
      }

      // Journey is active
      // Check if this is the very first interaction (journey just started, no question asked yet)
      const isFirstInteraction = journeyState.awaitingFirstUserResponse;
      console.log('[JourneyOrchestrator] Processing message - isFirstInteraction:', isFirstInteraction, 'currentStepIndex:', journeyState.currentStepIndex);
      
      // Check if this journey was triggered by keyword (only true on first interaction)
      const wasTriggeredByKeyword = journeyState.triggeredByKeyword || false;
      
      // AI-GUIDED MODE: Skip auto-recording - AI will use record_journey_answer tool
      // This prevents duplicate submissions and gives AI control over answer quality
      if (!isFirstInteraction) {
        // Get the step user is answering to check for refusals/vague responses
        const stepBeingAnswered = await journeyService.getCurrentStep(conversationId);
        
        // FEATURE 1: Answer Quality Validation - Detect vague/incomplete responses
        // AI-GUIDED MODE: Log detection but let AI handle via tools
        if (isVagueResponse(userMessage)) {
          console.log('[Quality Check] Vague response detected - AI should request clarification:', userMessage);
          // AI will see this in logs and can ask for clarification naturally
        }
        
        // AI-GUIDED MODE: Removed auto-recording and smart inference
        // AI will use record_journey_answer tool to record answers
        // AI will handle refusals and skipping via skip_journey_step tool
      } else {
        console.log('[JourneyOrchestrator] This is the first interaction - AI will ask first question');
      }
      
      // AI-GUIDED MODE: Removed automatic duplicate detection and question skipping
      // AI will handle these intelligently via conversation context and tools
      
      // Get the current/next journey question (after skipping known answers)
      const currentStep = await journeyService.getCurrentStep(conversationId);
      console.log('[JourneyOrchestrator] Current step:', currentStep?.questionText?.substring(0, 50) || 'null', 'stepOrder:', currentStep?.stepOrder);
      
      // Mark that we've asked the first question (so next message will record response)
      if (isFirstInteraction && currentStep) {
        console.log('[JourneyOrchestrator] Marking journey as prompted (first question will be asked now)');
        await journeyService.markJourneyPrompted(conversationId);
      }
      
      if (currentStep) {
        // AI-GUIDED MODE: Journey active, AI will use get_journey_progress tool to see question and ask it naturally
        console.log('[JourneyOrchestrator] Journey active with question:', currentStep.questionText?.substring(0, 50));
        
        // For FORM journeys triggered by keyword, return form step data for visual UI
        // This ensures the first question is rendered as a form field, not AI text
        if (wasTriggeredByKeyword && journeyState.journeyType === 'form') {
          console.log('[JourneyOrchestrator] Form journey triggered by keyword - returning form step data');
          
          // Parse options if this is a dropdown/radio step
          let options: string[] | undefined;
          if ((currentStep.questionType === 'radio' || currentStep.questionType === 'dropdown') && currentStep.multipleChoiceOptions) {
            try {
              options = JSON.parse(currentStep.multipleChoiceOptions);
            } catch (e) {
              console.error('[JourneyOrchestrator] Failed to parse choice options:', e);
            }
          }
          
          return {
            isJourneyActive: true,
            formStep: {
              stepId: currentStep.id,
              questionText: currentStep.questionText || '',
              questionType: currentStep.questionType || 'text',
              isRequired: currentStep.isRequired === 'true',
              options,
              placeholder: currentStep.placeholderText || undefined,
              stepType: currentStep.toolTrigger || undefined,
              journeyId: journeyState.journeyId
            }
          };
        }
        
        return { isJourneyActive: true };
      } else {
        // Journey completed - AI will handle completion message naturally
        console.log('[JourneyOrchestrator] Journey completed - all questions answered');
        await journeyService.completeJourney(conversationId);
        return { isJourneyActive: false };
      }
    } catch (error) {
      console.error('[JourneyOrchestrator] Error processing user message:', error);
      // On error, continue with normal flow
      return { isJourneyActive: false };
    }
  }

  /**
   * FEATURE 2: Smart Answer Inference
   * Extracts multiple pieces of information from a single user response
   * Returns map of stepId -> extracted answer
   */
  private async extractMultipleAnswers(
    userMessage: string,
    conversationId: string,
    businessAccountId: string
  ): Promise<Map<string, string>> {
    try {
      const journeyState = await journeyService.getJourneyState(conversationId);
      if (!journeyState || journeyState.completed) {
        return new Map();
      }

      const storage = (await import('../storage')).storage;
      const openai = await this.getOpenAIClient(businessAccountId);

      // Get remaining journey steps
      const allSteps = await storage.getJourneySteps(journeyState.journeyId);
      const sortedSteps = allSteps.sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));
      const remainingSteps = sortedSteps.slice(journeyState.currentStepIndex);

      if (remainingSteps.length === 0) {
        return new Map();
      }

      // Build prompt for AI to extract multiple answers
      const questionsToCheck = remainingSteps.slice(0, 5).map(step => ({
        id: step.id,
        question: step.questionText
      }));

      const extractionPrompt = `Analyze the user's response and extract answers to multiple questions if present:

User Response: "${userMessage}"

Questions to check:
${questionsToCheck.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}

For each question that can be answered from the user's response, extract the answer.
Respond with JSON:
{
  "extracted": [
    { "questionIndex": 0, "answer": "extracted answer" },
    ...
  ]
}

Only include questions that are CLEARLY answered in the response. Be strict.`;

      const extractionResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at extracting structured information from text. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: extractionPrompt
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const extraction = JSON.parse(extractionResponse.choices[0].message.content || '{"extracted": []}');
      const extractedAnswers = new Map<string, string>();

      if (extraction.extracted && Array.isArray(extraction.extracted)) {
        for (const item of extraction.extracted) {
          const questionIndex = item.questionIndex;
          if (questionIndex !== undefined && questionIndex < questionsToCheck.length) {
            const stepId = questionsToCheck[questionIndex].id;
            extractedAnswers.set(stepId, item.answer);
          }
        }
      }

      if (extractedAnswers.size > 0) {
        console.log(`[Smart Inference] Extracted ${extractedAnswers.size} answers from single response`);
      }

      return extractedAnswers;
    } catch (error) {
      console.error('[Smart Inference] Error extracting multiple answers:', error);
      return new Map();
    }
  }

  /**
   * FEATURE 3A: Check and Handle Duplicate Contacts
   * Analyzes conversation for contact info and checks if user is returning
   */
  private async checkAndHandleDuplicateContact(
    conversationId: string,
    userId: string,
    businessAccountId: string
  ): Promise<void> {
    try {
      const storage = (await import('../storage')).storage;
      const openai = await this.getOpenAIClient(businessAccountId);

      // Get conversation history to extract potential contact info
      const messages = await storage.getMessagesByConversation(conversationId, businessAccountId);
      const conversationHistory = messages
        .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n');

      if (!conversationHistory.trim()) {
        return;
      }

      // Use AI to extract email/phone from conversation
      const extractionPrompt = `Extract contact information from the conversation if present:

Conversation:
${conversationHistory}

STRICT RULES:
- Only extract if the user EXPLICITLY provided an email address or phone number
- Do NOT extract names, usernames, or any other information
- Do NOT infer or guess contact details
- If the user only provided their name, return null for both fields

Look for:
- Email address (must be in format: user@domain.com)
- Phone number (any numeric contact number with optional country code, spaces, or dashes)

Respond with JSON:
{
  "email": "extracted email or null",
  "phone": "extracted phone or null"
}`;

      const extractionResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at extracting contact information. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: extractionPrompt
          }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const extraction = JSON.parse(extractionResponse.choices[0].message.content || '{}');
      const { email, phone } = extraction;

      console.log('[Duplicate Detection] Extracted contact info:', { email, phone });

      if (!email && !phone) {
        console.log('[Duplicate Detection] No email/phone found - skipping duplicate check');
        return;
      }

      // Check for duplicate contact
      const existingLead = await this.checkDuplicateContact(businessAccountId, email, phone);

      if (existingLead) {
        console.log('[Duplicate Detection] Returning user detected - auto-filling contact info');
        
        const journeyState = await journeyService.getJourneyState(conversationId);
        if (!journeyState) return;

        // Auto-fill contact information from existing lead
        const allSteps = await storage.getJourneySteps(journeyState.journeyId);
        const { db } = await import('../db');
        const { journeyResponses } = await import('../../shared/schema');

        for (const step of allSteps) {
          const questionLower = (step.questionText || '').toLowerCase();
          let autoFilledValue: string | null = null;

          // Match question to existing lead data
          if (questionLower.includes('name') && existingLead.name) {
            autoFilledValue = existingLead.name;
          } else if (questionLower.includes('email') && existingLead.email) {
            autoFilledValue = existingLead.email;
          } else if ((questionLower.includes('phone') || questionLower.includes('number')) && existingLead.phone) {
            autoFilledValue = existingLead.phone;
          }

          if (autoFilledValue) {
            // Store in memory
            journeyState.responses.set(step.id, autoFilledValue);
            
            // Store in database
            try {
              await db.insert(journeyResponses).values({
                sessionId: journeyState.sessionId,
                journeyId: journeyState.journeyId,
                conversationId,
                stepId: step.id,
                response: autoFilledValue,
              });
              console.log('[Duplicate Detection] Auto-filled:', step.questionText?.substring(0, 40), '→', autoFilledValue);
            } catch (error) {
              // Ignore duplicate errors
            }
          }
        }
      }
    } catch (error) {
      console.error('[Duplicate Detection] Error handling duplicate contact:', error);
    }
  }

  /**
   * FEATURE 3B: Duplicate Contact Detection Helper
   * Checks if user's contact details already exist in leads database
   * Returns existing lead data if found
   */
  private async checkDuplicateContact(
    businessAccountId: string,
    email?: string,
    phone?: string
  ): Promise<any | null> {
    try {
      if (!email && !phone) {
        return null;
      }

      const { db } = await import('../db');
      const { leads } = await import('../../shared/schema');
      const { or, eq, and } = await import('drizzle-orm');

      const conditions: any[] = [eq(leads.businessAccountId, businessAccountId)];
      
      const contactConditions: any[] = [];
      if (email) {
        contactConditions.push(eq(leads.email, email));
      }
      if (phone) {
        contactConditions.push(eq(leads.phone, phone));
      }

      if (contactConditions.length > 0) {
        conditions.push(or(...contactConditions));
      }

      const existingLeads = await db
        .select()
        .from(leads)
        .where(and(...conditions))
        .limit(1);

      if (existingLeads.length > 0) {
        console.log('[Duplicate Detection] Found existing lead:', existingLeads[0].id);
        return existingLeads[0];
      }

      return null;
    } catch (error) {
      console.error('[Duplicate Detection] Error checking for duplicates:', error);
      return null;
    }
  }

  /**
   * Journey finished: make sure every contact answer of this journey is on the chat's lead
   * (normally already saved step by step by saveJourneyContact; this catches answers recorded by
   * the "already known" skip or a restart).
   */
  private async captureLeadFromJourney(
    conversationId: string,
    journeyState: JourneyState,
    businessAccountId: string,
    channel?: string | null
  ): Promise<void> {
    try {
      const { db } = await import('../db');
      const { journeyResponses, journeySteps } = await import('../../shared/schema');
      const { eq } = await import('drizzle-orm');
      if (!journeyState.sessionId) return;
      const responses = await db
        .select({
          response: journeyResponses.response,
          questionText: journeySteps.questionText,
          questionType: journeySteps.questionType,
          fieldName: journeySteps.fieldName,
          crmFieldKey: journeySteps.crmFieldKey,
        })
        .from(journeyResponses)
        .innerJoin(journeySteps, eq(journeyResponses.stepId, journeySteps.id))
        .where(eq(journeyResponses.sessionId, journeyState.sessionId));
      for (const r of responses) {
        if (!r.response || r.response.startsWith('[SKIPPED') || !contactSlot(r)) continue;
        await this.saveJourneyContact(conversationId, businessAccountId, r, r.response, journeyState, channel);
      }
    } catch (error) {
      console.error('[Lead Capture] Error capturing lead from journey:', error);
    }
  }

  /**
   * INTELLIGENT QUESTION SKIPPING
   * Analyzes conversation history using AI to auto-fill journey questions
   * that have already been answered in natural conversation
   * 
   * @param currentUserMessage - Include the current message even if not yet saved to DB (for keyword-triggered journeys)
   */
  private async skipAlreadyAnsweredQuestions(
    conversationId: string,
    userId: string,
    businessAccountId: string,
    currentUserMessage?: string
  ): Promise<void> {
    try {
      const journeyState = await journeyService.getJourneyState(conversationId);
      if (!journeyState || journeyState.completed) {
        return;
      }

      const storage = (await import('../storage')).storage;
      const openai = await this.getOpenAIClient(businessAccountId);

      // Get conversation history (last 20 messages for context)
      const messages = await storage.getMessagesByConversation(conversationId, businessAccountId);
      const recentMessages = messages.slice(-20);

      // CRITICAL FIX: Include current message if provided (for keyword-triggered journeys)
      // When journey is triggered by "online mba", that message isn't in DB yet
      // but we need to analyze it to avoid asking redundant questions
      if (currentUserMessage) {
        recentMessages.push({
          role: 'user',
          content: currentUserMessage,
          createdAt: new Date(),
        } as any);
      }

      if (recentMessages.length === 0) {
        console.log('[Journey Skip] No conversation history - cannot skip questions');
        return;
      }

      // Build conversation history string for AI analysis
      const conversationHistory = recentMessages
        .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n');

      // Get all journey steps
      const allSteps = await storage.getJourneySteps(journeyState.journeyId);
      const sortedSteps = allSteps.sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));

      let skippedCount = 0;
      const maxSkips = 10; // Prevent infinite loops

      // Loop through steps starting from current position
      while (journeyState.currentStepIndex < sortedSteps.length && skippedCount < maxSkips) {
        const currentStep = sortedSteps[journeyState.currentStepIndex];
        
        // Check if answer already exists in conversation using AI
        console.log('[Journey Skip] Checking if question already answered:', currentStep.questionText?.substring(0, 60));
        
        // Build context from both conversation AND previously captured journey responses
        let previouslyCollectedData = '';
        if (journeyState.responses.size > 0) {
          const previousResponses = Array.from(journeyState.responses.entries())
            .map(([stepId, response]) => `- ${response}`)
            .join('\n');
          previouslyCollectedData = `\n\nPreviously Collected Information:\n${previousResponses}`;
        }

        const analysisPrompt = `Analyze the conversation history and previously collected data below to determine if the following question has already been answered:

Question: "${currentStep.questionText}"

Conversation History:
${conversationHistory}${previouslyCollectedData}

IMPORTANT RULES:
1. If the question asks for contact details (name, email, phone number) and you can find this information in either the conversation OR previously collected data, mark it as answered.
2. EXCEPTION: If the question asks specifically for "WhatsApp number", only mark as answered if a WhatsApp number was explicitly provided. A regular phone number does NOT count as a WhatsApp number.
3. Be strict - only mark as answered if the information is explicitly present.

If the answer to this question can be clearly inferred from the available information, respond with JSON:
{
  "answered": true,
  "answer": "the extracted answer"
}

If the question has NOT been answered, respond with JSON:
{
  "answered": false
}
`;

        const analysisResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert at analyzing conversations and extracting information. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: analysisPrompt
            }
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        });

        const analysis = JSON.parse(analysisResponse.choices[0].message.content || '{"answered": false}');

        if (analysis.answered && analysis.answer) {
          // Found answer in conversation history - auto-record and skip
          console.log('[Journey Skip] ✓ Answer found in history:', analysis.answer.substring(0, 60));
          
          // Record the extracted answer
          journeyState.responses.set(currentStep.id, analysis.answer);
          
          // Save to database
          try {
            const { db } = await import('../db');
            const { journeyResponses } = await import('../../shared/schema');
            await db.insert(journeyResponses).values({
              sessionId: journeyState.sessionId,
              journeyId: journeyState.journeyId,
              conversationId,
              stepId: currentStep.id,
              response: analysis.answer,
            });
          } catch (error) {
            console.error('[Journey Skip] Error storing auto-filled response:', error);
          }

          // Move to next question
          journeyState.currentStepIndex++;
          skippedCount++;
          
          // Update database session
          const dbSession = await storage.getJourneySessionByConversationId(conversationId);
          if (dbSession) {
            await storage.updateJourneySession(dbSession.id, {
              currentStepIndex: journeyState.currentStepIndex,
            });
          }
        } else {
          // Question not answered - stop skipping
          console.log('[Journey Skip] Question not yet answered - will ask user');
          break;
        }
      }

      if (skippedCount > 0) {
        console.log(`[Journey Skip] Skipped ${skippedCount} questions using conversation memory`);
      }
    } catch (error) {
      console.error('[Journey Skip] Error during intelligent question skipping:', error);
      // Continue normally if AI analysis fails
    }
  }

  /**
   * Check if a journey is currently active for a conversation
   */
  async isJourneyActive(conversationId: string): Promise<boolean> {
    try {
      const journeyState = await journeyService.getJourneyState(conversationId);
      return journeyState !== null && !journeyState.completed;
    } catch (error) {
      console.error('[JourneyOrchestrator] Error checking journey state:', error);
      return false;
    }
  }

  /**
   * Get the current journey step question without advancing
   */
  async getCurrentQuestion(conversationId: string): Promise<string | null> {
    try {
      const currentStep = await journeyService.getCurrentStep(conversationId);
      return currentStep?.questionText || null;
    } catch (error) {
      console.error('[JourneyOrchestrator] Error getting current question:', error);
      return null;
    }
  }

  /**
   * Manually start a specific journey
   */
  async startJourney(conversationId: string, userId: string, businessAccountId: string, journeyId: string): Promise<string | null> {
    try {
      const state = await journeyService.startJourney(conversationId, userId, businessAccountId, journeyId);
      if (!state) {
        return null;
      }
      
      const firstStep = await journeyService.getCurrentStep(conversationId);
      return firstStep?.questionText || null;
    } catch (error) {
      console.error('[JourneyOrchestrator] Error starting journey:', error);
      return null;
    }
  }

  /**
   * Stop/reset the current journey
   */
  async stopJourney(conversationId: string): Promise<void> {
    try {
      await journeyService.resetJourney(conversationId);
    } catch (error) {
      console.error('[JourneyOrchestrator] Error stopping journey:', error);
    }
  }

  /**
   * ENGINE HELPER: Extract entity from user message using strict JSON schema
   */
  private async extractEntityFromMessage(
    userMessage: string,
    currentStep: any,
    businessAccountId: string
  ): Promise<EntityExtractionResult> {
    try {
      const openai = await this.getOpenAIClient(businessAccountId);
      
      const extractionPrompt = `You are analyzing a user's response to extract information.

Current Question: "${currentStep.questionText}"
User's Response: "${userMessage}"

Your job is to ONLY extract the answer to the current question from the user's response.

Analyze the response and provide:
1. answer: The extracted value (name, email, phone, choice, etc.) - ONLY if it answers the current question
2. is_off_topic: true if the user is asking about something unrelated to the current question
3. is_refusal: true if the user is declining to answer (e.g., "no", "skip", "I don't want to share")
4. quality: "valid" if answer is clear and complete, "needs_clarification" if vague, "invalid" if no answer
5. brief_offtopic_answer: If off-topic, provide a very brief (1 sentence) answer to their question, or null

RULES:
- Only extract information that directly answers the current question
- If user asks something else, mark is_off_topic=true
- Short answers are complete answers: "B.Com", "MBA", "Graduate", "12th pass", "5 years", "Mumbai", "Finance" are all "valid". Never ask for more detail than the question asks for.
- Use "needs_clarification" only when the answer is genuinely vague ("something", "not sure yet", "maybe")
- Detect refusals accurately

Respond with ONLY valid JSON matching this exact schema:
{
  "answer": "extracted value or null",
  "is_off_topic": false,
  "is_refusal": false,
  "quality": "valid",
  "brief_offtopic_answer": null
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a strict entity extractor. Respond only with valid JSON. Temperature is low to ensure consistency.'
          },
          {
            role: 'user',
            content: extractionPrompt
          }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });

      const extraction = JSON.parse(response.choices[0].message.content || '{}');
      
      return {
        answer: extraction.answer || null,
        is_off_topic: extraction.is_off_topic || false,
        is_refusal: extraction.is_refusal || false,
        quality: extraction.quality || 'invalid',
        brief_offtopic_answer: extraction.brief_offtopic_answer || null
      };
    } catch (error) {
      console.error('[Engine] Error extracting entity:', error);
      return {
        answer: null,
        is_off_topic: false,
        is_refusal: false,
        quality: 'invalid',
        brief_offtopic_answer: null
      };
    }
  }

  /**
   * ENGINE HELPER: Rephrase question naturally using AI (NLG)
   */
  private async rephraseQuestion(question: string, businessAccountId: string): Promise<string> {
    try {
      const openai = await this.getOpenAIClient(businessAccountId);
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You rephrase questions to sound natural and conversational while keeping the same meaning. Keep it brief and friendly.'
          },
          {
            role: 'user',
            content: `Rephrase this question naturally: ${question}`
          }
        ],
        temperature: 0.7,
        max_tokens: 100,
      });

      return (response.choices[0].message.content?.trim() || question).replace(/^"|"$/g, '');
    } catch (error) {
      console.error('[Engine] Error rephrasing question:', error);
      return question;
    }
  }

  /**
   * ENGINE HELPER: Build context for natural response generation
   */
  private async buildResponseContext(
    conversationId: string,
    journeyState: any,
    businessAccountId: string
  ): Promise<{
    journeyName: string;
    businessName: string;
    previousAnswers: string;
  }> {
    try {
      const storage = (await import('../storage')).storage;
      const businessAccount = await storage.getBusinessAccount(businessAccountId);
      
      // Build previous answers summary
      const answers: string[] = [];
      if (journeyState && journeyState.responses && journeyState.journeyId) {
        // Fetch journey steps from database
        const journey = await storage.getJourney(journeyState.journeyId, businessAccountId);
        const steps = journey ? await storage.getJourneySteps(journeyState.journeyId) : [];
        
        for (const [stepId, answer] of journeyState.responses.entries()) {
          if (answer && !answer.startsWith('[SKIPPED')) {
            // Get step question from database
            const step = steps.find((s: any) => s.id === stepId);
            if (step) {
              answers.push(`Q: ${step.questionText}\nA: ${answer}`);
            }
          }
        }
      }
      
      return {
        journeyName: journeyState?.journeyName || '',
        businessName: businessAccount?.name || '',
        previousAnswers: answers.length > 0 ? answers.join('\n\n') : ''
      };
    } catch (error) {
      console.error('[Engine] Error building response context:', error);
      return {
        journeyName: '',
        businessName: '',
        previousAnswers: ''
      };
    }
  }

  /**
   * ENGINE HELPER: Generate natural AI response for any journey situation
   * This ensures responses sound conversational, not templated
   */
  private async generateNaturalResponse(
    situation: 'refusal' | 'off_topic' | 'clarification' | 'validation_error' | 'acknowledgment' | 'skip',
    userMessage: string,
    currentQuestion: string,
    context: {
      briefAnswer?: string;
      validationMessage?: string;
      isRequired?: boolean;
      journeyName?: string;
      businessName?: string;
      previousAnswers?: string;
      skippedInfo?: string;
      /** acknowledgment: the question the visitor just answered, and their answer. */
      answeredQuestion?: string;
      answer?: string;
    },
    businessAccountId: string
  ): Promise<string> {
    try {
      const openai = await this.getOpenAIClient(businessAccountId);
      
      // Build context-aware system prompt
      const businessContext = context.businessName ? `You are assisting ${context.businessName}` : 'You are a helpful assistant';
      const journeyContext = context.journeyName ? ` collecting information for: ${context.journeyName}` : '';
      const previousContext = context.previousAnswers ? `\n\nPrevious conversation:\n${context.previousAnswers}` : '';
      
      let situationPrompt = '';
      
      switch (situation) {
        case 'refusal':
          situationPrompt = context.isRequired 
            ? `The user declined to answer a REQUIRED question. Generate a warm, understanding response that:\n1. Acknowledges their hesitation genuinely\n2. Briefly explains why this specific information helps (be specific to the question)\n3. Gently encourages them to share\n4. Re-asks the question naturally\nVary your phrasing - never sound like a template. Be conversational and empathetic.`
            : `The user declined an OPTIONAL question. Generate a brief, positive response that says it's totally fine to skip, then smoothly transition to the next question. Keep it light.`;
          break;
        
        case 'off_topic':
          situationPrompt = `The user asked something unrelated to the current question flow. ${context.briefAnswer ? `Answer their question: "${context.briefAnswer}"` : 'Politely acknowledge their question.'} Then naturally guide them back to continue the information collection. Don't sound robotic - be conversational.`;
          break;
        
        case 'clarification':
          situationPrompt = `The user's answer was unclear or incomplete. Ask them to clarify in a friendly way. Reference what they said ("${userMessage}") and gently prompt for more detail. Keep it encouraging, not critical.`;
          break;
        
        case 'validation_error':
          situationPrompt = `The user provided info in the wrong format. ${context.validationMessage || 'Explain the issue gently.'} Ask them to try again without making them feel bad about the mistake. Be helpful and supportive.`;
          break;
        
        case 'acknowledgment':
          const skippedContext = context.skippedInfo 
            ? `\n\nIMPORTANT: You already have some information from earlier in the conversation: ${context.skippedInfo}. Do NOT ask for it again. You may mention briefly that you have it, then ask the next question.`
            : '';
          const answeredContext = context.answeredQuestion
            ? ` The visitor just answered the question "${context.answeredQuestion}"${context.answer ? ` with "${context.answer}"` : ''}. That answer is accepted — never comment on its format or say it answers a different question.`
            : '';
          
          // Rotate acknowledgments for variety (no AI memory needed)
          const acknowledgments = [
            "Great!",
            "Perfect!",
            "Thank you!",
            "Got it!",
            "Wonderful!",
            "Excellent!",
            "Noted!",
            "Understood!",
            "Fantastic!",
            "Brilliant!",
            "Nice!",
            "Thanks!"
          ];
          const randomAck = acknowledgments[Math.floor(Math.random() * acknowledgments.length)];
          
          situationPrompt = `The user gave a valid answer.${answeredContext} Start with "${randomAck}" then smoothly ask the next question. Keep it natural and flowing.${skippedContext}`;
          break;
        
        case 'skip':
          situationPrompt = `The user did not answer the previous question, and that's fine — do not insist or repeat it. Say something brief like "No problem!" or "That's fine!" then smoothly move to the next question. Keep it positive and flowing.${context.skippedInfo ? ` You already know: ${context.skippedInfo} — do not ask for it.` : ''}`;
          break;
      }
      
      const fullSystemPrompt = `${businessContext}${journeyContext}.${previousContext}\n\n${situationPrompt}`;
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: fullSystemPrompt
          },
          {
            role: 'user',
            content: situation === 'acknowledgment' || situation === 'skip'
              ? `Next question to ask: ${currentQuestion}\n\nThe visitor's last message: ${userMessage}\n\nGenerate your response:`
              : `Current question we need to ask: ${currentQuestion}\n\nUser just said: ${userMessage}\n\nGenerate your response:`
          }
        ],
        temperature: 0.8, // Higher for more variation
        max_tokens: 150,
      });

      return (response.choices[0].message.content?.trim() || currentQuestion).replace(/^"|"$/g, '');
    } catch (error) {
      console.error('[Engine] Error generating natural response:', error);
      // Fallback to simple response
      return currentQuestion;
    }
  }


  /**
   * ENGINE HELPER: Validate answer format (email, phone) — the phone rule is the lead training's
   * (same digits rule as the chat's lead capture, fake numbers like 9876543210 refused).
   */
  private async validateAnswer(answer: string, step: any, businessAccountId: string): Promise<{ valid: boolean; message?: string }> {
    const slot = contactSlot(step);
    if (slot === 'email' && !isValidEmail(answer)) {
      return {
        valid: false,
        message: "That doesn't look like a valid email address. Could you provide a valid email (e.g., name@example.com)?"
      };
    }
    if (slot === 'phone') {
      const mode = await this.phoneMode(businessAccountId);
      if (!validatePhoneNumber(answer, mode).isValid) return { valid: false, message: phoneProblemMessage(mode) };
    }

    // All other answers are valid
    return { valid: true };
  }
}

// Export singleton instance
export const journeyOrchestrator = new JourneyOrchestrator();
