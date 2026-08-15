import { journeyService, type JourneyState } from './journeyService';
import { conversationMemory } from '../conversationMemory';

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
    
    const OpenAI = (await import('openai')).default;
    return new OpenAI({ apiKey });
  }

  /**
   * ENGINE-DRIVEN MODE: Process user message through strict state machine
   * Returns a complete response if the engine handles it, or null to continue with AI
   */
  async processUserMessageEngineDriven(
    conversationId: string,
    userId: string,
    businessAccountId: string,
    userMessage: string
  ): Promise<EngineJourneyResponse> {
    try {
      const storage = (await import('../storage')).storage;
      
      // Check if a conversation journey is active
      const journeyState = await journeyService.getOrStartJourney(conversationId, userId, businessAccountId, userMessage);
      
      if (!journeyState || journeyState.completed) {
        // No active journey - let AI handle normally
        return { shouldBypassAI: false };
      }

      console.log('[Engine] Journey active - processing through state machine');
      
      // Get current step
      const currentStep = await journeyService.getCurrentStep(conversationId);
      
      if (!currentStep) {
        // Journey completed - AUTO-CAPTURE LEAD FROM JOURNEY RESPONSES
        await journeyService.completeJourney(conversationId);
        
        // Extract name and phone from journey responses and create lead
        await this.captureLeadFromJourney(conversationId, journeyState, businessAccountId);
        
        return {
          shouldBypassAI: true,
          response: "Thank you! I've collected all the information I need. Our team will review your responses and get back to you soon.",
          isComplete: true
        };
      }

      // First interaction - ask the first question
      const isFirstInteraction = journeyState.awaitingFirstUserResponse;
      if (isFirstInteraction) {
        await journeyService.markJourneyPrompted(conversationId);
        
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

      // Extract entity from user message using constrained NLU
      const extraction = await this.extractEntityFromMessage(
        userMessage,
        currentStep,
        businessAccountId
      );

      console.log('[Engine] Extraction result:', extraction);

      // Build context for natural responses (journey name, business, previous answers)
      const responseContext = await this.buildResponseContext(conversationId, journeyState, businessAccountId);

      // Handle refusals FIRST (more important than off-topic)
      // If someone says "not interested", that's a refusal, not off-topic
      if (extraction.is_refusal) {
        if (currentStep.isRequired === 'true') {
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
        } else {
          // Skip optional step
          journeyState.responses.set(currentStep.id, '[SKIPPED: User declined]');
          console.log('[Engine] Optional step skipped due to refusal');
          
          // Advance to next step
          await journeyService.advanceToNextStep(conversationId);
          const nextStep = await journeyService.getCurrentStep(conversationId);
          
          if (!nextStep) {
            await journeyService.completeJourney(conversationId);

            // Conversational journeys hand off to the AI for a contextual reply.
            if (journeyState.journeyType !== 'form') {
              console.log('[Engine] Conversational journey complete (after skip) - handing off to AI');
              return {
                shouldBypassAI: false,
                isComplete: true
              };
            }

            return {
              shouldBypassAI: true,
              response: "Thank you! I've collected all the information I need.",
              isComplete: true
            };
          }
          
          // Generate natural skip response
          const naturalResponse = await this.generateNaturalResponse(
            'skip',
            userMessage,
            nextStep.questionText || '',
            {
              isRequired: false,
              ...responseContext
            },
            businessAccountId
          );
          
          return {
            shouldBypassAI: true,
            response: naturalResponse,
            options: parseStepChoiceOptions(nextStep)
          };
        }
      }

      // Handle off-topic interrupts (after refusals)
      // These are genuine questions not related to the current step
      if (extraction.is_off_topic) {
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

      // Validate answer quality
      if (extraction.quality === 'invalid' || extraction.quality === 'needs_clarification' || !extraction.answer) {
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

      // Validate answer format (email, phone, etc.)
      const validationResult = await this.validateAnswer(extraction.answer, currentStep);
      
      if (!validationResult.valid) {
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

      // Record valid answer
      const { db } = await import('../db');
      const { journeyResponses } = await import('../../shared/schema');
      
      journeyState.responses.set(currentStep.id, extraction.answer);
      
      try {
        await db.insert(journeyResponses).values({
          sessionId: journeyState.sessionId,
          journeyId: journeyState.journeyId,
          conversationId: conversationId,
          stepId: currentStep.id,
          response: extraction.answer,
        });
      } catch (error: any) {
        // Ignore duplicate errors
        if (!error.message?.includes('duplicate')) {
          console.error('[Engine] Error saving response:', error);
        }
      }

      console.log('[Engine] Recorded answer:', extraction.answer);

      // INSTANT LEAD CAPTURE: Capture contact info immediately
      await this.captureLeadIncremental(conversationId, businessAccountId, currentStep, extraction.answer, journeyState);

      // Advance to next step
      await journeyService.advanceToNextStep(conversationId);
      let nextStep = await journeyService.getCurrentStep(conversationId);
      
      if (!nextStep) {
        // Journey complete
        await journeyService.completeJourney(conversationId);

        // For CONVERSATIONAL journeys, hand control back to the AI so it can give a
        // genuinely helpful, contextual reply about the visitor's selection instead of
        // dead-ending on a generic "our team will get back to you" message. The journey
        // is already marked complete, so the AI simply continues the conversation.
        if (journeyState.journeyType !== 'form') {
          console.log('[Engine] Conversational journey complete - handing off to AI for a contextual response');
          return {
            shouldBypassAI: false,
            isComplete: true
          };
        }

        return {
          shouldBypassAI: true,
          response: "Perfect! Thank you for providing all the information. Our team will review your responses and get in touch with you soon.",
          isComplete: true
        };
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
      const naturalResponse = await this.generateNaturalResponse(
        'acknowledgment',
        userMessage,
        nextStep.questionText || '',
        responseContext,
        businessAccountId
      );
      
      return {
        shouldBypassAI: true,
        response: naturalResponse,
        options: parseStepChoiceOptions(nextStep)
      };
      
    } catch (error) {
      console.error('[Engine] Error in engine-driven journey:', error);
      // Fall back to AI on error
      return { shouldBypassAI: false };
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
   * AUTO-CAPTURE LEAD FROM JOURNEY RESPONSES
   * Extracts contact information from completed journey and creates/updates lead
   */
  private async captureLeadFromJourney(
    conversationId: string,
    journeyState: JourneyState,
    businessAccountId: string
  ): Promise<void> {
    try {
      // If incremental capture already created a lead, just update it with any missing fields
      if (journeyState.leadId) {
        console.log('[Lead Capture] Journey already has lead - ensuring completeness');
        // The incremental capture already handled this - no duplicate needed
        return;
      }

      const { db } = await import('../db');
      const { leads, journeyResponses, journeySteps } = await import('../../shared/schema');
      const { eq, and } = await import('drizzle-orm');
      
      // Get all responses for this journey
      const responses = await db
        .select({
          response: journeyResponses.response,
          fieldName: journeySteps.fieldName,
          questionType: journeySteps.questionType,
        })
        .from(journeyResponses)
        .innerJoin(journeySteps, eq(journeyResponses.stepId, journeySteps.id))
        .where(eq(journeyResponses.sessionId, journeyState.sessionId));
      
      console.log('[Lead Capture] Journey responses:', responses);
      
      // Extract contact fields
      let name: string | null = null;
      let phone: string | null = null;
      let email: string | null = null;
      
      for (const resp of responses) {
        const fieldName = resp.fieldName?.toLowerCase();
        if (fieldName === 'name' || fieldName === 'fullname' || fieldName === 'full_name') {
          name = resp.response;
        } else if (fieldName === 'phone' || fieldName === 'contact' || fieldName === 'mobile') {
          phone = resp.response;
        } else if (fieldName === 'email') {
          email = resp.response;
        }
      }
      
      // Only create lead if we have at least name OR phone
      if (!name && !phone) {
        console.log('[Lead Capture] No contact information found in journey responses - skipping lead creation');
        return;
      }
      
      console.log('[Lead Capture] Extracted from journey:', { name, phone, email });
      
      // Check if lead already exists for this conversation
      const existingLeads = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.businessAccountId, businessAccountId),
            eq(leads.conversationId, conversationId)
          )
        )
        .limit(1);
      
      if (existingLeads.length > 0) {
        // Update existing lead with new information
        const updateData: any = {};
        if (name) updateData.name = name;
        if (phone) updateData.phone = phone;
        if (email) updateData.email = email;
        
        await db
          .update(leads)
          .set({
            ...updateData,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, existingLeads[0].id));
        
        console.log('[Lead Capture] ✓ Updated existing lead:', existingLeads[0].id);
      } else {
        // Create new lead
        const newLead = await db.insert(leads).values({
          businessAccountId,
          conversationId,
          name: name || 'Unknown',
          phone: phone || null,
          email: email || null,
          message: `Journey: ${journeyState.journeyId}`,
        }).returning();
        
        console.log('[Lead Capture] ✓ Created new lead from journey:', newLead[0].id);
      }
    } catch (error) {
      console.error('[Lead Capture] Error capturing lead from journey:', error);
    }
  }

  /**
   * INSTANT PROGRESSIVE LEAD CAPTURE (AI-POWERED)
   * Uses AI to detect name/phone/email in ANY journey response
   * No field configuration needed - automatically captures contact info!
   */
  private async captureLeadIncremental(
    conversationId: string,
    businessAccountId: string,
    step: any,
    answer: string,
    journeyState: JourneyState
  ): Promise<void> {
    try {
      // Use AI to detect if this answer contains contact information
      const openai = await this.getOpenAIClient(businessAccountId);
      
      const detectionPrompt = `Analyze this user response and detect if it contains contact information.

Question asked: "${step.questionText}"
User's answer: "${answer}"

Extract ONLY if explicitly provided by the user:
- name: Full name if present (first name, last name, or full name)
- phone: Phone number if present (any format)
- email: Email address if present

Rules:
- Only extract if the user ACTUALLY provided it in their answer
- Do NOT infer or guess
- For phone: accept any numeric format (with or without country code, spaces, dashes)
- For name: accept any name format (first only, last only, or full)
- Return null if that field was not provided

Respond with JSON:
{
  "name": "extracted name or null",
  "phone": "extracted phone or null", 
  "email": "extracted email or null"
}`;

      const detectionResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at extracting contact information. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: detectionPrompt
          }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const detected = JSON.parse(detectionResponse.choices[0].message.content || '{}');
      const { name, phone, email } = detected;

      // If no contact info detected, skip
      if (!name && !phone && !email) {
        return;
      }

      console.log(`[Lead Capture] 🔔 AI detected contact info: ${name ? 'name' : ''} ${phone ? 'phone' : ''} ${email ? 'email' : ''}`.trim());

      const { db } = await import('../db');
      const { leads } = await import('../../shared/schema');
      const { eq, and, or } = await import('drizzle-orm');

      // Helper: Normalize phone number for consistent duplicate detection
      const normalizePhone = (phoneNum: string): string => {
        // Keep only digits and leading +
        const cleaned = phoneNum.replace(/[^\d+]/g, '');
        // If starts with +, keep it; otherwise just digits
        return cleaned.startsWith('+') ? cleaned : cleaned.replace(/\+/g, '');
      };

      // Build update data with AI-detected contact info
      const updateData: any = {};
      if (name) updateData.name = name.trim();
      if (phone) updateData.phone = normalizePhone(phone);
      if (email) updateData.email = email.toLowerCase().trim();

      // PROGRESSIVE ENRICHMENT LOGIC
      
      // Case 1: Journey already has an associated lead - update it
      if (journeyState.leadId) {
        await db
          .update(leads)
          .set({
            ...updateData,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, journeyState.leadId));
        
        console.log(`[Lead Capture] ✓ Updated existing journey lead: ${journeyState.leadId}`);
        return;
      }

      // Case 2: Check for duplicate by email/phone (if AI detected them)
      if (email || phone) {
        const conditions: any[] = [eq(leads.businessAccountId, businessAccountId)];
        const contactConditions: any[] = [];
        
        if (email && updateData.email) {
          contactConditions.push(eq(leads.email, updateData.email));
        }
        if (phone && updateData.phone) {
          contactConditions.push(eq(leads.phone, updateData.phone));
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
          // Found duplicate - update it and link to journey
          await db
            .update(leads)
            .set({
              ...updateData,
              updatedAt: new Date(),
            })
            .where(eq(leads.id, existingLeads[0].id));
          
          journeyState.leadId = existingLeads[0].id;
          console.log(`[Lead Capture] ✓ Updated duplicate lead: ${existingLeads[0].id}`);
          return;
        }
      }

      // Case 3: Check if lead exists for this conversation
      const conversationLeads = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.businessAccountId, businessAccountId),
            eq(leads.conversationId, conversationId)
          )
        )
        .limit(1);

      if (conversationLeads.length > 0) {
        // Update existing conversation lead
        await db
          .update(leads)
          .set({
            ...updateData,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, conversationLeads[0].id));
        
        journeyState.leadId = conversationLeads[0].id;
        console.log(`[Lead Capture] ✓ Updated conversation lead: ${conversationLeads[0].id}`);
        return;
      }

      // Case 4: Create new lead (even with just name - we don't want to lose it)
      const newLead = await db.insert(leads).values({
        businessAccountId,
        conversationId,
        name: updateData.name || 'Unknown',
        phone: updateData.phone || null,
        email: updateData.email || null,
        message: `Journey: ${journeyState.journeyId}`,
      }).returning();
      
      journeyState.leadId = newLead[0].id;
      console.log(`[Lead Capture] ✓ Created new lead instantly: ${newLead[0].id}`);
      
    } catch (error) {
      console.error('[Lead Capture] Error in incremental capture:', error);
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

STRICT RULES:
- Only extract information that directly answers the current question
- If user asks something else, mark is_off_topic=true
- Be strict about quality - require clear, specific answers
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
            ? `\n\nIMPORTANT: You already have some information from earlier in the conversation: ${context.skippedInfo}. Mention this briefly to show you remember, then ask the current question.`
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
          
          situationPrompt = `The user gave a valid answer. Start with "${randomAck}" then smoothly ask the next question. Keep it natural and flowing.${skippedContext}`;
          break;
        
        case 'skip':
          situationPrompt = `The user skipped an optional question. Say something brief like "No problem!" or "That's fine!" then smoothly move to the next question. Keep it positive and flowing.`;
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
            content: `Current question we need to ask: ${currentQuestion}\n\nUser just said: ${userMessage}\n\nGenerate your response:`
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
   * ENGINE HELPER: Validate answer format (email, phone, etc.)
   */
  private async validateAnswer(answer: string, step: any): Promise<{ valid: boolean; message?: string }> {
    const questionLower = (step.questionText || '').toLowerCase();
    
    // Email validation
    if (questionLower.includes('email')) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(answer)) {
        return {
          valid: false,
          message: "That doesn't look like a valid email address. Could you provide a valid email (e.g., name@example.com)?"
        };
      }
    }

    // Phone validation (basic - accepts various formats)
    if (questionLower.includes('phone') || questionLower.includes('number') || questionLower.includes('whatsapp')) {
      const phoneRegex = /^[\d\s\-\+\(\)]{7,}$/;
      if (!phoneRegex.test(answer)) {
        return {
          valid: false,
          message: "That doesn't look like a valid phone number. Could you provide your phone number with digits only?"
        };
      }
    }

    // All other answers are valid
    return { valid: true };
  }
}

// Export singleton instance
export const journeyOrchestrator = new JourneyOrchestrator();
