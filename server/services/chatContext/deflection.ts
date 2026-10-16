/**
 * Backup "the AI couldn't answer" detection (the AI's [[FALLBACK]] marker is the primary signal).
 *
 * A reply containing "I don't know…", "I'm not sure…", "I don't have that information…" is treated
 * as a deflection, and the business's fallback template is shown instead. One exception: a
 * sentence that is only about the visitor's OWN chat details — their name, mobile / phone /
 * WhatsApp number or email ("I don't know your name yet") — is a normal answer, not a missing
 * business fact. Anything about accounts, loans, balances, KYC, orders, fees, courses… stays a
 * deflection (e.g. "I don't have access to your loan details" still gets the fallback).
 *
 * Shared by the website chat, WhatsApp and Instagram/Facebook auto-replies.
 */

export const DEFLECTION_PATTERNS: RegExp[] = [
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

/** "your name", "your mobile number", "your WhatsApp number", "your email address"… */
const OWN_CHAT_DETAIL = /\b(your|ur)\s+(full\s+|first\s+|last\s+|good\s+)?(name|mobile(\s+(number|no))?|phone(\s+(number|no))?|contact\s+(number|no|details)|whats\s?app(\s+(number|no))?|e-?mail(\s+(address|id))?|number)\b/i;

/** Business / account facts: never treated as a "chat detail" answer. */
const BUSINESS_FACT = /\b(accounts?|loans?|balances?|kyc|emis?|polic(y|ies)|orders?|payments?|transactions?|refunds?|claims?|premiums?|credit|debit|statements?|applications?|bookings?|appointments?|status|fees?|pric(e|es|ing)|costs?|courses?|programs?|programmes?|admissions?|eligib\w*|interest|rates?|insurance|investments?|portfolio|deliver\w*|shipping|stock|warranty|invoice|subscription|plan)\b/i;

function sentences(text: string): string[] {
  return text.replace(/\[\[FALLBACK\]\]/g, ' ').split(/(?<=[.!?।])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** The "I don't know / don't have / not sure / can't" part of a sentence. */
const DEFLECT_VERB = /\b(I\s+(don't|do not)\s+(know|have)|I'm\s+not\s+sure|I\s+am\s+not\s+sure|I\s+(can't|cannot|couldn't)|unable\s+to|not\s+(familiar|aware))\b/i;

function deflectingClauses(sentence: string): string[] {
  const clauses = sentence.split(/\s+[—–-]\s+|[;,:]|\s+(?:but|so|and)\s+/i).map((c) => c.trim()).filter(Boolean);
  const hits = clauses.filter((c) => DEFLECT_VERB.test(c));
  return hits.length ? hits : [sentence];
}

/**
 * A "don't know" sentence that is only about the visitor's own name / number / email: the clause
 * that says "I don't know…" names one of those and no business / account fact ("I don't know
 * your name yet — could you share it so I can help with the course?" → about the name).
 */
export function isAboutVisitorOwnDetails(sentence: string): boolean {
  return deflectingClauses(sentence).every((c) => OWN_CHAT_DETAIL.test(c) && !BUSINESS_FACT.test(c));
}

/**
 * Backup deflection check: some sentence says "I don't know / don't have / can't…", other than one
 * about the visitor's own chat details.
 */
export function matchesDeflectionPattern(reply: string): boolean {
  if (!reply) return false;
  return sentences(reply).some((s) => DEFLECTION_PATTERNS.some((re) => re.test(s)) && !isAboutVisitorOwnDetails(s));
}
