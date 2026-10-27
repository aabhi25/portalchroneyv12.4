/**
 * "Set up from Meritto sheet" on the Meritto settings page: loads Meritto's master data for the
 * account and lines the account up with it in one go —
 *  - the journey question saved as the course (a pick-one question) gets exactly Meritto's courses
 *    (options that match are renamed in place, so their routes stay; the rest are removed), and so
 *    does a chat-menu lead form's dropdown labelled like "Program Name" or "Course";
 *  - the fields campus (from the course), state (from the city), city and medium are added when missing;
 *  - leads that failed to reach Meritto are sent again.
 * Preview shows the same plan without changing anything; Undo puts the journey options back and
 * removes the added fields.
 */
import crypto from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  chatMenuConfigs, chatMenuItems, conversationJourneys, journeySteps, leads, merittoFieldMappings, merittoMasterLists,
  type MerittoCity, type MerittoFieldMapping, type MerittoProgram, type MerittoSetupBackup,
} from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { COURSE_FIELD_LABEL, indexMerittoLists, loadMerittoSheet, type MerittoListsIndex, type MerittoSheet } from "./merittoMasterData";

// ── The lists while sending ──────────────────────────────────────────────────

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; index: MerittoListsIndex | null }>();

/** The account's Meritto lists ready for matching, or null when none are loaded. */
export async function getMerittoListsIndex(businessAccountId: string): Promise<MerittoListsIndex | null> {
  const hit = cache.get(businessAccountId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.index;
  const [row] = await db.select({ programs: merittoMasterLists.programs, cities: merittoMasterLists.cities })
    .from(merittoMasterLists).where(eq(merittoMasterLists.businessAccountId, businessAccountId));
  const index = row && (row.programs?.length || row.cities?.length) ? indexMerittoLists(row.programs, row.cities) : null;
  cache.set(businessAccountId, { at: Date.now(), index });
  return index;
}

export function forgetMerittoLists(businessAccountId: string) {
  cache.delete(businessAccountId);
}

export async function getMerittoListsStatus(businessAccountId: string) {
  const [row] = await db.select().from(merittoMasterLists).where(eq(merittoMasterLists.businessAccountId, businessAccountId));
  return {
    sheetUrl: row?.sheetUrl ?? null,
    programs: row?.programs?.length ?? 0,
    cities: row?.cities?.length ?? 0,
    loadedAt: row?.loadedAt ?? null,
    canUndo: !!row?.setupBackup,
    appliedAt: row?.setupBackup?.appliedAt ?? null,
  };
}

// ── The plan ─────────────────────────────────────────────────────────────────

export interface CourseQuestionPlan {
  /** A journey question, or a dropdown in a chat-menu lead form. */
  kind: "journey" | "form";
  /** The journey step id, or "<menu_config|menu_item>:<row id>:<field id>" for a form. */
  stepId: string;
  /** Journey name, or the form's name ("Chat menu form" / the menu item's title). */
  journeyName: string;
  questionText: string;
  renames: Array<{ from: string; to: string }>;
  keeps: string[];
  removes: string[];
  adds: string[];
  /** The options after the change: Meritto's courses in Meritto's order. */
  options: string[];
}

export interface FieldPlan {
  field: string;
  action: "add" | "keep";
  /** In plain words: what the field will send. */
  sends: string;
}

export interface MerittoSetupPlan {
  sheetUrl: string;
  programs: number;
  cities: number;
  levels: string[];
  courseKey: string;
  courseQuestions: CourseQuestionPlan[];
  fields: FieldPlan[];
  resend: number;
}

const NEW_FIELDS: Array<{ field: string; needs: "programs" | "cities" | null; row: Pick<MerittoFieldMapping, "sourceType" | "sourceField" | "fallbackValue">; sends: string }> = [
  { field: "campus", needs: "programs", row: { sourceType: "dynamic", sourceField: "meritto.campus", fallbackValue: null }, sends: "The course's programme level (UG / PG / Ph.D) from Meritto's course list" },
  { field: "city", needs: "cities", row: { sourceType: "dynamic", sourceField: "session.city", fallbackValue: null }, sends: "The visitor's city, in Meritto's spelling" },
  { field: "state", needs: "cities", row: { sourceType: "dynamic", sourceField: "meritto.state", fallbackValue: null }, sends: "The city's state from Meritto's city list" },
  { field: "medium", needs: null, row: { sourceType: "dynamic", sourceField: "session.utmMedium", fallbackValue: "Chatbot" }, sends: "The visitor's UTM medium, or \"Chatbot\" when there is none" },
];

const parseOptions = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(x => String(x ?? "")) : [];
  } catch {
    return [];
  }
};
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** The journey answer the course field reads ("journey.course" → "course"); "course" when there is no such row. */
function courseKeyFrom(mappings: MerittoFieldMapping[]): string {
  const row = mappings.find(m => same(m.merittoField, "course") && m.sourceType !== "custom" && m.sourceField?.startsWith("journey."));
  return row ? row.sourceField!.slice("journey.".length) : "course";
}

async function courseSteps(businessAccountId: string, courseKey: string) {
  return db.select({
    id: journeySteps.id,
    journeyName: conversationJourneys.name,
    questionText: journeySteps.questionText,
    multipleChoiceOptions: journeySteps.multipleChoiceOptions,
    branchingCondition: journeySteps.branchingCondition,
    exitOnValue: journeySteps.exitOnValue,
    skipOnValue: journeySteps.skipOnValue,
  })
    .from(journeySteps)
    .innerJoin(conversationJourneys, eq(journeySteps.journeyId, conversationJourneys.id))
    .where(and(
      eq(conversationJourneys.businessAccountId, businessAccountId),
      sql`lower(trim(${journeySteps.crmFieldKey})) = ${courseKey.trim().toLowerCase()}`,
      inArray(journeySteps.questionType, ["dropdown", "radio"]),
    ));
}

interface FormField { id: string; label: string; fieldType: string; options?: string[]; lsqQualifyValues?: string[] }
type FormRow = { table: "menu_config" | "menu_item"; id: string; name: string; leadFormFields: string | null };

const parseForm = (raw: string | null): { custom?: FormField[] } | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && Array.isArray(v.custom) ? v : null;
  } catch {
    return null;
  }
};

/** The account's chat-menu lead forms (menu-level form and lead-form menu items). */
async function leadForms(businessAccountId: string): Promise<FormRow[]> {
  const configs = await db.select({ id: chatMenuConfigs.id, leadFormFields: chatMenuConfigs.leadFormFields })
    .from(chatMenuConfigs).where(eq(chatMenuConfigs.businessAccountId, businessAccountId));
  const items = await db.select({ id: chatMenuItems.id, title: chatMenuItems.title, leadFormFields: chatMenuItems.leadFormFields })
    .from(chatMenuItems).where(and(eq(chatMenuItems.businessAccountId, businessAccountId), sql`${chatMenuItems.leadFormFields} IS NOT NULL`));
  return [
    ...configs.map(c => ({ table: "menu_config" as const, id: c.id, name: "Chat menu form", leadFormFields: c.leadFormFields })),
    ...items.map(i => ({ table: "menu_item" as const, id: i.id, name: `Menu form: ${i.title}`, leadFormFields: i.leadFormFields })),
  ];
}

const courseFieldsOf = (form: FormRow) =>
  (parseForm(form.leadFormFields)?.custom ?? []).filter(f => f.fieldType === "dropdown" && COURSE_FIELD_LABEL.test(f.label || ""));

function planOptions(current: string[], programs: MerittoProgram[]) {
  const index = indexMerittoLists(programs, []);
  const used = new Set<string>();
  const renames: Array<{ from: string; to: string }> = [];
  const keeps: string[] = [];
  const removes: string[] = [];
  for (const label of current) {
    const program = label.trim() ? index.matchProgram(label) : null;
    if (program && !used.has(program.name)) {
      used.add(program.name);
      if (program.name === label) keeps.push(label); else renames.push({ from: label, to: program.name });
    } else {
      removes.push(label);
    }
  }
  return { renames, keeps, removes, adds: programs.map(p => p.name).filter(n => !used.has(n)), options: programs.map(p => p.name) };
}

async function stuckLeadIds(businessAccountId: string): Promise<string[]> {
  const rows = await db.select({ id: leads.id }).from(leads).where(and(
    eq(leads.businessAccountId, businessAccountId),
    inArray(leads.merittoSyncStatus, ["needs_attention", "failed"]),
    sql`${leads.contactsMaskedAt} IS NULL`,
  )).limit(500);
  return rows.map(r => r.id);
}

export async function planMerittoSetup(businessAccountId: string, sheet: MerittoSheet): Promise<MerittoSetupPlan> {
  const mappings = await db.select().from(merittoFieldMappings).where(eq(merittoFieldMappings.businessAccountId, businessAccountId));
  const courseKey = courseKeyFrom(mappings);
  const steps = sheet.programs.length ? await courseSteps(businessAccountId, courseKey) : [];
  const forms = sheet.programs.length ? await leadForms(businessAccountId) : [];
  const formQuestions: CourseQuestionPlan[] = forms.flatMap(form => courseFieldsOf(form).map(f => ({
    kind: "form" as const, stepId: `${form.table}:${form.id}:${f.id}`, journeyName: form.name, questionText: f.label,
    ...planOptions((f.options ?? []).map(o => String(o ?? "")), sheet.programs),
  })));
  const have = new Set(mappings.map(m => m.merittoField.trim().toLowerCase()));
  const fields: FieldPlan[] = NEW_FIELDS
    .filter(f => !f.needs || (f.needs === "programs" ? sheet.programs.length : sheet.cities.length))
    .map(f => ({ field: f.field, action: have.has(f.field) ? "keep" : "add", sends: have.has(f.field) ? "Already in your fields; kept as it is" : f.sends }));
  return {
    sheetUrl: sheet.sheetUrl,
    programs: sheet.programs.length,
    cities: sheet.cities.length,
    levels: Array.from(new Set(sheet.programs.map(p => p.level))),
    courseKey,
    courseQuestions: [
      ...steps.map(s => ({ kind: "journey" as const, stepId: s.id, journeyName: s.journeyName, questionText: s.questionText, ...planOptions(parseOptions(s.multipleChoiceOptions), sheet.programs) })),
      ...formQuestions,
    ],
    fields,
    resend: (await stuckLeadIds(businessAccountId)).length,
  };
}

/** Reads the sheet and returns what Apply would change (nothing is saved). */
export async function previewMerittoSetup(businessAccountId: string, sheetUrl: string): Promise<MerittoSetupPlan> {
  return planMerittoSetup(businessAccountId, await loadMerittoSheet(sheetUrl));
}

// ── Apply / Undo ─────────────────────────────────────────────────────────────

/** Routes and old exit/skip answers follow a renamed option; those of a removed option go. */
function renameRoutes(raw: string | null, renames: Map<string, string>, removed: Set<string>): string | null {
  if (!raw) return raw;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v?.routes)) return raw;
    v.routes = v.routes.flatMap((r: any) => {
      if (r?.matchType !== "exact" || typeof r.matchValue !== "string") return [r];
      const key = r.matchValue.trim().toLowerCase();
      if (renames.has(key)) return [{ ...r, matchValue: renames.get(key) }];
      return removed.has(key) ? [] : [r];
    });
    return JSON.stringify(v);
  } catch {
    return raw;
  }
}
const renameValue = (v: string | null, renames: Map<string, string>, removed: Set<string>) => {
  if (!v) return v;
  const key = v.trim().toLowerCase();
  return renames.get(key) ?? (removed.has(key) ? null : v);
};

export interface MerittoSetupResult {
  plan: MerittoSetupPlan;
  questionsChanged: number;
  fieldsAdded: string[];
  resending: number;
}

export async function applyMerittoSetup(businessAccountId: string, sheetUrl: string, load: (url: string) => Promise<MerittoSheet> = loadMerittoSheet): Promise<MerittoSetupResult> {
  const sheet = await load(sheetUrl);
  const plan = await planMerittoSetup(businessAccountId, sheet);
  const steps = plan.courseQuestions.some(q => q.kind === "journey") ? await courseSteps(businessAccountId, plan.courseKey) : [];
  const forms = plan.courseQuestions.some(q => q.kind === "form") ? await leadForms(businessAccountId) : [];
  const changedForms = forms.filter(f => plan.courseQuestions.some(q => q.kind === "form" && q.stepId.startsWith(`${f.table}:${f.id}:`)));
  const [existing] = await db.select().from(merittoMasterLists).where(eq(merittoMasterLists.businessAccountId, businessAccountId));
  const mappings = await db.select().from(merittoFieldMappings).where(eq(merittoFieldMappings.businessAccountId, businessAccountId));
  const lastOrder = mappings.reduce((max, m) => Math.max(max, m.sortOrder), 0);
  const toAdd = plan.fields.filter(f => f.action === "add").map((f, i) => {
    const spec = NEW_FIELDS.find(n => n.field === f.field)!;
    return { id: crypto.randomUUID(), businessAccountId, merittoField: f.field, displayName: f.field, customValue: null, isEnabled: "true", sortOrder: lastOrder + i + 1, ...spec.row };
  });
  const now = new Date();
  const backup: MerittoSetupBackup = {
    appliedAt: now.toISOString(),
    steps: steps.map(s => ({ id: s.id, multipleChoiceOptions: s.multipleChoiceOptions, branchingCondition: s.branchingCondition, exitOnValue: s.exitOnValue, skipOnValue: s.skipOnValue })),
    addedMappingIds: toAdd.map(r => r.id),
    forms: changedForms.map(f => ({ table: f.table, id: f.id, leadFormFields: f.leadFormFields })),
    firstLoad: !existing?.programs?.length && !existing?.cities?.length,
  };

  await db.transaction(async (tx) => {
    const lists = { sheetUrl: sheet.sheetUrl, programs: sheet.programs as MerittoProgram[], cities: sheet.cities as MerittoCity[], setupBackup: backup, loadedAt: now, updatedAt: now };
    await tx.insert(merittoMasterLists).values({ businessAccountId, ...lists })
      .onConflictDoUpdate({ target: merittoMasterLists.businessAccountId, set: lists });
    for (const form of changedForms) {
      const parsed = parseForm(form.leadFormFields)!;
      for (const field of parsed.custom ?? []) {
        const q = plan.courseQuestions.find(x => x.kind === "form" && x.stepId === `${form.table}:${form.id}:${field.id}`);
        if (!q) continue;
        const renames = new Map(q.renames.map(r => [r.from.trim().toLowerCase(), r.to]));
        for (const k of q.keeps) renames.set(k.trim().toLowerCase(), k);
        field.options = q.options;
        // Qualifying answers (LeadSquared gate) follow the renamed options.
        if (Array.isArray(field.lsqQualifyValues)) {
          field.lsqQualifyValues = Array.from(new Set(field.lsqQualifyValues.map(v => renames.get(String(v).trim().toLowerCase())).filter((v): v is string => !!v)));
        }
      }
      const leadFormFields = JSON.stringify(parsed);
      if (form.table === "menu_config") await tx.update(chatMenuConfigs).set({ leadFormFields, updatedAt: now }).where(eq(chatMenuConfigs.id, form.id));
      else await tx.update(chatMenuItems).set({ leadFormFields, updatedAt: now }).where(eq(chatMenuItems.id, form.id));
    }
    for (const q of plan.courseQuestions) {
      if (q.kind !== "journey") continue;
      const step = steps.find(s => s.id === q.stepId);
      if (!step) continue;
      const renames = new Map(q.renames.map(r => [r.from.trim().toLowerCase(), r.to]));
      for (const k of q.keeps) renames.set(k.trim().toLowerCase(), k);
      const removed = new Set(q.removes.map(r => r.trim().toLowerCase()).filter(r => !renames.has(r)));
      await tx.update(journeySteps).set({
        multipleChoiceOptions: JSON.stringify(q.options),
        branchingCondition: renameRoutes(step.branchingCondition, renames, removed),
        exitOnValue: renameValue(step.exitOnValue, renames, removed),
        skipOnValue: renameValue(step.skipOnValue, renames, removed),
        updatedAt: now,
      }).where(eq(journeySteps.id, q.stepId));
    }
    if (toAdd.length) await tx.insert(merittoFieldMappings).values(toAdd);
  });
  forgetMerittoLists(businessAccountId);

  // Leads that didn't make it to Meritto are sent again, one after another, in the background.
  const settings = await storage.getWidgetSettings(businessAccountId);
  const ids = settings?.merittoEnabled === "true" ? await stuckLeadIds(businessAccountId) : [];
  if (ids.length) {
    setImmediate(async () => {
      const { syncLeadToMeritto } = await import("./merittoSync");
      for (const id of ids) {
        try { await syncLeadToMeritto(businessAccountId, id, { manual: true }); }
        catch (err) { console.error("[Meritto] Re-send after setup failed for lead", id, err); }
      }
      console.log(`[Meritto] Re-sent ${ids.length} lead(s) after setting up from the Meritto sheet`);
    });
  }
  return { plan, questionsChanged: plan.courseQuestions.length, fieldsAdded: toAdd.map(r => r.merittoField), resending: ids.length };
}

/** Puts the course options back and removes the fields the last setup added. */
export async function undoMerittoSetup(businessAccountId: string): Promise<{ questionsRestored: number; fieldsRemoved: number }> {
  const [row] = await db.select().from(merittoMasterLists).where(eq(merittoMasterLists.businessAccountId, businessAccountId));
  const backup = row?.setupBackup;
  if (!backup) throw new Error("There is no setup to undo.");
  let questionsRestored = 0;
  let fieldsRemoved = 0;
  await db.transaction(async (tx) => {
    for (const s of backup.steps) {
      const owned = await tx.select({ id: journeySteps.id }).from(journeySteps)
        .innerJoin(conversationJourneys, eq(journeySteps.journeyId, conversationJourneys.id))
        .where(and(eq(journeySteps.id, s.id), eq(conversationJourneys.businessAccountId, businessAccountId)));
      if (!owned.length) continue;
      await tx.update(journeySteps).set({
        multipleChoiceOptions: s.multipleChoiceOptions, branchingCondition: s.branchingCondition,
        exitOnValue: s.exitOnValue, skipOnValue: s.skipOnValue, updatedAt: new Date(),
      }).where(eq(journeySteps.id, s.id));
      questionsRestored++;
    }
    for (const f of backup.forms ?? []) {
      const table = f.table === "menu_config" ? chatMenuConfigs : chatMenuItems;
      const done = await tx.update(table).set({ leadFormFields: f.leadFormFields, updatedAt: new Date() })
        .where(and(eq(table.id, f.id), eq(table.businessAccountId, businessAccountId))).returning({ id: table.id });
      questionsRestored += done.length;
    }
    if (backup.addedMappingIds.length) {
      const removed = await tx.delete(merittoFieldMappings).where(and(
        eq(merittoFieldMappings.businessAccountId, businessAccountId),
        inArray(merittoFieldMappings.id, backup.addedMappingIds),
      )).returning({ id: merittoFieldMappings.id });
      fieldsRemoved = removed.length;
    }
    await tx.update(merittoMasterLists).set(backup.firstLoad
      ? { programs: null, cities: null, sheetUrl: null, loadedAt: null, setupBackup: null, updatedAt: new Date() }
      : { setupBackup: null, updatedAt: new Date() })
      .where(eq(merittoMasterLists.businessAccountId, businessAccountId));
  });
  forgetMerittoLists(businessAccountId);
  return { questionsRestored, fieldsRemoved };
}
