/**
 * Campaign replies: when the campaign AI should step aside for a person.
 *
 * Deterministic, no AI call: a customer who is clearly angry / abusive, or who asks for a
 * human, an agent or a call back from a person (English, Hindi in Devanagari, Hinglish).
 * The reply model can also ask for a handover with HANDOVER_TOKEN (see campaignAiService)
 * for wordings these patterns miss.
 */

export type HandoverReason = "human_request" | "angry";

export interface HandoverSignal {
  reason: HandoverReason;
  /** Short plain-words note for the "Needs human" badge. */
  note: string;
}

/** What the reply model answers (alone) when it decides a person should take over. */
export const HANDOVER_TOKEN = "[[HANDOVER]]";

/** Our fixed message (English source; translated into the reply language before sending). */
export const HANDOVER_MESSAGE =
  "I'm sorry for any trouble. I've passed your message to our team, and a team member will get back to you here shortly.";

const PEOPLE = "(?:human|humans|person|people|agent|someone|somebody|representative|rep|executive|manager|staff|team member|real person|customer care|customer service|support team|advisor|adviser|operator|officer)";

/** "talk to an agent" — but not "I'll talk to my manager and confirm". */
const TALK_TO_PERSON = new RegExp(`\\b(?:talk|speak|chat|connect|transfer|put)\\b[^.?!\\n]{0,25}\\b${PEOPLE}\\b`, "i");
const SELF_TALK = /\b(?:i'?ll|i will|let me|will|gonna|going to)\s+(?:talk|speak|chat|check|discuss)\b|\bmy\s+(?:manager|team|staff|agent|advisor|adviser|family|people|executive)\b/i;

const HUMAN_REQUEST: RegExp[] = [
  // English
  /\b(?:real|live|actual)\s+(?:person|human|agent|people)\b/i,
  /^\s*(?:human|agent|representative|operator|customer care)\s*(?:please|pls|plz)?[\s!.]*$/i,
  /\b(?:want|need|get me)\s+(?:a|an|the|to talk to a|to speak to a|to speak with a|to talk with a)?\s*(?:human|real person|agent|representative|manager)\b/i,
  /\b(?:don'?t|do not|dont)\s+want\s+(?:to\s+(?:talk|chat|speak)\s+(?:to|with)\s+)?(?:a\s+|an\s+|the\s+|this\s+)?(?:bot|robot|ai|machine)\b/i,
  /\b(?:stop|no more)\s+(?:the\s+)?(?:bot|robot|automated (?:replies|messages))\b/i,
  /\bcall\s*(?:me\s*)?back\b/i,
  /\b(?:please|pls|plz|kindly|can you|could you|someone)\s+(?:\w+\s+)?call\s+me\b/i,
  /^\s*call\s+me\b/i,
  /\b(?:give|have)\s+me\s+a\s+call\b/i,
  // Hinglish (Hindi in English letters)
  /\b(?:insaan|insan|aadmi|admi|banda|bande|vyakti|agent|executive|manager|staff|team|kisi)\s+(?:se\s+)?(?:baat|bat)\s*(?:karao|karwao|karwa\s*do|kara\s*do|karwaiye|karaiye|karna\s*hai|karni\s*hai|krao|krwao|chahiye|karo|kro)\b/i,
  /\bkisi\s+(?:insaan|insan|aadmi|admi|bande|banda|person|human|agent|executive)\b/i,
  /\b(?:call|phone|fone)\s*(?:back\s*)?(?:karo|kar\s*do|kardo|krdo|kro|kijiye|kariye|karein|karen|karna)\b/i,
  /\b(?:mujhe|muje|mujhko|mereko|humko|hume|hamein)\s+(?:call|phone|fone)\b/i,
  /\b(?:bot|robot|machine)\s+(?:se\s+)?(?:baat\s+)?nahi\b/i,
  // Hindi (Devanagari)
  /(?:इंसान|इन्सान|आदमी|व्यक्ति|एजेंट|मैनेजर|किसी)\s*(?:से)?\s*बात\s*(?:कराओ|करवाओ|करवा\s*दो|करा\s*दो|कराइए|करवाइए|करनी|करना|करो)/,
  /किसी\s*(?:इंसान|इन्सान|आदमी|व्यक्ति|एजेंट)/,
  /(?:कॉल|काल|फोन|फ़ोन)\s*(?:बैक\s*)?(?:करो|कीजिए|कीजिये|करें|कर\s*दो|करिए|करना)/,
  /(?:मुझे|मुझको|हमें)\s*(?:कॉल|काल|फोन|फ़ोन)/,
];

const ANGRY: RegExp[] = [
  // English abuse / strong anger
  /\b(?:fuck\w*|f+u+c+k+|wtf|stfu|shit\w*|bullshit|bastard\w*|asshole\w*|bitch\w*|idiot\w*|stupid|moron\w*|dumb|nonsense|rubbish|pathetic|disgusting|useless|worst (?:service|company|experience|bank|app)|scam\w*|fraud\w*|cheat\w*|cheating|harass\w*|liar\w*|go to hell|damn you|screw you)\b/i,
  /\b(?:legal action|consumer court|police complaint|file a complaint|lodge a complaint|sue you|my lawyer)\b/i,
  /\bstop\s+(?:messaging|texting|calling|spamming|bothering|harassing)\s+me\b/i,
  // Hinglish abuse
  /\b(?:chutiya\w*|chutiye|chootiya|bhosd\w*|bsdk|madarchod|maderchod|behenchod|bhenchod|benchod|gandu|harami|haramkhor|kamina|kamine|kutta|kutte|kutiya|saala|saale|bakwas|bakwaas|bewakoof|bevkoof|bewkoof|pagal|ullu|dhokebaaz|dhokebaz|dhokha)\b/i,
  // Hindi (Devanagari) abuse
  /(?:चुतिया|चूतिया|मादरचोद|बहनचोद|भेनचोद|हरामी|कमीना|कमीने|कुत्ते|कुत्ता|साला|साले|बकवास|बेवकूफ|पागल|धोखा|धोखेबाज|चोर|गांडू)/,
];

/** Shouting: mostly capital letters (10+ letters) with an exclamation mark. */
function isShouting(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 10 || !text.includes("!")) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.8;
}

/** null when the AI can keep replying. */
export function detectHandover(message: string | null | undefined): HandoverSignal | null {
  const text = String(message ?? "").trim();
  if (!text) return null;
  if ((TALK_TO_PERSON.test(text) && !SELF_TALK.test(text)) || HUMAN_REQUEST.some(re => re.test(text))) {
    return { reason: "human_request", note: "Customer asked to talk to a person" };
  }
  if (ANGRY.some(re => re.test(text)) || isShouting(text)) {
    return { reason: "angry", note: "Customer seems upset" };
  }
  return null;
}

/** True when the reply model asked for a handover instead of answering. */
export function isHandoverToken(reply: string | null | undefined): boolean {
  return String(reply ?? "").includes(HANDOVER_TOKEN);
}
