import { db } from "../db";
import { whatsappTemplates, type WhatsappTemplate, type InsertWhatsappTemplate } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

function countParams(body: string): number {
  const matches = body.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  const indices = new Set(
    matches.map(m => parseInt(m.replace(/\D/g, ""), 10)).filter(n => Number.isFinite(n))
  );
  return indices.size;
}

export const whatsappTemplateService = {
  async list(businessAccountId: string): Promise<WhatsappTemplate[]> {
    return db
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.businessAccountId, businessAccountId))
      .orderBy(desc(whatsappTemplates.updatedAt));
  },

  async get(businessAccountId: string, id: string): Promise<WhatsappTemplate | undefined> {
    const [row] = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.businessAccountId, businessAccountId)))
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
        // MSG91 has no public API to create or sync templates — every template
        // mirrored here is already Meta-approved on the MSG91 dashboard, so we
        // always mark it as approved (and therefore campaign-ready) on save.
        status: "approved",
        msg91TemplateId,
        namespace: payload.namespace || null,
      })
      .returning();
    return row;
  },

  async update(businessAccountId: string, id: string, payload: Partial<InsertWhatsappTemplate>): Promise<WhatsappTemplate | undefined> {
    const updates: any = { updatedAt: new Date() };
    const fields: (keyof InsertWhatsappTemplate)[] = [
      "name", "language", "category", "bodyText", "headerType", "headerText",
      "headerMediaUrl", "footerText", "buttons", "status", "msg91TemplateId", "namespace", "rejectionReason"
    ];
    for (const field of fields) {
      if (payload[field] !== undefined) updates[field] = payload[field];
    }
    if (payload.bodyText !== undefined) {
      updates.paramCount = countParams(payload.bodyText || "");
    }
    const [row] = await db
      .update(whatsappTemplates)
      .set(updates)
      .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.businessAccountId, businessAccountId)))
      .returning();
    return row;
  },

  async remove(businessAccountId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, id), eq(whatsappTemplates.businessAccountId, businessAccountId)))
      .returning({ id: whatsappTemplates.id });
    return result.length > 0;
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
  async syncFromMsg91(businessAccountId: string, authKey: string, integratedNumber?: string): Promise<{ synced: number; templates: WhatsappTemplate[] }> {
    let synced = 0;
    try {
      const num = (integratedNumber || "").replace(/\D/g, "");
      if (!num) {
        console.log("[WhatsappTemplateService] sync skipped — WhatsApp number not configured");
        const templates = await this.list(businessAccountId);
        return { synced, templates };
      }

      // Collect all templates via pagination. MSG91 requires pagination=true to
      // enable paginated responses; without it the endpoint returns the full
      // result regardless of page_num, which would loop forever. We cap at
      // MAX_PAGES as an additional defensive guard.
      // Paginate through all approved templates. MSG91 requires pagination=true
      // together with page_num for the endpoint to advance pages; without it the
      // endpoint returns the same result on every call, creating an infinite loop.
      // MAX_PAGES is a hard defensive ceiling (25 × 200 = 5,000 templates).
      const PAGE_SIZE = 200;
      const MAX_PAGES = 25;
      const allRemote: any[] = [];

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url =
          `https://control.msg91.com/api/v5/whatsapp/get-template-client/${encodeURIComponent(num)}` +
          `?page_size=${PAGE_SIZE}&page_num=${pageNum}&pagination=true&template_status=approved`;
        console.log(`[WhatsappTemplateService] Fetching page ${pageNum}: ${url}`);

        const resp = await fetch(url, {
          method: "GET",
          headers: { authkey: authKey, accept: "application/json" },
        });

        const json: any = await resp.json().catch(() => ({}));
        console.log(`[WhatsappTemplateService] Page ${pageNum}: status=${resp.status}, keys=${JSON.stringify(Object.keys(json || {}))}`);

        if (!resp.ok) {
          const msg = json?.message || json?.error || `HTTP ${resp.status}`;
          throw new Error(`MSG91 API error: ${msg}`);
        }

        // Normalise the response envelope — MSG91 returns arrays under various keys
        const page: any[] =
          (Array.isArray(json?.data) && json.data) ||
          (Array.isArray(json?.templates) && json.templates) ||
          (Array.isArray(json?.data?.templates) && json.data.templates) ||
          (Array.isArray(json?.result) && json.result) ||
          (Array.isArray(json) && json) ||
          [];

        allRemote.push(...page);

        // A page shorter than PAGE_SIZE means we have reached the last page.
        if (page.length < PAGE_SIZE) break;
      }

      console.log(`[WhatsappTemplateService] Total templates fetched from MSG91: ${allRemote.length}`);

      for (const remote of allRemote) {
        const name = remote.name || remote.template_name;
        if (!name) continue;

        // Language is part of the identity: "promo_offer" in "en" and "promo_offer"
        // in "hi" are distinct Meta-approved templates and must not overwrite each other.
        const language = (remote.language || "en").toString().toLowerCase();

        const bodyText: string =
          remote.body ||
          remote.bodyText ||
          remote.components?.find?.((c: any) => c.type === "BODY")?.text ||
          "";

        const headerComp = remote.components?.find?.((c: any) => c.type === "HEADER");
        const footerComp = remote.components?.find?.((c: any) => c.type === "FOOTER");

        const payload = {
          businessAccountId,
          name,
          language,
          category: (remote.category || "MARKETING").toString().toUpperCase(),
          bodyText,
          headerType: headerComp?.format ? headerComp.format.toLowerCase() : "none",
          headerText: headerComp?.text || "",
          headerMediaUrl: "",
          footerText: footerComp?.text || "",
          buttons: [],
          paramCount: countParams(bodyText),
          status: (remote.status || "approved").toString().toLowerCase(),
          msg91TemplateId: (remote.id || remote.template_id || null)?.toString() ?? null,
          namespace: remote.namespace || null,
        };

        // Upsert by (businessAccountId, name, language) — not just name — so that
        // same-name templates in different languages are stored as separate rows.
        const existing = await db
          .select()
          .from(whatsappTemplates)
          .where(
            and(
              eq(whatsappTemplates.businessAccountId, businessAccountId),
              eq(whatsappTemplates.name, name),
              eq(whatsappTemplates.language, language),
            ),
          )
          .limit(1);

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
      throw err; // let the route return a proper error to the client
    }
    const templates = await this.list(businessAccountId);
    return { synced, templates };
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
        const resp = await fetch(url, {
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
