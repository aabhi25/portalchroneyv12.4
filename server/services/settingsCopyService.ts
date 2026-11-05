import { randomUUID } from "crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { businessContextCache } from "./businessContextCache";
import { journeyService } from "./journeyService";
import { sanitizeCustomInstructionsChannels } from "./chatContext/customInstructions";
import {
  chatMenuConfigs,
  chatMenuItemDetails,
  chatMenuItems,
  conversationJourneys,
  journeySessions,
  journeySteps,
  settingsCopyLog,
  widgetSettings,
} from "@shared/schema";
import { mergeGroupLeadConfigIntoAccount } from "@shared/leadTrainingConfig";
import {
  COPY_ITEMS,
  copyItem,
  describeValue,
  fieldDetailRows,
  fieldLabel,
  humanizeField,
  mentionedNames,
  mergeInstructions,
  parseInstructionList,
  sameValue,
  stableStringify,
  websiteHost,
  type CopyChange,
  type DetailRow,
  type DetailSection,
  type CopyItem,
  type CopyPreviewTarget,
  type CopyRequest,
  type CopyResultTarget,
  type CopyWarning,
} from "@shared/settingsCopy";

type Row = Record<string, any>;

interface JourneyBundle { journey: Row; steps: Row[] }
interface MenuBundle { config: Row | null; items: Row[]; details: Row[] }

/** The old values of one account, enough to undo a copy. */
export interface CopySnapshot {
  widget: Row;
  journeys: { created: string[]; updated: JourneyBundle[]; cleared: Row[] };
  menu: MenuBundle | null;
}

const withoutKeys = (row: Row, keys: string[]) => {
  const copy: Row = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
};
const JOURNEY_OWN_KEYS = ["id", "businessAccountId", "totalStarts", "totalCompletions", "createdAt", "updatedAt"];
const STEP_OWN_KEYS = ["id", "journeyId", "createdAt", "updatedAt"];
const MENU_OWN_KEYS = ["id", "businessAccountId", "createdAt", "updatedAt"];
const DETAIL_OWN_KEYS = ["id", "menuItemId", "createdAt", "updatedAt"];

const byOrder = (a: Row, b: Row) => Number(a.stepOrder) - Number(b.stepOrder);
const nameKey = (name: unknown) => String(name ?? "").trim().toLowerCase();

async function loadJourneys(businessAccountId: string): Promise<JourneyBundle[]> {
  const journeys = await db.select().from(conversationJourneys).where(eq(conversationJourneys.businessAccountId, businessAccountId));
  if (journeys.length === 0) return [];
  const steps = await db.select().from(journeySteps).where(inArray(journeySteps.journeyId, journeys.map((j) => j.id)));
  return journeys.map((journey) => ({ journey, steps: steps.filter((s) => s.journeyId === journey.id).sort(byOrder) }));
}

async function loadMenu(businessAccountId: string): Promise<MenuBundle> {
  const [config] = await db.select().from(chatMenuConfigs).where(eq(chatMenuConfigs.businessAccountId, businessAccountId)).limit(1);
  const items = await db.select().from(chatMenuItems).where(eq(chatMenuItems.businessAccountId, businessAccountId));
  const details = items.length
    ? await db.select().from(chatMenuItemDetails).where(inArray(chatMenuItemDetails.menuItemId, items.map((i) => i.id)))
    : [];
  return { config: config ?? null, items, details };
}

const instructionsCount = (raw: unknown) => parseInstructionList(typeof raw === "string" ? raw : null).length;

function leadSummary(raw: unknown): string {
  const fields = Array.isArray((raw as Row)?.fields) ? (raw as Row).fields as Row[] : [];
  const on = fields.filter((f) => f.enabled);
  if (on.length === 0) return "None";
  return on.map((f) => `${humanizeField(String(f.id))}${f.required ? " (mandatory)" : ""}`).join(", ");
}

function fieldsSummary(item: CopyItem, settings: Row): string {
  if (item.key === "auto-open") {
    const open = settings.autoOpenChat && settings.autoOpenChat !== "false";
    return `Auto-open ${open ? settings.autoOpenChat : "off"} · sound ${settings.openingSoundEnabled === "false" ? "off" : "on"}`;
  }
  const fields = item.fields ?? [];
  const enabledField = fields.find((f) => f.endsWith("Enabled"));
  const parts: string[] = [];
  if (enabledField) parts.push(settings[enabledField] === "true" ? "On" : "Off");
  // The longest text says the most about it (not a colour, a style or a yes/no).
  const texts = fields
    .filter((f) => f !== enabledField && !/color|style|delay|offset|repeat|showonce/i.test(f))
    .map((f) => settings[f])
    .filter((value) => typeof value === "string" && value.trim() && value !== "true" && value !== "false")
    .sort((x: string, y: string) => y.length - x.length);
  const list = fields.map((f) => settings[f]).find((value) => Array.isArray(value) && value.length);
  const first = Array.isArray(list) ? list.find((entry: Row) => typeof entry?.message === "string" && entry.message.trim()) : null;
  if (first) parts.push(describeValue(first.message));
  else if (texts.length) parts.push(describeValue(texts[0]));
  else if (list) parts.push(describeValue(list));
  return parts.join(" · ") || describeValue(settings[fields[0]]);
}

function leadSections(raw: unknown): DetailSection[] {
  const fields = Array.isArray((raw as Row)?.fields) ? ((raw as Row).fields as Row[]) : [];
  if (fields.length === 0) return [];
  const timing = (field: Row) => {
    if (field.captureStrategy === "custom" || field.captureStrategy === "smart") return `asked after reply ${field.customAskAfter ?? 2}`;
    if (field.captureStrategy === "start") return "asked at the start";
    return `asked: ${humanizeField(String(field.captureStrategy ?? "custom")).toLowerCase()}`;
  };
  const sorted = [...fields].sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0));
  return [{
    title: "What gets copied",
    rows: sorted.map((field) => ({
      label: humanizeField(String(field.id)),
      value: field.enabled
        ? [field.required ? "Mandatory" : "Optional", timing(field), field.phoneValidation ? `digit check: ${field.phoneValidation}` : ""].filter(Boolean).join(", ")
        : "Not asked",
    })),
  }];
}

function instructionSections(raw: unknown): DetailSection[] {
  const list = parseInstructionList(typeof raw === "string" ? raw : null);
  if (list.length === 0) return [];
  return [{
    rows: list.map((item, index) => {
      const keywords = Array.isArray(item.keywords) && item.keywords.length ? `, when: ${item.keywords.join(", ")}` : "";
      return { label: `${index + 1}. ${humanizeField(String(item.type ?? "always"))}${keywords}`, value: String(item.text ?? "") };
    }),
  }];
}

function journeySections(journeys: JourneyBundle[]): DetailSection[] {
  return journeys.map(({ journey, steps }) => {
    const keywords = (() => {
      try { return (JSON.parse(journey.triggerKeywords || "[]") as string[]).join(", "); } catch { return ""; }
    })();
    const rows: DetailRow[] = [
      { label: "Status", value: journey.status === "active" ? "On" : "Off" },
      { label: "Type", value: journey.journeyType === "form" ? "Form, one question at a time" : "Guided conversation" },
    ];
    if (journey.startFromScratch === "true") rows.push({ label: "Starts", value: "Every chat" });
    if (keywords) rows.push({ label: "Starts on these words", value: keywords });
    if (journey.description) rows.push({ label: "Description", value: journey.description });
    if (journey.conversationalGuidelines) rows.push({ label: "AI guidelines", value: journey.conversationalGuidelines });
    steps.forEach((step, index) => {
      let options = "";
      try {
        const parsed = step.multipleChoiceOptions ? JSON.parse(step.multipleChoiceOptions) : null;
        if (Array.isArray(parsed) && parsed.length) options = `\nOptions: ${parsed.join(", ")}`;
      } catch { /* no options */ }
      rows.push({ label: `Question ${index + 1}${step.isRequired === "true" ? " (required)" : ""}`, value: `${step.questionText}${options}` });
    });
    return { title: journey.name, rows };
  });
}

function menuSections(menu: MenuBundle, journeys: JourneyBundle[]): DetailSection[] {
  const sections: DetailSection[] = [];
  if (menu.config) {
    const rows: DetailRow[] = [
      { label: "Menu start screen", value: menu.config.enabled === "true" ? "On" : "Off" },
      { label: "Welcome message", value: menu.config.welcomeMessage || "(empty)" },
    ];
    if (Array.isArray(menu.config.quickChips) && menu.config.quickChips.length) rows.push({ label: "Quick chips", value: menu.config.quickChips.map((chip: unknown) => (typeof chip === "string" ? chip : (chip as Row)?.label)).join(", ") });
    if (menu.config.persistentCtaEnabled === "true") rows.push({ label: "Main button", value: [menu.config.persistentCtaLabel, menu.config.persistentCtaValue].filter(Boolean).join(": ") });
    if (menu.config.footerText) rows.push({ label: "Footer", value: [menu.config.footerText, menu.config.footerLinkText, menu.config.footerLinkUrl].filter(Boolean).join(" · ") });
    sections.push({ title: "Start screen", rows });
  }
  if (menu.items.length) {
    const byId = new Map(menu.items.map((item) => [item.id, item]));
    const pathOf = (item: Row): string => (item.parentId && byId.has(item.parentId) ? `${pathOf(byId.get(item.parentId)!)} › ${item.title}` : String(item.title));
    const opens = (item: Row): string => {
      if (item.itemType === "form") return `Opens the form "${journeys.find((b) => b.journey.id === item.actionValue)?.journey.name ?? "not found"}"`;
      if (item.itemType === "navigate") return "Opens a submenu";
      if (item.itemType === "chat") return "Opens the chat";
      if (item.itemType === "detail") return "Opens a details page";
      if (item.itemType === "url") return `Opens the link ${item.actionValue ?? ""}`.trim();
      if (item.itemType === "phone") return `Calls ${item.actionValue ?? ""}`.trim();
      return [humanizeField(String(item.itemType)), item.actionValue].filter(Boolean).join(": ");
    };
    sections.push({
      title: "Buttons",
      rows: menu.items
        .map((item) => ({ label: pathOf(item), value: [opens(item), item.subtitle, item.isActive === "false" ? "Hidden" : ""].filter(Boolean).join("\n") }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    });
  }
  return sections;
}

/** What the source account has for each item, for the "what to copy" list and its details panel. */
export async function describeSource(sourceAccountId: string) {
  const settings: Row = (await storage.getWidgetSettings(sourceAccountId)) ?? {};
  const journeys = await loadJourneys(sourceAccountId);
  const menu = await loadMenu(sourceAccountId);
  const items = COPY_ITEMS.map((item) => {
    let summary = "";
    let empty = false;
    let sections: DetailSection[] = [];
    if (item.kind === "fields" || item.kind === "avatar") {
      sections = [{ rows: (item.fields ?? []).flatMap((field) => fieldDetailRows(field, settings[field])) }];
    } else if (item.kind === "lead") {
      sections = leadSections(settings.leadTrainingConfig);
    } else if (item.kind === "instructions") {
      sections = instructionSections(settings.customInstructions);
    } else if (item.kind === "journeys") {
      sections = journeySections(journeys);
    } else if (item.kind === "menu") {
      sections = menuSections(menu, journeys);
    }
    if (item.kind === "fields") {
      summary = fieldsSummary(item, settings);
    } else if (item.kind === "avatar") {
      empty = !settings.avatarUrl && (!settings.avatarType || settings.avatarType === "none");
      summary = empty ? "No picture" : "Picture set";
    } else if (item.kind === "lead") {
      empty = !Array.isArray(settings.leadTrainingConfig?.fields) || settings.leadTrainingConfig.fields.length === 0;
      summary = empty ? "Not set up" : leadSummary(settings.leadTrainingConfig);
    } else if (item.kind === "instructions") {
      const count = instructionsCount(settings.customInstructions);
      empty = count === 0;
      summary = empty ? "None written" : `${count} instruction${count === 1 ? "" : "s"}`;
    } else if (item.kind === "journeys") {
      empty = journeys.length === 0;
      summary = empty ? "None" : `${journeys.length} journey${journeys.length === 1 ? "" : "s"}`;
    } else if (item.kind === "menu") {
      empty = !menu.config && menu.items.length === 0;
      summary = empty ? "No menu" : `${menu.config?.enabled === "true" ? "On" : "Off"} · ${menu.items.length} button${menu.items.length === 1 ? "" : "s"}`;
    }
    return { key: item.key, group: item.group, label: item.label, description: item.description, summary, empty, sections };
  });
  return {
    items,
    journeys: journeys.map(({ journey, steps }) => ({
      id: journey.id,
      name: journey.name,
      status: journey.status,
      journeyType: journey.journeyType,
      startFromScratch: journey.startFromScratch === "true",
      steps: steps.length,
    })),
  };
}

interface Source {
  name: string;
  names: (string | null)[];
  settings: Row;
  journeys: JourneyBundle[];
  allJourneys: JourneyBundle[];
  menu: MenuBundle;
}

async function loadSource(request: CopyRequest): Promise<Source> {
  const account = await storage.getBusinessAccount(request.sourceAccountId);
  if (!account) throw new Error("The account to copy from was not found");
  const settings = await storage.getWidgetSettings(request.sourceAccountId);
  if (!settings) throw new Error("The account to copy from has no settings yet");
  const allJourneys = request.items.includes("journeys") || request.items.includes("menu") ? await loadJourneys(request.sourceAccountId) : [];
  const header = settings.widgetHeaderText && settings.widgetHeaderText !== "Hi Chroney" ? settings.widgetHeaderText : null;
  return {
    name: account.name,
    names: [account.name, header, websiteHost(account.website)],
    settings,
    allJourneys,
    journeys: request.items.includes("journeys") ? allJourneys.filter(({ journey }) => request.journeyIds.includes(journey.id)) : [],
    menu: request.items.includes("menu") ? await loadMenu(request.sourceAccountId) : { config: null, items: [], details: [] },
  };
}

/** The target's journey a source journey lands on: the same group journey, else the same name. */
function matchJourney(source: Row, existing: JourneyBundle[]): JourneyBundle | undefined {
  return (source.groupJourneyId && existing.find(({ journey }) => journey.groupJourneyId === source.groupJourneyId))
    || existing.find(({ journey }) => nameKey(journey.name) === nameKey(source.name));
}

/** Pairs each source step with a target step: the same group step, else the next unused by position. */
function matchSteps(sourceSteps: Row[], targetSteps: Row[]): { pairs: { source: Row; target: Row | null }[]; removed: Row[] } {
  const used = new Set<string>();
  const firstPass = sourceSteps.map((source) => {
    const target = source.groupStepId ? targetSteps.find((t) => t.groupStepId === source.groupStepId) : undefined;
    if (target) used.add(target.id);
    return { source, target: target ?? null };
  });
  const pairs = firstPass.map((pair) => {
    if (pair.target) return pair;
    const next = targetSteps.find((t) => !used.has(t.id)) ?? null;
    if (next) used.add(next.id);
    return { source: pair.source, target: next };
  });
  return { pairs, removed: targetSteps.filter((t) => !used.has(t.id)) };
}

function translateBranching(raw: string | null, idMap: Record<string, string>): string | null {
  if (!raw) return raw;
  try {
    const parsed = JSON.parse(raw);
    const swap = (id: unknown) => (typeof id === "string" && idMap[id]) || id;
    if (Array.isArray(parsed?.routes)) parsed.routes = parsed.routes.map((route: Row) => ({ ...route, targetStepId: swap(route.targetStepId) }));
    if (parsed && "defaultNextStepId" in parsed) parsed.defaultNextStepId = swap(parsed.defaultNextStepId);
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

function journeyIsSame(source: JourneyBundle, target: JourneyBundle): boolean {
  // A copy keeps its own link to a group journey unless the source has one.
  const shape = (journey: Row) => withoutKeys(journey, [...JOURNEY_OWN_KEYS, "groupJourneyId"]);
  if (stableStringify(shape(source.journey)) !== stableStringify(shape(target.journey))) return false;
  if (source.steps.length !== target.steps.length) return false;
  const { pairs } = matchSteps(source.steps, target.steps);
  const idMap: Record<string, string> = {};
  for (const pair of pairs) if (pair.target) idMap[pair.source.id] = pair.target.id;
  const stepShape = (step: Row) => withoutKeys(step, [...STEP_OWN_KEYS, "groupStepId", "branchingCondition"]);
  return pairs.every(({ source: s, target: t }) =>
    t && stableStringify(stepShape(s)) === stableStringify(stepShape(t)) && sameValue(translateBranching(s.branchingCondition, idMap), t.branchingCondition));
}

const journeyText = ({ journey, steps }: JourneyBundle) => [
  journey.name, journey.description, journey.conversationalGuidelines,
  ...steps.flatMap((s) => [s.questionText, s.multipleChoiceOptions, s.exitMessage, s.helpText, s.placeholderText, s.completionButtonText]),
].filter(Boolean).join("\n");

/** Menu items with journeys named rather than numbered, and parents named by their path, for comparing. */
function menuShape(menu: MenuBundle, journeys: JourneyBundle[]) {
  const byId = new Map(menu.items.map((item) => [item.id, item]));
  const pathOf = (item: Row): string => (item.parentId && byId.has(item.parentId) ? `${pathOf(byId.get(item.parentId)!)}/${item.title}` : String(item.title));
  const journeyName = (id: unknown) => journeys.find(({ journey }) => journey.id === id)?.journey.name ?? id;
  const items = menu.items.map((item) => {
    const detail = menu.details.find((d) => d.menuItemId === item.id);
    return {
      ...withoutKeys(item, [...MENU_OWN_KEYS, "parentId", "actionValue"]),
      path: pathOf(item),
      action: item.itemType === "form" ? nameKey(journeyName(item.actionValue))
        : item.itemType === "navigate" && byId.has(item.actionValue) ? pathOf(byId.get(item.actionValue)!)
        : item.actionValue,
      detail: detail ? withoutKeys(detail, DETAIL_OWN_KEYS) : null,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { config: menu.config ? withoutKeys(menu.config, MENU_OWN_KEYS) : null, items };
}

const menuText = (menu: MenuBundle) => [
  menu.config?.welcomeMessage, menu.config?.footerText, menu.config?.footerLinkUrl, menu.config?.persistentCtaLabel, menu.config?.persistentCtaValue,
  stableStringify(menu.config?.quickChips ?? null),
  ...menu.items.flatMap((item) => [item.title, item.subtitle, item.itemType === "form" ? null : item.actionValue]),
  ...menu.details.map((detail) => stableStringify([detail.tabs, detail.tags, detail.headerLinks, detail.actionButtons])),
].filter(Boolean).join("\n");

interface TargetPlan {
  businessAccountId: string;
  name: string;
  changes: CopyChange[];
  warnings: CopyWarning[];
  widgetUpdate: Row;
  widgetBefore: Row;
  journeys: { source: JourneyBundle; target: JourneyBundle | null }[];
  clearStartup: Row[];
  menuChanged: boolean;
}

const INTRO_FIELDS = ["welcomeMessageType", "welcomeMessage", "personality", "responseLength", "customInstructions"];

async function planTarget(source: Source, request: CopyRequest, target: { businessAccountId: string; name: string }): Promise<TargetPlan> {
  // An account that has never been set up gets its defaults first, as the widget would create them,
  // so "before" always holds real values and undo can put them back.
  const settings: Row = (await storage.getWidgetSettings(target.businessAccountId)) ?? (await storage.upsertWidgetSettings(target.businessAccountId, {}));
  const plan: TargetPlan = {
    ...target, changes: [], warnings: [], widgetUpdate: {}, widgetBefore: {}, journeys: [], clearStartup: [], menuChanged: false,
  };
  const warnIfNamed = (item: CopyItem, text: string) => {
    const names = mentionedNames(text, source.names, target.name);
    if (names.length) {
      plan.warnings.push({ key: item.key, label: item.label, message: `Mentions ${names.map((n) => `"${n}"`).join(", ")}, which is from ${source.name}` });
    }
  };
  const setField = (field: string, value: unknown) => {
    plan.widgetUpdate[field] = value ?? null;
    plan.widgetBefore[field] = settings[field] ?? null;
  };
  const journeysNeeded = request.items.includes("journeys") || request.items.includes("menu");
  const existingJourneys = journeysNeeded ? await loadJourneys(target.businessAccountId) : [];

  for (const key of request.items) {
    const item = copyItem(key);
    if (!item) continue;

    if (item.kind === "fields") {
      const changed = (item.fields ?? []).filter((field) => !sameValue(source.settings[field], settings[field]));
      if (changed.length === 0) continue;
      for (const field of changed) setField(field, source.settings[field]);
      plan.changes.push({
        key, label: item.label,
        details: changed.map((field) => ({ field: fieldLabel(field), from: describeValue(settings[field]), to: describeValue(source.settings[field]) })),
      });
      warnIfNamed(item, (item.fields ?? []).map((field) => {
        const value = source.settings[field];
        return typeof value === "string" ? value : value ? stableStringify(value) : "";
      }).join("\n"));
    } else if (item.kind === "avatar") {
      const changed = (item.fields ?? []).filter((field) => !sameValue(source.settings[field], settings[field]));
      if (changed.length === 0) continue;
      for (const field of changed) setField(field, source.settings[field]);
      const own = Array.isArray(settings.customAvatars) ? settings.customAvatars as Row[] : [];
      if (source.settings.avatarUrl && source.settings.avatarType === "custom" && !own.some((a) => a.url === source.settings.avatarUrl)) {
        setField("customAvatars", [...own, { url: source.settings.avatarUrl, uploadedAt: new Date().toISOString() }]);
      }
      plan.changes.push({ key, label: item.label, details: [{ field: "Picture", from: settings.avatarUrl ? "Own picture" : "No picture", to: source.name }] });
    } else if (item.kind === "lead") {
      if (!Array.isArray(source.settings.leadTrainingConfig?.fields) || source.settings.leadTrainingConfig.fields.length === 0) continue;
      // Only the group-owned parts travel: verification, CAPTCHA and the conversion page stay.
      const merged = mergeGroupLeadConfigIntoAccount(settings.leadTrainingConfig, source.settings.leadTrainingConfig);
      const current = mergeGroupLeadConfigIntoAccount(settings.leadTrainingConfig, settings.leadTrainingConfig);
      if (stableStringify(merged) === stableStringify(current)) continue;
      setField("leadTrainingConfig", merged);
      plan.changes.push({ key, label: item.label, details: [{ field: "Details asked for", from: leadSummary(current), to: leadSummary(merged) }] });
    } else if (item.kind === "instructions") {
      const merged = mergeInstructions(settings.customInstructions, source.settings.customInstructions, request.instructionsMode, randomUUID);
      if (merged.added === 0 && merged.removed === 0) continue;
      setField("customInstructions", sanitizeCustomInstructionsChannels(merged.value));
      plan.changes.push({
        key, label: item.label,
        details: [{ field: request.instructionsMode === "replace" ? "Replaced" : "Added", from: `${instructionsCount(settings.customInstructions)} instructions`, to: `${instructionsCount(merged.value)} instructions` }],
      });
      if (merged.removed > 0) plan.warnings.push({ key, label: item.label, message: `Removes ${merged.removed} instruction${merged.removed === 1 ? "" : "s"} this account has of its own` });
      warnIfNamed(item, parseInstructionList(source.settings.customInstructions).map((i) => i.text).join("\n"));
    } else if (item.kind === "journeys") {
      const details: CopyChange["details"] = [];
      for (const bundle of source.journeys) {
        const match = matchJourney(bundle.journey, existingJourneys) ?? null;
        if (match && journeyIsSame(bundle, match)) continue;
        plan.journeys.push({ source: bundle, target: match });
        const removed = match ? matchSteps(bundle.steps, match.steps).removed.length : 0;
        details.push({ field: bundle.journey.name, from: match ? `${match.steps.length} questions` : "Not on this account", to: `${bundle.steps.length} questions` });
        if (removed > 0) {
          plan.warnings.push({ key, label: item.label, message: `"${bundle.journey.name}" loses ${removed} question${removed === 1 ? "" : "s"}, and past answers to ${removed === 1 ? "it" : "them"} go too. Undo can't bring those answers back` });
        }
        warnIfNamed(item, journeyText(bundle));
        if (bundle.journey.startFromScratch === "true" && bundle.journey.status === "active") {
          const others = existingJourneys.filter(({ journey }) => journey.id !== match?.journey.id && journey.status === "active" && (journey.startFromScratch === "true" || journey.isDefault === "true"));
          for (const { journey } of others) {
            plan.clearStartup.push({ id: journey.id, startFromScratch: journey.startFromScratch, isDefault: journey.isDefault });
            plan.warnings.push({ key, label: item.label, message: `"${bundle.journey.name}" takes over from "${journey.name}" as the journey that starts every chat` });
          }
        }
      }
      if (details.length) plan.changes.push({ key, label: item.label, details });
    } else if (item.kind === "menu") {
      if (!source.menu.config && source.menu.items.length === 0) continue;
      const targetMenu = await loadMenu(target.businessAccountId);
      if (stableStringify(menuShape(source.menu, source.allJourneys)) === stableStringify(menuShape(targetMenu, existingJourneys))) continue;
      plan.menuChanged = true;
      plan.changes.push({ key, label: item.label, details: [{ field: "Buttons", from: `${targetMenu.items.length} buttons`, to: `${source.menu.items.length} buttons` }] });
      warnIfNamed(item, menuText(source.menu));
      const copying = new Set(source.journeys.map(({ journey }) => nameKey(journey.name)));
      const here = new Set(existingJourneys.map(({ journey }) => nameKey(journey.name)));
      for (const button of source.menu.items.filter((i) => i.itemType === "form" && i.actionValue)) {
        const journey = source.allJourneys.find((b) => b.journey.id === button.actionValue)?.journey;
        const name = nameKey(journey?.name);
        if (!journey || (!copying.has(name) && !here.has(name))) {
          plan.warnings.push({ key, label: item.label, message: `Button "${button.title}" opens a form this account doesn't have${journey ? ` ("${journey.name}"). Tick it under Journeys too` : ""}` });
        }
      }
      if (source.menu.items.some((i) => i.itemType === "phone" || i.itemType === "url") || ["phone", "url"].includes(source.menu.config?.persistentCtaAction)) {
        plan.warnings.push({ key, label: item.label, message: "Has phone numbers or web links. Check they are right for this account" });
      }
    }
  }
  return plan;
}

const toTargets = async (groupId: string, ids: string[]) => {
  const members = await storage.getGroupMembers(groupId);
  return members
    .filter((m) => ids.includes(m.businessAccountId))
    .map((m) => ({ businessAccountId: m.businessAccountId, name: m.businessAccount?.name || m.businessAccountId }));
};

export async function previewCopy(groupId: string, request: CopyRequest): Promise<CopyPreviewTarget[]> {
  const source = await loadSource(request);
  const previews: CopyPreviewTarget[] = [];
  for (const target of await toTargets(groupId, request.targetIds)) {
    const plan = await planTarget(source, request, target);
    previews.push({ businessAccountId: plan.businessAccountId, name: plan.name, changes: plan.changes, warnings: plan.warnings });
  }
  return previews;
}

async function applyJourneys(businessAccountId: string, plan: TargetPlan, snapshot: CopySnapshot) {
  await db.transaction(async (tx) => {
    for (const { source, target } of plan.journeys) {
      const values = withoutKeys(source.journey, JOURNEY_OWN_KEYS);
      // A copy keeps its link to a group journey when the source has none.
      if (target && !values.groupJourneyId) values.groupJourneyId = target.journey.groupJourneyId;
      let journeyId: string;
      if (target) {
        journeyId = target.journey.id;
        snapshot.journeys.updated.push(target);
        await tx.update(conversationJourneys).set({ ...values, updatedAt: new Date() } as any).where(eq(conversationJourneys.id, journeyId));
      } else {
        const [created] = await tx.insert(conversationJourneys).values({ ...values, businessAccountId } as any).returning();
        journeyId = created.id;
        snapshot.journeys.created.push(journeyId);
      }
      const { pairs, removed } = matchSteps(source.steps, target?.steps ?? []);
      const idMap: Record<string, string> = {};
      const stepIds = new Map<string, string>();
      for (const pair of pairs) {
        let stepId = pair.target?.id;
        if (!stepId) {
          const [created] = await tx.insert(journeySteps).values({ journeyId, stepOrder: pair.source.stepOrder, questionText: pair.source.questionText } as any).returning();
          stepId = created.id;
        }
        idMap[pair.source.id] = stepId;
        stepIds.set(pair.source.id, stepId);
      }
      for (const pair of pairs) {
        const stepValues = withoutKeys(pair.source, STEP_OWN_KEYS);
        stepValues.branchingCondition = translateBranching(pair.source.branchingCondition, idMap);
        if (pair.target && !stepValues.groupStepId) stepValues.groupStepId = pair.target.groupStepId;
        await tx.update(journeySteps).set({ ...stepValues, updatedAt: new Date() } as any).where(eq(journeySteps.id, stepIds.get(pair.source.id)!));
      }
      if (removed.length) await tx.delete(journeySteps).where(inArray(journeySteps.id, removed.map((s) => s.id)));
    }
    for (const row of plan.clearStartup) {
      snapshot.journeys.cleared.push(row);
      await tx.update(conversationJourneys).set({ startFromScratch: "false", isDefault: "false", updatedAt: new Date() }).where(eq(conversationJourneys.id, row.id));
    }
  });
  await storage.relinkMenuJourneyButtons(businessAccountId);
  journeyService.invalidateJourneyCache(businessAccountId);
}

async function applyMenu(businessAccountId: string, source: Source, snapshot: CopySnapshot) {
  const before = await loadMenu(businessAccountId);
  snapshot.menu = before;
  // "Open a form" buttons point at this account's own journey.
  const journeyIds: Record<string, string> = {};
  for (const { journey } of source.allJourneys) {
    const resolved = await storage.resolveAccountJourneyId(businessAccountId, journey.id);
    if (resolved) journeyIds[journey.id] = resolved;
  }
  const newIds = new Map(source.menu.items.map((item) => [item.id, randomUUID()]));
  const inTarget = (value: string | null) => {
    if (!value) return value;
    let out = value;
    for (const [from, to] of Object.entries(journeyIds)) if (out.includes(from)) out = out.split(from).join(to);
    return out;
  };
  await db.transaction(async (tx) => {
    if (source.menu.config) {
      const values = withoutKeys(source.menu.config, MENU_OWN_KEYS);
      if (before.config) await tx.update(chatMenuConfigs).set({ ...values, updatedAt: new Date() } as any).where(eq(chatMenuConfigs.id, before.config.id));
      else await tx.insert(chatMenuConfigs).values({ ...values, businessAccountId } as any);
    }
    await tx.delete(chatMenuItems).where(eq(chatMenuItems.businessAccountId, businessAccountId));
    for (const item of source.menu.items) {
      await tx.insert(chatMenuItems).values({
        ...withoutKeys(item, MENU_OWN_KEYS),
        id: newIds.get(item.id),
        businessAccountId,
        parentId: item.parentId ? newIds.get(item.parentId) ?? null : null,
        actionValue: newIds.get(item.actionValue) ?? inTarget(item.actionValue),
      } as any);
    }
    for (const detail of source.menu.details) {
      const menuItemId = newIds.get(detail.menuItemId);
      if (menuItemId) await tx.insert(chatMenuItemDetails).values({ ...withoutKeys(detail, DETAIL_OWN_KEYS), menuItemId } as any);
    }
  });
}

/** Copies to each target on its own; one failing doesn't stop the rest. The log is kept up to date as it goes. */
export async function runCopy(groupId: string, request: CopyRequest, user: { id?: string; name?: string }) {
  const source = await loadSource(request);
  const targets = await toTargets(groupId, request.targetIds);
  const [log] = await db.insert(settingsCopyLog).values({
    groupId, sourceAccountId: request.sourceAccountId, sourceName: source.name, request, createdBy: user.id, createdByName: user.name, createdAt: new Date(),
  }).returning();
  const results: CopyResultTarget[] = [];
  const snapshots: Record<string, CopySnapshot> = {};

  for (const target of targets) {
    const snapshot: CopySnapshot = { widget: {}, journeys: { created: [], updated: [], cleared: [] }, menu: null };
    let warnings: CopyWarning[] = [];
    try {
      const plan = await planTarget(source, request, target);
      warnings = plan.warnings;
      if (plan.journeys.length) await applyJourneys(target.businessAccountId, plan, snapshot);
      if (Object.keys(plan.widgetUpdate).length) {
        snapshot.widget = plan.widgetBefore;
        const update: Row = { ...plan.widgetUpdate };
        if (INTRO_FIELDS.some((field) => field in update)) update.cachedIntro = null;
        await storage.upsertWidgetSettings(target.businessAccountId, update as any);
      }
      if (plan.menuChanged) await applyMenu(target.businessAccountId, source, snapshot);
      if (plan.changes.length) businessContextCache.invalidateBusinessCache(target.businessAccountId);
      results.push({ ...target, ok: true, changed: plan.changes.map((c) => c.label), warnings });
    } catch (error: any) {
      console.error(`[Copy Settings] Failed for account ${target.businessAccountId}:`, error);
      results.push({ ...target, ok: false, changed: [], warnings, error: String(error?.message || error || "Unknown error").slice(0, 300) });
    }
    snapshots[target.businessAccountId] = snapshot;
    await db.update(settingsCopyLog).set({ results, snapshots }).where(eq(settingsCopyLog.id, log.id));
  }
  return { copyId: log.id, results };
}

async function restoreJourneys(businessAccountId: string, snapshot: CopySnapshot) {
  const { created, updated, cleared } = snapshot.journeys;
  if (created.length || updated.length || cleared.length) {
    await db.transaction(async (tx) => {
      for (const journeyId of created) {
        // A journey people have already used stays, switched off, so their answers are kept.
        const [used] = await tx.select({ id: journeySessions.id }).from(journeySessions).where(eq(journeySessions.journeyId, journeyId)).limit(1);
        if (used) await tx.update(conversationJourneys).set({ status: "inactive", isDefault: "false", startFromScratch: "false", updatedAt: new Date() }).where(eq(conversationJourneys.id, journeyId));
        else await tx.delete(conversationJourneys).where(eq(conversationJourneys.id, journeyId));
      }
      for (const { journey, steps } of updated) {
        await tx.update(conversationJourneys).set({ ...withoutKeys(journey, JOURNEY_OWN_KEYS), updatedAt: new Date() } as any).where(eq(conversationJourneys.id, journey.id));
        const keep = new Set(steps.map((s) => s.id));
        const current = await tx.select({ id: journeySteps.id }).from(journeySteps).where(eq(journeySteps.journeyId, journey.id));
        const extra = current.filter((s) => !keep.has(s.id)).map((s) => s.id);
        if (extra.length) await tx.delete(journeySteps).where(inArray(journeySteps.id, extra));
        const present = new Set(current.map((s) => s.id));
        for (const step of steps) {
          const values = withoutKeys(step, STEP_OWN_KEYS);
          if (present.has(step.id)) await tx.update(journeySteps).set({ ...values, updatedAt: new Date() } as any).where(eq(journeySteps.id, step.id));
          else await tx.insert(journeySteps).values({ ...values, id: step.id, journeyId: journey.id } as any);
        }
      }
      for (const row of cleared) {
        await tx.update(conversationJourneys).set({ startFromScratch: row.startFromScratch, isDefault: row.isDefault, updatedAt: new Date() }).where(eq(conversationJourneys.id, row.id));
      }
    });
    journeyService.invalidateJourneyCache(businessAccountId);
  }
}

async function restoreWidget(businessAccountId: string, snapshot: CopySnapshot) {
  if (Object.keys(snapshot.widget).length) {
    const update: Row = { ...snapshot.widget };
    if (INTRO_FIELDS.some((field) => field in update)) update.cachedIntro = null;
    await storage.upsertWidgetSettings(businessAccountId, update as any);
  }
}

async function restoreMenu(businessAccountId: string, snapshot: CopySnapshot) {
  if (snapshot.menu) {
    const { config, items, details } = snapshot.menu;
    await db.transaction(async (tx) => {
      await tx.delete(chatMenuItems).where(eq(chatMenuItems.businessAccountId, businessAccountId));
      if (config) {
        await tx.update(chatMenuConfigs).set({ ...withoutKeys(config, MENU_OWN_KEYS), updatedAt: new Date() } as any).where(eq(chatMenuConfigs.businessAccountId, businessAccountId));
      } else {
        await tx.delete(chatMenuConfigs).where(eq(chatMenuConfigs.businessAccountId, businessAccountId));
      }
      for (const item of items) {
        await tx.insert(chatMenuItems).values({ ...withoutKeys(item, ["createdAt", "updatedAt"]) } as any);
      }
      for (const detail of details) {
        await tx.insert(chatMenuItemDetails).values({ ...withoutKeys(detail, ["createdAt", "updatedAt"]) } as any);
      }
    });
  }
}

/** Every part gets its chance, so one failing doesn't leave the others uncopied back. */
async function restoreTarget(businessAccountId: string, snapshot: CopySnapshot) {
  const problems: string[] = [];
  for (const restore of [restoreJourneys, restoreWidget, restoreMenu]) {
    try {
      await restore(businessAccountId, snapshot);
    } catch (error: any) {
      problems.push(String(error?.message || error));
    }
  }
  businessContextCache.invalidateBusinessCache(businessAccountId);
  if (problems.length) throw new Error(problems.join("; "));
}

/** Only the group's newest copy that hasn't been undone can be undone, so old values never overwrite a later copy. */
export async function undoCopy(groupId: string, copyId: string, userName: string | undefined) {
  const logs = await db.select().from(settingsCopyLog).where(eq(settingsCopyLog.groupId, groupId)).orderBy(desc(settingsCopyLog.createdAt));
  const newest = logs.find((log) => !log.undoneAt);
  if (!newest || newest.id !== copyId) {
    throw Object.assign(new Error("Only the newest copy can be undone. Undo the newer ones first."), { status: 409 });
  }
  const snapshots = newest.snapshots as Record<string, CopySnapshot>;
  const results = (newest.results as CopyResultTarget[]) ?? [];
  const outcome: { businessAccountId: string; name: string; ok: boolean; error?: string }[] = [];
  for (const [businessAccountId, snapshot] of Object.entries(snapshots)) {
    const name = results.find((r) => r.businessAccountId === businessAccountId)?.name ?? businessAccountId;
    try {
      await restoreTarget(businessAccountId, snapshot);
      outcome.push({ businessAccountId, name, ok: true });
    } catch (error: any) {
      console.error(`[Copy Settings] Undo failed for account ${businessAccountId}:`, error);
      outcome.push({ businessAccountId, name, ok: false, error: String(error?.message || error).slice(0, 300) });
    }
  }
  // Not marked undone if an account failed, so undo can be run again (it is safe to repeat).
  if (outcome.every((r) => r.ok)) {
    await db.update(settingsCopyLog).set({ undoneAt: new Date(), undoneByName: userName }).where(eq(settingsCopyLog.id, copyId));
  }
  return { results: outcome };
}

/** The group's copies, newest first (without the saved old values). */
export async function copyHistory(groupId: string) {
  const logs = await db.select({
    id: settingsCopyLog.id,
    sourceName: settingsCopyLog.sourceName,
    request: settingsCopyLog.request,
    results: settingsCopyLog.results,
    createdByName: settingsCopyLog.createdByName,
    createdAt: settingsCopyLog.createdAt,
    undoneAt: settingsCopyLog.undoneAt,
    undoneByName: settingsCopyLog.undoneByName,
  }).from(settingsCopyLog).where(eq(settingsCopyLog.groupId, groupId)).orderBy(desc(settingsCopyLog.createdAt)).limit(25);
  const newestId = logs.find((log) => !log.undoneAt)?.id;
  return logs.map((log) => ({ ...log, canUndo: log.id === newestId }));
}

/** Whether another account still uses this picture (copied pictures share one file). */
export async function imageUsedByOtherAccount(businessAccountId: string, url: string): Promise<boolean> {
  const others = await db.select({ businessAccountId: widgetSettings.businessAccountId, avatarUrl: widgetSettings.avatarUrl, customAvatars: widgetSettings.customAvatars })
    .from(widgetSettings);
  return others.some((row) => row.businessAccountId !== businessAccountId
    && (row.avatarUrl === url || (Array.isArray(row.customAvatars) && (row.customAvatars as Row[]).some((a) => a?.url === url))));
}
