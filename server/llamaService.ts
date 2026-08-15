import OpenAI from 'openai';
import { aiUsageLogger } from './services/aiUsageLogger';

// Using GPT-4o-mini for customer-facing chat to ensure reliable:
// - Language matching (English/Hindi/Hinglish)
// - Context understanding
// - Proper conversation flow
// GPT-4.1 nano was too limited and caused user frustration
const DEFAULT_MODEL = 'gpt-4o-mini';

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LeadField {
  id: string;
  enabled: boolean;
  required: boolean;
  priority: number;
  captureStrategy: 'start' | 'end' | 'smart' | 'custom' | 'intent' | 'keyword';
  customAskAfter?: number;
  intentIntensity?: 'low' | 'medium' | 'high';
  captureKeywords?: string[];
}

interface LeadTrainingConfig {
  fields: LeadField[];
  captureStrategy: string;
}

interface CollectedContactInfo {
  mobile?: string;
  phone?: string;
  email?: string;
  name?: string;
  whatsapp?: string;
}

// Blacklist of refusal/acknowledgment words that should NOT be treated as names
const REFUSAL_WORDS = [
  'no', 'nop', 'nope', 'nah', 'na', 'none', 'nothing', 'never',
  'why', 'what', 'when', 'where', 'who', 'how',
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'fine',
  'thanks', 'thank', 'ty', 'thx',
  'hi', 'hello', 'hey', 'hola', 'greetings', 'good',
  'bye', 'goodbye', 'later',
  'maybe', 'perhaps', 'dunno', 'idk',
  'stop', 'wait', 'hold',
  'there', 'here', 'help', 'please', 'can', 'you', 'me',
  'morning', 'afternoon', 'evening', 'night', 'day',
  'team', 'everyone', 'all', 'guys', 'folks', 'people',
  // Weekdays and time words
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'tomorrow', 'yesterday', 'tonight', 'now', 'soon', 'then',
  // Common adverbs and transitions
  'absolutely', 'definitely', 'certainly', 'indeed', 'however', 'meanwhile',
  'otherwise', 'therefore', 'furthermore', 'moreover', 'additionally'
];

// Helper function to validate if a potential name is legitimate
function isValidName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 50) return false;
  
  const nameLower = name.toLowerCase().trim();
  const words = nameLower.split(/\s+/);
  
  // Reject if any word is in refusal list
  if (words.some(word => REFUSAL_WORDS.includes(word))) {
    return false;
  }
  
  // Reject if it looks like a sentence (more than 3 words)
  if (words.length > 3) return false;
  
  // Reject if it contains numbers
  if (/\d/.test(name)) return false;
  
  return true;
}

// STAGE 1: Extract name using strict, high-precision regex patterns
function extractNameWithStrictRegex(conversationHistory: ConversationMessage[]): string | null {
  // Only the most explicit self-identification patterns
  const strictPatterns = [
    /(?:my name is|i am|i'm)\s+([a-z]+(?:\s+[a-z]+)*)/i,
    /(?:call me|name:|name\s+is)\s+([a-z]+(?:\s+[a-z]+)*)/i,
    /(?:^|hey|hi|hello)\s+(?:its|it's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i, // "hey its Abhishek" - requires greeting + capitalized name
  ];
  
  for (const message of conversationHistory) {
    if (message.role === 'user') {
      for (const pattern of strictPatterns) {
        const match = message.content.match(pattern);
        if (match && match[1] && isValidName(match[1])) {
          console.log(`[Name Extraction Stage 1] Strict regex matched: "${match[1]}"`);
          return match[1];
        }
      }
    }
  }
  
  return null;
}

// STAGE 2: Extract name from assistant's acknowledgements (echo detection)
// CONSERVATIVE: Only catches obvious greeting patterns to avoid false positives
// Ambiguous cases like "assist you, Abhishek!" are handled by Stage 3 LLM
function extractNameFromAssistantEcho(conversationHistory: ConversationMessage[]): string | null {
  // Check last 5 assistant messages (most recent first)
  const assistantMessages = conversationHistory
    .filter(m => m.role === 'assistant')
    .slice(-5)
    .reverse();
  
  for (const message of assistantMessages) {
    const content = message.content;
    
    // CONSERVATIVE PATTERN: Only direct greetings
    // Matches: "Hello Abhishek!", "Hi John!", "Hey Sarah 😊"
    // This is zero-risk - greetings are unambiguous name references
    const greetingPattern = /^(?:hello|hi|hey)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[!.?😊🎉👍✨💪🙌,\s]/i;
    const match = content.match(greetingPattern);
    if (match && match[1] && isValidName(match[1])) {
      console.log(`[Name Extraction Stage 2] Assistant greeting detected: "${match[1]}"`);
      return match[1];
    }
  }
  
  return null;
}

// STAGE 3: Extract name using LLM fallback for ambiguous cases
async function extractNameWithLLM(conversationHistory: ConversationMessage[], businessAccountId?: string): Promise<string | null> {
  try {
    // Get last 4 messages (including assistant context) to understand if user is responding to a name question
    const recentMessages = conversationHistory.slice(-4);
    
    // Format as conversation so LLM understands context
    const conversationContext = recentMessages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    
    if (!conversationContext) return null;
    
    // Resolve master AI settings first, fall back to business account key
    let apiKey: string | null = null;
    let provider = 'openai';
    let nameModel = 'gpt-4o-mini';
    const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

    const { storage } = await import('./storage');
    const master = await storage.getMasterAiSettings().catch(() => null);
    const useMaster = !!(master?.masterEnabled && master.primaryApiKey);

    if (useMaster) {
      apiKey = master!.primaryApiKey!;
      provider = master!.primaryProvider || 'openai';
      nameModel = master!.primaryModel || 'gpt-4o-mini';
      console.log(`[Name Extraction Stage 3] Using ${provider} key (master)`);
    } else if (businessAccountId) {
      try {
        const businessAccount = await storage.getBusinessAccount(businessAccountId);
        if (businessAccount?.openaiApiKey) {
          apiKey = businessAccount.openaiApiKey;
          console.log('[Name Extraction Stage 3] Using business account OpenAI key');
        }
      } catch (err) {
        console.warn('[Name Extraction Stage 3] Failed to get business account API key:', err);
      }
    }

    // Fall back to environment variables if no key resolved
    if (!apiKey) {
      apiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || null;
    }
    
    if (!apiKey) {
      console.error('[Name Extraction Stage 3] No API key available');
      return null;
    }
    
    const openaiClient = provider === 'gemini'
      ? new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL })
      : new OpenAI({ apiKey });
    
    const response = await openaiClient.chat.completions.create({
      model: nameModel,
      messages: [
        {
          role: 'system',
          content: `Extract the person's name from the conversation. 
          
Rules:
- If user introduces themselves (e.g., "hey its John", "I'm Sarah", "my name is X"), return ONLY the name
- IMPORTANT: If assistant asked for name and user responded with a single word/name, that IS their name
- Return just the name, nothing else (e.g., "John", "Sarah Smith", "Abhishek")
- If no clear name is found, respond with "NONE"
- Ignore greetings, questions, or casual phrases that aren't names

Examples:
Assistant: "May I have your name?" → User: "abhishek" → Response: "Abhishek"
Assistant: "What's your name?" → User: "John" → Response: "John"
User: "hey its Abhishek" → Response: "Abhishek"
User: "my name is John Smith" → Response: "John Smith"
User: "hi there" → Response: "NONE"
User: "can you help me" → Response: "NONE"`
        },
        {
          role: 'user',
          content: `Extract the name from this conversation:\n${conversationContext}`
        }
      ],
      temperature: 0.1,
      max_tokens: 20,
    });
    
    const extractedName = response.choices[0].message.content?.trim() || '';
    
    if (extractedName && extractedName !== 'NONE' && isValidName(extractedName)) {
      console.log(`[Name Extraction Stage 3] LLM extracted: "${extractedName}"`);
      return extractedName;
    }
    
    console.log(`[Name Extraction Stage 3] No valid name found (LLM returned: "${extractedName}")`);
    return null;
  } catch (error) {
    console.error('[Name Extraction Stage 3] LLM extraction failed:', error);
    return null;
  }
}

// Main hybrid extraction function - tries stages in order: strict regex → assistant echo → LLM fallback
async function extractCollectedContactInfo(conversationHistory: ConversationMessage[], businessAccountId?: string): Promise<CollectedContactInfo> {
  const collected: CollectedContactInfo = {};
  
  // Phone/mobile patterns
  const phonePattern = /(\+?\d[\d\s\-\(\)]{7,}\d)/g;
  // Email pattern
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  
  for (const message of conversationHistory) {
    if (message.role === 'user') {
      const content = message.content;
      
      // Check for phone/mobile
      const phones = content.match(phonePattern);
      if (phones && phones.length > 0) {
        collected.mobile = phones[0];
        collected.phone = phones[0];
        collected.whatsapp = phones[0];
      }
      
      // Check for email
      const emails = content.match(emailPattern);
      if (emails && emails.length > 0) {
        collected.email = emails[0];
      }
    }
  }
  
  // HYBRID NAME EXTRACTION PIPELINE
  // Stage 1: Try strict regex first (fastest, no API calls)
  let extractedName = extractNameWithStrictRegex(conversationHistory);
  
  // Stage 2: If strict regex failed, try assistant echo detection (free, no API calls)
  if (!extractedName) {
    extractedName = extractNameFromAssistantEcho(conversationHistory);
  }
  
  // Stage 3: If both failed, use LLM fallback (costs tokens but handles ambiguous cases)
  if (!extractedName) {
    extractedName = await extractNameWithLLM(conversationHistory, businessAccountId);
  }
  
  if (extractedName) {
    collected.name = extractedName;
  }
  
  return collected;
}


// Helper function to map field IDs to user-friendly display names
function getFieldDisplayName(fieldId: string): string {
  const fieldIdLower = fieldId.toLowerCase();
  switch (fieldIdLower) {
    case 'name':
      return 'full name';
    case 'whatsapp':
      return 'WhatsApp number';
    case 'mobile':
      return 'mobile number';
    case 'phone':
      return 'phone number';
    case 'email':
      return 'email address';
    default:
      return fieldId;
  }
}

// Helper function to build missing required fields list for final override
async function buildMissingRequiredFieldsMessage(
  leadTrainingConfig: LeadTrainingConfig | null | undefined,
  conversationHistory: ConversationMessage[],
  currentUserMessage?: string,
  existingLead?: { phone?: string | null; email?: string | null; name?: string | null } | null,
  businessAccountId?: string
): Promise<string> {
  if (!leadTrainingConfig || !leadTrainingConfig.fields || !Array.isArray(leadTrainingConfig.fields)) {
    return '';
  }
  
  // Get required fields with "start" timing (must collect before answering)
  const requiredStartFields = leadTrainingConfig.fields
    .filter(f => f.enabled && f.required && f.captureStrategy === 'start')
    .sort((a, b) => a.priority - b.priority);
  
  if (requiredStartFields.length === 0) {
    return '';
  }
  
  // Include current user message in the history for extraction
  // This ensures we catch contact info from the message being processed
  const historyWithCurrentMessage = currentUserMessage 
    ? [...conversationHistory, { role: 'user' as const, content: currentUserMessage }]
    : conversationHistory;
  
  // Extract what's already been collected from conversation (async pipeline)
  const collected = await extractCollectedContactInfo(historyWithCurrentMessage, businessAccountId);
  
  // CRITICAL: Merge with existing lead from database
  // This ensures we don't re-ask for info that was already captured via tool
  if (existingLead) {
    if (existingLead.phone && !collected.phone) {
      collected.phone = existingLead.phone;
      collected.mobile = existingLead.phone;
      collected.whatsapp = existingLead.phone;
    }
    if (existingLead.email && !collected.email) {
      collected.email = existingLead.email;
    }
    if (existingLead.name && !collected.name) {
      collected.name = existingLead.name;
    }
  }
  
  // IMPORTANT: phone/mobile/whatsapp are all satisfied by any phone number
  // If any phone-type field is collected, all phone-type fields are satisfied
  const hasAnyPhone = !!(collected.phone || collected.mobile || collected.whatsapp);
  
  // Build list of missing required fields with their priorities
  const missingFieldsWithPriority: Array<{id: string, priority: number}> = [];
  for (const field of requiredStartFields) {
    const fieldId = field.id.toLowerCase();
    
    // Check if this field has been collected
    // phone, mobile, and whatsapp are all satisfied by the same phone number
    if (fieldId === 'mobile' || fieldId === 'phone' || fieldId === 'whatsapp') {
      if (!hasAnyPhone) {
        missingFieldsWithPriority.push({id: field.id, priority: field.priority});
      }
    } else if (fieldId === 'email') {
      if (!collected.email) {
        missingFieldsWithPriority.push({id: field.id, priority: field.priority});
      }
    } else if (fieldId === 'name') {
      if (!collected.name) {
        missingFieldsWithPriority.push({id: field.id, priority: field.priority});
      }
    }
  }
  
  if (missingFieldsWithPriority.length === 0) {
    return '';
  }
  
  // Map field IDs to friendly display names for the prompt
  const missingFieldDisplayNames = missingFieldsWithPriority.map(f => getFieldDisplayName(f.id));
  const nextFieldDisplayName = getFieldDisplayName(missingFieldsWithPriority[0].id);
  
  return `
🚨 RULE #0 - REQUIRED CONTACT COLLECTION (ABSOLUTE HIGHEST PRIORITY):
- Required fields NOT YET collected: ${missingFieldDisplayNames.join(', ')}
- Next field to collect: ${nextFieldDisplayName}

🔒 MANDATORY ENFORCEMENT - NO EXCEPTIONS ALLOWED:
- YOU MUST COLLECT **ONLY** [${nextFieldDisplayName}] - DO NOT ASK FOR ANY OTHER FIELD
- DO NOT ask for multiple fields at once (e.g., "name and email")
- DO NOT say "How can I help you today?" until this field is collected
- DO NOT answer other questions until this field is collected  
- DO NOT move on to different topics
- DO NOT abandon this collection process for ANY reason
- STAY COMPLETELY FOCUSED on collecting this ONE field first

🚫 CRITICAL - DO NOT ASK FOR MULTIPLE FIELDS:
❌ WRONG: "May I also have your name and email?"
❌ WRONG: "Could you share your name and phone number?"
❌ WRONG: "Please provide your email and name"
✅ CORRECT: Ask for ONLY ${nextFieldDisplayName} using warm, varied phrasing — never repeat the same sentence.

HOW TO ASK NATURALLY:
1. Ask for ONLY ${nextFieldDisplayName} - DO NOT mention any other field
2. Be conversational and warm, not robotic
3. After they provide it, the system will tell you what to ask for next

IF USER ASKS "WHY" OR QUESTIONS THE REQUEST:
🔴 CRITICAL - THIS IS STILL A MANDATORY COLLECTION - DO NOT ABANDON:
- When user says "why", "why do you need this", "no", or questions the request
- Your TONE should be warm and understanding (not pushy or aggressive)
- BUT the COLLECTION IS STILL MANDATORY - you must NOT abandon it
- PROCESS:
  1. Briefly explain why you need their ${nextFieldDisplayName} (to provide better assistance)
  2. Keep your explanation friendly and understanding in TONE
  3. THEN immediately ask again for their ${nextFieldDisplayName}
  4. DO NOT say "How can I help you today?" - STAY on collecting this field
  5. DO NOT move to answering their original question
  6. STAY LOCKED on this ONE field until collected

EXAMPLE CORRECT BEHAVIOR:
- User: "why"
- You: [Briefly explain why you need their ${nextFieldDisplayName}, then ask again using warm, varied phrasing]
- ✅ CORRECT: Explained + Asked again + Stayed on field

EXAMPLE WRONG BEHAVIOR:
- User: "why"
- You: "Thanks for sharing! How can I help you today?"
- ❌ WRONG: Abandoned collection after user questioned it
`;
}

// Cache for parsed custom instructions (avoids re-parsing JSON on every request)
const customInstructionsCache = new Map<string, { instructions: string; timestamp: number }>();
const INSTRUCTIONS_CACHE_TTL = 60000; // 1 minute TTL

// Cache for pre-fetched FAQ results
const preFetchedFaqCache = new Map<string, { faqs: any[]; timestamp: number }>();
const FAQ_CACHE_TTL = 30000; // 30 second TTL for FAQ cache

// Helper function to extract search keywords from user message
function extractSearchKeywords(message: string): string[] {
  const stopWords = ['is', 'are', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'about', 'tell', 'me', 'what', 'who', 'how', 'why', 'when', 'where', 'can', 'you', 'i', 'do', 'does', 'have', 'has', 'please', 'help', 'want', 'need', 'know', 'like', 'would', 'could', 'should', 'will', 'more', 'some', 'any', 'your', 'my', 'their', 'its', 'this', 'that', 'these', 'those'];
  
  return message.toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^\w]/g, '')) // Strip punctuation
    .filter(word => word.length > 2 && !stopWords.includes(word));
}

// Helper function to check if message is a simple greeting (should skip FAQ pre-fetch)
function isSimpleGreetingMessage(message: string): boolean {
  const msgLower = message.toLowerCase().trim();
  // Only skip for actual greetings and goodbyes - NOT acknowledgments like ok/yes/sure/hmm
  // Acknowledgments need FAQ context because the user may be continuing a conversation
  const greetingPatterns = [
    'hi', 'hey', 'hello', 'hii', 'hiii', 'heyyy', 'heyy', 'yo', 'sup', 'wassup',
    'bye', 'goodbye', 'see you', 'later', 'cya'
  ];
  return greetingPatterns.includes(msgLower);
}

// Server-side FAQ pre-fetch function - uses VECTOR SIMILARITY SEARCH for semantic matching
async function preFetchFaqs(
  userMessage: string,
  businessAccountId: string
): Promise<{ faqs: any[]; searchQuery: string } | null> {
  // Skip for simple greetings
  if (isSimpleGreetingMessage(userMessage)) {
    console.log('[FAQ Vector Search] Skipping - simple greeting detected');
    return null;
  }
  
  // Check cache first
  const cacheKey = `${businessAccountId}_${userMessage.toLowerCase().trim()}`;
  const cached = preFetchedFaqCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < FAQ_CACHE_TTL) {
    console.log('[FAQ Vector Search] Cache HIT');
    return { faqs: cached.faqs, searchQuery: userMessage };
  }
  
  try {
    const { faqEmbeddingService } = await import('./services/faqEmbeddingService');
    
    // Use vector similarity search - top 3 FAQs with 0.4 similarity threshold
    const vectorResults = await faqEmbeddingService.searchFAQs(
      userMessage,
      businessAccountId,
      3, // Top 3 most relevant (reduced from 5)
      0.4 // 40% similarity threshold (lower = more results)
    );
    
    if (vectorResults.length === 0) {
      console.log('[FAQ Vector Search] No semantically similar FAQs found');
      // Fall back to keyword search if no vector results
      return await keywordFallbackFaqSearch(userMessage, businessAccountId);
    }
    
    const matchedFaqs = vectorResults.map(result => ({
      question: result.question,
      answer: result.answer,
      category: result.category,
      similarity: result.similarity
    }));
    
    // Cache the result
    preFetchedFaqCache.set(cacheKey, { faqs: matchedFaqs, timestamp: Date.now() });
    
    console.log(`[FAQ Vector Search] Found ${matchedFaqs.length} relevant FAQs (similarity: ${matchedFaqs.map(f => (f.similarity * 100).toFixed(0) + '%').join(', ')})`);
    
    return { faqs: matchedFaqs, searchQuery: userMessage };
  } catch (error) {
    console.error('[FAQ Vector Search] Error:', error);
    // Fall back to keyword search on error
    return await keywordFallbackFaqSearch(userMessage, businessAccountId);
  }
}

// High-priority domain keywords that must match for FAQ to be considered relevant
const HIGH_PRIORITY_KEYWORDS = new Set([
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

// Low-priority generic keywords that shouldn't be strong signals
const LOW_PRIORITY_KEYWORDS = new Set([
  'structure', 'system', 'program', 'programme', 'course',
  'information', 'details', 'about', 'regarding', 'related',
  'yearly', 'monthly', 'annual', 'total', 'complete', 'process'
]);

// Get keyword weight for FAQ matching
function getKeywordWeight(keyword: string): number {
  if (HIGH_PRIORITY_KEYWORDS.has(keyword)) return 10; // High-signal domain terms
  if (LOW_PRIORITY_KEYWORDS.has(keyword)) return 1;   // Low-signal generic terms
  return 3; // Default weight for unknown terms
}

// Keyword fallback for FAQs without embeddings
async function keywordFallbackFaqSearch(
  userMessage: string,
  businessAccountId: string
): Promise<{ faqs: any[]; searchQuery: string } | null> {
  try {
    const { storage } = await import('./storage');
    const businessFaqs = await storage.getAllFaqs(businessAccountId);
    
    if (!businessFaqs || businessFaqs.length === 0) {
      return null;
    }
    
    const searchKeywords = extractSearchKeywords(userMessage);
    if (searchKeywords.length === 0) {
      return null;
    }
    
    const searchLower = userMessage.toLowerCase();
    
    // Identify high-priority keywords in the user's query
    const userHighPriorityKeywords = searchKeywords.filter(k => HIGH_PRIORITY_KEYWORDS.has(k));
    
    const faqsWithScores = businessFaqs.map(f => {
      const questionLower = f.question.toLowerCase();
      const answerLower = f.answer.toLowerCase();
      const faqText = `${questionLower} ${answerLower}`;
      let score = 0;
      
      // Full match bonus
      if (questionLower.includes(searchLower)) score += 100;
      
      // Weighted keyword matching
      for (const keyword of searchKeywords) {
        const weight = getKeywordWeight(keyword);
        if (questionLower.includes(keyword)) {
          score += weight * 3; // Question matches are 3x more important
        }
        if (answerLower.includes(keyword)) {
          score += weight;
        }
      }
      
      // PENALTY: If user asked for a high-priority term but FAQ doesn't contain it
      // E.g., user asks about "fee" but FAQ is about "duration" - heavy penalty
      for (const highPriorityKeyword of userHighPriorityKeywords) {
        if (!faqText.includes(highPriorityKeyword)) {
          score -= 15; // Penalty for missing high-priority keyword
        }
      }
      
      return { faq: f, score };
    });
    
    const matchedFaqs = faqsWithScores
      .filter(item => item.score > 0) // Only include FAQs with positive score
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(item => ({
        question: item.faq.question,
        answer: item.faq.answer,
        category: item.faq.category
      }));
    
    if (matchedFaqs.length > 0) {
      console.log(`[FAQ Keyword Fallback] Found ${matchedFaqs.length} FAQs`);
    }
    
    return matchedFaqs.length > 0 ? { faqs: matchedFaqs, searchQuery: userMessage } : null;
  } catch (error) {
    console.error('[FAQ Keyword Fallback] Error:', error);
    return null;
  }
}

// Format pre-fetched FAQs for injection into context
function formatPreFetchedFaqs(faqs: any[]): string {
  if (!faqs || faqs.length === 0) return '';
  
  const formatted = faqs.map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`).join('\n\n');
  
  return `
📚 PRE-LOADED FAQ KNOWLEDGE (USE THIS FIRST):
The following FAQs are relevant to the user's question. Use this information to answer directly - NO NEED to call get_faqs tool.

${formatted}

✅ INSTRUCTION: Answer using the FAQ information above. Only call get_faqs if you need ADDITIONAL information not covered here.
`;
}

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

export class LlamaService {
  // Cache master AI settings for 30s to avoid repeated DB queries (called 4-5x per message)
  private masterConfigCache: {
    key: string;
    result: { openai: OpenAI; model: string; provider: string; useMaster: boolean };
    expires: number;
  } | null = null;

  private async getOpenAIClient(apiKey?: string): Promise<OpenAI> {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('No OpenAI API key available. Please configure your API key in Settings.');
    }
    return new OpenAI({ apiKey: key });
  }

  private getProviderClient(provider: string, apiKey: string): OpenAI {
    if (provider === 'gemini') {
      return new OpenAI({ apiKey, baseURL: GEMINI_BASE_URL });
    }
    return new OpenAI({ apiKey });
  }

  // Gemini 2.5+ are "thinking" models — they reject temperature != 1 with a 400 error.
  // Omitting temperature entirely lets the API use its default (1), which is safe for all models.
  private isThinkingModel(model: string): boolean {
    return /gemini-2\.[5-9]|gemini-[3-9]\./i.test(model);
  }

  private async resolveMasterConfig(fallbackApiKey?: string): Promise<{
    openai: OpenAI;
    model: string;
    provider: string;
    useMaster: boolean;
  }> {
    const cacheKey = fallbackApiKey || '__master__';
    const now = Date.now();
    if (this.masterConfigCache && this.masterConfigCache.key === cacheKey && this.masterConfigCache.expires > now) {
      return this.masterConfigCache.result;
    }

    const { storage } = await import('./storage');
    const masterSettings = await storage.getMasterAiSettings().catch(() => null);
    const useMaster = !!(masterSettings?.masterEnabled && masterSettings.primaryApiKey);
    const provider = useMaster ? (masterSettings!.primaryProvider || 'openai') : 'openai';
    const model = useMaster ? (masterSettings!.primaryModel || DEFAULT_MODEL) : DEFAULT_MODEL;
    const effectiveApiKey = useMaster
      ? masterSettings!.primaryApiKey!
      : (fallbackApiKey || process.env.OPENAI_API_KEY || '');
    if (!effectiveApiKey) {
      throw new Error('No AI API key available. Please configure a key in Settings or Master AI Settings.');
    }
    console.log(`[LlamaService] provider=${provider} model=${model} master=${useMaster}`);
    const result = { openai: this.getProviderClient(provider, effectiveApiKey), model, provider, useMaster };
    this.masterConfigCache = { key: cacheKey, result, expires: now + 30_000 };
    return result;
  }

  private async callWithFallback<T>(
    primaryFn: (client: OpenAI, model: string) => Promise<T>,
    primaryApiKey: string,
    primaryProvider: string,
    primaryModel: string
  ): Promise<T> {
    try {
      const client = this.getProviderClient(primaryProvider, primaryApiKey);
      return await primaryFn(client, primaryModel);
    } catch (err: any) {
      const isRetryable = err?.status === 401 || err?.status === 429 || err?.status === 503 || err?.status === 500;
      if (!isRetryable) throw err;
      try {
        const { storage } = await import('./storage');
        const masterSettings = await storage.getMasterAiSettings();
        if (masterSettings?.fallbackEnabled && masterSettings.fallbackApiKey) {
          const fallbackProvider = masterSettings.fallbackProvider || 'gemini';
          console.warn(`[AI Fallback] Primary (${primaryProvider}) failed (${err?.status}), retrying with ${fallbackProvider}`);
          const fallbackClient = this.getProviderClient(fallbackProvider, masterSettings.fallbackApiKey);
          const fallbackModel = masterSettings.fallbackModel || 'gemini-1.5-flash';
          return await primaryFn(fallbackClient, fallbackModel);
        }
      } catch (fallbackErr: any) {
        console.error('[AI Fallback] Fallback also failed:', fallbackErr?.message);
        throw err; // throw original error so client sees the root cause
      }
      throw err;
    }
  }


  /**
   * Decide tool_choice for a model call. When `forcedFirstToolName` is set and
   * that tool is actually present, force that specific function (not 'required')
   * so the model can't co-select a different tool (e.g. capture_lead) and skip
   * the intended grounding call. Used to guarantee curriculum-grounded answers
   * for content-only K12. Only applied on the FIRST turn — the continue/second
   * turn omits tool_choice so the model can write its text answer.
   */
  private resolveToolChoice(tools: any[], forcedFirstToolName?: string): any {
    if (tools.length === 0) return undefined;
    if (forcedFirstToolName && tools.some((t: any) => t?.function?.name === forcedFirstToolName)) {
      return { type: 'function', function: { name: forcedFirstToolName } };
    }
    return 'auto';
  }

  async generateToolAwareResponse(
    userMessage: string,
    tools: any[],
    conversationHistory: ConversationMessage[] = [],
    systemContext: string = '',
    personality: string = 'friendly',
    apiKey?: string,
    businessAccountId?: string,
    hasProducts: boolean = false,
    responseLength: string = 'balanced',
    phoneValidationOverride?: string,
    forcedFirstToolName?: string
  ) {
    const { storage } = await import('./storage');
    const masterSettings = await storage.getMasterAiSettings().catch(() => null);
    const useMaster = masterSettings?.masterEnabled && masterSettings.primaryApiKey;
    const primaryProvider = useMaster ? (masterSettings!.primaryProvider || 'openai') : 'openai';
    const primaryModel = useMaster ? (masterSettings!.primaryModel || DEFAULT_MODEL) : DEFAULT_MODEL;
    const effectiveApiKey = useMaster ? masterSettings!.primaryApiKey! : (apiKey || process.env.OPENAI_API_KEY || '');
    const openai = this.getProviderClient(primaryProvider, effectiveApiKey) as OpenAI;

    const currentDate = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });
    const currentTime = new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', minute: '2-digit' 
    });

    const personalityTraits = this.getPersonalityTraits(personality);
    const responseLengthInstruction = this.getResponseLengthInstruction(responseLength);

    const estimatedMessageCount = Math.floor(conversationHistory.length / 2) + 1;
    const systemPrompt = `YOU ARE AI CHRONEY — AN AUTONOMOUS SALES AGENT FOR THIS BUSINESS
${this.getAutonomousAgentInstructions(estimatedMessageCount)}
==============================
LAYER 0: RESPONSE LENGTH (ALWAYS FOLLOW)
==============================
${responseLengthInstruction}

==============================
LAYER 1: CONVERSATION SAFETY & INPUT HANDLING (PRIORITY 0)
==============================

1. INCOMPLETE INPUT HANDLING
If the user message is incomplete, cut off, or not a full question
(e.g. "do you have", "can you", "about", "tell me"):
- Ask the user to complete their question.
- Do NOT call any tool.
- Do NOT ask for contact info.

3. AMBIGUOUS INPUT HANDLING
If the message has multiple possible meanings:
- Ask ONE clarifying question.
- Do NOT call any tool.
- Do NOT ask for contact info.

4. GIBBERISH / DISMISSIVE HANDLING
- Gibberish (e.g. "asdfgh", "qwerty"): Ask the user to rephrase.
- Dismissive responses ("no", "nothing", "nevermind"):
  - Acknowledge politely.
  - Do NOT push lead capture — UNLESS a MANDATORY/REQUIRED contact field is still pending. If so, you MUST keep asking for it politely.
  - Do NOT call tools.

5. GREETINGS & SMALL TALK
For greetings or casual replies ("hi", "ok", "thanks"):
- Respond naturally.
- Do NOT call tools.
- Do NOT ask for contact info.

==============================
LAYER 2: INTENT CLASSIFICATION & ROUTING (PRIORITY 1)
==============================

Classify user intent into ONE category before any business action:

1. Informational (FAQ-like)
   - Fees, process, eligibility, policies

2. Product Exploration
   - Browsing, availability, comparison

3. Appointment Intent
   - Booking, scheduling, demo, visit

4. Sales / Lead Intent
   - Pricing interest, purchase signals, contact requests

5. Conversation Warm-up
   - User exploring or unsure

Rules:
- If intent is still unclear → ask a clarifying question.
- Do NOT call any tool unless intent is clearly classified.
- Do NOT ask for contact info unless intent supports it.

==============================
LAYER 3: BUSINESS EXECUTION & TOOLS (PRIORITY 2)
==============================

GLOBAL BUSINESS RULES:
- ONLY use business-specific information.
- NEVER use world or general knowledge.
- NEVER hallucinate prices, fees, policies, or product details.

If information is not available in your knowledge base:
- Start your response EXACTLY with the marker: [[FALLBACK]]
- After the marker, write a brief 1-sentence acknowledgment.
- The [[FALLBACK]] marker signals that you cannot answer from your business knowledge.
- Do NOT add follow-ups, suggestions, or redirects.
- Do NOT push services or lead capture.

PERSONALITY:
${personalityTraits}

CURRENT CONTEXT:
- Date: ${currentDate}
- Time: ${currentTime}
${systemContext ? `\n${systemContext}` : ''}

------------------------------
FAQ HANDLING
------------------------------
Call get_faqs ONLY IF:
- The question is complete.
- Intent is Informational.
- The answer is likely in FAQs.

DO NOT call get_faqs for:
- Greetings
- Small talk
- Partial or ambiguous messages

------------------------------
PRODUCT HANDLING
------------------------------
- Use get_products for product exploration.
- Products display as visual cards automatically.
- When products are found: Write a brief, friendly 1-2 sentence reply in the user's language. Do NOT list products in text — cards display automatically. NEVER say "products will be displayed below", "cards will appear", or any similar UI-referencing phrase.
- If no products found: Apologize naturally in the user's language.
- NEVER write product names, prices, or URLs in text.

------------------------------
APPOINTMENT BOOKING FLOW
------------------------------
1. Call list_available_slots.
2. User selects a slot.
3. Ask for name + phone number.
4. Call book_appointment.
- DO NOT use capture_lead for appointments.

------------------------------
LEAD CAPTURE FLOW
------------------------------
- Capture contact info ONLY WHEN:
  - User provides it voluntarily, OR
  - Buying intent is detected.

- Progressive enrichment is allowed.
- Validation rules:
  - Phone: 8–12 digits only.
  - Email: must contain '@'.
  - Name: only after you ask for it.

- Contact info is REQUIRED before conversion actions, NOT before normal answers.

------------------------------
CONVERSATION BEST PRACTICES
------------------------------
- Check conversation history before asking for any info.
- Extract contact info proactively if user mentions it.
- Acknowledge what users share before asking for more.
- Follow through on your questions - if you offer more details, deliver them.
- NEVER mention FAQs, tools, databases, or internal systems.
- Present information naturally as your own knowledge

==============================
FINAL OVERRIDE RULES (READ LAST - HIGHEST PRIORITY)
==============================

⚠️ BREVITY IS MANDATORY:
- Keep responses SHORT — max 3-4 lines total. Write conversationally.
- Bullet points are OK for listing 3-4 items, but keep each bullet to ONE short line (5-8 words max).
- NEVER write long paragraphs or detailed explanations unless user asks for "details", "steps", or "explain more".
- SUMMARIZE information in your own words — do NOT copy/paste FAQ answers verbatim.
- For multi-step topics: summarize briefly, then ask "Want me to go into detail?"

OTHER RULES:
1. Conversation safety > intent > business goals.
2. Language matching is mandatory.
3. Products render as cards — write a brief natural acknowledgment (1-2 sentences), never list them in text. Do NOT reference the UI or cards in your reply.
4. NEVER mention internal terms (FAQ, database, tools, RAG).
5. Business-only knowledge at all times.
6. Anti-hallucination is absolute.
7. Maintain natural, human conversation style.
8. AUTONOMOUS AGENT: You are a sales agent, not a passive bot. Always move conversations forward strategically.

${this.getJourneyGuidance()}`;

    // Extract RAG context from systemContext if present and inject into final override
    let ragContextForOverride = '';
    const ragMarker = '🔒 CRITICAL DOCUMENT KNOWLEDGE';
    if (systemContext.includes(ragMarker)) {
      const ragStartIndex = systemContext.indexOf(ragMarker);
      if (ragStartIndex !== -1) {
        const endMarker = 'Do NOT say "I don\'t have information" when the answer is clearly in the excerpts above';
        const endMarkerIndex = systemContext.indexOf(endMarker, ragStartIndex);
        
        let ragEndIndex;
        if (endMarkerIndex !== -1) {
          ragEndIndex = systemContext.indexOf('\n\n', endMarkerIndex + endMarker.length);
          if (ragEndIndex === -1) {
            ragEndIndex = systemContext.length;
          } else {
            ragEndIndex += 2;
          }
        } else {
          const nextSection = systemContext.indexOf('\n\n---', ragStartIndex);
          ragEndIndex = nextSection !== -1 ? nextSection : systemContext.length;
        }
        
        ragContextForOverride = '\n' + systemContext.substring(ragStartIndex, ragEndIndex) + '\n';
      }
    }

    let finalOverride = `🔒 CRITICAL FINAL INSTRUCTION - HIGHEST PRIORITY:
${ragContextForOverride ? ragContextForOverride + '---\n' : ''}
📋 CUSTOM BUSINESS INSTRUCTIONS (BEHAVIORAL GUIDANCE):
- If CUSTOM BUSINESS INSTRUCTIONS were provided in the system prompt above, follow them for BEHAVIOR and STYLE
- These instructions guide HOW you respond (tone, greetings, emojis) but MUST NOT prevent you from using FAQ/Knowledge Base content
- If a user asks a question and the answer exists in your KNOWLEDGE BASE or FAQs, you MUST provide that answer

1. PRODUCT DISPLAY RULE (ONLY IF YOU CALLED get_products):
   - When showing products: Write a brief friendly 1-2 sentence reply in the user's language. Do NOT list products in text — cards display automatically. NEVER say "products will be displayed below", "cards will appear", or any similar UI-referencing phrase.
   - If get_products returns empty: Do NOT just say you don't have it. If alternatives are provided in the result, present them enthusiastically. Otherwise briefly acknowledge no exact match and suggest they try a different search or browse all products. Use the language from your instructions above.
   - NEVER list product names, prices, or URLs in text when products are found. NEVER say "products will be displayed below" or reference how the UI works.

2. ANTI-HALLUCINATION FOR PRICING/FEES:
   - For questions about FEES, COSTS, PRICING, or any NUMERICAL DATA:
   - You MUST find the EXACT number in your provided context (FAQs, products, etc.)
   - If NO specific fee/price is in your context → Start your response with [[FALLBACK]] and politely explain you don't have that specific information
   - NEVER use pre-trained knowledge about real entities
   - NEVER guess, assume, or provide "typical" values

IF YOU CALLED get_products AND IT RETURNED PRODUCTS:
→ Write a brief, natural 1-2 sentence reply in the user's language. Do NOT list products in text — cards display automatically. NEVER say "products will be displayed below", "cards will appear", or any similar UI-referencing phrase.
→ EXCEPTION: If the tool result JSON contains an "_instruction" field, use that content as your response.

LANGUAGE RULE (CRITICAL):
Detect language strictly from the user's latest message only.
Ignore previous conversation language.
Ignore tool result language.
Ignore system instructions language.
SCRIPT RULE (CRITICAL - check this before responding):
- If the user's message contains ONLY Latin/Roman characters (a-z, A-Z) → respond in Latin script ONLY, never Devanagari.
  e.g. "kya haal chaal" → reply as "Main theek hoon! Aap kaise hain?" NOT "मैं ठीक हूं!"
- ONLY use Devanagari script if the user's message CONTAINS Devanagari characters (क, ख, ह, ा, ी, etc.).
- ONLY use Tamil/Telugu/Arabic/etc. script if the user's message CONTAINS those script characters.
- Mirror the user's script (their writing system), not just the language family.
→ ONLY write about product details if get_products returned EMPTY (then follow the rule above).

🚨 ${responseLengthInstruction}
- But NEVER copy/paste full FAQ answers — always SUMMARIZE in your own words.
- Think of yourself as texting, not writing an essay.

🤖 AUTONOMOUS AGENT REINFORCEMENT (CRITICAL):
- You are a SALES AGENT, not a passive FAQ bot. Every response must strategically move the conversation forward.
- NEVER speak negatively about the business. Reframe limitations as opportunities.
- NEVER say "unfortunately", "sadly", "I'm sorry but we don't". Instead pivot to alternatives.
- ALWAYS end with a qualifying question, recommendation, or soft CTA — never leave the conversation hanging.
- When user shares personal details, cross-reference your context and proactively suggest the best match.
- Detect user emotion from their message tone and adapt accordingly.`;

    // Append phone validation override to finalOverride if present (LAST POSITION = highest weight)
    if (phoneValidationOverride) {
      finalOverride += `\n\n${phoneValidationOverride}`;
    }

    const messages: ConversationMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];
    
    // Add language override as the LAST message before sending (GPT weights final messages more heavily)
    messages.push({ role: 'system', content: finalOverride });

    const response = await this.callWithFallback(
      async (client, model) => client.chat.completions.create({
        model,
        messages: messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: this.resolveToolChoice(tools, forcedFirstToolName),
        ...(this.isThinkingModel(model) ? {} : { temperature: 0.7 }),
        max_tokens: 1000,
      }, {
        timeout: 30000,
      }),
      effectiveApiKey,
      primaryProvider,
      primaryModel
    );

    // Log AI usage (fire-and-forget)
    if (businessAccountId) {
      aiUsageLogger.logChatUsage(businessAccountId, primaryModel, response).catch(err =>
        console.error('[Usage] Failed to log:', err)
      );
    }

    return response.choices[0].message;
  }

  private async _prepareContinuationContext(
    messages: ConversationMessage[],
    tools: any[],
    personality: string = 'friendly',
    apiKey?: string,
    businessAccountId?: string,
    preferredLanguage?: string,
    responseLength: string = 'balanced'
  ): Promise<{ openai: any; model: string; messages: ConversationMessage[] }> {
    const { openai, model } = await this.resolveMasterConfig(apiKey);

    // Inject personality-aware system prompt if not already present
    const hasSystemPrompt = messages.some(msg => msg.role === 'system');
    if (!hasSystemPrompt) {
      const currentDate = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
      });
      const currentTime = new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', minute: '2-digit' 
      });

      const personalityTraits = this.getPersonalityTraits(personality);
      
      let languageSection: string;
      const hasExplicitLanguageSelection = preferredLanguage && preferredLanguage !== 'auto';
      
      if (hasExplicitLanguageSelection) {
        const LANGUAGE_NAMES: Record<string, string> = {
          'en': 'English', 'hi': 'Hindi (Devanagari script)', 'hinglish': 'Hinglish',
          'ta': 'Tamil', 'te': 'Telugu', 'kn': 'Kannada', 'mr': 'Marathi', 'bn': 'Bengali',
          'gu': 'Gujarati', 'ml': 'Malayalam', 'pa': 'Punjabi', 'or': 'Odia', 'ur': 'Urdu',
          'es': 'Spanish', 'fr': 'French', 'de': 'German', 'pt': 'Portuguese', 'it': 'Italian',
          'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese', 'ar': 'Arabic', 'ru': 'Russian',
          'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'ms': 'Malay', 'tr': 'Turkish'
        };
        const langName = LANGUAGE_NAMES[preferredLanguage] || preferredLanguage;
        
        languageSection = `LANGUAGE: The user has selected ${langName} from the language dropdown. Always respond in ${langName}.`;
      } else {
        languageSection = '';
      }

      const systemPrompt = `You are Chroney, an AI assistant for Hi Chroney business chatbot platform.

PERSONALITY:
${personalityTraits}

CURRENT CONTEXT:
- Date: ${currentDate}
- Time: ${currentTime}

${languageSection}

INFORMATION PRIORITY (Internal Process):
**You have BUSINESS INFORMATION loaded in your context above.** This contains all company details and answers to common questions. ALWAYS prioritize this information when responding.

INTERNAL PROCESS FOR EVERY QUESTION:
1. **STEP 1: CHECK YOUR CONTEXT** - Look at the information sections above for relevant content
2. **STEP 2: Answer from your knowledge** - If you have the information, provide it NATURALLY and confidently
3. **STEP 3: Use tools only when needed** - Only call tools (get_products, get_faqs, capture_lead, list_available_slots, book_appointment) when you need real-time data or to perform an action. CRITICAL: For appointment questions, you MUST call list_available_slots - you cannot answer scheduling questions without this tool
4. **STEP 4: Decline if truly unrelated** - Only if you don't have the information AND the question is unrelated to this business, give a SHORT refusal (1 sentence max, NO follow-up, NO redirect to services)

EXAMPLES OF INFORMATION USAGE:
- "How is [your brand] better than [competitor]?" ← Check your context first
- "Why should I choose you?" ← Check your context first
- "What makes you different?" ← Check your context first
- "What is your return policy?" ← Check your context first
- Any "how", "why", "what", "when", "where" questions ← Check your context first

CUSTOMER-FACING COMMUNICATION RULES (CRITICAL):
- **NEVER mention FAQs, tools, databases, or any internal systems to customers**
- **NEVER say "I found this in the FAQ" or "I couldn't find this in the FAQ"**
- Present information NATURALLY as if it's your own knowledge
- Example BAD: "I couldn't find any specific FAQs addressing that..."
- Example GOOD: "Based on our information, Nike has a 30-day return policy on unworn items..."
- Talk like a knowledgeable customer service representative who just knows the answers

If information is not available:
- Keep the response SHORT (1 sentence max).
- Clearly state you cannot help with that topic.
- Vary wording naturally; avoid repeating the exact same refusal phrase in consecutive turns.
- Do NOT add follow-ups, suggestions, or redirects.
- Do NOT push services or lead capture.

🎯 CONCISE RESPONSES (CRITICAL):
- Keep responses SHORT — max 3-4 lines total. Write conversationally.
- Short bullet points (3-4 items, 5-8 words each) are great for readability.
- But NEVER write long paragraphs or detailed explanations unless user asks for "details" or "steps".
- SUMMARIZE information — do NOT copy FAQ answers word-for-word.
- ANSWER ONLY WHAT WAS ASKED — don't volunteer extra info.
- ✅ GOOD: "Admission is simple — check eligibility, apply online, and confirm your seat. No entrance exam needed!"
- ❌ BAD: Copying a 5-step FAQ answer with full descriptions for each step.

CORE CONVERSATION BEST PRACTICES (ALWAYS FOLLOW):
1. **Check Conversation History Before Asking**: Before asking for ANY information (name, phone, email, etc.), ALWAYS check the conversation history first. If the user already mentioned it in ANY previous message, use that information instead of asking again. NEVER ask repeated questions.

2. **Extract Contact Info Proactively**: When users mention their name, phone number, or email ANYWHERE in their message (e.g., "Hi, I'm John, tell me about courses"), extract and remember this information immediately. Don't ask for it again later.

3. **Acknowledge What Users Share**: When collecting information, acknowledge what the user has already shared before asking for missing details. Use varied, natural phrasing — never repeat the same transition phrase across conversations.

4. **Flexible Information Collection**: Collect required information in a flexible order based on what the user provides. If they volunteer information out of sequence, accept it and move forward. Don't force a rigid question order.

5. **Context-Aware Responses**: Always use information from the conversation history to provide personalized, context-aware responses. Refer back to what users mentioned earlier to create a natural, flowing conversation.

6. **CRITICAL - Follow Through on Your Questions**:
   - **NEVER ask "Would you like more details?" if you won't provide them**
   - **When user says "yes", "sure", "ok" - CHECK CONVERSATION HISTORY to see what you offered**
   - **Example WRONG:**
     - You: "We offer the MBA program. Would you like more details?"
     - User: "yes"
     - You: "Here are our products:" ❌ WRONG - you didn't provide the MBA details you promised
   - **Example CORRECT:**
     - You: "We offer the MBA program. Would you like more details?"
     - User: "yes"
     - You: "The program highlights include: [provide actual MBA details from FAQs]" ✅ CORRECT
   - **If you ask for confirmation, you MUST deliver what you promised**
   - **Don't switch topics randomly when user agrees to your offer**

🎭 **NATURAL CONVERSATION STYLE (CRITICAL - AVOID ROBOTIC RESPONSES):**
- **VARY YOUR LANGUAGE** - Never use the exact same phrase twice in a conversation
- **AVOID ROBOTIC PATTERNS** - Don't repeat "I'd be happy to help!" or "Could you tell me more?" every time
- **USE DIFFERENT OPENINGS** - Mix up how you start responses:
  - Instead of always "I'd be happy to help!" → Try: "Sure!", "Of course!", "Great question!", "Let me help with that", "Absolutely!", or just answer directly
  - Instead of always "Could you tell me more?" → Try: "What specifically would you like to know?", "Can you elaborate?", "Which aspect interests you most?", "Tell me more about what you're looking for"
- **BE CONVERSATIONAL, NOT FORMAL** - Write like you're chatting with a friend, not reading a script
- **MATCH THE USER'S ENERGY** - If they're casual, be casual. If they're brief, be concise.
- **DON'T OVER-EXPLAIN** - Get to the point. Users don't need lengthy preambles.
- **AVOID THESE ROBOTIC PATTERNS:**
  - ❌ Starting every response with "I'd be happy to help!"
  - ❌ Ending every response with "Is there anything else I can help with?"
  - ❌ Using the same transition phrases repeatedly
  - ❌ Over-using filler phrases like "Please let me know if you have any questions"
- **SOUND HUMAN** - Add natural variations, contractions (I'm, you're, let's), and conversational flow

STRICT ANTI-HALLUCINATION RULES (ABSOLUTELY CRITICAL):
- **NEVER make up, guess, or assume ANY information about:**
  - Product details (features, specifications, materials, colors, sizes)
  - Pricing, discounts, or promotional offers
  - Company policies (returns, shipping, warranties, guarantees)
  - Store locations, hours, or contact information
  - Product availability or stock status
  - Company history, founding dates, or ownership details
  - Any claims about product performance or benefits
- **ONLY state information that is explicitly provided in:**
  - Your KNOWLEDGE BASE (loaded above)
  - Results from get_products tool calls
  - The COMPANY INFORMATION section
- **If you don't have the information:**
  - GOOD: "I don't have specific details about that. Let me help you explore our available products instead."
  - GOOD: "I'd recommend checking our product listings for the most current information."
  - BAD: "I think..." or "Probably..." or "Usually..." or "Most likely..."
  - BAD: Making up product features, prices, or policies
- **Remember:** Providing incorrect information damages customer trust and brand reputation. When in doubt, don't guess!

🚫 CRITICAL: DO NOT SUGGEST QUESTIONS YOU CANNOT ANSWER:
- **NEVER offer follow-up questions about topics you have NO information about**
- **NEVER say** "Would you like to know about [X, Y, Z]?" if you don't have data on X, Y, or Z
- **NEVER promise to show/fetch/retrieve data you don't have access to**
- **ONLY suggest questions based on:**
  - Topics explicitly covered in your KNOWLEDGE BASE (FAQs)
  - Products available via get_products tool
  - Appointments (if you can call list_available_slots)

🚫 EXAMPLES OF STRICTLY FORBIDDEN BEHAVIOR:
- ❌ "Would you like to see our available MBA options?" (when you have NO MBA products)
- ❌ "I'll now show you the MBA programs we have available" (when you DON'T have them)
- ❌ "Let me check our MBA programs for you" (when there's nothing to check)
- ❌ "I recommend checking out our latest programs and pricing" (when you can't show them)
- ❌ Making up details: "Our MBA is 2 years, costs ₹1,62,000..." (when this doesn't exist)
- ❌ "Please give me a moment" (when you're about to fail because there's no data)

✅ CORRECT BEHAVIOR WHEN YOU DON'T HAVE THE DATA:
- ✅ "I don't have specific information about MBA programs in my current knowledge base."
- ✅ "I'd be happy to help! However, I don't have detailed MBA program information available right now."
- ✅ "For specific MBA program details, I recommend contacting us directly. I can help you with [what you DO have]."
- ✅ If you have general products → "Would you like to see our available products?" (but ONLY if get_products will return actual results)
- ✅ If you have FAQs about MBA → Use that exact FAQ data (but don't offer to "show options" unless you have product data)

🔍 BEFORE OFFERING TO SHOW ANYTHING:
1. Check: Do I have this in my KNOWLEDGE BASE? (Look above in your context)
2. Check: Can I call get_products and will it return MBA products?
3. If NO to both → DO NOT offer to show it
4. If YES → Only then offer to show it

==============================
FINAL OVERRIDE RULES (READ LAST - HIGHEST PRIORITY)
==============================

⚠️ BREVITY IS MANDATORY:
- Keep responses SHORT — max 3-4 lines total. Write conversationally.
- Bullet points are OK for listing 3-4 items, but keep each bullet to ONE short line (5-8 words max).
- NEVER write long paragraphs or detailed explanations unless user asks for "details", "steps", or "explain more".
- SUMMARIZE information in your own words — do NOT copy/paste FAQ answers verbatim.
- For multi-step topics: summarize briefly, then ask "Want me to go into detail?"

OTHER RULES:
1. Conversation safety > intent > business goals.
2. Language matching is mandatory.
3. Products render as cards — write a brief natural acknowledgment (1-2 sentences), never list them in text. Do NOT reference the UI or cards in your reply.
4. NEVER mention internal terms (FAQ, database, tools, RAG).
5. Business-only knowledge at all times.
6. Anti-hallucination is absolute.
7. Maintain natural, human conversation style.

${this.getJourneyGuidance()}`;

      messages = [{ role: 'system', content: systemPrompt }, ...messages];
    }

    // Extract user's CURRENT/LATEST message for language matching (not the first one)
    const allUserMessages = messages.filter(m => m.role === 'user');
    const userMessage = allUserMessages.length > 0 ? allUserMessages[allUserMessages.length - 1].content : '';
    
    console.log(`[continueToolConversation] User message (latest): "${userMessage}"`);

    // Check if lead capture just completed (look for allRequiredFieldsCollected in tool results)
    // Cast to any to check tool role which isn't in the ConversationMessage type
    const leadCaptureCompleted = messages.some(msg => 
      (msg as any).role === 'tool' && 
      typeof msg.content === 'string' && 
      msg.content.includes('allRequiredFieldsCollected')
    );
    
    // Find the user's ORIGINAL question from conversation history (the first user message, not the phone number)
    const userMessages = messages.filter(msg => msg.role === 'user');
    const originalQuestion = userMessages.length > 1 
      ? userMessages[0].content 
      : '';
    
    // Check if the original message is a real question (not just a greeting/affirmative)
    // Short messages like "Yes", "Ok", "Hi", "Hello", etc. are not real questions
    const shortAffirmatives = ['yes', 'ok', 'okay', 'sure', 'hi', 'hello', 'hey', 'hii', 'hiii', 'tx', 'thanks', 'thank', 'ya', 'yea', 'yeah', 'yup', 'yep', 'no', 'nope', 'hmm', 'hm', 'mm', 'k', 'fine', 'good', 'great', 'cool', 'alright', 'haan', 'ji', 'ha', 'theek', 'accha', 'thik'];
    const originalQuestionLower = originalQuestion.toLowerCase().trim();
    const isRealQuestion = originalQuestion.length > 15 || 
      (originalQuestion.length > 3 && !shortAffirmatives.includes(originalQuestionLower) && 
       !originalQuestionLower.match(/^(yes|no|ok|hi|hello|hey|sure|thanks?|ya+|ye+a*h*|yup|yep|k+|hm+|mm+|fine|good|great|cool|alright)[.!?]*$/i));
    
    console.log(`[continueToolConversation] Lead capture completed: ${leadCaptureCompleted}, Original question: "${originalQuestion}", isRealQuestion: ${isRealQuestion}`);
    
    let leadCaptureInstruction = '';
    if (leadCaptureCompleted) {
      if (isRealQuestion && originalQuestion) {
        // User had a real question - answer it
        leadCaptureInstruction = `

3. POST-LEAD-CAPTURE BEHAVIOR (CRITICAL - YOU JUST COLLECTED CONTACT INFO):
   - You just finished collecting contact information from the user
   - The user originally asked: "${originalQuestion}"
   - NOW YOU MUST: Acknowledge saving their info briefly AND answer their original question
   - Briefly acknowledge their info in a natural way, then answer their original question with real information
   - DO NOT just say "I've processed your request" - this is a BAD response
   - DO NOT ask "Is there anything else?" without answering their question first
   - CALL get_faqs TOOL to find relevant information about their original question
   - BE HELPFUL: The user waited to give their info, now reward them with useful information`;
      } else {
        // User didn't have a real question (just said "Yes", "Hi", etc.) - ask how to help
        leadCaptureInstruction = `

3. POST-LEAD-CAPTURE BEHAVIOR (CRITICAL - YOU JUST COLLECTED CONTACT INFO):
   - You just finished collecting contact information from the user
   - The user did NOT ask a specific question yet (they just gave affirmative responses or greetings)
   - NOW YOU MUST: Thank them for sharing their details and ASK how you can help them
   - Briefly thank them in a natural, varied way and ask how you can help
   - ❌ DO NOT dump FAQs or product information unprompted
   - ❌ DO NOT list all available information or services
   - ❌ DO NOT say "Here are some FAQs" or "Let me tell you about..."
   - ✅ Keep your response SHORT - just thank them and ask what they need
   - ✅ Wait for the user to ask a question before providing detailed information`;
      }
    }

    let languageInstruction: string;
    let effectiveLanguage: string;
    let effectiveLanguageUpper: string;
    
    const hasExplicitLanguageSelection = preferredLanguage && preferredLanguage !== 'auto';
    
    if (hasExplicitLanguageSelection) {
      const LANGUAGE_NAMES: Record<string, string> = {
        'en': 'English', 'hi': 'Hindi (Devanagari script)', 'hinglish': 'Hinglish',
        'ta': 'Tamil', 'te': 'Telugu', 'kn': 'Kannada', 'mr': 'Marathi', 'bn': 'Bengali',
        'gu': 'Gujarati', 'ml': 'Malayalam', 'pa': 'Punjabi', 'or': 'Odia', 'ur': 'Urdu',
        'es': 'Spanish', 'fr': 'French', 'de': 'German', 'pt': 'Portuguese', 'it': 'Italian',
        'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese', 'ar': 'Arabic', 'ru': 'Russian',
        'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'ms': 'Malay', 'tr': 'Turkish',
        'as': 'Assamese', 'ne': 'Nepali', 'sa': 'Sanskrit', 'ks': 'Kashmiri', 'sd': 'Sindhi', 'kok': 'Konkani'
      };
      effectiveLanguage = LANGUAGE_NAMES[preferredLanguage] || preferredLanguage;
      effectiveLanguageUpper = effectiveLanguage.toUpperCase();
      
      languageInstruction = `LANGUAGE: The user has selected ${effectiveLanguage} from the language dropdown. Always respond in ${effectiveLanguage}. Translate any business content to ${effectiveLanguage}.`;
    } else {
      effectiveLanguage = "";
      effectiveLanguageUpper = "";
      languageInstruction = `CRITICAL LANGUAGE RULE:
Ignore previous conversation language completely.
Detect language ONLY from the user's latest message.
The latest message always overrides conversation history.
Do NOT consider prior messages for language selection.
SCRIPT RULE (CRITICAL - check this before responding):
- If the user's message contains ONLY Latin/Roman characters (a-z, A-Z) → respond in Latin script ONLY, never Devanagari.
  e.g. "kya haal chaal" → reply as "Main theek hoon! Aap kaise hain?" NOT "मैं ठीक हूं!"
- ONLY use Devanagari script if the user's message CONTAINS Devanagari characters (क, ख, ह, ा, ी, etc.).
- ONLY use Tamil/Telugu/Arabic/etc. script if the user's message CONTAINS those script characters.
- Mirror the user's script (their writing system), not just the language family.`;
    }

    const responseLengthInstruction = this.getResponseLengthInstruction(responseLength);

    // Extract RAG context from messages if present and inject into final override
    let ragContextForOverride = '';
    const ragMarker = '🔒 CRITICAL DOCUMENT KNOWLEDGE';
    const systemMessages = messages.filter(m => m.role === 'system');
    for (const msg of systemMessages) {
      if (msg.content.includes(ragMarker)) {
        const ragStartIndex = msg.content.indexOf(ragMarker);
        if (ragStartIndex !== -1) {
          const endMarker = 'Do NOT say "I don\'t have information" when the answer is clearly in the excerpts above';
          const endMarkerIndex = msg.content.indexOf(endMarker, ragStartIndex);
          
          let ragEndIndex;
          if (endMarkerIndex !== -1) {
            ragEndIndex = msg.content.indexOf('\n\n', endMarkerIndex + endMarker.length);
            if (ragEndIndex === -1) {
              ragEndIndex = msg.content.length;
            } else {
              ragEndIndex += 2;
            }
          } else {
            const nextSection = msg.content.indexOf('\n\n---', ragStartIndex);
            ragEndIndex = nextSection !== -1 ? nextSection : msg.content.length;
          }
          
          ragContextForOverride = '\n' + msg.content.substring(ragStartIndex, ragEndIndex) + '\n';
          break;
        }
      }
    }

    // Detect K12 education mode from system context
    const isK12Mode = systemMessages.some(m => m.content.includes('K12 EDUCATION MODE'));

    let finalOverride = `🔒 CRITICAL FINAL INSTRUCTION - HIGHEST PRIORITY:
${ragContextForOverride ? ragContextForOverride + '---\n' : ''}
📋 CUSTOM BUSINESS INSTRUCTIONS (BEHAVIORAL GUIDANCE):
- If CUSTOM BUSINESS INSTRUCTIONS were provided in the system prompt above, follow them for BEHAVIOR and STYLE
- These instructions guide HOW you respond (tone, greetings, emojis) but MUST NOT prevent you from using FAQ/Knowledge Base content
- If a user asks a question and the answer exists in your KNOWLEDGE BASE or FAQs, you MUST provide that answer

${languageInstruction}
${isK12Mode ? `
📚 K12 TUTOR MODE ACTIVE:
- You are an EDUCATIONAL TUTOR helping students learn. Use the curriculum data from tool results to explain concepts.
- When fetch_k12_topic returned content, USE that content to answer the student's question step-by-step.
- Show your mathematical work clearly: state the theorem/concept, set up equations, solve step-by-step.
- Be encouraging and ask if the student wants to try a similar problem.
- NEVER refuse to answer academic questions — this is an education platform.
` : `
1. PRODUCT DISPLAY RULE (ONLY IF YOU CALLED get_products):
   - When showing products: Write a brief friendly 1-2 sentence reply in the user's language. Do NOT list products in text — cards display automatically. NEVER say "products will be displayed below", "cards will appear", or any similar UI-referencing phrase.
   - If get_products returns empty: Do NOT just say you don't have it. If alternatives are provided in the result, present them enthusiastically. Otherwise briefly acknowledge no exact match and suggest they try a different search or browse all products. Use the language from your instructions above.
   - NEVER list product names, prices, or URLs in text when products are found. NEVER say "products will be displayed below" or reference how the UI works.
`}
2. ANTI-HALLUCINATION FOR PRICING/FEES:
   - For questions about FEES, COSTS, PRICING, or any NUMERICAL DATA:
   - You MUST find the EXACT number in your provided context (FAQs, products, etc.)
   - If NO specific fee/price is in your context → Start your response with [[FALLBACK]] and politely explain you don't have that specific information
   - NEVER use pre-trained knowledge about real entities
   - NEVER guess, assume, or provide "typical" values${leadCaptureInstruction}
${isK12Mode ? '' : `
IF YOU CALLED get_products AND IT RETURNED PRODUCTS:
→ Write a brief, natural 1-2 sentence reply in the user's language. Do NOT list products in text — cards display automatically. NEVER say "products will be displayed below", "cards will appear", or any similar UI-referencing phrase.
→ EXCEPTION: If the tool result JSON contains an "_instruction" field, use that content as your response.
`}
LANGUAGE RULE (CRITICAL):
Detect language strictly from the user's latest message only.
Ignore previous conversation language.
Ignore tool result language.
Ignore system instructions language.
SCRIPT RULE (CRITICAL - check this before responding):
- If the user's message contains ONLY Latin/Roman characters (a-z, A-Z) → respond in Latin script ONLY, never Devanagari.
  e.g. "kya haal chaal" → reply as "Main theek hoon! Aap kaise hain?" NOT "मैं ठीक हूं!"
- ONLY use Devanagari script if the user's message CONTAINS Devanagari characters (क, ख, ह, ा, ी, etc.).
- ONLY use Tamil/Telugu/Arabic/etc. script if the user's message CONTAINS those script characters.
- Mirror the user's script (their writing system), not just the language family.
${isK12Mode ? '' : `→ ONLY write about product details if get_products returned EMPTY (then apologize naturally).
`}
🚨 ${responseLengthInstruction}
- But NEVER copy/paste full FAQ answers — always SUMMARIZE in your own words.
- Think of yourself as texting, not writing an essay.

🤖 AUTONOMOUS AGENT REINFORCEMENT (CRITICAL):
${isK12Mode ? `- You are an EDUCATIONAL TUTOR. Your goal is to help students understand concepts and solve problems.
- Use curriculum data from tool results to provide accurate, step-by-step explanations.
- Be encouraging and patient. Ask follow-up questions to check understanding.` : `- You are a SALES AGENT, not a passive FAQ bot. Every response must strategically move the conversation forward.
- NEVER speak negatively about the business. Reframe limitations as opportunities.
- NEVER say "unfortunately", "sadly", "I'm sorry but we don't". Instead pivot to alternatives.
- ALWAYS end with a qualifying question, recommendation, or soft CTA — never leave the conversation hanging.
- When user shares personal details, cross-reference your context and proactively suggest the best match.
- Detect user emotion from their message tone and adapt accordingly.`}`;

    messages.push({ role: 'system', content: finalOverride });

    return { openai, model, messages };
  }

  async continueToolConversation(
    messages: ConversationMessage[],
    tools: any[],
    personality: string = 'friendly',
    apiKey?: string,
    businessAccountId?: string,
    preferredLanguage?: string,
    responseLength: string = 'balanced'
  ) {
    const { openai, model, messages: preparedMessages } = await this._prepareContinuationContext(
      messages, tools, personality, apiKey, businessAccountId, preferredLanguage, responseLength
    );

    const response = await openai.chat.completions.create({
      model: model,
      messages: preparedMessages,
      tools: tools.length > 0 ? tools : undefined,
      ...(this.isThinkingModel(model) ? {} : { temperature: 0.7 }),
      max_tokens: 1000,
    }, {
      timeout: 30000, // 30-second timeout to prevent hanging requests
    });

    // Log AI usage (fire-and-forget)
    if (businessAccountId) {
      aiUsageLogger.logChatUsage(businessAccountId, model, response).catch(err =>
        console.error('[Usage] Failed to log:', err)
      );
    }

    return response.choices[0].message;
  }

  /**
   * Streaming variant of continueToolConversation. Yields text deltas as the
   * model generates them so the widget can display the answer token-by-token
   * (instead of waiting for the full tool-call → second-LLM cycle to finish).
   */
  async *continueToolConversationStream(
    messages: ConversationMessage[],
    tools: any[],
    personality: string = 'friendly',
    apiKey?: string,
    businessAccountId?: string,
    preferredLanguage?: string,
    responseLength: string = 'balanced'
  ): AsyncGenerator<string> {
    const { openai, model, messages: preparedMessages } = await this._prepareContinuationContext(
      messages, tools, personality, apiKey, businessAccountId, preferredLanguage, responseLength
    );

    const stream = await openai.chat.completions.create({
      model: model,
      messages: preparedMessages,
      tools: tools.length > 0 ? tools : undefined,
      ...(this.isThinkingModel(model) ? {} : { temperature: 0.7 }),
      max_tokens: 1000,
      stream: true,
      stream_options: { include_usage: true },
    } as any, {
      timeout: 30000,
    });

    let usage: any = undefined;
    for await (const chunk of stream as any) {
      // The final chunk (with include_usage) carries usage and has no choices.
      if (chunk?.usage) {
        usage = chunk.usage;
      }
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }

    // Log AI usage (fire-and-forget) — mirrors the non-streaming variant so
    // streamed continuations are not a billing/analytics blind spot.
    if (businessAccountId && usage) {
      aiUsageLogger.logChatUsage(businessAccountId, model, { usage }).catch(err =>
        console.error('[Usage] Failed to log:', err)
      );
    }
  }

  async *streamToolAwareResponse(
    userMessage: string,
    tools: any[],
    conversationHistory: ConversationMessage[] = [],
    systemContext: string = '',
    personality: string = 'friendly',
    apiKey?: string,
    leadTrainingConfig?: LeadTrainingConfig | null,
    existingLead?: { phone?: string | null; email?: string | null; name?: string | null } | null,
    preferredLanguage?: string,
    businessAccountId?: string,
    rawCustomInstructions?: string,
    userMessageCount: number = 1,
    hasProducts: boolean = false,
    starterQAContext?: string,
    appointmentTriggerRules?: Array<{ id: string; keywords: string[]; prompt: string; enabled: boolean }> | null,
    responseLength: string = 'balanced',
    phoneValidationOverride?: string,
    suppressFaqInjection: boolean = false,
    otpVerificationPending: boolean = false,
    forcedFirstToolName?: string
  ) {
    const { openai, model } = await this.resolveMasterConfig(apiKey);

    // OPTIMIZATION: Fast-path for simple English-only greetings (reduces response time from 7s to ~1s)
    // Only triggers for English greetings when no custom instructions or language preferences are set
    const msgLower = userMessage.toLowerCase().trim();
    const simpleEnglishGreetings = ['hi', 'hey', 'hello', 'hii', 'hiii', 'heyyy', 'heyy', 'yo', 'sup'];
    const isSimpleEnglishGreeting = simpleEnglishGreetings.includes(msgLower) || 
                             (msgLower.length <= 10 && /^(hi+|hey+|hello+|yo+)!*$/i.test(msgLower));
    
    // Only use fast-path when: no conversation history, no lead capture, no custom instructions, no language preference
    const hasRequiredLeadFields = leadTrainingConfig?.fields?.some(f => f.enabled && f.required && !existingLead?.[f.id as keyof typeof existingLead]);
    const hasCustomInstructions = rawCustomInstructions && rawCustomInstructions.trim().length > 0;
    const hasLanguagePreference = preferredLanguage && preferredLanguage !== 'auto';
    const useGreetingFastPath = isSimpleEnglishGreeting && 
                                 conversationHistory.length === 0 && 
                                 !hasRequiredLeadFields && 
                                 !hasCustomInstructions && 
                                 !hasLanguagePreference;
    
    if (useGreetingFastPath) {
      console.log('[Fast-Path] Simple English greeting with no custom config - using lightweight response');
      
      // Stream the greeting response quickly with personality
      const personalityTraits = this.getPersonalityTraits(personality);
      const greetingStream = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: `You are a friendly customer service assistant. ${personalityTraits}\nRespond with a brief, welcoming greeting in 1-2 sentences.` },
          { role: 'user', content: userMessage }
        ],
        ...(this.isThinkingModel(model) ? {} : { temperature: 0.7 }),
        max_tokens: 50,
        stream: true,
      }, { timeout: 10000 });
      
      for await (const chunk of greetingStream) {
        yield chunk;
      }
      return;
    }

    // SERVER-SIDE FAQ PRE-FETCH: Search FAQs before AI call to eliminate tool round-trip
    // Suppressed when order lookup or return/exchange cards are already showing — the AI
    // must reply with a single brief sentence, not summarise FAQ content about tracking.
    let preFetchedFaqData: { faqs: any[]; searchQuery: string } | null = null;
    if (businessAccountId && !suppressFaqInjection) {
      preFetchedFaqData = await preFetchFaqs(userMessage, businessAccountId);
    } else if (suppressFaqInjection) {
      console.log('[FAQ Pre-fetch] Suppressed — order lookup cards active, skipping FAQ injection');
    }

    const currentDate = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });
    const currentTime = new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', minute: '2-digit' 
    });

    const personalityTraits = this.getPersonalityTraits(personality);
    const responseLengthInstruction = this.getResponseLengthInstruction(responseLength);
    
    const PREFERRED_LANGUAGE_NAMES: Record<string, string> = {
      'en': 'English',
      'hi': 'Hindi (Devanagari script)',
      'hinglish': 'Hinglish (Hindi-English mix)',
      'ta': 'Tamil',
      'te': 'Telugu',
      'kn': 'Kannada',
      'mr': 'Marathi',
      'bn': 'Bengali',
      'gu': 'Gujarati',
      'ml': 'Malayalam',
      'pa': 'Punjabi',
      'or': 'Odia',
      'as': 'Assamese',
      'ur': 'Urdu',
      'ne': 'Nepali',
      'sa': 'Sanskrit',
      'ks': 'Kashmiri',
      'sd': 'Sindhi',
      'kok': 'Konkani',
      'mni': 'Manipuri',
      'brx': 'Bodo',
      'sat': 'Santali',
      'doi': 'Dogri',
      'mai': 'Maithili',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'pt': 'Portuguese',
      'it': 'Italian',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese',
      'ar': 'Arabic',
      'ru': 'Russian',
      'th': 'Thai',
      'vi': 'Vietnamese',
      'id': 'Indonesian',
      'ms': 'Malay',
      'tr': 'Turkish',
      'pl': 'Polish',
      'nl': 'Dutch',
      'sv': 'Swedish',
      'no': 'Norwegian',
      'da': 'Danish',
      'fi': 'Finnish',
      'el': 'Greek',
      'he': 'Hebrew',
      'uk': 'Ukrainian',
      'cs': 'Czech',
      'hu': 'Hungarian',
      'ro': 'Romanian',
      'bg': 'Bulgarian',
      'hr': 'Croatian',
      'sk': 'Slovak',
      'sl': 'Slovenian',
      'sr': 'Serbian',
      'lt': 'Lithuanian',
      'lv': 'Latvian',
      'et': 'Estonian',
      'sw': 'Swahili',
      'am': 'Amharic'
    };
    
    const preferredLangName = preferredLanguage && preferredLanguage !== 'auto' 
      ? PREFERRED_LANGUAGE_NAMES[preferredLanguage] || preferredLanguage 
      : null;
    
    const languageRuleSection = preferredLanguage && preferredLangName
      ? `🚨 CRITICAL RULE #1 - USER-SELECTED LANGUAGE OVERRIDE (HIGHEST PRIORITY):
- **THE USER HAS EXPLICITLY SELECTED ${preferredLangName.toUpperCase()} AS THEIR PREFERRED LANGUAGE**
- **YOU MUST RESPOND IN ${preferredLangName.toUpperCase()} REGARDLESS OF WHAT LANGUAGE THE USER WRITES IN**
- This is the user's explicit preference - ALWAYS respond in ${preferredLangName}
- Translate all content (FAQs, products, responses) to ${preferredLangName}
- Apply this rule to ALL responses including greetings, products, FAQs, appointments, lead capture
- **THIS RULE OVERRIDES EVERYTHING ELSE INCLUDING AUTO-DETECTION**

🚫 CRITICAL MISTAKES TO AVOID:
- ❌ DO NOT auto-detect language from user's message - USER HAS CHOSEN ${preferredLangName.toUpperCase()}
- ❌ DO NOT respond in any other language even if user writes in a different language
- ✅ User writes in any language → Always respond in ${preferredLangName}`
      : '';


    const systemPrompt = `═══════════════════════════════════════════════════════════════════════════
1. IDENTITY
═══════════════════════════════════════════════════════════════════════════

You are Chroney, an autonomous sales agent for this business on the Hi Chroney platform.
You don't just answer questions — you strategically guide every conversation toward the best outcome for both the user and the business.
${this.getAutonomousAgentInstructions(userMessageCount)}

═══════════════════════════════════════════════════════════════════════════
RESPONSE LENGTH (ALWAYS FOLLOW)
═══════════════════════════════════════════════════════════════════════════
${responseLengthInstruction}

═══════════════════════════════════════════════════════════════════════════
2. PRIORITY ORDER (Highest → Lowest)
═══════════════════════════════════════════════════════════════════════════

PRIORITY 1 — LANGUAGE RULE (OVERRIDES EVERYTHING)

${languageRuleSection}

🌍 MULTILINGUAL CONTENT - CRITICAL TRANSLATION RULE:
- **YOUR BUSINESS INFORMATION IS STORED IN ENGLISH**
- **WHEN USER ASKS IN ANY OTHER LANGUAGE, YOU MUST TRANSLATE THE ENGLISH CONTENT**
- **ABSOLUTELY FORBIDDEN:** ❌ "I don't have information in [language]" or "Sorry, information is not available in [language]"
- **CORRECT BEHAVIOR:** Find the English information → Translate to user's language → Respond naturally
- **MULTILINGUAL EXAMPLES:**
  - ✅ User asks in Telugu: "కోర్సుల గురించి చెప్పండి" (tell about courses) → Find English info about courses → Translate to Telugu → Respond in Telugu
  - ✅ User asks in Hindi: "fees क्या है?" (what are fees) → Find English info about fees → Translate to Hindi → Respond in Hindi
  - ✅ User asks in Spanish: "¿Cuáles son los cursos?" (what are the courses) → Find English info about courses → Translate to Spanish → Respond in Spanish
  - ✅ User asks in French: "Parlez-moi des cours" (tell me about courses) → Find English info about courses → Translate to French → Respond in French
  - ✅ User asks in Malayalam: "കോഴ്സുകളെ കുറിച്ച് പറയൂ" (tell about courses) → Find English info about courses → Translate to Malayalam → Respond in Malayalam
- **TRANSLATION PROCESS (INTERNAL - NEVER MENTION TO USER):**
  1. User asks question in their language (Telugu/Hindi/Spanish/etc.)
  2. Check your English information for relevant content
  3. If found: Translate that English content to user's language
  4. Respond naturally in user's language as if you knew it all along
- **REMEMBER:** Having English information MEANS you have that information in ALL languages via translation

───────────────────────────────────────────────────────────────────────────

PRIORITY 2 — STRICT BUSINESS-ONLY DOMAIN (NO GENERAL KNOWLEDGE)

You must ONLY respond to questions that relate to this business.

**WHAT YOU CAN ANSWER FROM:**
- Information provided in your context sections
- Products and offerings you can access
- Custom business instructions
- Company information provided to you
- PDF training documents
- Website analysis content
- FAQs and knowledge base

**ABSOLUTELY FORBIDDEN - Never use general world knowledge:**
- ❌ Encyclopedia knowledge, common facts, world events
- ❌ General definitions not specific to this business
- ❌ Personal opinions, emotional support, jokes
- ❌ News, history, science, politics unrelated to business

**EXAMPLES:**
- ❌ User asks "what is MBA" → You explain: "An MBA is a Master of Business Administration degree that covers finance, marketing..."
- ✅ User asks "what is MBA" → You check your information → Found "Symbiosis OMDP — Online MBA" → Answer: "We offer the Symbiosis OMDP — Online MBA program, designed for..."
- ❌ User asks "what is machine learning" → You explain general ML concepts
- ✅ User asks "what is machine learning" → No business info found → Respond naturally using intelligence
- ❌ User asks "who is the prime minister" → You answer from world knowledge
- ✅ User asks "who is the prime minister" → Respond naturally that this is outside your area

- **WHEN YOU DON'T HAVE INFORMATION:**
  - Keep the response SHORT (1 sentence max).
  - Clearly state you cannot help with that topic.
  - Vary wording naturally in the user's language; avoid repeating the exact same refusal phrase in consecutive turns.
  - Example variations (rotate naturally):
    • "That's outside my knowledge."
    • "I can't help with that topic."
    • "I don't have details on that."
    • "That's not something I cover."
  - Do NOT add follow-ups, suggestions, or redirects.
  - Do NOT push services or lead capture.
  - ❌ NEVER mention "FAQs", "knowledge base", "database", "tools", "RAG", "documents", "system" - these are internal terms

───────────────────────────────────────────────────────────────────────────

🚨 PRIORITY 2.5 — USER REFUSAL DETECTION (CRITICAL - BEFORE ALL CONTENT RULES) 🚨

**WHEN USER RESPONDS WITH SIMPLE REFUSALS, DO NOT FETCH OR PROVIDE MORE INFORMATION**

This rule OVERRIDES all FAQ lookup, product search, and content delivery rules below.

**REFUSAL KEYWORDS (user's ENTIRE message is one of these):**
- "no", "nope", "nah", "no thanks", "not interested"
- "I don't want that", "never mind", "skip", "pass"
- "that's okay", "I'm good", "no need"

**WHEN DETECTED:**
1. ❌ DO NOT call get_faqs, get_products, or ANY tool
2. ❌ DO NOT repeat, translate, or elaborate on previous information
3. ❌ DO NOT interpret "no" as a question or request for more details
4. ✅ Simply acknowledge and ask what else they need

**SCENARIO EXAMPLE:**
- You: "The fees for MBA are 20 Lakh. Would you like more details?"
- User: "no"
- ❌ WRONG: Call get_faqs(search: "MBA fees") → Respond with translated fees in Hindi
- ✅ CORRECT: "Alright! Is there anything else I can help you with?" (NO tool calls)

**KEY INSIGHT:** "No" after receiving information = topic is closed. Move on, don't dig deeper.

───────────────────────────────────────────────────────────────────────────

PRIORITY 3 — LEAD CAPTURE (REQUIRED CONTACT INFORMATION)

**BEFORE answering ANY user question, you MUST check if required contact fields have been collected.**

The "SMART LEAD CAPTURE CONFIGURATION" section below specifies which fields are REQUIRED.

**MANDATORY PROCESS FOR EVERY USER MESSAGE:**
1. First, check conversation history - Have ALL required fields been collected already?
2. If YES → Proceed to answer their question normally
3. If NO → Do NOT answer their question yet. Instead:
   - Politely redirect to collect the missing required fields first
   - Ask for fields in priority order (priority 1 first, then 2, then 3, etc.)
   - Only ask for ONE field at a time
   - After collecting ALL required fields, THEN answer their original question

**EXAMPLES:**
- ❌ WRONG: User asks "tell me about MBA" → You answer immediately with MBA info
- ✅ CORRECT: User asks "tell me about MBA" → Required fields missing → Warmly ask for their contact info first using varied, natural phrasing
- ❌ WRONG: User asks "what are the fees?" → You answer "INR 3,15,000/-" without collecting required fields
- ✅ CORRECT: User asks "what are the fees?" → Required fields missing → Warmly ask for their contact info first using varied, natural phrasing

**EXCEPTION:** If lead capture timing is set to "end" for specific fields, you may answer first, then collect those fields at the end.

**THIS RULE HAS ABSOLUTE PRIORITY OVER ANSWERING QUESTIONS - NO EXCEPTIONS**

───────────────────────────────────────────────────────────────────────────

PRIORITY 4 — BUSINESS KNOWLEDGE SOURCES (HIGHEST CONTENT PRIORITY)

🚨 **CRITICAL RULE: FAQs AND KNOWLEDGE BASE ALWAYS TAKE PRECEDENCE** 🚨

**ABSOLUTE PRIORITY ORDER FOR ANSWERING QUESTIONS:**
1. **FAQs / Knowledge Base** → If there's a FAQ that answers the question, USE IT - NO EXCEPTIONS
2. **Training Documents / Website Content** → If relevant content exists, USE IT
3. **Products Database** → For product-related questions, USE IT
4. **Custom Instructions** → ONLY for BEHAVIORAL guidance (tone, greetings, identity)

**CUSTOM INSTRUCTIONS ROLE (IMPORTANT):**
- Custom instructions guide HOW you respond (tone, language, personality)
- Custom instructions tell you WHO you are (identity, greetings)
- Custom instructions do NOT restrict WHAT information you can share
- ❌ **NEVER let custom instructions block access to FAQ/knowledge base content**
- ✅ If FAQ has the answer → ALWAYS provide it, even if custom instructions seem restrictive

**EXAMPLES OF CORRECT BEHAVIOR:**
- Custom instruction says "only help with loan repayments" BUT FAQ has "Founders of Liquiloans?" answer → ✅ ANSWER the founder question using the FAQ
- Custom instruction says "redirect users to X" BUT FAQ has product details → ✅ SHARE the product details from FAQ first
- Custom instruction says "introduce yourself as Ravi" AND user asks about founders → ✅ BOTH apply: introduce as Ravi AND share founder info from FAQ

**INFORMATION PRIORITY (Internal Process):**
You have BUSINESS INFORMATION loaded in your context above. This contains all company details and answers to common questions. ALWAYS prioritize this information when responding.

**INTERNAL PROCESS FOR EVERY QUESTION:**
1. **STEP 1: CHECK YOUR CONTEXT (FAQs FIRST!)** - Look at FAQs and knowledge base sections BEFORE checking custom instructions
2. **STEP 2: Answer from your knowledge** - If you have the information, provide it NATURALLY and confidently
3. **STEP 3: Use tools for more info** - Call tools (get_products, get_faqs, capture_lead, list_available_slots, book_appointment) when you need additional data or to perform an action. CRITICAL: For appointment questions, you MUST call list_available_slots - you cannot answer scheduling questions without this tool
4. **STEP 4: Decline if truly unrelated** - Only if you don't have the information in FAQs/knowledge base AND the question is genuinely unrelated to this business, give a SHORT refusal (1 sentence max, NO follow-up, NO redirect to services)

**EXAMPLES OF INFORMATION USAGE:**
- "How is [your brand] better than [competitor]?" ← Check your context first
- "Why should I choose you?" ← Check your context first
- "What makes you different?" ← Check your context first
- "What is your return policy?" ← Check your context first
- Any "how", "why", "what", "when", "where" questions ← Check your context first

───────────────────────────────────────────────────────────────────────────

PRIORITY 5 — ANTI-HALLUCINATION & RESPONSE ACCURACY

🔒 **RESTRICTED ASSISTANT - FACTUAL DATA QUESTIONS (CRITICAL - SCOPED RULE):**
When answering questions about:
- Pricing, fees, costs, discounts, payments
- Dates, schedules, timings, durations
- Specific numbers, statistics, percentages, data
- Product specifications, features, materials
- Company facts (founding dates, team size, revenue, locations)
- Academic programs, certifications, courses

**YOU MUST answer ONLY from the provided context above (KNOWLEDGE BASE, FAQs, Products).**

⚠️ **CRITICAL:** Even if you recognize real-world entities (universities like Symbiosis, IIM, companies like Apple, Google, or any known brand/institution), you must NEVER use your pre-trained knowledge about them. You are NOT a general knowledge assistant - you are a business-specific assistant.

**If the specific data is NOT explicitly present in your context:**
- ✅ SAY: "I don't have specific [pricing/fee/date/etc.] information available. Please contact us directly for accurate details."
- ❌ DO NOT use general knowledge or pre-trained data
- ❌ DO NOT make assumptions based on similar entities
- ❌ DO NOT provide approximate or "typical" values

**EXAMPLE:**
- User: "What are the MBA fees?"
- Your context has NO fee information
- ❌ WRONG: "The fees for MBA are 20 Lakh" (using pre-trained knowledge about real MBA programs)
- ✅ CORRECT: "I don't have specific fee information available. Please contact us directly for accurate pricing details."

───────────────────────────────────────────────────────────────────────────

🎯 **CONCISE RESPONSES (CRITICAL):**
- Keep responses SHORT — max 3-4 lines total. Write conversationally like WhatsApp texting.
- Short bullet points (3-4 items, 5-8 words each) are great for readability.
- But NEVER write long paragraphs or detailed explanations unless user asks for "details" or "steps".
- SUMMARIZE information — do NOT copy FAQ answers word-for-word.
- ANSWER ONLY WHAT WAS ASKED — don't volunteer extra info.
- ✅ GOOD: "Admission is simple — check eligibility, apply online, and confirm your seat. No entrance exam needed!"
- ❌ BAD: Copying a 5-step FAQ answer with full descriptions for each step.

CORE CONVERSATION BEST PRACTICES (ALWAYS FOLLOW):
1. **Check Conversation History Before Asking**: Before asking for ANY information (name, phone, email, etc.), ALWAYS check the conversation history first. If the user already mentioned it in ANY previous message, use that information instead of asking again. NEVER ask repeated questions.

2. **Extract Contact Info Proactively**: When users mention their name, phone number, or email ANYWHERE in their message (e.g., "Hi, I'm John, tell me about courses"), extract and remember this information immediately. Don't ask for it again later.

3. **Acknowledge What Users Share**: When collecting information, acknowledge what the user has already shared before asking for missing details. Use varied, natural phrasing — never repeat the same transition phrase across conversations.

4. **Flexible Information Collection**: Collect required information in a flexible order based on what the user provides. If they volunteer information out of sequence, accept it and move forward. Don't force a rigid question order.

5. **Context-Aware Responses**: Always use information from the conversation history to provide personalized, context-aware responses. Refer back to what users mentioned earlier to create a natural, flowing conversation.

6. **CRITICAL - Follow Through on Your Questions**:
   - **NEVER ask "Would you like more details?" if you won't provide them**
   - **When user says "yes", "sure", "ok" - CHECK CONVERSATION HISTORY to see what you offered**
   - **Example WRONG:**
     - You: "We offer the MBA program. Would you like more details?"
     - User: "yes"
     - You: "Here are our products:" ❌ WRONG - you didn't provide the MBA details you promised
   - **Example CORRECT:**
     - You: "We offer the MBA program. Would you like more details?"
     - User: "yes"
     - You: "The program highlights include: [provide actual MBA details from FAQs]" ✅ CORRECT
   - **If you ask for confirmation, you MUST deliver what you promised**
   - **Don't switch topics randomly when user agrees to your offer**

🎭 **NATURAL CONVERSATION STYLE (CRITICAL - AVOID ROBOTIC RESPONSES):**
- **VARY YOUR LANGUAGE** - Never use the exact same phrase twice in a conversation
- **AVOID ROBOTIC PATTERNS** - Don't repeat "I'd be happy to help!" or "Could you tell me more?" every time
- **USE DIFFERENT OPENINGS** - Mix up how you start responses:
  - Instead of always "I'd be happy to help!" → Try: "Sure!", "Of course!", "Great question!", "Let me help with that", "Absolutely!", or just answer directly
  - Instead of always "Could you tell me more?" → Try: "What specifically would you like to know?", "Can you elaborate?", "Which aspect interests you most?", "Tell me more about what you're looking for"
- **BE CONVERSATIONAL, NOT FORMAL** - Write like you're chatting with a friend, not reading a script
- **MATCH THE USER'S ENERGY** - If they're casual, be casual. If they're brief, be concise.
- **DON'T OVER-EXPLAIN** - Get to the point. Users don't need lengthy preambles.
- **AVOID THESE ROBOTIC PATTERNS:**
  - ❌ Starting every response with "I'd be happy to help!"
  - ❌ Ending every response with "Is there anything else I can help with?"
  - ❌ Using the same transition phrases repeatedly
  - ❌ Over-using filler phrases like "Please let me know if you have any questions"
- **SOUND HUMAN** - Add natural variations, contractions (I'm, you're, let's), and conversational flow

STRICT ANTI-HALLUCINATION RULES (ABSOLUTELY CRITICAL):
- **NEVER make up, guess, or assume ANY information about:**
  - Product details (features, specifications, materials, colors, sizes)
  - Pricing, discounts, or promotional offers
  - Company policies (returns, shipping, warranties, guarantees)
  - Store locations, hours, or contact information
  - Product availability or stock status
  - Company history, founding dates, or ownership details
  - Any claims about product performance or benefits
- **ONLY state information that is explicitly provided in:**
  - Your KNOWLEDGE BASE (loaded above)
  - Results from get_products tool calls
  - The COMPANY INFORMATION section
- **If you don't have the information:**
  - GOOD: "I don't have specific details about that. Let me help you explore our available products instead."
  - GOOD: "I'd recommend checking our product listings for the most current information."
  - BAD: "I think..." or "Probably..." or "Usually..." or "Most likely..."
  - BAD: Making up product features, prices, or policies
- **Remember:** Providing incorrect information damages customer trust and brand reputation. When in doubt, don't guess!

🚫 CRITICAL: DO NOT SUGGEST QUESTIONS YOU CANNOT ANSWER:
- **NEVER offer follow-up questions about topics you have NO information about**
- **NEVER say** "Would you like to know about [X, Y, Z]?" if you don't have data on X, Y, or Z
- **NEVER promise to show/fetch/retrieve data you don't have access to**
- **ONLY suggest questions based on:**
  - Topics explicitly covered in your KNOWLEDGE BASE (FAQs)
  - Products available via get_products tool
  - Appointments (if you can call list_available_slots)

🚫 EXAMPLES OF STRICTLY FORBIDDEN BEHAVIOR:
- ❌ "Would you like to see our available MBA options?" (when you have NO MBA products)
- ❌ "I'll now show you the MBA programs we have available" (when you DON'T have them)
- ❌ "Let me check our MBA programs for you" (when there's nothing to check)
- ❌ "I recommend checking out our latest programs and pricing" (when you can't show them)
- ❌ Making up details: "Our MBA is 2 years, costs ₹1,62,000..." (when this doesn't exist)
- ❌ "Please give me a moment" (when you're about to fail because there's no data)

✅ CORRECT BEHAVIOR WHEN YOU DON'T HAVE THE DATA:
- ✅ "I don't have specific information about MBA programs in my current knowledge base."
- ✅ "I'd be happy to help! However, I don't have detailed MBA program information available right now."
- ✅ "For specific MBA program details, I recommend contacting us directly. I can help you with [what you DO have]."
- ✅ If you have general products → "Would you like to see our available products?" (but ONLY if get_products will return actual results)
- ✅ If you have FAQs about MBA → Use that exact FAQ data (but don't offer to "show options" unless you have product data)

🔍 BEFORE OFFERING TO SHOW ANYTHING:
1. Check: Do I have this in my KNOWLEDGE BASE? (Look above in your context)
2. Check: Can I call get_products and will it return MBA products?
3. If NO to both → DO NOT offer to show it
4. If YES → Only then offer to show it

==============================
FINAL OVERRIDE RULES (READ LAST - HIGHEST PRIORITY)
==============================

⚠️ BREVITY IS MANDATORY:
- Keep responses SHORT — max 3-4 lines total. Write conversationally.
- Bullet points are OK for listing 3-4 items, but keep each bullet to ONE short line (5-8 words max).
- NEVER write long paragraphs or detailed explanations unless user asks for "details", "steps", or "explain more".
- SUMMARIZE information in your own words — do NOT copy/paste FAQ answers verbatim.
- For multi-step topics: summarize briefly, then ask "Want me to go into detail?"

OTHER RULES:
1. Conversation safety > intent > business goals.
2. Language matching is mandatory.
3. Products render as cards — write a brief natural acknowledgment (1-2 sentences), never list them in text. Do NOT reference the UI or cards in your reply.
4. NEVER mention internal terms (FAQ, database, tools, RAG).
5. Business-only knowledge at all times.
6. Anti-hallucination is absolute.
7. Maintain natural, human conversation style.
8. AUTONOMOUS AGENT: You are a sales agent, not a passive bot. Always move conversations forward strategically.

${this.getJourneyGuidance()}`;

    // Add FINAL override to ensure language matching and product display rules
    console.log(`[Language Matching] User message: "${userMessage}"`);

    // Build lead collection enforcement message if needed
    // Include current user message so phone numbers in it are recognized
    // Also pass existing lead from database to avoid re-asking for already captured info
    const leadCollectionMessage = await buildMissingRequiredFieldsMessage(leadTrainingConfig, conversationHistory, userMessage, existingLead, businessAccountId);

    let languageInstruction: string;
    let effectiveLanguage: string;
    let effectiveLanguageUpper: string;
    
    const hasExplicitLanguageSelection = preferredLanguage && preferredLanguage !== 'auto';
    
    if (hasExplicitLanguageSelection) {
      const PREFERRED_LANGUAGE_NAMES_FINAL: Record<string, string> = {
        'en': 'English', 'hi': 'Hindi (Devanagari script)', 'hinglish': 'Hinglish (Hindi-English mix)',
        'ta': 'Tamil', 'te': 'Telugu', 'kn': 'Kannada', 'mr': 'Marathi', 'bn': 'Bengali',
        'gu': 'Gujarati', 'ml': 'Malayalam', 'pa': 'Punjabi', 'or': 'Odia', 'as': 'Assamese',
        'ur': 'Urdu', 'ne': 'Nepali', 'sa': 'Sanskrit', 'ks': 'Kashmiri', 'sd': 'Sindhi',
        'kok': 'Konkani', 'mni': 'Manipuri', 'brx': 'Bodo', 'sat': 'Santali', 'doi': 'Dogri',
        'mai': 'Maithili', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'pt': 'Portuguese',
        'it': 'Italian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese', 'ar': 'Arabic',
        'ru': 'Russian', 'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'ms': 'Malay',
        'tr': 'Turkish', 'pl': 'Polish', 'nl': 'Dutch', 'sv': 'Swedish', 'no': 'Norwegian',
        'da': 'Danish', 'fi': 'Finnish', 'el': 'Greek', 'he': 'Hebrew', 'uk': 'Ukrainian',
        'cs': 'Czech', 'hu': 'Hungarian', 'ro': 'Romanian', 'bg': 'Bulgarian', 'hr': 'Croatian',
        'sk': 'Slovak', 'sl': 'Slovenian', 'sr': 'Serbian', 'lt': 'Lithuanian', 'lv': 'Latvian',
        'et': 'Estonian', 'sw': 'Swahili', 'am': 'Amharic'
      };
      
      effectiveLanguage = PREFERRED_LANGUAGE_NAMES_FINAL[preferredLanguage] || preferredLanguage;
      effectiveLanguageUpper = effectiveLanguage.toUpperCase();
      
      languageInstruction = `LANGUAGE: The user has selected ${effectiveLanguage} from the language dropdown. Always respond in ${effectiveLanguage}. Translate any business content to ${effectiveLanguage}.`;
    } else {
      effectiveLanguage = "";
      effectiveLanguageUpper = "";
      languageInstruction = `CRITICAL LANGUAGE RULE:
Ignore previous conversation language completely.
Detect language ONLY from the user's latest message.
The latest message always overrides conversation history.
Do NOT consider prior messages for language selection.
SCRIPT RULE (CRITICAL - check this before responding):
- If the user's message contains ONLY Latin/Roman characters (a-z, A-Z) → respond in Latin script ONLY, never Devanagari.
  e.g. "kya haal chaal" → reply as "Main theek hoon! Aap kaise hain?" NOT "मैं ठीक हूं!"
- ONLY use Devanagari script if the user's message CONTAINS Devanagari characters (क, ख, ह, ा, ी, etc.).
- ONLY use Tamil/Telugu/Arabic/etc. script if the user's message CONTAINS those script characters.
- Mirror the user's script (their writing system), not just the language family.`;
    }

    // Extract RAG context from systemContext if present and inject into final override
    // This ensures RAG chunks aren't overridden by deflection rules
    let ragContextForOverride = '';
    const ragMarker = '🔒 CRITICAL DOCUMENT KNOWLEDGE';
    if (systemContext.includes(ragMarker)) {
      // Extract the entire RAG section (from marker to the end of MANDATORY INSTRUCTION block)
      const ragStartIndex = systemContext.indexOf(ragMarker);
      if (ragStartIndex !== -1) {
        // Look for the end marker
        const endMarker = 'Do NOT say "I don\'t have information" when the answer is clearly in the excerpts above';
        const endMarkerIndex = systemContext.indexOf(endMarker, ragStartIndex);
        
        let ragEndIndex;
        if (endMarkerIndex !== -1) {
          // Found end marker - include it and the trailing newlines
          ragEndIndex = systemContext.indexOf('\n\n', endMarkerIndex + endMarker.length);
          if (ragEndIndex === -1) {
            ragEndIndex = systemContext.length; // No double newline found, use end of string
          } else {
            ragEndIndex += 2; // Include the \n\n
          }
        } else {
          // End marker not found - extract until the next major section or end of string
          const nextSection = systemContext.indexOf('\n\n---', ragStartIndex);
          ragEndIndex = nextSection !== -1 ? nextSection : systemContext.length;
        }
        
        ragContextForOverride = '\n' + systemContext.substring(ragStartIndex, ragEndIndex) + '\n';
      }
    }

    // Build custom instructions with conditional filtering based on user message keywords
    let extractedCustomInstructions = '';
    if (rawCustomInstructions && rawCustomInstructions.trim()) {
      // Note: We cannot cache because conditional instructions depend on user message
      try {
        const instructions = JSON.parse(rawCustomInstructions);
        if (Array.isArray(instructions) && instructions.length > 0) {
          const userMessageLower = userMessage.toLowerCase();
          
          // Map instructions with original indices, then filter, preserving original numbering
          const indexedInstructions = instructions.map((instr: any, originalIndex: number) => ({
            ...instr,
            originalIndex: originalIndex + 1, // 1-based indexing for display
          }));
          
          // Filter instructions: include "always" instructions and "conditional" only when keywords match
          // IMPORTANT: "fallback" instructions are EXCLUDED here - they are only applied later when AI deflects
          const applicableInstructions = indexedInstructions.filter((instr: any) => {
            const instrType = instr.type || 'always'; // Default to 'always' for legacy instructions
            
            // EXCLUDE fallback instructions from initial prompt - they are applied separately after deflection detection
            if (instrType === 'fallback') {
              return false;
            }
            
            if (instrType === 'always') {
              return true; // Always include "always" type instructions
            }
            
            if (instrType === 'conditional' && instr.keywords && Array.isArray(instr.keywords)) {
              // Only include if any keyword is found in user message
              const keywordMatch = instr.keywords.some((keyword: string) => 
                userMessageLower.includes(keyword.toLowerCase())
              );
              if (keywordMatch) {
                console.log(`[Conditional Instruction] Triggered by keyword match: ${instr.keywords.join(', ')}`);
              }
              return keywordMatch;
            }
            
            return true; // Include by default if type is unknown (legacy support)
          });
          
          if (applicableInstructions.length > 0) {
            // Use original indices to preserve ordering/numbering
            const formattedInstructions = applicableInstructions
              .map((instr: any) => `${instr.originalIndex}. ${instr.text}`)
              .join('\n');
            extractedCustomInstructions = `Follow these instructions:\n${formattedInstructions}`;
            console.log(`[Final Override] Applied ${applicableInstructions.length}/${instructions.length} custom instructions (filtered by type/keywords)`);
          }
        }
      } catch (e) {
        extractedCustomInstructions = `Follow these instructions:\n${rawCustomInstructions}`;
      }
    } else {
      // Fallback: try to extract from systemContext (legacy behavior)
      const customInstructionsMarker = 'CUSTOM BUSINESS INSTRUCTIONS:';
      const customInstructionsStart = systemContext.indexOf(customInstructionsMarker);
      if (customInstructionsStart !== -1) {
        // Look for section end marker (---) instead of just \n\n to avoid truncation
        const afterMarker = customInstructionsStart + customInstructionsMarker.length;
        const sectionEnd = systemContext.indexOf('\n\n---', afterMarker);
        const nextMajorSection = systemContext.indexOf('\n\nPRODUCTS:', afterMarker);
        const nextFaqSection = systemContext.indexOf('\n\nFAQS:', afterMarker);
        
        // Find the earliest valid end marker
        const endMarkers = [sectionEnd, nextMajorSection, nextFaqSection].filter(i => i !== -1);
        const endIndex = endMarkers.length > 0 ? Math.min(...endMarkers) : -1;
        
        if (endIndex !== -1) {
          extractedCustomInstructions = systemContext.substring(customInstructionsStart, endIndex).trim();
        } else {
          extractedCustomInstructions = systemContext.substring(customInstructionsStart).trim();
        }
        console.log(`[Final Override] Extracted custom instructions from systemContext (fallback)`);
      }
    }

    // Check if custom instructions specify a language - if so, custom instructions take priority over auto-detection
    const languageKeywords = [
      'english', 'spanish', 'español', 'hindi', 'हिंदी', 'french', 'français', 'german', 'deutsch',
      'italian', 'italiano', 'portuguese', 'português', 'chinese', '中文', 'japanese', '日本語',
      'korean', '한국어', 'arabic', 'عربي', 'russian', 'русский', 'dutch', 'turkish',
      'polish', 'swedish', 'norwegian', 'danish', 'finnish', 'greek', 'hebrew', 'thai',
      'vietnamese', 'indonesian', 'malay', 'tagalog', 'bengali', 'tamil', 'telugu', 'marathi',
      'gujarati', 'kannada', 'malayalam', 'punjabi', 'urdu', 'hinglish'
    ];
    const customInstructionsLower = extractedCustomInstructions.toLowerCase();
    // Use regex for more flexible matching - handles phrases like "respond only in", "always respond in", etc.
    const customInstructionSpecifiesLanguage = languageKeywords.some(lang => {
      const patterns = [
        new RegExp(`respond\\s+(only\\s+)?in\\s+${lang}`, 'i'),
        new RegExp(`reply\\s+(only\\s+)?in\\s+${lang}`, 'i'),
        new RegExp(`answer\\s+(only\\s+)?in\\s+${lang}`, 'i'),
        new RegExp(`speak\\s+(only\\s+)?in\\s+${lang}`, 'i'),
        new RegExp(`use\\s+(only\\s+)?${lang}`, 'i'),
        new RegExp(`always\\s+(respond\\s+)?in\\s+${lang}`, 'i'),
        new RegExp(`only\\s+${lang}`, 'i'),
        new RegExp(`in\\s+${lang}\\s+only`, 'i')
      ];
      return patterns.some(pattern => pattern.test(customInstructionsLower));
    });
    
    if (customInstructionSpecifiesLanguage) {
      console.log('[Custom Instructions] Language specified in custom instructions - custom instructions take priority over auto-detection');
    }

    let languageSection: string;
    if (customInstructionSpecifiesLanguage) {
      languageSection = '2. LANGUAGE: Follow language in BUSINESS INSTRUCTIONS above.';
    } else {
      languageSection = `2. ${languageInstruction}`;
    }

    // Format pre-fetched FAQs for injection
    const preFetchedFaqSection = preFetchedFaqData?.faqs && preFetchedFaqData.faqs.length > 0
      ? formatPreFetchedFaqs(preFetchedFaqData.faqs)
      : '';

    // Build tool usage instruction based on whether we have pre-fetched FAQs
    const toolUsageInstruction = preFetchedFaqSection
      ? '1. FAQ KNOWLEDGE PRE-LOADED: Relevant FAQs are provided above. Use them directly to answer - NO NEED to call get_faqs. Only call get_faqs if you need ADDITIONAL info not covered. For products, use get_products tool.'
      : '1. TOOL USAGE (CRITICAL): For ANY question about the business, products, services, company info - ALWAYS call get_faqs or get_products tools FIRST to search the knowledge base. Never assume you don\'t have info without checking tools.';

    // SMART TIMING: Check if we should activate the lead gate based on message count
    // userMessageCount > 1 means this is the 2nd+ message and lead gate should be active
    // Check ALL required SMART fields, not just name
    const smartMandatoryFieldsList = leadTrainingConfig?.fields
      ?.filter((f: any) => f.enabled && f.required && (!f.captureStrategy || f.captureStrategy === 'smart' || f.captureStrategy === 'custom'))
      || [];
    
    // INTENT-BASED FIELDS: Fields that should be collected when user shows purchase/inquiry intent
    const intentFieldsList = leadTrainingConfig?.fields
      ?.filter((f: any) => f.enabled && f.captureStrategy === 'intent')
      || [];
    
    // KEYWORD-BASED FIELDS: Fields that should be collected when user message contains specific keywords
    // Also includes legacy 'end' strategy fields (migrated to 'keyword')
    const keywordFieldsList = leadTrainingConfig?.fields
      ?.filter((f: any) => f.enabled && (f.captureStrategy === 'keyword' || f.captureStrategy === 'end'))
      || [];
    
    // Intent detection is now fully AI-driven — no regex keyword matching
    // The AI prompt includes the configured sensitivity level and decides when to ask for contact info
    
    // REMOVED: Complex gibberish/dismissive detection
    // Trust GPT-4o-mini to handle unclear messages naturally via Rule #7
    // Only skip lead collection when it's clearly inappropriate (empty or whitespace-only)
    const skipLeadCollection = userMessage.trim().length === 0;
    
    // OPTIONAL START FIELDS: Fields that are Optional but have "At Start" timing
    // These should prompt for contact info but NOT block answering questions
    const optionalStartFieldsList = leadTrainingConfig?.fields
      ?.filter((f: any) => f.enabled && !f.required && f.captureStrategy === 'start')
      || [];
    
    // OPTIONAL CUSTOM FIELDS: Fields that are Optional but have "Custom" timing (legacy: "Smart")
    // These should be asked after N messages based on customAskAfter config
    const optionalSmartFieldsList = leadTrainingConfig?.fields
      ?.filter((f: any) => f.enabled && !f.required && (f.captureStrategy === 'smart' || f.captureStrategy === 'custom'))
      || [];
    
    // Check which mandatory fields are still missing from existingLead
    const fieldIdToLeadKey: Record<string, keyof { name?: string | null; phone?: string | null; email?: string | null; whatsapp?: string | null }> = {
      'name': 'name',
      'phone': 'phone', 
      'mobile': 'phone',
      'email': 'email',
      'whatsapp': 'phone'
    };
    
    const missingSmartFields = smartMandatoryFieldsList.filter((f: any) => {
      const leadKey = fieldIdToLeadKey[f.id] || f.id;
      return !existingLead?.[leadKey as keyof typeof existingLead];
    });
    
    // Check which optional start fields are still missing
    const missingOptionalStartFields = optionalStartFieldsList.filter((f: any) => {
      const leadKey = fieldIdToLeadKey[f.id] || f.id;
      return !existingLead?.[leadKey as keyof typeof existingLead];
    });
    
    // Check which optional smart fields are still missing
    const missingOptionalSmartFields = optionalSmartFieldsList.filter((f: any) => {
      const leadKey = fieldIdToLeadKey[f.id] || f.id;
      return !existingLead?.[leadKey as keyof typeof existingLead];
    });
    
    const hasSmartTimingFields = smartMandatoryFieldsList.length > 0;
    const hasOptionalStartFields = optionalStartFieldsList.length > 0 && missingOptionalStartFields.length > 0;
    const hasOptionalSmartFields = optionalSmartFieldsList.length > 0 && missingOptionalSmartFields.length > 0;
    const smartCustomAskAfter = smartMandatoryFieldsList[0]?.customAskAfter || 2;
    const smartTimingLeadGateActive = hasSmartTimingFields && userMessageCount >= smartCustomAskAfter && missingSmartFields.length > 0;
    
    // INTENT-BASED LEAD GATE: Check which intent fields are still missing
    // Separate required vs optional intent fields
    const requiredIntentFields = intentFieldsList.filter((f: any) => f.required);
    const optionalIntentFields = intentFieldsList.filter((f: any) => !f.required);
    
    const missingRequiredIntentFields = requiredIntentFields.filter((f: any) => {
      const leadKey = fieldIdToLeadKey[f.id] || f.id;
      return !existingLead?.[leadKey as keyof typeof existingLead];
    });
    
    const missingOptionalIntentFields = optionalIntentFields.filter((f: any) => {
      const leadKey = fieldIdToLeadKey[f.id] || f.id;
      return !existingLead?.[leadKey as keyof typeof existingLead];
    });
    
    // AI-driven intent detection — no regex gating
    // Always inject intent prompts when there are missing intent fields; AI decides based on sensitivity level
    const hasRequiredIntentFields = requiredIntentFields.length > 0;
    const hasMissingRequiredIntentFields = missingRequiredIntentFields.length > 0;
    const hasOptionalIntentFields = missingOptionalIntentFields.length > 0;
    
    // No hard gate — AI will decide based on the sensitivity prompt
    const intentLeadGateActive = false;
    
    // KEYWORD-BASED LEAD GATE: Check which keyword fields are still missing and if keywords match
    const requiredKeywordFields = keywordFieldsList.filter((f: any) => f.required);
    const optionalKeywordFields = keywordFieldsList.filter((f: any) => !f.required);
    
    const missingRequiredKeywordFields = requiredKeywordFields.filter((f: any) => {
      const leadKey = fieldIdToLeadKey[f.id] || f.id;
      return !existingLead?.[leadKey as keyof typeof existingLead];
    });
    
    const missingOptionalKeywordFields = optionalKeywordFields.filter((f: any) => {
      const leadKey = fieldIdToLeadKey[f.id] || f.id;
      return !existingLead?.[leadKey as keyof typeof existingLead];
    });
    
    // Check if user message contains any configured keywords (case-insensitive)
    const userMessageLower = userMessage.toLowerCase();
    const keywordMatchedFields = [...missingRequiredKeywordFields, ...missingOptionalKeywordFields].filter((f: any) => {
      const keywords = f.captureKeywords || [];
      return keywords.some((kw: string) => userMessageLower.includes(kw.toLowerCase()));
    });
    
    const hasKeywordMatch = keywordMatchedFields.length > 0;
    console.log(`[Keyword Timing] Keyword fields: ${keywordFieldsList.map((f: any) => `${f.id}(${(f.captureKeywords || []).join('|')})`).join(',')}, Matched: ${keywordMatchedFields.map((f: any) => f.id).join(',')}, hasMatch: ${hasKeywordMatch}`);
    
    console.log(`[Intent AI-Driven] Required intent fields: ${requiredIntentFields.map((f: any) => `${f.id}(${f.intentIntensity || 'medium'})`).join(',')}, Missing required: ${missingRequiredIntentFields.map((f: any) => f.id).join(',')}, Missing optional: ${missingOptionalIntentFields.map((f: any) => f.id).join(',')}`);
    
    // DEBUG: Log Smart timing evaluation
    console.log(`[Smart Timing Debug] userMessageCount: ${userMessageCount}`);
    console.log(`[Smart Timing Debug] smartMandatoryFieldsList: ${JSON.stringify(smartMandatoryFieldsList.map((f: any) => ({ id: f.id, strategy: f.captureStrategy })))}`);
    console.log(`[Smart Timing Debug] optionalStartFieldsList: ${JSON.stringify(optionalStartFieldsList.map((f: any) => ({ id: f.id, strategy: f.captureStrategy })))}`);
    console.log(`[Smart Timing Debug] missingSmartFields: ${JSON.stringify(missingSmartFields.map((f: any) => f.id))}`);
    console.log(`[Smart Timing Debug] missingOptionalStartFields: ${JSON.stringify(missingOptionalStartFields.map((f: any) => f.id))}`);
    console.log(`[Smart Timing Debug] optionalSmartFieldsList: ${JSON.stringify(optionalSmartFieldsList.map((f: any) => ({ id: f.id, strategy: f.captureStrategy })))}`);
    console.log(`[Smart Timing Debug] missingOptionalSmartFields: ${JSON.stringify(missingOptionalSmartFields.map((f: any) => f.id))}`);
    console.log(`[Smart Timing Debug] hasSmartTimingFields: ${hasSmartTimingFields}, hasOptionalStartFields: ${hasOptionalStartFields}, hasOptionalSmartFields: ${hasOptionalSmartFields}, smartTimingLeadGateActive: ${smartTimingLeadGateActive}`);
    console.log(`[Intent Timing Debug] intentFieldsList: ${JSON.stringify(intentFieldsList.map((f: any) => ({ id: f.id, required: f.required, intensity: f.intentIntensity || 'medium' })))}`);
    console.log(`[Intent Timing Debug] AI-driven (no regex). missingRequiredIntentFields: ${JSON.stringify(missingRequiredIntentFields.map((f: any) => f.id))}`);
    console.log(`[Intent Timing Debug] missingOptionalIntentFields: ${JSON.stringify(missingOptionalIntentFields.map((f: any) => f.id))}`);
    console.log(`[Intent Timing Debug] intentLeadGateActive: ${intentLeadGateActive}, hasOptionalIntentFields: ${hasOptionalIntentFields}`);
    
    // CHECK IF LEAD IS ALREADY FULLY COLLECTED - build override to prevent repeated asks
    // This is critical to override custom business instructions that might say "always ask for contact info"
    let leadAlreadyCollectedOverride = '';
    
    // Get ALL required fields (both start and smart timing)
    const allRequiredFields = leadTrainingConfig?.fields
      ?.filter((f: any) => f.enabled && f.required)
      || [];
    
    // Check if ALL required fields are already collected in existingLead
    const allRequiredFieldsCollected = allRequiredFields.length > 0 && allRequiredFields.every((f: any) => {
      const leadKey = fieldIdToLeadKey[f.id] || f.id;
      return !!existingLead?.[leadKey as keyof typeof existingLead];
    });
    
    // Task #23: when an unverified OTP challenge is pending for this
    // conversation, do NOT emit the "all collected — do not ask again"
    // override. Even if name/email/phone are already on the lead row, the
    // phone is not yet verified and the AI must remain in OTP-focused mode
    // (the verify_phone_otp / resend_phone_otp tool path). Suppressing this
    // override is what stops the AI from silently skipping verification when
    // the lead-collected gate would otherwise fire first.
    if (allRequiredFieldsCollected && allRequiredFields.length > 0 && !otpVerificationPending) {
      console.log('[Lead Override] All required contact fields already collected - adding override to prevent repeated asks');
      leadAlreadyCollectedOverride = `
🟢 CONTACT INFO ALREADY COLLECTED - DO NOT ASK AGAIN 🟢
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ This visitor's contact information has ALREADY been saved.
⛔ DO NOT ask for name, phone number, email, or mobile number.
⛔ DO NOT mention "sharing contact details" or "follow-ups".
⛔ IGNORE any business instructions that say to collect contact info.
✅ Simply answer their questions naturally and helpfully.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    }
    
    // Build SMART timing lead gate message if needed
    // This message is placed at the VERY END of the final override for maximum weight
    let smartTimingLeadMessage = '';
    if (smartTimingLeadGateActive) {
      const smartMandatoryFields = missingSmartFields
        ?.map((f: any) => f.id)
        ?.join(', ') || 'name';
      
      // Build example prompt based on the first missing field
      const firstMissingField = missingSmartFields[0]?.id || 'name';
      const fieldPromptExamples: Record<string, string> = {
        'name': 'May I know your name first?',
        'phone': 'May I have your phone number first?',
        'mobile': 'May I have your mobile number first?',
        'email': 'May I have your email address first?',
        'whatsapp': 'May I have your WhatsApp number first?'
      };
      const examplePrompt = fieldPromptExamples[firstMissingField] || `May I have your ${firstMissingField} first?`;
      
      console.log(`[Smart Timing] LEAD GATE ACTIVE - Building override message for field: ${firstMissingField}`);
      
      // Lead gate message - blocks answering business questions until field is collected
      // But allows natural responses to greetings/small talk
      smartTimingLeadMessage = `
🚨 MANDATORY LEAD COLLECTION — READ THIS FIRST 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is message #${userMessageCount}. You MUST collect their ${firstMissingField} before answering any questions.

🚫 RULES:
→ Do NOT answer ANY question (business or casual) until you have their ${firstMissingField}.
→ First, warmly ask for their ${firstMissingField} in your own words.
→ Vary your phrasing each time — do NOT repeat the same sentence or transition phrase.
→ Ask for their ${firstMissingField} in a warm, natural way. Use creative, varied phrasing — never copy the same sentence twice across conversations.

After they provide their ${firstMissingField}, answer their question fully.

🔒 IF USER REFUSES (says "no", "I don't want to", etc.):
This field is MANDATORY. Do NOT give up.
- Politely explain why you need it and re-ask using a different approach.
- NEVER answer the business question until this field is collected.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    }
    
    // AI-DRIVEN INTENT PROMPT: Replaces regex keyword matching entirely
    // AI uses the configured sensitivity level to decide when to ask for contact info
    let intentLeadMessage = '';
    let optionalIntentPrompt = '';
    
    const fieldTextMap: Record<string, string> = {
      'name': 'name',
      'phone': 'phone number',
      'mobile': 'mobile number',
      'email': 'email address',
      'whatsapp': 'WhatsApp number'
    };
    
    const getSensitivityDescription = (fieldName: string, level: string) => {
      const descriptions: Record<string, string> = {
        'low': `LOW sensitivity — Ask for ${fieldName} when user shows ANY interest signal. This includes:
   - Browsing or exploring (asking about any product, service, course, program, category)
   - General inquiries about features, availability, eligibility, options
   - Asking about any specific item by name (e.g., "MBA", "iPhone 15", "yoga class")
   - Showing curiosity about what you offer
   Basically, if the user is asking about ANYTHING related to the business beyond small talk, that qualifies as intent.`,
        'medium': `MEDIUM sensitivity — Ask for ${fieldName} when user shows evaluating/comparison intent. This includes:
   - Asking about pricing, costs, fees, rates, charges
   - Comparing options ("which is better", "difference between")
   - Asking about discounts, offers, deals, promotions
   - Inquiring about availability of specific items
   - Requesting detailed information to make a decision
   Do NOT ask on general browsing or casual questions.`,
        'high': `HIGH sensitivity — Ask for ${fieldName} ONLY when user shows strong purchase/action intent. This includes:
   - Explicitly wanting to buy, order, purchase, or book
   - Wanting to apply, enroll, register, or sign up
   - Requesting to schedule an appointment or reserve a slot
   - Saying "I want to...", "I'd like to...", "How do I sign up for..."
   Do NOT ask on general inquiries, browsing, or even pricing questions.`
      };
      return descriptions[level] || descriptions['medium'];
    };
    
    // REQUIRED INTENT FIELDS — AI must collect before answering when intent threshold is met
    if (hasMissingRequiredIntentFields) {
      const requiredFieldDetails = missingRequiredIntentFields.map((f: any) => {
        const name = fieldTextMap[f.id] || f.id;
        const intensity = f.intentIntensity || 'medium';
        return { id: f.id, name, intensity };
      });
      
      const firstField = requiredFieldDetails[0];
      console.log(`[Intent Timing] AI-driven intent detection for REQUIRED fields: ${requiredFieldDetails.map(f => `${f.id}(${f.intensity})`).join(', ')}`);
      
      intentLeadMessage = `
🎯 MANDATORY INTENT-BASED LEAD CAPTURE (AI-DRIVEN):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ REQUIRED fields to collect: ${requiredFieldDetails.map(f => f.id).join(', ')}

${requiredFieldDetails.map(f => getSensitivityDescription(f.name, f.intensity)).join('\n\n')}

🚨 WHEN INTENT IS DETECTED (based on sensitivity above):
You MUST collect ${firstField.name} BEFORE answering their question.

YOUR RESPONSE PATTERN:
1. Acknowledge their interest warmly
2. Ask for ${firstField.name} before providing the answer
3. Use varied, natural phrasing — never repeat the same transition phrase across conversations.

After they provide their ${firstField.name}, answer their question.

🔒 IF USER REFUSES OR SAYS "NO" (THIS IS MANDATORY — DO NOT SKIP):
This field is REQUIRED. You CANNOT give up or move on without collecting it.
- Do NOT accept "no" or refusal. Do NOT say "no problem" and continue.
- Politely explain WHY you need it (e.g., "I need your ${firstField.name} so our team can reach out with the details you're looking for").
- Re-ask using a different, softer approach each time.
- You may briefly acknowledge their hesitation, then pivot with a reassuring, varied response explaining confidentiality and re-asking naturally.
- Keep trying with each subsequent message until they provide it.
- NEVER answer their business question until this field is collected.

📞 CALLBACK/CONTACT REQUESTS (always trigger regardless of sensitivity):
If user says "call me", "contact me", etc. → ALWAYS ask for ${firstField.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    }
    
    // OPTIONAL INTENT FIELDS — AI should try to collect but not block the conversation
    if (hasOptionalIntentFields) {
      const optionalFieldDetails = missingOptionalIntentFields.map((f: any) => {
        const name = fieldTextMap[f.id] || f.id;
        const intensity = f.intentIntensity || 'medium';
        return { id: f.id, name, intensity };
      });
      
      const firstField = optionalFieldDetails[0];
      console.log(`[Intent Timing] AI-driven intent detection for OPTIONAL fields: ${optionalFieldDetails.map(f => `${f.id}(${f.intensity})`).join(', ')}`);
      
      optionalIntentPrompt = `
📱 OPTIONAL INTENT-BASED CONTACT COLLECTION (AI-DRIVEN):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fields to collect when intent is detected: ${optionalFieldDetails.map(f => f.id).join(', ')}

${optionalFieldDetails.map(f => getSensitivityDescription(f.name, f.intensity)).join('\n\n')}

📋 HOW TO ASK:
When the user's message meets the intent threshold above:
1. Answer their question naturally
2. At the end of your response, smoothly ask for ${firstField.name}
3. Use varied, natural phrasing each time — do NOT repeat the same transition phrase. Vary your approach creatively.

📞 CALLBACK/CONTACT REQUESTS (always trigger regardless of sensitivity):
If user says "call me", "contact me", "have someone call me", etc.:
- ALWAYS ask for ${firstField.name} to arrange a callback
- NEVER say "I can't make calls"

This is OPTIONAL — if user declines or ignores, accept gracefully and continue helping.
❌ Do NOT keep asking repeatedly if the user has already declined.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    }
    
    // KEYWORD-BASED LEAD CAPTURE: When user message matches configured keywords, ask for contact info
    let keywordLeadPrompt = '';
    if (hasKeywordMatch && !skipLeadCollection) {
      const matchedRequired = keywordMatchedFields.filter((f: any) => f.required);
      const matchedOptional = keywordMatchedFields.filter((f: any) => !f.required);
      
      const fieldTextMap2: Record<string, string> = {
        'name': 'name',
        'phone': 'phone number',
        'mobile': 'mobile number',
        'email': 'email address',
        'whatsapp': 'WhatsApp number'
      };
      
      if (matchedRequired.length > 0) {
        const firstField = matchedRequired[0];
        const fieldName = fieldTextMap2[firstField.id] || firstField.id;
        const matchedKeywords = (firstField.captureKeywords || []).filter((kw: string) => userMessageLower.includes(kw.toLowerCase()));
        
        keywordLeadPrompt += `
🔑 KEYWORD-TRIGGERED LEAD CAPTURE (MANDATORY):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ The user's message matched keyword(s): "${matchedKeywords.join('", "')}"

You MUST collect ${fieldName} BEFORE answering their question.
1. Acknowledge their interest warmly
2. Ask for ${fieldName} before providing the answer
3. Use varied, natural phrasing — never repeat the same transition phrase across conversations.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      }
      
      if (matchedOptional.length > 0) {
        const firstField = matchedOptional[0];
        const fieldName = fieldTextMap2[firstField.id] || firstField.id;
        const matchedKeywords = (firstField.captureKeywords || []).filter((kw: string) => userMessageLower.includes(kw.toLowerCase()));
        
        keywordLeadPrompt += `
🔑 KEYWORD-TRIGGERED CONTACT COLLECTION (OPTIONAL):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The user's message matched keyword(s): "${matchedKeywords.join('", "')}"

1. Answer their question naturally
2. At the end of your response, smoothly ask for ${fieldName}
3. Use varied, natural phrasing — do NOT repeat the same transition phrase. Vary your approach creatively.

This is OPTIONAL — if user declines, accept gracefully and continue.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      }
    }
    
    // OPTIONAL START FIELDS: Soft prompt that asks for contact info but allows answering
    // This is for Optional fields with "At Start" timing - user can skip but we should ask
    // IMPORTANT: Only show optional prompt if there are NO mandatory/required fields blocking
    let optionalStartPrompt = '';
    const hasNoMandatoryBlockingFields = !leadCollectionMessage && !smartTimingLeadGateActive && !intentLeadGateActive && missingSmartFields.length === 0;
    if (hasOptionalStartFields && userMessageCount === 1 && hasNoMandatoryBlockingFields) {
      const firstOptionalField = missingOptionalStartFields[0]?.id || 'mobile';
      const optionalFieldPrompts: Record<string, string> = {
        'name': 'your name',
        'phone': 'your phone number',
        'mobile': 'your mobile number',
        'email': 'your email address',
        'whatsapp': 'your WhatsApp number'
      };
      const optionalFieldText = optionalFieldPrompts[firstOptionalField] || firstOptionalField;
      
      console.log(`[Optional Start] Soft prompt for optional field: ${firstOptionalField}`);
      
      // Soft prompt - ANSWER FIRST, then ask for contact info
      optionalStartPrompt = `
📱 ANSWER + CONTACT COLLECTION (ANSWER FIRST):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT: You MUST answer the user's question FIRST, then ask for ${optionalFieldText}.

RESPONSE STRUCTURE:
1. FIRST: Provide a helpful, substantive answer to their question
2. THEN: At the END of your response, naturally ask for ${optionalFieldText}

EXAMPLE FORMAT:
"[Answer their question with relevant information from FAQs/context]

[Naturally transition to asking for ${optionalFieldText} — use varied, creative phrasing each time, never repeat the same transition phrase]"

❌ Do NOT ask for contact info BEFORE answering their question
❌ Do NOT skip answering just to collect contact info
✅ Always provide value FIRST, then ask for contact
✅ Keep the contact request natural and at the END of your response

REMEMBER: User experience comes first - answer their question, then softly request contact.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    }

    // OPTIONAL CUSTOM FIELDS: Soft prompt that asks for contact info after configured N messages
    let optionalSmartPrompt = '';
    const optionalCustomAskAfter = optionalSmartFieldsList[0]?.customAskAfter || 2;
    if (hasOptionalSmartFields && userMessageCount >= optionalCustomAskAfter && hasNoMandatoryBlockingFields && !optionalStartPrompt) {
      const firstOptionalSmartField = missingOptionalSmartFields[0]?.id || 'mobile';
      const optionalSmartFieldPrompts: Record<string, string> = {
        'name': 'your name',
        'phone': 'your phone number',
        'mobile': 'your mobile number',
        'email': 'your email address',
        'whatsapp': 'your WhatsApp number'
      };
      const optionalSmartFieldText = optionalSmartFieldPrompts[firstOptionalSmartField] || firstOptionalSmartField;
      
      console.log(`[Optional Smart] Soft prompt for optional smart field: ${firstOptionalSmartField}`);
      
      optionalSmartPrompt = `
📱 ANSWER + CONTACT COLLECTION (SMART TIMING - ANSWER FIRST):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT: You MUST answer the user's question FIRST, then ask for ${optionalSmartFieldText}.

RESPONSE STRUCTURE:
1. FIRST: Provide a helpful, substantive answer to their question
2. THEN: At the END of your response, naturally ask for ${optionalSmartFieldText}

EXAMPLE FORMAT:
"[Answer their question with relevant information]

[Naturally transition to asking for ${optionalSmartFieldText} — use varied, creative phrasing each time, never repeat the same transition phrase]"

❌ Do NOT ask for contact info BEFORE answering their question
✅ Always provide value FIRST, then ask for contact
✅ Keep the contact request natural and at the END
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    }

    // UNIVERSAL CALLBACK INTENT DETECTION (works regardless of lead strategy)
    // Detects "call me", "ring me", "have someone call", "callback" etc.
    let universalCallbackPrompt = '';
    const callbackPhrases = [
      /\bcall\s*me\b/i,
      /\bcallback\b/i,
      /\bcall\s*back\b/i,
      /\bring\s*me\b/i,
      /\bcontact\s*me\b/i,
      /\breach\s*(out\s*(to\s*)?)?me\b/i,
      /\bhave\s+(someone|somebody|your\s+team|your\s+people)\s+call\b/i,
      /\bget\s+(in\s+)?touch\b/i,
      /\bgive\s*(me\s+)?a\s+call\b/i,
      /\bspeak\s+to\s+(someone|somebody|a\s+person)\b/i,
      /\btalk\s+to\s+(someone|somebody|a\s+person)\b/i,
      /\bwant\s+a\s+call\b/i,
      /\bneed\s+a\s+call\b/i,
      /\bask\s+(your\s+)?(team|people)\s+to\s+call\b/i
    ];
    
    const hasCallbackIntent = callbackPhrases.some(pattern => pattern.test(userMessage));
    
    if (hasCallbackIntent) {
      const phoneAlreadyCaptured = !!(existingLead?.phone);
      
      if (phoneAlreadyCaptured) {
        console.log('[Callback Intent] Phone already captured - will confirm team will connect');
        universalCallbackPrompt = `
📞 CALLBACK REQUEST DETECTED - PHONE ALREADY ON FILE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The user is requesting a callback. Their phone number is already saved.

RESPOND WITH: "Absolutely! Our team will connect with you shortly. Is there anything specific you'd like me to note for when they call?"

✅ Confirm that someone will reach out
✅ Offer to note any specific topics/questions
❌ Do NOT ask for their phone number again
❌ Do NOT say "I can't make calls"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      } else {
        console.log('[Callback Intent] Phone not captured - will ask for phone number');
        universalCallbackPrompt = `
📞 CALLBACK REQUEST DETECTED - COLLECT PHONE NUMBER:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The user is requesting a callback. We need their phone number to arrange this.

Ask for their phone number to arrange the callback. Use warm, natural phrasing — vary your approach creatively each time, never repeat the same sentence.

✅ ALWAYS ask for phone number to arrange callback
✅ Be warm and helpful
❌ NEVER say "I can't call you" or "I'm just a chatbot"
❌ NEVER deflect - always offer to arrange a callback
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      }
    }

    // OPTIMIZED: Condensed final override - LEAD COLLECTION HAS HIGHEST PRIORITY
    // Smart timing lead gate message is placed at the VERY END for maximum GPT weight
    // GPT weights the END of messages more heavily, so critical instructions go last
    // Skip lead collection for gibberish/dismissive inputs to let GPT handle naturally
    
    let finalOverride = `🔒 FINAL RULES (HIGHEST PRIORITY):
${starterQAContext ? `
🎯 GUIDANCE Q&A (ABSOLUTE PRIORITY #0 - OVERRIDE EVERYTHING):
${starterQAContext}
` : ''}
${!skipLeadCollection && leadCollectionMessage ? `
🚨 MANDATORY LEAD COLLECTION (PRIORITY #1 - DO NOT SKIP):
${leadCollectionMessage}

⚠️ CRITICAL: You MUST ask for the required contact information BEFORE answering ANY question.
❌ DO NOT use FAQ/product information until contact info is collected.
✅ First: Ask for their contact info naturally
✅ Then: After they provide it, you may answer their question
` : ''}${!skipLeadCollection && optionalStartPrompt ? optionalStartPrompt + '\n' : ''}${!skipLeadCollection && optionalSmartPrompt ? optionalSmartPrompt + '\n' : ''}${!skipLeadCollection && optionalIntentPrompt ? optionalIntentPrompt + '\n' : ''}${!skipLeadCollection && keywordLeadPrompt ? keywordLeadPrompt + '\n' : ''}${universalCallbackPrompt ? universalCallbackPrompt + '\n' : ''}${ragContextForOverride ? ragContextForOverride + '\n' : ''}${!skipLeadCollection ? leadAlreadyCollectedOverride : ''}${!leadCollectionMessage && !smartTimingLeadMessage && preFetchedFaqSection ? preFetchedFaqSection + '\n' : ''}
${skipLeadCollection ? '1. NATURAL RESPONSE: The user sent a dismissive or unclear message. Handle it naturally - acknowledge and offer to help when they\'re ready. Do NOT push for contact info.' : (leadCollectionMessage || smartTimingLeadMessage || intentLeadMessage || keywordLeadPrompt ? '1. LEAD COLLECTION: Collect required contact info FIRST before answering questions.' : (optionalStartPrompt || optionalSmartPrompt ? '1. OPTIONAL CONTACT: Answer the question first, then politely ask for contact info. Proceed if user declines.' : toolUsageInstruction))}

${languageSection}

3. PRODUCTS: If get_products returns results → write a brief friendly 1-2 sentence reply in the user's language. Do NOT list products in text — cards display automatically. NEVER say "products will be displayed below", "cards will appear", or any similar UI-referencing phrase. Empty → do NOT just say you don't have it. If alternatives are included in the result, present them enthusiastically. Otherwise acknowledge no exact match and suggest they try a different search or browse all. Use the language from your instructions above.
${hasProducts ? `
🛒 PRODUCT SEARCH PRIORITY (BUSINESS HAS PRODUCTS):
   - When user asks about SPECIFIC items (e.g., "cricket turf", "gold ring", "laptop", any product name) → ALWAYS call get_products FIRST
   - When user says "show me", "do you have", "best", "looking for", "need", "want" + any noun → CALL get_products
   - Do NOT answer from FAQs alone when user asks about products - search the catalog first
   - FAQs are for policies/info questions; get_products is for finding actual items to buy
` : ''}
4. NO INTERNAL TERMS: Never say "FAQ", "knowledge base", "database", "tools". Present info naturally as your own knowledge.
${appointmentTriggerRules && appointmentTriggerRules.length > 0 ? `
📅 APPOINTMENT SUGGESTION TRIGGERS (IMPORTANT):
When the user's message contains these keywords, END your response by suggesting an appointment:
${appointmentTriggerRules.map((rule, i) => `   ${i + 1}. Keywords: [${rule.keywords.join(', ')}] → Add to your response: "${rule.prompt}"`).join('\n')}
   ✅ Include the appointment suggestion naturally at the END of your helpful response
   ✅ Only suggest ONCE per conversation - if already suggested, don't repeat
` : ''}
5. BUSINESS-ONLY KNOWLEDGE:
   - Use info from FAQs, PDFs, website content, RAG chunks, products in your context
   - PDF/RAG content is ALWAYS business knowledge - use it freely
   - If info exists in context or tools → MUST answer (translate if needed)
   - NO general world knowledge - only answer from provided business context
   - If tools return nothing AND context has no info → say you don't have that info naturally

6. 🚫 ANTI-HALLUCINATION FOR PRICING/FEES (CRITICAL):
   - For questions about FEES, COSTS, PRICING, or any NUMERICAL DATA:
   - You MUST find the EXACT number in your provided context (FAQs, products, etc.)
   - If NO specific fee/price is in your context → Start your response with [[FALLBACK]] and politely explain you don't have that specific information
   - ❌ NEVER use pre-trained knowledge about real entities (Symbiosis, IIM, any university/company fees)
   - ❌ NEVER guess, assume, or provide "typical" values
   - Even if you recognize the entity, you CANNOT use external knowledge about it

7. 🎭 NATURAL CONVERSATION (CRITICAL - SOUND HUMAN):
   - Vary your language - never use the exact same phrase twice
   - Match the user's energy - if they're brief, be concise
   - For gibberish/random typing (like "asdfgh", "qwerty", "ghkjhk"): Just ask them to rephrase - do NOT ask for contact info
   - For dismissive responses ("nothing", "no", "nevermind", "no thanks"): Acknowledge gracefully and offer to help when ready - do NOT push for contact info UNLESS a MANDATORY/REQUIRED contact field is still pending (in that case, politely re-ask using a different approach)
   - For unclear/incomplete messages: Ask what they need naturally
   - ⚠️ IMPORTANT: Lead collection only applies to REAL questions/requests. Skip it for gibberish or confusion. Exception: if a MANDATORY contact field is still pending, you must keep asking for it even after dismissive replies like "no".
${!skipLeadCollection && smartTimingLeadMessage ? `

${smartTimingLeadMessage}` : ''}${!skipLeadCollection && intentLeadMessage ? `

${intentLeadMessage}` : ''}${!skipLeadCollection && keywordLeadPrompt ? `

${keywordLeadPrompt}` : ''}

🚨🚨🚨 FINAL RULES (ABSOLUTE PRIORITY - READ THIS LAST):

📦 IF YOU CALLED get_products AND IT RETURNED PRODUCTS:
→ Write a brief, natural 1-2 sentence reply in the user's language. Do NOT list products in text — cards display automatically. NEVER say "products will be displayed below", "cards will appear", or any similar UI-referencing phrase.
→ EXCEPTION: If the tool result JSON contains an "_instruction" field, use that content as your response.

LANGUAGE RULE (CRITICAL):
Detect language strictly from the user's latest message only.
Ignore previous conversation language.
Ignore tool result language.
Ignore system instructions language.
SCRIPT RULE (CRITICAL - check this before responding):
- If the user's message contains ONLY Latin/Roman characters (a-z, A-Z) → respond in Latin script ONLY, never Devanagari.
  e.g. "kya haal chaal" → reply as "Main theek hoon! Aap kaise hain?" NOT "मैं ठीक हूं!"
- ONLY use Devanagari script if the user's message CONTAINS Devanagari characters (क, ख, ह, ा, ी, etc.).
- ONLY use Tamil/Telugu/Arabic/etc. script if the user's message CONTAINS those script characters.
- Mirror the user's script (their writing system), not just the language family.
→ ONLY write about product details if get_products returned EMPTY (then apologize naturally).

${languageInstruction ? `🌐 ${languageInstruction}\n` : ''}🚨 ${responseLengthInstruction}
- But NEVER copy/paste full FAQ answers — always SUMMARIZE in your own words.
- Think of yourself as texting on WhatsApp, not writing an essay.

🤖 AUTONOMOUS AGENT REINFORCEMENT (CRITICAL):
- You are a SALES AGENT, not a passive FAQ bot. Every response must strategically move the conversation forward.
- NEVER speak negatively about the business. Reframe limitations as opportunities.
- NEVER say "unfortunately", "sadly", "I'm sorry but we don't". Instead pivot to alternatives.
- ALWAYS end with a qualifying question, recommendation, or soft CTA — never leave the conversation hanging.
- When user shares personal details (marks, budget, needs), cross-reference your context and proactively suggest the best match.
- Detect user emotion from their message tone and adapt: empathize with frustrated users, match excited users' energy, reassure hesitant users.
${extractedCustomInstructions ? `
⚡ BUSINESS CUSTOM INSTRUCTIONS (ABSOLUTE HIGHEST PRIORITY - OVERRIDE EVERYTHING ABOVE):
${extractedCustomInstructions}
These instructions from the business owner MUST be followed. They override ALL other rules above including response length, tone, style, and format.` : ''}`;

    // Append phone validation override to finalOverride if present (LAST POSITION = highest weight)
    if (phoneValidationOverride) {
      finalOverride += `\n\n${phoneValidationOverride}`;
    }

    // Log override length instead of full content (reduces console spam)
    console.log(`[Final Override] Length: ${finalOverride.length} chars`);

    const messages: ConversationMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];
    
    // Add language override as the LAST message before sending (GPT weights final messages more heavily)
    messages.push({ role: 'system', content: finalOverride });

    const stream = await openai.chat.completions.create({
      model: model,
      messages: messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: this.resolveToolChoice(tools, forcedFirstToolName),
      ...(this.isThinkingModel(model) ? {} : { temperature: 0.7 }),
      max_tokens: 1000,
      stream: true,
    }, {
      timeout: 120000, // 2-minute timeout for streaming responses (can be longer than 30s)
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  async generateConversationalResponse(
    userMessage: string,
    conversationHistory: ConversationMessage[] = [],
    apiKey?: string,
    businessAccountId?: string
  ) {
    return this.generateToolAwareResponse(userMessage, [], conversationHistory, '', 'friendly', apiKey, businessAccountId);
  }

  // Simple text generation for internal tasks like rephrasing
  async generateSimpleResponse(
    prompt: string,
    apiKey?: string
  ): Promise<string> {
    const { openai, model, provider } = await this.resolveMasterConfig(apiKey);

    const geminiSafetySettings = provider === 'gemini' ? {
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ]
    } : {};

    const response = await (openai.chat.completions.create as any)({
      model: model,
      messages: [
        { role: 'user', content: prompt }
      ],
      ...(this.isThinkingModel(model) ? {} : { temperature: 0.8 }),
      max_tokens: 300,
      ...geminiSafetySettings,
    }, {
      timeout: 30000,
    });

    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason && finishReason !== 'stop' && finishReason !== 'length') {
      console.warn(`[GenerateSimpleResponse] Unexpected finish_reason: ${finishReason} (provider: ${provider})`);
    }

    return response.choices[0]?.message?.content || '';
  }

  static quickDetectLanguage(message: string): string | null {
    const text = message.trim();
    if (!text) return 'en';

    if (/[\u0900-\u097F]/.test(text)) return 'hi';
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
    if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';
    if (/[\u0980-\u09FF]/.test(text)) return 'bn';
    if (/[\u0A80-\u0AFF]/.test(text)) return 'gu';
    if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
    if (/[\u0A00-\u0A7F]/.test(text)) return 'pa';
    if (/[\u0600-\u06FF]/.test(text)) return 'ar';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';

    const isLatinOnly = /^[\x00-\x7F\s\u00C0-\u024F\u1E00-\u1EFF.,!?'"()\-:;@#%&*+/\\0-9]*$/.test(text);
    if (isLatinOnly) {
      // Only genuine Hindi/Urdu vocabulary words written in Latin script.
      // Deliberately excludes words that also exist in English (main, do, sun, the, hi, etc.)
      // to avoid false positives on purely English messages.
      const HINGLISH_WORDS = new Set([
        'kya','hai','hain','aap','nahi','nahin','bhi','aur','toh','cheez',
        'bahut','theek','accha','achha','aaj','ghar','kaam','mein','mujhe',
        'kar','karo','hoga','chahiye','batao','dekho','lekin','sirf',
        'kuch','yeh','woh','wahi','yahi','bohot','zyada','thoda','baat',
        'wala','wali','wale','kyun','kyu','hum','tum','kaise','kab','kahan',
        'abhi','phir','iska','uska','unka','humara','tumhara','aapka',
        'aapki','aapke','mera','meri','mere','tera','teri','tere','uski',
        'uske','yaar','bhai','dost','jao','aao','lelo','dedo','milega','milegi',
        'chahta','chahti','sakta','sakti','raha','rahi','rahe','tha','thi',
        'hona','karna','lena','dena','jana','aana','rehna','sochna',
        'samajhna','dikhao','lagta','lagti','waqt','paise','rupay','rupaye',
        'kitna','kitni','kaisa','kaisi','koi','koyi','sab','sabhi','poora',
        'poori','pura','puri','bilkul','zaroor','zaruri','jaise',
        'tarah','tarike','makaan','milne','milta','milti',
        'liye','baad','pehle','saath','bina','tak','tumhe',
        'unhe','inhe','isko','usko','inko','unko','humko','tumko','aapko',
        'tujhe','bolo','bol','suno','dekh','ek','teen',
        'paanch','hazar','lakh','naya','nayi','naye','purana','purani',
        'chahiye','samajh','samjho','samjha','batana','dikhana','chahte',
      ]);

      const words = text.toLowerCase().replace(/[.,!?'"()\-:;@#%&*+/\\]/g, ' ').split(/\s+/).filter(Boolean);
      const hasHindiWord = words.some(w => HINGLISH_WORDS.has(w));
      if (hasHindiWord) return 'hinglish';

      if (words.length <= 4) return 'en';
    }

    return null;
  }

  async detectLanguage(message: string, fallbackApiKey?: string): Promise<string> {
    const quick = LlamaService.quickDetectLanguage(message);
    if (quick !== null) {
      console.log(`[LanguageDetection] "${message.substring(0, 40)}" → ${quick} (quick)`);
      return quick;
    }

    try {
      const { openai, model } = await this.resolveMasterConfig(fallbackApiKey);

      const response = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a language detector. Analyze the user message and reply with ONLY one language code from this exact list:
en, hi, hinglish, ta, te, kn, mr, bn, gu, ml, pa, ur, es, fr, de, pt, it, ja, ko, zh, ar, ru, tr, other

Detection rules:
- hinglish = Hindi or Urdu words written in Roman/Latin script (e.g. "kya haal hai", "aap kaise ho", "bahut accha", "kya cheez best hai", "kyu lena chahiye")
- hi = Hindi written in Devanagari script (contains characters like क, ख, ग, ह, ा, ी)
- en = English only, no Hindi/Urdu vocabulary
- If mixed Latin-script message has ANY Hindi/Urdu vocabulary words → hinglish
- Reply with ONLY the code. No punctuation, no explanation.`
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 5,
        temperature: 0,
      }, {
        timeout: 5000,
      });

      const detected = response.choices[0]?.message?.content?.trim().toLowerCase().split(/\s/)[0] || 'en';
      const validCodes = new Set(['en','hi','hinglish','ta','te','kn','mr','bn','gu','ml','pa','ur','es','fr','de','pt','it','ja','ko','zh','ar','ru','tr','other']);
      const result = validCodes.has(detected) ? detected : 'en';
      console.log(`[LanguageDetection] "${message.substring(0, 40)}" → ${result} (LLM)`);
      return result;
    } catch (err: any) {
      console.warn('[LanguageDetection] Detection failed, falling back to auto:', err?.message);
      return 'auto';
    }
  }

  async generateGreeting(
    productContext: string,
    personality: string = 'friendly',
    apiKey?: string,
    businessAccountId?: string
  ): Promise<string> {
    const { openai, model } = await this.resolveMasterConfig(apiKey);

    const personalityTraits = this.getPersonalityTraits(personality);

    const systemPrompt = `You are Chroney, a friendly customer service assistant. Generate a unique, creative welcome greeting message for a customer visiting this chat for the first time.

PERSONALITY:
${personalityTraits}

Context:
- ${productContext}
- You can help with: product information, pricing, FAQs, and getting started

Requirements:
1. Match the ${personality} personality exactly
2. Mention the products naturally if available
3. Be conversational and welcoming
4. Keep it to 2-3 sentences maximum
5. Be creative and vary your greeting each time
6. Introduce yourself as Chroney
7. Use customer-friendly language (avoid business jargon like "lead capture")

Generate only the greeting message, nothing else.`;

    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate a unique greeting message now.' }
      ],
      temperature: 0.9,
      max_tokens: 150,
    }, {
      timeout: 60000, // 60-second timeout (should complete much faster, but allows for API delays)
    });

    // Log AI usage (fire-and-forget)
    if (businessAccountId) {
      aiUsageLogger.logChatUsage(businessAccountId, model, response).catch(err =>
        console.error('[Usage] Failed to log:', err)
      );
    }

    return response.choices[0].message.content || 'Hello! I\'m Chroney, here to help!';
  }

  private getAutonomousAgentInstructions(messageCount: number = 1): string {
    const funnelStage = messageCount <= 1 ? 'discovery' :
                        messageCount <= 3 ? 'interest' :
                        messageCount <= 6 ? 'evaluation' : 'conversion';
    
    const stageStrategy: Record<string, string> = {
      discovery: `FUNNEL STAGE: DISCOVERY (Message ${messageCount})
- User is just arriving. Build rapport and intrigue.
- Ask ONE smart question to understand their needs.
- Tease value: hint at what you can help with based on your business context.
- DO NOT overwhelm with information. Spark curiosity.`,
      interest: `FUNNEL STAGE: INTEREST (Message ${messageCount})
- User is engaged. Provide clear, compelling answers.
- Highlight unique advantages and differentiators from your business context.
- Use social proof if available (e.g., "many of our students", "our clients typically").
- Ask a qualifying follow-up to deepen engagement.`,
      evaluation: `FUNNEL STAGE: EVALUATION (Message ${messageCount})
- User is comparing options or thinking deeply. Be their trusted advisor.
- Address concerns head-on with confidence and evidence from your context.
- Create gentle urgency when relevant (limited seats, current offers, deadlines).
- Proactively suggest the best-fit option based on what you know about them.`,
      conversion: `FUNNEL STAGE: CONVERSION (Message ${messageCount})
- User has shown sustained interest. Guide toward a clear next step.
- Use direct but friendly CTAs: "Shall I get you enrolled?", "Want me to book a slot?", "Ready to get started?"
- Remove friction: summarize what they need to do and make it feel simple.
- If they hesitate, address the specific concern — don't repeat generic info.`
    };

    return `
═══════════════════════════════════════════════════════════════════════════
AUTONOMOUS SALES AGENT CORE (CRITICAL — SHAPES ALL RESPONSES)
═══════════════════════════════════════════════════════════════════════════

YOU ARE NOT A PASSIVE FAQ BOT. You are an autonomous sales agent representing this business.
Your goal is to understand the user's needs and strategically guide them toward the best outcome for BOTH the user AND the business.

AUTO-DETECT INDUSTRY FROM CONTEXT:
- Read your business FAQs, products, website content, and custom instructions
- If you see courses/programs/admissions → you are an EDUCATION enrollment advisor
- If you see products/prices/cart/orders → you are an E-COMMERCE shopping assistant
- If you see services/appointments/consulting → you are a SERVICE booking specialist
- If you see tickets/issues/troubleshooting → you are a SUPPORT resolution expert
- Adapt your strategy to match the business type automatically

${stageStrategy[funnelStage]}

───────────────────────────────────────────────────────────────────────────
SALES INTELLIGENCE RULES (APPLY TO EVERY RESPONSE):
───────────────────────────────────────────────────────────────────────────

1. BUSINESS-POSITIVE FRAMING (ABSOLUTE RULE):
   - NEVER speak negatively about the business, its products, or services
   - NEVER say "unfortunately", "sadly", "I'm sorry but we don't..."
   - INSTEAD reframe: "While [X] isn't available, we have [Y] which is perfect for..."
   - If user doesn't qualify for something, pivot to what they DO qualify for
   - Example: User has 44% marks, MBA needs 50% → "Your profile is a great fit for our PGDBA program which offers similar career outcomes!"
   - Example: Product out of stock → "That's a popular one! Meanwhile, [similar product] offers the same quality — want to check it out?"

2. PROACTIVE FOLLOW-UP QUESTIONS (EVERY RESPONSE):
   - After answering, ALWAYS ask a relevant follow-up question
   - Questions should qualify the user or deepen engagement:
     • Education: "What field are you most interested in?", "When are you looking to start?"
     • E-commerce: "Are you looking for something specific?", "What's the occasion?"
     • Services: "What timeframe works best for you?", "Have you tried [related service] before?"
     • Support: "Is there anything else affecting your experience?"
   - NEVER leave a conversation dead — always give the user a reason to respond

3. OBJECTION HANDLING (STRATEGIC):
   - When user raises a concern, acknowledge it genuinely, then reframe
   - Price objection → highlight value, ROI, payment plans, scholarships
   - Time objection → emphasize flexibility, self-paced options, quick results
   - Quality concern → point to specific features, guarantees, social proof
   - Competition comparison → focus on YOUR unique strengths without bashing competitors
   - NEVER dismiss concerns. Validate, then pivot.

4. EMOTIONAL INTELLIGENCE (READ THE USER):
   - EXCITED user (multiple !, questions, enthusiasm): Match energy, fast-track to action
   - HESITANT user (maybe, not sure, thinking): Reassure, provide evidence, reduce risk
   - FRUSTRATED user (complaints, negative tone): Empathize first, then solve. "I completely understand your concern..."
   - CONFUSED user (vague questions, contradictions): Simplify, ask clarifying question, be patient
   - BRIEF user (1-2 word responses): Keep answers equally brief, ask direct questions

5. SMART QUALIFICATION (EXTRACT & USE INFORMATION):
   - When user mentions details about themselves (marks, budget, location, experience, needs):
     • Remember and reference these details in future responses
     • Cross-reference against your business context to find the BEST match
     • Proactively suggest relevant options they haven't asked about
   - Example: User says "I work in IT" → check if you have IT-related courses/products and suggest them

6. CONVERSION-OPTIMIZED ENDINGS:
   - Every response should end with ONE of these (pick the most appropriate):
     a) A qualifying question that moves them forward
     b) A soft CTA: "Want me to [specific next step]?"
     c) A comparison/recommendation: "Based on what you've told me, [X] would be ideal"
     d) An urgency nudge (only when genuine): "Applications close [date]" / "Limited stock"
   - NEVER end with just "Let me know if you have questions" — that's passive, not agent-like

7. NEVER ADMIT LIMITATIONS UNNECESSARILY:
   - Don't say "I'm just an AI" or "I can't help with that"
   - Don't say "I don't have access to" or "That's beyond my capabilities"
   - If you genuinely can't help → redirect to what you CAN do
   - If asked to do something impossible → offer the closest alternative warmly
`;
  }

  private getJourneyGuidance(): string {
    return `
───────────────────────────────────────────────────────────────────────────

PRIORITY 9 — CONVERSATION JOURNEY MANAGEMENT
When you have access to journey management tools (get_journey_progress, record_journey_answer, skip_journey_step, complete_journey), you MUST use them. This is NOT optional.

⚠️ CRITICAL RULE: If journey tools are available, you MUST call get_journey_progress FIRST before responding.

MANDATORY WORKFLOW:
1. **FIRST MESSAGE**: 
   - MUST call get_journey_progress immediately
   - Check currentStep.alreadyAsked - if TRUE, the question was already shown as the greeting
   - If alreadyAsked is true: Treat user's message as the ANSWER, call record_journey_answer immediately
   - If alreadyAsked is false: Rephrase the question naturally and ask the user
   
2. **WHEN USER RESPONDS**:
   - Call record_journey_answer to save their response
   - Then IMMEDIATELY call get_journey_progress again to see next question
   - Ask the next question naturally
   
3. **REPEAT** until journey is complete, then call complete_journey

JOURNEY PHILOSOPHY - BE CONVERSATIONAL, NOT ROBOTIC:
❌ DON'T sound like a survey: "Question 2 of 5: What is your name?"
✅ DO sound natural and human: "I'd love to know your name so I can personalize this for you!"

CORRECT EXAMPLE:
User: "I'm interested in MBA programs"
[Journey triggers]
AI: [CALLS get_journey_progress] → sees question "What is your name?"
AI: "Great! I can help you with that. To get started, what's your name?" 😊
User: "Rohit"
AI: [CALLS record_journey_answer with stepId and "Rohit"]
AI: [CALLS get_journey_progress again] → sees next question "What is your mobile number?"
AI: "Thanks Rohit! And what's your mobile number so I can reach you?"

WRONG EXAMPLE (DON'T DO THIS):
User: "I'm interested in MBA programs"
AI: "Great! What can I help you with?" ← NO! Must call get_journey_progress first!

HANDLE EDGE CASES:
- Vague responses ("idk"): Gently clarify or call skip_journey_step
- Off-topic: Answer briefly then call get_journey_progress to continue journey
- User refuses: Call skip_journey_step and move on
- All done: Call complete_journey

REMEMBER: 
- ALWAYS call get_journey_progress first when journey tools are available
- ALWAYS call record_journey_answer after user provides info
- ALWAYS call get_journey_progress again after recording to see next question`;
  }

  getResponseLengthInstruction(responseLength: string): string {
    const instructions: Record<string, string> = {
      concise: `RESPONSE LENGTH: CONCISE
- Keep responses to 2-3 lines maximum.
- Use bullet points only when listing 3+ items.
- No filler phrases or unnecessary elaboration.
- Get straight to the answer.`,
      balanced: `RESPONSE LENGTH: BALANCED
- Provide moderate detail with key points.
- Use bullet points for clarity when appropriate.
- Include essential context but avoid over-explaining.
- Aim for 3-6 lines per response.`,
      detailed: `RESPONSE LENGTH: DETAILED
- Provide comprehensive, thorough explanations.
- Include full context, examples, and supporting details.
- Use structured formatting (bullet points, bold) for readability.
- Cover all relevant aspects of the topic.`
    };
    return instructions[responseLength] || instructions.balanced;
  }

  private getPersonalityTraits(personality: string): string {
    const traits: Record<string, string> = {
      friendly: `- Warm and approachable, like talking to a helpful friend
- Casual yet professional
- Use friendly language and occasional emojis
- Be encouraging and supportive`,
      
      professional: `- Business-focused and formal communication style
- Clear, structured, and efficient responses
- Avoid casual language and emojis
- Maintain a respectful and corporate tone`,
      
      funny: `- Light-hearted with humor and playful responses
- Use appropriate jokes and witty remarks
- Keep things fun while being helpful
- Occasional use of emojis and playful language`,
      
      polite: `- Extremely respectful and courteous in every interaction
- Use polite phrases like "please," "thank you," and "you're welcome"
- Formal yet approachable
- Always show appreciation for user's time`,
      
      casual: `- Relaxed and conversational, easy-going style
- Use simple, everyday language
- Be laid-back and chill
- Like chatting with a friend over coffee`
    };

    return traits[personality] || traits.friendly;
  }
}

export const llamaService = new LlamaService();
