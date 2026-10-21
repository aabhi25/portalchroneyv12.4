/**
 * Journeys remember what the visitor already said.
 *
 * Before a journey asks a question, the answer is looked up in what this conversation already
 * holds: the conversation's lead (mobile / name / email captured anywhere in the chat) and the
 * answers given to earlier journeys in the same chat ("highest qualification" asked by the Fees
 * journey is not asked again by the Eligibility journey). Known steps are recorded and skipped.
 *
 * A step is matched by what it asks for (stepKeys): its configured field name / CRM key, a
 * recognised topic (phone, email, name, qualification, course, city, experience), and its exact
 * question wording. A topic is only a guess, so it is used carefully (knownAnswerFor): never from
 * another question of the same journey (its questions are different on purpose: "completed your
 * degree?" then "percentage in your degree?"), never for a step with its own field name, and a
 * "pick one" question only takes an answer that is one of its options.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { journeyResponses, journeySteps } from '@shared/schema';
import { journeyService } from './journeyService';
import { getConversationLead } from './leadCapture/leadStore';
import { isValidLeadName } from './leadCapture/detectors';

type StepLike = {
  questionText?: string | null;
  questionType?: string | null;
  fieldName?: string | null;
  crmFieldKey?: string | null;
  toolTrigger?: string | null;
  journeyId?: string | null;
  multipleChoiceOptions?: string | string[] | null;
};

/** A remembered answer and the journey it was given in (null: the chat's lead). */
export type KnownAnswer = { answer: string; journeyId: string | null };

export type ContactSlot = 'phone' | 'email' | 'name';

const NON_PERSON_NAME = /\b(company|organi[sz]ation|college|school|university|institute|institution|course|program(?:me)?|business|brand|product|father'?s?|mother'?s?|parent'?s?|guardian'?s?|spouse'?s?|employer'?s?|city|state|country|file|user)\s*(?:'s\s*)?name\b|\bname\s+of\s+(?:the|your)\s+(?:company|organi[sz]ation|college|school|university|institute|course|program)/i;

function text(step: StepLike): string {
  return `${step.questionText || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The part of the question that actually asks something: its last question sentence, else its
 * last sentence ("Thanks for sharing your mobile number! May I have your name, please?" asks for
 * the name, not the mobile number).
 */
function askText(step: StepLike): string {
  const sentences = text(step).split(/(?<=[.!?।])\s+/).map(x => x.replace(/[^\w\s'?]+$/g, '').trim()).filter(x => /\w/.test(x));
  if (sentences.length <= 1) return text(step);
  const questions = sentences.filter(x => x.includes('?'));
  return (questions.length ? questions[questions.length - 1] : sentences[sentences.length - 1]) || text(step);
}

function classify(q: string): ContactSlot | null {
  if (/\b(mobile|phone|whatsapp|contact|cell)\s*(number|no\b|no\.|num)|\bnumber\b.*\b(mobile|phone|whatsapp)\b|\bshare your (mobile|phone|whatsapp)\b/.test(q)) return 'phone';
  if (/\be-?mail\b/.test(q)) return 'email';
  if (/\bname\b/.test(q) && !NON_PERSON_NAME.test(q)) return 'name';
  return null;
}

/** The contact detail a step asks for (null = not a contact question). */
export function contactSlot(step: StepLike): ContactSlot | null {
  const type = String(step.questionType || '').toLowerCase();
  const key = `${step.fieldName || ''} ${step.crmFieldKey || ''}`.toLowerCase();
  if (type === 'phone' || /\b(phone|mobile|whatsapp|contact_?number)\b/.test(key)) return 'phone';
  if (type === 'email' || /\be-?mail\b/.test(key)) return 'email';
  if (/\b(full_?name|first_?name|name)\b/.test(key) && !/(company|college|course|program)/.test(key)) return 'name';
  return classify(askText(step)) ?? (askText(step) === text(step) ? null : classify(text(step)));
}

const TOPICS: Array<[string, RegExp]> = [
  ['qualification', /\b(qualification|educational background|education|degree|graduat\w*|studied|highest (level|study))\b/],
  ['experience', /\b(work(ing)? experience|years of experience|experience)\b/],
  ['course', /\b(course|program(me)?|speciali[sz]ation|stream)\b/],
  ['city', /\b(city|location|where (do|are) you (live|located|based|from))\b/],
];

/** Every key that identifies what a step asks for (most specific first). */
export function stepKeys(step: StepLike): string[] {
  const keys: string[] = [];
  const explicit = String(step.crmFieldKey || step.fieldName || '').trim().toLowerCase();
  if (explicit) keys.push(`key:${explicit}`);
  const contact = contactSlot(step);
  if (contact) keys.push(contact);
  else {
    // Only what the question actually asks ("...explore the programme. How would you like the
    // details?" is not a course question).
    const topic = TOPICS.find(([, re]) => re.test(askText(step)));
    if (topic) keys.push(`topic:${topic[0]}`);
  }
  const normalized = text(step).replace(new RegExp(String.raw`[^\p{L}\p{N} ]`, 'gu'), '').trim();
  if (normalized) keys.push(`q:${normalized}`);
  return keys;
}

/** What this conversation already knows, keyed like stepKeys. */
export async function loadKnownAnswers(conversationId: string, businessAccountId: string): Promise<Map<string, KnownAnswer>> {
  const known = new Map<string, KnownAnswer>();
  const lead = await getConversationLead(conversationId, businessAccountId).catch(() => undefined);
  if (lead?.phone?.trim()) known.set('phone', { answer: lead.phone.trim(), journeyId: null });
  if (lead?.email?.trim()) known.set('email', { answer: lead.email.trim(), journeyId: null });
  if (lead?.name && isValidLeadName(lead.name)) known.set('name', { answer: lead.name.trim(), journeyId: null });
  const rows = await db
    .select({
      response: journeyResponses.response,
      questionText: journeySteps.questionText,
      questionType: journeySteps.questionType,
      fieldName: journeySteps.fieldName,
      crmFieldKey: journeySteps.crmFieldKey,
      journeyId: journeyResponses.journeyId,
    })
    .from(journeyResponses)
    .innerJoin(journeySteps, eq(journeyResponses.stepId, journeySteps.id))
    .where(and(eq(journeyResponses.conversationId, conversationId)))
    .orderBy(journeyResponses.createdAt);
  for (const r of rows) {
    const answer = (r.response || '').trim();
    if (!answer || answer.startsWith('[SKIPPED')) continue;
    for (const key of stepKeys(r)) if (!known.has(key)) known.set(key, { answer, journeyId: r.journeyId });
  }
  return known;
}

function choiceOptions(step: StepLike): string[] | null {
  const raw = step.multipleChoiceOptions;
  if (!raw) return null;
  try {
    const list = Array.isArray(raw) ? raw : JSON.parse(raw);
    return Array.isArray(list) && list.length ? list.map(o => String(o).trim().toLowerCase()).filter(Boolean) : null;
  } catch {
    return null;
  }
}

export function knownAnswerFor(step: StepLike, known: Map<string, KnownAnswer>): { key: string; answer: string } | null {
  const options = choiceOptions(step);
  const hasOwnKey = !!String(step.crmFieldKey || step.fieldName || '').trim();
  for (const key of stepKeys(step)) {
    const v = known.get(key);
    if (!v) continue;
    if (key.startsWith('topic:')) {
      // A topic is a guess: not for a step that says exactly what it saves, and never from
      // another question of this same journey.
      if (hasOwnKey) continue;
      if (step.journeyId && v.journeyId === step.journeyId) continue;
    }
    // A "pick one" question is only answered with one of its own options.
    if (options && !options.includes(v.answer.trim().toLowerCase())) continue;
    return { key, answer: v.answer };
  }
  return null;
}

export interface AutoFillResult {
  filled: Array<{ question: string; answer: string }>;
  /** No question left (the journey is finished). */
  completed: boolean;
}

/**
 * Record and skip the journey's upcoming steps whose answer is already known. Stops at the
 * first unknown step (or the end of the journey). Uses the journey's normal recording, so
 * branching rules still apply.
 */
export async function autoFillKnownSteps(conversationId: string, businessAccountId: string): Promise<AutoFillResult> {
  const filled: AutoFillResult['filled'] = [];
  let known: Map<string, KnownAnswer> | null = null;
  for (let i = 0; i < 25; i++) {
    const step = await journeyService.getCurrentStep(conversationId);
    if (!step) return { filled, completed: true };
    if (step.toolTrigger === 'journey_complete') break;
    known ??= await loadKnownAnswers(conversationId, businessAccountId);
    const hit = knownAnswerFor(step, known);
    if (!hit) break;
    const ok = await journeyService.recordResponse(conversationId, hit.answer);
    if (!ok) break;
    filled.push({ question: step.questionText || '', answer: hit.answer });
    console.log(`[Journey Memory] Skipped a question already answered in this chat (${hit.key.split(':')[0]}): "${(step.questionText || '').slice(0, 60)}"`);
  }
  return { filled, completed: !(await journeyService.getCurrentStep(conversationId)) };
}

/** "the visitor's mobile number, name" — what was skipped, for the next acknowledgment. */
export function describeFilled(filled: AutoFillResult['filled']): string {
  return filled.map(f => {
    const slot = contactSlot({ questionText: f.question });
    return slot === 'phone' ? 'their mobile number' : slot === 'name' ? `their name (${f.answer})` : slot === 'email' ? 'their email' : `"${f.question.trim()}" → ${f.answer}`;
  }).join('; ');
}
