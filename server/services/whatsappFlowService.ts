import { db } from "../db";
import {
  whatsappFlows,
  whatsappFlowSteps,
  whatsappFlowSessions,
  whatsappSettings,
  whatsappLeads,
  whatsappLeadAttachments,
  businessAccounts,
  customCrmSettings,
  customCrmFieldMappings,
  crmStoreCredentials,
  type WhatsappFlow,
  type WhatsappFlowStep,
  type WhatsappFlowSession,
} from "@shared/schema";
import { eq, and, desc, sql, asc, ne, gte, ilike } from "drizzle-orm";
import OpenAI from "openai";

function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-\(\)]/g, '');
  p = p.replace(/^\+91/, '').replace(/^91(?=\d{10}$)/, '').replace(/^0/, '');
  return p;
}

// Task #4 — gated diagnostic logger for verification flow. Logs ONLY when
// VERIFICATION_DEBUG_BIZ_ID env var matches the businessAccountId, so we can
// safely leave logs in place in production without spamming. Caller MUST NOT
// pass PII (names, doc numbers, phone numbers, raw field values) — only doc
// types, counts, rule IDs, code paths.
function verifDebug(businessAccountId: string | null | undefined, where: string, extra?: Record<string, any>): void {
  const target = process.env.VERIFICATION_DEBUG_BIZ_ID;
  if (!target || !businessAccountId || target !== businessAccountId) return;
  const safe = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[VerificationDebug] ${where} biz=${businessAccountId}${safe}`);
}

interface FlowStepOptions {
  buttons?: { id: string; title: string }[];
  dropdownItems?: { id: string; title: string; value: string; followUpPrompt?: string }[];
  sections?: { title: string; rows: { id: string; title: string; description?: string }[] }[];
  buttonText?: string;
  inputValidation?: string;
  requiredFields?: string[]; // For text/input type - required fields to extract
  selectedFields?: { fieldKey: string; fieldLabel: string; isRequired: boolean }[]; // All selected fields with required/optional flag
  documentTypes?: { docType: string; label: string; isMandatory: boolean }[]; // For upload type - document types to collect
  // Dependent / cascading dropdown support
  dependsOnField?: string;   // Single parent field (e.g. "dealer_name")
  dependsOnFields?: string[]; // Multiple parent fields for composite key (e.g. ["dealer_name","city_name"])
  conditionalOptions?: { [compositeKey: string]: { id: string; title: string; value: string; followUpPrompt?: string }[] }; // Options per parent value/combo
  fallbackOptions?: { id: string; title: string; value: string; followUpPrompt?: string }[]; // Shown when parent value not matched
}

interface NextStepMapping {
  [optionId: string]: string;
}

interface ProcessResult {
  handled: boolean;
  response?: {
    type: "text" | "buttons" | "list";
    text: string;
    buttons?: { id: string; title: string }[];
    sections?: { title: string; rows: { id: string; title: string; description?: string }[] }[];
    buttonText?: string;
  };
  preMessages?: {
    type: "text" | "buttons" | "list";
    text: string;
    buttons?: { id: string; title: string }[];
    sections?: { title: string; rows: { id: string; title: string; description?: string }[] }[];
    buttonText?: string;
  }[];
  shouldFallbackToAI?: boolean;
  flowCompleted?: boolean;
  collectedData?: Record<string, any>;
  sessionId?: string;
  rejectedDuplicate?: boolean;
  skipLeadCreation?: boolean;
}

interface DocTypeState {
  status: 'pending' | 'processing' | 'complete' | 'duplicate' | 'mismatched';
  pages: { side: string; extractedData: Record<string, any>; confidence: number; sourceMediaUrl?: string }[];
  mergedData: Record<string, any>;
  dupInfo?: { docLabel: string; maskedNum: string; leadId: string };
}

interface DocumentState {
  [docType: string]: DocTypeState;
}

export class WhatsappFlowService {
  private readonly DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
  private readonly UPLOAD_DEBOUNCE_MS = 4000;
  private readonly uploadLocks = new Map<string, Promise<any>>();
  private readonly uploadAckSent = new Map<string, number>();
  private readonly pendingUploadCount = new Map<string, number>();
  private readonly uploadDebounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly uploadDebounceResolvers = new Map<string, { resolve: (cancelled: boolean) => void }>();
  private readonly pendingPdfPasswordKeys = new Set<string>();
  private readonly batchAcceptedCounts = new Map<string, number>();
  private readonly batchTotalProcessedCounts = new Map<string, number>();
  private readonly batchResponseSent = new Set<string>();
  private readonly batchPreExistingCompleted = new Map<string, Set<string>>();

  private readonly UPDATE_KEYWORDS = ["update", "add document", "add documents", "add doc", "modify", "change"];
  private readonly UPDATE_MENU_STEP = "__update_menu__";
  private readonly UPDATE_ADD_DOCS_STEP = "__update_add_docs__";
  private readonly UPDATE_DETAILS_STEP = "__update_details__";
  private readonly UPDATE_DETAILS_COLLECT_STEP = "__update_details_collect__";

  private readonly EXIT_KEYWORDS = ["stop", "cancel", "exit", "quit", "leave", "end", "no thanks", "not interested", "bye"];
  private readonly MAX_OFF_TOPIC_ATTEMPTS = 3;

  private readonly CACHE_TTL_MS = 60000;
  private flowCache = new Map<string, { data: WhatsappFlow | null; ts: number }>();
  private stepsCache = new Map<string, { data: WhatsappFlowStep[]; ts: number }>();
  private apiKeyCache = new Map<string, { data: { apiKey: string | null; name: string | null }; ts: number }>();

  private isAdaptiveJourneyEnabled(flow: WhatsappFlow, businessAccountId: string): boolean {
    if (flow.adaptiveMode !== "true") return false;
    if (process.env.WHATSAPP_ADAPTIVE_MODE_ENABLED === "false") return false;
    const allowlist = process.env.WHATSAPP_ADAPTIVE_MODE_ALLOWLIST
      ?.split(",")
      .map(id => id.trim())
      .filter(Boolean);
    return !allowlist?.length || allowlist.includes(businessAccountId);
  }

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

  private async withUploadLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.uploadLocks.get(lockKey) || Promise.resolve();
    const next = existing.then(fn, fn);
    this.uploadLocks.set(lockKey, next);
    try {
      return await next;
    } finally {
      if (this.uploadLocks.get(lockKey) === next) {
        this.uploadLocks.delete(lockKey);
      }
    }
  }

  private shouldSendAck(lockKey: string): boolean {
    const lastAck = this.uploadAckSent.get(lockKey);
    const now = Date.now();
    if (!lastAck || now - lastAck > 10000) {
      this.uploadAckSent.set(lockKey, now);
      return true;
    }
    return false;
  }

  private cancelUploadDebounce(lockKey: string): void {
    const existing = this.uploadDebounceTimers.get(lockKey);
    if (existing) {
      clearTimeout(existing);
      this.uploadDebounceTimers.delete(lockKey);
    }
    const resolver = this.uploadDebounceResolvers.get(lockKey);
    if (resolver) {
      resolver.resolve(true);
      this.uploadDebounceResolvers.delete(lockKey);
    }
  }

  private async checkDuplicatePhone(
    businessAccountId: string,
    customerPhone: string,
    currentSessionId: string
  ): Promise<{ isDuplicate: boolean; isRecent: boolean; existingLeadId?: string; hoursAgo?: number }> {
    const normalized = normalizePhone(customerPhone);
    if (normalized.length < 10) {
      return { isDuplicate: false, isRecent: false };
    }

    const existingLeads = await db
      .select()
      .from(whatsappLeads)
      .where(
        and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          ne(whatsappLeads.status, 'message_only')
        )
      )
      .orderBy(desc(whatsappLeads.createdAt))
      .limit(100);

    for (const lead of existingLeads) {
      if (lead.flowSessionId === currentSessionId) continue;
      const ed = (lead.extractedData as Record<string, any>) || {};
      const phonesOnLead = [ed.customer_phone, lead.customerPhone].filter(Boolean);
      const matchFound = phonesOnLead.some(p => normalizePhone(p) === normalized);
      if (!matchFound) continue;

      const hoursAgo = Math.round((Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60));
      const isRecent = hoursAgo < 24;
      return { isDuplicate: true, isRecent, existingLeadId: lead.id, hoursAgo };
    }

    return { isDuplicate: false, isRecent: false };
  }

  private waitForMoreUploads(lockKey: string): Promise<boolean> {
    this.cancelUploadDebounce(lockKey);
    return new Promise<boolean>((resolve) => {
      this.uploadDebounceResolvers.set(lockKey, { resolve });
      const timer = setTimeout(() => {
        this.uploadDebounceTimers.delete(lockKey);
        this.uploadDebounceResolvers.delete(lockKey);
        resolve(false);
      }, this.UPLOAD_DEBOUNCE_MS);
      this.uploadDebounceTimers.set(lockKey, timer);
    });
  }

  /**
   * Extract specified fields from user message using AI
   */
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
      console.warn(`[WhatsApp Flow] OpenAI API key not configured for business ${businessAccountId}`);
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
        console.warn(`[WhatsApp Flow] AI returned invalid JSON, falling back to static: ${cleanJson.substring(0, 200)}`);
        return { extracted: alreadyCollected, missing: requiredFields.filter(f => !this.hasFieldValue(alreadyCollected, f)) };
      }

      const extractedFields = parsed.extracted || parsed;
      const allExtracted = { ...alreadyCollected };
      for (const [key, value] of Object.entries(extractedFields)) {
        if (value !== null && value !== undefined && value !== "") {
          // Never overwrite a value already set by a structured step (dropdown/button).
          // The AI prompt excludes already-collected fields, but the model may still
          // return them (e.g. if the user re-mentions the display label "6/1" when the
          // mapped stored value is "5"). Keeping the previously-stored value is always correct.
          if (!this.hasFieldValue(alreadyCollected, key)) {
            allExtracted[key] = value;
          }
        }
      }

      const missing = requiredFields.filter(f => !this.hasFieldValue(allExtracted, f));

      console.log(`[WhatsApp Flow] AI Extraction - Extracted: ${JSON.stringify(allExtracted)}, Missing: ${missing.join(", ")}`);

      return { extracted: allExtracted, missing, followUp: parsed.followUp || undefined };
    } catch (error) {
      console.error("[WhatsApp Flow] AI extraction error:", error);
      return { extracted: alreadyCollected, missing: requiredFields.filter(f => !this.hasFieldValue(alreadyCollected, f)) };
    }
  }

  /**
   * Generate a friendly follow-up message asking for missing fields (static fallback)
   */
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

  /**
   * Generate a contextual AI-powered follow-up that addresses user concerns before asking for missing fields
   */
  async generateContextualFollowUp(
    businessAccountId: string,
    userMessage: string,
    missingFields: string[],
    collectedData: Record<string, any>
  ): Promise<string> {
    if (missingFields.length === 0) return "";

    const { apiKey, name: accountName } = await this.getApiKeyForBusiness(businessAccountId);
    if (!apiKey) {
      return this.generateMissingFieldsPromptStatic(missingFields);
    }

    const openaiClient = new OpenAI({ apiKey, timeout: 30000 });

    // Format field names for display
    const formatField = (field: string) => 
      field.replace(/_/g, " ").replace(/([A-Z])/g, " $1").toLowerCase().trim();
    
    const formattedMissing = missingFields.map(formatField);
    const collectedList = Object.entries(collectedData)
      .filter(([_, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${formatField(k)}: ${v}`)
      .join(", ");

    const prompt = `You are a friendly business assistant for "${accountName || 'our company'}". 
A customer is providing their details but we still need some information.

Customer's latest message: "${userMessage}"

Information we already have: ${collectedList || "None yet"}
Information we still need: ${formattedMissing.join(", ")}

Generate a SHORT, friendly response (2-3 sentences max) that:
1. Briefly acknowledges or addresses what the customer said (if they asked a question, answer it briefly; if they expressed concern, reassure them)
2. Then naturally asks for the remaining missing information

Important:
- Be conversational and natural, not robotic
- If they asked "what if I don't give", explain briefly why the info is needed (e.g., "We need this to process your request/application")
- Don't just repeat the same request - show you understood what they said
- Keep it brief and friendly
- Don't use bullet points or numbered lists

Respond with just the message text, no quotes or formatting.`;

    try {
      const response = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (content) {
        return content;
      }
    } catch (error) {
      console.error("[WhatsApp Flow] Error generating contextual follow-up:", error);
    }

    // Fallback to static response
    return this.generateMissingFieldsPromptStatic(missingFields);
  }

  async detectUploadStepIntent(
    businessAccountId: string,
    userMessage: string,
    documentTypes: { docType: string; label: string; isMandatory: boolean }[],
    collectedDocTypes: string[]
  ): Promise<{ intent: "skip" | "question" | "compliance" | "unrelated"; response: string }> {
    const { apiKey, name: accountName } = await this.getApiKeyForBusiness(businessAccountId);
    if (!apiKey) {
      console.warn(`[WhatsApp Flow] OpenAI API key not configured for business ${businessAccountId}, using fallback intent detection`);
      const normCollected = collectedDocTypes.map((k: string) => k.toLowerCase().replace(/_card$/, ''));
      const hasDoc = (dt: string) => normCollected.includes(dt.toLowerCase().replace(/_card$/, ''));
      const missing = documentTypes.filter((d) => !hasDoc(d.docType));
      const missingMandatory = missing.filter((d) => d.isMandatory);
      const missingOptional = missing.filter((d) => !d.isMandatory);
      const fallbackSkip = /(don'?t\s*have|nahi|nhi|skip|can'?t|cant|not\s*available|not\s*have|mere\s*pas\s*nahi|nahi\s*hai|none|^na$|^no$)/i;
      const isSkip = fallbackSkip.test(userMessage.trim());
      if (isSkip) {
        if (missingMandatory.length > 0) {
          const labels = missingMandatory.map((d) => d.label).join(", ");
          return { intent: "skip", response: `I understand, but the following documents are required and cannot be skipped: ${labels}. Please upload them to continue.` };
        }
        if (missingOptional.length > 0) {
          const labels = missingOptional.map((d) => d.label).join(", ");
          return { intent: "skip", response: `No problem, skipping the optional documents (${labels}).` };
        }
        return { intent: "skip", response: "All documents have been received. Thank you!" };
      }
      return { intent: "unrelated", response: "Please upload the required documents to continue." };
    }

    const openaiClient = new OpenAI({ apiKey, timeout: 30000 });

    const normCollected2 = collectedDocTypes.map((k: string) => k.toLowerCase().replace(/_card$/, ''));
    const hasDoc2 = (dt: string) => normCollected2.includes(dt.toLowerCase().replace(/_card$/, ''));
    const collected = documentTypes.filter((d) => hasDoc2(d.docType));
    const missing = documentTypes.filter((d) => !hasDoc2(d.docType));
    const missingMandatory = missing.filter((d) => d.isMandatory);
    const missingOptional = missing.filter((d) => !d.isMandatory);

    const prompt = `You are an intelligent assistant for "${accountName || 'our company'}". A customer is in the middle of uploading documents via WhatsApp. Analyze their text message and determine their intent.

CONTEXT:
- Documents expected: ${documentTypes.map((d) => `${d.label} (${d.isMandatory ? "mandatory" : "optional"})`).join(", ")}
- Already uploaded: ${collected.length > 0 ? collected.map((d) => d.label).join(", ") : "None"}
- Still missing: ${missing.length > 0 ? missing.map((d) => `${d.label} (${d.isMandatory ? "mandatory" : "optional"})`).join(", ") : "None"}
${missingMandatory.length > 0 ? `- Mandatory documents still needed: ${missingMandatory.map((d) => d.label).join(", ")}` : ""}
${missingOptional.length > 0 ? `- Optional documents still needed: ${missingOptional.map((d) => d.label).join(", ")}` : ""}

CUSTOMER MESSAGE: "${userMessage}"

Classify the intent as one of:
- "skip": Customer wants to skip, refuses, says they don't have the document(s), wants to do it later, or indicates inability/unwillingness to upload (in any language including Hindi/Hinglish)
- "question": Customer is asking a question about the documents, process, or requirements
- "compliance": Customer says they will upload or are working on it (e.g., "hold on", "sending now", "ek minute")
- "unrelated": Message is unrelated to the document upload process

Also generate a SHORT, friendly response (1-2 sentences) appropriate for the intent:
- For "skip" with mandatory docs remaining: Empathetically acknowledge but explain which documents are mandatory and required to proceed.
- For "skip" with only optional docs remaining: Acknowledge and confirm you'll skip the optional documents.
- For "skip" with no docs remaining: Acknowledge and confirm all documents are received.
- For "question": Answer their question helpfully based on the context.
- For "compliance": Encouragingly acknowledge and wait for the upload.
- For "unrelated": Gently redirect them to upload the remaining documents.

IMPORTANT: Respond in the SAME LANGUAGE the customer used (English, Hindi, Hinglish, etc.)

Return ONLY a valid JSON object:
{"intent": "skip|question|compliance|unrelated", "response": "your response text"}`;

    try {
      const response = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 300,
      });

      const content = response.choices[0]?.message?.content?.trim() || "{}";
      const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        console.warn(`[WhatsApp Flow] AI intent detection returned invalid JSON: ${cleanJson.substring(0, 200)}`);
        return { intent: "unrelated", response: "Please upload the required documents to continue." };
      }

      const validIntents = ["skip", "question", "compliance", "unrelated"];
      if (!validIntents.includes(parsed.intent)) {
        parsed.intent = "unrelated";
      }

      console.log(`[WhatsApp Flow] AI Intent Detection - Intent: ${parsed.intent}, Response: "${parsed.response}"`);
      return { intent: parsed.intent, response: parsed.response || "Please upload the required documents to continue." };
    } catch (error) {
      console.error("[WhatsApp Flow] AI intent detection error:", error);
      const normCollected3 = collectedDocTypes.map((k: string) => k.toLowerCase().replace(/_card$/, ''));
      const hasDoc3 = (dt: string) => normCollected3.includes(dt.toLowerCase().replace(/_card$/, ''));
      const missing = documentTypes.filter((d) => !hasDoc3(d.docType));
      const missingMandatory = missing.filter((d) => d.isMandatory);
      const missingOptional = missing.filter((d) => !d.isMandatory);
      const fallbackSkip = /(don'?t\s*have|nahi|nhi|skip|can'?t|cant|not\s*available|not\s*have|mere\s*pas\s*nahi|nahi\s*hai|none|^na$|^no$)/i;
      const isSkip = fallbackSkip.test(userMessage.trim());
      if (isSkip) {
        if (missingMandatory.length > 0) {
          const labels = missingMandatory.map((d) => d.label).join(", ");
          return { intent: "skip", response: `I understand, but the following documents are required and cannot be skipped: ${labels}. Please upload them to continue.` };
        }
        if (missingOptional.length > 0) {
          const labels = missingOptional.map((d) => d.label).join(", ");
          return { intent: "skip", response: `No problem, skipping the optional documents (${labels}).` };
        }
        return { intent: "skip", response: "All documents have been received. Thank you!" };
      }
      return { intent: "unrelated", response: "Please upload the required documents to continue." };
    }
  }

  private fallbackExtractValue(message: string, validationType: string): string | null {
    const trimmed = message.trim();
    switch (validationType) {
      case "number":
      case "percentage": {
        const match = trimmed.match(/(\d+(?:\.\d+)?)/);
        return match ? match[1] : null;
      }
      case "email": {
        const match = trimmed.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
        return match ? match[0] : null;
      }
      case "phone": {
        const match = trimmed.match(/[\d\+][\d\s\-\(\)]{6,}/);
        return match ? match[0].replace(/[\s\-\(\)]/g, "") : null;
      }
      case "url": {
        const match = trimmed.match(/https?:\/\/[^\s]+/i) || trimmed.match(/www\.[^\s]+/i);
        return match ? match[0] : null;
      }
      default:
        return null;
    }
  }

  private getFormatExample(validationType: string): string {
    const examples: Record<string, string> = {
      number: "42 or 99.5",
      percentage: "85 or 92.5",
      email: "name@example.com",
      phone: "9876543210",
      url: "https://example.com",
      date: "15/01/2000",
    };
    return examples[validationType] || validationType;
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
        if (!/^\d{7,15}$/.test(digits)) {
          return { valid: false, message: "Please enter a valid phone number." };
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

  async detectTextStepIntent(
    businessAccountId: string,
    userMessage: string,
    stepPrompt: string,
    saveToField: string | null,
    inputValidation: string | null,
    flowContext?: string
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

    const contextBlock = flowContext ? `\n${flowContext}\n` : '';

    const prompt = `You are an intelligent assistant for "${accountName || 'our company'}". A customer is in a WhatsApp conversation flow and was asked a question. Analyze if their reply is a valid answer or something else.
${contextBlock}
STEP QUESTION ASKED: "${stepPrompt}"
EXPECTED ANSWER: ${fieldLabel}${validationHint ? ` (should be ${validationHint})` : ""}

CUSTOMER REPLY: "${userMessage}"

Classify the intent as one of:
- "answer": The reply is a genuine attempt to answer the question (even if oddly phrased, abbreviated, or in another language). Numbers, names, dates, or short factual replies count as answers.
- "question": The reply is a question, concern, complaint, or off-topic remark that does NOT answer what was asked. Examples: "why do you need this?", "what is this for?", "who are you?", greetings like "hello", random chatter, or asking about pricing/services/company info.
- "invalid": The reply looks like an answer attempt but the format is clearly wrong (e.g., text when a number was expected, gibberish, or nonsensical).

For "answer" intent, also extract the CLEAN VALUE — the precise data point the question is asking for, stripped of conversational filler. Look at the step question and field name to understand what value to extract.
Examples:
- Question: "What is your graduation percentage?" Reply: "its 99 percent" → cleanValue: "99"
- Question: "What is your email?" Reply: "my email is john@mail.com" → cleanValue: "john@mail.com"
- Question: "What is your name?" Reply: "I am Rahul Kumar" → cleanValue: "Rahul Kumar"
- Question: "Which course?" Reply: "btech" → cleanValue: "btech"
- Question: "Your date of birth?" Reply: "15 jan 2000" → cleanValue: "15/01/2000"

For "question" and "invalid" intents, generate a SHORT response (2-3 sentences):
- For "question": FIRST answer their question using the flow journey context above (explain WHY this information is needed and what the overall process is about), THEN gently redirect them to answer the original question. Be specific and helpful.
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
      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        console.warn(`[WhatsApp Flow] Text step intent detection returned invalid JSON: ${cleanJson.substring(0, 200)}`);
        return { intent: "answer", response: "" };
      }

      const validIntents = ["answer", "question", "invalid"];
      if (!validIntents.includes(parsed.intent)) {
        parsed.intent = "answer";
      }

      console.log(`[WhatsApp Flow] Text Step Intent - Intent: ${parsed.intent}, CleanValue: "${parsed.cleanValue || ''}", Response: "${parsed.response || ''}"`);
      return { intent: parsed.intent, response: parsed.response || "", cleanValue: parsed.cleanValue || undefined };
    } catch (error) {
      console.error("[WhatsApp Flow] Text step intent detection error:", error);
      return { intent: "answer", response: "" };
    }
  }

  private isExitKeyword(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return this.EXIT_KEYWORDS.some(kw => normalized === kw);
  }

  private isTextOnlyMessageStep(step: WhatsappFlowStep): boolean {
    if (step.type !== "text") return false;
    if (step.saveToField) return false;
    const opts = step.options as any;
    if (Array.isArray(opts?.requiredFields) && opts.requiredFields.length > 0) return false;
    if (Array.isArray(opts?.selectedFields) && opts.selectedFields.length > 0) return false;
    if (opts?.inputValidation) return false;
    return true;
  }

  private resolveNextStepKeyForChain(step: WhatsappFlowStep, steps: WhatsappFlowStep[]): string | null {
    if (step.defaultNextStep && step.defaultNextStep !== "__auto__" && step.defaultNextStep !== "") {
      return step.defaultNextStep;
    }
    return this.getNextStepKey(step.stepKey, steps);
  }

  private getOffTopicCount(collectedData: Record<string, any>, stepKey: string): number {
    return collectedData[`_offTopicCount_${stepKey}`] || 0;
  }

  private incrementOffTopicCount(collectedData: Record<string, any>, stepKey: string): number {
    const key = `_offTopicCount_${stepKey}`;
    const count = (collectedData[key] || 0) + 1;
    collectedData[key] = count;
    return count;
  }

  private resetOffTopicCount(collectedData: Record<string, any>, stepKey: string): void {
    delete collectedData[`_offTopicCount_${stepKey}`];
  }

  private cleanOffTopicCounters(collectedData: Record<string, any>): void {
    for (const key of Object.keys(collectedData)) {
      if (key.startsWith('_offTopicCount_')) {
        delete collectedData[key];
      }
    }
  }

  private buildFlowContextSummary(
    flow: WhatsappFlow,
    steps: WhatsappFlowStep[],
    currentStep: WhatsappFlowStep,
    collectedData: Record<string, any>
  ): string {
    const flowName = flow.name || "Form";
    const flowDesc = flow.description || "";

    const stepSummaries = steps
      .filter(s => !s.stepKey.startsWith('__'))
      .map((s, i) => {
        const fieldName = s.saveToField ? ` (collects: ${s.saveToField.replace(/_/g, ' ')})` : '';
        const isCurrent = s.stepKey === currentStep.stepKey;
        return `  ${i + 1}. ${s.prompt}${fieldName}${isCurrent ? ' ← CURRENT STEP' : ''}`;
      })
      .join('\n');

    const collected = Object.entries(collectedData)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `  - ${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n');

    let summary = `FLOW JOURNEY CONTEXT:\nFlow Name: "${flowName}"`;
    if (flowDesc) summary += `\nPurpose: ${flowDesc}`;
    summary += `\nSteps in this flow:\n${stepSummaries}`;
    if (collected) summary += `\nData already collected:\n${collected}`;
    return summary;
  }

  async detectOffTopicIntent(
    businessAccountId: string,
    userMessage: string,
    stepPrompt: string,
    stepType: string,
    expectedInput: string,
    flowContext?: string,
    useCaseMode?: string
  ): Promise<{ intent: "greeting" | "question" | "wrong_format" | "exit" | "unknown"; response: string }> {
    const { apiKey, name: accountName } = await this.getApiKeyForBusiness(businessAccountId);
    if (!apiKey) {
      return { intent: "unknown", response: "" };
    }

    const openaiClient = new OpenAI({ apiKey, timeout: 15000 });

    const contextBlock = flowContext ? `\n${flowContext}\n` : '';

    // In sales/support modes, "no" / "not interested" is an OBJECTION or unresolved state, NOT an exit.
    // Only explicit disengagement keywords ("stop", "unsubscribe", "leave me alone") count as exit.
    const mode = (useCaseMode || "lead_capture").toLowerCase();
    const exitDefinition = (mode === "direct_sales" || mode === "customer_support")
      ? `- "exit": ONLY when the user EXPLICITLY asks to stop messaging, unsubscribe, or be left alone (e.g. "stop", "unsubscribe", "leave me alone", "do not contact me again", "remove my number"). A simple "no", "not interested", "not now", "maybe later", or hesitation is NOT an exit — classify those as "wrong_format" (they are answering the question with a negative response that the flow should handle).`
      : `- "exit": wants to stop, leave, or is not interested`;

    const prompt = `You are an intelligent assistant for "${accountName || 'our company'}". A customer is in a WhatsApp conversation flow and sent a message that doesn't match what was expected. Determine their intent and respond helpfully.
${contextBlock}
CURRENT STEP QUESTION: "${stepPrompt}"
EXPECTED INPUT: ${expectedInput}
CUSTOMER MESSAGE: "${userMessage}"

Classify the intent:
- "greeting": casual greeting or conversational message (hi, hey, hello, thanks, ok, etc.)
- "question": asking a question about the process, why information is needed, about the business, services, pricing, or anything informational
- "wrong_format": trying to answer the question but in wrong format
${exitDefinition}
- "unknown": unclear intent

Generate a SHORT, friendly response (2-3 sentences max) in the SAME LANGUAGE the customer used:
- For "question": FIRST answer their question using the flow journey context above (explain WHY this information is needed and what the overall process is about), THEN gently ask them to provide what the flow needs. Be specific and helpful, not generic.
- For "greeting": respond naturally, then gently ask them to provide what the flow needs
- For "wrong_format": explain the correct format helpfully
- For "exit": confirm you're ending the conversation

Return ONLY valid JSON: {"intent": "greeting|question|wrong_format|exit|unknown", "response": "your response"}`;

    try {
      const response = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      });

      const content = response.choices[0]?.message?.content?.trim() || "{}";
      const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();
      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        console.warn(`[WhatsApp Flow] Off-topic intent detection returned invalid JSON: ${cleanJson.substring(0, 200)}`);
        return { intent: "unknown", response: "" };
      }

      const validIntents = ["greeting", "question", "wrong_format", "exit", "unknown"];
      if (!validIntents.includes(parsed.intent)) {
        parsed.intent = "unknown";
      }

      console.log(`[WhatsApp Flow] Off-topic Intent: ${parsed.intent}, Response: "${parsed.response || ''}"`);
      return { intent: parsed.intent, response: parsed.response || "" };
    } catch (error) {
      console.error("[WhatsApp Flow] Off-topic intent detection error:", error);
      return { intent: "unknown", response: "" };
    }
  }

  private async handleOffTopicMessage(
    businessAccountId: string,
    session: WhatsappFlowSession,
    currentStep: WhatsappFlowStep,
    message: string,
    collectedData: Record<string, any>,
    expectedInput: string,
    fallbackValidationMessage: string,
    flowContext?: string
  ): Promise<ProcessResult> {
    // Read use case mode from WhatsApp settings — gates exit-intent behavior.
    let useCaseMode = "lead_capture";
    try {
      const { whatsappService } = await import("./whatsappService");
      const settings = await whatsappService.getSettings(businessAccountId);
      useCaseMode = ((settings as any)?.useCaseMode || "lead_capture").toLowerCase();
    } catch (err) {
      console.error("[WhatsApp Flow] Failed to read useCaseMode (defaulting to lead_capture):", err);
    }
    const suppressCannedExitReply = useCaseMode === "direct_sales" || useCaseMode === "customer_support";
    // In lead_capture mode we KEEP the canned exit reply but must NOT also fire the persona auto-reply
    // on top of it (that produced the double-message bug). In sales/support modes the canned reply is
    // suppressed and the persona handles the exit, so the fallback flag stays true there.
    const fallbackToAIOnExit = suppressCannedExitReply;

    if (this.isExitKeyword(message)) {
      console.log(`[WhatsApp Flow] Exit keyword detected: "${message}" (mode=${useCaseMode}) — ending flow session${suppressCannedExitReply ? ", suppressing canned reply, handing off to AI persona" : ", sending canned reply, NOT firing AI persona"}`);
      await this.expireSession(session.id);
      if (suppressCannedExitReply) {
        return {
          handled: false,
          shouldFallbackToAI: true,
        };
      }
      return {
        handled: true,
        response: {
          type: "text",
          text: "No problem! I've ended the form. Feel free to message me anytime if you need help. 😊",
        },
        shouldFallbackToAI: fallbackToAIOnExit,
      };
    }

    const aiResult = await this.detectOffTopicIntent(
      businessAccountId,
      message,
      currentStep.prompt,
      currentStep.type,
      expectedInput,
      flowContext,
      useCaseMode
    );

    if (aiResult.intent === "exit") {
      console.log(`[WhatsApp Flow] AI detected exit intent (mode=${useCaseMode}) — ending flow session${suppressCannedExitReply ? ", suppressing canned reply, handing off to AI persona" : ", sending canned reply, NOT firing AI persona"}`);
      await this.expireSession(session.id);
      if (suppressCannedExitReply) {
        return {
          handled: false,
          shouldFallbackToAI: true,
        };
      }
      return {
        handled: true,
        response: {
          type: "text",
          text: aiResult.response || "No problem! I've ended the form. Feel free to message me anytime if you need help.",
        },
        shouldFallbackToAI: fallbackToAIOnExit,
      };
    }

    const isCountableOffTopic = ["greeting", "question", "unknown"].includes(aiResult.intent);
    if (isCountableOffTopic) {
      const offTopicCount = this.incrementOffTopicCount(collectedData, currentStep.stepKey);
      
      if (offTopicCount >= this.MAX_OFF_TOPIC_ATTEMPTS) {
        console.log(`[WhatsApp Flow] Max off-topic attempts (${this.MAX_OFF_TOPIC_ATTEMPTS}) reached for step "${currentStep.stepKey}" — auto-exiting flow`);
        await this.expireSession(session.id);
        return {
          handled: true,
          response: {
            type: "text",
            text: "It seems like you'd like to chat instead. I've paused the form — feel free to ask me anything! You can restart the form anytime.",
          },
          shouldFallbackToAI: true,
        };
      }
    }

    await this.advanceSession(session.id, session.currentStepKey, collectedData);

    const responseText = aiResult.response || fallbackValidationMessage;

    // Send only the off-topic redirect — do not simultaneously re-send the step prompt.
    // The step prompt (buttons/text) is still visible in the chat from when it was first sent.
    // Sending both at once creates message spam. On the user's next reply the flow will
    // naturally re-evaluate the step and re-send the prompt if needed.
    return {
      handled: true,
      response: {
        type: "text",
        text: responseText,
      },
      sessionId: session.id,
    };
  }

  async getActiveFlow(businessAccountId: string): Promise<WhatsappFlow | null> {
    const cached = this.getCached(this.flowCache, businessAccountId);
    if (cached !== undefined) {
      return cached;
    }
    const [flow] = await db
      .select()
      .from(whatsappFlows)
      .where(
        and(
          eq(whatsappFlows.businessAccountId, businessAccountId),
          eq(whatsappFlows.isActive, "true")
        )
      )
      .limit(1);
    const result = flow || null;
    this.flowCache.set(businessAccountId, { data: result, ts: Date.now() });
    return result;
  }
  
  async getFlowById(flowId: string): Promise<WhatsappFlow | null> {
    const [flow] = await db
      .select()
      .from(whatsappFlows)
      .where(eq(whatsappFlows.id, flowId))
      .limit(1);
    return flow || null;
  }

  async getFlowSteps(flowId: string): Promise<WhatsappFlowStep[]> {
    const cached = this.getCached(this.stepsCache, flowId);
    if (cached !== undefined) {
      return cached;
    }
    const steps = await db
      .select()
      .from(whatsappFlowSteps)
      .where(eq(whatsappFlowSteps.flowId, flowId))
      .orderBy(asc(whatsappFlowSteps.stepOrder));
    
    const needsNormalization = steps.some(s => s.stepKey.startsWith('step_'));
    
    if (needsNormalization) {
      await this.normalizeStepKeys(flowId, steps);
      const normalized = await db
        .select()
        .from(whatsappFlowSteps)
        .where(eq(whatsappFlowSteps.flowId, flowId))
        .orderBy(asc(whatsappFlowSteps.stepOrder));
      this.stepsCache.set(flowId, { data: normalized, ts: Date.now() });
      return normalized;
    }
    
    this.stepsCache.set(flowId, { data: steps, ts: Date.now() });
    return steps;
  }
  
  private async normalizeStepKeys(flowId: string, steps: WhatsappFlowStep[]): Promise<void> {
    console.log(`[WhatsApp Flow] Normalizing legacy step keys for flow ${flowId}`);
    
    // Build mapping from old keys to new keys
    const keyMapping: Record<string, string> = {};
    for (let i = 0; i < steps.length; i++) {
      const oldKey = steps[i].stepKey;
      const newKey = String(i + 1);
      if (oldKey !== newKey) {
        keyMapping[oldKey] = newKey;
      }
    }
    
    // Update all step keys
    for (let i = 0; i < steps.length; i++) {
      const newKey = String(i + 1);
      await db
        .update(whatsappFlowSteps)
        .set({ stepKey: newKey })
        .where(eq(whatsappFlowSteps.id, steps[i].id));
    }
    
    // Update all Go-to references
    if (Object.keys(keyMapping).length > 0) {
      await this.updateGoToReferences(flowId, keyMapping);
      
      // Update currentStepKey in active sessions for this flow
      const activeSessions = await db
        .select()
        .from(whatsappFlowSessions)
        .where(
          and(
            eq(whatsappFlowSessions.flowId, flowId),
            eq(whatsappFlowSessions.status, "active")
          )
        );
      
      for (const session of activeSessions) {
        if (session.currentStepKey && keyMapping[session.currentStepKey]) {
          await db
            .update(whatsappFlowSessions)
            .set({ currentStepKey: keyMapping[session.currentStepKey] })
            .where(eq(whatsappFlowSessions.id, session.id));
          console.log(`[WhatsApp Flow] Updated session ${session.id} currentStepKey: ${session.currentStepKey} -> ${keyMapping[session.currentStepKey]}`);
        }
      }
    }
    
    console.log(`[WhatsApp Flow] Normalized ${steps.length} steps to numeric keys`);
  }

  async getStepByKey(flowId: string, stepKey: string): Promise<WhatsappFlowStep | null> {
    const [step] = await db
      .select()
      .from(whatsappFlowSteps)
      .where(
        and(
          eq(whatsappFlowSteps.flowId, flowId),
          eq(whatsappFlowSteps.stepKey, stepKey)
        )
      )
      .limit(1);
    return step || null;
  }

  async findCompletedLeadForSender(
    businessAccountId: string,
    senderPhone: string
  ): Promise<{ lead: any; session: WhatsappFlowSession | null } | null> {
    const normalizedSender = normalizePhone(senderPhone);
    const completedSessions = await db
      .select()
      .from(whatsappFlowSessions)
      .where(
        and(
          eq(whatsappFlowSessions.businessAccountId, businessAccountId),
          eq(whatsappFlowSessions.status, "completed")
        )
      )
      .orderBy(desc(whatsappFlowSessions.createdAt))
      .limit(20);

    const matchedSession = completedSessions.find(s => normalizePhone(s.senderPhone) === normalizedSender);

    if (matchedSession) {
      const leads = await db
        .select()
        .from(whatsappLeads)
        .where(
          and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            eq(whatsappLeads.flowSessionId, matchedSession.id)
          )
        )
        .orderBy(desc(whatsappLeads.createdAt))
        .limit(5);

      const qualifiedLead = leads.find(l => l.status !== 'message_only') || leads[0];
      if (qualifiedLead) {
        return { lead: qualifiedLead, session: matchedSession };
      }
    }

    const recentLeads = await db
      .select()
      .from(whatsappLeads)
      .where(
        and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          ne(whatsappLeads.status, 'message_only')
        )
      )
      .orderBy(desc(whatsappLeads.createdAt))
      .limit(20);

    const matchedLead = recentLeads.find(l => normalizePhone(l.senderPhone) === normalizedSender);
    if (matchedLead) {
      return { lead: matchedLead, session: matchedSession || null };
    }

    return null;
  }

  private isUpdateKeyword(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return this.UPDATE_KEYWORDS.some(kw => normalized === kw);
  }

  private isUpdateFlowStep(stepKey: string): boolean {
    return stepKey.startsWith("__update_");
  }

  private getExistingDocsDescription(collectedData: Record<string, any>): string {
    const docs = collectedData._collectedDocuments || {};
    const docKeys = Object.keys(docs);
    if (docKeys.length === 0) return "No documents on file.";
    const labels = docKeys.map(key => {
      const doc = docs[key];
      return doc.label || key.replace(/_/g, " ");
    });
    return labels.join(", ");
  }

  private async parseUpdateDetailsWithAI(
    businessAccountId: string,
    input: string
  ): Promise<Record<string, string>> {
    const { apiKey: businessApiKey } = await this.getApiKeyForBusiness(businessAccountId);
    const apiKey = businessApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn(`[WhatsApp Flow] No API key for AI update parsing, falling back to regex`);
      return this.parseUpdateDetailsFallback(input);
    }

    const openaiClient = new OpenAI({ apiKey, timeout: 15000 });

    const prompt = `Extract the fields the user wants to update from their message. 
The user is updating their application details. They may use any format — "Name Rohit", "Name: Rohit", "my name is Rohit", "change address to 123 Main St", etc.

Possible fields to extract:
- name (person's name)
- phone (phone/mobile number)
- email (email address)
- address (residential/current address)

User message: "${input}"

Return ONLY a valid JSON object with the fields found. Use null for fields not mentioned.
Example: {"name": "Rohit", "phone": null, "email": null, "address": null}
Example: {"name": null, "phone": "9876543210", "email": null, "address": "123 Main Street, Delhi"}`;

    const allowedFields = new Set(["name", "phone", "email", "address"]);

    try {
      const response = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
      });

      const content = response.choices[0]?.message?.content?.trim() || "{}";
      const cleanJson = content.replace(/```json\n?|\n?```/g, "").trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        console.warn(`[WhatsApp Flow] AI update parsing returned invalid JSON: ${cleanJson.substring(0, 200)}`);
        return this.parseUpdateDetailsFallback(input);
      }

      const fields = parsed.extracted || parsed;

      const updates: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        const normalizedKey = key.toLowerCase().trim();
        if (allowedFields.has(normalizedKey) && value !== null && value !== undefined && value !== "") {
          updates[normalizedKey] = String(value);
        }
      }

      console.log(`[WhatsApp Flow] AI parsed update details: ${JSON.stringify(updates)}`);
      if (Object.keys(updates).length === 0) {
        return this.parseUpdateDetailsFallback(input);
      }
      return updates;
    } catch (error) {
      console.error("[WhatsApp Flow] AI update parsing error, falling back to regex:", error);
      return this.parseUpdateDetailsFallback(input);
    }
  }

  private parseUpdateDetailsFallback(input: string): Record<string, string> {
    const updates: Record<string, string> = {};
    const lines = input.split(/\n/).map(l => l.trim()).filter(Boolean);

    const fieldPatterns: Array<{ pattern: RegExp; field: string }> = [
      { pattern: /^(?:name|naam)\s*[:\-=\s]\s*(.+)/i, field: "name" },
      { pattern: /^(?:phone|mobile|mob|contact number|phone number|ph)\s*[:\-=\s]\s*(.+)/i, field: "phone" },
      { pattern: /^(?:email|e-mail|mail)\s*[:\-=\s]\s*(.+)/i, field: "email" },
      { pattern: /^(?:address|addr|current address|home address)\s*[:\-=\s]\s*(.+)/i, field: "address" },
    ];

    for (const line of lines) {
      for (const { pattern, field } of fieldPatterns) {
        const match = line.match(pattern);
        if (match && match[1]?.trim()) {
          updates[field] = match[1].trim();
          break;
        }
      }
    }

    if (Object.keys(updates).length === 0 && lines.length === 1) {
      const singleLine = lines[0];
      if (singleLine.includes("@") && singleLine.includes(".")) {
        updates.email = singleLine;
      } else if (/^\d[\d\s\-\(\)]{8,}$/.test(singleLine.replace(/\s/g, ''))) {
        updates.phone = singleLine;
      }
    }

    return updates;
  }

  private getLeadDetailsDescription(lead: any): string {
    const fields: string[] = [];
    if (lead.customerName) fields.push(`Name: ${lead.customerName}`);
    if (lead.customerPhone) fields.push(`Phone: ${lead.customerPhone}`);
    if (lead.customerEmail) fields.push(`Email: ${lead.customerEmail}`);
    const extracted = (lead.extractedData as Record<string, any>) || {};
    for (const [key, value] of Object.entries(extracted)) {
      if (key.startsWith('_')) continue;
      if (value && typeof value === 'string' && !fields.some(f => f.includes(value))) {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        fields.push(`${label}: ${value}`);
      }
    }
    return fields.length > 0 ? fields.join("\n") : "No details on file.";
  }

  async startUpdateSession(
    businessAccountId: string,
    flowId: string,
    senderPhone: string,
    startStepKey: string,
    existingLeadId: string,
    existingCollectedData?: Record<string, any>,
    sessionTimeoutMinutes?: number
  ): Promise<WhatsappFlowSession> {
    await db
      .update(whatsappFlowSessions)
      .set({ status: "abandoned" })
      .where(
        and(
          eq(whatsappFlowSessions.businessAccountId, businessAccountId),
          eq(whatsappFlowSessions.senderPhone, senderPhone),
          eq(whatsappFlowSessions.status, "active")
        )
      );

    let timeoutMinutes = sessionTimeoutMinutes;
    if (!timeoutMinutes) {
      const flow = await this.getFlowById(flowId);
      timeoutMinutes = flow?.sessionTimeout || this.DEFAULT_SESSION_TIMEOUT_MINUTES;
    }

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + timeoutMinutes);

    const collectedData: Record<string, any> = {
      ...existingCollectedData,
      _updateExistingLeadId: existingLeadId,
      _updateMode: true,
    };

    const [session] = await db
      .insert(whatsappFlowSessions)
      .values({
        businessAccountId,
        flowId,
        senderPhone,
        currentStepKey: startStepKey,
        status: "active",
        collectedData,
        lastMessageAt: new Date(),
        expiresAt,
      })
      .returning();

    console.log(`[WhatsApp Flow] Started UPDATE session for ${senderPhone}, linked to lead ${existingLeadId}, step: ${startStepKey}`);
    return session;
  }

  private async handleUpdateMenu(
    businessAccountId: string,
    senderPhone: string,
    message: string,
    session: WhatsappFlowSession,
    activeFlow: WhatsappFlow
  ): Promise<ProcessResult> {
    const normalizedMessage = message.trim().toLowerCase();
    const collectedData = (session.collectedData as Record<string, any>) || {};
    const existingLeadId = collectedData._updateExistingLeadId;

    if (session.currentStepKey === this.UPDATE_MENU_STEP) {
      if (normalizedMessage === "add_docs" || normalizedMessage === "add documents" || normalizedMessage === "update documents") {
        const steps = await this.getFlowSteps(activeFlow.id);
        const uploadStep = steps.find(s => s.type === "upload");
        if (!uploadStep) {
          return {
            handled: true,
            response: { type: "text", text: "No document upload step is configured. Please contact support." },
            sessionId: session.id,
          };
        }

        const existingLead = await this.getLeadById(existingLeadId);
        const existingExtracted = (existingLead?.extractedData as Record<string, any>) || {};
        const existingDocs = existingExtracted._documents || existingExtracted._collectedDocuments || {};

        collectedData._collectedDocuments = { ...existingDocs };
        // Copy flat application fields (e.g. pan_number, aadhaar_no) so cross-validation
        // can compare the uploaded doc number against what the lead originally provided
        for (const [key, val] of Object.entries(existingExtracted)) {
          if (!key.startsWith('_') && (typeof val === 'string' || typeof val === 'number')) {
            collectedData[key] = val;
          }
        }
        await this.advanceSession(session.id, this.UPDATE_ADD_DOCS_STEP, collectedData);

        const docLabels = Object.keys(existingDocs).map(key => {
          const doc = existingDocs[key];
          return doc?.label || key.replace(/_/g, " ");
        });
        const onFileText = docLabels.length > 0
          ? `We already have: ${docLabels.join(", ")}.`
          : "No documents on file yet.";

        const options = uploadStep.options as FlowStepOptions | null;
        const documentTypes = options?.documentTypes || [];
        const existingDocKeysNorm = Object.keys(existingDocs).map((k: string) => k.toLowerCase().replace(/_card$/, ''));
        const missingDocs = documentTypes.filter((d: any) => !existingDocKeysNorm.includes(d.docType.toLowerCase().replace(/_card$/, '')));
        const missingText = missingDocs.length > 0
          ? `\nStill needed: ${missingDocs.map((d: any) => d.label).join(", ")}.`
          : "\nAll required documents are already on file. You can still replace any document by uploading a new one.";

        return {
          handled: true,
          response: {
            type: "buttons",
            text: `${onFileText}${missingText}\n\nPlease upload the document(s) you'd like to add or replace. Tap Done when finished.`,
            buttons: [{ id: "done", title: "Done" }],
          },
          sessionId: session.id,
        };
      }

      if (normalizedMessage === "update_details" || normalizedMessage === "update details") {
        const existingLead = await this.getLeadById(existingLeadId);
        if (!existingLead) {
          return {
            handled: true,
            response: { type: "text", text: "Could not find your application. Please start a new one." },
            sessionId: session.id,
          };
        }

        await this.advanceSession(session.id, this.UPDATE_DETAILS_COLLECT_STEP, collectedData);

        return {
          handled: true,
          response: {
            type: "text",
            text: `Please type the details you want to update.\n\nFor example:\nName: John Smith\nAddress: 123 Main Street\nPhone: 9876543210\nEmail: john@example.com\n\nYou can update one or more fields at a time. Type "done" when finished.`,
          },
          sessionId: session.id,
        };
      }

      if (normalizedMessage === "start_new" || normalizedMessage === "start new") {
        const [cooldownSettings] = await db
          .select({ newApplicationCooldownDays: whatsappSettings.newApplicationCooldownDays })
          .from(whatsappSettings)
          .where(eq(whatsappSettings.businessAccountId, businessAccountId))
          .limit(1);
        const cooldownDays = cooldownSettings?.newApplicationCooldownDays ?? 7;

        if (cooldownDays > 0) {
          let leadCreatedAt: Date | null = null;

          const existingLeadId = collectedData._updateExistingLeadId;
          if (existingLeadId) {
            const [existingLead] = await db
              .select({ createdAt: whatsappLeads.createdAt })
              .from(whatsappLeads)
              .where(eq(whatsappLeads.id, existingLeadId))
              .limit(1);
            if (existingLead) leadCreatedAt = existingLead.createdAt;
          }

          if (!leadCreatedAt) {
            const customerPhone = collectedData.customer_phone;
            if (customerPhone) {
              const dupResult = await this.checkDuplicatePhone(businessAccountId, customerPhone, session.id);
              if (dupResult.isDuplicate && dupResult.existingLeadId) {
                const [dupLead] = await db
                  .select({ createdAt: whatsappLeads.createdAt })
                  .from(whatsappLeads)
                  .where(eq(whatsappLeads.id, dupResult.existingLeadId))
                  .limit(1);
                if (dupLead) leadCreatedAt = dupLead.createdAt;
              }
            }
          }

          if (leadCreatedAt) {
            const daysSinceCreation = (Date.now() - new Date(leadCreatedAt).getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceCreation < cooldownDays) {
              const daysRemaining = Math.ceil(cooldownDays - daysSinceCreation);
              return {
                handled: true,
                response: {
                  type: "text",
                  text: `You cannot start a new application for this number yet. Please wait ${daysRemaining} more day${daysRemaining !== 1 ? 's' : ''}, or use Update Documents / Update Details to modify your existing application.`,
                },
                sessionId: session.id,
              };
            }
          }
        }

        await this.expireSession(session.id);
        const steps = await this.getFlowSteps(activeFlow.id);
        const startStep = this.getFirstActiveStep(steps);
        if (!startStep) {
          return { handled: false, shouldFallbackToAI: true };
        }
        const flowTimeout = activeFlow.sessionTimeout || this.DEFAULT_SESSION_TIMEOUT_MINUTES;
        const newSession = await this.startSession(
          businessAccountId,
          activeFlow.id,
          senderPhone,
          startStep.stepKey,
          flowTimeout
        );
        return {
          handled: true,
          response: this.buildStepResponse(startStep),
          sessionId: newSession.id,
        };
      }

      return {
        handled: true,
        response: {
          type: "buttons",
          text: "Please select one of the options below:",
          buttons: [
            { id: "add_docs", title: "Update Documents" },
            { id: "update_details", title: "Update Details" },
            { id: "start_new", title: "Start New" },
          ],
        },
        sessionId: session.id,
      };
    }

    if (session.currentStepKey === this.UPDATE_ADD_DOCS_STEP) {
      if (normalizedMessage === "done" || normalizedMessage === "finished" || normalizedMessage === "complete") {
        const docs = collectedData._collectedDocuments || {};
        await this.completeSession(session.id, collectedData);

        return {
          handled: true,
          flowCompleted: true,
          collectedData,
          response: {
            type: "text",
            text: `Your documents have been updated successfully. Thank you!`,
          },
          sessionId: session.id,
        };
      }

      return {
        handled: true,
        response: {
          type: "buttons",
          text: "Please upload the document(s) you'd like to add, or tap Done when finished.",
          buttons: [{ id: "done", title: "Done" }],
        },
        sessionId: session.id,
      };
    }

    if (session.currentStepKey === this.UPDATE_DETAILS_STEP || session.currentStepKey === this.UPDATE_DETAILS_COLLECT_STEP) {
      if (normalizedMessage === "done" || normalizedMessage === "finished" || normalizedMessage === "update_done") {
        await this.completeSession(session.id, collectedData);
        return {
          handled: true,
          flowCompleted: true,
          collectedData,
          response: { type: "text", text: "Your details have been updated. Thank you!" },
          sessionId: session.id,
        };
      }

      const userInput = message.trim();
      if (!userInput) {
        return {
          handled: true,
          response: { type: "text", text: "Please type the details you want to update. For example:\nName: John Smith\nAddress: 123 Main Street" },
          sessionId: session.id,
        };
      }

      const updates = await this.parseUpdateDetailsWithAI(businessAccountId, userInput);
      if (Object.keys(updates).length === 0) {
        return {
          handled: true,
          response: {
            type: "text",
            text: `I couldn't identify which field to update. Please use a format like:\nName: John Smith\nAddress: 123 Main Street\nPhone: 9876543210\nEmail: john@example.com`,
          },
          sessionId: session.id,
        };
      }

      const updateSet: Record<string, any> = { updatedAt: new Date() };
      const updatedFields: string[] = [];
      const extracted = collectedData._extractedData || {};

      for (const [field, value] of Object.entries(updates)) {
        if (field === "name") {
          updateSet.customerName = value;
          extracted.customer_name = value;
          updatedFields.push(`Name: ${value}`);
        } else if (field === "phone") {
          const rawPhone = (value as string).replace(/[\s\-\(\)\+]/g, '');
          const digitsOnly = rawPhone.replace(/\D/g, '');
          const [phoneLenRow] = await db
            .select({ phoneNumberLength: whatsappSettings.phoneNumberLength })
            .from(whatsappSettings)
            .where(eq(whatsappSettings.businessAccountId, businessAccountId))
            .limit(1);
          const expectedLen = phoneLenRow?.phoneNumberLength ?? 10;
          let cleanPhone = digitsOnly;
          if (expectedLen === 10 && digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
            cleanPhone = digitsOnly.slice(2);
          } else if (expectedLen === 10 && digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
            cleanPhone = digitsOnly.slice(1);
          }
          if (cleanPhone.length !== expectedLen) {
            return {
              handled: true,
              response: {
                type: "text",
                text: `Please enter a valid ${expectedLen}-digit mobile number.`,
              },
              sessionId: session.id,
            };
          }
          updateSet.customerPhone = cleanPhone;
          extracted.customer_phone = cleanPhone;
          updatedFields.push(`Phone: ${cleanPhone}`);
        } else if (field === "email") {
          updateSet.customerEmail = value;
          extracted.customer_email = value;
          updatedFields.push(`Email: ${value}`);
        } else if (field === "address") {
          extracted.address = value;
          updatedFields.push(`Address: ${value}`);
        }
      }

      collectedData._extractedData = extracted;

      if (existingLeadId && updatedFields.length > 0) {
        await db
          .update(whatsappLeads)
          .set(updateSet)
          .where(eq(whatsappLeads.id, existingLeadId));

        const existingLead = await this.getLeadById(existingLeadId);
        if (existingLead) {
          const existingExtracted = (existingLead.extractedData as Record<string, any>) || {};
          const mergedExtracted = { ...existingExtracted, ...extracted };
          await db
            .update(whatsappLeads)
            .set({ extractedData: mergedExtracted })
            .where(eq(whatsappLeads.id, existingLeadId));
        }

        console.log(`[WhatsApp Flow] Updated lead ${existingLeadId} fields: ${updatedFields.join(", ")}`);
      }

      await this.advanceSession(session.id, this.UPDATE_DETAILS_COLLECT_STEP, collectedData);

      return {
        handled: true,
        response: {
          type: "text",
          text: `Updated successfully:\n${updatedFields.join("\n")}\n\nYou can update more details or type "done" to finish.`,
        },
        sessionId: session.id,
      };
    }

    return { handled: false, shouldFallbackToAI: true };
  }

  private async getLeadById(leadId: string): Promise<any | null> {
    if (!leadId) return null;
    const [lead] = await db
      .select()
      .from(whatsappLeads)
      .where(eq(whatsappLeads.id, leadId))
      .limit(1);
    return lead || null;
  }

  async getMostRecentSession(
    businessAccountId: string,
    senderPhone: string
  ): Promise<WhatsappFlowSession | null> {
    const [session] = await db
      .select()
      .from(whatsappFlowSessions)
      .where(
        and(
          eq(whatsappFlowSessions.businessAccountId, businessAccountId),
          eq(whatsappFlowSessions.senderPhone, senderPhone)
        )
      )
      .orderBy(
        sql`${whatsappFlowSessions.lastMessageAt} DESC NULLS LAST`,
        desc(whatsappFlowSessions.createdAt)
      )
      .limit(1);
    return session || null;
  }

  async getActiveSession(
    businessAccountId: string,
    senderPhone: string
  ): Promise<WhatsappFlowSession | null> {
    const [session] = await db
      .select()
      .from(whatsappFlowSessions)
      .where(
        and(
          eq(whatsappFlowSessions.businessAccountId, businessAccountId),
          eq(whatsappFlowSessions.senderPhone, senderPhone),
          eq(whatsappFlowSessions.status, "active")
        )
      )
      .orderBy(desc(whatsappFlowSessions.createdAt))
      .limit(1);

    if (!session) return null;

    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      console.log(`[WhatsApp Flow] Session ${session.id} has expired (expiresAt: ${session.expiresAt})`);
      await this.expireSession(session.id);
      return null;
    }
    
    // Also check session timeout based on lastMessageAt
    const lastMessageTime = new Date(session.lastMessageAt);
    const now = new Date();
    const minutesSinceLastMessage = (now.getTime() - lastMessageTime.getTime()) / (1000 * 60);
    
    // Get the flow's session timeout setting
    const flow = await this.getActiveFlow(businessAccountId);
    const timeoutMinutes = flow?.sessionTimeout || this.DEFAULT_SESSION_TIMEOUT_MINUTES;
    
    if (minutesSinceLastMessage > timeoutMinutes) {
      console.log(`[WhatsApp Flow] Session ${session.id} timed out after ${minutesSinceLastMessage.toFixed(1)} minutes (limit: ${timeoutMinutes} min)`);
      await this.expireSession(session.id);
      return null;
    }

    return session;
  }

  private async hasCompletedSession(
    businessAccountId: string,
    flowId: string,
    senderPhone: string
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: whatsappFlowSessions.id })
      .from(whatsappFlowSessions)
      .where(
        and(
          eq(whatsappFlowSessions.businessAccountId, businessAccountId),
          eq(whatsappFlowSessions.flowId, flowId),
          eq(whatsappFlowSessions.senderPhone, senderPhone),
          eq(whatsappFlowSessions.status, "completed")
        )
      )
      .limit(1);
    return !!row;
  }

  async startSession(
    businessAccountId: string,
    flowId: string,
    senderPhone: string,
    startStepKey: string,
    sessionTimeoutMinutes?: number
  ): Promise<WhatsappFlowSession> {
    await db
      .update(whatsappFlowSessions)
      .set({ status: "abandoned" })
      .where(
        and(
          eq(whatsappFlowSessions.businessAccountId, businessAccountId),
          eq(whatsappFlowSessions.senderPhone, senderPhone),
          eq(whatsappFlowSessions.status, "active")
        )
      );

    let timeoutMinutes = sessionTimeoutMinutes;
    if (!timeoutMinutes) {
      const flow = await this.getFlowById(flowId);
      timeoutMinutes = flow?.sessionTimeout || this.DEFAULT_SESSION_TIMEOUT_MINUTES;
    }
    
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + timeoutMinutes);

    const [session] = await db
      .insert(whatsappFlowSessions)
      .values({
        businessAccountId,
        flowId,
        senderPhone,
        currentStepKey: startStepKey,
        status: "active",
        collectedData: {},
        lastMessageAt: new Date(),
        expiresAt,
      })
      .returning();

    console.log(`[WhatsApp Flow] Started new session for ${senderPhone}, step: ${startStepKey}`);

    this.cleanupEmptyLeadsAsync(businessAccountId, senderPhone);

    return session;
  }

  private cleanupEmptyLeadsAsync(businessAccountId: string, senderPhone: string): void {
    const normalizedPhone = normalizePhone(senderPhone);
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    (async () => {
      try {
        const emptyNonFlowLeads = await db
          .select()
          .from(whatsappLeads)
          .where(and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            eq(whatsappLeads.direction, 'incoming'),
            ne(whatsappLeads.status, 'message_only'),
            sql`${whatsappLeads.flowSessionId} IS NULL`,
            gte(whatsappLeads.receivedAt, thirtyMinsAgo)
          ));

        const phoneCandidates = emptyNonFlowLeads.filter(
          l => normalizePhone(l.senderPhone) === normalizedPhone
        );

        for (const lead of phoneCandidates) {
          const ext = (lead.extractedData as Record<string, any>) || {};
          const hasUsefulData = lead.customerName || lead.customerPhone || lead.customerEmail ||
            Object.entries(ext).some(([key, val]) =>
              val && !key.startsWith('_') && key !== 'raw_message'
            );

          if (!hasUsefulData) {
            await db
              .update(whatsappLeads)
              .set({ status: 'message_only' })
              .where(eq(whatsappLeads.id, lead.id));
            console.log(`[WhatsApp Flow] Downgraded empty non-flow lead ${lead.id} to message_only (phone: ${senderPhone})`);
          }
        }
      } catch (err) {
        console.error(`[WhatsApp Flow] Error cleaning up empty leads for ${senderPhone}:`, err);
      }
    })();
  }

  async advanceSession(
    sessionId: string,
    nextStepKey: string,
    collectedData: Record<string, any>
  ): Promise<void> {
    await db
      .update(whatsappFlowSessions)
      .set({
        currentStepKey: nextStepKey,
        collectedData,
        lastMessageAt: new Date(),
      })
      .where(eq(whatsappFlowSessions.id, sessionId));

    console.log(`[WhatsApp Flow] Advanced session ${sessionId} to step: ${nextStepKey}`);
  }

  private async finalizeSessionCompletion(sessionId: string, collectedData: Record<string, any>): Promise<boolean> {
    const updated = await db
      .update(whatsappFlowSessions)
      .set({ status: "completed", collectedData, lastMessageAt: new Date() })
      .where(and(
        eq(whatsappFlowSessions.id, sessionId),
        ne(whatsappFlowSessions.status, "completed")
      ))
      .returning({ id: whatsappFlowSessions.id });

    const transitioned = updated.length > 0;
    if (transitioned) {
      console.log(`[WhatsApp Flow] Session ${sessionId} transitioned to completed — triggering CRM auto-sync`);
      this.triggerCrmAutoSync(sessionId, collectedData).catch(err => {
        console.error(`[WhatsApp Flow] CRM auto-sync background error for session ${sessionId}:`, err);
      });
      // Configurable verification engine (Task #5) — non-blocking
      this.triggerVerification(sessionId).catch(err => {
        console.error(`[WhatsApp Flow] Verification background error for session ${sessionId}:`, err);
      });
    } else {
      console.log(`[WhatsApp Flow] Session ${sessionId} already completed — skipping CRM auto-sync`);
    }
    return transitioned;
  }

  private async triggerVerification(sessionId: string): Promise<void> {
    try {
      const [session] = await db
        .select()
        .from(whatsappFlowSessions)
        .where(eq(whatsappFlowSessions.id, sessionId))
        .limit(1);
      if (!session) return;

      const [flow] = await db
        .select()
        .from(whatsappFlows)
        .where(eq(whatsappFlows.id, session.flowId))
        .limit(1);
      if (!flow || !flow.verificationRuleSetId) return; // verification not configured

      // Find the lead associated with this session (most recent for this sender)
      const { whatsappService } = await import("./whatsappService");
      const lead =
        (await whatsappService.findLeadByFlowSession(session.businessAccountId, sessionId)) ||
        (await whatsappService.findMostRecentLeadBySender(session.businessAccountId, session.senderPhone));
      if (!lead) {
        console.log(`[Verification] No lead found for session ${sessionId} — skipping`);
        return;
      }

      const { runVerification } = await import("./verification");
      const { sendVerificationOutbound } = await import("./verification/notifier");
      const result = await runVerification({ leadId: lead.id, ruleSetId: flow.verificationRuleSetId });
      console.log(`[Verification] Session ${sessionId} verdict: ${result.verdict} (${result.counts.pass}/${result.counts.total} passed)`);
      await sendVerificationOutbound({
        businessAccountId: session.businessAccountId,
        recipientPhone: lead.customerPhone || lead.senderPhone || session.senderPhone,
        flowSessionId: sessionId,
        result,
      });
    } catch (err) {
      console.error(`[Verification] triggerVerification failed:`, err);
    }
  }

  /**
   * Per-upload incremental verification (Task #1 — "Instant verification per upload").
   *
   * Runs all configured cross-document rules (cross_field / threshold / chronology)
   * against the live session state right after a document finishes extracting.
   * For cross_field rules, fires the moment any 2 of the configured docs are
   * present (so Aadhaar↔PAN mismatches are caught before the marksheet
   * arrives). Threshold / chronology rules still wait for ALL referenced docs.
   * Dedups already-reported failures via `collectedData._verifiedRuleFailures`.
   *
   * Severity policy (Task #1 — Simplify rule severity to Warning + Blocker):
   *   • Blocker implicating failure → reject the just-uploaded doc and ask
   *     the customer to re-upload.
   *   • Warning (or legacy Info) implicating failure → notify the customer
   *     with a ⚠️ message but accept the doc and let the flow continue.
   *
   * Returns:
   *   { rejectUploadedDoc: true }   → caller should reject the just-uploaded doc
   *                                   (clear pages/mergedData, drop from
   *                                   _collectedDocuments). A blocker warning
   *                                   message has already been sent to the
   *                                   customer (unless suppressed for inline
   *                                   delivery).
   *   { rejectUploadedDoc: false, implicatingWarning } → no blocker failure on
   *                                   the upload; any warning failures have
   *                                   either been sent already (default) or
   *                                   handed back via `implicatingWarning` for
   *                                   inline delivery (suppressImplicatingOutbound).
   *
   * Never throws — verification failures are logged and treated as no-op so a
   * flaky rule cannot block the upload flow.
   */
  private async runInstantVerification(
    session: WhatsappFlowSession,
    collectedData: Record<string, any>,
    justUploadedDocType: string,
    opts: { suppressImplicatingOutbound?: boolean; silent?: boolean } = {},
  ): Promise<{
    rejectUploadedDoc: boolean;
    rejectionWarning?: string;
    implicatingWarning?: string;
    hasBlocker: boolean;
    implicatingCount: number;
  }> {
    try {
      const [flow] = await db
        .select({ verificationRuleSetId: whatsappFlows.verificationRuleSetId })
        .from(whatsappFlows)
        .where(eq(whatsappFlows.id, session.flowId))
        .limit(1);
      console.log(`[Verification] runInstantVerification entered for session ${session.id} (ruleSet=${flow?.verificationRuleSetId || "none"}, justUploaded=${justUploadedDocType}, silent=${!!opts.silent})`);
      verifDebug(session.businessAccountId, 'runInstantVerification:start', {
        sessionId: session.id, flowId: session.flowId, ruleSet: flow?.verificationRuleSetId || null,
        justUploaded: justUploadedDocType, silent: !!opts.silent,
        suppressImplicating: !!opts.suppressImplicatingOutbound,
      });
      if (!flow?.verificationRuleSetId) {
        return { rejectUploadedDoc: false, hasBlocker: false, implicatingCount: 0 };
      }

      const { runIncrementalVerification } = await import("./verification");
      const { sendIncrementalVerificationOutbound, composeIncrementalMessage } = await import("./verification/notifier");

      const result = await runIncrementalVerification({
        ruleSetId: flow.verificationRuleSetId,
        businessAccountId: session.businessAccountId,
        collectedData,
      });

      // Split failures by whether they implicate the document we just uploaded.
      // `implicatedDocs` is attached by runIncrementalVerification — no second DB hop.
      const normalizedUploaded = justUploadedDocType.toLowerCase().replace(/_card$/, "");
      const implicating = result.failures.filter(f => f.implicatedDocs.includes(normalizedUploaded));
      const otherDoc = result.failures.filter(f => !f.implicatedDocs.includes(normalizedUploaded));

      verifDebug(session.businessAccountId, 'runInstantVerification:findings', {
        evaluated: result.evaluated, skippedMissingDocs: result.skippedMissingDocs,
        totalFailures: result.failures.length,
        implicatingCount: implicating.length, otherDocCount: otherDoc.length,
        implicatingRuleIds: implicating.map(f => f.ruleId),
        otherDocRuleIds: otherDoc.map(f => f.ruleId),
      });

      // --- Dedup: messages, NOT rejection -----------------------------------
      // Rejection MUST be driven by current implicating failures, not by the
      // dedup set — otherwise a user who re-uploads the same bad doc would
      // get it silently accepted because the rule ID is already in the set.
      const alreadyNotified: string[] = Array.isArray(collectedData._verifiedRuleFailures)
        ? (collectedData._verifiedRuleFailures as string[])
        : [];

      // Prune stale entries: a rule that is no longer failing should be removable
      // from the set so it can be re-notified if it fails again later (fail → pass → fail).
      const currentFailedIds = new Set(result.failures.map(f => f.ruleId));
      const stillNotified = alreadyNotified.filter(id => currentFailedIds.has(id));

      // Implicating failures are ALWAYS surfaced to the user — they just
      // uploaded the offending doc and are waiting for feedback on this
      // specific upload. Other-doc failures use the dedup set to avoid spam.
      const newOtherDoc = otherDoc.filter(f => !stillNotified.includes(f.ruleId));

      // Mark BOTH implicating and other-doc failures as notified once we
      // surface them anywhere (silent confirmation injection OR outbound).
      // Without this, the post-confirm path would re-fire the same warnings.
      collectedData._verifiedRuleFailures = Array.from(new Set([
        ...stillNotified,
        ...implicating.map(f => f.ruleId),
        ...newOtherDoc.map(f => f.ruleId),
      ]));

      const recipient = session.senderPhone;
      // Only blocker-severity failures reject the upload. Warning-severity
      // failures (and legacy info, which is being retired) surface a notice
      // to the customer but the doc is accepted and the flow continues.
      const blockerImplicating = implicating.filter(f => f.severity === 'blocker');
      const warningImplicating = implicating.filter(f => f.severity !== 'blocker');
      const hasBlocker = blockerImplicating.length > 0;
      const rejectUploadedDoc = hasBlocker;
      const rejectionWarning = hasBlocker
        ? (composeIncrementalMessage(blockerImplicating, { rejectingUploadedDoc: true }) || undefined)
        : undefined;
      // implicatingWarning is the inline message for warning-only failures on
      // the just-uploaded doc — caller delivers it via its own response channel.
      const implicatingWarning = !hasBlocker && warningImplicating.length > 0
        ? (composeIncrementalMessage(warningImplicating, { rejectingUploadedDoc: false }) || undefined)
        : undefined;

      // Silent mode: caller will surface warnings inline (e.g. inject into the
      // same confirmation summary message). Do NOT send any outbound here.
      if (opts.silent) {
        verifDebug(session.businessAccountId, 'runInstantVerification:silent-return', {
          rejectUploadedDoc, hasBlocker, implicatingCount: implicating.length,
        });
        return { rejectUploadedDoc, rejectionWarning, implicatingWarning, hasBlocker, implicatingCount: implicating.length };
      }

      // If the caller will deliver the warning via its own response channel
      // (e.g. confirmation-acceptance returns `response: { type: 'text', ... }`),
      // skip the implicating outbound to avoid duplicate messages.
      if (implicating.length > 0 && !opts.suppressImplicatingOutbound) {
        if (hasBlocker) {
          // Blocker failures → rejection message; the caller will halt the
          // flow and prompt for re-upload.
          await sendIncrementalVerificationOutbound({
            businessAccountId: session.businessAccountId,
            recipientPhone: recipient,
            flowSessionId: session.id,
            failures: blockerImplicating,
            rejectingUploadedDoc: true,
          });
        } else if (warningImplicating.length > 0) {
          // Warning-only failures → FYI notice; doc is accepted and flow continues.
          await sendIncrementalVerificationOutbound({
            businessAccountId: session.businessAccountId,
            recipientPhone: recipient,
            flowSessionId: session.id,
            failures: warningImplicating,
            rejectingUploadedDoc: false,
          });
        }
      }
      if (newOtherDoc.length > 0) {
        await sendIncrementalVerificationOutbound({
          businessAccountId: session.businessAccountId,
          recipientPhone: recipient,
          flowSessionId: session.id,
          failures: newOtherDoc,
        });
      }

      return { rejectUploadedDoc, rejectionWarning, implicatingWarning, hasBlocker, implicatingCount: implicating.length };
    } catch (err: any) {
      console.error(`[WhatsApp Flow] runInstantVerification failed for session ${session.id}:`, err);
      return { rejectUploadedDoc: false, hasBlocker: false, implicatingCount: 0 };
    }
  }

  async completeSession(sessionId: string, collectedData: Record<string, any>): Promise<void> {
    this.cleanOffTopicCounters(collectedData);
    await this.finalizeSessionCompletion(sessionId, collectedData);
    console.log(`[WhatsApp Flow] Completed session ${sessionId}`);
  }

  async triggerCrmAutoSync(sessionId: string, collectedData: Record<string, any>): Promise<void> {
    try {
      const [session] = await db
        .select()
        .from(whatsappFlowSessions)
        .where(eq(whatsappFlowSessions.id, sessionId))
        .limit(1);

      if (!session) return;

      const { businessAccountId, senderPhone } = session;

      const [settings] = await db
        .select()
        .from(customCrmSettings)
        .where(eq(customCrmSettings.businessAccountId, businessAccountId))
        .limit(1);

      if (!settings || !settings.enabled || !settings.autoSyncEnabled) {
        return;
      }

      if (!settings.apiBaseUrl || !settings.apiEndpoint) {
        console.log(`[CRM AutoSync] Skipping - API URL not configured for ${businessAccountId}`);
        return;
      }

      const fieldMappings = await db
        .select()
        .from(customCrmFieldMappings)
        .where(eq(customCrmFieldMappings.businessAccountId, businessAccountId))
        .orderBy(customCrmFieldMappings.sortOrder);

      if (fieldMappings.length === 0) {
        console.log(`[CRM AutoSync] Skipping - No field mappings for ${businessAccountId}`);
        return;
      }

      // TIER 1: Authoritative — lead directly linked to this session via flowSessionId.
      // Order by named-first so that if multiple leads share the same session (e.g. blank
      // leads created by follow-up messages after completion), the populated lead wins.
      const [sessionLead] = await db
        .select()
        .from(whatsappLeads)
        .where(and(
          eq(whatsappLeads.businessAccountId, businessAccountId),
          eq(whatsappLeads.flowSessionId, sessionId)
        ))
        .orderBy(
          sql`CASE WHEN ${whatsappLeads.customerName} IS NOT NULL AND ${whatsappLeads.customerName} != '' THEN 0 ELSE 1 END`,
          desc(whatsappLeads.updatedAt)
        )
        .limit(1);

      // TIER 2: Soft match — same phone + customer name (covers older leads without flowSessionId)
      let namedLead: typeof sessionLead | undefined;
      const customerName = (
        (collectedData.customer_name as string) ||
        (collectedData.customerName as string) ||
        ''
      ).trim();
      if (!sessionLead && customerName) {
        const [found] = await db
          .select()
          .from(whatsappLeads)
          .where(and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            eq(whatsappLeads.senderPhone, senderPhone),
            ilike(whatsappLeads.customerName, customerName)
          ))
          .orderBy(desc(whatsappLeads.updatedAt))
          .limit(1);
        namedLead = found;
      }

      // TIER 3: Last resort — most recently updated lead for this phone (original behaviour)
      let fallbackLead: typeof sessionLead | undefined;
      if (!sessionLead && !namedLead) {
        const [found] = await db
          .select()
          .from(whatsappLeads)
          .where(and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            eq(whatsappLeads.senderPhone, senderPhone)
          ))
          .orderBy(desc(whatsappLeads.updatedAt))
          .limit(1);
        fallbackLead = found;
      }

      const resolvedVia = sessionLead ? 'session_id' : namedLead ? 'customer_name' : 'phone_fallback';
      const lead = sessionLead ?? namedLead ?? fallbackLead;

      if (!lead) {
        console.log(`[CRM AutoSync] No lead found for ${senderPhone}`);
        return;
      }

      console.log(`[CRM AutoSync] Lead resolved via ${resolvedVia}: ${lead.id}`);

      if (lead.customCrmSyncStatus === 'synced') {
        console.log(`[CRM AutoSync] Lead ${lead.id} already synced, skipping`);
        return;
      }

      const extractedData = (lead.extractedData as Record<string, any>) || {};

      let documents: Record<string, { url: string; fileName?: string; mimeType?: string }[]> = {};
      const attachments = await db
        .select({
          filePath: whatsappLeadAttachments.filePath,
          fileName: whatsappLeadAttachments.fileName,
          mimeType: whatsappLeadAttachments.mimeType,
          documentCategory: whatsappLeadAttachments.documentCategory,
        })
        .from(whatsappLeadAttachments)
        .where(eq(whatsappLeadAttachments.leadId, lead.id));

      for (const att of attachments) {
        if (!att.filePath || !att.documentCategory) continue;
        if (!documents[att.documentCategory]) documents[att.documentCategory] = [];
        documents[att.documentCategory].push({
          url: att.filePath,
          fileName: att.fileName || undefined,
          mimeType: att.mimeType || undefined,
        });
      }

      const leadContext = {
        lead: {
          customerName: lead.customerName || null,
          customerEmail: lead.customerEmail || null,
          customerPhone: lead.customerPhone || null,
          senderPhone: lead.senderPhone || null,
        },
        extracted: extractedData,
        documents,
      };

      let storeCredential = undefined;
      const storeName = extractedData.store_name || extractedData.storeName;
      const dealerName = extractedData.dealer_name || extractedData.dealerName || extractedData.dealer;
      const cityName = extractedData.city || extractedData.city_name || extractedData.dealer_city || extractedData.dealerCity;

      if (storeName || dealerName) {
        const storeCreds = await db
          .select()
          .from(crmStoreCredentials)
          .where(and(
            eq(crmStoreCredentials.businessAccountId, businessAccountId),
            eq(crmStoreCredentials.isActive, true)
          ));

        const norm = (s?: string | null) => s ? s.trim().toLowerCase() : '';
        const nStore = norm(storeName);
        const nDealer = norm(dealerName);
        const nCity = norm(cityName);

        if (nStore && nDealer && nCity) {
          storeCredential = storeCreds.find(
            sc => norm(sc.storeName) === nStore && norm(sc.dealerName) === nDealer && norm(sc.city) === nCity
          );
        }

        if (!storeCredential && nStore && nDealer) {
          storeCredential = storeCreds.find(
            sc => norm(sc.storeName) === nStore && norm(sc.dealerName) === nDealer
          );
        }

        if (!storeCredential && nStore) {
          storeCredential = storeCreds.find(
            sc => norm(sc.storeName) === nStore
          );
        }

        if (!storeCredential && storeCreds.length > 0 && (nStore || nDealer)) {
          try {
            const { apiKey } = await this.getApiKeyForBusiness(businessAccountId);
            if (apiKey) {
              const openaiClient = new OpenAI({ apiKey, timeout: 15000 });
              const storeList = storeCreds.map(sc => ({
                id: sc.id,
                dealerName: sc.dealerName,
                storeName: sc.storeName,
                city: sc.city || '',
                storeId: sc.storeId,
              }));
              const prompt = `Match the lead's store info to the closest store credential.

Lead info:
- Dealer: ${dealerName || 'unknown'}
- City: ${cityName || 'unknown'}
- Store: ${storeName || 'unknown'}

Available stores (JSON):
${JSON.stringify(storeList)}

Return ONLY a JSON object: {"matchedId": "<store id or null>", "confidence": <0.0-1.0>}
If no good match exists, return {"matchedId": null, "confidence": 0}`;

              const completion = await openaiClient.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 100,
                response_format: { type: 'json_object' },
              });

              const content = completion.choices[0]?.message?.content;
              if (content) {
                const result = JSON.parse(content);
                if (result.matchedId && result.confidence >= 0.75) {
                  storeCredential = storeCreds.find(sc => sc.id === result.matchedId);
                  console.log(`[CRM AutoSync] AI fuzzy match: store=${storeCredential?.storeName}, confidence=${result.confidence}`);
                } else {
                  console.log(`[CRM AutoSync] AI fuzzy match: no confident match (confidence=${result.confidence})`);
                }
              }
            }
          } catch (aiErr) {
            console.warn(`[CRM AutoSync] AI fuzzy store matching failed:`, aiErr);
          }
        }

        if (storeCredential) {
          console.log(`[CRM AutoSync] Resolved store: ${storeCredential.storeName} (SID: ${storeCredential.sid}, ID: ${storeCredential.storeId})`);
        } else {
          console.warn(`[CRM AutoSync] No store match found for dealer="${dealerName}" city="${cityName}" store="${storeName}"`);
        }
      }

      console.log(`[CRM AutoSync] Syncing lead ${lead.id} for session ${sessionId}`);

      const { syncLeadWithDocuments } = await import('./customCrmService');
      const result = await syncLeadWithDocuments(settings, fieldMappings, leadContext, storeCredential);

      if (result.success) {
        await db.update(whatsappLeads)
          .set({
            customCrmSyncStatus: 'synced',
            customCrmSyncedAt: new Date(),
            customCrmLeadId: result.leadId || result.applicationId || null,
            customCrmSyncError: null,
            customCrmSyncPayload: result.payload as any,
            updatedAt: new Date(),
          })
          .where(eq(whatsappLeads.id, lead.id));

        console.log(`[CRM AutoSync] Lead ${lead.id} synced successfully: ${result.message}`);
      } else {
        await db.update(whatsappLeads)
          .set({
            customCrmSyncStatus: 'failed',
            customCrmSyncError: result.message,
            customCrmSyncPayload: result.payload as any,
            updatedAt: new Date(),
          })
          .where(eq(whatsappLeads.id, lead.id));

        console.error(`[CRM AutoSync] Lead ${lead.id} sync failed: ${result.message}`);
      }
    } catch (error) {
      console.error(`[CRM AutoSync] Error for session ${sessionId}:`, error);
    }
  }

  async expireSession(sessionId: string): Promise<void> {
    await db
      .update(whatsappFlowSessions)
      .set({ status: "expired" })
      .where(eq(whatsappFlowSessions.id, sessionId));
  }

  private async detectGlobalFlowIntent(
    message: string,
    collectedData: Record<string, any>,
    steps: WhatsappFlowStep[],
    businessAccountId: string,
    currentStepType?: string
  ): Promise<{ intent: 'update_field' | 'restart' | 'none'; fieldsToUpdate: string[]; response: string }> {
    const restartRegex = /(start\s*(over|again|fresh|from\s*(the\s*)?beginning)|fill\s*(again|fresh|it\s*again)|cancel|restart|begin\s*again|shuru\s*se|fir\s*se|dobara|naya\s*bharo)/i;
    if (restartRegex.test(message)) {
      return { intent: 'restart', fieldsToUpdate: [], response: "Sure! Let me start the form fresh for you." };
    }

    const userDataFields = Object.keys(collectedData).filter(k => !k.startsWith('_'));
    if (message.length <= 15 || userDataFields.length === 0) {
      return { intent: 'none', fieldsToUpdate: [], response: '' };
    }

    // At data-entry steps, only proceed if the user explicitly mentions updating/changing something.
    // A formatted data submission (e.g. "PAN: FHRPS7793R, Aadhaar: 830305669277...") will never
    // contain these keywords, so we skip the AI call and let the step's own extractor handle it.
    const isDataEntryStep = currentStepType === 'input' || currentStepType === 'text';
    const hasUpdateKeyword = /(change|update|modify|correct|fix|wrong|mistake|i entered|i typed|i made a|redo|re-enter|re enter)/i.test(message);

    if (isDataEntryStep && !hasUpdateKeyword) {
      return { intent: 'none', fieldsToUpdate: [], response: '' };
    }

    const { apiKey } = await this.getApiKeyForBusiness(businessAccountId);
    if (!apiKey) {
      return { intent: 'none', fieldsToUpdate: [], response: '' };
    }

    const collectedSnapshot = userDataFields
      .map(k => `${k}: "${collectedData[k]}"`)
      .join('\n');

    const stepContext = isDataEntryStep
      ? `The user is currently at a DATA ENTRY step — they are expected to provide their information as an answer to a question.`
      : currentStepType === 'upload'
      ? `The user is currently at a DOCUMENT UPLOAD step — they are expected to upload files, not type data.`
      : `The user is currently at a SELECTION step — they are expected to pick one of the available options.`;

    const prompt = `You are processing a WhatsApp form conversation.

${stepContext}

FIELDS COLLECTED SO FAR (these are the ONLY valid field keys):
${collectedSnapshot}

USER MESSAGE: "${message}"

Task: Classify the user's intent into exactly one of three categories.

Intents:
- "update_field": User explicitly wants to correct or change a specific field they previously entered (e.g. "I entered wrong PAN", "change my aadhaar", "I made a mistake in my email")
- "data_submission": User is answering the current step's question by providing their information (e.g. pasting a form summary, typing their details as requested)
- "none": Anything else — a question, greeting, or unrelated message

Rules:
- fieldsToUpdate MUST only contain keys from the "FIELDS COLLECTED SO FAR" list above — never invent new keys
- If intent is "data_submission" or "none", fieldsToUpdate must be []
- Only use "update_field" if the user clearly expresses intent to change something already submitted
- If the user mentions a concept not in collected fields, use "none" and explain in response

Return ONLY valid JSON (no markdown):
{"intent": "update_field" | "data_submission" | "none", "fieldsToUpdate": ["key1", "key2"], "response": "short warm acknowledgment OR explanation OR empty string"}`;

    try {
      const openaiClient = new OpenAI({ apiKey, timeout: 15000 });
      const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content || '{}';
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.warn(`[WhatsApp Flow] detectGlobalFlowIntent returned invalid JSON: ${raw.substring(0, 200)}`);
        return { intent: 'none', fieldsToUpdate: [], response: '' };
      }
      // "data_submission" is treated the same as "none" — fall through to the step's own handler
      return {
        intent: parsed.intent === 'update_field' ? 'update_field' : 'none',
        fieldsToUpdate: Array.isArray(parsed.fieldsToUpdate) ? parsed.fieldsToUpdate : [],
        response: parsed.response || '',
      };
    } catch (err) {
      console.warn('[WhatsApp Flow] detectGlobalFlowIntent AI error:', err);
      return { intent: 'none', fieldsToUpdate: [], response: '' };
    }
  }

  /**
   * Resolve a typed answer to a configured interactive choice.
   *
   * Adaptive mode is intentionally closed-world: the model can only return an
   * ID that already exists on this step. Branching, saved values, and follow-up
   * prompts continue through the normal selection handlers below.
   */
  private async resolveAdaptiveSelection(
    businessAccountId: string,
    message: string,
    step: WhatsappFlowStep,
    collectedData: Record<string, any>
  ): Promise<string | null> {
    const resolvedStep = this.resolveStepOptions(step, collectedData);
    const options = resolvedStep.options as FlowStepOptions | null;
    const choices: Array<{ id: string; title: string; value?: string }> =
      resolvedStep.type === "buttons"
        ? (options?.buttons || []).map(item => ({ id: item.id, title: item.title }))
        : resolvedStep.type === "dropdown"
          ? (options?.dropdownItems || []).map(item => ({ id: item.id, title: item.title, value: item.value }))
          : resolvedStep.type === "list"
            ? (options?.sections || []).flatMap(section => section.rows || [])
            : [];

    if (choices.length === 0) return null;
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const normalizedMessage = normalize(message);
    const exact = choices.find(choice =>
      normalize(choice.id) === normalizedMessage ||
      normalize(choice.title) === normalizedMessage ||
      (choice.value && normalize(choice.value) === normalizedMessage)
    );
    if (exact) return exact.id;

    const { apiKey } = await this.getApiKeyForBusiness(businessAccountId);
    if (!apiKey || message.trim().length < 2) return null;

    try {
      const client = new OpenAI({ apiKey, timeout: 12000 });
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 80,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: `Match the customer answer to exactly one configured WhatsApp choice. Return null when it is ambiguous, unrelated, a question, or does not clearly mean one choice. Never invent a choice or ID.

Customer answer: ${JSON.stringify(message)}
Configured choices: ${JSON.stringify(choices)}

Return only JSON: {"optionId":"one configured id" | null}`,
        }],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
      return choices.some(choice => choice.id === parsed.optionId) ? parsed.optionId : null;
    } catch (error) {
      console.warn("[WhatsApp Flow] Adaptive selection resolution failed:", error);
      return null;
    }
  }

  async processMessage(
    businessAccountId: string,
    senderPhone: string,
    message: string,
    prefetchedSession?: WhatsappFlowSession | null,
    isInteractive?: boolean
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    console.log(`[WhatsApp Flow] Processing message from ${senderPhone}: "${message}"`);

    const activeFlow = await this.getActiveFlow(businessAccountId);
    if (!activeFlow) {
      console.log(`[WhatsApp Flow] No active flow for business ${businessAccountId}`);
      return { handled: false, shouldFallbackToAI: true };
    }

    const steps = await this.getFlowSteps(activeFlow.id);
    console.log(`[WhatsApp Flow] [Timing] getActiveFlow+getFlowSteps: ${Date.now() - startTime}ms`);
    if (steps.length === 0) {
      console.log(`[WhatsApp Flow] Flow ${activeFlow.id} has no steps`);
      return { handled: false, shouldFallbackToAI: true };
    }

    let normalizedMessage = message.trim().toLowerCase();
    
    const triggerKeyword = activeFlow.triggerKeyword?.trim() || null;
    
    const isTriggerKeywordMatch = triggerKeyword && 
      triggerKeyword.length > 0 &&
      normalizedMessage === triggerKeyword.toLowerCase();
    
    const flowTimeout = activeFlow.sessionTimeout || this.DEFAULT_SESSION_TIMEOUT_MINUTES;
    
    if (isTriggerKeywordMatch) {
      console.log(`[WhatsApp Flow] Trigger keyword matched: "${activeFlow.triggerKeyword}" - restarting flow`);
      
      const startStep = this.getFirstActiveStep(steps);
      if (!startStep) {
        console.log(`[WhatsApp Flow] All steps are paused`);
        return { handled: false, shouldFallbackToAI: true };
      }
      const newSession = await this.startSession(
        businessAccountId,
        activeFlow.id,
        senderPhone,
        startStep.stepKey,
        flowTimeout
      );
      console.log(`[WhatsApp Flow] [Timing] startSession: ${Date.now() - startTime}ms`);

      return {
        handled: true,
        response: this.buildStepResponse(startStep),
        sessionId: newSession.id,
      };
    }
    
    let session = prefetchedSession !== undefined ? prefetchedSession : await this.getActiveSession(businessAccountId, senderPhone);
    console.log(`[WhatsApp Flow] [Timing] getActiveSession: ${Date.now() - startTime}ms`);

    if (session && this.isUpdateFlowStep(session.currentStepKey)) {
      console.log(`[WhatsApp Flow] Active update flow session detected, routing to update menu handler`);
      return this.handleUpdateMenu(businessAccountId, senderPhone, message, session, activeFlow);
    }

    if (!session) {
      if (triggerKeyword) {
        console.log(`[WhatsApp Flow] Message doesn't match trigger keyword "${triggerKeyword}"`);
        console.log(`[WhatsApp Flow] [Timing] processMessage total: ${Date.now() - startTime}ms`);
        return { handled: false, shouldFallbackToAI: activeFlow.fallbackToAI === "true" };
      }

      const hasCompletedSession = await this.hasCompletedSession(businessAccountId, activeFlow.id, senderPhone);
      if (hasCompletedSession && activeFlow.repeatMode !== "loop") {
        console.log(`[WhatsApp Flow] User ${senderPhone} already completed flow — falling through to AI`);
        console.log(`[WhatsApp Flow] [Timing] processMessage total: ${Date.now() - startTime}ms`);
        return { handled: false, shouldFallbackToAI: true, skipLeadCreation: true };
      }
      if (hasCompletedSession && activeFlow.repeatMode === "loop") {
        console.log(`[WhatsApp Flow] User ${senderPhone} completed flow before — repeat mode is loop, restarting flow`);
      }

      const startStep = this.getFirstActiveStep(steps);
      if (!startStep) {
        console.log(`[WhatsApp Flow] All steps are paused`);
        return { handled: false, shouldFallbackToAI: true };
      }
      session = await this.startSession(
        businessAccountId,
        activeFlow.id,
        senderPhone,
        startStep.stepKey,
        flowTimeout
      );
      console.log(`[WhatsApp Flow] [Timing] startSession: ${Date.now() - startTime}ms`);

      console.log(`[WhatsApp Flow] [Timing] processMessage total: ${Date.now() - startTime}ms`);
      return {
        handled: true,
        response: this.buildStepResponse(startStep),
        sessionId: session.id,
      };
    }

    const currentStep = await this.getStepByKey(activeFlow.id, session.currentStepKey);
    if (!currentStep) {
      console.log(`[WhatsApp Flow] Current step not found: ${session.currentStepKey}`);
      await this.expireSession(session.id);
      return { handled: false, shouldFallbackToAI: true };
    }

    if ((currentStep as any).paused) {
      console.log(`[WhatsApp Flow] Current step "${currentStep.stepKey}" is paused, auto-skipping to next active step`);
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

    if (collectedData._followUpPending) {
      if (this.EXIT_KEYWORDS.includes(normalizedMessage)) {
        delete collectedData._followUpPending;
        console.log(`[WhatsApp Flow] Exit keyword during follow-up — expiring session`);
        await this.expireSession(session.id);
        return { handled: true, response: { type: "text" as const, text: "Your session has been ended. You can start again anytime." } };
      }

      const followUp = collectedData._followUpPending as {
        nextStepKey: string | null;
      };
      const followUpSaveField = currentStep.saveToField || "selection";
      collectedData[followUpSaveField] = message.trim();
      delete collectedData._followUpPending;
      console.log(`[WhatsApp Flow] Follow-up response saved to "${followUpSaveField}": "${message.trim()}"`);

      const completionMsg = activeFlow.completionMessage || "Thank you! Your information has been recorded.";
      const targetStepKey = followUp.nextStepKey
        ? followUp.nextStepKey
        : this.getNextStepKey(currentStep.stepKey, steps);

      if (!targetStepKey) {
        await this.completeSession(session.id, collectedData);
        return {
          handled: true,
          flowCompleted: true,
          collectedData,
          sessionId: session.id,
          response: { type: "text" as const, text: completionMsg },
        };
      }

      if (targetStepKey === "end_with_ai") {
        console.log(`[WhatsApp Flow] Follow-up complete — end_with_ai, handing off to AI`);
        await this.completeSession(session.id, collectedData);
        return { handled: false, shouldFallbackToAI: true };
      }

      if (targetStepKey === "end" || targetStepKey === "complete") {
        await this.completeSession(session.id, collectedData);
        return {
          handled: true,
          flowCompleted: true,
          collectedData,
          sessionId: session.id,
          response: { type: "text" as const, text: completionMsg },
        };
      }

      const nextStep = await this.getStepByKey(activeFlow.id, targetStepKey);
      if (!nextStep) {
        await this.completeSession(session.id, collectedData);
        return { handled: true, flowCompleted: true, collectedData, sessionId: session.id };
      }

      await this.advanceSession(session.id, targetStepKey, collectedData);
      return {
        handled: true,
        response: this.buildStepResponse(nextStep),
        sessionId: session.id,
      };
    }

    if (collectedData._confirmationState) {
      console.log(`[WhatsApp Flow] Session has pending document confirmation — routing to confirmation handler`);
      const confirmResult = await this.handleConfirmationResponse(session, message, collectedData, activeFlow.id);
      if (confirmResult) return confirmResult;
    }

    if (this.isTextOnlyMessageStep(currentStep)) {
      console.log(`[WhatsApp Flow] Current step "${currentStep.stepKey}" is text-only message — auto-advancing`);
      let chainStep: WhatsappFlowStep | null = currentStep;
      let chainStepKey: string | null = currentStep.stepKey;
      let chainHops = 0;
      while (chainStep && this.isTextOnlyMessageStep(chainStep) && chainHops++ < 10) {
        const chainKey = this.resolveNextStepKeyForChain(chainStep, steps);
        if (!chainKey || chainKey === chainStepKey) {
          chainStepKey = null;
          chainStep = null;
          break;
        }
        chainStepKey = chainKey;
        chainStep = await this.getStepByKey(activeFlow.id, chainKey);
      }

      if (!chainStep || !chainStepKey) {
        const completionMsg = activeFlow.completionMessage || "Thank you! Your information has been recorded.";
        await this.completeSession(session.id, collectedData);
        return {
          handled: true,
          flowCompleted: true,
          collectedData,
          sessionId: session.id,
          response: { type: "text", text: completionMsg },
        };
      }
      await this.advanceSession(session.id, chainStepKey, collectedData);
      if (chainStep.type === "end") {
        await this.completeSession(session.id, collectedData);
        return {
          handled: true,
          flowCompleted: true,
          collectedData,
          sessionId: session.id,
          response: { type: "text", text: chainStep.prompt },
        };
      }
      return {
        handled: true,
        response: this.buildStepResponse(chainStep, collectedData),
        collectedData: Object.keys(collectedData).length > 0 ? collectedData : undefined,
        sessionId: session.id,
      };
    }

    // ── Global intent check: field update or full restart (works at any step) ──
    // Skip for interactive responses (button/list/dropdown clicks) — those are valid selections, not free-text requests
    if (isInteractive) {
      console.log(`[WhatsApp Flow] Skipping global intent check for interactive response: "${message}"`);
    }
    const globalIntent = !isInteractive
      ? await this.detectGlobalFlowIntent(message, collectedData, steps, businessAccountId, currentStep.type)
      : { intent: 'continue' as const, fieldsToUpdate: [] as string[], response: '' };

    if (globalIntent.intent === 'restart') {
      const startStep = this.getFirstActiveStep(steps);
      if (startStep) {
        const newSession = await this.startSession(
          businessAccountId, activeFlow.id, senderPhone, startStep.stepKey, flowTimeout
        );
        console.log(`[WhatsApp Flow] Global restart: new session ${newSession.id} from step "${startStep.stepKey}"`);
        const startResponse = this.buildStepResponse(startStep);
        const startText = startResponse?.type === 'text' ? startResponse.text : startStep.prompt || '';
        return {
          handled: true,
          response: { type: 'text' as const, text: `${globalIntent.response}\n\n${startText}` },
          sessionId: newSession.id,
        };
      }
    }

    if (globalIntent.intent === 'update_field' && globalIntent.fieldsToUpdate.length > 0) {
      const fieldStepMap: Record<string, string> = {};
      for (const step of steps) {
        if (step.saveToField) fieldStepMap[step.saveToField] = step.stepKey;
        const opts = step.options as any;
        if (Array.isArray(opts?.requiredFields)) {
          for (const f of opts.requiredFields) fieldStepMap[f] = step.stepKey;
        }
      }

      const systemFields = new Set([
        '_phoneChecked', '_phoneValidated', '_updateExistingLeadId', 'customer_phone', 'customer phone',
      ]);

      const validFields = globalIntent.fieldsToUpdate.filter(
        f => !systemFields.has(f) && f in collectedData && fieldStepMap[f]
      );
      const unknownFields = globalIntent.fieldsToUpdate.filter(f => !(f in collectedData));

      if (validFields.length === 0) {
        const fieldList = globalIntent.fieldsToUpdate.join(', ');
        console.log(`[WhatsApp Flow] Global update: requested fields not collected: ${fieldList}`);
        return {
          handled: true,
          response: {
            type: 'text' as const,
            text: globalIntent.response || `Sorry, "${fieldList}" was not collected in this form. You can only update fields that have already been filled in.`,
          },
          sessionId: session.id,
        };
      }

      const targetStepKey = steps
        .map(s => s.stepKey)
        .find(k => validFields.some(f => fieldStepMap[f] === k));

      if (targetStepKey) {
        const targetStep = steps.find(s => s.stepKey === targetStepKey)!;
        const updatedData = { ...collectedData };
        for (const field of validFields) delete updatedData[field];

        // Surgically remove only doc entries linked to changed fields — preserve all other valid uploads
        if (updatedData._collectedDocuments && typeof updatedData._collectedDocuments === 'object') {
          const updatedDocs = { ...updatedData._collectedDocuments };
          for (const field of validFields) {
            const fieldNorm = field.toLowerCase().replace(/_/g, '');
            for (const docKey of Object.keys(updatedDocs)) {
              const docNorm = docKey.toLowerCase().replace(/_/g, '').replace(/\s/g, '');
              if (fieldNorm === docNorm || docNorm.includes(fieldNorm) || fieldNorm.includes(docNorm)) {
                delete updatedDocs[docKey];
              }
            }
          }
          updatedData._collectedDocuments = updatedDocs;
        } else {
          delete updatedData._collectedDocuments;
        }

        await this.advanceSession(session.id, targetStepKey, updatedData);
        console.log(`[WhatsApp Flow] Global update: navigated to "${targetStepKey}", cleared: ${validFields.join(', ')}`);

        const stepResponse = this.buildStepResponse(targetStep, updatedData);
        const stepText = stepResponse?.type === 'text' ? stepResponse.text : targetStep.prompt || 'Please re-enter the correct information.';

        let replyText = globalIntent.response || 'Sure, let me take you back to update that.';
        if (unknownFields.length > 0) {
          replyText += `\n\n(Note: "${unknownFields.join(', ')}" was not collected in this form, so only "${validFields.join(', ')}" will be updated.)`;
        }
        replyText += `\n\n${stepText}`;

        return {
          handled: true,
          response: { type: 'text' as const, text: replyText },
          sessionId: session.id,
        };
      }
    }
    // ── End global intent check ──

    if (
      this.isAdaptiveJourneyEnabled(activeFlow, businessAccountId) &&
      !isInteractive &&
      ["buttons", "dropdown", "list"].includes(currentStep.type)
    ) {
      const resolvedOptionId = await this.resolveAdaptiveSelection(
        businessAccountId,
        message,
        currentStep,
        collectedData
      );
      if (resolvedOptionId) {
        console.log(`[WhatsApp Flow] Adaptive mode resolved typed choice at "${currentStep.stepKey}"`);
        message = resolvedOptionId;
        normalizedMessage = resolvedOptionId.toLowerCase();
      }
    }

    // Guard: discard interactive button responses that arrive at a non-interactive step.
    // This prevents delayed "Yes/No" button presses from poisoning phone/text fields.
    if (isInteractive) {
      const isInteractiveStepType = ["buttons", "dropdown", "list"].includes(currentStep.type);
      if (!isInteractiveStepType) {
        console.log(`[WhatsApp Flow] Interactive response discarded at non-interactive step "${currentStep.stepKey}" (${currentStep.type}) — re-prompting`);
        return {
          handled: true,
          response: this.buildStepResponse(currentStep, collectedData) ?? { type: "text" as const, text: currentStep.prompt },
          sessionId: session.id,
        };
      }
    }

    const isTextInputStep = currentStep.type === "input" || currentStep.type === "text";
    if (currentStep.saveToField && !isTextInputStep) {
      collectedData[currentStep.saveToField] = message;
    }

    const flowContext = this.buildFlowContextSummary(activeFlow, steps, currentStep, collectedData);

    let nextStepKey: string | null = null;
    const options = currentStep.options as FlowStepOptions | null;
    const nextStepMapping = currentStep.nextStepMapping as NextStepMapping | null;

    // Helper to resolve next step key - handles "__auto__" and empty values as "next in sequence"
    // Automatically skips paused steps
    const resolveNextStepKey = (stepKey: string | undefined | null): string | null => {
      if (!stepKey || stepKey === "__auto__" || stepKey === "") {
        // Find the next non-paused step in sequence
        for (let i = currentStep.stepOrder + 1; i < currentStep.stepOrder + steps.length; i++) {
          const nextStep = steps.find(s => s.stepOrder === i);
          if (nextStep && !(nextStep as any).paused) {
            const nextOpts = nextStep.options as any;
            const allRequiredFilled = Array.isArray(nextOpts?.requiredFields) &&
              nextOpts.requiredFields.length > 0 &&
              nextOpts.requiredFields.every((f: string) => this.hasFieldValue(collectedData, f));
            const allSelectedFilled = Array.isArray(nextOpts?.selectedFields) &&
              nextOpts.selectedFields.length > 0 &&
              nextOpts.selectedFields.filter((f: any) => f.isRequired !== false).every((f: any) => this.hasFieldValue(collectedData, f.fieldKey));
            if (
              (nextStep.saveToField && this.hasFieldValue(collectedData, nextStep.saveToField)) ||
              allRequiredFilled ||
              allSelectedFilled
            ) {
              console.log(`[WhatsApp Flow] Auto-skipping step "${nextStep.stepKey}" (all required fields already filled from document)`);
              continue;
            }
            return nextStep.stepKey;
          }
          if (!nextStep) break;
        }
        return null;
      }
      // Explicit step key - check if it's paused
      const targetStep = steps.find(s => s.stepKey === stepKey);
      if (targetStep && (targetStep as any).paused) {
        // Skip to next non-paused step after the target
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
        console.log(`[WhatsApp Flow] Invalid button selection during active session: "${message}" — checking intent`);
        const buttonLabels = options.buttons.map(b => b.title).join(", ");
        return this.handleOffTopicMessage(
          businessAccountId,
          session,
          currentStep,
          message,
          collectedData,
          `one of the options: ${buttonLabels}`,
          currentStep.prompt,
          flowContext
        );
      }
    } else if (currentStep.type === "dropdown") {
      const resolvedDropStep = this.resolveStepOptions(currentStep, collectedData);
      const resolvedDropOptions = resolvedDropStep.options as FlowStepOptions | null;
      const resolvedItems = resolvedDropOptions?.dropdownItems || [];

      if (normalizedMessage === WhatsappFlowService.PAGE_NEXT_ID || normalizedMessage === "more options →") {
        const currentPage = collectedData[WhatsappFlowService.DROPDOWN_PAGE_KEY] || 1;
        const itemCount = resolvedItems.length;
        const maxPage = itemCount <= 10 ? 1 : (itemCount <= 18 ? 2 : 2 + Math.ceil((itemCount - 18) / 8));
        const nextPage = Math.min(maxPage, currentPage + 1);
        collectedData[WhatsappFlowService.DROPDOWN_PAGE_KEY] = nextPage;
        console.log(`[WhatsApp Flow] Dropdown pagination: advancing to page ${nextPage} of ${maxPage}`);
        await this.updateSessionData(session.id, collectedData);
        return {
          handled: true,
          response: this.buildStepResponse(currentStep, collectedData),
          sessionId: session.id,
        };
      }

      if (normalizedMessage === WhatsappFlowService.PAGE_PREV_ID || normalizedMessage === "← back") {
        const currentPage = collectedData[WhatsappFlowService.DROPDOWN_PAGE_KEY] || 1;
        collectedData[WhatsappFlowService.DROPDOWN_PAGE_KEY] = Math.max(1, currentPage - 1);
        console.log(`[WhatsApp Flow] Dropdown pagination: going back to page ${Math.max(1, currentPage - 1)}`);
        await this.updateSessionData(session.id, collectedData);
        return {
          handled: true,
          response: this.buildStepResponse(currentStep, collectedData),
          sessionId: session.id,
        };
      }

      const selectedItem = resolvedItems.find(
        (item) =>
          item.id.toLowerCase() === normalizedMessage ||
          item.title.toLowerCase() === normalizedMessage ||
          (item.value && item.value.toLowerCase() === normalizedMessage)
      );

      if (selectedItem) {
        delete collectedData[WhatsappFlowService.DROPDOWN_PAGE_KEY];
        const mappedStep = nextStepMapping?.[selectedItem.id];
        nextStepKey = resolveNextStepKey(mappedStep || currentStep.defaultNextStep);
        collectedData[currentStep.saveToField || "selection"] = selectedItem.value || selectedItem.title;

        if (selectedItem.followUpPrompt) {
          collectedData._followUpPending = {
            nextStepKey: nextStepKey,
          };
          console.log(`[WhatsApp Flow] Follow-up prompt triggered for label "${selectedItem.title}" (value: "${selectedItem.value || selectedItem.title}") — awaiting response for field "${currentStep.saveToField || "selection"}"`);
          await this.updateSessionData(session.id, collectedData);
          return {
            handled: true,
            response: { type: "text" as const, text: selectedItem.followUpPrompt },
            sessionId: session.id,
          };
        }
      } else if (resolvedItems.length > 0) {
        console.log(`[WhatsApp Flow] Invalid dropdown selection during active session: "${message}" — checking intent`);
        const dropdownLabels = resolvedItems.slice(0, 5).map(i => i.title).join(", ");
        return this.handleOffTopicMessage(
          businessAccountId,
          session,
          currentStep,
          message,
          collectedData,
          `a selection from the dropdown options (e.g., ${dropdownLabels})`,
          currentStep.prompt,
          flowContext
        );
      }
    } else if (currentStep.type === "list" && options?.sections) {
      let selectedRow: { id: string; title: string } | undefined;
      for (const section of options.sections) {
        const found = section.rows.find(
          (r) =>
            r.id.toLowerCase() === normalizedMessage ||
            r.title.toLowerCase() === normalizedMessage
        );
        if (found) {
          selectedRow = found;
          break;
        }
      }

      if (selectedRow) {
        const mappedStep = nextStepMapping?.[selectedRow.id];
        nextStepKey = resolveNextStepKey(mappedStep || currentStep.defaultNextStep);
        collectedData[currentStep.saveToField || "selection"] = selectedRow.title;
      } else {
        console.log(`[WhatsApp Flow] Invalid list selection during active session: "${message}" — checking intent`);
        const listLabels = options.sections.flatMap(s => s.rows).slice(0, 5).map(r => r.title).join(", ");
        return this.handleOffTopicMessage(
          businessAccountId,
          session,
          currentStep,
          message,
          collectedData,
          `a selection from the list (e.g., ${listLabels})`,
          currentStep.prompt,
          flowContext
        );
      }
    } else if (currentStep.type === "upload") {
      console.log(`[WhatsApp Flow] Current step is upload type - text message received: "${message}"`);

      const documentTypes = options?.documentTypes || [];
      const collectedDocs = collectedData._collectedDocuments || {};
      const collectedDocTypes = Object.keys(collectedDocs);
      const normCollectedUp = collectedDocTypes.map((k: string) => k.toLowerCase().replace(/_card$/, ''));
      const hasDocUp = (dt: string) => normCollectedUp.includes(dt.toLowerCase().replace(/_card$/, ''));
      const missingDocs = documentTypes.filter((d: any) => !hasDocUp(d.docType));
      const missingMandatory = missingDocs.filter((d: any) => d.isMandatory);

      const aiResult = await this.detectUploadStepIntent(
        businessAccountId,
        message,
        documentTypes,
        collectedDocTypes
      );

      console.log(`[WhatsApp Flow] AI detected intent: "${aiResult.intent}" for upload step`);

      if (aiResult.intent === "skip") {
        if (missingDocs.length === 0) {
          const nextStepKey = currentStep.defaultNextStep || this.getNextStepKey(currentStep.stepKey, steps);
          if (nextStepKey) {
            await this.advanceSession(session.id, nextStepKey, collectedData);
            const nextStep = steps.find((s) => s.stepKey === nextStepKey);
            if (nextStep) {
              return {
                handled: true,
                response: this.buildStepResponse(nextStep, collectedData),
                collectedData,
                sessionId: session.id,
              };
            }
          }
          return {
            handled: true,
            response: { type: "text", text: aiResult.response },
            flowCompleted: true,
            collectedData,
            sessionId: session.id,
          };
        }

        if (missingMandatory.length > 0) {
          await this.advanceSession(session.id, session.currentStepKey, collectedData);
          return {
            handled: true,
            response: { type: "text", text: aiResult.response },
            sessionId: session.id,
          };
        }

        const nextStepKey = currentStep.defaultNextStep || this.getNextStepKey(currentStep.stepKey, steps);
        if (nextStepKey) {
          await this.advanceSession(session.id, nextStepKey, collectedData);
          const nextStep = steps.find((s) => s.stepKey === nextStepKey);
          if (nextStep) {
            const nextResponse = this.buildStepResponse(nextStep, collectedData);
            if (nextResponse) {
              nextResponse.text = `${aiResult.response}\n\n${nextResponse.text}`;
            }
            return {
              handled: true,
              response: nextResponse || { type: "text", text: aiResult.response },
              collectedData,
              sessionId: session.id,
            };
          }
        }
        return {
          handled: true,
          response: { type: "text", text: aiResult.response },
          flowCompleted: true,
          collectedData,
          sessionId: session.id,
        };
      }

      if (aiResult.intent === "compliance") {
        return {
          handled: true,
          response: { type: "text", text: aiResult.response },
          sessionId: session.id,
        };
      }

      if (aiResult.intent === "question") {
        await this.advanceSession(session.id, session.currentStepKey, collectedData);
        if (missingDocs.length > 0) {
          const docLines = missingDocs.map((d: any, index: number) => {
            const letter = String.fromCharCode(97 + index);
            const marker = d.isMandatory ? '' : ' (optional)';
            return `${letter}. ${d.label}${marker}`;
          });
          return {
            handled: true,
            response: { type: "text", text: `${aiResult.response}\n\nPlease upload the remaining documents:\n${docLines.join('\n')}` },
            sessionId: session.id,
          };
        }
        return {
          handled: true,
          response: { type: "text", text: aiResult.response },
          sessionId: session.id,
        };
      }

      await this.advanceSession(session.id, session.currentStepKey, collectedData);
      if (missingDocs.length > 0 && missingDocs.length < documentTypes.length) {
        const docLines = missingDocs.map((d: any, index: number) => {
          const letter = String.fromCharCode(97 + index);
          const marker = d.isMandatory ? '' : ' (optional)';
          return `${letter}. ${d.label}${marker}`;
        });
        return {
          handled: true,
          response: { type: "text", text: `${aiResult.response}\n\nPlease upload the remaining documents:\n${docLines.join('\n')}` },
          sessionId: session.id,
        };
      }
      return {
        handled: true,
        response: this.buildStepResponse(currentStep, collectedData),
        sessionId: session.id,
      };
    } else if (currentStep.type === "input" || currentStep.type === "text") {
      const requiredFields = options?.requiredFields;
      const inputValidation = options?.inputValidation || null;

      if (!requiredFields || requiredFields.length === 0) {
        if (inputValidation) {
          const staticCheck = this.staticValidateInput(message, inputValidation);
          if (!staticCheck.valid) {
            console.log(`[WhatsApp Flow] Static validation failed for "${inputValidation}": "${message}"`);
            return this.handleOffTopicMessage(
              businessAccountId,
              session,
              currentStep,
              message,
              collectedData,
              `a valid ${inputValidation} (e.g., ${this.getFormatExample(inputValidation)})`,
              staticCheck.message,
              flowContext
            );
          }
        }

        const intentResult = await this.detectTextStepIntent(
          businessAccountId,
          message,
          currentStep.prompt,
          currentStep.saveToField,
          inputValidation,
          flowContext
        );

        if (intentResult.intent === "question" || intentResult.intent === "invalid") {
          const repromptCount = this.incrementOffTopicCount(collectedData, currentStep.stepKey);
          if (repromptCount >= this.MAX_OFF_TOPIC_ATTEMPTS) {
            console.log(`[WhatsApp Flow] Max re-prompt attempts (${this.MAX_OFF_TOPIC_ATTEMPTS}) reached for text step "${currentStep.stepKey}" — auto-exiting flow`);
            await this.advanceSession(session.id, session.currentStepKey, collectedData);
            await this.expireSession(session.id);
            return {
              handled: true,
              response: {
                type: "text",
                text: "It seems like you'd like to chat instead. I've paused the form — feel free to ask me anything! You can restart the form anytime.",
              },
              shouldFallbackToAI: true,
            };
          }
          console.log(`[WhatsApp Flow] Text step intent: ${intentResult.intent} — re-prompting step "${currentStep.stepKey}" (attempt ${repromptCount}/${this.MAX_OFF_TOPIC_ATTEMPTS})`);
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
          let valueToSave = intentResult.cleanValue || message;
          if (!intentResult.cleanValue && inputValidation) {
            const fallbackExtracted = this.fallbackExtractValue(message, inputValidation);
            if (fallbackExtracted) valueToSave = fallbackExtracted;
          }
          collectedData[currentStep.saveToField] = valueToSave;
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
        
        if (collectedData.customer_phone && !collectedData._phoneValidated) {
          const rawPhone = String(collectedData.customer_phone).replace(/[\s\-\(\)\+]/g, '');
          const digitsOnly = rawPhone.replace(/\D/g, '');

          const [phoneLenRow] = await db
            .select({ phoneNumberLength: whatsappSettings.phoneNumberLength })
            .from(whatsappSettings)
            .where(eq(whatsappSettings.businessAccountId, businessAccountId))
            .limit(1);
          const expectedLen = phoneLenRow?.phoneNumberLength ?? 10;

          let cleanPhone = digitsOnly;
          if (expectedLen === 10 && digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
            cleanPhone = digitsOnly.slice(2);
          } else if (expectedLen === 10 && digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
            cleanPhone = digitsOnly.slice(1);
          }

          if (cleanPhone.length !== expectedLen) {
            delete collectedData.customer_phone;
            return this.handleOffTopicMessage(
              businessAccountId,
              session,
              currentStep,
              message,
              collectedData,
              `a valid ${expectedLen}-digit mobile number`,
              `Please enter a valid ${expectedLen}-digit mobile number.`,
              flowContext
            );
          }

          collectedData.customer_phone = cleanPhone;
          collectedData._phoneValidated = true;
        }

        if (collectedData.customer_phone && !collectedData._phoneChecked) {
          collectedData._phoneChecked = true;
          const dupResult = await this.checkDuplicatePhone(
            businessAccountId,
            collectedData.customer_phone,
            session.id
          );
          if (dupResult.isDuplicate && dupResult.existingLeadId) {
            console.log(`[WhatsApp Flow] Duplicate phone detected: ${collectedData.customer_phone} — lead ${dupResult.existingLeadId} exists (${dupResult.hoursAgo}h ago).`);

            const [dupSettings] = await db
              .select({ updateLeadEnabled: whatsappSettings.updateLeadEnabled, newApplicationCooldownDays: whatsappSettings.newApplicationCooldownDays })
              .from(whatsappSettings)
              .where(eq(whatsappSettings.businessAccountId, businessAccountId))
              .limit(1);
            const isUpdateEnabled = dupSettings?.updateLeadEnabled !== "false";

            const [existingLead] = await db
              .select()
              .from(whatsappLeads)
              .where(eq(whatsappLeads.id, dupResult.existingLeadId))
              .limit(1);

            if (existingLead) {
              const existingExtracted = (existingLead.extractedData as Record<string, any>) || {};
              const existingDocs = existingExtracted._documents || existingExtracted._collectedDocuments || {};

              if (!isUpdateEnabled) {
                const cooldownDays = dupSettings?.newApplicationCooldownDays ?? 7;
                if (cooldownDays > 0) {
                  const daysSinceCreation = (Date.now() - new Date(existingLead.createdAt).getTime()) / (1000 * 60 * 60 * 24);
                  if (daysSinceCreation < cooldownDays) {
                    const daysRemaining = Math.ceil(cooldownDays - daysSinceCreation);
                    return {
                      handled: true,
                      response: {
                        type: "text",
                        text: `An application with this mobile number already exists. You cannot start a new application yet. Please wait ${daysRemaining} more day${daysRemaining !== 1 ? 's' : ''}.`,
                      },
                      sessionId: session.id,
                    };
                  }
                }
              } else {
                await this.completeSession(session.id, collectedData);

                const updateSession = await this.startUpdateSession(
                  businessAccountId,
                  activeFlow.id,
                  senderPhone,
                  this.UPDATE_MENU_STEP,
                  existingLead.id,
                  { _collectedDocuments: existingDocs },
                  flowTimeout
                );

                const docLabels = Object.keys(existingDocs).map(key => {
                  const doc = existingDocs[key];
                  return doc?.label || key.replace(/_/g, " ");
                });
                const docsOnFile = docLabels.length > 0 ? `\nDocuments on file: ${docLabels.join(", ")}` : "";

                return {
                  handled: true,
                  response: {
                    type: "buttons",
                    text: `An application with this mobile number already exists.${docsOnFile}\n\nWhat would you like to do?`,
                    buttons: [
                      { id: "add_docs", title: "Update Documents" },
                      { id: "update_details", title: "Update Details" },
                      { id: "start_new", title: "Start New" },
                    ],
                  },
                  sessionId: updateSession.id,
                };
              }
            }
          }
        }

        if (missing.length > 0) {
          console.log(`[WhatsApp Flow] Missing fields: ${missing.join(", ")}`);
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
        
        // All required fields collected - proceed to next step
        console.log(`[WhatsApp Flow] All required fields collected: ${JSON.stringify(extracted)}`);
      }
      
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

    if (nextStepKey === "end_with_ai") {
      console.log(`[WhatsApp Flow] End with AI fallback — completing session and handing off to AI`);
      await this.completeSession(session.id, collectedData);
      return { handled: false, shouldFallbackToAI: true };
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

    let nextStep = await this.getStepByKey(activeFlow.id, nextStepKey);
    if (!nextStep) {
      console.log(`[WhatsApp Flow] Next step not found: ${nextStepKey}`);
      await this.completeSession(session.id, collectedData);
      return {
        handled: true,
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
      };
    }

    // Auto-advance past steps whose fields are all already filled (e.g. from document extraction)
    const stepShouldSkip = (s: any): boolean => {
      if (s.saveToField && this.hasFieldValue(collectedData, s.saveToField)) return true;
      const o = s.options as any;
      if (Array.isArray(o?.requiredFields) && o.requiredFields.length > 0 &&
        o.requiredFields.every((f: string) => this.hasFieldValue(collectedData, f))) return true;
      if (Array.isArray(o?.selectedFields) && o.selectedFields.length > 0 &&
        o.selectedFields.filter((f: any) => f.isRequired !== false).every((f: any) => this.hasFieldValue(collectedData, f.fieldKey))) return true;
      if (s.type === "upload" && this.isAdaptiveJourneyEnabled(activeFlow, businessAccountId)) {
        const mandatoryDocs = (o?.documentTypes || []).filter((doc: any) => doc.isMandatory).map((doc: any) => doc.docType);
        if (mandatoryDocs.length === 0) return false;
        const docState = this.getDocumentState(collectedData);
        const collectedDocs = collectedData._collectedDocuments || {};
        return mandatoryDocs.every((docType: string) => {
          const normalized = docType.toLowerCase().replace(/_card$/, "");
          return docState[normalized]?.status === "complete" ||
            (collectedDocs[docType]?.isValid !== false && collectedDocs[docType]);
        });
      }
      return false;
    };
    let autoSkipCount = 0;
    while (nextStep && nextStep.type !== 'end' && stepShouldSkip(nextStep) && autoSkipCount++ < 10) {
      console.log(`[WhatsApp Flow] Auto-advancing past filled step "${nextStep.stepKey}" (all required fields already filled)`);
      const skipToKey = this.getNextStepKey(nextStep.stepKey, steps);
      if (!skipToKey || skipToKey === nextStepKey) break;
      nextStepKey = skipToKey;
      nextStep = await this.getStepByKey(activeFlow.id, nextStepKey);
    }

    if (!nextStep) {
      console.log(`[WhatsApp Flow] Next step not found after auto-skip: ${nextStepKey}`);
      await this.completeSession(session.id, collectedData);
      return {
        handled: true,
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
      };
    }

    const textOnlyPreMessages: Array<{ type: "text"; text: string }> = [];
    let chainCount = 0;
    let textChainTerminated = false;
    while (nextStep && this.isTextOnlyMessageStep(nextStep) && chainCount++ < 10) {
      console.log(`[WhatsApp Flow] Auto-advancing past text-only step "${nextStep.stepKey}"`);
      const textMsg = this.buildStepResponse(nextStep, collectedData);
      if (textMsg?.text) {
        textOnlyPreMessages.push({ type: "text", text: textMsg.text });
      }
      const chainNextKey = this.resolveNextStepKeyForChain(nextStep, steps);
      if (!chainNextKey || chainNextKey === nextStepKey) {
        textChainTerminated = true;
        break;
      }
      nextStepKey = chainNextKey;
      nextStep = await this.getStepByKey(activeFlow.id, nextStepKey);
    }

    if (textChainTerminated || !nextStep) {
      const completionMsg = activeFlow.completionMessage || "Thank you! Your information has been recorded.";
      await this.completeSession(session.id, collectedData);
      console.log(`[WhatsApp Flow] [Timing] processMessage total: ${Date.now() - startTime}ms`);
      return {
        handled: true,
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
        preMessages: textOnlyPreMessages.length > 0 ? textOnlyPreMessages : undefined,
        response: { type: "text", text: completionMsg },
      };
    }

    await this.advanceSession(session.id, nextStepKey, collectedData);

    if (nextStep.type === "end") {
      await this.completeSession(session.id, collectedData);
      console.log(`[WhatsApp Flow] [Timing] processMessage total: ${Date.now() - startTime}ms`);
      return {
        handled: true,
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
        preMessages: textOnlyPreMessages.length > 0 ? textOnlyPreMessages : undefined,
        response: {
          type: "text",
          text: nextStep.prompt,
        },
      };
    }

    console.log(`[WhatsApp Flow] [Timing] processMessage total: ${Date.now() - startTime}ms`);
    return {
      handled: true,
      preMessages: textOnlyPreMessages.length > 0 ? textOnlyPreMessages : undefined,
      response: this.buildStepResponse(nextStep, collectedData),
      collectedData: Object.keys(collectedData).length > 0 ? collectedData : undefined,
      sessionId: session.id,
    };
  }

  private async buildExtractedFieldsSummary(
    docType: string,
    extractedData: Record<string, any>,
    businessAccountId: string
  ): Promise<string | null> {
    const t = docType.toLowerCase().replace(/_card$/, '').replace('_', '');
    const lines: string[] = [];

    try {
      const { documentTypeService: docTypeSvc } = await import("./documentTypeService");
      const config =
        await docTypeSvc.getDocumentTypeByKey(businessAccountId, docType) ||
        await docTypeSvc.getDocumentTypeByKey(businessAccountId, t);

      if (config) {
        for (const field of config.extractionFields) {
          const val = extractedData[field.key];
          if (val === null || val === undefined || val === '') continue;
          const keyLower = field.key.toLowerCase();
          const isAadhaarByKey = keyLower.includes('aadhaar') || keyLower === 'documentnumber';
          const isAadhaarByRegex = !!field.formatRegex && (field.formatRegex.includes('\\d{12}') || /\{12\}/.test(field.formatRegex));
          if (isAadhaarByKey || isAadhaarByRegex) {
            // No PII masking — testing phase: show full Aadhaar/PAN number to user
            const num = String(val).replace(/\s/g, '');
            lines.push(`• ${field.label}: ${num}`);
          } else {
            lines.push(`• ${field.label}: ${val}`);
          }
        }
        return lines.length > 0 ? `Details extracted:\n${lines.join('\n')}` : null;
      }
    } catch (err) {
      console.warn(`[WhatsApp Flow] buildExtractedFieldsSummary: could not load config for ${docType}, falling back to legacy display`, err);
    }

    const isPan = t === 'pan';
    const isAadhaar = t === 'aadhaar';

    if (isPan) {
      if (extractedData.name) lines.push(`• Name: ${extractedData.name}`);
      if (extractedData.documentNumber) lines.push(`• PAN: ${extractedData.documentNumber}`);
      if (extractedData.dateOfBirth) lines.push(`• Date of Birth: ${extractedData.dateOfBirth}`);
    }
    if (isAadhaar) {
      if (extractedData.documentNumber) {
        // No PII masking — testing phase: show full Aadhaar number to user
        const num = String(extractedData.documentNumber).replace(/\s/g, '');
        lines.push(`• Aadhaar: ${num}`);
      }
      if (extractedData.address) lines.push(`• Address: ${extractedData.address}`);
    }

    return lines.length > 0 ? `Details extracted:\n${lines.join('\n')}` : null;
  }

  private async enrichCompletedDocumentFromExtraPage(
    session: { id: string },
    normalizedDocType: string,
    result: any,
    collectedData: Record<string, any>,
    businessAccountId: string | undefined,
    sourceMediaUrl?: string
  ): Promise<void> {
    const docTypeState = this.getDocTypeState(collectedData, normalizedDocType);
    const collectedDocs = collectedData._collectedDocuments || {};
    const docEntry = collectedDocs[normalizedDocType];

    const extractedData = result.extractedData || {};
    const side = result.side || 'unknown';
    const isFront = side === 'front';

    // Fields authoritative from the first upload — never overwrite
    const NEVER_OVERWRITE = new Set(['aadhaar_number', 'pan_number', 'address', 'documentNumber', 'account_number']);
    // Fields where front side is authoritative (overwrite back-side value if front arrives)
    const FRONT_AUTHORITATIVE = new Set(['full_name', 'name']);

    const existingMerged = { ...docTypeState.mergedData };

    for (const [key, value] of Object.entries(extractedData)) {
      if (value === null || value === undefined || String(value).trim() === '') continue;
      if (NEVER_OVERWRITE.has(key)) continue;
      if (FRONT_AUTHORITATIVE.has(key)) {
        if (isFront) {
          existingMerged[key] = value;
          console.log(`[WhatsApp Flow] Enrichment: overwriting ${key} with authoritative front-side value`);
        } else if (!existingMerged[key]) {
          existingMerged[key] = value;
        }
        continue;
      }
      if (!existingMerged[key]) {
        existingMerged[key] = value;
        console.log(`[WhatsApp Flow] Enrichment: filled optional field ${key} from extra page`);
      }
    }

    docTypeState.mergedData = existingMerged;
    docTypeState.pages.push({
      side,
      extractedData,
      confidence: result.confidence || 0,
      sourceMediaUrl,
    });

    if (docEntry) {
      docEntry.extractedData = { ...existingMerged };
      if (!docEntry.additionalPhotos) docEntry.additionalPhotos = [];
      docEntry.additionalPhotos.push({
        side,
        extractedData,
        confidence: result.confidence || 0,
        sourceMediaUrl,
      });
    }
    collectedData._collectedDocuments = collectedDocs;

    // Re-apply lead field mappings from updated mergedData
    if (businessAccountId) {
      try {
        const { documentTypeService: docTypeSvc } = await import('./documentTypeService');
        const config = await docTypeSvc.getDocumentTypeByKey(businessAccountId, normalizedDocType);
        if (config?.leadFieldMappings) {
          for (const mapping of config.leadFieldMappings) {
            const newVal = existingMerged[mapping.extractionFieldKey];
            if (!newVal) continue;
            const strVal = String(newVal).trim();
            if (FRONT_AUTHORITATIVE.has(mapping.extractionFieldKey) && isFront) {
              collectedData[mapping.leadFieldKey] = strVal;
              console.log(`[WhatsApp Flow] Enrichment: force-updated lead field "${mapping.leadFieldKey}" from front-side ${mapping.extractionFieldKey}`);
            } else if (!collectedData[mapping.leadFieldKey]) {
              collectedData[mapping.leadFieldKey] = strVal;
              console.log(`[WhatsApp Flow] Enrichment: auto-filled lead field "${mapping.leadFieldKey}"`);
            }
          }
        }
      } catch (err) {
        console.warn('[WhatsApp Flow] Enrichment: failed to re-apply lead field mappings', err);
      }
    }

    await this.updateSessionData(session.id, collectedData);
    console.log(`[WhatsApp Flow] Enrichment complete for ${normalizedDocType} (side: ${side}, total pages: ${docTypeState.pages.length})`);
  }

  private async autoFillDocumentFields(
    docType: string,
    extractedData: Record<string, any>,
    collectedData: Record<string, any>,
    businessAccountId?: string
  ): Promise<void> {
    const setIfMissing = (leadKey: string, value: any) => {
      if (value && String(value).trim() && !collectedData[leadKey]) {
        collectedData[leadKey] = String(value).trim();
        console.log(`[WhatsApp Flow] Auto-filled "${leadKey}" from ${docType} document`);
      }
    };

    if (businessAccountId) {
      try {
        const { documentTypeService: docTypeSvc } = await import("./documentTypeService");
        const normalizedKey = docType.toLowerCase().replace(/_card$/, '').replace(/_/g, '');
        const config =
          await docTypeSvc.getDocumentTypeByKey(businessAccountId, docType) ||
          await docTypeSvc.getDocumentTypeByKey(businessAccountId, normalizedKey);

        if (config && config.leadFieldMappings && config.leadFieldMappings.length > 0) {
          for (const mapping of config.leadFieldMappings) {
            setIfMissing(mapping.leadFieldKey, extractedData[mapping.extractionFieldKey]);
          }
          return;
        }
      } catch (err) {
        console.warn(`[WhatsApp Flow] Failed to load lead field mappings for ${docType}, skipping auto-fill`, err);
      }
    }
  }

  private normalizeForComparison(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private namesMatch(a: string, b: string): boolean {
    const normA = this.normalizeForComparison(a);
    const normB = this.normalizeForComparison(b);
    if (normA === normB) return true;
    const wordsA = normA.split(' ').filter(w => w.length > 1);
    const wordsB = normB.split(' ').filter(w => w.length > 1);
    if (wordsA.length === 0 || wordsB.length === 0) return false;
    if (wordsA.length === 1) return wordsB.includes(wordsA[0]);
    if (wordsB.length === 1) return wordsA.includes(wordsB[0]);
    const overlap = wordsA.filter(w => wordsB.includes(w)).length;
    return overlap >= Math.ceil(Math.min(wordsA.length, wordsB.length) * 0.6);
  }

  private valuesMatchForLeadField(extractionFieldKey: string, extracted: string, existing: string): boolean {
    const key = extractionFieldKey.toLowerCase();
    const isNameField = key.includes('name');
    if (isNameField) return this.namesMatch(extracted, existing);
    const norm = (s: string) => s.toUpperCase().replace(/[\s\-\.\/]+/g, '');
    return norm(extracted) === norm(existing);
  }

  // Removed: built-in `checkFieldMismatches` name/field guard.
  // Cross-document field-mismatch detection is now driven exclusively by the
  // configured verification rule engine (`runInstantVerification` →
  // `runIncrementalVerification`). Admins control the customer-facing wording
  // via each rule's `messageTemplate`.

  private getDocumentState(collectedData: Record<string, any>): DocumentState {
    if (!collectedData._documentState) {
      collectedData._documentState = {};
    }
    return collectedData._documentState as DocumentState;
  }

  private getDocTypeState(collectedData: Record<string, any>, docType: string): DocTypeState {
    const state = this.getDocumentState(collectedData);
    const normalizedType = docType.toLowerCase().replace(/_card$/, '');
    if (!state[normalizedType]) {
      state[normalizedType] = {
        status: 'pending',
        pages: [],
        mergedData: {},
      };
    }
    return state[normalizedType];
  }

  /**
   * If a document is mid-collection (status='processing' with at least one page) and we can tell
   * the customer which specific side is still missing, return a user-facing prompt; otherwise null.
   * Today this covers Aadhaar (front captures number/name, back captures address). Centralised so
   * both the single-upload immediate-response path and the debounced batch path share one rule.
   */
  private buildPartialDocSidePrompt(
    normalizedDocType: string,
    dState: { status?: string; pages?: any[]; mergedData?: Record<string, any> } | undefined,
    label: string
  ): string | null {
    if (!dState || dState.status !== 'processing') return null;
    if (!dState.pages || dState.pages.length < 1) return null;
    const merged = dState.mergedData || {};
    if (normalizedDocType === 'aadhaar') {
      if (merged.aadhaar_number && !merged.address) {
        return `Please upload the *back* of your ${label} to capture the address.`;
      }
      if (!merged.aadhaar_number && merged.address) {
        return `Please upload the *front* of your ${label} so we can capture your name and Aadhaar number.`;
      }
    }
    return null;
  }

  private isDocTypeTerminal(collectedData: Record<string, any>, docType: string): boolean {
    const state = this.getDocumentState(collectedData);
    const normalizedType = docType.toLowerCase().replace(/_card$/, '');
    const docState = state[normalizedType];
    if (!docState) return false;
    return docState.status === 'complete' || docState.status === 'duplicate';
  }

  private async isDocTypeComplete(mergedData: Record<string, any>, docType: string, businessAccountId: string, pagesCount?: number): Promise<boolean> {
    const raw = String(docType || '');
    const t = raw.toLowerCase().replace(/_card$/, '');
    const tWithCard = t ? `${t}_card` : '';
    try {
      const { documentTypeService: docTypeSvc } = await import("./documentTypeService");
      // Robust key resolution: try several common variants so a casing/suffix
      // mismatch never silently falls through to the legacy hardcoded check.
      const candidates = Array.from(new Set([raw, t, tWithCard, raw.toLowerCase()].filter(Boolean)));
      let config: Awaited<ReturnType<typeof docTypeSvc.getDocumentTypeByKey>> | undefined;
      for (const k of candidates) {
        config = await docTypeSvc.getDocumentTypeByKey(businessAccountId, k);
        if (config) break;
      }
      if (config) {
        // PR1: required field must BOTH be present AND match formatRegex.
        // Strict-boolean coercion on `required` so a stringified "false"/"0"
        // from older payloads doesn't get truthy-coerced into "required".
        const isStrictRequired = (v: unknown): boolean => {
          if (v === true) return true;
          if (typeof v === 'string') {
            const s = v.trim().toLowerCase();
            return s === 'true' || s === '1' || s === 'yes';
          }
          if (typeof v === 'number') return v === 1;
          return false;
        };
        const requiredFields = (config.extractionFields || []).filter((f: { required?: unknown }) => isStrictRequired(f.required));
        const failures: string[] = [];
        const allValid = requiredFields.every((f: { key: string; label?: string; formatRegex?: string | null }) => {
          const val = mergedData[f.key];
          if (val === null || val === undefined || val === '') {
            failures.push(`${f.label || f.key}: missing`);
            return false;
          }
          if (f.formatRegex) {
            try {
              const cleanValue = String(val).replace(/[\s-]/g, '').toUpperCase();
              const regex = new RegExp(f.formatRegex);
              if (!regex.test(cleanValue)) {
                failures.push(`${f.label || f.key}: format-invalid ("${val}")`);
                return false;
              }
            } catch (_) {}
          }
          return true;
        });
        console.log(`[WhatsApp Flow] isDocTypeComplete (${docType}) [config:${config.key}]: ${requiredFields.length} required field(s) → ${allValid}${allValid ? '' : ` — failures: ${failures.join('; ')}`}`);
        return allValid;
      }
      console.warn(`[WhatsApp Flow] isDocTypeComplete: no doc type config matched any of [${candidates.join(', ')}] — falling back to legacy heuristic`);
    } catch (err) {
      console.warn(`[WhatsApp Flow] isDocTypeComplete: could not load doc type config for ${docType}, falling back to legacy check`);
    }
    if (t === 'aadhaar') {
      return !!(mergedData.documentNumber && mergedData.name);
    }
    if (t === 'pan') {
      return !!mergedData.documentNumber;
    }
    return !!mergedData.documentNumber;
  }

  private syncDocStateToCollectedDocs(
    collectedData: Record<string, any>,
    docType: string,
    sourceMediaUrl?: string
  ): void {
    const normalizedType = docType.toLowerCase().replace(/_card$/, '');
    const docState = this.getDocTypeState(collectedData, normalizedType);
    if (docState.status !== 'complete') return;

    const collectedDocs = collectedData._collectedDocuments || {};
    const pages = docState.pages;
    if (pages.length === 0) return;

    const primary = pages[0];
    const docEntry: Record<string, any> = {
      documentType: normalizedType,
      confidence: primary.confidence,
      extractedData: { ...docState.mergedData },
      isValid: true,
      uploadedAt: new Date().toISOString(),
      side: primary.side || 'front',
    };
    if (primary.sourceMediaUrl || sourceMediaUrl) {
      docEntry.sourceMediaUrl = primary.sourceMediaUrl || sourceMediaUrl;
    }

    if (pages.length > 1) {
      docEntry.additionalPhotos = pages.slice(1).map(p => ({
        side: p.side || 'front',
        extractedData: p.extractedData,
        confidence: p.confidence,
        sourceMediaUrl: p.sourceMediaUrl || sourceMediaUrl,
      }));
    }

    collectedDocs[normalizedType] = docEntry;
    collectedData._collectedDocuments = collectedDocs;
  }

  private resolveStepOptions(step: WhatsappFlowStep, collectedData: Record<string, any>): WhatsappFlowStep {
    const options = step.options as FlowStepOptions | null;
    if (!options?.conditionalOptions) return step;

    const fields = options.dependsOnFields || (options.dependsOnField ? [options.dependsOnField] : []);
    if (fields.length === 0) return step;

    const keyParts = fields.map(f => String(collectedData[f] ?? '').trim());
    const lookupKey = keyParts.join('|');
    const keyMissing = keyParts.some(p => p === '');

    let resolvedItems: { id: string; title: string; value: string; followUpPrompt?: string }[];
    if (keyMissing) {
      resolvedItems = options.fallbackOptions || options.dropdownItems || [];
      console.log(`[WhatsApp Flow] Conditional options: parent field(s) [${fields.join(', ')}] not yet collected — using fallback (${resolvedItems.length} items)`);
    } else {
      const matchedKey = Object.keys(options.conditionalOptions).find(
        k => k.trim().toLowerCase() === lookupKey.toLowerCase()
      );
      resolvedItems = matchedKey
        ? options.conditionalOptions[matchedKey]
        : (options.fallbackOptions || options.dropdownItems || []);
      console.log(`[WhatsApp Flow] Conditional options resolved for key "${lookupKey}": ${resolvedItems.length} items`);
    }

    return { ...step, options: { ...options, dropdownItems: resolvedItems } };
  }

  private static readonly PAGE_NEXT_ID = "__page_next__";
  private static readonly PAGE_PREV_ID = "__page_prev__";
  private static readonly DROPDOWN_PAGE_KEY = "_dropdownPage";

  private buildStepResponse(step: WhatsappFlowStep, collectedData?: Record<string, any>): ProcessResult["response"] {
    const resolvedStep = collectedData !== undefined ? this.resolveStepOptions(step, collectedData) : step;
    const options = resolvedStep.options as FlowStepOptions | null;

    switch (resolvedStep.type) {
      case "buttons":
        return {
          type: "buttons",
          text: resolvedStep.prompt,
          buttons: options?.buttons || [],
        };

      case "dropdown": {
        const allItems = options?.dropdownItems || [];
        if (allItems.length <= 10) {
          return {
            type: "list",
            text: resolvedStep.prompt,
            sections: [{ title: "Options", rows: allItems.map(i => ({ id: i.id, title: i.title })) }],
            buttonText: "Select Option",
          };
        }

        const totalItems = allItems.length;
        const totalPages = totalItems <= 18 ? 2 : 2 + Math.ceil((totalItems - 18) / 8);
        const rawPage = collectedData?.[WhatsappFlowService.DROPDOWN_PAGE_KEY] || 1;
        const page = Math.max(1, Math.min(totalPages, rawPage));
        if (collectedData && !(WhatsappFlowService.DROPDOWN_PAGE_KEY in collectedData)) {
          collectedData[WhatsappFlowService.DROPDOWN_PAGE_KEY] = 1;
        }
        const isFirstPage = page === 1;
        const startIndex = isFirstPage ? 0 : 9 + (page - 2) * 8;
        const remaining = totalItems - startIndex;
        const itemsPerPage = isFirstPage ? 9 : (remaining <= 9 ? remaining : 8);
        const pageItems = allItems.slice(startIndex, startIndex + itemsPerPage);
        const hasMore = startIndex + pageItems.length < totalItems;

        const rows: { id: string; title: string }[] = [];
        if (!isFirstPage) {
          rows.push({ id: WhatsappFlowService.PAGE_PREV_ID, title: "← Back" });
        }
        rows.push(...pageItems.map(i => ({ id: i.id, title: i.title })));
        if (hasMore) {
          rows.push({ id: WhatsappFlowService.PAGE_NEXT_ID, title: "More options →" });
        }

        const promptText = totalItems > 10
          ? `${resolvedStep.prompt}\n\n(Page ${page} of ${totalPages})`
          : resolvedStep.prompt;

        return {
          type: "list",
          text: promptText,
          sections: [{ title: "Options", rows }],
          buttonText: "Select Option",
        };
      }

      case "list":
        return {
          type: "list",
          text: resolvedStep.prompt,
          sections: options?.sections || [],
          buttonText: options?.buttonText || "Select",
        };

      case "upload":
        let uploadMessage = resolvedStep.prompt;
        
        // Append document types to the message if any are configured
        if (options?.documentTypes && options.documentTypes.length > 0) {
          const docLines = options.documentTypes.map((d, index) => {
            const letter = String.fromCharCode(97 + index); // a, b, c, etc.
            const marker = d.isMandatory ? '' : ' (optional)';
            return `${letter}. ${d.label}${marker}`;
          });
          
          uploadMessage = `${uploadMessage}\n\nPlease upload:\n${docLines.join('\n')}`;
        }
        
        return {
          type: "text",
          text: uploadMessage,
        };

      case "text":
      case "input":
      case "end":
      default:
        let messageText = resolvedStep.prompt;
        
        if (options?.selectedFields && options.selectedFields.length > 0) {
          const visibleFields = collectedData !== undefined
            ? options.selectedFields.filter((f: any) => !this.hasFieldValue(collectedData, f.fieldKey))
            : options.selectedFields;
          if (visibleFields.length > 0) {
            const fieldLines = visibleFields.map((f: any, index: number) => {
              const letter = String.fromCharCode(97 + index);
              const label = f.fieldLabel || f.fieldKey;
              const marker = f.isRequired ? '' : ' (optional)';
              return `${letter}. ${label}${marker}`;
            });
            messageText = `${messageText}\n\n${fieldLines.join('\n')}`;
          }
        }
        
        return {
          type: "text",
          text: messageText,
        };
    }
  }

  async getAllFlows(businessAccountId: string): Promise<WhatsappFlow[]> {
    return await db
      .select()
      .from(whatsappFlows)
      .where(eq(whatsappFlows.businessAccountId, businessAccountId))
      .orderBy(desc(whatsappFlows.createdAt));
  }

  async createFlow(
    businessAccountId: string,
    name: string,
    description?: string,
    completionMessage?: string
  ): Promise<WhatsappFlow> {
    const [flow] = await db
      .insert(whatsappFlows)
      .values({
        businessAccountId,
        name,
        description,
        isActive: "false",
        fallbackToAI: "true",
        ...(completionMessage ? { completionMessage } : {}),
      })
      .returning();

    console.log(`[WhatsApp Flow] Created flow: ${flow.id}`);
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
      adaptiveMode: string;
      sessionTimeout: number | null;
      completionMessage: string | null;
      repeatMode: string;
    }>
  ): Promise<WhatsappFlow | null> {
    if (updates.isActive === "true") {
      const [flow] = await db.select().from(whatsappFlows).where(eq(whatsappFlows.id, flowId));
      if (flow) {
        await db
          .update(whatsappFlows)
          .set({ isActive: "false" })
          .where(
            and(
              eq(whatsappFlows.businessAccountId, flow.businessAccountId),
              sql`${whatsappFlows.id} != ${flowId}`
            )
          );
      }
    }

    const [updated] = await db
      .update(whatsappFlows)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(whatsappFlows.id, flowId))
      .returning();

    if (updated) this.invalidateFlowCache(updated.businessAccountId);
    return updated || null;
  }

  async deleteFlow(flowId: string): Promise<void> {
    const [flow] = await db.select({ bid: whatsappFlows.businessAccountId }).from(whatsappFlows).where(eq(whatsappFlows.id, flowId)).limit(1);
    await db.delete(whatsappFlows).where(eq(whatsappFlows.id, flowId));
    if (flow) this.invalidateFlowCache(flow.bid);
    console.log(`[WhatsApp Flow] Deleted flow: ${flowId}`);
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
  ): Promise<WhatsappFlowStep> {
    const [step] = await db
      .insert(whatsappFlowSteps)
      .values({
        flowId,
        ...stepData,
      })
      .returning();

    console.log(`[WhatsApp Flow] Created step: ${step.id} (${step.stepKey})`);
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
  ): Promise<WhatsappFlowStep | null> {
    const [updated] = await db
      .update(whatsappFlowSteps)
      .set(updates)
      .where(eq(whatsappFlowSteps.id, stepId))
      .returning();

    if (updated) this.stepsCache.delete(updated.flowId);
    return updated || null;
  }

  async deleteStep(stepId: string): Promise<void> {
    // Get the step first to know its flowId and order
    const [stepToDelete] = await db
      .select()
      .from(whatsappFlowSteps)
      .where(eq(whatsappFlowSteps.id, stepId))
      .limit(1);

    if (!stepToDelete) {
      console.log(`[WhatsApp Flow] Step not found for deletion: ${stepId}`);
      return;
    }

    const flowId = stepToDelete.flowId;
    const deletedOrder = stepToDelete.stepOrder;

    // Get the old stepKey for updating references
    const deletedStepKey = stepToDelete.stepKey;

    // Delete the step
    await db.delete(whatsappFlowSteps).where(eq(whatsappFlowSteps.id, stepId));
    console.log(`[WhatsApp Flow] Deleted step: ${stepId}`);

    // Get remaining steps in order
    const remainingSteps = await db
      .select()
      .from(whatsappFlowSteps)
      .where(eq(whatsappFlowSteps.flowId, flowId))
      .orderBy(whatsappFlowSteps.stepOrder);

    // Build a mapping of old stepKey -> new stepKey
    const keyMapping: Record<string, string> = {};
    for (let i = 0; i < remainingSteps.length; i++) {
      const oldKey = remainingSteps[i].stepKey;
      const newKey = String(i + 1);
      if (oldKey !== newKey) {
        keyMapping[oldKey] = newKey;
      }
    }

    // Update stepOrder and stepKey for all remaining steps
    for (let i = 0; i < remainingSteps.length; i++) {
      const newKey = String(i + 1);
      await db
        .update(whatsappFlowSteps)
        .set({ stepOrder: i, stepKey: newKey })
        .where(eq(whatsappFlowSteps.id, remainingSteps[i].id));
    }

    // Update Go-to references in buttons and dropdown options
    await this.updateGoToReferences(flowId, keyMapping, deletedStepKey);

    this.stepsCache.delete(flowId);
    console.log(`[WhatsApp Flow] Renumbered ${remainingSteps.length} remaining steps with new stepKeys`);
  }

  private async updateGoToReferences(
    flowId: string,
    keyMapping: Record<string, string>,
    deletedStepKey?: string
  ): Promise<void> {
    // Get all steps in this flow to update their Go-to references
    const steps = await db
      .select()
      .from(whatsappFlowSteps)
      .where(eq(whatsappFlowSteps.flowId, flowId))
      .orderBy(whatsappFlowSteps.stepOrder);

    // Helper to get next step key or null if no next step exists
    const getNextStepKey = (currentStepOrder: number): string | null => {
      const nextStep = steps.find(s => s.stepOrder === currentStepOrder + 1);
      return nextStep ? keyMapping[nextStep.stepKey] || nextStep.stepKey : null;
    };

    for (const step of steps) {
      let needsUpdate = false;
      const options = step.options as any || {};
      let updatedOptions = { ...options };
      let updatedDefaultNextStep: string | null = step.defaultNextStep;

      // Update defaultNextStep reference
      if (step.defaultNextStep) {
        if (deletedStepKey && step.defaultNextStep === deletedStepKey) {
          // If pointing to deleted step, use the next sequential step or clear it
          const nextKey = getNextStepKey(step.stepOrder);
          updatedDefaultNextStep = nextKey;
          needsUpdate = true;
        } else if (keyMapping[step.defaultNextStep]) {
          updatedDefaultNextStep = keyMapping[step.defaultNextStep];
          needsUpdate = true;
        }
      }

      // Update button nextStep references (stored in options.buttons)
      if (options.buttons && Array.isArray(options.buttons)) {
        updatedOptions.buttons = options.buttons.map((btn: any) => {
          if (btn.nextStep) {
            // If this points to the deleted step, use next sequential step
            if (deletedStepKey && btn.nextStep === deletedStepKey) {
              needsUpdate = true;
              const nextKey = getNextStepKey(step.stepOrder);
              return { ...btn, nextStep: nextKey || undefined };
            }
            // If this points to a renamed step, update it
            if (keyMapping[btn.nextStep]) {
              needsUpdate = true;
              return { ...btn, nextStep: keyMapping[btn.nextStep] };
            }
          }
          return btn;
        });
      }

      // Update dropdown item nextStep references (stored in options.dropdownItems)
      if (options.dropdownItems && Array.isArray(options.dropdownItems)) {
        updatedOptions.dropdownItems = options.dropdownItems.map((item: any) => {
          if (item.nextStep) {
            // If this points to the deleted step, use next sequential step
            if (deletedStepKey && item.nextStep === deletedStepKey) {
              needsUpdate = true;
              const nextKey = getNextStepKey(step.stepOrder);
              return { ...item, nextStep: nextKey || undefined };
            }
            // If this points to a renamed step, update it
            if (keyMapping[item.nextStep]) {
              needsUpdate = true;
              return { ...item, nextStep: keyMapping[item.nextStep] };
            }
          }
          return item;
        });
      }

      // Also update nextStepMapping if present
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
            // If no next step, just remove this mapping entry
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
            .update(whatsappFlowSteps)
            .set({ nextStepMapping: updatedMapping })
            .where(eq(whatsappFlowSteps.id, step.id));
        }
      }

      if (needsUpdate) {
        await db
          .update(whatsappFlowSteps)
          .set({ 
            options: updatedOptions,
            defaultNextStep: updatedDefaultNextStep 
          })
          .where(eq(whatsappFlowSteps.id, step.id));
        console.log(`[WhatsApp Flow] Updated Go-to references in step ${step.id}`);
      }
    }
  }

  async reorderSteps(flowId: string, stepIds: string[]): Promise<void> {
    // Get existing steps for this flow to validate
    const existingSteps = await db
      .select()
      .from(whatsappFlowSteps)
      .where(eq(whatsappFlowSteps.flowId, flowId));

    const existingIds = new Set(existingSteps.map((s) => s.id));
    const stepMap = new Map(existingSteps.map((s) => [s.id, s]));

    // Validate all provided stepIds belong to this flow
    const validStepIds = stepIds.filter((id) => existingIds.has(id));

    if (validStepIds.length === 0) {
      console.log(`[WhatsApp Flow] No valid step IDs provided for reordering flow ${flowId}`);
      return;
    }

    // Build a mapping of old stepKey -> new stepKey
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

    // Update each step's order and stepKey based on its position in the array
    for (let i = 0; i < validStepIds.length; i++) {
      const newKey = String(i + 1);
      await db
        .update(whatsappFlowSteps)
        .set({ stepOrder: i, stepKey: newKey })
        .where(
          and(
            eq(whatsappFlowSteps.id, validStepIds[i]),
            eq(whatsappFlowSteps.flowId, flowId)
          )
        );
    }

    // Update Go-to references in buttons and dropdown options
    if (Object.keys(keyMapping).length > 0) {
      await this.updateGoToReferences(flowId, keyMapping);
    }

    this.stepsCache.delete(flowId);
    console.log(`[WhatsApp Flow] Reordered ${validStepIds.length} steps for flow ${flowId} with updated stepKeys`);
  }

  private isPdfFile(url: string): boolean {
    const urlLower = url.toLowerCase();
    return urlLower.endsWith('.pdf') || urlLower.includes('.pdf');
  }

  private async downloadFile(url: string): Promise<Buffer | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        console.error(`[WhatsApp Flow] Failed to download file: ${response.status}`);
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error: any) {
      console.error("[WhatsApp Flow] File download error:", error.message);
      return null;
    }
  }

  private clearPdfPendingState(collectedData: Record<string, any>) {
    delete collectedData._pendingPdfUrl;
    delete collectedData._pendingPdfFilename;
    delete collectedData._pdfPasswordAttempts;
    delete collectedData._pendingBankStatement;
  }

  /**
   * Resolve the configured display names ("Bank Statement", "PAN Card", etc.)
   * for a list of doc type keys, so user-facing rejection messages can refer
   * to documents by the admin-configured name instead of generic wording.
   * Falls back to a humanized version of the key when no config is found.
   */
  private async getDocTypeDisplayNames(
    businessAccountId: string,
    docTypeKeys: string[]
  ): Promise<string[]> {
    if (!docTypeKeys || docTypeKeys.length === 0) return [];
    try {
      const { documentTypeService: docTypeSvc } = await import("./documentTypeService");
      const seen = new Set<string>();
      const names: string[] = [];
      for (const key of docTypeKeys) {
        const norm = String(key || '').toLowerCase().replace(/_card$/, '');
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        const cfg =
          (await docTypeSvc.getDocumentTypeByKey(businessAccountId, key)) ||
          (await docTypeSvc.getDocumentTypeByKey(businessAccountId, norm));
        if (cfg?.name) {
          names.push(cfg.name);
        } else {
          names.push(
            norm.split(/[_\s-]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
          );
        }
      }
      return names;
    } catch {
      return docTypeKeys.map(k => String(k || ''));
    }
  }

  private formatDocNameList(names: string[]): string {
    if (names.length === 0) return 'document';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} or ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}`;
  }

  private async skipPdfPassword(
    session: any,
    activeFlowId: string,
    collectedData: Record<string, any>
  ): Promise<ProcessResult> {
    this.clearPdfPendingState(collectedData);
    if (session.businessAccountId && session.senderPhone) {
      this.pendingPdfPasswordKeys.delete(`${session.businessAccountId}:${session.senderPhone}`);
    }
    await this.updateSessionData(session.id, collectedData);

    const steps = await this.getFlowSteps(activeFlowId);
    const currentStep = steps.find((s) => s.stepKey === session.currentStepKey);
    if (!currentStep) {
      return {
        handled: true,
        response: { type: "text", text: "Skipped. Please upload a photo of the document instead." },
        sessionId: session.id,
      };
    }

    const skipMsg = "No problem, skipping the password. You can upload a photo of the document instead if needed.";

    const options = currentStep.options as FlowStepOptions | null;
    const documentTypes = options?.documentTypes || [];
    const collectedDocs = collectedData._collectedDocuments || {};
    const collectedDocTypes = Object.keys(collectedDocs);

    const mandatoryDocs = documentTypes.filter((d: any) => d.isMandatory).map((d: any) => d.docType);
    const normalizedCollected = collectedDocTypes.map((k: string) => k.toLowerCase().replace(/_card$/, ''));
    const missingMandatory = mandatoryDocs.filter((d: string) => {
      const norm = d.toLowerCase().replace(/_card$/, '');
      return !normalizedCollected.includes(norm);
    });

    if (missingMandatory.length === 0) {
      console.log(`[WhatsApp Flow] PDF skipped and all mandatory docs already collected/rejected — advancing step`);
      const nextStepKey = currentStep.defaultNextStep || this.getNextStepKey(currentStep.stepKey, steps);

      if (nextStepKey) {
        await this.updateSessionStep(session.id, nextStepKey);
        const nextStep = steps.find((s) => s.stepKey === nextStepKey);
        if (nextStep) {
          return {
            handled: true,
            response: this.buildStepResponse(nextStep, collectedData),
            collectedData,
            sessionId: session.id,
          };
        }
      }

      console.log(`[WhatsApp Flow] PDF skipped, all docs collected, no nextStepKey — completing session ${session.id} (skipPdfPassword final-step path)`);
      await this.completeSession(session.id, collectedData);
      return {
        handled: true,
        response: { type: "text", text: "Thank you! All documents have been received." },
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
      };
    }

    const missingDocs = documentTypes.filter((d: any) => {
      const norm = d.docType.toLowerCase().replace(/_card$/, '');
      return !normalizedCollected.includes(norm);
    });
    const docLines = missingDocs.map((d: any, index: number) => {
      const letter = String.fromCharCode(97 + index);
      const marker = d.isMandatory ? '' : ' (optional)';
      return `${letter}. ${d.label}${marker}`;
    });

    let responseMsg = skipMsg;
    if (docLines.length > 0) {
      responseMsg += `\n\nPlease upload the remaining documents:\n${docLines.join('\n')}`;
    }

    return {
      handled: true,
      response: {
        type: "text",
        text: responseMsg,
      },
      sessionId: session.id,
    };
  }

  async processPdfPassword(
    businessAccountId: string,
    senderPhone: string,
    password: string
  ): Promise<ProcessResult> {
    console.log(`[WhatsApp Flow] Processing PDF password from ${senderPhone}`);

    const activeFlow = await this.getActiveFlow(businessAccountId);
    if (!activeFlow) return { handled: false, shouldFallbackToAI: true };

    const session = await this.getActiveSession(businessAccountId, senderPhone);
    if (!session) return { handled: false, shouldFallbackToAI: true };

    const collectedData = (session.collectedData as Record<string, any>) || {};
    const pendingPdfUrl = collectedData._pendingPdfUrl;
    const pendingPdfFilename = collectedData._pendingPdfFilename;

    if (!pendingPdfUrl) {
      return { handled: false, shouldFallbackToAI: true };
    }

    const normalizedInput = password.trim().toLowerCase();
    if (normalizedInput === "skip" || normalizedInput === "skip_pdf_password") {
      console.log(`[WhatsApp Flow] User skipped PDF password`);
      return this.skipPdfPassword(session, activeFlow.id, collectedData);
    }

    const attempts = (collectedData._pdfPasswordAttempts || 0) + 1;
    collectedData._pdfPasswordAttempts = attempts;
    const maxAttempts = 3;

    const { documentIdentificationService } = await import("./documentIdentificationService");

    const pdfBuffer = await this.downloadFile(pendingPdfUrl);
    if (!pdfBuffer) {
      this.clearPdfPendingState(collectedData);
      this.pendingPdfPasswordKeys.delete(`${businessAccountId}:${senderPhone}`);
      await this.updateSessionData(session.id, collectedData);
      return {
        handled: true,
        response: {
          type: "text",
          text: "Sorry, the document could not be downloaded. It may have expired. Please upload it again.",
        },
        sessionId: session.id,
      };
    }

    // Validate the password against the encrypted PDF (no text identification — vision will run with -upw below)
    const encCheck = await documentIdentificationService.isPdfEncrypted(pdfBuffer, password);

    if (encCheck.encrypted && encCheck.passwordValid === false) {
      if (attempts >= maxAttempts) {
        console.log(`[WhatsApp Flow] Max password attempts (${maxAttempts}) reached, auto-skipping`);
        return this.skipPdfPassword(session, activeFlow.id, collectedData);
      }
      await this.updateSessionData(session.id, collectedData);
      const remaining = maxAttempts - attempts;
      return {
        handled: true,
        response: {
          type: "buttons",
          text: `That password didn't work. You have ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left. Please try again or tap Skip to continue without it.`,
          buttons: [{ id: "skip_pdf_password", title: "Skip" }],
        },
        sessionId: session.id,
      };
    }

    this.clearPdfPendingState(collectedData);
    this.pendingPdfPasswordKeys.delete(`${businessAccountId}:${senderPhone}`);
    collectedData._bankStatementPassword = password;

    const latestSession = await this.getActiveSession(businessAccountId, senderPhone);
    const freshSession = latestSession || session;
    const freshCollectedData = {
      ...(freshSession.collectedData as Record<string, any>) || {},
      ...collectedData,
    };
    if (freshCollectedData._pendingPdfUrl) delete freshCollectedData._pendingPdfUrl;
    if (freshCollectedData._pendingPdfFilename) delete freshCollectedData._pendingPdfFilename;
    if (freshCollectedData._pdfPasswordAttempts) delete freshCollectedData._pdfPasswordAttempts;
    if (freshCollectedData._pendingBankStatement) delete freshCollectedData._pendingBankStatement;

    await this.updateSessionData(freshSession.id, freshCollectedData);

    // Vision-only extraction with the validated password forwarded to pdftoppm -upw
    const pwSteps = await this.getFlowSteps(activeFlow.id);
    const pwUploadStep = pwSteps.find(s => s.stepKey === freshSession.currentStepKey && s.type === 'upload')
      || pwSteps.find(s => s.type === 'upload');
    const pwAllowedDocTypes = (((pwUploadStep?.options as any)?.documentTypes) || []).map((d: any) => d.docType).filter(Boolean);

    let result: any;
    let multiPageHandled: ProcessResult | null = null;
    try {
      const visionResults = await documentIdentificationService.identifyDocumentFromPdfImages(
        businessAccountId,
        pdfBuffer,
        pwAllowedDocTypes,
        password
      );
      const validResults = visionResults.filter(r => r.documentType !== 'unknown');
      if (validResults.length === 0) {
        const firstNote = visionResults[0]?.validationNotes || '';
        const isInfra = (visionResults[0] as any)?._infraError === true;
        const isLimit = /timeout|too long|too many pages/i.test(firstNote);
        const docNames = await this.getDocTypeDisplayNames(businessAccountId, pwAllowedDocTypes);
        const docLabel = this.formatDocNameList(docNames);
        return {
          handled: true,
          response: {
            type: "text",
            text: isInfra
              ? "We're having trouble processing your PDF right now. Please try again in a moment, or send clear photos of each page instead."
              : isLimit
              ? "This PDF is too long or complex to process. Please upload a shorter PDF or photos of each document separately."
              : `This doesn't look like a ${docLabel}. Please upload your ${docLabel} clearly — make sure all pages are visible and readable.`,
          },
          sessionId: freshSession.id,
        };
      }

      // Multi-page handling: group pages by document type and process each page through
      // handleDocumentResult so multi-page docs (e.g. Aadhaar front+back) merge correctly.
      // Restores parity with the standard PDF upload path.
      if (validResults.length > 1) {
        const grouped = new Map<string, typeof validResults>();
        for (const vr of validResults) {
          const dt = vr.documentType?.toLowerCase().replace(/_card$/, '') || 'unknown';
          if (!grouped.has(dt)) grouped.set(dt, []);
          grouped.get(dt)!.push(vr);
        }
        console.log(`[WhatsApp Flow] PDF pages grouped (password flow): ${Array.from(grouped.entries()).map(([k, v]) => `${k}(${v.length})`).join(', ')}`);
        let lastResult: ProcessResult | null = null;
        for (const [docType, pages] of Array.from(grouped.entries())) {
          for (const vResult of pages) {
            const dts = this.getDocTypeState(freshCollectedData, docType);
            if (dts.status === 'complete' || dts.status === 'duplicate') {
              console.log(`[WhatsApp Flow] Skipping page for ${docType} — already ${dts.status} in state machine`);
              continue;
            }
            lastResult = await this.handleDocumentResult(freshSession, activeFlow.id, vResult, freshCollectedData, pendingPdfUrl);
          }
        }
        if (lastResult) {
          multiPageHandled = lastResult;
        } else {
          // All pages were skipped — fall through with first result for retroactive handling below
          result = validResults[0];
        }
      } else {
        result = validResults[0];
      }
    } catch (visionError: any) {
      console.error('[WhatsApp Flow] Vision PDF processing (password flow) failed:', visionError.message);
      const isTimeout = /timeout|etimedout/i.test(visionError.message || '');
      return {
        handled: true,
        response: {
          type: "text",
          text: isTimeout
            ? "This PDF took too long to process. Please upload a shorter PDF or photos of each document separately."
            : "Could not process this PDF. Please upload clear photos of each document separately.",
        },
        sessionId: freshSession.id,
      };
    }

    if (multiPageHandled) return multiPageHandled;

    const steps = await this.getFlowSteps(activeFlow.id);
    const currentStep = steps.find((s) => s.stepKey === freshSession.currentStepKey);
    if (currentStep && currentStep.type !== "upload") {
      const uploadStep = steps.find((s) => s.type === "upload");
      if (uploadStep && result && result.documentType !== "unknown") {
        const uploadOptions = uploadStep.options as any;
        const uploadDocTypes = uploadOptions?.documentTypes || [];
        const expectedTypes = uploadDocTypes.map((d: any) => d.docType);
        const expectedTypesNorm = expectedTypes.map((t: string) => t.toLowerCase().replace(/_card$/, ''));
        if (expectedTypesNorm.includes(result.documentType.toLowerCase().replace(/_card$/, ''))) {
          const collectedDocs = freshCollectedData._collectedDocuments || {};
          const retroEntry: Record<string, any> = {
            documentType: result.documentType,
            confidence: result.confidence,
            extractedData: result.extractedData,
            isValid: result.isValid,
            uploadedAt: new Date().toISOString(),
            side: result.side || 'front',
          };
          const existingRetroDoc = collectedDocs[result.documentType];
          if (existingRetroDoc) {
            if (!existingRetroDoc.additionalPhotos) existingRetroDoc.additionalPhotos = [];
            existingRetroDoc.additionalPhotos.push(retroEntry);
            if (result.extractedData?.documentNumber && !existingRetroDoc.extractedData?.documentNumber) {
              existingRetroDoc.extractedData = { ...existingRetroDoc.extractedData, ...result.extractedData };
            }
          } else {
            collectedDocs[result.documentType] = retroEntry;
          }
          freshCollectedData._collectedDocuments = collectedDocs;
          await this.updateSessionData(freshSession.id, freshCollectedData);

          const docLabel = uploadDocTypes.find((d: any) => d.docType === result.documentType)?.label || result.documentType;
          console.log(`[WhatsApp Flow] PDF password processed after step advanced - stored ${docLabel} retroactively (no message sent)`);
          return {
            handled: true,
            collectedData: freshCollectedData,
            sessionId: freshSession.id,
          };
        }
      }
    }

    return this.handleDocumentResult(freshSession, activeFlow.id, result, freshCollectedData, pendingPdfUrl);
  }

  private async sendUploadAcknowledgment(businessAccountId: string, senderPhone: string, sessionId: string): Promise<void> {
    try {
      const { whatsappService } = await import("./whatsappService");
      const settings = await whatsappService.getSettings(businessAccountId);
      if (!settings?.msg91AuthKey || !settings?.msg91IntegratedNumberId) return;
      const { whatsappAutoReplyService } = await import("./whatsappAutoReplyService");
      await whatsappAutoReplyService.sendFlowResponse(
        settings,
        senderPhone,
        { type: "text", text: "Analyzing your document..." },
        sessionId
      );
    } catch (err) {
      console.error("[WhatsApp Flow] Failed to send upload ack:", err);
    }
  }

  async processImageUpload(
    businessAccountId: string,
    senderPhone: string,
    imageUrl: string,
    filename?: string,
    preDownloadedBuffer?: Buffer
  ): Promise<ProcessResult> {
    console.log(`[WhatsApp Flow] Processing image upload from ${senderPhone}`);

    const activeFlow = await this.getActiveFlow(businessAccountId);
    if (!activeFlow) {
      console.log(`[WhatsApp Flow] No active flow for business ${businessAccountId}`);
      return { handled: false, shouldFallbackToAI: true };
    }

    const session = await this.getActiveSession(businessAccountId, senderPhone);

    if (!session) {
      return { handled: false, shouldFallbackToAI: true };
    }

    const collectedDataForGuard = (session.collectedData as Record<string, any>) || {};
    if (collectedDataForGuard._confirmationState) {
      const cs = collectedDataForGuard._confirmationState as { phase: string; docType: string; pendingData: Record<string, any>; fieldEdits: Record<string, string>; fields: { key: string; label: string; value: string }[] };
      console.log(`[WhatsApp Flow] New upload while confirmation pending for ${cs.docType} — reminding user to confirm first`);
      const summary = await this.buildConfirmationSummary(businessAccountId, cs.docType, { ...cs.pendingData, ...(cs.fieldEdits || {}) });
      cs.fields = summary.fields;
      cs.phase = 'awaiting_action';
      await this.updateSessionData(session.id, collectedDataForGuard);
      return {
        handled: true,
        response: {
          type: "buttons",
          text: `Please confirm the previously extracted details first before uploading another document.\n\n${this.formatConfirmationMessage(summary)}`,
          buttons: [
            { id: "doc_confirm", title: "✅ Confirm" },
            { id: "doc_update", title: "✏️ Update" },
          ],
        },
        sessionId: session.id,
      };
    }

    const steps = await this.getFlowSteps(activeFlow.id);

    if (this.isUpdateFlowStep(session.currentStepKey)) {
      if (session.currentStepKey === this.UPDATE_ADD_DOCS_STEP || session.currentStepKey === this.UPDATE_MENU_STEP) {
        if (session.currentStepKey === this.UPDATE_MENU_STEP) {
          const collectedData = (session.collectedData as Record<string, any>) || {};
          await this.advanceSession(session.id, this.UPDATE_ADD_DOCS_STEP, collectedData);
        }
        const uploadStep = steps.find(s => s.type === "upload");
        if (!uploadStep) {
          console.log(`[WhatsApp Flow] No upload step found in flow for update mode`);
          return { handled: false, shouldFallbackToAI: true };
        }
        const options = uploadStep.options as FlowStepOptions | null;
        const documentTypes = options?.documentTypes || [];
        if (documentTypes.length === 0) {
          return { handled: false, shouldFallbackToAI: true };
        }
        const lockKey = `${businessAccountId}:${senderPhone}`;
        this.cancelUploadDebounce(lockKey);
        if (this.shouldSendAck(lockKey)) {
          this.sendUploadAcknowledgment(businessAccountId, senderPhone, session.id).catch(err =>
            console.error("[WhatsApp Flow] Ack message error:", err)
          );
        }
        const pendingCount = (this.pendingUploadCount.get(lockKey) || 0) + 1;
        this.pendingUploadCount.set(lockKey, pendingCount);
        const decrementPending = () => {
          const current = this.pendingUploadCount.get(lockKey) || 1;
          const remaining = current - 1;
          if (remaining <= 0) {
            this.pendingUploadCount.delete(lockKey);
            this.uploadAckSent.delete(lockKey);
          } else {
            this.pendingUploadCount.set(lockKey, remaining);
          }
        };
        return this.withUploadLock(lockKey, async () => {
          const freshSession = await this.getActiveSession(businessAccountId, senderPhone);
          if (!freshSession) { decrementPending(); return { handled: false, shouldFallbackToAI: true }; }

          const { documentIdentificationService } = await import("./documentIdentificationService");
          const isPdf = this.isPdfFile(imageUrl) || (filename ? filename.toLowerCase().endsWith('.pdf') : false);
          let result: any;

          if (isPdf) {
            const pdfBuffer = preDownloadedBuffer || await this.downloadFile(imageUrl);
            if (!pdfBuffer) {
              decrementPending();
              return {
                handled: true,
                response: { type: "text", text: "Sorry, the document could not be downloaded. Please try uploading again." },
                sessionId: freshSession.id,
              };
            }
            const encProbe = await documentIdentificationService.isPdfEncrypted(pdfBuffer);
            if (encProbe.encrypted) {
              // Persist pending PDF state so the user's next message (the password)
              // is routed to processPdfPassword via _pendingPdfUrl.
              const updateLatestSession = await this.getActiveSession(businessAccountId, senderPhone);
              const updateCollectedData = (updateLatestSession?.collectedData as Record<string, any>) || {};
              updateCollectedData._pendingPdfUrl = imageUrl;
              updateCollectedData._pendingPdfFilename = filename;
              updateCollectedData._pdfPasswordAttempts = 0;

              const updateSessionId = updateLatestSession?.id || freshSession.id;
              await this.updateSessionData(updateSessionId, updateCollectedData);
              this.pendingPdfPasswordKeys.add(lockKey);
              decrementPending();
              return {
                handled: true,
                response: {
                  type: "buttons",
                  text: "This PDF is password protected. Please type the password for this document, or tap Skip to continue without it.",
                  buttons: [{ id: "skip_pdf_password", title: "Skip" }],
                },
                sessionId: updateSessionId,
              };
            }
            const visionResults = await documentIdentificationService.identifyDocumentFromPdfImages(businessAccountId, pdfBuffer, documentTypes.map((d: any) => d.docType));
            const validPdfResults = visionResults.filter((r: any) => r.documentType !== 'unknown');
            if (validPdfResults.length === 0) {
              const firstNote = visionResults[0]?.validationNotes || '';
              const isInfra = (visionResults[0] as any)?._infraError === true;
              const isLimit = /timeout|too long|too many pages/i.test(firstNote);
              decrementPending();
              const docNames = await this.getDocTypeDisplayNames(
                businessAccountId,
                (documentTypes as any[]).map((d: any) => d.docType).filter(Boolean)
              );
              const docLabel = this.formatDocNameList(docNames);
              return {
                handled: true,
                response: {
                  type: "text",
                  text: isInfra
                    ? "We're having trouble processing your PDF right now. Please try again in a moment, or send clear photos of each page instead."
                    : isLimit
                    ? "This PDF is too long or complex to process. Please upload a shorter PDF or photos of each document separately."
                    : `This doesn't look like a ${docLabel}. Please upload your ${docLabel} clearly — make sure all pages are visible and readable.`,
                },
                sessionId: freshSession.id,
              };
            }
            result = validPdfResults[0];
          } else {
            let identifyUrl = imageUrl;
            if (preDownloadedBuffer) {
              const { buffer: convertedBuf, mimeType: convertedMime, conversionFailed: batchConvFailed } = await this.convertToJpegIfNeeded(preDownloadedBuffer, imageUrl, filename);
              if (batchConvFailed) {
                console.warn('[WhatsApp Flow] Unsupported image format in batch path — skipping identification');
                decrementPending();
                return {
                  handled: true,
                  response: {
                    type: 'text',
                    text: "Sorry, this image format isn't supported. Please take a screenshot or export your document as a JPEG or PNG photo and try again.",
                  },
                  sessionId: freshSession.id,
                };
              }
              identifyUrl = `data:${convertedMime};base64,${convertedBuf.toString('base64')}`;
            }
            const preDocState = this.getDocumentState((freshSession.collectedData as Record<string, any>) || {});
            let sideHint: string | undefined;
            for (const [dt, state] of Object.entries(preDocState)) {
              if (dt.toLowerCase() === 'aadhaar') {
                const mergedData = (state as any).mergedData || {};
                const hasNumber = mergedData.aadhaar_number;
                if (state.status === 'processing' && state.pages.length >= 1 && hasNumber && !mergedData.address) {
                  sideHint = `CONTEXT: We already received ${state.pages.length} page(s) of this Aadhaar card (Aadhaar number: ${hasNumber}, name: ${mergedData.full_name || 'collected'}). This new image is likely the BACK side of the same Aadhaar card. If this image shows an address block and/or QR code, set side='back' and extract the complete residential address into the 'address' field.`;
                  console.log(`[WhatsApp Flow] Injecting Aadhaar back-side hint for ${senderPhone}`);
                  break;
                }
                if (state.status === 'complete' && state.pages.length >= 1 && hasNumber && mergedData.address) {
                  sideHint = `CONTEXT: We already collected the BACK side of this Aadhaar card (Aadhaar number: ${hasNumber}, address collected). This new image is likely the FRONT side. Please set side='front' and extract: full_name (the person's actual name as printed, NOT the C/O address line), dob (date of birth), gender, father_name. The name on the front is the authoritative name for this person.`;
                  console.log(`[WhatsApp Flow] Injecting Aadhaar front-side enrichment hint for ${senderPhone}`);
                  break;
                }
              }
            }
            result = await documentIdentificationService.identifyDocument(businessAccountId, identifyUrl, sideHint, documentTypes.map((d: any) => d.docType));
          }

          const freshCollectedData = (freshSession.collectedData as Record<string, any>) || {};
          const collectedDocs = freshCollectedData._collectedDocuments || {};

          if (result.documentType === "unknown" || result.confidence < 0.3) {
            decrementPending();
            return {
              handled: true,
              response: { type: "text", text: "Could not identify this document. Please upload a clearer image of your PAN, Aadhaar, or Bank Statement." },
              sessionId: freshSession.id,
            };
          }

          // Cross-validate Aadhaar/PAN number against lead's original application data
          const cvDocNumber = result.extractedData?.documentNumber;
          const cvIsPanOrAadhaar = ['pan', 'pan_card', 'aadhaar', 'aadhaar_card'].includes(result.documentType);
          if (cvDocNumber && cvIsPanOrAadhaar) {
            const cvNormalizeNum = (s: string) => s.replace(/[\s\-\.\/]+/g, '').toUpperCase();
            const cvNormalized = cvNormalizeNum(cvDocNumber);
            const cvExistingLeadId = freshCollectedData._updateExistingLeadId;

            // Duplicate check: reject if another lead (not the one being updated) already has this doc number
            const [cvCooldownRow] = await db
              .select({ newApplicationCooldownDays: whatsappSettings.newApplicationCooldownDays })
              .from(whatsappSettings)
              .where(eq(whatsappSettings.businessAccountId, businessAccountId))
              .limit(1);
            const cvCooldownDays = cvCooldownRow?.newApplicationCooldownDays ?? 7;
            const cvCutoffDate = new Date(Date.now() - cvCooldownDays * 24 * 60 * 60 * 1000);
            const cvRecentLeads = await db
              .select()
              .from(whatsappLeads)
              .where(and(
                eq(whatsappLeads.businessAccountId, businessAccountId),
                ne(whatsappLeads.status, 'message_only'),
                gte(whatsappLeads.createdAt, cvCutoffDate)
              ));
            const cvMatchedType = documentTypes.find((d: any) => d.docType === result.documentType)?.docType || result.documentType;
            const cvDuplicate = cvRecentLeads.find((lead: any) => {
              if (lead.id === cvExistingLeadId || lead.flowSessionId === freshSession.id) return false;
              const ed = (lead.extractedData as Record<string, any>) || {};
              const flatVal = ed[cvMatchedType] || ed[cvMatchedType.replace('_card', '')];
              if (flatVal && typeof flatVal === 'string' && cvNormalizeNum(flatVal) === cvNormalized) return true;
              const docs = ed._documents || ed._collectedDocuments || {};
              const existingDocEntry = docs[cvMatchedType] || docs[cvMatchedType.replace('_card', '')];
              if (!existingDocEntry) return false;
              const primaryNum = existingDocEntry.extractedData?.documentNumber;
              if (primaryNum && cvNormalizeNum(primaryNum) === cvNormalized) return true;
              return (existingDocEntry.additionalPhotos || []).some((p: any) =>
                p.extractedData?.documentNumber && cvNormalizeNum(p.extractedData.documentNumber) === cvNormalized
              );
            });
            if (cvDuplicate) {
              const cvDocLabel = result.documentType.includes('pan') ? 'PAN' : 'Aadhaar';
              // No PII masking — testing phase
              decrementPending();
              return {
                handled: true,
                response: { type: "text", text: `This ${cvDocLabel} (${cvDocNumber}) has already been submitted recently. Please upload a different ${cvDocLabel} document.` },
                sessionId: freshSession.id,
              };
            }

            // Levenshtein cross-validation: compare extracted number against lead's application fields
            const cvPanRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
            const cvAadhaarRegex = /^\d{12}$/;
            const cvIsExtractedPan = cvPanRegex.test(cvNormalized);
            const cvLevenshtein = (a: string, b: string): number => {
              const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
                Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
              );
              for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                  dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
                }
              }
              return dp[a.length][b.length];
            };
            for (const [key, val] of Object.entries(freshCollectedData)) {
              if (key.startsWith('_') || typeof val !== 'string') continue;
              const cvNormalizedVal = cvNormalizeNum(val);
              const valMatchesSameType = cvIsExtractedPan
                ? cvPanRegex.test(cvNormalizedVal)
                : cvAadhaarRegex.test(cvNormalizedVal);
              if (valMatchesSameType && cvNormalizedVal !== cvNormalized) {
                const dist = cvLevenshtein(cvNormalizedVal, cvNormalized);
                const cvDocLabel = cvIsExtractedPan ? 'PAN' : 'Aadhaar';
                if (dist <= 3) {
                  console.log(`[WhatsApp Flow] Update docs OCR tolerance: extracted ${cvDocLabel} "${cvNormalized}" vs application "${cvNormalizedVal}" (distance: ${dist}) — match`);
                } else {
                  console.log(`[WhatsApp Flow] Update docs mismatch: extracted ${cvDocLabel} "${cvNormalized}" vs application "${cvNormalizedVal}" (distance: ${dist})`);
                  decrementPending();
                  return {
                    handled: true,
                    response: {
                      type: "text",
                      text: `⚠️ The ${cvDocLabel} number on the uploaded document does not match the ${cvDocLabel} on your application. Please re-upload the correct ${cvDocLabel} card.`,
                    },
                    sessionId: freshSession.id,
                  };
                }
                break;
              }
            }
          }

          const matchedType = documentTypes.find((d: any) => d.docType === result.documentType)?.docType || result.documentType;
          const docEntry: Record<string, any> = {
            documentType: result.documentType,
            confidence: result.confidence,
            extractedData: result.extractedData,
            isValid: result.isValid,
            uploadedAt: new Date().toISOString(),
            side: result.side || 'front',
            sourceMediaUrl: imageUrl,
            label: documentTypes.find((d: any) => d.docType === matchedType)?.label || matchedType.replace(/_/g, " "),
          };

          const existingDoc = collectedDocs[matchedType];
          if (existingDoc) {
            const existingNumber = existingDoc.extractedData?.documentNumber;
            const newNumber = result.extractedData?.documentNumber;
            const isSameDocument = !existingNumber || !newNumber || existingNumber === newNumber;
            if (isSameDocument) {
              const existingSide = existingDoc.side || 'front';
              const newSide = result.side || 'front';
              if (existingSide !== newSide) {
                const existingAdditional = existingDoc.additionalPhotos || [];
                docEntry.side = newSide;
                const sameSideIndex = existingAdditional.findIndex((p: any) => (p.side || 'front') === newSide);
                if (sameSideIndex >= 0) existingAdditional[sameSideIndex] = docEntry;
                else existingAdditional.push(docEntry);
                existingDoc.additionalPhotos = existingAdditional;
                existingDoc.extractedData = { ...existingDoc.extractedData, ...result.extractedData };
              } else {
                docEntry.extractedData = { ...existingDoc.extractedData, ...result.extractedData };
                docEntry.additionalPhotos = existingDoc.additionalPhotos || [];
                collectedDocs[matchedType] = docEntry;
              }
            } else {
              collectedDocs[matchedType] = docEntry;
            }
          } else {
            collectedDocs[matchedType] = docEntry;
          }

          freshCollectedData._collectedDocuments = collectedDocs;

          await this.autoFillDocumentFields(matchedType, result.extractedData || {}, freshCollectedData, businessAccountId);

          // Task #1 — instant cross-document verification (batch path).
          const batchInstant = await this.runInstantVerification(freshSession, freshCollectedData, matchedType);
          if (batchInstant.rejectUploadedDoc) {
            const docLabel = matchedType.replace(/_/g, ' ');
            console.log(`[WhatsApp Flow] Rejecting ${matchedType} (batch) due to incremental verification failure`);
            if (freshCollectedData._collectedDocuments) {
              delete freshCollectedData._collectedDocuments[matchedType];
            }
            freshCollectedData._docMismatchWarning =
              batchInstant.rejectionWarning ||
              `The ${docLabel} you just uploaded does not match information from earlier documents. Please re-upload the correct document.`;
            await this.updateSessionData(freshSession.id, freshCollectedData);
            decrementPending();
            const cancelled = await this.waitForMoreUploads(lockKey);
            if (cancelled) {
              return { handled: true, collectedData: freshCollectedData, sessionId: freshSession.id };
            }
            return { handled: true, collectedData: freshCollectedData, sessionId: freshSession.id };
          }

          const batchedExtractionSummary = await this.buildExtractedFieldsSummary(matchedType, result.extractedData || {}, businessAccountId);
          if (batchedExtractionSummary) {
            freshCollectedData._pendingExtractionSummary =
              (freshCollectedData._pendingExtractionSummary ? freshCollectedData._pendingExtractionSummary + '\n\n' : '') +
              batchedExtractionSummary;
          }
          await this.updateSessionData(freshSession.id, freshCollectedData);
          decrementPending();

          const docLabel = docEntry.label || matchedType.replace(/_/g, " ");
          const cancelled = await this.waitForMoreUploads(lockKey);
          if (cancelled) {
            return { handled: true, collectedData: freshCollectedData, sessionId: freshSession.id };
          }

          const allDocLabels = Object.keys(collectedDocs).map(key => {
            const d = collectedDocs[key];
            return d?.label || key.replace(/_/g, " ");
          });

          const updateFlowSummary = freshCollectedData._pendingExtractionSummary || '';
          delete freshCollectedData._pendingExtractionSummary;
          await this.updateSessionData(freshSession.id, freshCollectedData);

          return {
            handled: true,
            collectedData: freshCollectedData,
            response: {
              type: "buttons",
              text: `${docLabel} received and updated!${updateFlowSummary ? '\n\n' + updateFlowSummary : ''}\n\nDocuments on file: ${allDocLabels.join(", ")}.\n\nUpload more documents or tap Done when finished.`,
              buttons: [{ id: "done", title: "Done" }],
            },
            sessionId: freshSession.id,
          };
        });
      }
    }

    let currentStep = steps.find((s) => s.stepKey === session.currentStepKey);
    const sessionData = (session.collectedData as Record<string, any>) || {};

    // Adaptive journeys accept a document before the configured upload step.
    // Keep the user's real position intact and remember the upload step only
    // for document classification; completion resumes the original journey.
    if (
      this.isAdaptiveJourneyEnabled(activeFlow, businessAccountId) &&
      currentStep &&
      currentStep.type !== "upload" &&
      !this.isUpdateFlowStep(session.currentStepKey)
    ) {
      const uploadStep = sessionData._adaptiveUploadStepKey
        ? steps.find(step => step.stepKey === sessionData._adaptiveUploadStepKey)
        : steps.find(step => step.type === "upload" && !(step as any).paused);

      if (uploadStep?.type === "upload") {
        sessionData._adaptiveResumeStepKey = session.currentStepKey;
        sessionData._adaptiveUploadStepKey = uploadStep.stepKey;
        await this.updateSessionData(session.id, sessionData);
        currentStep = uploadStep;
        console.log(`[WhatsApp Flow] Adaptive mode accepted an early document at "${session.currentStepKey}" using upload step "${uploadStep.stepKey}"`);
      }
    }

    if (!currentStep || currentStep.type !== "upload") {
      console.log(`[WhatsApp Flow] Current step is not an upload step`);
      return { handled: false, shouldFallbackToAI: true };
    }

    const options = currentStep.options as FlowStepOptions | null;
    const documentTypes = options?.documentTypes || [];

    if (documentTypes.length === 0) {
      console.log(`[WhatsApp Flow] No document types configured for upload step`);
      return { handled: false, shouldFallbackToAI: true };
    }

    const lockKey = `${businessAccountId}:${senderPhone}`;

    this.cancelUploadDebounce(lockKey);

    if (this.shouldSendAck(lockKey)) {
      this.sendUploadAcknowledgment(businessAccountId, senderPhone, session.id).catch(err =>
        console.error("[WhatsApp Flow] Ack message error:", err)
      );
    }

    if (!this.pendingUploadCount.has(lockKey)) {
      this.batchResponseSent.delete(lockKey);
    }
    const pendingCount = (this.pendingUploadCount.get(lockKey) || 0) + 1;
    this.pendingUploadCount.set(lockKey, pendingCount);
    console.log(`[WhatsApp Flow] Queued upload #${pendingCount} for ${senderPhone}`);

    const decrementPending = () => {
      const current = this.pendingUploadCount.get(lockKey) || 1;
      const remaining = current - 1;
      if (remaining <= 0) {
        this.pendingUploadCount.delete(lockKey);
        this.uploadAckSent.delete(lockKey);
      } else {
        this.pendingUploadCount.set(lockKey, remaining);
      }
      console.log(`[WhatsApp Flow] Decremented pending count for ${senderPhone}: ${current} -> ${remaining}`);
    };

    return this.withUploadLock(lockKey, async () => {
      console.log(`[WhatsApp Flow] Acquired upload lock for ${senderPhone}`);

      const freshSession = await this.getActiveSession(businessAccountId, senderPhone);
      if (!freshSession) {
        decrementPending();
        return { handled: false, shouldFallbackToAI: true };
      }
      const freshData = (freshSession.collectedData as Record<string, any>) || {};
      const freshStep = freshData._adaptiveUploadStepKey
        ? steps.find((s) => s.stepKey === freshData._adaptiveUploadStepKey)
        : steps.find((s) => s.stepKey === freshSession.currentStepKey);
      if (!freshStep || freshStep.type !== "upload") {
        console.log(`[WhatsApp Flow] Step changed while queued, current step is no longer upload`);
        decrementPending();
        return { handled: false, shouldFallbackToAI: true };
      }

      const { documentIdentificationService } = await import("./documentIdentificationService");
      const isPdf = this.isPdfFile(imageUrl) || (filename && filename.toLowerCase().endsWith('.pdf'));

      if (isPdf) {
        console.log(`[WhatsApp Flow] Detected PDF upload, vision-only path`);
        const pdfStartTime = Date.now();
        const pdfBuffer = preDownloadedBuffer || await this.downloadFile(imageUrl);
        if (!pdfBuffer) {
          decrementPending();
          return {
            handled: true,
            response: {
              type: "text",
              text: "Sorry, the document could not be downloaded. Please try uploading again.",
            },
            sessionId: freshSession.id,
          };
        }

        // Encryption probe (no text identification — only checks if password is required)
        const encProbe = await documentIdentificationService.isPdfEncrypted(pdfBuffer);
        if (encProbe.encrypted) {
          const latestPdfSession = await this.getActiveSession(businessAccountId, senderPhone);
          const collectedData = (latestPdfSession?.collectedData as Record<string, any>) || {};
          collectedData._pendingPdfUrl = imageUrl;
          collectedData._pendingPdfFilename = filename;
          collectedData._pdfPasswordAttempts = 0;

          const stepOptions = freshStep.options as FlowStepOptions | null;
          const stepDocTypes = stepOptions?.documentTypes || [];
          const stepMandatory = stepDocTypes.filter((d: any) => d.isMandatory).map((d: any) => d.docType);
          const stepCollected = Object.keys(collectedData._collectedDocuments || {});
          const stepCollectedNorm = stepCollected.map((k: string) => k.toLowerCase().replace(/_card$/, ''));
          const stepMissing = stepMandatory.filter((d: string) => !stepCollectedNorm.includes(d.toLowerCase().replace(/_card$/, '')));

          const sessionId = latestPdfSession?.id || freshSession.id;
          await this.updateSessionData(sessionId, collectedData);
          this.pendingPdfPasswordKeys.add(lockKey);

          console.log(`[WhatsApp Flow] PDF password check — mandatory: [${stepMandatory.join(',')}], collected: [${stepCollected.join(',')}], missing: [${stepMissing.join(',')}]`);

          decrementPending();

          if (stepMissing.length > 0) {
            console.log(`[WhatsApp Flow] PDF password protected with ${stepMissing.length} mandatory docs still missing — asking for password first before continuing`);
          }

          return {
            handled: true,
            response: {
              type: "buttons",
              text: "This PDF is password protected. Please type the password for this document, or tap Skip to continue without it.",
              buttons: [{ id: "skip_pdf_password", title: "Skip" }],
            },
            sessionId,
          };
        }

        // Vision-only extraction (classify-then-strict per-doc, with Tier 1→2 escalation inside)
        try {
          const visionResults = await documentIdentificationService.identifyDocumentFromPdfImages(
            businessAccountId,
            pdfBuffer,
            documentTypes.map((d: any) => d.docType)
          );
          const validResults = visionResults.filter(r => r.documentType !== 'unknown');
          console.log(`[WhatsApp Flow] [Timing] PDF total processing: ${Date.now() - pdfStartTime}ms (vision-only, ${validResults.length} docs found)`);

          if (validResults.length === 0) {
            const firstNote = visionResults[0]?.validationNotes || '';
            const isInfra = (visionResults[0] as any)?._infraError === true;
            const isLimit = /timeout|too long|too many pages/i.test(firstNote);
            decrementPending();
            const docNames = await this.getDocTypeDisplayNames(
              businessAccountId,
              (documentTypes as any[]).map((d: any) => d.docType).filter(Boolean)
            );
            const docLabel = this.formatDocNameList(docNames);
            return {
              handled: true,
              response: {
                type: "text",
                text: isInfra
                  ? "We're having trouble processing your PDF right now. Please try again in a moment, or send clear photos of each page instead."
                  : isLimit
                  ? "This PDF is too long or complex to process. Please upload a shorter PDF or photos of each document separately."
                  : `This doesn't look like a ${docLabel}. Please upload your ${docLabel} clearly — make sure all pages are visible and readable.`,
              },
              sessionId: freshSession.id,
            };
          }

          const latestVisionSession = await this.getActiveSession(businessAccountId, senderPhone);
          const visionSession = latestVisionSession || freshSession;
          const grouped = new Map<string, typeof validResults>();
          for (const vr of validResults) {
            const dt = vr.documentType?.toLowerCase().replace(/_card$/, '') || 'unknown';
            if (!grouped.has(dt)) grouped.set(dt, []);
            grouped.get(dt)!.push(vr);
          }
          console.log(`[WhatsApp Flow] PDF pages grouped (vision-only): ${Array.from(grouped.entries()).map(([k, v]) => `${k}(${v.length})`).join(', ')}`);
          const vCollectedData = (visionSession.collectedData as Record<string, any>) || {};
          const allPages = Array.from(grouped.entries()).flatMap(([, pages]) => pages);
          let lastProcessedResult: ProcessResult | undefined;
          for (let pi = 0; pi < allPages.length; pi++) {
            const vResult = allPages[pi];
            const dt = vResult.documentType?.toLowerCase().replace(/_card$/, '') || 'unknown';
            const dts = this.getDocTypeState(vCollectedData, dt);
            if (dts.status === 'complete' || dts.status === 'duplicate') {
              console.log(`[WhatsApp Flow] Skipping page for ${dt} — already ${dts.status} in state machine`);
              continue;
            }
            lastProcessedResult = await this.handleDocumentResult(visionSession, activeFlow.id, vResult, vCollectedData, imageUrl);
          }
          return this.handleDocumentResultBatched(visionSession, activeFlow.id, allPages[allPages.length - 1], vCollectedData, lockKey, businessAccountId, senderPhone, imageUrl, lastProcessedResult);
        } catch (visionError: any) {
          console.error('[WhatsApp Flow] Vision PDF processing failed:', visionError.message);
          decrementPending();
          const isTimeout = /timeout|etimedout/i.test(visionError.message || '');
          return {
            handled: true,
            response: {
              type: "text",
              text: isTimeout
                ? "This PDF took too long to process. Please upload a shorter PDF or photos of each document separately."
                : "Could not process this PDF. Please upload clear photos of each document separately.",
            },
            sessionId: freshSession.id,
          };
        }
      }

      let imageBuffer: Buffer | undefined = preDownloadedBuffer;
      if (!imageBuffer) {
        imageBuffer = (await this.downloadFile(imageUrl)) || undefined;
      }

      if (!imageBuffer) {
        decrementPending();
        return {
          handled: true,
          response: {
            type: "text",
            text: "Could not process the image. The file may have expired or failed to load. Please upload again.",
          },
          sessionId: freshSession.id,
        };
      }

      const { buffer: convertedBuffer, mimeType, conversionFailed } = await this.convertToJpegIfNeeded(imageBuffer, imageUrl, filename);
      if (conversionFailed) {
        console.warn('[WhatsApp Flow] Unsupported image format — cannot process HEIC/HEIF after both sharp and ffmpeg failed');
        decrementPending();
        return {
          handled: true,
          response: {
            type: 'text',
            text: "Sorry, this image format isn't supported. Please take a screenshot or export your document as a JPEG or PNG photo and try again.",
          },
          sessionId: freshSession.id,
        };
      }
      const base64Image = convertedBuffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64Image}`;

      let result;
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Document identification timed out after 45 seconds')), 45000)
        );
        result = await Promise.race([
          documentIdentificationService.identifyDocument(businessAccountId, dataUrl, undefined, documentTypes.map((d: any) => d.docType)),
          timeoutPromise,
        ]);
      } catch (error) {
        console.error("[WhatsApp Flow] Document identification failed:", error);
        decrementPending();
        return {
          handled: true,
          response: {
            type: "text",
            text: "Sorry, I couldn't process that image. Please try uploading again.",
          },
          sessionId: freshSession.id,
        };
      }

      const latestImgSession = await this.getActiveSession(businessAccountId, senderPhone);
      const imgSession = latestImgSession || freshSession;
      const collectedData = (imgSession.collectedData as Record<string, any>) || {};
      return this.handleDocumentResultBatched(imgSession, activeFlow.id, result, collectedData, lockKey, businessAccountId, senderPhone, imageUrl);
    });
  }

  private guessMimeType(url: string, filename?: string): string {
    const name = (filename || url).toLowerCase();
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.pdf')) return 'application/pdf';
    if (name.endsWith('.heic') || name.endsWith('.heif')) return 'image/heic';
    return 'image/jpeg';
  }

  private async convertToJpegIfNeeded(buffer: Buffer, url: string, filename?: string): Promise<{ buffer: Buffer; mimeType: string; conversionFailed?: boolean }> {
    const mimeType = this.guessMimeType(url, filename);
    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
      try {
        const sharp = (await import('sharp')).default;
        const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
        console.log('[WhatsApp Flow] Converted HEIC/HEIF image to JPEG via sharp');
        return { buffer: jpegBuffer, mimeType: 'image/jpeg' };
      } catch (sharpErr) {
        console.warn('[WhatsApp Flow] sharp HEIC conversion failed, trying ffmpeg fallback:', (sharpErr as Error).message);
      }

      try {
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        const tmpIn = path.join(os.tmpdir(), `heic_in_${Date.now()}_${Math.random().toString(36).slice(2)}.heic`);
        const tmpOut = path.join(os.tmpdir(), `heic_out_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
        try {
          fs.writeFileSync(tmpIn, buffer);
          await execFileAsync('ffmpeg', ['-y', '-i', tmpIn, '-frames:v', '1', '-q:v', '2', tmpOut]);
          const jpegBuffer = fs.readFileSync(tmpOut);
          console.log('[WhatsApp Flow] Converted HEIC/HEIF image to JPEG via ffmpeg');
          return { buffer: jpegBuffer, mimeType: 'image/jpeg' };
        } finally {
          try { fs.unlinkSync(tmpIn); } catch {}
          try { fs.unlinkSync(tmpOut); } catch {}
        }
      } catch (ffmpegErr) {
        console.warn('[WhatsApp Flow] ffmpeg HEIC conversion failed, trying heic-convert (WASM):', (ffmpegErr as Error).message.split('\n')[0]);
      }

      try {
        const heicConvert = (await import('heic-convert')).default;
        const jpegArrayBuffer = await heicConvert({ buffer: buffer as any, format: 'JPEG', quality: 0.9 });
        const jpegBuffer = Buffer.from(jpegArrayBuffer);
        console.log('[WhatsApp Flow] Converted HEIC/HEIF image to JPEG via heic-convert (WASM)');
        return { buffer: jpegBuffer, mimeType: 'image/jpeg' };
      } catch (heicErr) {
        console.error('[WhatsApp Flow] heic-convert WASM also failed:', (heicErr as Error).message);
        return { buffer, mimeType, conversionFailed: true };
      }
    }
    return { buffer, mimeType };
  }

  private async handleDocumentResultBatched(
    session: any,
    flowId: string,
    result: any,
    collectedData: Record<string, any>,
    lockKey: string,
    businessAccountId: string,
    senderPhone: string,
    sourceMediaUrl?: string,
    preComputedResult?: ProcessResult
  ): Promise<ProcessResult> {
    if (!this.batchPreExistingCompleted.has(lockKey)) {
      const preDocState = this.getDocumentState(collectedData);
      const preCompleted = new Set<string>();
      for (const [dt, state] of Object.entries(preDocState)) {
        if (state.status === 'complete') preCompleted.add(dt);
      }
      this.batchPreExistingCompleted.set(lockKey, preCompleted);
    }

    const immediateResult = preComputedResult || await this.handleDocumentResult(session, flowId, result, collectedData, sourceMediaUrl);

    this.batchTotalProcessedCounts.set(lockKey, (this.batchTotalProcessedCounts.get(lockKey) || 0) + 1);
    if (!immediateResult.rejectedDuplicate) {
      this.batchAcceptedCounts.set(lockKey, (this.batchAcceptedCounts.get(lockKey) || 0) + 1);
    }

    const remaining = (this.pendingUploadCount.get(lockKey) || 1) - 1;
    this.pendingUploadCount.set(lockKey, remaining);
    console.log(`[WhatsApp Flow] Processed upload for ${senderPhone}, ${remaining} more pending`);

    if (!immediateResult.handled || !immediateResult.response) {
      if (remaining > 0) {
        return immediateResult;
      }
      console.log(`[WhatsApp Flow] Last upload in batch had no response (duplicate/skip) for ${senderPhone} — falling through to consolidated response`);
    }

    if (immediateResult.flowCompleted) {
      this.pendingUploadCount.delete(lockKey);
      this.uploadAckSent.delete(lockKey);
      this.batchAcceptedCounts.delete(lockKey);
      this.batchTotalProcessedCounts.delete(lockKey);
      this.batchPreExistingCompleted.delete(lockKey);
      return immediateResult;
    }

    const freshSessionAfterDoc = await this.getActiveSession(businessAccountId, senderPhone);
    if (freshSessionAfterDoc && freshSessionAfterDoc.currentStepKey !== session.currentStepKey) {
      console.log(`[WhatsApp Flow] Step advanced from ${session.currentStepKey} to ${freshSessionAfterDoc.currentStepKey} after processing upload — sending response immediately (not suppressing)`);
      this.pendingUploadCount.delete(lockKey);
      this.uploadAckSent.delete(lockKey);
      this.batchAcceptedCounts.delete(lockKey);
      this.batchTotalProcessedCounts.delete(lockKey);
      this.batchPreExistingCompleted.delete(lockKey);
      this.cancelUploadDebounce(lockKey);
      this.batchResponseSent.add(lockKey);
      return immediateResult;
    }

    if (remaining > 0) {
      console.log(`[WhatsApp Flow] Suppressing intermediate response for ${senderPhone}, waiting for ${remaining} more uploads`);
      return { handled: true, collectedData: immediateResult.collectedData, sessionId: session.id, rejectedDuplicate: immediateResult.rejectedDuplicate };
    }

    if (this.batchResponseSent.has(lockKey)) {
      console.log(`[WhatsApp Flow] Response already sent for this batch (step advanced), suppressing debounce response for ${senderPhone}`);
      this.batchResponseSent.delete(lockKey);
      this.pendingUploadCount.delete(lockKey);
      this.uploadAckSent.delete(lockKey);
      this.batchAcceptedCounts.delete(lockKey);
      this.batchTotalProcessedCounts.delete(lockKey);
      this.batchPreExistingCompleted.delete(lockKey);
      return { handled: true, collectedData: immediateResult.collectedData, sessionId: session.id, rejectedDuplicate: immediateResult.rejectedDuplicate };
    }

    console.log(`[WhatsApp Flow] No more queued uploads for ${senderPhone}, starting ${this.UPLOAD_DEBOUNCE_MS}ms debounce wait for late arrivals`);
    const wasCancelled = await this.waitForMoreUploads(lockKey);

    if (wasCancelled) {
      console.log(`[WhatsApp Flow] Debounce cancelled for ${senderPhone} - new upload arrived, deferring response`);
      return { handled: true, collectedData: immediateResult.collectedData, sessionId: session.id, rejectedDuplicate: immediateResult.rejectedDuplicate };
    }

    console.log(`[WhatsApp Flow] Debounce complete for ${senderPhone}, sending consolidated response`);

    this.pendingUploadCount.delete(lockKey);
    this.uploadAckSent.delete(lockKey);

    // Architect-recommended single-upload short-circuit. When the batch processed exactly
    // ONE upload (no duplicates, no other parallel files), there is nothing to merge —
    // the regenerated response from processUploadInBatch is wasteful AND lossy under long
    // tier-2 extraction times because newlyCompletedTypes can drift to empty. Return the
    // immediateResult that handleDocumentResult already built (which includes the inline
    // extraction summary).
    //
    // Gate: require totalProcessed === 1, accepted === 1, and not a duplicate-rejection.
    // Mixed batches (e.g. 1 accepted + 1 duplicate) MUST go through the consolidator so the
    // duplicate-warning surface is preserved.
    const acceptedCount = this.batchAcceptedCounts.get(lockKey) || 0;
    const totalProcessed = this.batchTotalProcessedCounts.get(lockKey) || 0;
    if (
      totalProcessed === 1 &&
      acceptedCount === 1 &&
      !immediateResult.rejectedDuplicate &&
      immediateResult.handled &&
      immediateResult.response
    ) {
      console.log(`[WhatsApp Flow] Single-upload short-circuit for ${senderPhone} (totalProcessed=${totalProcessed}, accepted=${acceptedCount}) — using immediate response`);
      this.batchAcceptedCounts.delete(lockKey);
      this.batchTotalProcessedCounts.delete(lockKey);
      this.batchPreExistingCompleted.delete(lockKey);
      // Clear _pendingExtractionSummary here at the actual send point so it does not leak
      // into a future upload's session state. Use immediateResult.sessionId to avoid
      // writing against a stale session reference.
      if (immediateResult.collectedData?._pendingExtractionSummary) {
        delete immediateResult.collectedData._pendingExtractionSummary;
        const writeSessionId = immediateResult.sessionId || session.id;
        await this.updateSessionData(writeSessionId, immediateResult.collectedData);
      }
      return immediateResult;
    }

    const latestSession = await this.getActiveSession(businessAccountId, senderPhone);
    if (!latestSession) {
      this.batchAcceptedCounts.delete(lockKey);
      this.batchTotalProcessedCounts.delete(lockKey);
      this.batchPreExistingCompleted.delete(lockKey);
      return immediateResult;
    }

    const latestData = (latestSession.collectedData as Record<string, any>) || {};

    const confirmState = latestData._confirmationState as { phase?: string; docType?: string; pendingData?: Record<string, any>; fields?: any[] } | undefined;
    if (confirmState?.phase === 'awaiting_action' && confirmState.docType && confirmState.fields && confirmState.fields.length > 0) {
      console.log(`[WhatsApp Flow] Batch consolidation: confirmation pending for ${confirmState.docType} — sending confirmation buttons`);
      this.batchAcceptedCounts.delete(lockKey);
      this.batchTotalProcessedCounts.delete(lockKey);
      this.batchPreExistingCompleted.delete(lockKey);
      const summary = await this.buildConfirmationSummary(businessAccountId, confirmState.docType, confirmState.pendingData || {});
      const docLabel = confirmState.docType.replace(/_/g, " ").toUpperCase();
      return {
        handled: true,
        response: {
          type: "buttons",
          text: `${docLabel} received!\n\n${this.formatConfirmationMessage(summary)}`,
          buttons: [
            { id: "doc_confirm", title: "✅ Confirm" },
            { id: "doc_update", title: "✏️ Update" },
          ],
        },
        collectedData: latestData,
        sessionId: latestSession.id,
      };
    }

    const latestDocState = this.getDocumentState(latestData);
    const latestCollectedDocs = latestData._collectedDocuments || {};
    this.batchAcceptedCounts.delete(lockKey);
    this.batchTotalProcessedCounts.delete(lockKey);

    const preExisting = this.batchPreExistingCompleted.get(lockKey) || new Set<string>();
    this.batchPreExistingCompleted.delete(lockKey);
    const completedTypes: string[] = [];
    const newlyCompletedTypes: string[] = [];
    const duplicateTypes: { docType: string; docLabel: string; maskedNum: string }[] = [];
    for (const [dt, state] of Object.entries(latestDocState)) {
      if (state.status === 'complete') {
        completedTypes.push(dt);
        if (!preExisting.has(dt)) newlyCompletedTypes.push(dt);
      }
      if (state.status === 'duplicate' && state.dupInfo) {
        duplicateTypes.push({ docType: dt, docLabel: state.dupInfo.docLabel, maskedNum: state.dupInfo.maskedNum });
      }
    }
    const allRejected = duplicateTypes.length > 0 && newlyCompletedTypes.length === 0;

    const mismatchWarning: string | undefined = latestData._docMismatchWarning;
    if (mismatchWarning) {
      delete latestData._docMismatchWarning;
    }

    if (allRejected) {
      console.log(`[WhatsApp Flow] All documents in batch were rejected as duplicates — flagging rejectedDuplicate`);
    }
    const steps = await this.getFlowSteps(flowId);
    const currentStep = steps.find((s) =>
      s.stepKey === (latestData._adaptiveUploadStepKey || latestSession.currentStepKey)
    );

    if (!currentStep || currentStep.type !== "upload") {
      return immediateResult;
    }

    const options = currentStep.options as FlowStepOptions | null;
    const documentTypes = options?.documentTypes || [];
    const mandatoryDocs = documentTypes.filter((d: any) => d.isMandatory).map((d: any) => d.docType);
    const effectiveCompletedMandatory = mandatoryDocs.filter((d: string) => {
      const norm = d.toLowerCase().replace(/_card$/, '');
      return completedTypes.includes(norm) || (latestCollectedDocs[d]?.isValid !== false && latestCollectedDocs[d]);
    });
    const missingMandatory = mandatoryDocs.filter((d: string) => !effectiveCompletedMandatory.includes(d));

    const receivedNames = newlyCompletedTypes
      .map((docType: string) => {
        const docConfig = documentTypes.find((d: any) => d.docType === docType || d.docType.replace(/_card$/, '') === docType);
        return docConfig?.label || docType.replace(/_/g, " ").toUpperCase();
      })
      .join(", ");

    const docExtractionSummary = latestData._pendingExtractionSummary || '';
    delete latestData._pendingExtractionSummary;
    await this.updateSessionData(latestSession.id, latestData);

    if (missingMandatory.length === 0) {
      if (latestData._pendingPdfUrl) {
        console.log(`[WhatsApp Flow] All mandatory docs collected — now prompting for PDF password`);
        let promptText = '';
        if (receivedNames) {
          promptText = `${receivedNames} received!${docExtractionSummary ? '\n\n' + docExtractionSummary : ''} `;
        }
        promptText += "This PDF is password protected. Please type the password for this document, or tap Skip to continue without it.";
        return {
          handled: true,
          response: {
            type: "buttons",
            text: promptText,
            buttons: [{ id: "skip_pdf_password", title: "Skip" }],
          },
          collectedData: latestData,
          sessionId: latestSession.id,
        };
      }

      const adaptiveResumeStepKey = latestData._adaptiveResumeStepKey as string | undefined;
      const nextStepKey = adaptiveResumeStepKey || currentStep.defaultNextStep || this.getNextStepKey(currentStep.stepKey, steps);

      let confirmationPrefix = receivedNames ? `${receivedNames} received!${docExtractionSummary ? '\n\n' + docExtractionSummary : ''}\n\n` : '';
      if (mismatchWarning) {
        confirmationPrefix += `${mismatchWarning}\n\n`;
      }

      if (nextStepKey) {
        let resolvedNextKey = nextStepKey;
        let resolvedNextStep: WhatsappFlowStep | undefined = steps.find((s) => s.stepKey === resolvedNextKey);
        const textPreMsgs: Array<{ type: "text"; text: string }> = [];
        let textChain = 0;
        let uploadTextChainEnded = false;
        while (resolvedNextStep && this.isTextOnlyMessageStep(resolvedNextStep) && textChain++ < 10) {
          console.log(`[WhatsApp Flow] Auto-advancing past text-only step "${resolvedNextStep.stepKey}" after upload`);
          const msg = this.buildStepResponse(resolvedNextStep, latestData);
          if (msg?.text) textPreMsgs.push({ type: "text", text: msg.text });
          const chainKey = this.resolveNextStepKeyForChain(resolvedNextStep, steps);
          if (!chainKey || chainKey === resolvedNextKey) { uploadTextChainEnded = true; break; }
          resolvedNextKey = chainKey;
          resolvedNextStep = steps.find((s) => s.stepKey === resolvedNextKey);
        }
        if (!uploadTextChainEnded && resolvedNextStep) {
          delete latestData._adaptiveResumeStepKey;
          delete latestData._adaptiveUploadStepKey;
          await this.updateSessionData(latestSession.id, latestData);
          await this.updateSessionStep(latestSession.id, resolvedNextKey);
          const nextResponse = this.buildStepResponse(resolvedNextStep, latestData);
          if (nextResponse && confirmationPrefix && nextResponse.text) {
            nextResponse.text = confirmationPrefix + nextResponse.text;
          }
          return {
            handled: true,
            preMessages: textPreMsgs.length > 0 ? textPreMsgs : undefined,
            response: nextResponse,
            collectedData: latestData,
            sessionId: latestSession.id,
          };
        } else {
          await this.completeSession(latestSession.id, latestData);
          return {
            handled: true,
            flowCompleted: true,
            preMessages: textPreMsgs.length > 0 ? textPreMsgs : undefined,
            response: { type: "text", text: confirmationPrefix + (activeFlow.completionMessage || "Thank you! All documents have been received.") },
            collectedData: latestData,
            sessionId: latestSession.id,
          };
        }
      }
      // Safety net: handleDocumentResult returned without flowCompleted (e.g. enrichment-only path).
      // The primary fix lives in handleDocumentResult itself (final-step path, ~line 6170).
      console.log(`[WhatsApp Flow] processUploadInBatch safety-net path — completing session ${latestSession.id}`);
      await this.completeSession(latestSession.id, latestData);
      return {
        handled: true,
        response: { type: "text", text: confirmationPrefix + "Thank you! All documents have been received." },
        flowCompleted: true,
        collectedData: latestData,
        sessionId: latestSession.id,
      };
    }

    const hasPendingPdfInMemory = this.pendingPdfPasswordKeys.has(lockKey);
    if (latestData._pendingPdfUrl || hasPendingPdfInMemory) {
      console.log(`[WhatsApp Flow] Mandatory docs still missing but PDF password pending (db: ${!!latestData._pendingPdfUrl}, mem: ${hasPendingPdfInMemory}) — suppressing re-upload prompt, just confirming received docs`);
      if (receivedNames) {
        let pendingText = `${receivedNames} received!${docExtractionSummary ? '\n\n' + docExtractionSummary : ''}`;
        if (mismatchWarning) {
          pendingText += `\n\n${mismatchWarning}`;
        }
        return {
          handled: true,
          response: {
            type: "text",
            text: pendingText,
          },
          collectedData: latestData,
          sessionId: latestSession.id,
        };
      }
      return { handled: true, collectedData: latestData, sessionId: latestSession.id };
    }

    const notStartedLabels: string[] = [];
    const backSideMessages: string[] = [];
    for (const docType of missingMandatory) {
      const cfg = documentTypes.find((d: any) => d.docType === docType);
      const label = cfg?.label || docType.replace(/_/g, ' ');
      const norm = docType.toLowerCase().replace(/_card$/, '');
      const dState = latestDocState[norm];
      const sidePrompt = this.buildPartialDocSidePrompt(norm, dState, label);
      if (sidePrompt) {
        backSideMessages.push(sidePrompt);
      } else if (dState?.status === 'processing' && (dState as any).pages?.length >= 1) {
        backSideMessages.push(`Your ${label} was partially received. Please upload all pages clearly.`);
      } else {
        notStartedLabels.push(label);
      }
    }

    let responseText = '';
    if (mismatchWarning) {
      responseText = mismatchWarning;
    } else if (receivedNames) {
      responseText = `${receivedNames} received!${docExtractionSummary ? '\n\n' + docExtractionSummary : ''}`;
    } else if (docExtractionSummary) {
      // Guardrail: even if receivedNames came out empty (e.g. preExisting set/key drift after a
      // long tier-2 extraction), still surface the extraction summary the user is expecting.
      responseText = docExtractionSummary;
    }
    if (duplicateTypes.length > 0) {
      const rejectedLabels = duplicateTypes.map(dt => `${dt.docLabel} (${dt.maskedNum})`);
      responseText += `${responseText ? '\n\n' : ''}${rejectedLabels.join(", ")} already submitted in a previous application.`;
    }
    if (backSideMessages.length > 0) {
      responseText += `${responseText ? '\n\n' : ''}${backSideMessages.join('\n')}`;
    }
    if (notStartedLabels.length > 0 && backSideMessages.length === 0) {
      if (duplicateTypes.length > 0) {
        const duplicateDocLabels = duplicateTypes.map(dt => dt.docLabel);
        const duplicateMissing = notStartedLabels.filter(l => duplicateDocLabels.includes(l));
        const genuinelyMissing = notStartedLabels.filter(l => !duplicateDocLabels.includes(l));
        if (duplicateMissing.length > 0) {
          responseText += `${responseText ? '\n\n' : ''}*Please upload ${duplicateMissing.join(", ")} with a different number.*`;
        }
        if (genuinelyMissing.length > 0) {
          responseText += `${responseText ? '\n\n' : ''}*Please also upload: ${genuinelyMissing.join(", ")}.*`;
        }
      } else {
        responseText += `${responseText ? '\n\n' : ''}*Please upload: ${notStartedLabels.join(", ")}.*`;
      }
    }

    return {
      handled: true,
      rejectedDuplicate: allRejected,
      response: {
        type: "text",
        text: responseText,
      },
      collectedData: latestData,
      sessionId: latestSession.id,
    };
  }

  private async resolveConfirmationNeeded(
    businessAccountId: string,
    docTypeKey: string
  ): Promise<boolean> {
    try {
      const { documentTypeService: docTypeSvc } = await import("./documentTypeService");
      const normalizedKey = docTypeKey.toLowerCase().replace(/_card$/, '').replace(/_/g, '');
      const config =
        await docTypeSvc.getDocumentTypeByKey(businessAccountId, docTypeKey) ||
        await docTypeSvc.getDocumentTypeByKey(businessAccountId, normalizedKey);

      if (config?.confirmationRequired === "always") return true;
      if (config?.confirmationRequired === "never") return false;

      const { whatsappService } = await import("./whatsappService");
      const settings = await whatsappService.getSettings(businessAccountId);
      return settings?.docConfirmationEnabled === "true";
    } catch (err) {
      console.warn(`[WhatsApp Flow] Error resolving confirmation config for ${docTypeKey}:`, err);
      return false;
    }
  }

  private async buildConfirmationSummary(
    businessAccountId: string,
    docTypeKey: string,
    extractedData: Record<string, any>
  ): Promise<{ header: string; fields: { key: string; label: string; value: string }[]; footer: string }> {
    const { whatsappService } = await import("./whatsappService");
    const settings = await whatsappService.getSettings(businessAccountId);
    const header = settings?.docConfirmationHeader || "Please review the details extracted from your document:";
    const footer = settings?.docConfirmationFooter || "Are these details correct?";

    const { documentTypeService: docTypeSvc } = await import("./documentTypeService");
    const normalizedKey = docTypeKey.toLowerCase().replace(/_card$/, '').replace(/_/g, '');
    const config =
      await docTypeSvc.getDocumentTypeByKey(businessAccountId, docTypeKey) ||
      await docTypeSvc.getDocumentTypeByKey(businessAccountId, normalizedKey);

    const fields: { key: string; label: string; value: string }[] = [];

    if (config && config.extractionFields && config.extractionFields.length > 0) {
      for (const ef of config.extractionFields) {
        const val = extractedData[ef.key];
        if (val !== undefined && val !== null && String(val).trim()) {
          fields.push({ key: ef.key, label: ef.label, value: String(val).trim() });
        }
      }
    }

    return { header, fields, footer };
  }

  private formatConfirmationMessage(summary: { header: string; fields: { key: string; label: string; value: string }[]; footer: string }): string {
    const fieldLines = summary.fields.map((f, i) => `${i + 1}. ${f.label}: ${f.value}`);
    return `${summary.header}\n\n${fieldLines.join('\n')}\n\n${summary.footer}`;
  }

  private async handleConfirmationResponse(
    session: any,
    message: string,
    collectedData: Record<string, any>,
    flowId: string
  ): Promise<ProcessResult | null> {
    const confirmState = collectedData._confirmationState as {
      phase: string;
      docType: string;
      pendingData: Record<string, any>;
      fieldEdits: Record<string, string>;
      fields: { key: string; label: string; value: string }[];
      currentFieldIndex?: number;
    } | undefined;

    if (!confirmState) return null;
    const normalizedMsg = message.trim().toLowerCase();

    if (confirmState.phase === 'awaiting_action') {
      if (normalizedMsg === 'confirm' || normalizedMsg === 'yes' || normalizedMsg === '✅ confirm' || normalizedMsg === 'doc_confirm') {
        const mergedData = { ...confirmState.pendingData, ...confirmState.fieldEdits };
        console.log(`[WhatsApp Flow] Confirmation accepted for ${confirmState.docType}`);

        await this.autoFillDocumentFields(confirmState.docType, mergedData, collectedData, session.businessAccountId);

        delete collectedData._confirmationState;

        // Task #1 — instant cross-document verification (confirmation acceptance path).
        // Confirmation path delivers the warning via its own response channel, so
        // suppress the outbound message for implicating failures to avoid duplicates.
        const confirmInstant = await this.runInstantVerification(
          session, collectedData, confirmState.docType,
          { suppressImplicatingOutbound: true },
        );
        if (confirmInstant.rejectUploadedDoc) {
          const docLabel = confirmState.docType.replace(/_/g, ' ');
          console.log(`[WhatsApp Flow] Rejecting ${confirmState.docType} (post-confirmation) due to incremental verification failure`);
          if (collectedData._collectedDocuments) {
            delete collectedData._collectedDocuments[confirmState.docType];
          }
          const docState = this.getDocumentState(collectedData);
          const docTypeState = docState[confirmState.docType];
          if (docTypeState) {
            docTypeState.status = 'rejected' as any;
            docTypeState.pages = [];
            docTypeState.mergedData = {};
          }
          const warning =
            confirmInstant.rejectionWarning ||
            `The ${docLabel} you just confirmed does not match information from earlier documents. Please re-upload the correct document.`;
          collectedData._docMismatchWarning = warning;
          await this.updateSessionData(session.id, collectedData);
          return {
            handled: true,
            response: { type: "text" as const, text: warning },
            collectedData,
            sessionId: session.id,
          };
        }

        await this.updateSessionData(session.id, collectedData);

        // Task #1 — non-blocking warning surfaced inline so the customer still
        // sees the notice on the confirmation-acceptance path (which suppresses
        // the runInstantVerification outbound to avoid duplicates).
        const confirmedText = confirmInstant.implicatingWarning
          ? `Details confirmed! ✅\n\n${confirmInstant.implicatingWarning}`
          : "Details confirmed! ✅";

        const steps = await this.getFlowSteps(flowId);
        const currentStep = steps.find((s) =>
          s.stepKey === (collectedData._adaptiveUploadStepKey || session.currentStepKey)
        );
        if (!currentStep) return { handled: true, response: { type: "text", text: confirmedText }, sessionId: session.id };

        const options = currentStep.options as FlowStepOptions | null;
        const documentTypes = options?.documentTypes || [];
        const docState = this.getDocumentState(collectedData);
        const mandatoryDocs = documentTypes.filter((d: any) => d.isMandatory).map((d: any) => d.docType);
        const completedDocTypes = Object.keys(docState).filter(dt => docState[dt].status === 'complete');
        const collectedDocs = collectedData._collectedDocuments || {};
        const effectiveCompleted = mandatoryDocs.filter((d: string) => {
          const norm = d.toLowerCase().replace(/_card$/, '');
          return completedDocTypes.includes(norm) || (collectedDocs[d]?.isValid !== false && collectedDocs[d]);
        });
        const missingMandatory = mandatoryDocs.filter((d: string) => !effectiveCompleted.includes(d));

        if (missingMandatory.length === 0) {
          const activeFlow = await this.getActiveFlow(session.businessAccountId);
          const adaptiveResumeStepKey = collectedData._adaptiveResumeStepKey as string | undefined;
          const nextStepKey = adaptiveResumeStepKey || currentStep.defaultNextStep || this.getNextStepKey(currentStep.stepKey, steps);
          if (nextStepKey) {
            const nextStep = steps.find((s) => s.stepKey === nextStepKey);
            if (nextStep) {
              delete collectedData._adaptiveResumeStepKey;
              delete collectedData._adaptiveUploadStepKey;
              await this.updateSessionData(session.id, collectedData);
              await this.updateSessionStep(session.id, nextStepKey);
              return {
                handled: true,
                preMessages: [{ type: "text" as const, text: confirmedText }],
                response: this.buildStepResponse(nextStep, collectedData),
                collectedData,
                sessionId: session.id,
              };
            }
          }
          await this.completeSession(session.id, collectedData);
          return {
            handled: true,
            flowCompleted: true,
            preMessages: [{ type: "text" as const, text: confirmedText }],
            response: { type: "text", text: activeFlow?.completionMessage || "Thank you! All documents have been received." },
            collectedData,
            sessionId: session.id,
          };
        } else {
          const missingLabels = documentTypes
            .filter((d: any) => missingMandatory.includes(d.docType))
            .map((d: any) => d.label);
          return {
            handled: true,
            response: {
              type: "text",
              text: `${confirmedText} Please also upload: ${missingLabels.join(", ")}`,
            },
            collectedData,
            sessionId: session.id,
          };
        }
      }

      if (normalizedMsg === 'update' || normalizedMsg === 'edit' || normalizedMsg === '✏️ update' || normalizedMsg === 'doc_update') {
        confirmState.phase = 'selecting_field';
        const fieldList = confirmState.fields
          .map((f, i) => `${i + 1}. ${f.label}: ${f.value}`)
          .join('\n');
        await this.updateSessionData(session.id, collectedData);
        return {
          handled: true,
          response: {
            type: "text",
            text: `Which field would you like to update? Reply with the number:\n\n${fieldList}`,
          },
          sessionId: session.id,
        };
      }

      const summary = await this.buildConfirmationSummary(session.businessAccountId, confirmState.docType, { ...confirmState.pendingData, ...confirmState.fieldEdits });
      confirmState.fields = summary.fields;
      await this.updateSessionData(session.id, collectedData);
      return {
        handled: true,
        response: {
          type: "buttons",
          text: this.formatConfirmationMessage(summary),
          buttons: [
            { id: "doc_confirm", title: "✅ Confirm" },
            { id: "doc_update", title: "✏️ Update" },
          ],
        },
        sessionId: session.id,
      };
    }

    if (confirmState.phase === 'selecting_field') {
      const fieldIndex = parseInt(normalizedMsg) - 1;
      if (isNaN(fieldIndex) || fieldIndex < 0 || fieldIndex >= confirmState.fields.length) {
        return {
          handled: true,
          response: {
            type: "text",
            text: `Please enter a valid number between 1 and ${confirmState.fields.length}.`,
          },
          sessionId: session.id,
        };
      }

      confirmState.phase = 'entering_value';
      confirmState.currentFieldIndex = fieldIndex;
      const field = confirmState.fields[fieldIndex];
      await this.updateSessionData(session.id, collectedData);
      return {
        handled: true,
        response: {
          type: "text",
          text: `Enter the correct value for *${field.label}* (current: ${field.value}):`,
        },
        sessionId: session.id,
      };
    }

    if (confirmState.phase === 'entering_value') {
      const idx = confirmState.currentFieldIndex ?? 0;
      const field = confirmState.fields[idx];
      const newValue = message.trim();

      const { documentTypeService: docTypeSvc } = await import("./documentTypeService");
      const normalizedKey = confirmState.docType.toLowerCase().replace(/_card$/, '').replace(/_/g, '');
      const config =
        await docTypeSvc.getDocumentTypeByKey(session.businessAccountId, confirmState.docType) ||
        await docTypeSvc.getDocumentTypeByKey(session.businessAccountId, normalizedKey);
      if (config) {
        const fieldConfig = config.extractionFields.find(ef => ef.key === field.key);
        if (fieldConfig?.formatRegex) {
          try {
            const regex = new RegExp(fieldConfig.formatRegex);
            if (!regex.test(newValue)) {
              const desc = fieldConfig.formatDescription || `Must match format: ${fieldConfig.formatRegex}`;
              await this.updateSessionData(session.id, collectedData);
              return {
                handled: true,
                response: {
                  type: "text",
                  text: `Invalid format for *${field.label}*. ${desc}\n\nPlease enter the correct value:`,
                },
                sessionId: session.id,
              };
            }
          } catch (e) {
            console.warn(`[WhatsApp Flow] Invalid formatRegex for field ${field.key}:`, e);
          }
        }
      }

      confirmState.fieldEdits[field.key] = newValue;
      field.value = newValue;

      confirmState.phase = 'awaiting_action';
      delete confirmState.currentFieldIndex;

      const updatedData = { ...confirmState.pendingData, ...confirmState.fieldEdits };
      const docTypeState = this.getDocTypeState(collectedData, confirmState.docType);
      docTypeState.mergedData = { ...docTypeState.mergedData, ...confirmState.fieldEdits };

      const summary = await this.buildConfirmationSummary(session.businessAccountId, confirmState.docType, updatedData);
      confirmState.fields = summary.fields;
      await this.updateSessionData(session.id, collectedData);

      return {
        handled: true,
        response: {
          type: "buttons",
          text: `Updated! Here are the revised details:\n\n${this.formatConfirmationMessage(summary)}`,
          buttons: [
            { id: "doc_confirm", title: "✅ Confirm" },
            { id: "doc_update", title: "✏️ Update" },
          ],
        },
        sessionId: session.id,
      };
    }

    return null;
  }

  private async handleDocumentResult(
    session: any,
    flowId: string,
    result: any,
    collectedData: Record<string, any>,
    sourceMediaUrl?: string
  ): Promise<ProcessResult> {
    const { documentIdentificationService } = await import("./documentIdentificationService");
    const steps = await this.getFlowSteps(flowId);
    const currentStep = steps.find((s) =>
      s.stepKey === (collectedData._adaptiveUploadStepKey || session.currentStepKey)
    );
    if (!currentStep) {
      return { handled: false, shouldFallbackToAI: true };
    }

    const options = currentStep.options as FlowStepOptions | null;
    const documentTypes = options?.documentTypes || [];

    if (!result || result.documentType === "unknown") {
      const collectedDocKeys = Object.keys(collectedData._collectedDocuments || {});
      const collectedDocKeysNorm = collectedDocKeys.map((k: string) => k.toLowerCase().replace(/_card$/, ''));
      const remainingDocTypes = documentTypes.filter((d: any) => !collectedDocKeysNorm.includes(d.docType.toLowerCase().replace(/_card$/, '')));
      const labelsForPrompt = remainingDocTypes.length > 0
        ? remainingDocTypes.map((d: any) => d.label).filter(Boolean)
        : documentTypes.map((d: any) => d.label).filter(Boolean);
      const labelsText = labelsForPrompt.length > 0 ? labelsForPrompt.join(", ") : "the required document";
      const notes = result?.validationNotes;
      let rejectionText: string;
      if (notes && notes.length > 0) {
        rejectionText = `${notes}. Please upload a clear photo of: ${labelsText}`;
      } else {
        rejectionText = `This doesn't appear to be a ${labelsText}. Please upload a clear photo of the required document.`;
      }
      return {
        handled: true,
        response: { type: "text", text: rejectionText },
        sessionId: session.id,
      };
    }

    const expectedTypes = documentTypes.map((d: any) => d.docType);
    const { matches, matchedType } = await documentIdentificationService.validateDocumentType(result, expectedTypes);

    if (!matches || !matchedType) {
      const collectedDocs = collectedData._collectedDocuments || {};
      const collectedDocTypes = Object.keys(collectedDocs);
      const normCollectedRem = collectedDocTypes.map((k: string) => k.toLowerCase().replace(/_card$/, ''));
      const hasDocRem = (dt: string) => normCollectedRem.includes(dt.toLowerCase().replace(/_card$/, ''));
      const remainingDocs = documentTypes.filter((d: any) => !hasDocRem(d.docType));
      const expectedLabels = remainingDocs.length > 0
        ? remainingDocs.map((d: any) => d.label).filter(Boolean)
        : documentTypes.map((d: any) => d.label).filter(Boolean);
      const detectedName = result.documentType.replace(/_/g, " ");
      const expectedText = expectedLabels.length > 0
        ? expectedLabels.join(" or ")
        : "the required document";
      return {
        handled: true,
        response: {
          type: "text",
          text: `This looks like a ${detectedName}, but I need ${expectedText}. Please upload the correct document.`,
        },
        sessionId: session.id,
      };
    }

    const normalizedMatchedType = matchedType.toLowerCase().replace(/_card$/, '');
    const docTypeState = this.getDocTypeState(collectedData, normalizedMatchedType);

    if (docTypeState.status === 'complete') {
      console.log(`[WhatsApp Flow] Extra page for already-complete ${normalizedMatchedType} (side: ${result.side || 'unknown'}) — enriching`);
      const enrichSessionData = await db
        .select({ businessAccountId: whatsappFlowSessions.businessAccountId })
        .from(whatsappFlowSessions)
        .where(eq(whatsappFlowSessions.id, session.id))
        .limit(1);
      const enrichBusinessAccountId = enrichSessionData[0]?.businessAccountId;
      await this.enrichCompletedDocumentFromExtraPage(
        session,
        normalizedMatchedType,
        result,
        collectedData,
        enrichBusinessAccountId,
        sourceMediaUrl
      );
      return { handled: true, collectedData, sessionId: session.id };
    }

    const sessionData = await db
      .select({ businessAccountId: whatsappFlowSessions.businessAccountId })
      .from(whatsappFlowSessions)
      .where(eq(whatsappFlowSessions.id, session.id))
      .limit(1);

    const businessAccountId = sessionData[0]?.businessAccountId;
    const { documentTypeService: docTypeSvc } = await import("./documentTypeService");
    const docTypeConfig = businessAccountId
      ? await docTypeSvc.getDocumentTypeByKey(businessAccountId, normalizedMatchedType) ||
        await docTypeSvc.getDocumentTypeByKey(businessAccountId, matchedType)
      : undefined;

    const duplicateFieldKey = docTypeConfig?.validationRules?.duplicateField;
    const shouldDuplicateCheck = docTypeConfig?.validationRules?.duplicateCheck === true && !!duplicateFieldKey;

    const docNumber = shouldDuplicateCheck
      ? (result.extractedData?.[duplicateFieldKey] || result.extractedData?.documentNumber)
      : result.extractedData?.documentNumber;

    if (docTypeState.status === 'duplicate') {
      if (!docNumber) {
        console.log(`[WhatsApp Flow] Skipping page for ${normalizedMatchedType} — already duplicate and no new number on this page`);
        return { handled: true, collectedData, rejectedDuplicate: true, sessionId: session.id };
      }
      console.log(`[WhatsApp Flow] Resetting duplicate state for ${normalizedMatchedType} — new upload with number, will re-check`);
      docTypeState.status = 'processing';
      docTypeState.pages = [];
      docTypeState.mergedData = {};
      delete docTypeState.dupInfo;
    }

    docTypeState.status = 'processing';

    console.log(`[WhatsApp Flow] Duplicate check gate: matchedType="${matchedType}", normalizedMatchedType="${normalizedMatchedType}", docNumber="${docNumber || '(empty)'}", shouldDuplicateCheck=${shouldDuplicateCheck}, duplicateFieldKey="${duplicateFieldKey || '(none)'}"`);

    if (docNumber && shouldDuplicateCheck && businessAccountId) {
      const [cooldownRow] = await db
        .select({ newApplicationCooldownDays: whatsappSettings.newApplicationCooldownDays })
        .from(whatsappSettings)
        .where(eq(whatsappSettings.businessAccountId, businessAccountId))
        .limit(1);
      const cooldownDays = cooldownRow?.newApplicationCooldownDays ?? 7;
      const cutoffDate = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);

      const recentLeads = await db
        .select()
        .from(whatsappLeads)
        .where(
          and(
            eq(whatsappLeads.businessAccountId, businessAccountId),
            ne(whatsappLeads.status, 'message_only'),
            gte(whatsappLeads.createdAt, cutoffDate)
          )
        );

      const normalizeDocNum = (num: string) => num.replace(/[\s\-\.\/]+/g, '').toUpperCase();
      const normalizedDocNumber = normalizeDocNum(String(docNumber));
      const isAadhaarType = normalizedMatchedType === 'aadhaar' || matchedType === 'aadhaar_card';
      const aadhaarDigitsOnly = isAadhaarType ? normalizedDocNumber.replace(/\D/g, '') : '';

      const fuzzyAadhaarMatch = (a: string, b: string): boolean => {
        const aDigits = a.replace(/\D/g, '');
        const bDigits = b.replace(/\D/g, '');
        if (aDigits.length !== 12 || bDigits.length !== 12) return false;
        let diffCount = 0;
        for (let i = 0; i < 12; i++) {
          if (aDigits[i] !== bDigits[i]) diffCount++;
          if (diffCount > 2) return false;
        }
        return diffCount > 0;
      };

      const isDocMatch = (existingNum: string): boolean => {
        const normalized = normalizeDocNum(existingNum);
        if (normalized === normalizedDocNumber) return true;
        if (isAadhaarType && fuzzyAadhaarMatch(aadhaarDigitsOnly, normalized)) {
          console.log(`[WhatsApp Flow] Fuzzy Aadhaar match: ${normalizedDocNumber} vs ${normalized} (1-2 digit OCR difference)`);
          return true;
        }
        return false;
      };

      const dupFieldKey = duplicateFieldKey || 'documentNumber';
      const docTypeKeys = [matchedType, matchedType.replace('_card', ''), normalizedMatchedType];

      console.log(`[WhatsApp Flow] Duplicate check: searching ${recentLeads.length} recent leads for ${normalizedMatchedType} field "${dupFieldKey}"="${normalizedDocNumber}" (session: ${session.id}, cooldown: ${cooldownDays}d)`);
      const duplicateDoc = recentLeads.find(lead => {
        if (lead.flowSessionId === session.id) return false;
        const ed = (lead.extractedData as Record<string, any>) || {};

        const fieldValue = ed[dupFieldKey];
        if (fieldValue && isDocMatch(String(fieldValue))) {
          console.log(`[WhatsApp Flow] Duplicate check: flat field match found in lead ${lead.id} — ed["${dupFieldKey}"]="${fieldValue}"`);
          return true;
        }

        for (const typeKey of docTypeKeys) {
          const flatValue = ed[typeKey];
          if (flatValue && typeof flatValue === 'string' && isDocMatch(flatValue)) {
            console.log(`[WhatsApp Flow] Duplicate check: flat match found in lead ${lead.id} — ed["${typeKey}"]="${flatValue}"`);
            return true;
          }
        }

        const docStorages = [ed._documents, ed._collectedDocuments].filter(Boolean);
        let existingDoc: Record<string, any> | undefined;
        for (const docs of docStorages) {
          for (const typeKey of docTypeKeys) {
            if (docs[typeKey]) { existingDoc = docs[typeKey]; break; }
          }
          if (existingDoc) break;
        }
        if (!existingDoc) return false;

        const primaryNumber = existingDoc.extractedData?.[dupFieldKey] || existingDoc.extractedData?.documentNumber;
        if (primaryNumber && isDocMatch(String(primaryNumber))) {
          console.log(`[WhatsApp Flow] Duplicate check: doc match found in lead ${lead.id} — ${dupFieldKey}="${primaryNumber}"`);
          return true;
        }
        const additionalPhotos = existingDoc.additionalPhotos || [];
        return additionalPhotos.some((p: Record<string, any>) => {
          const photoNum = p.extractedData?.[dupFieldKey] || p.extractedData?.documentNumber;
          return photoNum && isDocMatch(String(photoNum));
        });
      });
      if (!duplicateDoc) {
        console.log(`[WhatsApp Flow] Duplicate check: no match found for ${normalizedMatchedType} "${normalizedDocNumber}" across ${recentLeads.length} leads`);
      }

      if (duplicateDoc) {
        const docLabel = docTypeConfig?.name || documentTypes.find((d: { docType: string; label: string }) => d.docType === matchedType)?.label || matchedType.replace(/_/g, ' ');
        // No PII masking — testing phase: show full doc number in logs and to user
        const fullNum = String(docNumber);
        console.log(`[WhatsApp Flow] Duplicate ${docLabel} detected: ${fullNum} already submitted by lead ${duplicateDoc.id}`);
        docTypeState.status = 'duplicate';
        docTypeState.dupInfo = { docLabel, maskedNum: fullNum, leadId: duplicateDoc.id };
        await this.updateSessionData(session.id, collectedData);
        return {
          handled: true,
          rejectedDuplicate: true,
          response: {
            type: "text",
            text: `${docLabel} (${fullNum}) was already submitted in a previous application. Please upload a ${docLabel} with a different number.`
          },
          sessionId: session.id,
        };
      }
    }

    let docNumberMismatched = false;
    if (docNumber && shouldDuplicateCheck) {
      const normalizeNum = (s: string) => s.replace(/[\s\-\.\/]+/g, '').toUpperCase();
      const normalizedExtracted = normalizeNum(String(docNumber));

      const dupFieldConfig = docTypeConfig?.extractionFields?.find(f => f.key === duplicateFieldKey);
      let fieldFormatRegex: RegExp | null = null;
      if (dupFieldConfig?.formatRegex) {
        try { fieldFormatRegex = new RegExp(dupFieldConfig.formatRegex); } catch (_) {}
      }

      const levenshtein = (a: string, b: string): number => {
        const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
          Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
        );
        for (let i = 1; i <= a.length; i++) {
          for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
              ? dp[i - 1][j - 1]
              : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
          }
        }
        return dp[a.length][b.length];
      };
      const OCR_TOLERANCE = 3;
      const docLabel = docTypeConfig?.name || matchedType.replace(/_/g, ' ');

      for (const [key, val] of Object.entries(collectedData)) {
        if (key.startsWith('_') || typeof val !== 'string') continue;
        const normalizedVal = normalizeNum(val);
        const valMatchesFormat = fieldFormatRegex
          ? fieldFormatRegex.test(normalizedVal)
          : normalizedVal.length === normalizedExtracted.length;
        if (valMatchesFormat && normalizedVal !== normalizedExtracted) {
          const dist = levenshtein(normalizedVal, normalizedExtracted);
          if (dist <= OCR_TOLERANCE) {
            console.log(`[WhatsApp Flow] OCR distance ${dist} between extracted ${docLabel} "${normalizedExtracted}" and session value "${normalizedVal}" — within tolerance, treating as match`);
          } else {
            docNumberMismatched = true;
            collectedData._docMismatchWarning = `⚠️ The ${docLabel} number on the uploaded document does not match the ${docLabel} you provided earlier. Please re-upload the correct ${docLabel} document.`;
            console.log(`[WhatsApp Flow] Document mismatch: extracted ${docLabel} "${normalizedExtracted}" does not match session value "${normalizedVal}" (distance: ${dist}, key: ${key})`);
          }
          break;
        }
      }
    }

    if (docNumberMismatched) {
      docTypeState.status = 'mismatched';
      await this.updateSessionData(session.id, collectedData);
      return {
        handled: true,
        response: {
          type: "text",
          text: collectedData._docMismatchWarning || 'Document number does not match. Please re-upload the correct document.',
        },
        sessionId: session.id,
      };
    }

    // PR2: Cross-page consistency check. Before accepting a new page, verify that any required
    // formatted identifier (e.g. aadhaar_number, pan_number) on this page agrees with the same
    // identifier on previously-accepted pages of the same docType. Mismatch = wrong page set →
    // reject this upload and ask for a consistent re-upload.
    if (docTypeConfig?.extractionFields?.length) {
      const primaryField = docTypeConfig.extractionFields.find((f: { required?: boolean; formatRegex?: string | null }) => !!f.required && !!f.formatRegex);
      if (primaryField) {
        const newRaw = result.extractedData?.[primaryField.key];
        if (newRaw !== null && newRaw !== undefined && String(newRaw).trim() !== '') {
          const norm = (s: any) => String(s).replace(/[\s-]/g, '').toUpperCase();
          const newNorm = norm(newRaw);
          for (const prevPage of docTypeState.pages) {
            const prevRaw = prevPage.extractedData?.[primaryField.key];
            if (prevRaw === null || prevRaw === undefined || String(prevRaw).trim() === '') continue;
            const prevNorm = norm(prevRaw);
            if (prevNorm !== newNorm) {
              console.log(`[WhatsApp Flow] Cross-page consistency FAIL for ${normalizedMatchedType}.${primaryField.key}: new page="${newNorm}" disagrees with prior page="${prevNorm}". Rejecting.`);
              return {
                handled: true,
                response: {
                  type: 'text',
                  text: `The ${docTypeConfig.name} number on this page (${newRaw}) does not match the number on the page you uploaded earlier (${prevRaw}). Please re-upload all pages of the same ${docTypeConfig.name}.`,
                },
                sessionId: session.id,
              };
            }
          }
        }
      }
    }

    // PR1+PR2: Final-tier validation failure → ask for re-upload immediately.
    // If the strict gpt-4o tier still couldn't read required fields cleanly, there's nothing left
    // to try — discard this page and prompt the user for a sharper re-upload.
    const finalFailures = (result._validationFailures || []).filter((f: { reason: string }) => f.reason === 'format');
    if (finalFailures.length > 0 && result._extractionTier === 'vision-strict-gpt4o') {
      const docLabel = docTypeConfig?.name || normalizedMatchedType.replace(/_/g, ' ');
      const failedFieldLabels = finalFailures.map((f: { field: string; label?: string }) => f.label || f.field).join(', ');
      console.log(`[WhatsApp Flow] Final-tier (vision-strict-gpt4o) validation failed for ${normalizedMatchedType}: ${failedFieldLabels} unreadable — requesting re-upload`);
      docTypeState.status = 'pending';
      await this.updateSessionData(session.id, collectedData);
      return {
        handled: true,
        response: {
          type: 'text',
          text: `I couldn't read your ${docLabel} clearly — the ${failedFieldLabels} field${finalFailures.length > 1 ? 's were' : ' was'} unreadable. Please re-upload a sharper, well-lit photo of your ${docLabel} (avoid glare, keep all text in focus).`,
        },
        sessionId: session.id,
      };
    }

    docTypeState.pages.push({
      side: result.side || 'front',
      extractedData: result.extractedData || {},
      confidence: result.confidence,
      sourceMediaUrl,
    });
    console.log(`[WhatsApp Flow] Page ${docTypeState.pages.length} extracted for ${normalizedMatchedType} (side: ${result.side || 'unknown'}, tier: ${result._extractionTier || 'legacy'}, fields: ${Object.keys(result.extractedData || {}).length})`);
    {
      const newData = result.extractedData || {};
      const merged = { ...docTypeState.mergedData };
      for (const [key, val] of Object.entries(newData)) {
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          merged[key] = val;
        }
      }
      docTypeState.mergedData = merged;
    }

    if (await this.isDocTypeComplete(docTypeState.mergedData, normalizedMatchedType, businessAccountId, docTypeState.pages.length)) {
      docTypeState.status = 'complete';
      console.log(`[WhatsApp Flow] Document ${normalizedMatchedType} marked complete (fields present)`);
      this.syncDocStateToCollectedDocs(collectedData, normalizedMatchedType, sourceMediaUrl);

      const needsConfirmation = await this.resolveConfirmationNeeded(businessAccountId, normalizedMatchedType);
      if (needsConfirmation) {
        console.log(`[WhatsApp Flow] Confirmation required for ${normalizedMatchedType} — deferring autoFill`);
        const summary = await this.buildConfirmationSummary(businessAccountId, normalizedMatchedType, docTypeState.mergedData);
        if (summary.fields.length > 0) {
          const extractionSummary = await this.buildExtractedFieldsSummary(normalizedMatchedType, result.extractedData || {}, businessAccountId);
          if (extractionSummary) {
            collectedData._pendingExtractionSummary =
              (collectedData._pendingExtractionSummary ? collectedData._pendingExtractionSummary + '\n\n' : '') +
              extractionSummary;
          }

          collectedData._confirmationState = {
            phase: 'awaiting_action',
            docType: normalizedMatchedType,
            pendingData: { ...docTypeState.mergedData },
            fieldEdits: {},
            fields: summary.fields,
          };
          delete collectedData._recoveryReminderSent;
          await this.updateSessionData(session.id, collectedData);

          const docLabel = result.documentType?.replace(/_/g, " ").toUpperCase() || 'Document';
          return {
            handled: true,
            response: {
              type: "buttons",
              text: `${docLabel} received!\n\n${this.formatConfirmationMessage(summary)}`,
              buttons: [
                { id: "doc_confirm", title: "✅ Confirm" },
                { id: "doc_update", title: "✏️ Update" },
              ],
            },
            collectedData,
            sessionId: session.id,
          };
        }
      }

      await this.autoFillDocumentFields(normalizedMatchedType, docTypeState.mergedData, collectedData, businessAccountId);
      delete collectedData._recoveryReminderSent;

      // Task #1 — instant cross-document verification. Runs all configured
      // cross_field/threshold/chronology rules whose docs are all present, and
      // rejects the just-uploaded doc if it's the one causing a mismatch.
      const instant = await this.runInstantVerification(session, collectedData, normalizedMatchedType);
      if (instant.rejectUploadedDoc) {
        const docLabel = normalizedMatchedType.replace(/_/g, ' ');
        console.log(`[WhatsApp Flow] Rejecting ${normalizedMatchedType} due to incremental verification failure`);
        docTypeState.status = 'rejected';
        docTypeState.pages = [];
        docTypeState.mergedData = {};
        if (collectedData._collectedDocuments) {
          delete collectedData._collectedDocuments[normalizedMatchedType];
        }
        collectedData._docMismatchWarning =
          instant.rejectionWarning ||
          `The ${docLabel} you just uploaded does not match information from earlier documents. Please re-upload the correct document.`;
        await this.updateSessionData(session.id, collectedData);
        return { handled: true, collectedData, sessionId: session.id };
      }
    } else {
      docTypeState.status = 'processing';
      console.log(`[WhatsApp Flow] Document ${normalizedMatchedType} still processing (missing key fields)`);
    }

    const summarySource = docTypeState.status === 'complete' ? docTypeState.mergedData : (result.extractedData || {});
    const singleExtractionSummary = await this.buildExtractedFieldsSummary(normalizedMatchedType, summarySource, businessAccountId);
    if (singleExtractionSummary) {
      collectedData._pendingExtractionSummary =
        (collectedData._pendingExtractionSummary ? collectedData._pendingExtractionSummary + '\n\n' : '') +
        singleExtractionSummary;
    }
    await this.updateSessionData(session.id, collectedData);

    const docState = this.getDocumentState(collectedData);
    const mandatoryDocs = documentTypes.filter((d: any) => d.isMandatory).map((d: any) => d.docType);
    const completedDocTypes = Object.keys(docState).filter(dt => docState[dt].status === 'complete');
    const collectedDocs = collectedData._collectedDocuments || {};
    const effectiveCompleted = mandatoryDocs.filter((d: string) => {
      const norm = d.toLowerCase().replace(/_card$/, '');
      return completedDocTypes.includes(norm) || (collectedDocs[d]?.isValid !== false && collectedDocs[d]);
    });
    const missingMandatory = mandatoryDocs.filter((d: string) => !effectiveCompleted.includes(d));

    if (missingMandatory.length === 0) {
      if (collectedData._pendingPdfUrl) {
        console.log(`[WhatsApp Flow] All mandatory docs collected — now prompting for PDF password`);
        const docLabel = result.documentType?.replace(/_/g, " ").toUpperCase() || 'Document';
        return {
          handled: true,
          response: {
            type: "buttons",
            text: `${docLabel} received! This PDF is password protected. Please type the password for this document, or tap Skip to continue without it.`,
            buttons: [{ id: "skip_pdf_password", title: "Skip" }],
          },
          collectedData,
          sessionId: session.id,
        };
      }

      const adaptiveResumeStepKey = collectedData._adaptiveResumeStepKey as string | undefined;
      const nextStepKey = adaptiveResumeStepKey || currentStep.defaultNextStep || this.getNextStepKey(currentStep.stepKey, steps);

      const justReceivedType = result.documentType ? result.documentType.toLowerCase().replace(/_card$/, '') : null;
      const justReceivedTypes = justReceivedType ? [justReceivedType] : [];
      const allReceivedLabels = justReceivedTypes
        .map((dt: string) => {
          const cfg = documentTypes.find((d: any) => d.docType === dt || d.docType.replace(/_card$/, '') === dt);
          return cfg?.label || dt.replace(/_/g, ' ');
        })
        .map((l: string) => l.charAt(0).toUpperCase() + l.slice(1));
      const pendingExtractionSummary = collectedData._pendingExtractionSummary || '';
      delete collectedData._pendingExtractionSummary;
      await this.updateSessionData(session.id, collectedData);
      const receivedConfirmationText = allReceivedLabels.length > 0
        ? allReceivedLabels.join(', ') + ' received!' + (pendingExtractionSummary ? '\n\n' + pendingExtractionSummary : '')
        : '';
      const confirmationPreMessage = receivedConfirmationText
        ? [{ type: "text" as const, text: receivedConfirmationText }]
        : [];

      if (nextStepKey) {
        let resolvedKey = nextStepKey;
        let resolvedStep: WhatsappFlowStep | undefined = steps.find((s) => s.stepKey === resolvedKey);
        let textChain2 = 0;
        let singleDocChainEnded = false;
        while (resolvedStep && this.isTextOnlyMessageStep(resolvedStep) && textChain2++ < 10) {
          console.log(`[WhatsApp Flow] Auto-advancing past text-only step "${resolvedStep.stepKey}" after single-doc upload`);
          const msg = this.buildStepResponse(resolvedStep, collectedData);
          if (msg?.text) confirmationPreMessage.push({ type: "text" as const, text: msg.text });
          const chainKey = this.resolveNextStepKeyForChain(resolvedStep, steps);
          if (!chainKey || chainKey === resolvedKey) { singleDocChainEnded = true; break; }
          resolvedKey = chainKey;
          resolvedStep = steps.find((s) => s.stepKey === resolvedKey);
        }
        if (!singleDocChainEnded && resolvedStep) {
          delete collectedData._adaptiveResumeStepKey;
          delete collectedData._adaptiveUploadStepKey;
          await this.updateSessionData(session.id, collectedData);
          await this.updateSessionStep(session.id, resolvedKey);
          const nextResponse = this.buildStepResponse(resolvedStep, collectedData);
          return {
            handled: true,
            preMessages: confirmationPreMessage,
            response: nextResponse,
            collectedData,
            sessionId: session.id,
          };
        } else {
          await this.completeSession(session.id, collectedData);
          return {
            handled: true,
            flowCompleted: true,
            preMessages: confirmationPreMessage,
            response: { type: "text", text: activeFlow.completionMessage || "Thank you! All documents have been received." },
            collectedData,
            sessionId: session.id,
          };
        }
      }

      console.log(`[WhatsApp Flow] All mandatory docs collected, no nextStepKey — completing session ${session.id} (handleDocumentResult final-step path)`);
      await this.completeSession(session.id, collectedData);
      return {
        handled: true,
        preMessages: confirmationPreMessage,
        response: { type: "text", text: "Thank you! All documents have been received." },
        flowCompleted: true,
        collectedData,
        sessionId: session.id,
      };
    } else {
      const missingLabels = documentTypes
        .filter((d: any) => missingMandatory.includes(d.docType))
        .map((d: any) => d.label);

      // Always include the per-doc extraction summary in the immediate response when this
      // doc is complete, so the user sees "Aadhaar Card received! Details extracted: ..."
      // alongside the next-doc prompt. The single-upload short-circuit in
      // handleDocumentResultBatched ensures this immediate response actually reaches the user.
      // We intentionally do NOT delete _pendingExtractionSummary here — for multi-upload
      // batches the debounced consolidator still needs it as a fallback.
      let receivedBlock = '';
      if (docTypeState.status === 'complete') {
        const docLabel = (documentTypes.find((d: any) => d.docType === normalizedMatchedType || d.docType.replace(/_card$/, '') === normalizedMatchedType)?.label)
          || result.documentType.replace(/_/g, " ").toUpperCase();
        const inlineSummary = await this.buildExtractedFieldsSummary(
          normalizedMatchedType,
          docTypeState.mergedData,
          businessAccountId
        );
        receivedBlock = inlineSummary
          ? `${docLabel} received!\n\n${inlineSummary}\n\n`
          : `${docLabel} received!\n\n`;
      } else if (docTypeState.status === 'processing') {
        // Partial doc (e.g. front of Aadhaar with number captured). Acknowledge what we got
        // so the user doesn't think the upload was rejected.
        const docLabel = (documentTypes.find((d: any) => d.docType === normalizedMatchedType || d.docType.replace(/_card$/, '') === normalizedMatchedType)?.label)
          || result.documentType.replace(/_/g, " ").toUpperCase();
        const inlineSummary = await this.buildExtractedFieldsSummary(
          normalizedMatchedType,
          docTypeState.mergedData,
          businessAccountId
        );
        receivedBlock = inlineSummary
          ? `${docLabel} received!\n\n${inlineSummary}\n\n`
          : `${docLabel} received!\n\n`;
      }

      // If the just-uploaded doc is a partial two-sided doc (e.g. Aadhaar front only), tell
      // the customer which side is still missing instead of the generic "Please also upload".
      const justUploadedLabel = (documentTypes.find((d: any) => d.docType === normalizedMatchedType || d.docType.replace(/_card$/, '') === normalizedMatchedType)?.label)
        || normalizedMatchedType.replace(/_/g, ' ');
      const sidePrompt = this.buildPartialDocSidePrompt(normalizedMatchedType, docTypeState, justUploadedLabel);

      let promptLine: string;
      if (sidePrompt) {
        // If other mandatory docs are also still missing (e.g. partial Aadhaar + PAN not uploaded),
        // append them after the side prompt so we don't silently drop the other asks.
        const justUploadedDocType = documentTypes.find((d: any) =>
          d.docType === normalizedMatchedType || d.docType.replace(/_card$/, '') === normalizedMatchedType
        )?.docType;
        const otherMissingLabels = documentTypes
          .filter((d: any) => missingMandatory.includes(d.docType) && d.docType !== justUploadedDocType)
          .map((d: any) => d.label);
        if (otherMissingLabels.length > 0) {
          promptLine = `*${sidePrompt}*\n\n*Also upload: ${otherMissingLabels.join(", ")}.*`;
        } else {
          promptLine = `*${sidePrompt}*`;
        }
      } else {
        promptLine = `*Please also upload: ${missingLabels.join(", ")}.*`;
      }

      return {
        handled: true,
        response: {
          type: "text",
          text: `${receivedBlock}${promptLine}`,
        },
        collectedData,
        sessionId: session.id,
      };
    }
  }

  private getNextStepKey(currentStepKey: string, steps: WhatsappFlowStep[]): string | null {
    const currentIndex = steps.findIndex(s => s.stepKey === currentStepKey);
    if (currentIndex >= 0) {
      for (let i = currentIndex + 1; i < steps.length; i++) {
        if (!(steps[i] as any).paused) {
          return steps[i].stepKey;
        }
      }
    }
    return null;
  }

  private getFirstActiveStep(steps: WhatsappFlowStep[]): WhatsappFlowStep | null {
    return steps.find(s => !(s as any).paused) || null;
  }

  async updateSessionData(sessionId: string, collectedData: Record<string, any>): Promise<void> {
    await db
      .update(whatsappFlowSessions)
      .set({ collectedData, lastMessageAt: new Date() })
      .where(eq(whatsappFlowSessions.id, sessionId));
  }

  private async updateSessionStep(sessionId: string, stepKey: string): Promise<void> {
    await db
      .update(whatsappFlowSessions)
      .set({ currentStepKey: stepKey, lastMessageAt: new Date() })
      .where(eq(whatsappFlowSessions.id, sessionId));
  }

  private recoveryInterval: NodeJS.Timeout | null = null;
  private readonly RECOVERY_INTERVAL_MS = 3 * 60 * 1000;
  private readonly STUCK_THRESHOLD_MS = 3 * 60 * 1000;

  startStuckJourneyRecovery(): void {
    if (this.recoveryInterval) return;
    this.recoveryInterval = setInterval(() => {
      this.checkAndRecoverStuckSessions().catch(err => {
        console.error("[FlowRecovery] Error in stuck journey recovery:", err);
      });
    }, this.RECOVERY_INTERVAL_MS);
    console.log("[FlowRecovery] Stuck journey recovery job started (every 3 minutes)");
  }

  private async checkAndRecoverStuckSessions(): Promise<void> {
    const stuckThreshold = new Date(Date.now() - this.STUCK_THRESHOLD_MS);
    const stuckSessions = await db
      .select()
      .from(whatsappFlowSessions)
      .where(
        and(
          eq(whatsappFlowSessions.status, "active"),
          sql`${whatsappFlowSessions.lastMessageAt} < ${stuckThreshold}`
        )
      );

    if (stuckSessions.length === 0) return;

    for (const session of stuckSessions) {
      try {
        await this.recoverStuckSession(session);
      } catch (err) {
        console.error(`[FlowRecovery] Failed to recover session ${session.id}:`, err);
      }
    }
  }

  private async recoverStuckSession(session: WhatsappFlowSession): Promise<void> {
    if (this.isUpdateFlowStep(session.currentStepKey)) {
      console.log(`[FlowRecovery] Skipping update flow session ${session.id} (step: ${session.currentStepKey})`);
      return;
    }
    const collectedData = (session.collectedData as Record<string, any>) || {};

    if (collectedData._recoveryReminderSent) {
      console.log(`[FlowRecovery] Skipping session ${session.id} — reminder already sent`);
      return;
    }

    if (collectedData._confirmationState?.phase === 'awaiting_action' || collectedData._confirmationState?.phase === 'selecting_field' || collectedData._confirmationState?.phase === 'entering_value') {
      console.log(`[FlowRecovery] Skipping session ${session.id} — pending document confirmation (phase: ${collectedData._confirmationState.phase})`);
      return;
    }

    const hasPendingPdf = !!collectedData._pendingPdfUrl;
    const collectedDocs = collectedData._collectedDocuments || {};
    const collectedDocKeys = Object.keys(collectedDocs);
    const effectiveCollectedDocKeys = collectedDocKeys.filter(
      (dt: string) => collectedDocs[dt]?.isValid !== false
    );

    const flow = await this.getActiveFlow(session.businessAccountId);
    if (!flow) return;

    const steps = await this.getFlowSteps(flow.id);
    const currentStep = steps.find(s => s.stepKey === session.currentStepKey);
    if (!currentStep || currentStep.type !== "upload") return;

    const options = currentStep.options as FlowStepOptions | null;
    const documentTypes = options?.documentTypes || [];
    const mandatoryDocs = documentTypes.filter((d: any) => d.isMandatory).map((d: any) => d.docType);
    const effectiveCollectedNorm = effectiveCollectedDocKeys.map((k: string) => k.toLowerCase().replace(/_card$/, ''));
    const missingMandatory = mandatoryDocs.filter((d: string) => !effectiveCollectedNorm.includes(d.toLowerCase().replace(/_card$/, '')));

    if (collectedDocKeys.length === 0) return;

    const hasPendingUploads = this.pendingUploadCount.has(`${session.businessAccountId}:${session.senderPhone}`);
    if (hasPendingUploads) return;

    console.log(`[FlowRecovery] Detected stuck upload session ${session.id} for ${session.senderPhone} — collected: [${collectedDocKeys.join(',')}], missing: [${missingMandatory.join(',')}], pendingPdf: ${hasPendingPdf}`);

    const { whatsappService } = await import("./whatsappService");
    const settings = await whatsappService.getSettings(session.businessAccountId);
    if (!settings?.msg91AuthKey || !settings?.msg91IntegratedNumberId) return;
    const { whatsappAutoReplyService } = await import("./whatsappAutoReplyService");

    if (missingMandatory.length === 0) {
      if (hasPendingPdf) {
        console.log(`[FlowRecovery] All mandatory docs present, prompting for PDF password`);
        await whatsappAutoReplyService.sendFlowResponse(
          settings,
          session.senderPhone,
          {
            type: "buttons",
            text: "This PDF is password protected. Please type the password for this document, or tap Skip to continue without it.",
            buttons: [{ id: "skip_pdf_password", title: "Skip" }],
          },
          session.id
        );
        await this.updateSessionData(session.id, collectedData);
      } else {
        console.log(`[FlowRecovery] All mandatory docs present, advancing to next step`);
        let recoveryNextKey = this.resolveNextStepKeyForChain(currentStep, steps);
        if (recoveryNextKey) {
          let recoveryStep: WhatsappFlowStep | undefined = steps.find(s => s.stepKey === recoveryNextKey);
          let recoveryChain = 0;
          let recoveryChainEnded = false;
          while (recoveryStep && this.isTextOnlyMessageStep(recoveryStep) && recoveryChain++ < 10) {
            console.log(`[FlowRecovery] Auto-advancing past text-only step "${recoveryStep.stepKey}"`);
            const msg = this.buildStepResponse(recoveryStep, collectedData);
            if (msg) {
              await whatsappAutoReplyService.sendFlowResponse(settings, session.senderPhone, msg, session.id);
            }
            const chainKey = this.resolveNextStepKeyForChain(recoveryStep, steps);
            if (!chainKey || chainKey === recoveryNextKey) { recoveryChainEnded = true; break; }
            recoveryNextKey = chainKey;
            recoveryStep = steps.find(s => s.stepKey === recoveryNextKey);
          }
          if (!recoveryChainEnded && recoveryStep) {
            await this.updateSessionStep(session.id, recoveryNextKey);
            const stepResponse = this.buildStepResponse(recoveryStep, collectedData);
            if (stepResponse) {
              await whatsappAutoReplyService.sendFlowResponse(settings, session.senderPhone, stepResponse, session.id);
            }
          } else {
            const transitioned = await this.finalizeSessionCompletion(session.id, collectedData);
            if (transitioned) {
              await whatsappAutoReplyService.sendFlowResponse(
                settings, session.senderPhone,
                { type: "text", text: "Thank you! All documents have been received." },
                session.id
              );
            }
          }
        } else {
          const transitioned = await this.finalizeSessionCompletion(session.id, collectedData);
          if (transitioned) {
            await whatsappAutoReplyService.sendFlowResponse(
              settings,
              session.senderPhone,
              { type: "text", text: "Thank you! All documents have been received." },
              session.id
            );
          }
        }
      }
    } else {
      if (hasPendingPdf) {
        const receivedNames = effectiveCollectedDocKeys
          .map(docType => {
            const docConfig = documentTypes.find((d: any) => d.docType === docType);
            return docConfig?.label || docType.replace(/_/g, " ");
          })
          .join(", ");
        console.log(`[FlowRecovery] Still missing docs but has pending PDF — prompting for password`);
        let promptText = '';
        if (receivedNames) {
          promptText = `${receivedNames} received! `;
        }
        promptText += "This PDF is password protected. Please type the password for this document, or tap Skip to continue without it.";
        await whatsappAutoReplyService.sendFlowResponse(
          settings,
          session.senderPhone,
          {
            type: "buttons",
            text: promptText,
            buttons: [{ id: "skip_pdf_password", title: "Skip" }],
          },
          session.id
        );
        await this.updateSessionData(session.id, collectedData);
      } else {
        const missingLabels = missingMandatory.map(d => {
          const docConfig = documentTypes.find((dt: any) => dt.docType === d);
          return docConfig?.label || d.replace(/_/g, " ");
        }).join(", ");
        console.log(`[FlowRecovery] Missing mandatory docs: ${missingLabels} — prompting user (one-time reminder)`);
        await whatsappAutoReplyService.sendFlowResponse(
          settings,
          session.senderPhone,
          { type: "text", text: `We're still waiting for: ${missingLabels}. Please upload the remaining documents.` },
          session.id
        );
        collectedData._recoveryReminderSent = true;
        await this.updateSessionData(session.id, collectedData);
      }
    }
  }
}

export const whatsappFlowService = new WhatsappFlowService();
whatsappFlowService.startStuckJourneyRecovery();
