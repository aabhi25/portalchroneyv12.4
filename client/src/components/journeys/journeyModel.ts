/**
 * The journey builder's plain-words model, read from and written back to the existing journey
 * steps (journey_steps). Nothing new is stored: the server runs journeys exactly as before
 * (server/services/journeyService.ts → determineNextStep / submitFormStepAndGetNext).
 *
 * How the plain model maps onto steps:
 *  - a question            = a step whose toolTrigger isn't 'journey_complete'
 *  - "Pick one" options     = multipleChoiceOptions (JSON array), questionType 'radio' (or 'dropdown')
 *  - option → Go to X       = branchingCondition route { matchType 'exact', matchValue option, targetStepId X }
 *  - option → End with msg  = a route to an extra ending step (toolTrigger 'journey_complete',
 *                             isConditional 'true') placed after the main ending
 *  - "Only asked when an earlier answer leads here" = isConditional 'true'
 *  - "Saved as"             = crmFieldKey (used for CRM mapping and "don't ask again")
 *  - the ending             = the last journey_complete step that isn't conditional
 * Older settings (Exit on answer, Skip to step) are shown as option choices and saved as routes;
 * rules the builder doesn't show (contains / regex / default route) are kept untouched.
 */

export interface StepRow {
  id: string;
  questionText: string;
  questionType: string;
  isRequired: string;
  stepOrder: number | string;
  toolTrigger?: string | null;
  branchingCondition?: string | null;
  multipleChoiceOptions?: string | null;
  exitOnValue?: string | null;
  exitMessage?: string | null;
  skipOnValue?: string | null;
  skipToStepIndex?: number | null;
  isConditional?: string | null;
  completionButtonText?: string | null;
  crmFieldKey?: string | null;
  fieldName?: string | null;
}

export interface Route {
  matchType: "contains" | "exact" | "regex" | "any";
  matchValue: string;
  targetStepId: string;
  label?: string;
}

export type AnswerKind =
  | "short" | "name" | "mobile" | "email" | "number" | "date"
  | "choice" | "appointment" | "products" | "special";

export const ANSWER_KINDS: { kind: Exclude<AnswerKind, "special">; label: string; hint: string }[] = [
  { kind: "short", label: "Short answer", hint: "They type a few words" },
  { kind: "choice", label: "Pick one", hint: "They tap one of your options" },
  { kind: "name", label: "Name", hint: "Their name" },
  { kind: "mobile", label: "Mobile number", hint: "A 10-digit mobile number" },
  { kind: "email", label: "Email", hint: "An email address" },
  { kind: "number", label: "Number", hint: "Age, budget, years…" },
  { kind: "date", label: "Date", hint: "They pick a date" },
  { kind: "appointment", label: "Book an appointment", hint: "Shows your calendar" },
  { kind: "products", label: "Show products", hint: "Suggests matching products" },
];

export function kindLabel(kind: AnswerKind, raw?: StepRow): string {
  if (kind === "special") {
    const t = raw?.toolTrigger;
    return t === "capture_lead" ? "Save as lead" : t === "get_faqs" ? "Answer from FAQs" : "Special step";
  }
  return ANSWER_KINDS.find(k => k.kind === kind)?.label ?? "Short answer";
}

export type Then =
  | { kind: "next" }
  | { kind: "goto"; stepId: string }
  | { kind: "end"; message: string; endingStepId?: string };

export interface ChoiceOption {
  label: string;
  then: Then;
}

export interface Question {
  /** null while a new question isn't saved yet. */
  id: string | null;
  text: string;
  kind: AnswerKind;
  required: boolean;
  options: ChoiceOption[];
  savedAs: string;
  onlyWhenLed: boolean;
  /** Rules the builder doesn't show, kept as they are. */
  keptRoutes: Route[];
  defaultNextStepId: string | null;
  keepExit: boolean;
  keepSkip: boolean;
  raw?: StepRow;
}

export interface Ending {
  id: string | null;
  message: string;
  buttonText: string;
}

export interface JourneyModel {
  questions: Question[];
  ending: Ending | null;
  /** Extra endings reached from an option ("End the chat with a message"). */
  extraEndings: StepRow[];
}

export const DEFAULT_ENDING_TEXT = "Thank you for completing the form!";

const isEnding = (s: StepRow) => s.toolTrigger === "journey_complete";
const isConditional = (s: StepRow) => s.isConditional === "true";
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function sortSteps(steps: StepRow[]): StepRow[] {
  return [...steps].sort((a, b) => Number(a.stepOrder) - Number(b.stepOrder));
}

function parseOptions(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((o): o is string => typeof o === "string" && o.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function parseBranching(raw?: string | null): { routes: Route[]; defaultNextStepId: string | null } {
  if (!raw) return { routes: [], defaultNextStepId: null };
  try {
    const v = JSON.parse(raw);
    return {
      routes: Array.isArray(v?.routes) ? v.routes.filter((r: Route) => r && r.targetStepId) : [],
      defaultNextStepId: v?.defaultNextStepId || null,
    };
  } catch {
    return { routes: [], defaultNextStepId: null };
  }
}

const NAME_KEY = /\b(full_?name|first_?name|name)\b/i;

export function kindOf(step: StepRow): AnswerKind {
  const tool = step.toolTrigger || "none";
  if (tool === "book_appointment") return "appointment";
  if (tool === "get_products") return "products";
  if (tool !== "none") return "special";
  switch (step.questionType) {
    case "radio":
    case "dropdown":
      return "choice";
    case "phone": return "mobile";
    case "email": return "email";
    case "number": return "number";
    case "date": return "date";
    default:
      return NAME_KEY.test(`${step.crmFieldKey || ""} ${step.fieldName || ""}`) ? "name" : "short";
  }
}

export function readModel(steps: StepRow[]): JourneyModel {
  const sorted = sortSteps(steps);
  const byId = new Map(sorted.map(s => [s.id, s]));
  const endings = sorted.filter(isEnding);
  const mainEnding = [...endings].reverse().find(s => !isConditional(s)) ?? null;
  const extraEndings = endings.filter(s => s !== mainEnding);

  const toThen = (target: StepRow | undefined): Then | null => {
    if (!target) return null;
    return isEnding(target) ? { kind: "end", message: target.questionText, endingStepId: target.id } : { kind: "goto", stepId: target.id };
  };

  const questions: Question[] = sorted.filter(s => !isEnding(s)).map(step => {
    const kind = kindOf(step);
    const { routes, defaultNextStepId } = parseBranching(step.branchingCondition);
    const used = new Set<Route>();
    let exitUsed = false;
    let skipUsed = false;
    const options: ChoiceOption[] = kind === "choice" ? parseOptions(step.multipleChoiceOptions).map(label => {
      const route = routes.find(r => r.matchType === "exact" && same(r.matchValue, label) && byId.has(r.targetStepId));
      if (route) {
        used.add(route);
        const then = toThen(byId.get(route.targetStepId));
        if (then) return { label, then };
      }
      if (step.exitOnValue && same(step.exitOnValue, label)) {
        exitUsed = true;
        return { label, then: { kind: "end", message: step.exitMessage || "Thank you for your time!" } };
      }
      if (step.skipOnValue && same(step.skipOnValue, label) && step.skipToStepIndex != null) {
        const then = toThen(sorted[step.skipToStepIndex]);
        if (then) {
          skipUsed = true;
          return { label, then };
        }
      }
      return { label, then: { kind: "next" } };
    }) : [];
    return {
      id: step.id,
      text: step.questionText,
      kind,
      required: step.isRequired === "true",
      options,
      savedAs: step.crmFieldKey || "",
      onlyWhenLed: isConditional(step),
      keptRoutes: routes.filter(r => !used.has(r)),
      defaultNextStepId,
      keepExit: !!step.exitOnValue && !exitUsed,
      keepSkip: !!step.skipOnValue && !skipUsed,
      raw: step,
    };
  });

  return {
    questions,
    ending: mainEnding ? { id: mainEnding.id, message: mainEnding.questionText, buttonText: mainEnding.completionButtonText || "" } : null,
    extraEndings,
  };
}

/** Step fields for an answer kind (questionType + toolTrigger). */
export function kindFields(kind: AnswerKind, raw?: StepRow): { questionType: string; toolTrigger: string } {
  switch (kind) {
    case "choice": return { questionType: raw?.questionType === "dropdown" ? "dropdown" : "radio", toolTrigger: "none" };
    case "mobile": return { questionType: "phone", toolTrigger: "none" };
    case "email": return { questionType: "email", toolTrigger: "none" };
    case "number": return { questionType: "number", toolTrigger: "none" };
    case "date": return { questionType: "date", toolTrigger: "none" };
    case "appointment": return { questionType: "text", toolTrigger: "book_appointment" };
    case "products": return { questionType: "text", toolTrigger: "get_products" };
    case "special": return { questionType: raw?.questionType || "text", toolTrigger: raw?.toolTrigger || "none" };
    default: return { questionType: "text", toolTrigger: "none" };
  }
}

/**
 * The step fields a question saves (everything except stepOrder). `endingIds` gives the
 * ending step id for each option that ends the chat (created beforehand by the caller).
 */
export function questionPayload(q: Question, endingIds: Map<number, string>): Record<string, unknown> {
  const fields = kindFields(q.kind, q.raw);
  const choice = q.kind === "choice";
  const optionRoutes: Route[] = [];
  if (choice) {
    q.options.forEach((o, i) => {
      const target = o.then.kind === "goto" ? o.then.stepId : o.then.kind === "end" ? endingIds.get(i) : undefined;
      if (target) optionRoutes.push({ matchType: "exact", matchValue: o.label.trim(), targetStepId: target, label: o.label.trim() });
    });
  }
  const routes = [...optionRoutes, ...q.keptRoutes];
  const branching = routes.length > 0 || q.defaultNextStepId
    ? JSON.stringify({ routes, defaultNextStepId: q.defaultNextStepId })
    : null;
  const savedAs = q.kind === "name" && !q.savedAs.trim() ? "name" : q.savedAs.trim();
  return {
    questionText: q.text.trim(),
    ...fields,
    isRequired: q.required ? "true" : "false",
    multipleChoiceOptions: choice ? JSON.stringify(q.options.map(o => o.label.trim()).filter(Boolean)) : null,
    branchingCondition: branching,
    isConditional: q.onlyWhenLed ? "true" : "false",
    crmFieldKey: savedAs || null,
    ...(q.keepExit ? {} : { exitOnValue: null, exitMessage: null }),
    ...(q.keepSkip ? {} : { skipOnValue: null, skipToStepIndex: null }),
  };
}

/** Problems that stop a question from being saved, in plain words. */
export function questionProblems(q: Question): string[] {
  const problems: string[] = [];
  if (!q.text.trim()) problems.push("Write the question.");
  if (q.kind === "choice") {
    const labels = q.options.map(o => o.label.trim()).filter(Boolean);
    if (labels.length < 2) problems.push("Add at least two options.");
    if (new Set(labels.map(l => l.toLowerCase())).size !== labels.length) problems.push("Two options have the same words.");
    q.options.forEach(o => {
      if (o.label.trim() && o.then.kind === "end" && !o.then.message.trim()) problems.push(`Write the message for “${o.label.trim()}”.`);
    });
  }
  return problems;
}

/** Questions (by id) that an option of another question leads to, with where from. */
export function incomingLinks(model: JourneyModel): Map<string, { fromIndex: number; option: string }[]> {
  const links = new Map<string, { fromIndex: number; option: string }[]>();
  model.questions.forEach((q, i) => {
    q.options.forEach(o => {
      if (o.then.kind === "goto") {
        const list = links.get(o.then.stepId) ?? [];
        list.push({ fromIndex: i, option: o.label });
        links.set(o.then.stepId, list);
      }
    });
  });
  return links;
}

/** The step order the builder keeps: questions, then the main ending, then extra endings. */
export function orderedStepIds(questionIds: string[], model: JourneyModel): string[] {
  return [...questionIds, ...(model.ending?.id ? [model.ending.id] : []), ...model.extraEndings.map(s => s.id)];
}

/** Extra endings no question leads to any more. */
export function orphanEndings(model: JourneyModel): string[] {
  const used = new Set<string>();
  model.questions.forEach(q => {
    q.options.forEach(o => { if (o.then.kind === "end" && o.then.endingStepId) used.add(o.then.endingStepId); });
    q.keptRoutes.forEach(r => used.add(r.targetStepId));
    if (q.defaultNextStepId) used.add(q.defaultNextStepId);
  });
  return model.extraEndings.filter(s => !used.has(s.id)).map(s => s.id);
}

export function newQuestion(): Question {
  return {
    id: null, text: "", kind: "short", required: true, options: [], savedAs: "", onlyWhenLed: false,
    keptRoutes: [], defaultNextStepId: null, keepExit: false, keepSkip: false,
  };
}

export const SAVED_AS_SUGGESTIONS = ["city", "course", "qualification", "experience", "budget", "loan_type", "income", "company"];
