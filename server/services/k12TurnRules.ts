/**
 * K12 tutor: what kind of turn this is, and the rules that go with it. Pure — no database, no
 * network — so every decision here is covered by k12TurnRules.test.ts.
 *
 *  - Photo question: the student's photo (and the note typed with it) is one message. The text
 *    read from the photo is kept in the chat so later messages ("Q57", "solve it") have
 *    something to refer to, and the answering model is shown the photo itself.
 *  - Small talk (hello, thank you, okay, "let it be"): answered briefly, with no curriculum
 *    lookup — so it can never get "this topic isn't in our curriculum yet".
 *  - Short follow-up ("explain again", "point 5 did not understand"): looked up with the question
 *    it refers to, and answered from the conversation rather than refused.
 */

// Built with RegExp() because the project's compile target rejects the "u" flag on regex literals.
const NOT_WORD_CHARS = new RegExp("[^\\p{L}\\p{M}\\p{N}\\s']", 'gu');
const NOT_LABEL_CHARS = new RegExp("[^\\p{L}\\p{M}\\p{N}\\s.,&'()\\-]", 'gu');
const NOT_NAME_CHARS = new RegExp("[^\\p{L}\\p{M}\\s.'\\-]", 'gu');

export const IMAGE_UPLOAD_PREFIX = '[IMAGE_UPLOAD]';
export const PHOTO_NOTE_MAX_CHARS = 500;
/** Text read from a photo that is kept in the chat (memory and the message's metadata). */
export const PHOTO_TEXT_KEPT_CHARS = 6000;

const PHOTO_ENTRY_HEAD = '[The student sent a photo of their question';
const PHOTO_TEXT_LABEL = 'Text read from the photo:';
const PHOTO_NOTE_LABEL = "The student's note with the photo:";

export interface TurnMessage { role: string; content: string }
export interface PhotoUpload { fileName: string; note: string }

// ─── Photo message ─────────────────────────────────────────────────────────────

/** "[IMAGE_UPLOAD] file.jpg" with an optional typed note on the lines after it. null = not a photo message. */
export function parseImageUploadMessage(message: unknown): PhotoUpload | null {
  if (typeof message !== 'string' || !message.startsWith(IMAGE_UPLOAD_PREFIX)) return null;
  const rest = message.slice(IMAGE_UPLOAD_PREFIX.length);
  const nl = rest.indexOf('\n');
  const fileName = (nl === -1 ? rest : rest.slice(0, nl)).replace(/\s+/g, ' ').trim().slice(0, 200);
  const note = nl === -1 ? '' : rest.slice(nl + 1)
    .replace(/\s+/g, ' ')
    .trim()
    // a note can never start with one of our own "[COMMAND]" prefixes
    .replace(/^(\[[A-Z_]+\]\s*)+/, '')
    .slice(0, PHOTO_NOTE_MAX_CHARS)
    .trim();
  return { fileName, note };
}

/** What is saved as the message text: the file name line, then the note (the chat screens show both). */
export function storedPhotoContent(upload: PhotoUpload): string {
  return `${IMAGE_UPLOAD_PREFIX} ${upload.fileName}`.trimEnd() + (upload.note ? `\n${upload.note}` : '');
}

/** The photo message as the AI sees it in the conversation history. */
export function photoHistoryEntry(upload: PhotoUpload, imageText: string | null | undefined): string {
  const lines = [`${PHOTO_ENTRY_HEAD}${upload.fileName ? ` (${upload.fileName})` : ''}.]`];
  if (upload.note) lines.push(`${PHOTO_NOTE_LABEL} ${upload.note}`);
  const text = (imageText || '').trim().slice(0, PHOTO_TEXT_KEPT_CHARS).trimEnd();
  lines.push(text ? `${PHOTO_TEXT_LABEL}\n${text}` : 'No text could be read from the photo.');
  return lines.join('\n');
}

export function isPhotoHistoryEntry(content: unknown): boolean {
  return typeof content === 'string' && content.startsWith(PHOTO_ENTRY_HEAD);
}

/** The text read from the photo, out of a history entry built by photoHistoryEntry. */
export function photoTextOf(entry: string): string {
  const at = entry.indexOf(PHOTO_TEXT_LABEL);
  return at === -1 ? '' : entry.slice(at + PHOTO_TEXT_LABEL.length).trim();
}

/** Saved with the photo message so the read text survives a restart / idle gap. */
export function photoMessageMetadata(imageText: string | null | undefined): { imageText: string } | undefined {
  const text = (imageText || '').trim().slice(0, PHOTO_TEXT_KEPT_CHARS).trimEnd();
  return text ? { imageText: text } : undefined;
}

/**
 * A stored message as the AI should see it when history is reloaded from the database: photo
 * messages get their read text back. Everything else (and photos saved before the text was kept)
 * is returned unchanged.
 */
export function expandStoredPhotoMessage(content: string, metadata: unknown): string {
  const upload = parseImageUploadMessage(content);
  if (!upload) return content;
  let imageText = '';
  try {
    const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (meta && typeof (meta as any).imageText === 'string') imageText = (meta as any).imageText;
  } catch { /* not JSON — no read text saved */ }
  if (!imageText.trim() && !upload.note) return content;
  return photoHistoryEntry(upload, imageText);
}

/** The part of the read text that starts at question `n` ("57.", "Q57", "57)"); '' when not found. */
export function excerptForQuestionNumber(text: string, n: string, maxChars = 600): string {
  if (!text || !/^\d{1,3}$/.test(n)) return '';
  const lead = '(^|\\n)[ \\t>*#-]*';
  const patterns = [
    new RegExp(`${lead}q(?:ues(?:tion)?)?\\.?[ \\t]*(?:no\\.?[ \\t]*)?${n}(?!\\d)`, 'i'), // Q57, Question 57, Q.No. 57
    new RegExp(`${lead}${n}[ \\t]*[.):\\]](?!\\d)`),                                        // 57.  57)  — not 57.5
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return text.slice(m.index + m[1].length, m.index + m[1].length + maxChars).trim();
  }
  return '';
}

function firstNumberIn(message: string): string {
  const m = /(?:^|[^\d])(\d{1,3})(?!\d)/.exec(message || '');
  return m ? m[1] : '';
}

/** Curriculum lookup words for a photo turn: the note, then the question it names (or the start of the page). */
export function k12PhotoLookupQuery(note: string, imageText: string | null | undefined): string {
  const text = (imageText || '').trim();
  const named = excerptForQuestionNumber(text, firstNumberIn(note));
  return [note, named || text.slice(0, 800)].filter(Boolean).join('\n').trim();
}

// ─── Small talk ────────────────────────────────────────────────────────────────

export type K12SmallTalk = 'greeting' | 'thanks' | 'acknowledgement' | 'goodbye' | 'dismissal';

function normalise(message: string): string {
  return String(message || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(NOT_WORD_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ADDRESS = "(?: (?:sir|mam|ma'?am|madam|miss|teacher|tutor|ji|bhaiya|didi|there|buddy|friend|dear))*";
const ACK_WORD = "(?:o+k+|okay+|okie|okk+|k|kk|alright|all right|fine|got it|i got it|understood|i understood|i understand|i understand now|now i understand|clear|it is clear|its clear|it's clear|all clear|theek hai|thik hai|ठीक है|accha|acha|achha|samajh gaya|samajh gayi|samajh aa gaya|samajh aagaya|hmm+|cool|great|nice|good|perfect|awesome|super|wow|no problem|np|done)";
const SMALL_TALK: Array<[K12SmallTalk, RegExp]> = [
  ['greeting', new RegExp(`^(?:hi+|hello+|helo+|hlo+|hey+|heya|hai|hy|yo|sup|namaste|namaskar|नमस्ते|good (?:morning|afternoon|evening|day)|gm)${ADDRESS}$`)],
  ['thanks', new RegExp(`^(?:${ACK_WORD} )*(?:thanks|thank you|thank u|thankyou|thanku|thnx|thnks|thx|tysm|ty|tq|dhanyavaad|dhanyawad|dhanyavad|shukriya|धन्यवाद)(?: (?:so much|very much|a lot|alot|a ton))?${ADDRESS}(?: (?:for (?:the|your) (?:help|explanation|answer)|i got it|got it|understood|it helped|that helped))?$`)],
  ['goodbye', new RegExp(`^(?:${ACK_WORD} )?(?:bye+|bye bye|goodbye|good bye|good night|gn|see you|see you later|see ya|tata|cya)${ADDRESS}$`)],
  ['dismissal', new RegExp(`^(?:(?:ok|okay|no|please|pls|plz) )*(?:let it be|leave it|never mind|nevermind|nvm|no need|not needed|forget it|ignore|ignore it|ignore this|ignore that|ignore (?:the|this|my) (?:doubt|question|message)|skip it|rehne do|chhodo|chodo|nothing|its ok|it's ok|its okay|it's okay|no thanks|no thank you)(?: (?:please|pls|plz))?${ADDRESS}$`)],
  ['acknowledgement', new RegExp(`^${ACK_WORD}(?: ${ACK_WORD}){0,2}${ADDRESS}$`)],
];

/** Whole-message match only, so "thanks, now explain osmosis" is still a question. null = not small talk. */
export function classifyK12SmallTalk(message: string): K12SmallTalk | null {
  const text = normalise(message);
  if (!text || text.length > 60 || text.split(' ').length > 8) return null;
  for (const [kind, re] of SMALL_TALK) if (re.test(text)) return kind;
  return null;
}

// ─── Short follow-up ───────────────────────────────────────────────────────────

/** Words that point at the conversation and carry no topic of their own. */
const FOLLOW_UP_WORDS = new Set((
  // what to do
  'solve solved answer answers explain explained explanation do show tell give simplify elaborate continue repeat try check write find help understand understood get got clarify describe want need see look read make ' +
  // what it points at
  'it this that these those above below same previous last first second third next other another one two three both all rest remaining here there photo image picture pic question questions ques que qn q no number part point step steps sum problem example examples option options line page exercise ex doubt solution method way formula diagram figure graph ' +
  // filler
  "please pls plz the a an of in to for me my i you u your can could will would should is are was were am did does not dont don't didn't didnt cant can't cannot isn't isnt wasn't also too again more once now ok okay yes yeah yep ya nope sure and but or with from on at by as so then only just still why how what which where when simple simpler simply short shorter brief briefly detail detailed details full complete completely words hindi english hinglish marathi easy easier language clear clearly properly correct wrong right sir mam ma'am madam teacher miss similar different about mean means meaning go ahead bit little much very " +
  // Hinglish
  'hai hain kya kaise kyu kyun kyon samajh samjha samjhao samjhana nahi nhi nahin aaya aya aayi karo kar do batao bata phir fir se aur ek baar isko iska iske yeh ye wo woh hua ho mein me ka ki ke ko wala wali dobara'
).split(' '));

/**
 * A short message that only makes sense with the conversation before it: "Q57", "solve it",
 * "explain again in simple words", "point 5 did not understand", "yes". Every word must be a
 * pointer / filler / number — "explain photosynthesis" names its own topic and is not one.
 */
export function isContextDependentFollowUp(message: string): boolean {
  const text = normalise(message);
  if (!text || classifyK12SmallTalk(message)) return false;
  if (/[=+^*×÷√<>]/.test(message)) return false;        // "Solve x^2 + 5x + 6 = 0" is a new question
  const words = text.split(' ');
  if (words.length > 10) return false;
  return words.every(w =>
    FOLLOW_UP_WORDS.has(w)
    || /^\d{1,3}[a-z]?$/.test(w)                       // 57, 3b
    || /^[ivx]{1,5}$/.test(w)                          // vii
    || /^[a-z]$/.test(w)                               // (b)
    || /^(?:q|ques|que|qn|no|ex)\d{1,3}[a-z]?$/.test(w));  // q57
}

/** A follow-up needs something to follow: an AI reply earlier in the chat. */
export function isK12FollowUpTurn(message: string, history: TurnMessage[]): boolean {
  return history.some(m => m.role === 'assistant') && isContextDependentFollowUp(message);
}

/**
 * Curriculum lookup words for a short follow-up: the earlier question it refers to (for a photo,
 * the numbered question it names when there is one) followed by the follow-up itself.
 */
export function k12FollowUpLookupQuery(message: string, history: TurnMessage[]): string {
  let anchor = '';
  let seen = 0;
  for (let i = history.length - 1; i >= 0 && seen < 8; i--) {
    const m = history[i];
    if (m.role !== 'user' || typeof m.content !== 'string') continue;
    seen++;
    if (isPhotoHistoryEntry(m.content)) {
      const text = photoTextOf(m.content);
      anchor = excerptForQuestionNumber(text, firstNumberIn(message)) || text.slice(0, 500);
      break;
    }
    if (parseImageUploadMessage(m.content)) continue; // older photo message, no read text kept
    if (!classifyK12SmallTalk(m.content) && !isContextDependentFollowUp(m.content)) {
      anchor = m.content.slice(0, 500);
      break;
    }
  }
  return anchor ? `${anchor}\n${message}`.trim() : message;
}

/**
 * What names the question on a photo turn: the note typed with the photo, else a bare pointer
 * ("Q74") the student sent just before it.
 */
export function photoQuestionPointer(note: string, history: TurnMessage[]): string {
  if (note) return note;
  for (let i = history.length - 1; i >= Math.max(0, history.length - 3); i--) {
    const m = history[i];
    if (m.role !== 'user') continue;
    return typeof m.content === 'string' && firstNumberIn(m.content) && isContextDependentFollowUp(m.content)
      ? m.content.trim()
      : '';
  }
  return '';
}

// ─── Rules added to the prompt for this turn ───────────────────────────────────

export interface K12StudentLabels { firstName?: string; subject?: string; assistantName?: string }

/** Token-supplied labels are data, not instructions: plain name-like text only, short. */
export function safePromptLabel(value: string | null | undefined, max = 60): string {
  return String(value || '')
    .replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ')
    .replace(NOT_LABEL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function studentFirstNameOf(name: string | null | undefined): string {
  const display = String(name || '')
    .replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ')
    .replace(NOT_NAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (display.split(/\s+/)[0] || '').slice(0, 40);
}

const NO_REFUSAL = `NEVER reply that the topic isn't in the curriculum or syllabus here, and NEVER say you cannot see, view or open images.`;

export function k12PhotoTurnRule(opts: { imageAttached: boolean; note?: string; subject?: string }): string {
  const subject = opts.subject ? ` in ${opts.subject}` : '';
  const look = opts.imageAttached
    ? `The student sent a photo and it is attached to their latest message — look at the photo itself. The "${PHOTO_TEXT_LABEL.replace(':', '')}" in that message is only a rough transcription: trust the photo for diagrams, graphs, tables, handwriting, and pages that are sideways or upside down.`
    : `The student sent a photo of their question. The text read from it is in their latest message ("${PHOTO_TEXT_LABEL.replace(':', '')}") — that text IS the question.`;
  return `PHOTO QUESTION — THIS TURN (this overrides the curriculum-only rules above):
${look}
- Which question: if the student's note${opts.note ? ` ("${opts.note}")` : ''} or their previous message names a question or part (for example "Q74" or "part b"), answer exactly that one. If the photo has up to 3 short questions and none is named, answer all of them. If it has more and none is named, answer the first complete question and add one short line saying they can send the number of any other question they want solved.
- How: use the curriculum content from the lookup when it is about this question. When it is not, solve the question directly, step by step, with the standard method for the student's class${subject}, and state the final answer clearly. Do not ask "what would you like to know about this?" — answer.
- ${NO_REFUSAL}
- If the photo has no study question in it (blank, too blurred to read, or not study material), say in one line what you can make out and ask the student to send a clearer photo or type the question.`;
}

export const K12_FOLLOW_UP_TURN_RULE = `FOLLOW-UP — THIS TURN:
The student's message is a short follow-up on what is already in this conversation (their earlier question, a photo question whose text is in the conversation, or your last answer). It is not a new topic.
- Work out what it refers to and answer that: the question number or part they name, the step or point they did not understand, a simpler or repeated explanation, or carrying on with what you offered.
- If it refers to a question from the student's photo, solve that question step by step from the text read from the photo.
- The curriculum lookup for this turn may have returned nothing, or content about something else — use it only if it helps.
- ${NO_REFUSAL}
- Only if you truly cannot tell what they mean, ask one short clarifying question.`;

export function k12SmallTalkTurnRule(kind: K12SmallTalk, student: K12StudentLabels = {}): string {
  const name = student.firstName ? ` (${student.firstName})` : '';
  const subject = student.subject ? ` in ${student.subject}` : '';
  const what: Record<K12SmallTalk, string> = {
    greeting: `The student is only saying hello. Greet them${name} back in one short, warm sentence as their${student.subject ? ` ${student.subject}` : ''} tutor and ask what they would like to work on${subject}. Never mention courses, admissions, fees or anything a sales or support assistant would say.`,
    thanks: `The student is thanking you. Reply in one short, warm sentence (for example "You're welcome${student.firstName ? `, ${student.firstName}` : ''}!"). Do not explain any topic.`,
    acknowledgement: `The student is only acknowledging your last message. Reply in one short, friendly sentence. Do not explain the topic again and do not start a new one.`,
    goodbye: `The student is saying goodbye. Say goodbye in one short, warm sentence.`,
    dismissal: `The student is telling you to drop it — they no longer need help with that doubt. Acknowledge in one short, friendly sentence and say they can ask whenever they like. Do not explain anything.`,
  };
  return `SMALL TALK — THIS TURN:
${what[kind]}
Do not call curriculum tools. NEVER reply that the topic isn't in the curriculum or syllabus.`;
}

/** System line for the very first "hi" of a signed-in student (used instead of the business greeting). */
export function k12GreetingPrompt(student: K12StudentLabels = {}): string {
  const who = student.assistantName ? `You are ${student.assistantName}, ` : 'You are ';
  const whose = student.firstName ? `${student.firstName}'s` : `the student's`;
  return `${who}${whose} friendly${student.subject ? ` ${student.subject}` : ''} tutor. The student just said hello. Greet them${student.firstName ? ' by their first name' : ''} in one short, warm sentence and ask what they would like to work on${student.subject ? ` in ${student.subject}` : ''} today. Never mention courses, admissions, fees or enrolment.`;
}

// ─── Model for photo turns ─────────────────────────────────────────────────────

/** More room than a normal reply: a photo often holds a multi-step problem. */
export const K12_PHOTO_MAX_TOKENS = 2500;
export const K12_PHOTO_TIMEOUT_MS = 60_000;

/**
 * Models to try, in order, for the answer to a photo question. A stronger model is used only on
 * OpenAI (other providers keep the model the account already uses — it still gets the photo);
 * the account's normal model is always the last resort, so a photo turn never fails just because
 * the stronger model is unavailable on that key.
 */
export function k12PhotoModels(provider: string, baseModel: string, preferred = process.env.K12_PHOTO_MODEL): string[] {
  if (provider !== 'openai') return [baseModel];
  const models = [(preferred || '').trim() || 'gpt-4.1', 'gpt-4o', baseModel];
  return models.filter((m, i) => m && models.indexOf(m) === i);
}
