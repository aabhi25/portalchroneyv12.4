import OpenAI from 'openai';

// ENGINE-DRIVEN JOURNEYS: Feature flag to control journey mode
// true = AI-guided (AI uses journey tools), false = Engine-driven (engine controls flow)
const AI_GUIDED_JOURNEYS_ENABLED = false;

// AI-based product intent classification (fallback when regex doesn't match)
// Uses a quick, cheap AI call to detect product requests in any language
// Now accepts conversation history to understand follow-up queries in context
async function classifyProductIntent(
  message: string,
  conversationHistory: Array<{ role: string; content: string }> = [],
  apiKey?: string
): Promise<boolean> {
  try {
    const { llamaService } = await import('./llamaService');

    // Build context from recent conversation history (last 4 messages for efficiency)
    const recentHistory = conversationHistory.slice(-4);
    const historyContext = recentHistory.length > 0
      ? `\n\nRecent conversation:\n${recentHistory.map(m => `${m.role}: ${(m as any).content || (m as any).message || ''}`).join('\n')}`
      : '';

    const prompt = `You are a message classifier. Determine if the user's CURRENT message is about PRODUCTS/ITEMS, considering the conversation context.

Return "YES" if:
- User is asking to see, browse, or buy products/items
- User is filtering or refining a PREVIOUS product search (e.g., price filters, color, size)
- User is continuing a product browsing session with follow-up criteria

Return "NO" if:
- User is greeting, casual chat, or asking non-product questions
- Message is unrelated to shopping/browsing products

CRITICAL: If the previous messages were about products (e.g., "show me necklaces") and the current message is a filter/refinement (e.g., "under 5 lakh", "in gold color", "something cheaper"), return "YES" because this is a product filter.

Examples:
- "kuch tshirts dikhao" → YES (asking to show t-shirts)
- "show me rings" → YES
- "under 5 lakh" (after "show me necklaces") → YES (price filter on previous product query)
- "in gold color" (after product query) → YES (color filter)
- "something cheaper" (after seeing products) → YES (price filter)
- "kya haal chaal" → NO (greeting)
- "hello" → NO (greeting)
- "what are your store hours?" → NO (info question)${historyContext}

User message: ${message}
Answer (YES or NO):`;

    const raw = await llamaService.generateSimpleResponse(prompt, apiKey);
    const result = raw?.trim().toUpperCase().startsWith('YES') ? 'YES' : 'NO';
    console.log(`[AI Product Intent] "${message}" → ${result}${recentHistory.length > 0 ? ` (with ${recentHistory.length} history msgs)` : ''}`);
    return result === 'YES';
  } catch (error) {
    console.log(`[AI Product Intent] Error classifying, defaulting to false:`, error);
    return false;
  }
}

export async function classifyOrderLookupIntent(
  message: string,
  conversationHistory: Array<{ role: string; content: string }> = [],
  apiKey?: string
): Promise<boolean> {
  const m = message.toLowerCase();

  // Fast-path: skip AI call entirely if no order-related keyword present
  const orderKeywords = ['order', 'package', 'parcel', 'shipment', 'delivery', 'dispatch', 'track', 'courier'];
  if (!orderKeywords.some(kw => m.includes(kw))) return false;

  try {
    const { llamaService } = await import('./llamaService');
    const recentHistory = conversationHistory.slice(-4);
    const historyContext = recentHistory.length > 0
      ? `\n\nRecent conversation:\n${recentHistory.map(h => `${h.role}: ${(h as any).content || (h as any).message || ''}`).join('\n')}`
      : '';

    const prompt = `You are a message classifier for an e-commerce chatbot. Determine if the user wants to TRACK, FIND, or CHECK THE STATUS of an existing order/package.

Return "YES" if the user is:
- Asking where their order is
- Wanting to track an order or package
- Asking about delivery status, shipment status, or dispatch status
- Asking when their order will arrive
- Requesting an order update or follow-up on an existing purchase

Return "NO" if:
- User is placing a NEW order or shopping for products
- User is asking general product/shipping policy questions
- Message is unrelated to a specific existing order${historyContext}

Examples:
- "where is my order" → YES
- "where is the order" → YES
- "mera order kahan hai" → YES
- "track my shipment" → YES
- "delivery kab aayega" → YES
- "has my package been dispatched" → YES
- "show me dresses under 2000" → NO
- "what is your return policy" → NO
- "hello" → NO

User message: ${message}
Answer (YES or NO):`;

    const raw = await llamaService.generateSimpleResponse(prompt, apiKey);
    const result = raw?.trim().toUpperCase().startsWith('YES') ? 'YES' : 'NO';
    console.log(`[AI Order Lookup Intent] "${message}" → ${result}`);
    return result === 'YES';
  } catch (error) {
    console.log(`[AI Order Lookup Intent] Error, falling back to phrase list:`, error);
    // Fallback: phrase list (original + new "the/this/an" variants) so the feature
    // never goes dark when the AI provider is unavailable
    const fallbackPhrases = [
      // "my" variants (original)
      'where is my order', "where's my order", 'where my order',
      'track my order', 'order status', 'order tracking',
      'check my order', 'my order status', 'status of my order',
      'order update', 'order updates',
      'where is my package', "where's my package", 'track my package',
      'package status', 'shipment status', 'delivery status',
      'when will my order', 'when will my package', 'has my order', 'is my order',
      // "the / this / an / a" variants (new)
      'where is the order', 'where is this order', 'where is an order',
      'track the order', 'track order', 'check the order', 'check order',
      'status of the order', 'find my order', 'find the order',
      'locate my order', 'locate the order',
      'where is the package', 'track the package',
      'when will the order', 'when will the package',
    ];
    return fallbackPhrases.some(phrase => m.includes(phrase));
  }
}

export async function classifyReturnExchangeIntent(
  message: string,
  conversationHistory: Array<{ role: string; content: string }> = [],
  apiKey?: string
): Promise<boolean> {
  const m = message.toLowerCase();

  // Fast-path: skip AI call entirely if no return/exchange-related keyword present
  const returnKeywords = ['return', 'exchange', 'refund', 'replace', 'send back', 'wrong item', 'damaged', 'size issue', 'wapas', 'badalna', 'vapas', 'waapas'];
  if (!returnKeywords.some(kw => m.includes(kw))) return false;

  try {
    const { llamaService } = await import('./llamaService');
    const recentHistory = conversationHistory.slice(-4);
    const historyContext = recentHistory.length > 0
      ? `\n\nRecent conversation:\n${recentHistory.map(h => `${h.role}: ${(h as any).content || (h as any).message || ''}`).join('\n')}`
      : '';

    const prompt = `You are a message classifier for an e-commerce chatbot. Determine if the user wants to RETURN, EXCHANGE, or REFUND an existing order/product.

Return "YES" if the user is:
- Asking to return a product or order
- Requesting an exchange (different size, color, or item)
- Requesting a refund for an order
- Saying a product is damaged, wrong, or not as expected and wants action
- Saying they want to send a product back

Return "NO" if:
- User is asking about the POLICY for returns/exchanges (not initiating one)
- User is placing a new order or shopping for products
- Message is unrelated to returning or exchanging a specific item${historyContext}

Examples:
- "I want to return my order" → YES
- "want to exchange my dress" → YES
- "exchange karna hai" → YES
- "mujhe return karna hai" → YES
- "product damaged, want refund" → YES
- "send it back" → YES
- "wrong item received" → YES
- "wapas karna hai" → YES
- "what is your return policy" → NO
- "how do returns work" → NO
- "show me dresses" → NO
- "hello" → NO

User message: ${message}
Answer (YES or NO):`;

    const raw = await llamaService.generateSimpleResponse(prompt, apiKey);
    const result = raw?.trim().toUpperCase().startsWith('YES') ? 'YES' : 'NO';
    console.log(`[AI Return/Exchange Intent] "${message}" → ${result}`);
    return result === 'YES';
  } catch (error) {
    console.log(`[AI Return/Exchange Intent] Error, falling back to phrase list:`, error);
    // Fallback: phrase list so the feature never goes dark when AI provider is unavailable
    const fallbackPhrases = [
      'want to return', 'i want to return', 'return my order', 'return the order',
      'return this order', 'return my item', 'return my product', 'return my purchase',
      'want to exchange', 'i want to exchange', 'exchange my order', 'exchange the order',
      'exchange my item', 'exchange my product', 'exchange my dress', 'exchange my shirt',
      'want a refund', 'i want a refund', 'request a refund', 'get a refund',
      'send it back', 'send back', 'return it', 'exchange it',
      'wrong item', 'damaged item', 'damaged product', 'size issue',
      'wapas karna', 'vapas karna', 'waapas karna', 'badalna hai', 'exchange karna',
      'return karna', 'refund chahiye', 'wapas chahiye',
    ];
    return fallbackPhrases.some(phrase => m.includes(phrase));
  }
}

// Helper function to get current date in IST (Asia/Kolkata) timezone
function getCurrentDateIST(): { formatted: string; isoDate: string } {
  const now = new Date();
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const isoFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return {
    formatted: istFormatter.format(now),
    isoDate: isoFormatter.format(now) // Returns YYYY-MM-DD format
  };
}

// Phase 3 Task 10: Smart tool selection for 40-70% token savings
// Now accepts optional conversation history to detect ongoing appointment context
// Made async to support AI-based intent classification fallback
export async function selectRelevantTools(
  userMessage: string, 
  appointmentsEnabled: boolean = true, 
  isJourneyActive: boolean = false, 
  hasProducts: boolean = true,
  conversationHistory: Array<{ role: string; content: string }> = [],
  openaiApiKey?: string,
  systemMode?: string,
  k12EducationEnabled?: boolean,
  jobPortalEnabled?: boolean,
  demoOrdersEnabled?: boolean
): Promise<typeof aiTools> {
  const lowerMessage = userMessage.toLowerCase().trim();
  
  // Check conversation history for appointment context
  // If user was previously discussing appointments, keep those tools available
  // Handle both {role, content} and {role, message} formats for compatibility
  const hasAppointmentContextInUserHistory = conversationHistory.some(msg => {
    // Only check user messages to avoid false positives from assistant responses
    if (msg.role !== 'user') return false;
    // Handle both content and message property names
    const messageContent = ((msg as any).content || (msg as any).message || '').toLowerCase();
    return /appointment|book|schedule|available times|availability|slots|when can|meeting|consultation|friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow|next week|\d{1,2}:\d{2}\s*(am|pm)?|\d{1,2}\s*(am|pm)/i.test(messageContent);
  });
  
  // NEW: Also check if AI recently offered an appointment and user is confirming
  // This handles cases like: AI says "Would you like to book an appointment?" and user says "yes"
  const isUserConfirmingAppointment = (() => {
    // Normalize message: remove punctuation and extra whitespace for matching
    const normalizedMessage = lowerMessage.trim().replace(/[.,!?]/g, '').replace(/\s+/g, ' ');
    
    // Check for affirmative responses - both single word and multi-word variants
    // Matches: "yes", "yes please", "yes, that works", "sure, book it", "ok let's do it", etc.
    // NOTE: "please" alone is NOT a confirmation (e.g., "please share price" is not confirming appointment)
    const affirmativePatterns = [
      /^(yes|yeah|yep|yup|sure|ok|okay|definitely|absolutely)(\s|$)/i,
      /^(yes|yeah|sure|ok|okay)\s*please/i,
      /^please\s*(yes|book|schedule)/i,
      /^go ahead/i,
      /^let'?s do (it|that)/i,
      /^sounds good/i,
      /^that works/i,
      /^i'?d like (that|to\s*book)/i,
      /^book (it|that|me|an appointment)/i,
      /^schedule (it|that|me|an appointment)/i,
      /^i want to book/i,
      /^i'?d love to/i
    ];
    
    const isAffirmative = affirmativePatterns.some(pattern => pattern.test(normalizedMessage));
    if (!isAffirmative) return false;
    
    // Check if the last assistant message offered an appointment
    const recentAssistantMessages = conversationHistory
      .filter(msg => msg.role === 'assistant')
      .slice(-2); // Check last 2 assistant messages
    
    return recentAssistantMessages.some(msg => {
      const messageContent = ((msg as any).content || (msg as any).message || '').toLowerCase();
      // Look for appointment offer patterns in AI's response
      return /would you like to (book|schedule)|like to book an appointment|schedule an appointment|book a (time|slot|meeting|consultation)|want me to (book|schedule)|shall i (book|schedule)/i.test(messageContent);
    });
  })();
  
  const hasAppointmentContextInHistory = hasAppointmentContextInUserHistory || isUserConfirmingAppointment;
  
  if (hasAppointmentContextInUserHistory) {
    console.log(`[Smart Tools] Found appointment context in user history - keeping appointment tools available`);
  }
  if (isUserConfirmingAppointment) {
    console.log(`[Smart Tools] User is confirming AI's appointment offer - including appointment tools`);
  }
  
  // CRITICAL: Detect simple refusals - do NOT provide any lookup tools
  // When user says just "no", "nope", etc., they are declining, not asking for more info
  // Handle punctuation variants and multi-word polite refusals
  // Remove all punctuation, emojis, and normalize whitespace for matching
  const cleanedMessage = lowerMessage
    .replace(/[^\w\s]/g, ' ') // Remove all non-word characters (handles punctuation and emojis)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Token-based refusal detection for more flexibility
  // Detect if message contains a refusal indicator
  const hasRefusalWord = /\b(no|nope|nah|not interested|never mind|skip|pass|not now|no need|don t need|doesn t matter)\b/.test(cleanedMessage);
  const hasPoliteClose = /\b(i m good|i m okay|i m fine|i m all set|all set|that s okay|that s fine|that s alright|thanks but|no thanks|no thank you|no worries|appreciate it but|not right now|maybe later)\b/.test(cleanedMessage);
  const hasGoodbye = /^(thanks|thank you|bye|goodbye)$/.test(cleanedMessage);
  
  // Check if it's asking a question or requesting information (NOT a refusal)
  // BUT only if it's a POSITIVE request, not a negated one like "don't need more info"
  const isAskingQuestion = /\b(what|how|when|where|why|who|which|tell me|show me|can you|could you|want to know|need to know|do you have|looking for|find)\b/.test(cleanedMessage);
  const isRequestingMore = /\b(more|about|details|explain|info|information|pricing|price|cost|fee)\b/.test(cleanedMessage);
  
  // Check for negated info requests - these are STILL refusals even if they mention "info" or "more"
  // e.g., "I don't need any more info", "no more info thanks", "no need for details"
  const hasNegatedInfoRequest = /\b(don t need|no need|no more|don t want|not interested in|doesn t need)\b/.test(cleanedMessage);
  
  // A message is a refusal if:
  // 1. It has a refusal word OR is a polite close OR is a simple goodbye
  // 2. AND it's NOT asking a question (unless the info request is negated)
  // 3. AND it's reasonably short (up to 15 words - covers most polite refusals)
  const tokenCount = cleanedMessage.split(' ').length;
  const isReasonableLength = tokenCount <= 15;
  const isPositiveInfoRequest = (isAskingQuestion || isRequestingMore) && !hasNegatedInfoRequest;
  const isNotAskingForInfo = !isPositiveInfoRequest;
  const isSimpleRefusal = isReasonableLength && isNotAskingForInfo && (hasRefusalWord || hasPoliteClose || hasGoodbye);
  
  if (isSimpleRefusal) {
    console.log(`[Smart Tools] Detected simple refusal: "${userMessage}" → cleaned: "${cleanedMessage}" - returning NO lookup tools`);
    // Return only capture_lead (in case user provides contact info) but NO lookup tools
    return [getToolByName('capture_lead')]; // Just capture_lead, no get_products or get_faqs
  }
  
  // CHAT MODE: Pre-filter for greetings/chit-chat - return NO tools
  // This allows ChatGPT to respond naturally without calling any tools
  
  // IMPORTANT: First check if message contains contact info - these need capture_lead tool
  const hasPhoneNumber = /\d{10,}|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{10,}/.test(cleanedMessage);
  const hasEmail = /@/.test(cleanedMessage);
  // Name phrases: "my name is John", "I'm John Smith", "call me John"
  // Exclude common non-name phrases: "this is great", "it's fine", "I'm good", "I'm fine"
  const commonNonNames = /\b(good|fine|great|okay|ok|awesome|cool|nice|here|there|it|that|this|what|how|why|so|very|really|just|well|all|done|ready|interested|looking|sure|confused|happy|sad|busy|free|available)\b/i;
  const nameIntroPattern = /\b(my name is|i m |i am |call me )\s*([a-z]+)/i;
  const nameMatch = cleanedMessage.match(nameIntroPattern);
  // Only count as name if the captured word is NOT a common non-name word
  const hasNamePhrase = nameMatch && nameMatch[2] && !commonNonNames.test(nameMatch[2]);
  const looksLikeContactInfo = hasPhoneNumber || hasEmail || hasNamePhrase;
  
  // NUMBER REPLY DETECTION: Check if user replied with a number after products were shown
  const isNumberReply = /^\d{1,2}$/.test(cleanedMessage) || /^(option|number|item|choice)\s*\d{1,2}$/i.test(cleanedMessage);
  const hasRecentProductContext = conversationHistory.some(msg => {
    if (msg.role !== 'assistant') return false;
    const content = ((msg as any).content || '').toLowerCase();
    return /\[products shown:/.test(content) || /reply with a number/i.test(content);
  });
  
  if (isNumberReply && hasRecentProductContext && hasProducts) {
    console.log(`[Smart Tools] Number reply "${userMessage}" detected with recent product context - including product tool`);
    return [getToolByName('get_products')]; // get_products only
  }

  // Only apply CHAT mode if NOT contact info
  if (!looksLikeContactInfo) {
    const isSimpleGreeting = /^(hi|hey|hello|yo|sup|hiya|howdy|hola|namaste|greetings)[\s!?.]*$/i.test(cleanedMessage);
    const isTimeGreeting = /^(good\s*(morning|afternoon|evening|night|day))[\s!?.]*$/i.test(cleanedMessage);
    const isChitChat = /^(how are you|what s up|wassup|whats up|how s it going|how do you do)[\s!?.]*$/i.test(cleanedMessage);
    const isSimpleAck = /^(cool|nice|awesome|great|perfect|sounds good|got it|i see|understood|alright)[\s!?.]*$/i.test(cleanedMessage);
    
    if (isSimpleGreeting || isTimeGreeting || isChitChat || isSimpleAck) {
      console.log(`[Smart Tools] CHAT mode: Greeting/chit-chat detected "${userMessage}" - NO tools (natural conversation)`);
      return []; // No tools - ChatGPT will respond conversationally
    }
  }
  
  const selectedTools = [];
  
  // Tool selection logic based on query analysis
  
  // TIGHTENED: Product query detection - requires explicit product/catalog intent or specific phrases
  // Matches: "show products", "what do you sell", "view catalog", "product list", "price of X", "list of products"
  // Also matches targeted "do you have" with product nouns: "do you have CSE product", "do you have iPhone"
  const hasExplicitProductQuery = /\b(products?|items?|catalogs?|inventory|stock|merchandise)\b|what do you (sell|offer|have in stock)|show me (your )?(products?|catalogs?|items?)|view (products?|catalogs?|items?)|list of (products?|items?)|price of|how much (is|does|for)/i.test(lowerMessage);
  
  // Targeted "do you have X" that likely refers to products (when X looks like a product name)
  // Match: "do you have CSE", "do you have iPhone", "got any laptops"
  // Skip: "do you have information", "do you have a question"
  const hasTargetedProductQuery = /\b(do you have|got any|have any)\s+(?!information|question|help|about|faq|policy|website)([A-Z0-9]|[a-z]+\s+[a-z]+)/i.test(lowerMessage);
  
  // "Show me X" pattern - when user wants to see a specific product
  // Match: "show me black bottle", "show me stanley", "show me the tumbler"
  // Skip: "show me how", "show me more", "show me info", "show me details"
  const hasShowMeQuery = /\bshow me\s+(?!how|more|info|details|about|information|the way)(\w+)/i.test(lowerMessage);
  
  let hasProductQuery = hasExplicitProductQuery || hasTargetedProductQuery || hasShowMeQuery;
  
  // AI FALLBACK: If regex didn't detect product intent but we have an API key,
  // use AI to classify the message (handles Hindi/Hinglish like "kuch tshirts dikhao")
  // Only run AI classification if:
  // 1. Regex didn't match
  // 2. We have an API key
  // 3. Message is not a simple greeting (optimization)
  // 4. Business has products
  // 5. Message is NOT an obviously general/company/FAQ query (skip LLM for clear non-product intent)
  const simpleGreetings = /^(hi|hey|hello|hii|hiii|yo|sup|wassup|namaste|good\s*(morning|afternoon|evening|night))[\s!?.]*$/i;
  const isSimpleGreeting = simpleGreetings.test(lowerMessage);

  // Messages that start with or are dominated by general info keywords — clearly NOT product queries.
  // If the product regex already matched (hasExplicitProductQuery etc.), this is never reached.
  // Examples caught: "why should i choose", "why homelane", "how does this work",
  //                  "tell me about your company", "what is homelane", "kya haal chaal"
  const isObviouslyGeneralQuery =
    /^(why|how|what is|what are|who are|where|when|tell me|can you tell|explain|about|is there|are there|what makes|what sets|difference between|compare)\b/i.test(lowerMessage) ||
    /\b(company|brand|experience|team|founded|history|mission|vision|values|trust|reputation|reviews|quality|service|expertise|years|established)\b/i.test(lowerMessage) ||
    /^(kya|kaisa|kaisi|kyun|kaise|batao|bolo|bol|samjhao|acha|accha|thik|theek)\b/i.test(lowerMessage);

  if (!hasProductQuery && hasProducts && !isSimpleGreeting && lowerMessage.length > 2 && !isObviouslyGeneralQuery) {
    console.log(`[Smart Tools] Regex didn't match, trying AI classification for: "${userMessage}"`);
    hasProductQuery = await classifyProductIntent(userMessage, conversationHistory, openaiApiKey);
  } else if (!hasProductQuery && isObviouslyGeneralQuery) {
    console.log(`[Smart Tools] General/company query detected, skipping AI classification: "${userMessage}"`);
  }
  
  // STRENGTHENED: FAQ query detection with domain-specific terms
  // Includes: Educational terms (MBA, course, program, admission), general info queries
  const hasDomainTerms = /\b(mba|course|program|admission|online|degree|certificate|training|education|class|subject|curriculum|semester|fee|eligibility|duration)\b/i.test(lowerMessage);
  const hasGeneralInfoQuery = /how|why|what (is|are)|when|where|who|can i|is there|tell me about|information about|details about|explain|about|policy|return|refund|shipping|warranty|help|faq/i.test(lowerMessage);
  
  const hasFaqQuery = hasDomainTerms || hasGeneralInfoQuery;
  
  // Appointment detection: Rely on explicit keywords and let AI understand intent naturally
  // Removed time-based regex (hasTimeReference) - it caused false positives on phone numbers, ages, prices
  // The AI is smart enough to understand scheduling intent from context
  const hasAppointmentQuery = /appointment|book|schedule|reschedule|available times|availability|slots|when can|meeting|consultation|visit|see you|come in|doctor|clinic|reserve|reservation/i.test(lowerMessage);
  
  // Detect if this is an appointment-related context
  // Uses: explicit keywords OR conversation history (if appointments were discussed before)
  // Let AI naturally understand scheduling intent without brittle regex guessing
  const isAppointmentContext = appointmentsEnabled && (hasAppointmentQuery || hasAppointmentContextInHistory);
  
  // JOURNEY INTELLIGENCE: When a journey is active, include journey tools ONLY if AI-guided mode is enabled
  // ENGINE-DRIVEN MODE: Journey tools are disabled, engine controls all flow
  if (isJourneyActive && AI_GUIDED_JOURNEYS_ENABLED) {
    selectedTools.push(getToolByName('get_journey_progress'));
    selectedTools.push(getToolByName('record_current_journey_answer'));
    selectedTools.push(getToolByName('skip_current_journey_step'));
    selectedTools.push(getToolByName('complete_journey'));
    console.log(`[Smart Tools] Journey active (AI-guided mode) - added journey management tools`);
  } else if (isJourneyActive) {
    console.log(`[Smart Tools] Journey active (ENGINE-DRIVEN mode) - NO journey tools provided to AI`);
  }
  
  // HYBRID APPROACH: Combine regex for clear matches + AI intelligence for ambiguous cases
  // 
  // Strategy:
  // 1. Clear product intent → include product tool
  // 2. Clear FAQ intent (domain terms, info questions) → include FAQ tool  
  // 3. Ambiguous query (no clear pattern) → include BOTH and let AI decide
  // 4. Appointment context → include appointment tools
  
  // Detect if query is ambiguous (doesn't clearly match FAQ patterns)
  // Short queries or specific noun phrases are often product searches
  const isAmbiguousQuery = !hasFaqQuery && !isAppointmentContext && lowerMessage.split(' ').length <= 5;
  
  // Include product tool ONLY when:
  // 1. Business has products in their catalog, AND
  // 2. User shows explicit product intent (hasProductQuery), AND
  // 3. User is NOT in appointment context
  // This prevents product tool from being available for greetings/casual chat
  if (hasProducts && hasProductQuery && !isAppointmentContext) {
    selectedTools.push(getToolByName('get_products')); // get_products
    console.log(`[Smart Tools] Product intent detected - including product tool`);
  } else if (hasProducts && !hasProductQuery && !isAppointmentContext) {
    console.log(`[Smart Tools] Business has products but no product intent - NOT including product tool`);
  } else if (hasProducts && isAppointmentContext) {
    console.log(`[Smart Tools] Business has products but user intent is appointments - excluding product tool`);
  }
  
  if (hasFaqQuery) {
    selectedTools.push(getToolByName('get_faqs')); // get_faqs
  }
  
  // Include appointment tools ONLY when:
  // 1. Appointments are enabled for this business, AND
  // 2. User asks about scheduling OR mentions time/date
  if (isAppointmentContext) {
    // Get current date in IST for dynamic injection into tool descriptions
    const currentDate = getCurrentDateIST();
    
    // Deep clone and inject current date into list_available_slots description
    const listSlotsToolWithDate = JSON.parse(JSON.stringify(getToolByName('list_available_slots')));
    listSlotsToolWithDate.function.description = `CURRENT DATE: Today is ${currentDate.formatted} (${currentDate.isoDate} in ISO format). ` + listSlotsToolWithDate.function.description;
    listSlotsToolWithDate.function.parameters.properties.start_date.description = 
      `Start date to check availability (ISO format YYYY-MM-DD). TODAY IS ${currentDate.isoDate}. CRITICAL: When user wants to book without specifying a date, ALWAYS use today's date (${currentDate.isoDate}) as start_date - NEVER skip to tomorrow. Let users see today's remaining slots. Only use future dates if user explicitly requests them.`;
    
    // Deep clone and inject current date into book_appointment description  
    const bookAppointmentToolWithDate = JSON.parse(JSON.stringify(getToolByName('book_appointment')));
    bookAppointmentToolWithDate.function.description = `CURRENT DATE: Today is ${currentDate.formatted} (${currentDate.isoDate}). ` + bookAppointmentToolWithDate.function.description;
    
    selectedTools.push(listSlotsToolWithDate);
    selectedTools.push(bookAppointmentToolWithDate);
  }
  
  // Include capture_lead ONLY when message might contain contact info
  // This prevents AI from calling capture_lead for casual chat/greetings
  // The looksLikeContactInfo variable is already computed earlier in this function
  if (!isAppointmentContext && looksLikeContactInfo) {
    selectedTools.push(getToolByName('capture_lead')); // capture_lead
    console.log(`[Smart Tools] Contact info detected - including capture_lead tool`);
  } else if (!isAppointmentContext && !looksLikeContactInfo) {
    console.log(`[Smart Tools] No contact info detected - NOT including capture_lead tool`);
  }
  
  if (k12EducationEnabled) {
    const k12TopicTool = aiTools.find(t => t.function.name === 'fetch_k12_topic');
    const k12QuestionsTool = aiTools.find(t => t.function.name === 'fetch_k12_questions');
    if (k12TopicTool) selectedTools.push(k12TopicTool);
    if (k12QuestionsTool) selectedTools.push(k12QuestionsTool);
    console.log(`[Smart Tools] K12 education mode - K12 tools always included`);
  }

  if (jobPortalEnabled) {
    const searchJobsTool = aiTools.find(t => t.function.name === 'search_jobs');
    const parseResumeTool = aiTools.find(t => t.function.name === 'parse_resume_and_match');
    const applyToJobTool = aiTools.find(t => t.function.name === 'apply_to_job');
    if (searchJobsTool) selectedTools.push(searchJobsTool);
    if (parseResumeTool) selectedTools.push(parseResumeTool);
    if (applyToJobTool) selectedTools.push(applyToJobTool);
    console.log(`[Smart Tools] Job Portal mode - recruitment tools always included`);
  }

  if (demoOrdersEnabled) {
    const hasOrderIntent = /\b(order|track|where is my|status of|delivery|shipped|package|parcel|dispatch)\b/i.test(lowerMessage)
      || /\b(return|exchange|refund|replace|wrong item|damaged|size issue)\b/i.test(lowerMessage)
      || /\b(#[A-Za-z]{2}\d{3,}|order\s*#?\s*[A-Za-z]{2}\d{3,})\b/i.test(lowerMessage);
    
    const hasOrderContextInHistory = conversationHistory.some(msg => {
      if (msg.role !== 'assistant') return false;
      const content = ((msg as any).content || '').toLowerCase();
      return /order|tracking|delivery|return|exchange|refund/i.test(content);
    });

    if (hasOrderIntent || hasOrderContextInHistory) {
      const trackOrderTool = aiTools.find(t => t.function.name === 'track_order');
      const initiateReturnTool = aiTools.find(t => t.function.name === 'initiate_return');
      if (trackOrderTool) selectedTools.push(trackOrderTool);
      if (initiateReturnTool) selectedTools.push(initiateReturnTool);
      console.log(`[Smart Tools] Demo Orders mode - order tools included (intent: ${hasOrderIntent}, history: ${hasOrderContextInHistory})`);
    }
  }

  // NO FALLBACK: If no specific tools match, let AI respond naturally using business context
  // Don't force product/FAQ tools for greetings, casual chat, or unclear messages
  if (selectedTools.length === 0 || (selectedTools.length === 1 && selectedTools[0]?.function?.name === 'capture_lead')) {
    console.log(`[Smart Tools] No clear product/FAQ intent - AI will respond naturally with business context`);
  }
  
  const savings = Math.round((1 - selectedTools.length / aiTools.length) * 100);
  console.log(`[Smart Tools] Selected ${selectedTools.length}/${aiTools.length} tools (${savings}% token savings) for: "${userMessage.substring(0, 50)}..."`);
  console.log(`[Smart Tools] Appointment context: ${isAppointmentContext} (appointments enabled: ${appointmentsEnabled})`);
  
  return selectedTools;
}

export const aiTools = [
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: 'Search and retrieve products from the catalog. ONLY use this when the user EXPLICITLY asks about products, such as: "show me products", "what tshirts do you have", "dikhao options", "looking for rings", or asks about pricing/availability of specific items. DO NOT call this for greetings, casual chat, or general questions - respond naturally to those. Returns up to 5 products per call. If empty array is returned, tell user no products are currently listed. VISUAL CARDS: Products are displayed as visual cards AUTOMATICALLY by the UI. DO NOT list products as text or bullets - just write a SHORT intro (e.g., "Here are some options:"). The product cards appear below your message. MAINTAIN CONTEXT: When user adds filters like budget/price to a previous product search, COMBINE the original search term with the new filter.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Search term to filter products by name, description, category name, or tag name. IMPORTANT: When user refines a previous search with filters (budget, color, etc.), ALWAYS include the original search term here. Examples: "summer" will find products with "Summer Collection" tag, "shoes" will find products in Shoes category, "rings" for ring products. If user previously asked for rings and now asks "under 30k", include "rings" here AND set max_price.'
          },
          min_price: {
            type: 'number',
            description: 'Optional minimum price filter (inclusive). Use when customer asks for products "above", "over", or "at least" a certain price.'
          },
          max_price: {
            type: 'number',
            description: 'Optional maximum price filter (inclusive). Use when customer asks for products "under", "below", "less than", or "up to" a certain price.'
          },
          offset: {
            type: 'number',
            description: 'Number of products to skip (for pagination). Start with 0, then 5, 10, 15, etc.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_faqs',
      description: 'CRITICAL: This is the primary knowledge base. ALWAYS check FAQs FIRST before answering ANY customer question (except product listings). Use this tool for ALL informational questions including but not limited to: company information (owner, founder, CEO, about us, history), policies (return, refund, exchange, warranty), shipping (costs, times, methods, free shipping), sizing (guides, measurements, fit), payment (methods accepted, payment plans), store information (locations, hours, contact), product details (care instructions, materials, compatibility), ordering process (how to order, tracking, cancellations), troubleshooting, or ANY question that starts with "who", "what", "when", "where", "why", "how", "do you", "can I", "is there". If the user asks anything that might be in the FAQ, CHECK IT FIRST - do not guess or deflect.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Optional search term to filter FAQs by question or answer content'
          },
          category: {
            type: 'string',
            description: 'Optional category to filter FAQs'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'capture_lead',
      description: 'CRITICAL - INSTANT PROGRESSIVE CAPTURE: Call this tool IMMEDIATELY when you receive ANY contact information (name, email, or phone), even if partial. Do NOT wait to collect all required fields - the system will save partial leads to prevent data loss. WHEN TO CALL IMMEDIATELY: (1) User provides just their phone number (e.g., "9876543210") → Call NOW with phone parameter (2) User provides just their name (e.g., "John Smith") → Call NOW with name parameter (3) User provides just their email → Call NOW with email parameter (4) User provides any combination → Call NOW with all provided fields. PROGRESSIVE ENRICHMENT: After calling this tool with partial data, the system will tell you which required fields are still missing. Continue the conversation naturally to collect missing fields, then call this tool again to update the lead. The same lead will be enriched with new information. WHEN NOT TO CALL: (1) For appointment bookings - use book_appointment tool instead (which auto-creates leads). IMPORTANT: Even if required fields are missing, ALWAYS call this tool when you receive contact info. The system supports partial leads and will guide you on what else to collect. This prevents losing valuable leads if users abandon the conversation.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Customer name - include if provided by user'
          },
          email: {
            type: 'string',
            description: 'Customer email address - include if provided by user'
          },
          phone: {
            type: 'string',
            description: 'Customer phone number (can be mobile or WhatsApp) - include if provided by user'
          },
          message: {
            type: 'string',
            description: 'Any additional message or inquiry from the customer'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'verify_phone_otp',
      description: 'Verify a 6-digit OTP that was sent to the customer\'s mobile number. ONLY call this when the system has marked the conversation as awaiting OTP (you will see a strict OTP-mode instruction in the system message). Pass the exact 6 digits the user typed.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The 6-digit numeric code the user entered (digits only, no spaces).'
          }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'resend_phone_otp',
      description: 'Resend the OTP to the customer\'s mobile number. ONLY call this when the conversation is awaiting OTP and the user asks to resend, says they didn\'t receive the code, or asks for a new code. Subject to a 60-second cooldown and a 3-resend cap — the tool will tell you if either limit is hit.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  // Note: This tool definition is static but the selectRelevantTools function 
  // dynamically injects current date into the description at runtime
  {
    type: 'function',
    function: {
      name: 'list_available_slots',
      description: 'Show visual calendar for BROWSING availability. IMPORTANT: Always start from TODAY (the current date) - do NOT skip to tomorrow. A visual calendar will be displayed showing the full month with available dates highlighted. Use when: user says "book appointment", "show me slots", "what times are available", "when can I come in". DO NOT CALL THIS if user already selected/mentioned a specific date AND time (e.g., "I want to book Wednesday at 9:30 AM") - in that case, ask for their name and phone, then call book_appointment. This tool is ONLY for initial browsing, not for confirming selections.',
      parameters: {
        type: 'object',
        properties: {
          start_date: {
            type: 'string',
            description: 'Start date to check availability (ISO format YYYY-MM-DD). CRITICAL: When user requests appointment without specifying a date, ALWAYS use TODAY as start_date. Never skip to tomorrow - let users see today\'s remaining slots. The current date is dynamically provided at runtime.'
          },
          end_date: {
            type: 'string',
            description: 'End date to check availability (ISO format YYYY-MM-DD). IMPORTANT: To populate the visual calendar properly, ALWAYS request 30 days of data (set end_date to 30 days from start_date). Do NOT use the same date for start and end - the calendar needs a full month range.'
          },
          duration_minutes: {
            type: 'number',
            description: 'Optional appointment duration in minutes. Default is 30 minutes. Use this if user mentions specific appointment length.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Book an appointment. When user selects or mentions a specific date/time: 1) DO NOT call list_available_slots again, 2) Ask for their name if you dont have it: "May I have your name to complete the booking?", 3) Ask for phone if you dont have it: "What phone number can we reach you at?", 4) Once you have name AND phone, call this tool. NEVER use placeholder names like "User" or "Guest" - always ask for real info first.',
      parameters: {
        type: 'object',
        properties: {
          patient_name: {
            type: 'string',
            description: 'Patient full name (required - must be provided by user)'
          },
          patient_phone: {
            type: 'string',
            description: 'Patient phone number (required - must be provided by user)'
          },
          patient_email: {
            type: 'string',
            description: 'Patient email address (optional)'
          },
          appointment_date: {
            type: 'string',
            description: 'Appointment date in ISO format (YYYY-MM-DD). Use the current year from the CURRENT DATE context provided in this tool description.'
          },
          appointment_time: {
            type: 'string',
            description: 'Appointment time in 24-hour format (HH:MM). Example: "14:00" for 2:00 PM, "09:30" for 9:30 AM'
          },
          duration_minutes: {
            type: 'number',
            description: 'Appointment duration in minutes. Default is 30.'
          },
          notes: {
            type: 'string',
            description: 'Optional notes about the appointment (reason for visit, special requests, etc.)'
          }
        },
        required: ['patient_name', 'patient_phone', 'appointment_date', 'appointment_time']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_journey_progress',
      description: 'JOURNEY INTELLIGENCE: Use this tool to check the current conversation journey status and get the step ID needed for recording answers. Call this when: (1) User asks a question like "do you know about my education?", "what info do you have?", "did I tell you my name?" - you need to check what\'s already collected. (2) You want to provide a natural acknowledgment of previously collected information. (3) You need to see what questions remain to be asked. (4) MOST IMPORTANTLY: Call this BEFORE using record_journey_answer to get the currentStep.id that you MUST use. Returns: journey name, current step with its EXACT UUID id (e.g., "26dc5abc-1234-..."), all collected answers, required fields still needed, and completion status. SAVE the currentStep.id value - you will need it for record_journey_answer. IMPORTANT: If currentStep.alreadyAsked is true, the question was already shown to the user as the greeting message - treat the user\'s message as the answer and record it immediately instead of asking the question again.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_journey',
      description: 'JOURNEY COMPLETION: Use this tool ONLY when all required journey fields have been collected. This marks the journey as complete and triggers any completion actions (like lead capture, appointment booking, etc.). CRITICAL: Do NOT call this if any required fields are still missing. Before calling, verify you have collected all mandatory information by checking get_journey_progress results.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of what was collected (e.g., "Collected: Education (BTech), Year (2020), Name (John), Phone (555-1234)")'
          }
        },
        required: ['summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'record_current_journey_answer',
      description: 'SIMPLIFIED JOURNEY DATA COLLECTION: Use this tool to save a user\'s answer to the CURRENT journey question. This is the PREFERRED way to record answers because you don\'t need to manage step IDs - the server automatically saves to the current step. Call this immediately after the user provides information. Examples: User says "BTech" after you ask about education → call this tool. User says "2020" after you ask about graduation year → call this tool. User provides "John, 555-1234" in one message → call this tool TWICE (once for name, once for phone).',
      parameters: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            description: 'The user\'s answer to the current step'
          }
        },
        required: ['answer']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'skip_current_journey_step',
      description: 'SIMPLIFIED JOURNEY FLEXIBILITY: Use this tool to skip the CURRENT journey question when it doesn\'t apply or the user refuses to answer. This is the PREFERRED way to skip steps because you don\'t need to manage step IDs. Call this when: (1) User explicitly says "skip", "no thanks", "prefer not to say", "next question". (2) The question is not relevant based on previous answers. (3) User provides a refusal like "I don\'t want to share that".',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Reason for skipping this step (e.g., "user declined", "not applicable", "already answered")'
          }
        },
        required: ['reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_k12_topic',
      description: 'MANDATORY for education mode: ALWAYS call this tool FIRST before answering ANY educational, academic, science, math, physics, chemistry, biology, history, geography, language, or study-related question. Do NOT answer from general knowledge — retrieve curriculum content first. Searches subjects, chapters, and topics in the curriculum database. Returns revision notes, descriptions, video URLs with transcripts, and chapter/subject context. Works with English, Hindi, and Marathi queries. Extract the core academic concept as the query (e.g., for "What is the SI unit of gravitational constant G?", use query "gravitational constant" or "gravitation"). IMPORTANT: When video URLs are returned, ALWAYS include them in your answer so the student can watch the relevant video.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The core academic concept or topic keyword extracted from the student question. Use short, specific terms (e.g., "gravitation", "similarity of triangles", "photosynthesis"). Do NOT pass the full question — extract the key concept.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_k12_questions',
      description: 'Fetch practice questions/MCQs for a topic from the curriculum question bank. Call this when students explicitly ask to practice, test their knowledge, solve MCQs, or take a quiz. Returns multiple-choice questions with options, correct answers, and solutions.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The core academic concept or topic keyword to find questions for. Use short, specific terms (e.g., "gravitation", "similarity of triangles").'
          },
          difficulty: {
            type: 'number',
            description: 'Optional difficulty filter (1-10). Use when student asks for easy (1-3), medium (4-6), or hard (7-10) questions.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_jobs',
      description: 'Search for job openings using semantic search. Use this tool whenever a visitor asks about available jobs, positions, openings, careers, or mentions specific skills/roles they are looking for. Returns matching job listings with title, location, salary, job type, and department.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query describing the kind of job the visitor is looking for (e.g., "Python developer", "marketing manager", "remote data analyst").'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'parse_resume_and_match',
      description: 'Parse uploaded resume text to extract candidate info (name, email, phone, skills, experience) and find matching jobs using AI-powered semantic matching. Call this when a visitor uploads a resume/CV PDF. The resume text is automatically injected server-side — just pass "use_context" as resumeText. Creates an applicant record and returns top matching jobs ranked by relevance. IMPORTANT: After receiving results, do NOT list job titles or details in your response text — job cards are rendered automatically in the UI.',
      parameters: {
        type: 'object',
        properties: {
          resumeText: {
            type: 'string',
            description: 'Pass "use_context" — the actual resume text is injected server-side from the uploaded PDF. Do NOT try to reproduce the resume content.'
          },
          conversationId: {
            type: 'string',
            description: 'The current conversation ID to link the applicant record.'
          }
        },
        required: ['resumeText']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_to_job',
      description: 'Submit a job application for a visitor. Creates an application record linking the applicant to a specific job. Use when a visitor expresses interest in applying to a particular job after viewing job listings or resume matching results.',
      parameters: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'The ID of the job to apply for.'
          },
          applicantId: {
            type: 'string',
            description: 'The ID of the applicant (from parse_resume_and_match or previous interaction).'
          }
        },
        required: ['jobId', 'applicantId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'show_order_lookup_options',
      description: 'Show the customer three lookup method options for checking their order status. Call this IMMEDIATELY when a customer asks about order status, tracking, or "where is my order" WITHOUT already providing an order ID, phone number, or email. Do NOT ask for their name first. Do NOT ask for any identifier before calling this tool — just call it right away and let the UI present the options.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'track_order',
      description: 'Look up a customer\'s order status after they have provided a lookup identifier. Use when the customer provides: (1) a specific order ID — use order_id, (2) their phone number — use phone, (3) their email address — use email. Returns order details including status, courier, tracking number, and estimated delivery. Possible status values: confirmed, processing, shipped, out_for_delivery, delivered, cancelled, return_requested. When status is return_requested, inform the customer that their return request is being processed. Present the result as a clear order status update.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'string',
            description: 'The order ID to look up (e.g., "#LB1001" or "LB1001"). Use this when the customer provides a specific order number.'
          },
          phone: {
            type: 'string',
            description: 'The customer\'s phone number (10 digits) to look up recent orders when they chose to look up via mobile number.'
          },
          email: {
            type: 'string',
            description: 'The customer\'s email address to look up recent orders when they chose to look up via email.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'initiate_return',
      description: 'Handle a return or exchange request from a customer. Use when the customer says "I want to return", "I want to exchange", "return my order", "product is damaged", "wrong item received", or similar. STRICT RULES: (1) Returns are only allowed for orders with status "delivered" — if the order is not yet delivered, inform the customer and do NOT proceed. (2) You MUST collect ALL THREE of the following directly from the customer before calling this function — never infer, assume, or guess any of them, even if they were mentioned earlier in the conversation: [A] order_id — ask "Could you please share your order ID?"; if the customer does not know their order ID or says they have multiple orders, ask for their phone number and call track_order by phone first to show their recent orders, then ask them to confirm which order they want to return — use that confirmed order ID; [B] reason — ask "What is the reason for the return?" and wait for the customer to explicitly state it; [C] resolution — ask "Would you prefer a refund or an exchange?" and wait for the customer to choose. Ask for these one at a time in the above order. Do NOT call this function until all three have been explicitly provided by the customer in their own words.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'string',
            description: 'The order ID for which the return/exchange is being requested.'
          },
          reason: {
            type: 'string',
            description: 'Reason for the return or exchange. Examples: "size issue", "product different from image", "damaged item", "wrong item received", "quality not as expected".'
          },
          resolution: {
            type: 'string',
            description: 'Preferred resolution: "refund" or "exchange".',
            enum: ['refund', 'exchange']
          }
        },
        required: ['order_id', 'reason', 'resolution']
      }
    }
  }
];

/**
 * Name-based tool lookup. Use this instead of positional indexes (aiTools[n])
 * so that adding/reordering tools never silently breaks selectRelevantTools.
 */
export function getToolByName(name: string) {
  const t = aiTools.find((tool: any) => tool.function?.name === name);
  if (!t) {
    throw new Error(`[aiTools] Tool "${name}" not found — check aiTools registry`);
  }
  return t;
}
