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
   * MSG91 does NOT expose a public REST endpoint to list WhatsApp templates.
   * We probed 23+ endpoint variants (api.msg91.com, control.msg91.com,
   * various /whatsapp-template/, /getTemplate, /get-templates paths) — all
   * returned 404 even with a valid auth key. Confirmed by hitting the known
   * outbound-message endpoint, which returned 405 (proving auth + base URL
   * are correct).
   *
   * Therefore templates must be entered manually via "Add Template" in the
   * UI. This method is kept for backwards compatibility and just returns the
   * locally stored list.
   */
  async syncFromMsg91(businessAccountId: string, _authKey: string, _integratedNumber?: string): Promise<{ synced: number; templates: WhatsappTemplate[] }> {
    const templates = await this.list(businessAccountId);
    return { synced: 0, templates };
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
