import { db } from "../db";
import {
  instagramFlows,
  instagramFlowSteps,
  instagramFlowSessions,
  instagramSettings,
  businessAccounts,
  type InstagramFlow,
  type InstagramFlowStep,
  type InstagramFlowSession,
} from "@shared/schema";
import { eq, and, desc, sql, asc, ne, gte } from "drizzle-orm";
import OpenAI from "openai";

interface FlowStepOptions {
  buttons?: { id: string; title: string }[];
  inputValidation?: string;
  requiredFields?: string[];
  selectedFields?: { fieldKey: string; fieldLabel: string; isRequired: boolean }[];
}

interface NextStepMapping {
  [optionId: string]: string;
}

interface ProcessResult {
  handled: boolean;
  response?: {
    type: "text" | "buttons";
    text: string;
    buttons?: { id: string; title: string }[];
  };
  shouldFallbackToAI?: boolean;
  flowCompleted?: boolean;
  collectedData?: Record<string, any>;
  sessionId?: string;
}

export class InstagramFlowService {
  private readonly DEFAULT_SESSION_TIMEOUT_MINUTES = 30;

  private readonly CACHE_TTL_MS = 60000;
  private flowCache = new Map<string, { data: InstagramFlow | null; ts: number }>();
  private stepsCache = new Map<string, { data: InstagramFlowStep[]; ts: number }>();
  private apiKeyCache = new Map<string, { data: { apiKey: string | null; name: string | null }; ts: number }>();

  private getCached<T>(cache: Map<string, { data: T; ts: number }>, key: string): T | undefined {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < this.CACHE_TTL_MS) {
      return entry.data;
    }
    return undefined;
  }

  invalidateFlowCache(businessAccountId: string): void {
    this.flowCache.delete(businessAccountId);
    this.stepsCache.clear();
  }

  private async getApiKeyForBusiness(businessAccountId: string): Promise<{ apiKey: string | null; name: string | null }> {
    const cached = this.getCached(this.apiKeyCache, businessAccountId);
    if (cached) {
      return cached;
    }
    const [account] = await db
      .select({ openaiApiKey: businessAccounts.openaiApiKey, name: businessAccounts.name })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId))
      .limit(1);
    const result = { apiKey: account?.openaiApiKey || null, name: account?.name || null };
    this.apiKeyCache.set(businessAccountId, { data: result, ts: Date.now() });
    return result;
  }

  private normalizeFieldName(field: string): string {
    return field.replace(/[.\s,;:!?]+$/, '').trim();
  }

  private findFieldValue(data: Record<string, any>, fieldName: string): any {
    if (data[fieldName] !== undefined) return data[fieldName];
    const normalized = this.normalizeFieldName(fieldName);
    if (normalized !== fieldName && data[normalized] !== undefined) return data[normalized];
    for (const key of Object.keys(data)) {
      if (this.normalizeFieldName(key) === normalized) return data[key];
    }
    return undefined;
  }

  private hasFieldValue(data: Record<string, any>, fieldName: string): boolean {
    const val = this.findFieldValue(data, fieldName);
    return val !== undefined && val !== null && val !== "";
  }

  async extractFieldsWithAI(
    businessAccountId: string,
    message: string,
    requiredFields: string[],
    alreadyCollected: Record<string, any> = {}
  ): Promise<{ extracted: Record<string, any>; missing: string[]; followUp?: string }> {
    const { apiKey, name: businessName } = await this.getApiKeyForBusiness(businessAccountId);
    if (!apiKey) {
      console.warn(`[Instagram Flow] OpenAI API key not configured for business ${businessAccountId}`);
      return { extracted: {}, missing: requiredFields };
    }

    const openaiClient = new OpenAI({ apiKey, timeout: 30000 });

    const fieldsToExtract = requiredFields.filter(f => !this.hasFieldValue(alreadyCollected, f));

    const formatField = (field: string) =>
      this.normalizeFieldName(field).replace(/_/g, " ").replace(/([A-Z])/g, " $1").toLowerCase().trim();

    const collectedList = Object.entries(alreadyCollected)
      .filter(([k, v]) => v !== null && v !== undefined && !k.startsWith('_'))
      .map(([k, v]) => `${formatField(k)}: ${v}`)
      .join(", ");

    const normalizedFieldsToExtract = fieldsToExtract.map(f => this.normalizeFieldName(f));

    const prompt = `You are a friendly assistant for "${businessName || 'our company'}". Extract information from the user's message AND generate a follow-up if needed.

Fields to extract: ${normalizedFieldsToExtract.join(", ")}
Information already collected: ${collectedList || "None yet"}

User message: "${message}"

Return ONLY a valid JSON object with:
1. "extracted": object with field values found (use null for fields not mentioned)
2. "followUp": if any fields are still missing after extraction, write a SHORT friendly response (2-3 sentences max) that acknowledges what the user said and naturally asks for the remaining info. If all fields are found, set to null.

Rules for followUp:
- Be conversational and natural, not robotic
- If they asked a question, answer it briefly then ask for missing info
- If they expressed concern, reassure them briefly
- Don't use bullet points or numbered lists
- Respond in the SAME LANGUAGE the customer used

Example: {"extracted": {"name": "John", "dob": null}, "followUp": "Thanks John! I just need your date of birth to continue."}`;

    try {
      const response = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content?.trim() || "{}";
      const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        console.warn(`[Instagram Flow] AI returned invalid JSON, falling back to static: ${cleanJson.substring(0, 200)}`);
        return { extracted: alreadyCollected, missing: requiredFields.filter(f => !this.hasFieldValue(alreadyCollected, f)) };
      }

      const extractedFields = parsed.extracted || parsed;
      const allExtracted = { ...alreadyCollected };
      for (const [key, value] of Object.entries(extractedFields)) {
        if (value !== null && value !== undefined && value !== "") {
          // Never overwrite a value already set by a structured step (dropdown/button).
          // The AI prompt excludes already-collected fields, but the model may still
          // return them and clobber the canonical mapped value with the display label.
          if (!this.hasFieldValue(alreadyCollected, key)) {
            allExtracted[key] = value;
          }
        }
      }

      const missing = requiredFields.filter(f => !this.hasFieldValue(allExtracted, f));

      console.log(`[Instagram Flow] AI Extraction - Extracted: ${JSON.stringify(allExtracted)}, Missing: ${missing.join(", ")}`);

      return { extracted: allExtracted, missing, followUp: parsed.followUp || undefined };
    } catch (error) {
      console.error("[Instagram Flow] AI extraction error:", error);
      return { extracted: alreadyCollected, missing: requiredFields.filter(f => !this.hasFieldValue(alreadyCollected, f)) };
    }
  }

  generateMissingFieldsPromptStatic(missingFields: string[]): string {
    if (missingFields.length === 0) return "";

    const formatField = (field: string) =>
      this.normalizeFieldName(field).replace(/_/g, " ").replace(/([A-Z])/g, " $1").toLowerCase().trim();

    const formatted = missingFields.map(formatField);

    if (formatted.length === 1) {
      return `Thanks! I still need your ${formatted[0]}. Please share it.`;
    } else if (formatted.length === 2) {
      return `Thanks! I still need your ${formatted[0]} and ${formatted[1]}. Please share them.`;
    } else {
      const lastField = formatted.pop();
      return `Thanks! I still need your ${formatted.join(", ")}, and ${lastField}. Please share them.`;
    }
  }

  async detectTextStepIntent(
    businessAccountId: string,
    userMessage: string,
    stepPrompt: string,
    saveToField: string | null,
    inputValidation: string | null
  ): Promise<{ intent: "answer" | "question" | "invalid"; response: string; cleanValue?: string }> {
    const { apiKey, name: accountName } = await this.getApiKeyForBusiness(businessAccountId);
    if (!apiKey) {
      return { intent: "answer", response: "" };
    }

    const openaiClient = new OpenAI({ apiKey, timeout: 30000 });

    const fieldLabel = saveToField
      ? saveToField.replace(/_/g, " ").replace(/([A-Z])/g, " $1").toLowerCase().trim()
      : "information";

    let validationHint = "";
    if (inputValidation) {
      const validationMap: Record<string, string> = {
        number: "a numeric value (digits only)",
        email: "a valid email address",
        phone: "a phone number",
        date: "a date",
        url: "a valid URL",
        percentage: "a percentage (0-100)",
      };
      validationHint = validationMap[inputValidation] || inputValidation;
    }

    const prompt = `You are an intelligent assistant for "${accountName || 'our company'}". A customer is in an Instagram conversation flow and was asked a question. Analyze if their reply is a valid answer or something else.

STEP QUESTION ASKED: "${stepPrompt}"
EXPECTED ANSWER: ${fieldLabel}${validationHint ? ` (should be ${validationHint})` : ""}

CUSTOMER REPLY: "${userMessage}"

Classify the intent as one of:
- "answer": The reply is a genuine attempt to answer the question (even if oddly phrased, abbreviated, or in another language). Numbers, names, dates, or short factual replies count as answers.
- "question": The reply is a question, concern, complaint, or off-topic remark that does NOT answer what was asked.
- "invalid": The reply looks like an answer attempt but the format is clearly wrong.

For "answer" intent, also extract the CLEAN VALUE — the precise data point the question is asking for, stripped of conversational filler.
Examples:
- Question: "What is your email?" Reply: "my email is john@mail.com" → cleanValue: "john@mail.com"
- Question: "What is your name?" Reply: "I am Rahul Kumar" → cleanValue: "Rahul Kumar"

For "question" and "invalid" intents, generate a SHORT response (1-2 sentences):
- For "question": Provide a brief helpful answer if possible, then gently redirect them to answer the original question.
- For "invalid": Politely explain the expected format and re-ask.

IMPORTANT: Respond in the SAME LANGUAGE the customer used.

Return ONLY a valid JSON object:
{"intent": "answer|question|invalid", "response": "your response text (empty for answer)", "cleanValue": "extracted value (only for answer intent)"}`;

    try {
      const response = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 300,
      });

      const content = response.choices[0]?.message?.content?.trim() || "{}";
      const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      const validIntents = ["answer", "question", "invalid"];
      if (!validIntents.includes(parsed.intent)) {
        parsed.intent = "answer";
      }

      console.log(`[Instagram Flow] Text Step Intent - Intent: ${parsed.intent}, CleanValue: "${parsed.cleanValue || ''}", Response: "${parsed.response || ''}"`);
      return { intent: parsed.intent, response: parsed.response || "", cleanValue: parsed.cleanValue || undefined };
    } catch (error) {
      console.error("[Instagram Flow] Text step intent detection error:", error);
      return { intent: "answer", response: "" };
    }
  }

  private staticValidateInput(value: string, validationType: string): { valid: boolean; message: string } {
    const trimmed = value.trim();
    switch (validationType) {
      case "number": {
        const num = trimmed.replace(/[,%]/g, "");
        if (!/^-?\d+(\.\d+)?$/.test(num)) {
          return { valid: false, message: "Please enter a valid number." };
        }
        return { valid: true, message: "" };
      }
      case "percentage": {
        const pct = trimmed.replace(/[%]/g, "").trim();
        const n = parseFloat(pct);
        if (isNaN(n) || n < 0 || n > 100) {
          return { valid: false, message: "Please enter a valid percentage between 0 and 100." };
        }
        return { valid: true, message: "" };
      }
      case "email": {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          return { valid: false, message: "Please enter a valid email address (e.g., name@example.com)." };
        }
        return { valid: true, message: "" };
      }
      case "phone": {
        const digits = trimmed.replace(/[\s\-\(\)\+]/g, "");
        if (!/^\d{10}$/.test(digits)) {
          return { valid: false, message: "Please enter a valid 10-digit mobile number." };
        }
        return { valid: true, message: "" };
      }
      case "url": {
        if (!/^https?:\/\/.+\..+/.test(trimmed) && !/^www\..+\..+/.test(trimmed)) {
          return { valid: false, message: "Please enter a valid URL (e.g., https://example.com)." };
        }
        return { valid: true, message: "" };
      }
      case "date": {
        if (!/\d/.test(trimmed) || trimmed.length < 4) {
          return { valid: false, message: "Please enter a valid date (e.g., 15/01/2000 or Jan 15 2000)." };
        }
        return { valid: true, message: "" };
      }
      default:
        return { valid: true, message: "" };
    }
  }

  async getActiveFlow(businessAccountId: string): Promise<InstagramFlow | null> {
    const cached = this.getCached(this.flowCache, businessAccountId);
    if (cached !== undefined) {
      return cached;
    }
    const [flow] = await db
      .select()
      .from(instagramFlows)
      .where(
        and(
          eq(instagramFlows.businessAccountId, businessAccountId),
          eq(instagramFlows.isActive, "true")
        )
      )
      .limit(1);
    const result = flow || null;
    this.flowCache.set(businessAccountId, { data: result, ts: Date.now() });
    return result;
  }

  async getFlowSteps(flowId: string): Promise<InstagramFlowStep[]> {
    const cached = this.getCached(this.stepsCache, flowId);
    if (cached !== undefined) {
      return cached;
    }
    const steps = await db
      .select()
      .from(instagramFlowSteps)
      .where(eq(instagramFlowSteps.flowId, flowId))
      .orderBy(asc(instagramFlowSteps.stepOrder));

    this.stepsCache.set(flowId, { data: steps, ts: Date.now() });
    return steps;
  }

  async getStepByKey(flowId: string, stepKey: string): Promise<InstagramFlowStep | null> {
    const [step] = await db
      .select()
      .from(instagramFlowSteps)
      .where(
        and(
          eq(instagramFlowSteps.flowId, flowId),
          eq(instagramFlowSteps.stepKey, stepKey)
        )
      )
      .limit(1);
    return step || null;
  }

  async getActiveSession(
    businessAccountId: string,
    senderId: string
  ): Promise<InstagramFlowSession | null> {
    const [session] = await db
      .select()
      .from(instagramFlowSessions)
      .where(
        and(
          eq(instagramFlowSessions.businessAccountId, businessAccountId),
          eq(instagramFlowSessions.senderId, senderId),
          eq(instagramFlowSessions.status, "active")
        )
      )
      .orderBy(desc(instagramFlowSessions.createdAt))
      .limit(1);

    if (!session) return null;

    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      console.log(`[Instagram Flow] Session ${session.id} has expired (expiresAt: ${session.expiresAt})`);
      await this.expireSession(session.id);
      return null;
    }

    const lastMessageTime = new Date(session.lastMessageAt);
    const now = new Date();
    const minutesSinceLastMessage = (now.getTime() - lastMessageTime.getTime()) / (1000 * 60);

    const flow = await this.getActiveFlow(businessAccountId);
    const timeoutMinutes = flow?.sessionTimeout || this.DEFAULT_SESSION_TIMEOUT_MINUTES;

    if (minutesSinceLastMessage > timeoutMinutes) {
      console.log(`[Instagram Flow] Session ${session.id} timed out after ${minutesSinceLastMessage.toFixed(1)} minutes (limit: ${timeoutMinutes} min)`);
      await this.expireSession(session.id);
      return null;
    }

    return session;
  }

  async startSession(
    businessAccountId: string,
    flowId: string,
    senderId: string,
    startStepKey: string,
    sessionTimeoutMinutes?: number
  ): Promise<InstagramFlowSession> {
    await db
      .update(instagramFlowSessions)
      .set({ status: "abandoned" })
      .where(
        and(
          eq(instagramFlowSessions.businessAccountId, businessAccountId),
          eq(instagramFlowSessions.senderId, senderId),
          eq(instagramFlowSessions.status, "active")
        )
      );

    let timeoutMinutes = sessionTimeoutMinutes;
    if (!timeoutMinutes) {
      const [flow] = await db.select().from(instagramFlows).where(eq(instagramFlows.id, flowId)).limit(1);
      timeoutMinutes = flow?.sessionTimeout || this.DEFAULT_SESSION_TIMEOUT_MINUTES;
    }

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + timeoutMinutes);

    const [session] = await db
      .insert(instagramFlowSessions)
      .values({
        businessAccountId,
        flowId,
        senderId,
        currentStepKey: startStepKey,
        status: "active",
        collectedData: {},
        lastMessageAt: new Date(),
        expiresAt,
      })
      .returning();

    console.log(`[Instagram Flow] Started new session for ${senderId}, step: ${startStepKey}`);
    return session;
  }

  async advanceSession(
    sessionId: string,
    nextStepKey: string,
    collectedData: Record<string, any>
  ): Promise<void> {
    await db
      .update(instagramFlowSessions)
      .set({
        currentStepKey: nextStepKey,
        collectedData,
        lastMessageAt: new Date(),
      })
      .where(eq(instagramFlowSessions.id, sessionId));

    console.log(`[Instagram Flow] Advanced session ${sessionId} to step: ${nextStepKey}`);
  }

  async completeSession(sessionId: string, collectedData: Record<string, any>): Promise<void> {
    await db
      .update(instagramFlowSessions)
      .set({
        status: "completed",
        collectedData,
        lastMessageAt: new Date(),
      })
      .where(eq(instagramFlowSessions.id, sessionId));

    console.log(`[Instagram Flow] Completed session ${sessionId}`);
  }

  async expireSession(sessionId: string): Promise<void> {
    await db
      .update(instagramFlowSessions)
      .set({ status: "expired" })
      .where(eq(instagramFlowSessions.id, sessionId));
  }

  async expireSessionsBySender(businessAccountId: string, senderId: string): Promise<void> {
    await db
      .update(instagramFlowSessions)
      .set({ status: "expired" })
      .where(
        and(
          eq(instagramFlowSessions.businessAccountId, businessAccountId),
          eq(instagramFlowSessions.senderId, senderId),
          ne(instagramFlowSessions.status, "expired")
        )
      );
  }

  async hasCompletedSessionRecently(businessAccountId: string, senderId: string): Promise<boolean> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [session] = await db
      .select({ id: instagramFlowSessions.id })
      .from(instagramFlowSessions)
      .where(
        and(
          eq(instagramFlowSessions.businessAccountId, businessAccountId),
          eq(instagramFlowSessions.senderId, senderId),
          eq(instagramFlowSessions.status, "completed"),
          gte(instagramFlowSessions.lastMessageAt, twentyFourHoursAgo)
        )
      )
      .limit(1);
    return !!session;
  }

  private buildStepResponse(step: InstagramFlowStep): ProcessResult["response"] {
    const options = step.options as FlowStepOptions | null;

    switch (step.type) {
      case "buttons":
        return {
          type: "buttons",
          text: step.prompt,
          buttons: options?.buttons || [],
        };

      case "text":
      case "input":
      case "end":
      default: {
        let messageText = step.prompt;

        if (options?.selectedFields && options.selectedFields.length > 0) {
          const fieldLines = options.selectedFields.map((f, index) => {
            const letter = String.fromCharCode(97 + index);
            const label = f.fieldLabel || f.fieldKey;
            const marker = f.isRequired ? '' : ' (optional)';
            return `${letter}. ${label}${marker}`;
          });

          messageText = `${messageText}\n\n${fieldLines.join('\n')}`;
        }

        return {
          type: "text",
          text: messageText,
        };
      }
    }
  }

  async processMessage(
    businessAccountId: string,
    senderId: string,
    message: string,
    prefetchedSession?: InstagramFlowSession | null
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    console.log(`[Instagram Flow] Processing message from ${senderId}: "${message}"`);

    const activeFlow = await this.getActiveFlow(businessAccountId);
    if (!activeFlow) {
      console.log(`[Instagram Flow] No active flow for business ${businessAccountId}`);
      return { handled: false, shouldFallbackToAI: true };
    }

    const steps = await this.getFlowSteps(activeFlow.id);
    console.log(`[Instagram Flow] [Timing] getActiveFlow+getFlowSteps: ${Date.now() - startTime}ms`);
    if (steps.length === 0) {
      console.log(`[Instagram Flow] Flow ${activeFlow.id} has no steps`);
      return { handled: false, shouldFallbackToAI: true };
    }

    const normalizedMessage = message.trim().toLowerCase();

    const triggerKeyword = activeFlow.triggerKeyword?.trim() || null;

    const isTriggerKeywordMatch = triggerKeyword &&
      triggerKeyword.length > 0 &&
      normalizedMessage === triggerKeyword.toLowerCase();

    const flowTimeout = activeFlow.sessionTimeout || this.DEFAULT_SESSION_TIMEOUT_MINUTES;

    if (isTriggerKeywordMatch) {
      console.log(`[Instagram Flow] Trigger keyword matched: "${activeFlow.triggerKeyword}" - restarting flow`);

      const startStep = this.getFirstActiveStep(steps);
      if (!startStep) {
        console.log(`[Instagram Flow] All steps are paused`);
        return { handled: false, shouldFallbackToAI: true };
      }
      const newSession = await this.startSession(
        businessAccountId,
        activeFlow.id,
        senderId,
        startStep.stepKey,
        flowTimeout
      );

      return {
        handled: true,
        response: this.buildStepResponse(startStep),
        sessionId: newSession.id,
      };
    }

    let session = prefetchedSession !== undefined ? prefetchedSession : await this.getActiveSession(businessAccountId, senderId);
    console.log(`[Instagram Flow] [Timing] getActiveSession: ${Date.now() - startTime}ms`);

    if (!session) {
      if (triggerKeyword) {
        console.log(`[Instagram Flow] Message doesn't match trigger keyword "${triggerKeyword}"`);
        return { handled: false, shouldFallbackToAI: activeFlow.fallbackToAI === "true" };
      }

      const recentlyCompleted = await this.hasCompletedSessionRecently(businessAccountId, senderId);
      if (recentlyCompleted) {
        console.log(`[Instagram Flow] Sender ${senderId} completed flow within last 24h, skipping flow and falling back to AI`);
        return { handled: false, shouldFallbackToAI: true };
      }

      const startStep = this.getFirstActiveStep(steps);
      if (!startStep) {
        console.log(`[Instagram Flow] All steps are paused`);
        return { handled: false, shouldFallbackToAI: true };
      }
      session = await this.startSession(
        businessAccountId,
        activeFlow.id,
        senderId,
        startStep.stepKey,
        flowTimeout
      );

      return {
        handled: true,
        response: this.buildStepResponse(startStep),
        sessionId: session.id,
      };
    }

    const currentStep = await this.getStepByKey(activeFlow.id, session.currentStepKey);
    if (!currentStep) {
      console.log(`[Instagram Flow] Current step not found: ${session.currentStepKey}`);
      await this.expireSession(session.id);
      return { handled: false, shouldFallbackToAI: true };
    }

    if (currentStep.paused) {
      console.log(`[Instagram Flow] Current step "${currentStep.stepKey}" is paused, auto-skipping to next active step`);
      const nextActiveKey = this.getNextStepKey(currentStep.stepKey, steps);
      if (!nextActiveKey) {
        await this.completeSession(session.id, (session.collectedData as Record<string, any>) || {});
        return {
          handled: true,
          flowCompleted: true,
          collectedData: (session.collectedData as Record<string, any>) || {},
          sessionId: session.id,
          response: { type: "text", text: activeFlow.completionMessage || "Thank you! Your information has been recorded." },
        };
      }
      const nextActiveStep = await this.getStepByKey(activeFlow.id, nextActiveKey);
      if (!nextActiveStep) {
        await this.completeSession(session.id, (session.collectedData as Record<string, any>) || {});
        return { handled: true, flowCompleted: true, collectedData: (session.collectedData as Record<string, any>) || {}, sessionId: session.id };
      }
      await this.advanceSession(session.id, nextActiveKey, (session.collectedData as Record<string, any>) || {});
      return {
        handled: true,
        response: this.buildStepResponse(nextActiveStep),
        sessionId: session.id,
      };
    }

    const collectedData = (session.collectedData as Record<string, any>) || {};

    const isTextInputStep = currentStep.type === "input" || currentStep.type === "text";
    if (currentStep.saveToField && !isTextInputStep) {
      collectedData[currentStep.saveToField] = message;
    }

    let nextStepKey: string | null = null;
    const options = currentStep.options as FlowStepOptions | null;
    const nextStepMapping = currentStep.nextStepMapping as NextStepMapping | null;

    const resolveNextStepKey = (stepKey: string | undefined | null): string | null => {
      if (!stepKey || stepKey === "__auto__" || stepKey === "") {
        for (let i = currentStep.stepOrder + 1; i < currentStep.stepOrder + steps.length; i++) {
          const nextStep = steps.find(s => s.stepOrder === i);
          if (nextStep && !nextStep.paused) {
            return nextStep.stepKey;
          }
          if (!nextStep) break;
        }
        return null;
      }
      const targetStep = steps.find(s => s.stepKey === stepKey);
      if (targetStep && targetStep.paused) {
        return this.getNextStepKey(stepKey, steps);
      }
      return stepKey;
    };

    if (currentStep.type === "buttons" && options?.buttons) {
      const selectedButton = options.buttons.find(
        (b) =>
          b.id.toLowerCase() === normalizedMessage ||
          b.title.toLowerCase() === normalizedMessage
      );

      if (selectedButton) {
        const mappedStep = nextStepMapping?.[selectedButton.id];
        nextStepKey = resolveNextStepKey(mappedStep || currentStep.defaultNextStep);
        collectedData[currentStep.saveToField || "selection"] = selectedButton.title;
      } else {
        console.log(`[Instagram Flow] Invalid button selection: "${message}" — re-prompting with buttons`);
        const repromptResponse = this.buildStepResponse(currentStep);
        repromptResponse.text = `Please select one of the options below.\n\n${repromptResponse.text}`;
        return {
          handled: true,
          response: repromptResponse,
          sessionId: session.id,
        };
      }
    } else if (currentStep.type === "input" || currentStep.type === "text") {
      const requiredFields = options?.requiredFields;
      const inputValidation = options?.inputValidation || null;

      if (!requiredFields || requiredFields.length === 0) {
        if (inputValidation) {
          const staticCheck = this.staticValidateInput(message, inputValidation);
          if (!staticCheck.valid) {
            console.log(`[Instagram Flow] Static validation failed for "${inputValidation}": "${message}"`);
            await this.advanceSession(session.id, session.currentStepKey, collectedData);
            return {
              handled: true,
              response: { type: "text", text: staticCheck.message },
              sessionId: session.id,
            };
          }
        }

        const intentResult = await this.detectTextStepIntent(
          businessAccountId,
          message,
          currentStep.prompt,
          currentStep.saveToField,
          inputValidation
        );

        if (intentResult.intent === "question" || intentResult.intent === "invalid") {
          console.log(`[Instagram Flow] Text step intent: ${intentResult.intent} — re-prompting step "${currentStep.stepKey}"`);
          await this.advanceSession(session.id, session.currentStepKey, collectedData);
          return {
            handled: true,
            response: {
              type: "text",
              text: intentResult.response,
            },
            sessionId: session.id,
          };
        }

        if (currentStep.saveToField) {
          collectedData[currentStep.saveToField] = intentResult.cleanValue || message;
        }
      }

      if (requiredFields && requiredFields.length > 0) {
        if (currentStep.saveToField) {
          collectedData[currentStep.saveToField] = message;
        }

        const { extracted, missing, followUp } = await this.extractFieldsWithAI(
          businessAccountId,
          message,
          requiredFields,
          collectedData
        );

        Object.assign(collectedData, extracted);

        if (missing.length > 0) {
          console.log(`[Instagram Flow] Missing fields: ${missing.join(", ")}`);
          await this.advanceSession(session.id, session.currentStepKey, collectedData);

          const followUpMessage = followUp || this.generateMissingFieldsPromptStatic(missing);
          return {
            handled: true,
            response: {
              type: "text",
              text: followUpMessage,
            },
            sessionId: session.id,
          };
        }

        console.log(`[Instagram Flow] All required fields collected: ${JSON.stringify(extracted)}`);
      }

      nextStepKey = resolveNextStepKey(currentStep.defaultNextStep);
    } else if (currentStep.type === "end") {
      await this.completeSession(session.id, collectedData);
      return {
        handled: true,
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
        response: {
          type: "text",
          text: currentStep.prompt || activeFlow.completionMessage || "Thank you! Your information has been recorded.",
        },
      };
    } else {
      nextStepKey = resolveNextStepKey(currentStep.defaultNextStep);
    }

    const completionMsg = activeFlow.completionMessage || "Thank you! Your information has been recorded.";

    if (!nextStepKey) {
      await this.completeSession(session.id, collectedData);
      return {
        handled: true,
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
        response: {
          type: "text",
          text: completionMsg,
        },
      };
    }

    if (nextStepKey === "end" || nextStepKey === "complete") {
      await this.completeSession(session.id, collectedData);
      return {
        handled: true,
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
        response: {
          type: "text",
          text: completionMsg,
        },
      };
    }

    const nextStep = await this.getStepByKey(activeFlow.id, nextStepKey);
    if (!nextStep) {
      console.log(`[Instagram Flow] Next step not found: ${nextStepKey}`);
      await this.completeSession(session.id, collectedData);
      return {
        handled: true,
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
      };
    }

    await this.advanceSession(session.id, nextStepKey, collectedData);

    if (nextStep.type === "end") {
      await this.completeSession(session.id, collectedData);
      console.log(`[Instagram Flow] [Timing] processMessage total: ${Date.now() - startTime}ms`);
      return {
        handled: true,
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
        response: {
          type: "text",
          text: nextStep.prompt,
        },
      };
    }

    console.log(`[Instagram Flow] [Timing] processMessage total: ${Date.now() - startTime}ms`);
    return {
      handled: true,
      response: this.buildStepResponse(nextStep),
      collectedData: Object.keys(collectedData).length > 0 ? collectedData : undefined,
      sessionId: session.id,
    };
  }

  async getAllFlows(businessAccountId: string): Promise<InstagramFlow[]> {
    return await db
      .select()
      .from(instagramFlows)
      .where(eq(instagramFlows.businessAccountId, businessAccountId))
      .orderBy(desc(instagramFlows.createdAt));
  }

  async createFlow(
    businessAccountId: string,
    name: string,
    description?: string,
    completionMessage?: string
  ): Promise<InstagramFlow> {
    const [flow] = await db
      .insert(instagramFlows)
      .values({
        businessAccountId,
        name,
        description,
        isActive: "false",
        fallbackToAI: "true",
        ...(completionMessage ? { completionMessage } : {}),
      })
      .returning();

    console.log(`[Instagram Flow] Created flow: ${flow.id}`);
    this.invalidateFlowCache(businessAccountId);
    return flow;
  }

  async updateFlow(
    flowId: string,
    updates: Partial<{
      name: string;
      description: string | null;
      isActive: string;
      triggerKeyword: string | null;
      fallbackToAI: string;
      sessionTimeout: number | null;
      completionMessage: string | null;
    }>
  ): Promise<InstagramFlow | null> {
    if (updates.isActive === "true") {
      const [flow] = await db.select().from(instagramFlows).where(eq(instagramFlows.id, flowId));
      if (flow) {
        await db
          .update(instagramFlows)
          .set({ isActive: "false" })
          .where(
            and(
              eq(instagramFlows.businessAccountId, flow.businessAccountId),
              sql`${instagramFlows.id} != ${flowId}`
            )
          );
      }
    }

    const [updated] = await db
      .update(instagramFlows)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(instagramFlows.id, flowId))
      .returning();

    if (updated) this.invalidateFlowCache(updated.businessAccountId);
    return updated || null;
  }

  async deleteFlow(flowId: string): Promise<void> {
    const [flow] = await db.select({ bid: instagramFlows.businessAccountId }).from(instagramFlows).where(eq(instagramFlows.id, flowId)).limit(1);
    await db.delete(instagramFlows).where(eq(instagramFlows.id, flowId));
    if (flow) this.invalidateFlowCache(flow.bid);
    console.log(`[Instagram Flow] Deleted flow: ${flowId}`);
  }

  async createStep(
    flowId: string,
    stepData: {
      stepKey: string;
      stepOrder: number;
      type: string;
      prompt: string;
      options?: FlowStepOptions;
      nextStepMapping?: NextStepMapping;
      defaultNextStep?: string;
      saveToField?: string;
    }
  ): Promise<InstagramFlowStep> {
    const [step] = await db
      .insert(instagramFlowSteps)
      .values({
        flowId,
        ...stepData,
      })
      .returning();

    console.log(`[Instagram Flow] Created step: ${step.id} (${step.stepKey})`);
    this.stepsCache.delete(flowId);
    return step;
  }

  async updateStep(
    stepId: string,
    updates: Partial<{
      stepKey: string;
      stepOrder: number;
      type: string;
      prompt: string;
      options: FlowStepOptions;
      nextStepMapping: NextStepMapping;
      defaultNextStep: string;
      saveToField: string;
    }>
  ): Promise<InstagramFlowStep | null> {
    const [updated] = await db
      .update(instagramFlowSteps)
      .set(updates)
      .where(eq(instagramFlowSteps.id, stepId))
      .returning();

    if (updated) this.stepsCache.delete(updated.flowId);
    return updated || null;
  }

  async deleteStep(stepId: string): Promise<void> {
    const [stepToDelete] = await db
      .select()
      .from(instagramFlowSteps)
      .where(eq(instagramFlowSteps.id, stepId))
      .limit(1);

    if (!stepToDelete) {
      console.log(`[Instagram Flow] Step not found for deletion: ${stepId}`);
      return;
    }

    const flowId = stepToDelete.flowId;

    const deletedStepKey = stepToDelete.stepKey;

    await db.delete(instagramFlowSteps).where(eq(instagramFlowSteps.id, stepId));
    console.log(`[Instagram Flow] Deleted step: ${stepId}`);

    const remainingSteps = await db
      .select()
      .from(instagramFlowSteps)
      .where(eq(instagramFlowSteps.flowId, flowId))
      .orderBy(instagramFlowSteps.stepOrder);

    const keyMapping: Record<string, string> = {};
    for (let i = 0; i < remainingSteps.length; i++) {
      const oldKey = remainingSteps[i].stepKey;
      const newKey = String(i + 1);
      if (oldKey !== newKey) {
        keyMapping[oldKey] = newKey;
      }
    }

    for (let i = 0; i < remainingSteps.length; i++) {
      const newKey = String(i + 1);
      await db
        .update(instagramFlowSteps)
        .set({ stepOrder: i, stepKey: newKey })
        .where(eq(instagramFlowSteps.id, remainingSteps[i].id));
    }

    await this.updateGoToReferences(flowId, keyMapping, deletedStepKey);

    this.stepsCache.delete(flowId);
    console.log(`[Instagram Flow] Renumbered ${remainingSteps.length} remaining steps with new stepKeys`);
  }

  private async updateGoToReferences(
    flowId: string,
    keyMapping: Record<string, string>,
    deletedStepKey?: string
  ): Promise<void> {
    const steps = await db
      .select()
      .from(instagramFlowSteps)
      .where(eq(instagramFlowSteps.flowId, flowId))
      .orderBy(instagramFlowSteps.stepOrder);

    const getNextStepKey = (currentStepOrder: number): string | null => {
      const nextStep = steps.find(s => s.stepOrder === currentStepOrder + 1);
      return nextStep ? keyMapping[nextStep.stepKey] || nextStep.stepKey : null;
    };

    for (const step of steps) {
      let needsUpdate = false;
      const options = step.options as any || {};
      let updatedOptions = { ...options };
      let updatedDefaultNextStep: string | null = step.defaultNextStep;

      if (step.defaultNextStep) {
        if (deletedStepKey && step.defaultNextStep === deletedStepKey) {
          const nextKey = getNextStepKey(step.stepOrder);
          updatedDefaultNextStep = nextKey;
          needsUpdate = true;
        } else if (keyMapping[step.defaultNextStep]) {
          updatedDefaultNextStep = keyMapping[step.defaultNextStep];
          needsUpdate = true;
        }
      }

      if (options.buttons && Array.isArray(options.buttons)) {
        updatedOptions.buttons = options.buttons.map((btn: any) => {
          if (btn.nextStep) {
            if (deletedStepKey && btn.nextStep === deletedStepKey) {
              needsUpdate = true;
              const nextKey = getNextStepKey(step.stepOrder);
              return { ...btn, nextStep: nextKey || undefined };
            }
            if (keyMapping[btn.nextStep]) {
              needsUpdate = true;
              return { ...btn, nextStep: keyMapping[btn.nextStep] };
            }
          }
          return btn;
        });
      }

      if (step.nextStepMapping) {
        const nextStepMapping = step.nextStepMapping as Record<string, string>;
        let updatedMapping: Record<string, string> = {};
        let mappingNeedsUpdate = false;

        for (const [key, value] of Object.entries(nextStepMapping)) {
          if (deletedStepKey && value === deletedStepKey) {
            const nextKey = getNextStepKey(step.stepOrder);
            if (nextKey) {
              updatedMapping[key] = nextKey;
            }
            mappingNeedsUpdate = true;
          } else if (keyMapping[value]) {
            updatedMapping[key] = keyMapping[value];
            mappingNeedsUpdate = true;
          } else {
            updatedMapping[key] = value;
          }
        }

        if (mappingNeedsUpdate) {
          needsUpdate = true;
          await db
            .update(instagramFlowSteps)
            .set({ nextStepMapping: updatedMapping })
            .where(eq(instagramFlowSteps.id, step.id));
        }
      }

      if (needsUpdate) {
        await db
          .update(instagramFlowSteps)
          .set({
            options: updatedOptions,
            defaultNextStep: updatedDefaultNextStep
          })
          .where(eq(instagramFlowSteps.id, step.id));
        console.log(`[Instagram Flow] Updated Go-to references in step ${step.id}`);
      }
    }
  }

  async reorderSteps(flowId: string, stepIds: string[]): Promise<void> {
    const existingSteps = await db
      .select()
      .from(instagramFlowSteps)
      .where(eq(instagramFlowSteps.flowId, flowId));

    const existingIds = new Set(existingSteps.map((s) => s.id));
    const stepMap = new Map(existingSteps.map((s) => [s.id, s]));

    const validStepIds = stepIds.filter((id) => existingIds.has(id));

    if (validStepIds.length === 0) {
      console.log(`[Instagram Flow] No valid step IDs provided for reordering flow ${flowId}`);
      return;
    }

    const keyMapping: Record<string, string> = {};
    for (let i = 0; i < validStepIds.length; i++) {
      const step = stepMap.get(validStepIds[i]);
      if (step) {
        const oldKey = step.stepKey;
        const newKey = String(i + 1);
        if (oldKey !== newKey) {
          keyMapping[oldKey] = newKey;
        }
      }
    }

    for (let i = 0; i < validStepIds.length; i++) {
      const newKey = String(i + 1);
      await db
        .update(instagramFlowSteps)
        .set({ stepOrder: i, stepKey: newKey })
        .where(
          and(
            eq(instagramFlowSteps.id, validStepIds[i]),
            eq(instagramFlowSteps.flowId, flowId)
          )
        );
    }

    if (Object.keys(keyMapping).length > 0) {
      await this.updateGoToReferences(flowId, keyMapping);
    }

    this.stepsCache.delete(flowId);
    console.log(`[Instagram Flow] Reordered ${validStepIds.length} steps for flow ${flowId} with updated stepKeys`);
  }

  private getNextStepKey(currentStepKey: string, steps: InstagramFlowStep[]): string | null {
    const currentIndex = steps.findIndex(s => s.stepKey === currentStepKey);
    if (currentIndex >= 0) {
      for (let i = currentIndex + 1; i < steps.length; i++) {
        if (!steps[i].paused) {
          return steps[i].stepKey;
        }
      }
    }
    return null;
  }

  private getFirstActiveStep(steps: InstagramFlowStep[]): InstagramFlowStep | null {
    return steps.find(s => !s.paused) || null;
  }
}

export const instagramFlowService = new InstagramFlowService();
