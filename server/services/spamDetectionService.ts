import OpenAI from 'openai';

export interface SpamCheckResult {
  isSpam: boolean;
  reason?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface MessageClassification {
  isGreeting: boolean;
  isSimple: boolean;
  needsTools: boolean;
}

/**
 * AI-based message classification to determine if message is a casual greeting
 * that can skip heavy processing (FAQ search, RAG, embeddings)
 */
export async function classifyMessage(
  message: string,
  openaiApiKey: string
): Promise<MessageClassification> {
  const trimmed = message.trim().toLowerCase();
  
  // BUSINESS INTENT KEYWORDS - if any match, always use full processing
  const businessKeywords = [
    'mba', 'program', 'course', 'fee', 'fees', 'price', 'cost', 'admission',
    'apply', 'eligibility', 'duration', 'syllabus', 'curriculum', 'faculty',
    'placement', 'salary', 'job', 'degree', 'certificate', 'online', 'schedule',
    'deadline', 'exam', 'why', 'what', 'how', 'when', 'where', 'which', 'can',
    'tell', 'explain', 'about', 'show', 'book', 'appointment', 'contact',
    'product', 'ring', 'necklace', 'bracelet', 'earring', 'jewelry', 'diamond',
    'gold', 'silver', 'platinum', 'carat', 'size'
  ];
  
  // If message contains any business keyword, always use full processing
  if (businessKeywords.some(keyword => trimmed.includes(keyword))) {
    console.log('[MessageClassify] Business keyword detected - using full processing');
    return { isGreeting: false, isSimple: false, needsTools: true };
  }
  
  // If message contains a question mark, likely a question - use full processing
  if (trimmed.includes('?')) {
    console.log('[MessageClassify] Question mark detected - using full processing');
    return { isGreeting: false, isSimple: false, needsTools: true };
  }
  
  // Pure greetings - fast path (deterministic, no AI needed)
  const pureGreetings = [
    'hi', 'hello', 'hey', 'hii', 'hiii', 'hola', 'namaste',
    'wassup', 'whatsup', 'sup', 'yo', 'howdy',
    'good morning', 'good afternoon', 'good evening', 'gm', 'gn',
    'thanks', 'thank you', 'thx', 'ty',
    'ok', 'okay', 'k', 'cool', 'nice', 'great', 'awesome', 'perfect',
    'bye', 'goodbye', 'see you', 'later', 'cya'
  ];
  
  if (pureGreetings.includes(trimmed) || pureGreetings.some(g => trimmed === g)) {
    console.log('[MessageClassify] Pure greeting detected - using fast path');
    return { isGreeting: true, isSimple: true, needsTools: false };
  }
  
  // For anything else, use AI classification with conservative defaults
  try {
    const openai = new OpenAI({ apiKey: openaiApiKey });
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Classify this customer message. Be VERY conservative - when in doubt, choose NEEDS_TOOLS.

GREETING - ONLY pure greetings with NO question or intent
Examples: "hi", "hello", "hey", "wassup", "good morning", "thanks", "ok", "cool"
NOT greetings: "hi tell me about X", "hello what is Y"

NEEDS_TOOLS - ANY question about the business, products, services, programs, policies, or information
This includes:
- "why X", "what is X", "tell me about X", "explain X"
- "mba", "program", "course", "price", "fee", "admission"
- Questions starting with why, what, how, when, where, which, can, do, is, are
- ANY request for information, even if short

Respond with ONLY: GREETING or NEEDS_TOOLS
Default to NEEDS_TOOLS if uncertain.`
        },
        {
          role: 'user',
          content: trimmed
        }
      ],
      max_tokens: 10,
      temperature: 0
    });

    const result = response.choices[0]?.message?.content?.trim().toUpperCase();
    
    if (result === 'GREETING') {
      console.log('[MessageClassify] Detected pure greeting - will use fast path');
      return { isGreeting: true, isSimple: true, needsTools: false };
    }
    
    // Default to full processing for any question or uncertain classification
    console.log('[MessageClassify] Detected question/NEEDS_TOOLS - will use full processing');
    return { isGreeting: false, isSimple: false, needsTools: true };
    
  } catch (error) {
    console.error('[MessageClassify] Classification failed, defaulting to full processing:', error);
    return { isGreeting: false, isSimple: false, needsTools: true };
  }
}

export async function isGibberishAI(
  message: string, 
  openaiApiKey: string
): Promise<SpamCheckResult> {
  if (!message || typeof message !== 'string') {
    return { isSpam: true, reason: 'empty_message', confidence: 'high' };
  }

  const trimmed = message.trim();
  
  if (trimmed.length === 0) {
    return { isSpam: true, reason: 'empty_message', confidence: 'high' };
  }

  if (trimmed.startsWith('[RESUME_UPLOAD]') || trimmed.startsWith('[JOB_APPLY]')) {
    return { isSpam: false, confidence: 'high' };
  }

  if (trimmed.length === 1) {
    return { isSpam: true, reason: 'single_character', confidence: 'high' };
  }

  // Fill-in-the-blank questions use repeated underscores (e.g. "_________").
  // The spam detector's AI mistakes these for "meaningless character sequences",
  // so whitelist them deterministically before the AI call.
  if (/_{3,}/.test(trimmed)) {
    console.log('[SpamDetection] Fill-in-the-blank pattern detected — allowing through');
    return { isSpam: false, confidence: 'high' };
  }

  try {
    const { storage } = await import('../storage');
    const master = await storage.getMasterAiSettings().catch(() => null);
    const useMaster = !!(master?.masterEnabled && master.primaryApiKey);
    const effectiveKey = useMaster ? master!.primaryApiKey! : openaiApiKey;
    const provider = useMaster ? (master!.primaryProvider || 'openai') : 'openai';
    const spamModel = useMaster ? (master!.primaryModel || 'gpt-4o-mini') : 'gpt-4o-mini';
    const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    const openai = provider === 'gemini'
      ? new OpenAI({ apiKey: effectiveKey, baseURL: GEMINI_BASE_URL })
      : new OpenAI({ apiKey: effectiveKey });
    
    const response = await openai.chat.completions.create({
      model: spamModel,
      messages: [
        {
          role: 'system',
          content: `You are a spam detector for a customer support chatbot. Analyze the user's first message and determine if it's gibberish/spam or a legitimate inquiry.

SPAM/GIBBERISH includes:
- Random keyboard mashing: "ahsdisdds", "jkldf", "qwerty"
- Meaningless character sequences: "xxxxx", "asdfasdf"
- Test inputs: "test", "testing 123" (unless asking about product testing)
- Single letters or symbols with no meaning

LEGITIMATE includes:
- Greetings: "hi", "hello", "hey"
- Questions about products/services (any language)
- Course codes or IDs: "MBA 2025", "CBSE XI", "B.Com"
- Non-English text (Hindi, etc.)
- Short but meaningful messages: "price?", "fees", "admission"
- Names or phone numbers (user providing contact info)

Respond with ONLY "SPAM" or "OK" - nothing else.`
        },
        {
          role: 'user',
          content: trimmed
        }
      ],
      max_tokens: 5,
      temperature: 0
    });

    const result = response.choices[0]?.message?.content?.trim().toUpperCase();
    
    if (result === 'SPAM') {
      console.log('[SpamDetection] AI classified as spam:', trimmed.substring(0, 30));
      return { isSpam: true, reason: 'ai_detected_gibberish', confidence: 'high' };
    }
    
    return { isSpam: false, confidence: 'high' };
    
  } catch (error) {
    console.error('[SpamDetection] AI check failed, allowing message through:', error);
    return { isSpam: false, confidence: 'low' };
  }
}

export function isGibberish(message: string): SpamCheckResult {
  if (!message || typeof message !== 'string') {
    return { isSpam: true, reason: 'empty_message', confidence: 'high' };
  }

  const trimmed = message.trim();
  
  if (trimmed.length === 0) {
    return { isSpam: true, reason: 'empty_message', confidence: 'high' };
  }

  if (trimmed.length === 1) {
    return { isSpam: true, reason: 'single_character', confidence: 'high' };
  }

  return { isSpam: false, confidence: 'high' };
}
