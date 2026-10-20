/**
 * AI Tutor — what the student meant when they spoke (or typed) during a lesson. Rules for the
 * common short replies in English, Hindi and Hinglish; anything else is a question / remark for
 * the doubt answerer (which also copes with chit-chat), so no model call is needed here.
 */
export type TutorIntent =
  | { kind: "continue" }
  | { kind: "repeat" }
  | { kind: "simpler" }
  | { kind: "next" }
  | { kind: "stop" }
  | { kind: "pause" }
  | { kind: "quiz" }
  | { kind: "answer"; index: number }
  | { kind: "dontknow" }
  | { kind: "doubt" };

const NOT_WORD = new RegExp("[^\\p{L}\\p{M}\\p{N}\\s]", "gu");
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(NOT_WORD, " ").replace(/\s+/g, " ").trim();

const SIMPLER = /\b(didnt|did not|dont|do not|couldnt|could not|cant|can not|cannot) (get|understand|follow)|\bnot (clear|understood|getting it)\b|\bconfus|\b(explain|say) (it |that )?(again )?(more )?(simpl|easi)|\bsimpler\b|\beasier\b|samajh (nahi|nahin|ni|na) (aaya|aya|aa raha|aa rha|aayi|ayi)|samjh (nahi|nahin|ni) (aaya|aya)|(nahi|nahin|ni) samjh?(a|i|e)|samajh me nahi|aasan (karke|tarike)|समझ (नहीं|नही|में नहीं)|नहीं समझ|आसान/;
const REPEAT = /^(please )?(repeat|say (it|that) again|again please|once more|one more time|come again|phir se|fir se|phirse|firse|dobara|ek baar (aur|phir)|फिर से|दोबारा|एक बार और)\b/;
// Word edges that also work for Devanagari (\b is ASCII-only); the text is normalised to single spaces.
const B = "(?:^|\\s)";
const E = "(?=\\s|$)";
const NEXT = new RegExp(`${B}(next (part|section|topic|one)|skip (this|it|ahead)|move on|aage (wala|wale|ka) (part|topic)|agla (part|topic)|अगला (भाग|पार्ट|टॉपिक))${E}|^(skip|next|agla|अगला)$`);
const STOP = /^(stop|end|finish|close) (the )?(lesson|class|tutor|teaching)\b|^(thats enough|enough for today|bas karo|band karo|बस करो|बंद करो)\b|\b(stop|end) (the )?lesson\b/;
const PAUSE = new RegExp(`^(wait|hold on|one (sec|second|minute)|ruko|ruk jao|ek (minute|min|second|sec)|रुको|ठहरो|एक मिनट)${E}`);
const CONTINUE_WORDS = "ok|okay|okk|okie|continue|go on|carry on|keep going|go ahead|yes|yeah|yep|sure|got it|i got it|understood|i understand|makes sense|right|alright|all right|fine|cool|nice|great|haan|han|ha|haa|ji|ji haan|theek hai|thik hai|thik h|achha|acha|accha|aage|aage badho|aage chalo|chalo|samajh gaya|samajh gayi|samajh aa gaya|samjh gaya|samjh gayi|हाँ|हां|जी|ठीक है|अच्छा|आगे|आगे बढ़ो|चलो|समझ गया|समझ गई|समझ आ गया|please|sir|maam|ji|now|then|next";
const CONTINUE = new RegExp(`^(${CONTINUE_WORDS})( (${CONTINUE_WORDS}))*$`);
// "Ask me a question" / "quiz me" / "mujhse sawaal pucho".
const QUIZ = new RegExp(`${B}((ask|quiz|test) me|ask (me )?(a |an |some |one |few |a few )?(question|questions|quiz)|give me (a |an |some )?(question|questions|quiz|test)|(mujhse|mujhe) (koi |ek |kuch )?(sawal|sawaal|savaal|question|questions|prashn) (pucho|poocho|puchho|puchiye|poochiye|do)|(sawal|sawaal|question|questions) (pucho|poocho|puchho|puchiye)|मुझसे (कोई |एक )?सवाल|सवाल पूछ)${E}`);
const DONT_KNOW = new RegExp(`${B}(dont know|do not know|no idea|not sure|pata nahi|pata nahin|nahi pata|nahin pata|maloom nahi|मालूम नहीं|पता नहीं|नहीं पता)${E}|^(skip|pass)$`);

const LETTERS = ["a", "b", "c", "d", "e", "f"];
const ORDINALS: Array<RegExp> = [
  "first|1st|one|pehla|pehli|pahla|पहला|पहली",
  "second|2nd|two|doosra|dusra|doosri|dusri|दूसरा|दूसरी",
  "third|3rd|three|teesra|tisra|teesri|तीसरा|तीसरी",
  "fourth|4th|four|chautha|chotha|chauthi|चौथा|चौथी",
].map((w) => new RegExp(`${B}(${w})${E}`));

/** Which option the student picked ("B", "option c", "the second one", "2", or the option's words). */
export function answerIndex(text: string, options: string[]): number | null {
  const t = norm(text);
  if (!t) return null;
  const n = options.length;
  let m = /^(?:(?:its|it is|answer is|the answer is|option|answer|i think|i think its|maybe)\s+)*(?:option\s+)?([a-f])(?:\s+(?:hai|he|is|ho|option))?$/.exec(t);
  if (m) { const i = LETTERS.indexOf(m[1]); return i >= 0 && i < n ? i : null; }
  m = /\boption\s+([a-f1-6])\b/.exec(t);
  if (m) { const i = /\d/.test(m[1]) ? Number(m[1]) - 1 : LETTERS.indexOf(m[1]); return i >= 0 && i < n ? i : null; }
  m = /^(?:option\s+)?([1-6])$/.exec(t);
  if (m) { const i = Number(m[1]) - 1; return i < n ? i : null; }
  if (t.split(" ").length <= 6) {
    // Most specific first: "the second one" is B, not "one".
    for (let i = Math.min(n, ORDINALS.length) - 1; i >= 0; i--) if (ORDINALS[i].test(t)) return i;
  }
  // The option's own words: an exact match, or the only option whose words are all said.
  const opts = options.map((o) => norm(o));
  const exact = opts.findIndex((o) => o && o === t);
  if (exact >= 0) return exact;
  const said = opts.map((o, i) => ({ i, o })).filter(({ o }) => o.length >= 2 && (` ${t} `).includes(` ${o} `));
  if (said.length === 1) return said[0].i;
  return null;
}

export function classifyTutorIntent(text: string, opts: { checkOptions?: string[] | null } = {}): TutorIntent {
  const t = norm(text);
  if (!t) return { kind: "doubt" };
  const words = t.split(" ").length;
  if (opts.checkOptions?.length) {
    const i = answerIndex(text, opts.checkOptions);
    if (i != null) return { kind: "answer", index: i };
    if (DONT_KNOW.test(t)) return { kind: "dontknow" };
  }
  if (words <= 12 && QUIZ.test(t)) return { kind: "quiz" };
  if (SIMPLER.test(t)) return { kind: "simpler" };
  if (words <= 8 && STOP.test(t)) return { kind: "stop" };
  if (words <= 6 && NEXT.test(t)) return { kind: "next" };
  if (words <= 6 && REPEAT.test(t)) return { kind: "repeat" };
  if (words <= 5 && PAUSE.test(t)) return { kind: "pause" };
  if (words <= 6 && CONTINUE.test(t)) return { kind: "continue" };
  return { kind: "doubt" };
}
