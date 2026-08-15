import { storage } from '../storage';
import { journeyResponses, journeySessions } from '@shared/schema';
import { db } from '../db';
import { eq, and } from 'drizzle-orm';

export interface JourneyState {
  sessionId: string; // Database session ID for linking responses
  journeyId: string;
  conversationId: string;
  userId: string;
  businessAccountId: string;
  currentStepIndex: number;
  responses: Map<string, string>;
  completed: boolean;
  awaitingFirstUserResponse: boolean; // True when journey just started, false after first question asked
  triggeredByKeyword?: boolean; // True only when journey was just started by keyword match
  firstQuestionShownAsGreeting?: boolean; // True when startFromScratch journey - first question already shown
  leadId?: string; // Track associated lead for progressive enrichment
  journeyType?: 'conversational' | 'form'; // Journey type - conversational (AI chat) or form (visual UI)
}

class JourneyService {
  // PRIMARY: Map conversationId -> JourneyState
  private activeJourneys = new Map<string, JourneyState>();
  
  // SECONDARY INDEX: Map ${userId}_${businessAccountId} -> Set of conversationIds
  // Used for cleanup and lookups when conversationId is unknown
  private userJourneysIndex = new Map<string, Set<string>>();
  
  // PERFORMANCE: Cache whether business accounts have active journeys
  // This allows early-exit optimization to skip journey processing entirely
  private hasActiveJourneysCache = new Map<string, { hasJourneys: boolean; timestamp: number }>();
  private readonly JOURNEY_CACHE_TTL_MS = 60 * 1000; // 60 seconds cache TTL

  /**
   * PERFORMANCE OPTIMIZATION: Check if business account has any active journeys
   * Uses cached result to avoid repeated database queries
   * Returns false if no journeys exist, allowing early-exit in chat processing
   */
  async hasActiveJourneys(businessAccountId: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.hasActiveJourneysCache.get(businessAccountId);
    
    // Return cached result if still valid
    if (cached && (now - cached.timestamp) < this.JOURNEY_CACHE_TTL_MS) {
      return cached.hasJourneys;
    }
    
    // Fetch from database
    const journeys = await storage.getAllJourneys(businessAccountId);
    const hasJourneys = journeys.some(j => j.status === 'active');
    
    // Cache the result
    this.hasActiveJourneysCache.set(businessAccountId, {
      hasJourneys,
      timestamp: now
    });
    
    console.log(`[Journey Cache] Business ${businessAccountId.substring(0, 8)}... has active journeys: ${hasJourneys}`);
    return hasJourneys;
  }

  /**
   * Invalidate the hasActiveJourneys cache for a business account
   * Call this when journeys are created, updated, or deleted
   */
  invalidateJourneyCache(businessAccountId: string): void {
    this.hasActiveJourneysCache.delete(businessAccountId);
    console.log(`[Journey Cache] Invalidated cache for business ${businessAccountId.substring(0, 8)}...`);
  }

  private getSessionKey(userId: string, businessAccountId: string): string {
    return `${userId}_${businessAccountId}`;
  }
  
  private addToUserIndex(userId: string, businessAccountId: string, conversationId: string): void {
    const sessionKey = this.getSessionKey(userId, businessAccountId);
    if (!this.userJourneysIndex.has(sessionKey)) {
      this.userJourneysIndex.set(sessionKey, new Set());
    }
    this.userJourneysIndex.get(sessionKey)!.add(conversationId);
  }
  
  private removeFromUserIndex(userId: string, businessAccountId: string, conversationId: string): void {
    const sessionKey = this.getSessionKey(userId, businessAccountId);
    const conversations = this.userJourneysIndex.get(sessionKey);
    if (conversations) {
      conversations.delete(conversationId);
      if (conversations.size === 0) {
        this.userJourneysIndex.delete(sessionKey);
      }
    }
  }

  async initializeJourney(userId: string, businessAccountId: string, conversationId: string, journeyId: string, skipStatusCheck: boolean = false): Promise<JourneyState | null> {
    // Check if journey already exists for this conversation
    if (this.activeJourneys.has(conversationId)) {
      return this.activeJourneys.get(conversationId)!;
    }

    const journey = await storage.getJourney(journeyId, businessAccountId);
    if (!journey) {
      console.log('[Journey] Journey not found:', journeyId, 'for business:', businessAccountId);
      return null;
    }
    if (!skipStatusCheck && journey.status !== 'active') {
      console.log('[Journey] Journey is not active:', journeyId, 'status:', journey.status);
      return null;
    }

    const steps = await storage.getJourneySteps(journeyId);
    if (steps.length === 0) {
      return null;
    }

    const journeyState: JourneyState = {
      sessionId: '', // Will be set after DB session is created
      journeyId: journey.id,
      conversationId,
      userId,
      businessAccountId,
      currentStepIndex: 0,
      responses: new Map(),
      completed: false,
      awaitingFirstUserResponse: true, // New journey, awaiting first question to be asked
      journeyType: (journey.journeyType as 'conversational' | 'form') || 'conversational',
    };

    this.activeJourneys.set(conversationId, journeyState);
    this.addToUserIndex(userId, businessAccountId, conversationId);
    console.log('[Journey] Initialized journey:', journeyId, 'for conversation:', conversationId);
    return journeyState;
  }

  async getCurrentStep(conversationId: string) {
    const state = this.activeJourneys.get(conversationId);
    if (!state || state.completed) {
      return null;
    }

    const steps = await storage.getJourneySteps(state.journeyId);
    const sortedSteps = steps.sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));

    if (state.currentStepIndex >= sortedSteps.length) {
      state.completed = true;
      return null;
    }

    return sortedSteps[state.currentStepIndex];
  }

  async getFormStepData(conversationId: string, ignoreJourneyType = false): Promise<{
    stepId: string;
    questionText: string;
    questionType: string;
    isRequired: boolean;
    options?: string[];
    placeholder?: string;
    stepType?: string;
    completionButtonText?: string;
  } | null> {
    const state = this.activeJourneys.get(conversationId);
    if (!state || state.completed || (!ignoreJourneyType && state.journeyType !== 'form')) {
      return null;
    }

    const currentStep = await this.getCurrentStep(conversationId);
    if (!currentStep) {
      return null;
    }

    let options: string[] | undefined;
    if ((currentStep.questionType === 'radio' || currentStep.questionType === 'dropdown') && currentStep.multipleChoiceOptions) {
      try {
        options = JSON.parse(currentStep.multipleChoiceOptions);
      } catch (e) {
        console.error('[Journey] Failed to parse choice options:', e);
      }
    }

    return {
      stepId: currentStep.id,
      questionText: currentStep.questionText,
      questionType: currentStep.questionType || 'text',
      isRequired: currentStep.isRequired === 'true',
      options,
      placeholder: currentStep.placeholderText || undefined,
      stepType: currentStep.toolTrigger || undefined,
      completionButtonText: currentStep.completionButtonText || undefined,
    };
  }

  isFormJourney(conversationId: string): boolean {
    const state = this.activeJourneys.get(conversationId);
    return state?.journeyType === 'form';
  }

  async submitFormStepAndGetNext(conversationId: string, answer: string): Promise<{
    success: boolean;
    completed?: boolean;
    nextStep?: {
      stepId: string;
      questionText: string;
      questionType: string;
      isRequired: boolean;
      options?: string[];
      placeholder?: string;
      stepType?: string;
    };
    completionMessage?: string;
    exitedEarly?: boolean;
  }> {
    const state = this.activeJourneys.get(conversationId);
    if (!state || state.completed) {
      return { success: false };
    }

    // Check for exit condition BEFORE recording response
    const steps = await storage.getJourneySteps(state.journeyId);
    const sortedSteps = steps.sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));
    const currentStep = sortedSteps[state.currentStepIndex];
    
    console.log('[Journey] Processing step with skip config:', {
      stepId: currentStep?.id,
      skipOnValue: currentStep?.skipOnValue,
      skipToStepIndex: currentStep?.skipToStepIndex,
      answer,
      currentStepIndex: state.currentStepIndex
    });
    
    if (currentStep?.exitOnValue && currentStep.exitOnValue.toLowerCase() === answer.toLowerCase()) {
      // Exit condition matched - end journey with custom message
      console.log('[Journey] Exit condition matched:', { exitOnValue: currentStep.exitOnValue, answer });
      
      // Record the response before exiting
      await this.recordResponse(conversationId, answer);
      
      // Mark journey as completed
      state.completed = true;
      this.activeJourneys.set(conversationId, state);
      
      return {
        success: true,
        completed: true,
        exitedEarly: true,
        completionMessage: currentStep.exitMessage || 'Thank you for your time!'
      };
    }

    // Check for skip-to-step condition
    if (currentStep?.skipOnValue && currentStep.skipToStepIndex !== null && 
        currentStep.skipOnValue.toLowerCase() === answer.toLowerCase()) {
      // Validate skip target is within bounds
      if (currentStep.skipToStepIndex >= sortedSteps.length || currentStep.skipToStepIndex <= state.currentStepIndex) {
        console.log('[Journey] Skip target out of bounds, falling through to normal processing:', { 
          skipToStepIndex: currentStep.skipToStepIndex, 
          totalSteps: sortedSteps.length,
          currentIndex: state.currentStepIndex
        });
        // Fall through to normal processing if invalid - don't return here
      } else {
        // Skip condition matched - jump to specified step
        console.log('[Journey] Skip condition matched:', { 
          skipOnValue: currentStep.skipOnValue, 
          skipToStepIndex: currentStep.skipToStepIndex, 
          answer 
        });
        
        // Record the response for the current step
        await this.recordResponseWithoutAdvancing(conversationId, answer);
        
        // Jump to the specified step
        state.currentStepIndex = currentStep.skipToStepIndex;
        this.activeJourneys.set(conversationId, state);
        
        // Update database session with new step index
        try {
          const dbSession = await storage.getJourneySessionByConversationId(conversationId);
          if (dbSession) {
            await storage.updateJourneySession(dbSession.id, {
              currentStepIndex: state.currentStepIndex,
            });
          }
        } catch (error) {
          console.error('[Journey] Error updating database session after skip:', error);
        }
        
        // Get the step we skipped to
        const nextStep = await this.getFormStepData(conversationId, true);
        if (!nextStep) {
          return { success: true, completed: true };
        }
        
        return {
          success: true,
          completed: false,
          nextStep
        };
      }
    }

    // Record the response (this advances to next step internally)
    const recorded = await this.recordResponse(conversationId, answer);
    if (!recorded) {
      return { success: false };
    }

    // Check if journey is now completed
    const updatedState = this.activeJourneys.get(conversationId);
    if (!updatedState || updatedState.completed) {
      return {
        success: true,
        completed: true,
        completionMessage: 'Thank you for completing the form!'
      };
    }

    // Get next form step data
    const nextStep = await this.getFormStepData(conversationId, true);
    if (!nextStep) {
      return { success: true, completed: true };
    }

    // If next step is journey_complete, mark journey as completed but return the step for display
    if (nextStep.stepType === 'journey_complete') {
      console.log('[Journey] Next step is journey_complete - marking journey finished');
      const state = this.activeJourneys.get(conversationId);
      if (state) {
        state.completed = true;
        this.activeJourneys.set(conversationId, state);
      }
      return {
        success: true,
        completed: true,
        nextStep,  // Return step data so client can display the completion message
        completionMessage: nextStep.questionText || 'Thank you for completing the form!'
      };
    }

    return {
      success: true,
      completed: false,
      nextStep
    };
  }

  async recordResponse(conversationId: string, response: string): Promise<boolean> {
    const state = this.activeJourneys.get(conversationId);
    if (!state || state.completed) {
      return false;
    }

    const steps = await storage.getJourneySteps(state.journeyId);
    const sortedSteps = steps.sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));
    const currentStep = sortedSteps[state.currentStepIndex];

    if (!currentStep) {
      return false;
    }

    state.responses.set(currentStep.id, response);

    try {
      await db.insert(journeyResponses).values({
        sessionId: state.sessionId,
        journeyId: state.journeyId,
        conversationId,
        stepId: currentStep.id,
        response,
      });
    } catch (error) {
      console.error('[Journey] Error storing response:', error);
    }

    // Check for conditional branching
    const nextStepIndex = await this.determineNextStep(currentStep, response, sortedSteps, state.currentStepIndex);
    state.currentStepIndex = nextStepIndex;

    // Update database session with new step index
    try {
      const dbSession = await storage.getJourneySessionByConversationId(conversationId);
      if (dbSession) {
        await storage.updateJourneySession(dbSession.id, {
          currentStepIndex: state.currentStepIndex,
        });
      }
    } catch (error) {
      console.error('[Journey] Error updating database session:', error);
    }

    if (state.currentStepIndex >= sortedSteps.length) {
      state.completed = true;
      console.log('[Journey] Journey completed for conversation:', conversationId);
      
      // Mark as completed in database
      try {
        const dbSession = await storage.getJourneySessionByConversationId(conversationId);
        if (dbSession) {
          await storage.updateJourneySession(dbSession.id, {
            completed: 'true',
            completedAt: new Date(),
          });
        }
      } catch (error) {
        console.error('[Journey] Error marking session as completed:', error);
      }
      
      // Auto-reset completed journeys to free memory
      setTimeout(() => {
        this.resetJourney(conversationId);
      }, 5000); // Give 5 seconds for completion message to be sent
    }

    return true;
  }

  // Record response without advancing to next step (used for skip-to-step)
  async recordResponseWithoutAdvancing(conversationId: string, response: string): Promise<boolean> {
    const state = this.activeJourneys.get(conversationId);
    if (!state || state.completed) {
      return false;
    }

    const steps = await storage.getJourneySteps(state.journeyId);
    const sortedSteps = steps.sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));
    const currentStep = sortedSteps[state.currentStepIndex];

    if (!currentStep) {
      return false;
    }

    state.responses.set(currentStep.id, response);

    try {
      await db.insert(journeyResponses).values({
        sessionId: state.sessionId,
        journeyId: state.journeyId,
        conversationId,
        stepId: currentStep.id,
        response,
      });
    } catch (error) {
      console.error('[Journey] Error storing response:', error);
    }

    // Don't advance step - caller will set the step index for skip-to-step
    return true;
  }

  async markJourneyPrompted(conversationId: string): Promise<void> {
    const state = this.activeJourneys.get(conversationId);
    if (state) {
      state.awaitingFirstUserResponse = false;
    }
  }
  
  async clearKeywordTriggerFlag(conversationId: string): Promise<void> {
    const state = this.activeJourneys.get(conversationId);
    if (state) {
      state.triggeredByKeyword = false;
    }
  }

  // Get journey by conversationId (primary method)
  async getJourneyState(conversationId: string): Promise<JourneyState | null> {
    // Check in-memory cache first
    if (this.activeJourneys.has(conversationId)) {
      const state = this.activeJourneys.get(conversationId)!;
      
      // Clean up completed journeys (in-memory only)
      if (state.completed) {
        await this.resetJourney(conversationId);
        return null;
      }
      
      return state;
    }

    // Hydrate from database if not in memory (reconnect/restart scenario)
    const dbSession = await storage.getJourneySessionByConversationId(conversationId);

    // Treat ANY completed value other than 'false' as terminal (e.g., 'true', 'abandoned')
    if (!dbSession || dbSession.completed !== 'false') {
      return null;
    }

    // Load journey to get journeyType
    const journey = await storage.getJourney(dbSession.journeyId, dbSession.businessAccountId);
    
    // Reconstruct in-memory state from database
    const journeyState: JourneyState = {
      sessionId: dbSession.id, // Populate sessionId from DB session
      journeyId: dbSession.journeyId,
      conversationId: dbSession.conversationId,
      userId: dbSession.userId,
      businessAccountId: dbSession.businessAccountId,
      currentStepIndex: Number(dbSession.currentStepIndex),
      responses: new Map(), // Responses are already persisted in journey_responses table
      completed: false,
      awaitingFirstUserResponse: false, // Hydrated from DB, already in progress
      journeyType: (journey?.journeyType as 'conversational' | 'form') || 'conversational',
    };

    this.activeJourneys.set(conversationId, journeyState);
    this.addToUserIndex(dbSession.userId, dbSession.businessAccountId, conversationId);
    console.log('[Journey] Hydrated journey state from database for conversation:', conversationId);
    return journeyState;
  }
  
  // Get journey by userId/businessAccountId (for backward compatibility during transition)
  // This returns THE FIRST active journey for this user (if multiple conversations exist)
  async getJourneyStateByUser(userId: string, businessAccountId: string): Promise<JourneyState | null> {
    const sessionKey = this.getSessionKey(userId, businessAccountId);
    const conversationIds = this.userJourneysIndex.get(sessionKey);
    
    if (conversationIds && conversationIds.size > 0) {
      // Return first active journey
      const firstConversationId = conversationIds.values().next().value;
      if (firstConversationId) {
        return this.getJourneyState(firstConversationId);
      }
    }
    
    // Try database fallback
    const dbSession = await storage.getActiveJourneySessionByUser(userId, businessAccountId);
    if (dbSession) {
      return this.getJourneyState(dbSession.conversationId);
    }
    
    return null;
  }

  // Primary method: Get or start journey by conversationId
  async getOrStartJourney(conversationId: string, userId: string, businessAccountId: string, userMessage?: string): Promise<JourneyState | null> {
    console.log('[Journey] getOrStartJourney called for conversation:', conversationId, 'message:', userMessage);
    
    // CRITICAL: Clear any stale journeys for this user/business with DIFFERENT conversationIds
    // This ensures strict conversation isolation and prevents cross-conversation contamination
    // Clear BOTH in-memory state AND database sessions to prevent rehydration
    const sessionKey = this.getSessionKey(userId, businessAccountId);
    const userConversations = this.userJourneysIndex.get(sessionKey);
    if (userConversations) {
      for (const otherConvId of Array.from(userConversations)) {
        if (otherConvId !== conversationId) {
          console.log('[Journey] Clearing stale journey from different conversation:', otherConvId);
          
          // Clear in-memory state
          await this.resetJourney(otherConvId);
          
          // Mark database session as abandoned to prevent rehydration
          const dbSession = await storage.getJourneySessionByConversationId(otherConvId);
          if (dbSession) {
            console.log('[Journey] Abandoning database session for conversation:', otherConvId);
            await storage.updateJourneySession(dbSession.id, {
              completed: 'abandoned',
              completedAt: new Date(),
            });
          }
        }
      }
    }
    
    // ALSO check database for any active sessions for this user/business with different conversationIds
    // This catches sessions that weren't in memory but exist in DB
    const allUserSessions = await db
      .select()
      .from(journeySessions)
      .where(and(
        eq(journeySessions.userId, userId),
        eq(journeySessions.businessAccountId, businessAccountId),
        eq(journeySessions.completed, 'false')
      ));
    
    for (const session of allUserSessions) {
      if (session.conversationId !== conversationId) {
        console.log('[Journey] Found stale DB session for different conversation:', session.conversationId, '- abandoning');
        await storage.updateJourneySession(session.id, {
          completed: 'abandoned',
          completedAt: new Date(),
        });
      }
    }
    
    // Check if already has active journey for THIS conversation
    const existingState = await this.getJourneyState(conversationId);
    if (existingState) {
      console.log('[Journey] Existing journey state found for conversation:', conversationId);
      return existingState;
    }

    const journeys = await storage.getAllJourneys(businessAccountId);
    const activeJourneys = journeys.filter(j => j.status === 'active');
    console.log('[Journey] Total journeys:', journeys.length, 'Active journeys:', activeJourneys.length);

    // Check for startFromScratch journey first - auto-starts without keywords
    const startFromScratchJourney = activeJourneys.find(j => j.startFromScratch === 'true');
    if (startFromScratchJourney) {
      console.log('[Journey] Found startFromScratch journey:', startFromScratchJourney.name);
      
      // Check if journey was already completed in this conversation
      const completedSession = await db
        .select()
        .from(journeySessions)
        .where(and(
          eq(journeySessions.conversationId, conversationId),
          eq(journeySessions.journeyId, startFromScratchJourney.id),
          eq(journeySessions.completed, 'true')
        ))
        .limit(1);
      
      if (completedSession.length === 0) {
        console.log('[Journey] ✓ Auto-starting startFromScratch journey:', startFromScratchJourney.id);
        const newState = await this.startJourney(conversationId, userId, businessAccountId, startFromScratchJourney.id);
        if (newState) {
          // First question was already shown as the greeting
          newState.awaitingFirstUserResponse = false;
          newState.firstQuestionShownAsGreeting = true;
          console.log('[Journey] startFromScratch: First question already shown as greeting, ready to record response');
        }
        return newState;
      } else {
        console.log('[Journey] ⚠️ startFromScratch journey already completed in this conversation');
      }
    }

    // Check for keyword-triggered journeys (if userMessage provided)
    if (userMessage) {
      const lowerMessage = userMessage.toLowerCase().trim();
      console.log('[Journey] Checking keyword triggers for message:', lowerMessage);
      
      for (const journey of activeJourneys) {
        console.log('[Journey] Checking journey:', journey.name, 'triggerKeywords:', journey.triggerKeywords);
        if (journey.triggerKeywords) {
          try {
            const keywords: string[] = JSON.parse(journey.triggerKeywords);
            console.log('[Journey] Parsed keywords for', journey.name, ':', keywords);
            const matched = keywords.some(keyword => {
              const lowerKeyword = keyword.toLowerCase().trim();
              
              // Split multi-word keywords into individual words for flexible matching
              // This allows "mba online" to match "Online MBA" and vice versa
              const keywordWords = lowerKeyword.split(/\s+/);
              
              // Check if all words in the keyword appear in the message (any order)
              const allWordsPresent = keywordWords.every(word => 
                lowerMessage.includes(word)
              );
              
              console.log('[Journey] Testing keyword:', keyword, '(', lowerKeyword, ') - Match:', allWordsPresent);
              return allWordsPresent;
            });
            
            if (matched) {
              console.log('[Journey] ✓ Keyword-triggered journey:', journey.id, 'matched keyword in:', userMessage);
              
              // OPTION 1: Check if this journey was already completed in this conversation
              // Prevent re-triggering to avoid asking same questions again
              const completedSession = await db
                .select()
                .from(journeySessions)
                .where(and(
                  eq(journeySessions.conversationId, conversationId),
                  eq(journeySessions.journeyId, journey.id),
                  eq(journeySessions.completed, 'true')
                ))
                .limit(1);
              
              if (completedSession.length > 0) {
                console.log('[Journey] ⚠️ Journey already completed in this conversation - skipping re-trigger');
                console.log('[Journey] User can start fresh journey after conversation reset (page refresh)');
                return null; // Don't trigger - let normal chat flow continue
              }
              
              const newState = await this.startJourney(conversationId, userId, businessAccountId, journey.id);
              if (newState) {
                // Mark this journey as triggered by keyword
                newState.triggeredByKeyword = true;
              }
              return newState;
            }
          } catch (error) {
            console.error('[Journey] Error parsing trigger keywords for journey:', journey.id, error);
          }
        }
      }
      console.log('[Journey] No keyword matches found');
    }

    // No keyword-triggered journey found - return null
    return null;
  }
  
  // Start journey for a specific conversation
  async startJourney(conversationId: string, userId: string, businessAccountId: string, journeyId: string, skipStatusCheck: boolean = false): Promise<JourneyState | null> {
    console.log('[Journey] Starting journey:', journeyId, 'for conversation:', conversationId);
    
    // CRITICAL: Clear ALL stale journeys (both in-memory and database) for this user/business
    // This ensures complete isolation before starting new journey
    const sessionKey = this.getSessionKey(userId, businessAccountId);
    const userConversations = this.userJourneysIndex.get(sessionKey);
    if (userConversations) {
      for (const otherConvId of Array.from(userConversations)) {
        if (otherConvId !== conversationId) {
          console.log('[Journey] Clearing stale in-memory journey from conversation:', otherConvId);
          await this.resetJourney(otherConvId);
          
          // Mark database session as abandoned
          const dbSession = await storage.getJourneySessionByConversationId(otherConvId);
          if (dbSession) {
            await storage.updateJourneySession(dbSession.id, {
              completed: 'abandoned',
              completedAt: new Date(),
            });
          }
        }
      }
    }
    
    // ALSO check database for any active sessions for this user/business with different conversationIds
    const allUserSessions = await db
      .select()
      .from(journeySessions)
      .where(and(
        eq(journeySessions.userId, userId),
        eq(journeySessions.businessAccountId, businessAccountId),
        eq(journeySessions.completed, 'false')
      ));
    
    for (const session of allUserSessions) {
      if (session.conversationId !== conversationId) {
        console.log('[Journey] Found stale DB session for different conversation:', session.conversationId, '- abandoning');
        await storage.updateJourneySession(session.id, {
          completed: 'abandoned',
          completedAt: new Date(),
        });
      }
    }
    
    // Check for existing active session for THIS specific conversation
    const existingConvSession = await storage.getJourneySessionByConversationId(conversationId);
    
    if (existingConvSession) {
      if (existingConvSession.journeyId === journeyId) {
        // If same journey and same conversation, resume it instead of creating duplicate
        console.log('[Journey] Resuming existing journey session for conversation:', conversationId);
        return await this.getJourneyState(conversationId);
      } else {
        // Different journey - mark old as abandoned
        console.log('[Journey] Abandoning previous journey for new one:', journeyId);
        await storage.updateJourneySession(existingConvSession.id, {
          completed: 'abandoned',
          completedAt: new Date(),
        });
      }
    }
    
    // Reset in-memory state for this conversation
    await this.resetJourney(conversationId);
    
    // Initialize in-memory journey state
    const state = await this.initializeJourney(userId, businessAccountId, conversationId, journeyId, skipStatusCheck);
    if (!state) {
      return null;
    }

    // Create persistent database session
    try {
      const dbSession = await storage.createJourneySession({
        journeyId: state.journeyId,
        conversationId,
        businessAccountId,
        userId,
        currentStepIndex: 0,
      });
      
      // Update in-memory state with actual sessionId
      state.sessionId = dbSession.id;
      
      console.log('[Journey] Created persistent journey session in database:', dbSession.id);
    } catch (error) {
      console.error('[Journey] Error creating database session:', error);
      return null;
    }

    return state;
  }

  isJourneyActive(conversationId: string): boolean {
    const state = this.activeJourneys.get(conversationId);
    return state !== undefined && !state.completed;
  }

  /**
   * Shared completion helper - consistently marks journey as completed
   * Use this instead of manually setting completion flags to ensure proper cleanup
   */
  /**
   * ENGINE-DRIVEN MODE: Advance to next step in journey
   */
  async advanceToNextStep(conversationId: string): Promise<void> {
    const state = this.activeJourneys.get(conversationId);
    if (!state || state.completed) {
      return;
    }

    // Increment step index
    state.currentStepIndex++;
    console.log('[Journey] Advanced to step index:', state.currentStepIndex);

    // Update database session
    try {
      const dbSession = await storage.getJourneySessionByConversationId(conversationId);
      if (dbSession) {
        await storage.updateJourneySession(dbSession.id, {
          currentStepIndex: state.currentStepIndex,
        });
      }
    } catch (error) {
      console.error('[Journey] Error updating step index in database:', error);
    }
  }

  async completeJourney(conversationId: string): Promise<void> {
    const state = this.activeJourneys.get(conversationId);
    if (!state) {
      console.warn('[Journey] Cannot complete - no active journey for conversation:', conversationId);
      return;
    }
    
    // Mark in-memory state as completed
    state.completed = true;
    console.log('[Journey] Journey completed for conversation:', conversationId);
    
    // Mark as completed in database
    try {
      const dbSession = await storage.getJourneySessionByConversationId(conversationId);
      if (dbSession) {
        await storage.updateJourneySession(dbSession.id, {
          completed: 'true',
          completedAt: new Date(),
        });
      }
    } catch (error) {
      console.error('[Journey] Error marking session as completed:', error);
    }
    
    // Auto-reset completed journeys to free memory (after small delay for message delivery)
    setTimeout(() => {
      this.resetJourney(conversationId);
    }, 5000);
  }

  async resetJourney(conversationId: string): Promise<void> {
    const state = this.activeJourneys.get(conversationId);
    
    // Clear in-memory state only (preserve database sessions for analytics)
    this.activeJourneys.delete(conversationId);
    
    if (state) {
      this.removeFromUserIndex(state.userId, state.businessAccountId, conversationId);
    }
    
    console.log('[Journey] Reset in-memory journey state for conversation:', conversationId);
    // Note: Database sessions are preserved for analytics. They are marked as completed/abandoned elsewhere.
  }

  async getAllResponses(conversationId: string): Promise<Map<string, string>> {
    const state = this.activeJourneys.get(conversationId);
    if (!state) {
      return new Map();
    }
    return state.responses;
  }
  
  // Check if journey is active for this specific conversation
  isJourneyForConversation(conversationId: string): boolean {
    return this.activeJourneys.has(conversationId) && !this.activeJourneys.get(conversationId)!.completed;
  }

  /**
   * Determine the next step index based on conditional branching rules
   * Returns the index of the next step to execute
   */
  private async determineNextStep(
    currentStep: any,
    userResponse: string,
    allSteps: any[],
    currentIndex: number
  ): Promise<number> {
    // Check if current step has branching conditions
    if (!currentStep.branchingCondition) {
      // No branching - go to next sequential step, but skip conditional steps
      return this.findNextNonConditionalStep(allSteps, currentIndex + 1);
    }

    try {
      const branchingConfig = JSON.parse(currentStep.branchingCondition);
      
      // New format: { "routes": [...], "defaultNextStepId": null }
      if (branchingConfig.routes && Array.isArray(branchingConfig.routes)) {
        // Normalize user response: trim whitespace and lowercase
        const normalizedResponse = userResponse.trim().toLowerCase();
        
        // Evaluate each route condition in order
        for (const route of branchingConfig.routes) {
          const { matchType, matchValue, targetStepId } = route;
          
          let isMatch = false;
          
          switch (matchType) {
            case 'contains':
              // Normalize match value for consistent comparison
              isMatch = normalizedResponse.includes(matchValue.trim().toLowerCase());
              break;
            case 'exact':
              // Exact match with normalization
              isMatch = normalizedResponse === matchValue.trim().toLowerCase();
              break;
            case 'regex':
              try {
                const regex = new RegExp(matchValue, 'i');
                isMatch = regex.test(userResponse.trim());
              } catch (e) {
                console.error('[Journey] Invalid regex pattern:', matchValue, e);
              }
              break;
            case 'any':
              // Always matches (fallback/else condition)
              isMatch = true;
              break;
            default:
              console.warn('[Journey] Unknown match type:', matchType);
          }
          
          if (isMatch && targetStepId) {
            // Find the index of the target step
            const targetIndex = allSteps.findIndex(s => s.id === targetStepId);
            
            if (targetIndex === -1) {
              console.warn('[Journey] Target step not found:', targetStepId);
              continue; // Try next route
            }
            
            // Validate: prevent loops and backward jumps
            if (targetIndex <= currentIndex) {
              console.warn('[Journey] Invalid branch target: cannot jump to same or earlier step (loop prevention)');
              continue; // Try next route
            }
            
            console.log(`[Journey] Branching: User said "${userResponse}" → Jumping to step ${targetIndex} (${allSteps[targetIndex].questionText})`);
            return targetIndex;
          }
        }
        
        // No route matched - use default next step if specified
        if (branchingConfig.defaultNextStepId) {
          const defaultIndex = allSteps.findIndex(s => s.id === branchingConfig.defaultNextStepId);
          if (defaultIndex !== -1 && defaultIndex > currentIndex) {
            console.log('[Journey] Using default branch to step:', defaultIndex);
            return defaultIndex;
          } else if (defaultIndex !== -1 && defaultIndex <= currentIndex) {
            console.warn('[Journey] Invalid default target: cannot jump to same or earlier step');
          }
        }
      }
      
      // Legacy format: { "if": "yes", "goToStep": 5 } - for backward compatibility
      if (branchingConfig.if && branchingConfig.goToStep !== undefined) {
        const normalizedResponse = userResponse.trim().toLowerCase();
        const condition = branchingConfig.if.trim().toLowerCase();
        
        if (normalizedResponse.includes(condition)) {
          const targetStep = Number(branchingConfig.goToStep);
          if (targetStep > currentIndex) {
            console.log(`[Journey] Legacy branching: condition "${condition}" matched → Step ${targetStep}`);
            return targetStep;
          }
        }
      }
    } catch (error) {
      console.error('[Journey] Error parsing branching condition:', error);
    }

    // Default: go to next sequential step, but skip conditional steps
    return this.findNextNonConditionalStep(allSteps, currentIndex + 1);
  }

  // Helper: Check if a step is marked as conditional
  private isStepConditional(step: any): boolean {
    // Normalize isConditional to handle string, boolean, or null values
    return step.isConditional === "true" || step.isConditional === true;
  }

  // Helper: Find next step that is not conditional (skips over conditional steps)
  // Used during normal progression - conditional steps are only shown when explicitly jumped to
  private findNextNonConditionalStep(allSteps: any[], startIndex: number): number {
    let nextIndex = startIndex;
    
    console.log('[Journey] findNextNonConditionalStep called with startIndex:', startIndex);
    
    while (nextIndex < allSteps.length) {
      const step = allSteps[nextIndex];
      console.log(`[Journey] Checking step at index ${nextIndex}:`, {
        stepId: step.id,
        questionText: step.questionText?.substring(0, 30),
        isConditional: step.isConditional,
        isConditionalType: typeof step.isConditional,
        isConditionalNormalized: this.isStepConditional(step)
      });
      
      if (!this.isStepConditional(step)) {
        // Found a non-conditional step
        console.log(`[Journey] Found non-conditional step at index ${nextIndex}`);
        return nextIndex;
      }
      console.log(`[Journey] Skipping conditional step at index ${nextIndex}: "${step.questionText?.substring(0, 30) || step.toolTrigger}"`);
      nextIndex++;
    }
    
    // All remaining steps are conditional, return the end index (will complete journey)
    console.log(`[Journey] All remaining steps are conditional, completing journey at index: ${nextIndex}`);
    return nextIndex;
  }
}

export const journeyService = new JourneyService();
