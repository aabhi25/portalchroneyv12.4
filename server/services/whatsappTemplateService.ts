import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { createOpenAI } from "../lib/openaiClient";
import { db } from "../db";
import { whatsappTemplates, type WhatsappTemplate, type InsertWhatsappTemplate } from "@shared/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { safeDecrypt } from "./encryptionService";

function countParams(body: string): number {
  const matches = body.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  const indices = new Set(
    matches.map(m => parseInt(m.replace(/\D/g, ""), 10)).filter(n => Number.isFinite(n))
  );
  return indices.size;
}

export function normalizeWhatsappNumber(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function remoteWhatsappNumbers(remote: any, variant: any): string[] {
  const values = [
    remote?.integrated_number,
    remote?.integratedNumber,
    remote?.whatsapp_number,
    remote?.whatsappNumber,
    variant?.integrated_number,
    variant?.integratedNumber,
    variant?.whatsapp_number,
    variant?.whatsappNumber,
  ];
  return Array.from(new Set(values.map(normalizeWhatsappNumber).filter(Boolean)));
}

function templateIdentity(name: string, language: string): string {
  return `${name.trim().toLowerCase()}\u0000${language.trim().toLowerCase()}`;
}

/**
 * Fetch the provider's template list for one WhatsApp number.
 *
 * MSG91 requires pagination=true together with page_num for the endpoint to
 * advance pages; without it the endpoint returns the same result on every
 * call, creating an infinite loop. MAX_PAGES is a hard defensive ceiling
 * (25 × 200 = 5,000 templates). `statusFilter` = "approved" for the import
 * sync, null to read every status (used by the status check).
 */
async function fetchMsg91Templates(num: string, authKey: string, statusFilter: string | null): Promise<any[]> {
  const PAGE_SIZE = 200;
  const MAX_PAGES = 25;
  const allRemote: any[] = [];
  let snapshotComplete = false;

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const url =
      `https://control.msg91.com/api/v5/whatsapp/get-template-client/${encodeURIComponent(num)}` +
      `?page_size=${PAGE_SIZE}&page_num=${pageNum}&pagination=true` +
      (statusFilter ? `&template_status=${encodeURIComponent(statusFilter)}` : "");
    console.log(`[WhatsappTemplateService] Fetching page ${pageNum}: ${url}`);

    const resp = await fetchWithTimeout(url, {
      method: "GET",
      headers: { authkey: authKey, accept: "application/json", "content-type": "text/plain" },
    });

    const json: any = await resp.json().catch(() => ({}));
    console.log(`[WhatsappTemplateService] Page ${pageNum}: status=${resp.status}, keys=${JSON.stringify(Object.keys(json || {}))}`);

    if (!resp.ok) {
      const msg = json?.message || json?.error || `HTTP ${resp.status}`;
      throw new Error(`MSG91 API error: ${msg}`);
    }

    // Normalise the response envelope — MSG91 returns arrays under various keys
    const page =
      [json?.data, json?.templates, json?.data?.templates, json?.result, json]
        .find(Array.isArray) as any[] | undefined;
    if (!page) {
      throw new Error("MSG91 returned an unsupported template response. No local templates were changed.");
    }

    allRemote.push(...page);

    // A page shorter than PAGE_SIZE means we have reached the last page.
    if (page.length < PAGE_SIZE) {
      snapshotComplete = true;
      break;
    }
    if (pageNum === MAX_PAGES) {
      throw new Error(
        `MSG91 returned at least ${PAGE_SIZE * MAX_PAGES} templates without a final page. No local templates were changed.`,
      );
    }
  }
  if (!snapshotComplete) throw new Error("MSG91 template snapshot was incomplete. No local templates were changed.");
  return allRemote;
}

/** Map a provider status string onto the statuses this app understands. */
export function normalizeProviderTemplateStatus(raw: unknown): "approved" | "pending" | "rejected" {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "approved" || value === "active" || value === "enabled") return "approved";
  if (["rejected", "disabled", "paused", "deleted", "flagged", "failed"].includes(value)) return "rejected";
  return "pending"; // pending, in_review, submitted, in_appeal, unknown…
}

export interface TemplateStatusCheck {
  id: string;
  name: string;
  language: string;
  found: boolean;
  previousStatus: string;
  status: string;
}

// ── AI template drafting ─────────────────────────────────────────────────────

/** WhatsApp limits for a template body/footer/name. */
export const TEMPLATE_LIMITS = { body: 1024, footer: 60, header: 60, name: 512 } as const;

export interface TemplateDraftInput {
  goal: string;
  category?: string;
  language?: string;
  tone?: string;
}

export interface TemplateDraft {
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  bodyText: string;
  footerText: string;
  variables: { index: number; meaning: string; example: string }[];
  categoryHint: string;
  warnings: string[];
}

type DraftChatClient = {
  chat: { completions: { create: (args: any) => Promise<{ choices: Array<{ message?: { content?: string | null } }> }> } };
};

/** Overridable in tests so no real model is called. */
export const templateDraftDeps: {
  createClient: (businessAccountId: string, apiKey: string) => DraftChatClient;
  getApiKey: (businessAccountId: string) => Promise<string | null>;
} = {
  createClient: (businessAccountId, apiKey) =>
    createOpenAI({ businessAccountId, apiKey, timeout: 20_000, feature: "whatsapp_template_draft" }) as unknown as DraftChatClient,
  getApiKey: async (businessAccountId) => {
    const { storage } = await import("../storage");
    const raw = await storage.getBusinessAccountOpenAIKey(businessAccountId);
    return raw ? safeDecrypt(raw) : null;
  },
};

/**
 * Make a model's draft safe to save as a WhatsApp template: renumber
 * variables to {{1}}..{{n}} in order of appearance, keep the body from
 * starting or ending with a variable, enforce length limits, snake_case name.
 */
export function sanitizeTemplateDraft(raw: any, input: TemplateDraftInput): TemplateDraft {
  const warnings: string[] = [];
  let body = String(raw?.bodyText ?? raw?.body ?? "").replace(/\r\n/g, "\n").trim();
  // Renumber {{x}} placeholders (numbers or words) sequentially.
  const order: string[] = [];
  body = body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, token: string) => {
    const key = token.trim().toLowerCase();
    let idx = order.indexOf(key);
    if (idx === -1) { order.push(key); idx = order.length - 1; }
    return `{{${idx + 1}}}`;
  });
  if (/^\{\{\d+\}\}/.test(body)) body = `Hi ${body}`;
  if (/\{\{\d+\}\}[.!?\s]*$/.test(body)) body = `${body.replace(/\s+$/, "")} Thank you.`;
  body = body.replace(/\n{3,}/g, "\n\n");
  if (body.length > TEMPLATE_LIMITS.body) {
    body = body.slice(0, TEMPLATE_LIMITS.body - 1).replace(/\s+\S*$/, "") + "…";
    warnings.push(`The message was shortened to WhatsApp's ${TEMPLATE_LIMITS.body}-character limit.`);
  }
  let footer = String(raw?.footerText ?? raw?.footer ?? "").replace(/\{\{[^}]*\}\}/g, "").trim();
  if (footer.length > TEMPLATE_LIMITS.footer) footer = footer.slice(0, TEMPLATE_LIMITS.footer).trim();
  const rawCategory = String(raw?.category || input.category || "MARKETING").toUpperCase();
  const category = (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(rawCategory) ? rawCategory : "MARKETING") as TemplateDraft["category"];
  if (category === "MARKETING" && !/stop/i.test(`${body} ${footer}`)) {
    footer = footer || "Reply STOP to opt out";
  }
  const name = String(raw?.name || input.goal || "message")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "message";
  const rawVars: any[] = Array.isArray(raw?.variables) ? raw.variables : [];
  const variableCount = new Set(body.match(/\{\{\d+\}\}/g) || []).size;
  const variables = Array.from({ length: variableCount }, (_v, i) => {
    const source = rawVars[i] || {};
    return {
      index: i + 1,
      meaning: String(source.meaning || source.name || order[i] || `Value ${i + 1}`).slice(0, 80),
      example: String(source.example || "").slice(0, 80),
    };
  });
  if (variables.length > 10) warnings.push("That is a lot of fill-in values — WhatsApp reviewers prefer short templates.");
  const categoryHint = category === "MARKETING"
    ? "Marketing: offers, announcements and reminders that promote something."
    : category === "UTILITY"
      ? "Utility: updates about something the customer already asked for (orders, bookings, payments)."
      : "Authentication: one-time passwords only.";
  return {
    name,
    category,
    language: String(raw?.language || input.language || "en").slice(0, 10),
    bodyText: body,
    footerText: footer,
    variables,
    categoryHint,
    warnings,
  };
}

export interface WhatsappTemplateSyncResult {
  synced: number;
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  templates: WhatsappTemplate[];
}

export const whatsappTemplateService = {
  async list(businessAccountId: string): Promise<WhatsappTemplate[]> {
    return db
      .select()
      .from(whatsappTemplates)
      .where(and(
        eq(whatsappTemplates.businessAccountId, businessAccountId),
        isNull(whatsappTemplates.deletedAt),
      ))
      .orderBy(desc(whatsappTemplates.updatedAt));
  },

  async get(businessAccountId: string, id: string): Promise<WhatsappTemplate | undefined> {
    const [row] = await db
      .select()
      .from(whatsappTemplates)
      .where(and(
        eq(whatsappTemplates.id, id),
        eq(whatsappTemplates.businessAccountId, businessAccountId),
        isNull(whatsappTemplates.deletedAt),
      ))
      .limit(1);
    return row;
  },

  async create(businessAccountId: string, payload: Partial<InsertWhatsappTemplate>): Promise<WhatsappTemplate> {
    const bodyText = payload.bodyText || "";
    const msg91TemplateId = payload.msg91TemplateId || null;
    const [row] = await db
      .insert(whatsappTemplates)
      .values({
        businessAccountId,
        name: (payload.name || "untitled").trim(),
        language: payload.language || "en",
        category: payload.category || "MARKETING",
        bodyText,
        headerType: payload.headerType || "none",
        headerText: payload.headerText || "",
        headerMediaUrl: payload.headerMediaUrl || "",
        footerText: payload.footerText || "",
        buttons: payload.buttons || [],
        paramCount: countParams(bodyText),
        // A template typed in by hand is NOT assumed to be approved: a typo in
        // its name would make every campaign send fail. It starts as
        // "not_verified" until the provider confirms it (refreshStatus) or the
        // business explicitly confirms it is approved (confirmApproved).
        // Templates created before this change keep whatever status they had.
        status: "not_verified",
        statusSource: null,
        statusCheckedAt: null,
        msg91TemplateId,
        namespace: payload.namespace || null,
        sourceType: "manual",
        sourceWhatsappNumber: null,
        deletedAt: null,
      })
      .returning();
    return row;
  },

  async update(businessAccountId: string, id: string, payload: Partial<InsertWhatsappTemplate>): Promise<WhatsappTemplate | undefined> {
    const updates: any = { updatedAt: new Date() };
    // Tenant-editable fields only. Approval state (`status`,
    // `rejectionReason`) and ownership/source fields (`businessAccountId`,
    // `sourceType`, `sourceWhatsappNumber`, `deletedAt`) are server-controlled:
    // they are set by create() and the MSG91 sync, never by a PATCH body.
    // An unapproved template must not be made campaign-ready by the tenant.
    const fields: (keyof InsertWhatsappTemplate)[] = [
      "name", "language", "category", "bodyText", "headerType", "headerText",
      "headerMediaUrl", "footerText", "buttons", "msg91TemplateId", "namespace",
    ];
    for (const field of fields) {
      if (payload[field] !== undefined) updates[field] = payload[field];
    }
    if (payload.bodyText !== undefined) {
      updates.paramCount = countParams(payload.bodyText || "");
    }
    // Renaming a hand-added template (or changing its language) points it at a
    // different provider template, so its approval has to be checked again.
    // Body/footer edits are local preview text and keep the current status.
    const before = await this.get(businessAccountId, id);
    if (!before) return undefined;
    const nameChanged = updates.name !== undefined && String(updates.name).trim() !== before.name;
    const languageChanged = updates.language !== undefined && String(updates.language).trim() !== before.language;
    if (updates.name !== undefined) updates.name = String(updates.name).trim() || before.name;
    if (before.sourceType === "manual" && (nameChanged || languageChanged)) {
      updates.status = "not_verified";
      updates.statusSource = null;
      updates.statusCheckedAt = null;
      updates.rejectionReason = null;
    }
    const [row] = await db
      .update(whatsappTemplates)
      .set(updates)
      .where(and(
        eq(whatsappTemplates.id, id),
        eq(whatsappTemplates.businessAccountId, businessAccountId),
        isNull(whatsappTemplates.deletedAt),
      ))
      .returning();
    return row;
  },

  async remove(businessAccountId: string, id: string): Promise<boolean> {
    const result = await db
      .update(whatsappTemplates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(whatsappTemplates.id, id),
        eq(whatsappTemplates.businessAccountId, businessAccountId),
        isNull(whatsappTemplates.deletedAt),
      ))
      .returning({ id: whatsappTemplates.id });
    return result.length > 0;
  },

  /**
   * Ask the provider for the real approval status of this business's
   * templates (all of them, or just `ids`) and store it. Templates the
   * provider does not know keep their current status (a hand-added one stays
   * "not verified"). Never creates or deletes templates — that is the sync's job.
   */
  async refreshStatus(
    businessAccountId: string,
    authKey: string,
    integratedNumber: string,
    ids?: string[],
  ): Promise<{ checked: TemplateStatusCheck[]; templates: WhatsappTemplate[] }> {
    const num = normalizeWhatsappNumber(integratedNumber);
    if (!num) throw new Error("WhatsApp business number not configured — save it in WhatsApp → Connection settings first.");
    const conds = [eq(whatsappTemplates.businessAccountId, businessAccountId), isNull(whatsappTemplates.deletedAt)];
    if (ids && ids.length) conds.push(inArray(whatsappTemplates.id, ids));
    const locals = await db.select().from(whatsappTemplates).where(and(...conds));
    if (locals.length === 0) return { checked: [], templates: await this.list(businessAccountId) };

    const remote = await fetchMsg91Templates(num, authKey, null);
    const remoteByIdentity = new Map<string, { status: string; reason: string | null }>();
    for (const item of remote) {
      const name = String(item?.name || item?.template_name || "").trim();
      if (!name) continue;
      const variants: any[] = Array.isArray(item.languages) ? item.languages : [item];
      for (const variant of variants) {
        const associated = remoteWhatsappNumbers(item, variant);
        if (associated.length > 0 && !associated.includes(num)) continue;
        const language = String(variant.language || item.language || "en").toLowerCase();
        remoteByIdentity.set(templateIdentity(name, language), {
          status: normalizeProviderTemplateStatus(variant.status || item.status),
          reason: String(variant.rejection_reason || variant.rejected_reason || item.rejection_reason || item.reason || "").trim() || null,
        });
      }
    }

    const checked: TemplateStatusCheck[] = [];
    const now = new Date();
    for (const tpl of locals) {
      const match = remoteByIdentity.get(templateIdentity(tpl.name, tpl.language))
        // Provider language codes are sometimes "en_US" while ours is "en".
        || remoteByIdentity.get(templateIdentity(tpl.name, tpl.language.split(/[-_]/)[0]))
        || Array.from(remoteByIdentity.entries()).find(([key]) => key.startsWith(`${tpl.name.trim().toLowerCase()}\u0000${tpl.language.split(/[-_]/)[0].toLowerCase()}`))?.[1];
      if (!match) {
        checked.push({ id: tpl.id, name: tpl.name, language: tpl.language, found: false, previousStatus: tpl.status, status: tpl.status });
        continue;
      }
      await db.update(whatsappTemplates)
        .set({
          status: match.status,
          rejectionReason: match.status === "rejected" ? match.reason : null,
          statusSource: "provider",
          statusCheckedAt: now,
          updatedAt: now,
        })
        .where(and(eq(whatsappTemplates.id, tpl.id), eq(whatsappTemplates.businessAccountId, businessAccountId)));
      checked.push({ id: tpl.id, name: tpl.name, language: tpl.language, found: true, previousStatus: tpl.status, status: match.status });
    }
    return { checked, templates: await this.list(businessAccountId) };
  },

  /**
   * The business confirms a hand-added template is approved on its WhatsApp
   * provider (used when the status can't be checked automatically). Only for
   * manual templates that are not verified yet — a template the provider
   * reported as rejected cannot be overridden here.
   */
  async confirmApproved(businessAccountId: string, id: string): Promise<WhatsappTemplate | undefined> {
    const tpl = await this.get(businessAccountId, id);
    if (!tpl) return undefined;
    if (tpl.status === "approved") return tpl;
    if (tpl.sourceType !== "manual") throw new Error("Only templates you added yourself can be confirmed by hand.");
    if (tpl.status === "rejected") throw new Error("WhatsApp rejected this template, so it cannot be marked as approved. Fix it on your provider dashboard and check the status again.");
    const now = new Date();
    const [row] = await db.update(whatsappTemplates)
      .set({ status: "approved", statusSource: "user_confirmed", statusCheckedAt: now, rejectionReason: null, updatedAt: now })
      .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.businessAccountId, businessAccountId), isNull(whatsappTemplates.deletedAt)))
      .returning();
    return row;
  },

  /**
   * Draft a WhatsApp-compliant template from a short goal, with the
   * business's own AI key. Returns a suggestion only — nothing is saved.
   */
  async draftTemplate(businessAccountId: string, input: TemplateDraftInput): Promise<TemplateDraft> {
    const goal = String(input?.goal || "").trim().slice(0, 1_000);
    if (goal.length < 5) throw new Error("Describe what the message is for in a few words.");
    const apiKey = await templateDraftDeps.getApiKey(businessAccountId);
    if (!apiKey) throw new Error("Writing help needs an OpenAI key for your account. Add one in Settings, or write the message yourself.");
    const client = templateDraftDeps.createClient(businessAccountId, apiKey);
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You write WhatsApp Business message templates that pass Meta review.",
            "Return JSON only: {\"name\":\"snake_case_name\",\"category\":\"MARKETING|UTILITY|AUTHENTICATION\",\"language\":\"en\",\"bodyText\":\"...\",\"footerText\":\"...\",\"variables\":[{\"index\":1,\"meaning\":\"customer name\",\"example\":\"Priya\"}]}",
            "Rules: use numbered placeholders {{1}}, {{2}} … in order; never start or end the body with a placeholder;",
            "keep the body under 600 characters, friendly and clear; no misleading claims, no ALL CAPS, at most 2 emojis;",
            "do not ask for passwords, card numbers or other sensitive data; footer under 60 characters with no placeholders;",
            "for MARKETING include a way to opt out (e.g. footer 'Reply STOP to opt out');",
            "pick UTILITY only for updates about an existing order/booking/account, AUTHENTICATION only for one-time codes.",
            "Write in the requested language.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            goal,
            preferredCategory: input.category || null,
            language: input.language || "en",
            tone: input.tone || "friendly",
          }),
        },
      ],
    });
    let parsed: any = {};
    try {
      parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch {
      throw new Error("The writing help returned something unexpected. Please try again.");
    }
    const draft = sanitizeTemplateDraft(parsed, input);
    if (!draft.bodyText) throw new Error("The writing help could not draft a message. Try describing the goal differently.");
    return draft;
  },

  /**
   * NOTE: MSG91 does not expose a public REST endpoint to programmatically
   * create/submit WhatsApp templates. Templates must be created in the MSG91
   * Dashboard → WhatsApp → Templates, which forwards them to Meta for approval.
   * Once approved, use `syncFromMsg91` to pull them into this app.
   *
   * This method intentionally throws so any caller still wired to the old flow
   * surfaces a clear, actionable error instead of silently doing nothing.
   */
  async submitToMsg91(
    _businessAccountId: string,
    _id: string,
    _authKey: string,
    _integratedNumber: string,
  ): Promise<WhatsappTemplate | undefined> {
    throw new Error(
      "MSG91 does not support template submission via API. Create the template in the MSG91 dashboard, then click 'Sync from MSG91' to pull it in once approved.",
    );
  },

  /**
   * Pull approved templates from MSG91's WhatsApp API and upsert them locally.
   *
   * Endpoint (documented at https://docs.msg91.com/whatsapp/get-templates):
   *   GET https://control.msg91.com/api/v5/whatsapp/get-template-client/:number
   *   Header: authkey: <msg91AuthKey>
   *   Params: page_size=200, template_status=approved (optional filter)
   *
   * The `:number` path variable is the integrated WhatsApp number (digits only).
   */
  async syncFromMsg91(
    businessAccountId: string,
    authKey: string,
    integratedNumber?: string,
  ): Promise<WhatsappTemplateSyncResult> {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let removed = 0;
    try {
      const num = normalizeWhatsappNumber(integratedNumber);
      if (!num) {
        // Throw so the route returns a clear 500 (route already guards for missing
        // number before calling here, so this is a last-resort safety net).
        throw new Error("WhatsApp number not configured — cannot reach MSG91 template API.");
      }

      const allRemote = await fetchMsg91Templates(num, authKey, "approved");

      console.log(`[WhatsappTemplateService] Total templates fetched from MSG91: ${allRemote.length}`);
      const remoteIdentities = new Set<string>();

      // MSG91 response shape (discovered from live API):
      //   { name, category, namespace, languages: [ { language, status, code: [ {type, text}, ... ] } ] }
      // Each top-level item represents one template name; "languages" holds one
      // entry per language variant. Components (BODY, HEADER, FOOTER, BUTTONS)
      // live inside variant.code[], NOT variant.components[].
      for (const remote of allRemote) {
        const name = String(remote.name || remote.template_name || "").trim();
        if (!name) continue;

        // Collect language variants. Fall back to treating the remote object itself
        // as a single variant for any alternative envelope shapes.
        const variants: any[] = Array.isArray(remote.languages) ? remote.languages : [remote];

        for (const variant of variants) {
          // Language is part of the identity: "promo_offer" in "en" and "hi" are
          // distinct Meta-approved templates and must not overwrite each other.
          const language = (variant.language || remote.language || "en").toString().toLowerCase();
          const identity = templateIdentity(name, language);
          if (remoteIdentities.has(identity)) {
            skipped++;
            continue;
          }

          const associatedNumbers = remoteWhatsappNumbers(remote, variant);
          if (associatedNumbers.length > 0 && !associatedNumbers.includes(num)) {
            skipped++;
            console.warn(
              `[WhatsappTemplateService] Skipping template ${name}/${language}: response number does not match configured WhatsApp number`,
            );
            continue;
          }
          remoteIdentities.add(identity);

          // Helper: find a component from either variant.code (MSG91) or
          // variant.components (Meta Graph API fallback), case-insensitively.
          const findComp = (type: string): any =>
            variant.code?.find?.((c: any) => c.type?.toUpperCase() === type.toUpperCase()) ||
            variant.components?.find?.((c: any) => c.type?.toUpperCase() === type.toUpperCase()) ||
            remote.components?.find?.((c: any) => c.type?.toUpperCase() === type.toUpperCase());

          const bodyComp   = findComp("BODY");
          const headerComp = findComp("HEADER");
          const footerComp = findComp("FOOTER");
          const buttonsComp = findComp("BUTTONS");

          const bodyText: string =
            bodyComp?.text ||
            variant.body || variant.body_text || variant.bodyText ||
            remote.body  || remote.body_text  || remote.bodyText  ||
            "";

          // Buttons: extract quick-reply / CTA labels if present
          const buttons: any[] = buttonsComp?.buttons || remote.buttons || variant.buttons || [];

          const payload = {
            businessAccountId,
            name,
            language,
            category: (remote.category || variant.category || "MARKETING").toString().toUpperCase(),
            bodyText,
            headerType: headerComp?.format ? headerComp.format.toLowerCase() : "none",
            headerText: headerComp?.text || "",
            headerMediaUrl: "",
            footerText: footerComp?.text || "",
            buttons,
            paramCount: countParams(bodyText),
            status: (variant.status || remote.status || "approved").toString().toLowerCase(),
            msg91TemplateId:
              (variant.msg91_template_id ?? variant.id ?? remote.id ?? remote.template_id ?? null)
                ?.toString() ?? null,
            namespace: remote.namespace || variant.namespace || null,
            sourceType: "msg91",
            sourceWhatsappNumber: num,
          };

          // Provider identities are scoped to the configured WhatsApp number.
          // A number change must create a separate record so old campaigns keep
          // their original template snapshot and tombstones do not cross scopes.
          const scopedExisting = await db
            .select()
            .from(whatsappTemplates)
            .where(
              and(
                eq(whatsappTemplates.businessAccountId, businessAccountId),
                eq(whatsappTemplates.sourceType, "msg91"),
                eq(whatsappTemplates.sourceWhatsappNumber, num),
                eq(whatsappTemplates.name, name),
                eq(whatsappTemplates.language, language),
              ),
            )
            .limit(1);
          let existing = scopedExisting;

          // Conservatively adopt a legacy/manual mirror only when its external
          // MSG91 ID proves it is the same provider template. Name collisions
          // alone never convert or overwrite a manual record.
          if (existing.length === 0 && payload.msg91TemplateId) {
            existing = await db
              .select()
              .from(whatsappTemplates)
              .where(and(
                eq(whatsappTemplates.businessAccountId, businessAccountId),
                eq(whatsappTemplates.sourceType, "manual"),
                eq(whatsappTemplates.msg91TemplateId, payload.msg91TemplateId),
                eq(whatsappTemplates.name, name),
                eq(whatsappTemplates.language, language),
              ))
              .limit(1);
          }

          if (existing.length > 0) {
            if (existing[0].deletedAt) {
              skipped++;
              continue;
            }
            await db
              .update(whatsappTemplates)
              .set({ ...payload, updatedAt: new Date() })
              .where(eq(whatsappTemplates.id, existing[0].id));
            updated++;
          } else {
            await db.insert(whatsappTemplates).values(payload);
            added++;
          }
        }
      }

      const activeSynced = await db
        .select()
        .from(whatsappTemplates)
        .where(and(
          eq(whatsappTemplates.businessAccountId, businessAccountId),
          eq(whatsappTemplates.sourceType, "msg91"),
          eq(whatsappTemplates.sourceWhatsappNumber, num),
          isNull(whatsappTemplates.deletedAt),
        ));
      const staleIds = activeSynced
        .filter(template => !remoteIdentities.has(templateIdentity(template.name, template.language)))
        .map(template => template.id);
      for (const id of staleIds) {
        await db
          .update(whatsappTemplates)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(whatsappTemplates.id, id));
        removed++;
      }
    } catch (err) {
      console.error("[WhatsappTemplateService] syncFromMsg91 error:", err);
      throw err; // let the route return a proper error to the client
    }
    const templates = await this.list(businessAccountId);
    return { synced: added + updated, added, updated, skipped, removed, templates };
  },

  /** @deprecated kept only to preserve old type — unused. */
  async _legacySyncFromMsg91(businessAccountId: string, authKey: string, integratedNumber?: string): Promise<{ synced: number; templates: WhatsappTemplate[] }> {
    let synced = 0;
    try {
      const num = (integratedNumber || "").replace(/\D/g, "");
      if (!num) {
        console.log("[WhatsappTemplateService] MSG91 sync skipped — integrated number not configured in WhatsApp settings");
        const templates = await this.list(businessAccountId);
        return { synced, templates };
      }
      const candidates = [
        `https://api.msg91.com/api/v5/whatsapp/getTemplate?integrated_number=${num}`,
        `https://control.msg91.com/api/v5/whatsapp/getTemplate?integrated_number=${num}`,
        `https://control.msg91.com/api/v5/whatsapp/get-templates/?integrated_number=${num}`,
      ];
      let data: any = null;
      let lastStatus = 0;
      let lastBody = "";
      for (const url of candidates) {
        const resp = await fetchWithTimeout(url, {
          method: "GET",
          headers: { authkey: authKey, accept: "application/json" },
        });
        lastStatus = resp.status;
        const json: any = await resp.json().catch(() => ({}));
        console.log(`[WhatsappTemplateService] MSG91 try ${url} → ${resp.status}, keys: ${JSON.stringify(Object.keys(json || {}))}`);
        if (resp.ok && (Array.isArray(json?.data) || Array.isArray(json?.templates))) {
          data = json;
          break;
        }
        lastBody = JSON.stringify(json).slice(0, 500);
      }
      if (!data) {
        console.log(`[WhatsappTemplateService] MSG91 sync failed (last status ${lastStatus}): ${lastBody}`);
        const templates = await this.list(businessAccountId);
        return { synced, templates };
      }
      const remoteTemplates: any[] =
        (Array.isArray(data?.data) && data.data) ||
        (Array.isArray(data?.templates) && data.templates) ||
        (Array.isArray(data?.data?.templates) && data.data.templates) ||
        (Array.isArray(data?.result) && data.result) ||
        (Array.isArray(data?.data?.result) && data.data.result) ||
        (Array.isArray(data?.items) && data.items) ||
        (Array.isArray(data) && data) ||
        [];
      console.log(`[WhatsappTemplateService] MSG91 sync parsed ${remoteTemplates.length} templates`);
      if (remoteTemplates.length === 0) {
        console.log("[WhatsappTemplateService] MSG91 raw response sample:", JSON.stringify(data).slice(0, 1500));
      }

      for (const remote of remoteTemplates) {
        const name = remote.name || remote.template_name;
        if (!name) continue;

        const bodyText: string =
          remote.body ||
          remote.bodyText ||
          remote.components?.find?.((c: any) => c.type === "BODY")?.text ||
          "";
        const headerComp = remote.components?.find?.((c: any) => c.type === "HEADER");
        const footerComp = remote.components?.find?.((c: any) => c.type === "FOOTER");

        const existing = await db
          .select()
          .from(whatsappTemplates)
          .where(and(eq(whatsappTemplates.businessAccountId, businessAccountId), eq(whatsappTemplates.name, name)))
          .limit(1);

        const payload = {
          businessAccountId,
          name,
          language: remote.language || "en",
          category: (remote.category || "MARKETING").toString().toUpperCase(),
          bodyText,
          headerType: headerComp?.format ? headerComp.format.toLowerCase() : "none",
          headerText: headerComp?.text || "",
          footerText: footerComp?.text || "",
          paramCount: countParams(bodyText),
          status: (remote.status || "approved").toString().toLowerCase(),
          msg91TemplateId: remote.id || remote.template_id || null,
        };

        if (existing.length > 0) {
          await db
            .update(whatsappTemplates)
            .set({ ...payload, updatedAt: new Date() })
            .where(eq(whatsappTemplates.id, existing[0].id));
        } else {
          await db.insert(whatsappTemplates).values(payload);
        }
        synced++;
      }
    } catch (err) {
      console.error("[WhatsappTemplateService] syncFromMsg91 error:", err);
    }
    const templates = await this.list(businessAccountId);
    return { synced, templates };
  },
};

export { countParams as countTemplateParams };
