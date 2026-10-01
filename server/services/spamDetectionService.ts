import OpenAI from 'openai';
import { createOpenAI } from "../lib/openaiClient";

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
    const openai = createOpenAI({ apiKey: openaiApiKey });
    
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
      ? createOpenAI({ apiKey: effectiveKey, baseURL: GEMINI_BASE_URL })
      : createOpenAI({ apiKey: effectiveKey });
    
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

/**
 * Cheap, local pre-filter for the first-message AI spam check (isGibberishAI costs one
 * LLM round trip, 0.5–1.5 s, on every new conversation). Returns why the message
 * looks suspicious enough to ask the AI, or null for an ordinary greeting / question,
 * which skips the AI check (it would answer "OK" for those anyway).
 *
 * Errs towards flagging: a false positive only costs the AI check that used to run on
 * every first message; a false negative sends a gibberish first message down the
 * normal chat path instead of the simplified spam reply.
 */
// Unicode-aware patterns (constructor form: the server tsconfig targets ES5).
const LETTER_RE = new RegExp('\\p{L}', 'gu');
const REPEATED_CHAR_RE = new RegExp('(.)\\1{4,}', 'u');
const REPEATED_CHUNK_RE = new RegExp('(\\p{L}{2,4})\\1{2,}', 'u');
const SYMBOL_RE = new RegExp("[^\\p{L}\\p{M}\\p{N}\\s.,!?'\"’()\\-:;₹$%&/]", 'gu');

export function spamCheckReason(message: string): string | null {
  const text = String(message || '').trim();
  if (!text) return 'empty';
  // Single characters / symbols: isGibberishAI rules on these locally (no AI call).
  if (text.length === 1) return 'single_character';
  if (/(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|in|io|co|xyz|ru|info|biz|top|click|link|site|online|shop|app|me|ly|gl|tk|cn)\b)/i.test(text)) return 'link';
  if (/<[a-z/][^>]*>|\{\{|\}\}|\[url|javascript:/i.test(text)) return 'markup';
  if (/@[a-z0-9-]+\.[a-z]{2,}/i.test(text)) return 'email_or_handle';
  // The AI prompt treats test inputs ("test", "testing 123") as spam — keep asking it.
  if (/\b(test|testing|tester|asdf|qwerty|lorem|ipsum)\b/i.test(text)) return 'test_input';
  const letters = text.match(LETTER_RE) || [];
  if (letters.length === 0) return 'no_letters';
  if (REPEATED_CHAR_RE.test(text.replace(/\s+/g, ''))) return 'repeated_characters';
  if (REPEATED_CHUNK_RE.test(text.replace(/\s+/g, '').toLowerCase())) return 'repeated_pattern';
  const symbols = text.match(SYMBOL_RE) || [];
  if (text.length >= 4 && symbols.length / text.length > 0.3) return 'excessive_symbols';
  if (/(qwer|wert|erty|rtyu|tyui|yuio|uiop|asdf|sdfg|dfgh|fghj|ghjk|hjkl|zxcv|xcvb|cvbn|vbnm)/i.test(text)) return 'keyboard_mash';
  for (const token of text.split(/\s+/)) {
    if (token.length > 30) return 'long_token';
    const latin = (token.match(/[a-z]/gi) || []).join('').toLowerCase();
    if (latin.length < 4) continue;
    const vowels = (latin.match(/[aeiouy]/g) || []).length;
    if (vowels === 0) return 'no_vowels';
    if (latin.length >= 6 && vowels / latin.length < 0.25) return 'low_vowel_ratio';
    if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(latin)) return 'consonant_run';
  }
  return null;
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
