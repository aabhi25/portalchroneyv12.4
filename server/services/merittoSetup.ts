/**
 * "Set up from Meritto sheet" on the Meritto settings page: loads Meritto's master data for the
 * account and lines the account up with it in one go —
 *  - the journey question saved as the course (a pick-one question) gets exactly Meritto's courses
 *    (options that match are renamed in place, so their routes stay; the rest are removed);
 *  - the fields campus (from the course), state (from the city), city and medium are added when missing;
 *  - leads that failed to reach Meritto are sent again.
 * Preview shows the same plan without changing anything; Undo puts the journey options back and
 * removes the added fields.
 */
import crypto from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  conversationJourneys, journeySteps, leads, merittoFieldMappings, merittoMasterLists,
  type MerittoCity, type MerittoFieldMapping, type MerittoProgram, type MerittoSetupBackup,
} from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { indexMerittoLists, loadMerittoSheet, type MerittoListsIndex, type MerittoSheet } from "./merittoMasterData";

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
  stepId: string;
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
    courseQuestions: steps.map(s => ({ stepId: s.id, journeyName: s.journeyName, questionText: s.questionText, ...planOptions(parseOptions(s.multipleChoiceOptions), sheet.programs) })),
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
  const steps = plan.courseQuestions.length ? await courseSteps(businessAccountId, plan.courseKey) : [];
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
    firstLoad: !existing?.programs?.length && !existing?.cities?.length,
  };

  await db.transaction(async (tx) => {
    const lists = { sheetUrl: sheet.sheetUrl, programs: sheet.programs as MerittoProgram[], cities: sheet.cities as MerittoCity[], setupBackup: backup, loadedAt: now, updatedAt: now };
    await tx.insert(merittoMasterLists).values({ businessAccountId, ...lists })
      .onConflictDoUpdate({ target: merittoMasterLists.businessAccountId, set: lists });
    for (const q of plan.courseQuestions) {
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
