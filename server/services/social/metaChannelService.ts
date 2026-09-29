/**
 * Shared Instagram / Facebook channel service: settings, Graph API sends, message / comment
 * storage, conversations and leads. instagramService.ts and facebookService.ts are thin
 * subclasses that supply the tables, Graph host, column names and the calls only one
 * platform has (IG images / post context via media fields; FB private_replies, page posts).
 *
 * The two platforms' tables have the same shape except for a few column names
 * (senderUsername vs senderName, igMessageId vs fbMessageId, commenterUsername vs
 * commenterName, igAccessToken vs pageAccessToken); those come from the config. Tables are
 * handled as `any` here — the typed public API lives on the subclasses.
 */
import { fetchWithTimeout } from "../../lib/fetchWithTimeout";
import { db } from "../../db";
import { eq, and, desc, sql, asc, count } from "drizzle-orm";
import { encrypt, decrypt } from "../encryptionService";
import type { SocialPlatformId } from "./types";

type SendResult = { success: boolean; messageId?: string; error?: string };

export interface MetaChannelConfig {
  platform: SocialPlatformId;
  /** Log prefix without brackets: "Instagram" | "Facebook". */
  label: string;
  apiBase: string;
  textLimit: number;
  /** Error returned when no access token is stored. */
  tokenMissingError: string;
  /** Used in the decrypt error log: "access token" | "page access token". */
  tokenNoun: string;
  /** Settings column holding the encrypted access token. */
  tokenField: string;
  /** Graph edge for a public reply to a comment: IG "replies", FB "comments". */
  commentReplyEdge: string;
  /** Plain fields saveSettings copies when present (besides the comment settings). */
  saveSettingsFields: string[];
  tables: {
    settings: any;
    messages: any;
    comments: any;
    leads: any;
    leadFields: any;
  };
  /** SQL table name of the messages table (for the conversation list query). */
  messagesTableName: string;
  columns: {
    /** messages + leads: display name of the customer ("senderUsername" | "senderName"). */
    senderName: string;
    /** SQL name of the same column in the messages table. */
    senderNameSql: string;
    /** messages: Meta message id ("igMessageId" | "fbMessageId"). */
    platformMessageId: string;
    /** comments: commenter display name ("commenterUsername" | "commenterName"). */
    commenterName: string;
  };
}

const COMMENT_SETTINGS_FIELDS = [
  "commentAutoReplyEnabled",
  "commentReplyMode",
  "commentTriggerKeywords",
  "commentReplyDelay",
  "commentMaxRepliesPerPost",
  // Kept for API compatibility; replying to our own comments is always blocked now.
  "commentIgnoreOwnReplies",
  "commentAutoDmEnabled",
  "commentDmMode",
  "commentDmTriggerKeywords",
  "commentDmTemplate",
];

const MASKED_SECRET = "••••••••";

// Writes go through an untyped handle: the table objects are platform-dependent (see header).
const dbAny = db as any;

export class MetaChannelService<TSettings = any, TMessage = any, TComment = any, TLead = any, TLeadField = any> {
  constructor(protected readonly cfg: MetaChannelConfig) {}

  protected get tag(): string {
    return `[${this.cfg.label}]`;
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  async getSettings(businessAccountId: string): Promise<TSettings | null> {
    const t = this.cfg.tables.settings;
    const [settings] = await db.select().from(t).where(eq(t.businessAccountId, businessAccountId)).limit(1);
    return (settings as TSettings) || null;
  }

  async updateSettings(businessAccountId: string, data: Partial<TSettings>): Promise<TSettings> {
    const t = this.cfg.tables.settings;
    const d = data as any;
    const updateData: any = { ...d, updatedAt: new Date() };
    const tokenField = this.cfg.tokenField;
    if (d[tokenField] !== undefined && d[tokenField] !== null) {
      updateData[tokenField] = encrypt(d[tokenField]);
    }
    if (d.appSecret !== undefined && d.appSecret !== null) {
      updateData.appSecret = encrypt(d.appSecret);
    }
    const [updated] = await dbAny.update(t).set(updateData).where(eq(t.businessAccountId, businessAccountId)).returning();
    return updated as TSettings;
  }

  async createSettings(businessAccountId: string, data: Partial<TSettings> = {}): Promise<TSettings> {
    const d = data as any;
    const insertData: any = { businessAccountId, ...d };
    const tokenField = this.cfg.tokenField;
    if (d[tokenField]) insertData[tokenField] = encrypt(d[tokenField]);
    if (d.appSecret) insertData.appSecret = encrypt(d.appSecret);
    const [created] = await dbAny.insert(this.cfg.tables.settings).values(insertData).returning();
    return created as TSettings;
  }

  async saveSettings(businessAccountId: string, data: any): Promise<TSettings> {
    const existing = await this.getSettings(businessAccountId);
    const updateData: any = {};
    for (const field of [...this.cfg.saveSettingsFields, ...COMMENT_SETTINGS_FIELDS]) {
      if (data[field] !== undefined) updateData[field] = data[field];
    }
    // Secrets come back from the UI masked when unchanged.
    for (const field of [this.cfg.tokenField, "appSecret"]) {
      if (data[field] && data[field] !== MASKED_SECRET) updateData[field] = data[field];
    }
    return existing
      ? await this.updateSettings(businessAccountId, updateData)
      : await this.createSettings(businessAccountId, updateData);
  }

  async findSettingsByVerifyToken(verifyToken: string): Promise<TSettings | null> {
    const t = this.cfg.tables.settings;
    const [settings] = await db.select().from(t).where(eq(t.webhookVerifyToken, verifyToken)).limit(1);
    return (settings as TSettings) || null;
  }

  getDecryptedAccessToken(settings: TSettings): string | null {
    const value = (settings as any)[this.cfg.tokenField];
    if (!value) return null;
    try {
      return decrypt(value);
    } catch (error) {
      console.error(`${this.tag} Failed to decrypt ${this.cfg.tokenNoun}:`, error);
      return null;
    }
  }

  getDecryptedAppSecret(settings: TSettings): string | null {
    const value = (settings as any).appSecret;
    if (!value) return null;
    try {
      return decrypt(value);
    } catch (error) {
      console.error(`${this.tag} Failed to decrypt app secret:`, error);
      return null;
    }
  }

  // ── Graph API ─────────────────────────────────────────────────────────────

  protected truncate(text: string): string {
    const limit = this.cfg.textLimit;
    return text.length > limit ? text.substring(0, limit - 3) + "..." : text;
  }

  /**
   * POSTs JSON to the Graph API with the account's token. `describe` builds the log line
   * written after the response (omit for no log); `errorLog` / `fallbackError` are used
   * when the request throws.
   */
  protected async graphPost(
    settings: TSettings,
    url: string,
    body: unknown,
    opts: {
      /** Logged once the token is known to be there, before the request. */
      before?: string;
      describe?: (status: number, data: any) => string;
      errorLog: string;
      fallbackError: string;
      logErrorMessageOnly?: boolean;
    },
  ): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
    try {
      const accessToken = this.getDecryptedAccessToken(settings);
      if (!accessToken) return { ok: false, error: this.cfg.tokenMissingError };
      if (opts.before) console.log(`${this.tag} ${opts.before}`);

      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }, 30_000);

      const responseData = await response.json();
      if (opts.describe) console.log(`${this.tag} ${opts.describe(response.status, responseData)}`);

      if (!response.ok) {
        return { ok: false, error: responseData?.error?.message || `${this.cfg.label} API error: ${response.status}` };
      }
      return { ok: true, data: responseData };
    } catch (error) {
      console.error(`${this.tag} ${opts.errorLog}:`, opts.logErrorMessageOnly && error instanceof Error ? error.message : error);
      return { ok: false, error: error instanceof Error ? error.message : opts.fallbackError };
    }
  }

  protected static errorCodeSuffix(data: any): string {
    return data?.error?.code ? `, error code ${data.error.code}` : "";
  }

  async sendMessage(settings: TSettings, recipientId: string, messageText: string): Promise<SendResult> {
    const text = this.truncate(messageText);
    const r = await this.graphPost(settings, `${this.cfg.apiBase}/me/messages`, {
      recipient: { id: recipientId },
      message: { text },
    }, {
      before: `Sending message to ${recipientId} (${text.length} chars)`,
      describe: (status, data) => `Send message: HTTP ${status}${data?.message_id ? `, message ${data.message_id}` : ""}${MetaChannelService.errorCodeSuffix(data)}`,
      errorLog: "Send error",
      fallbackError: "Failed to send message",
    });
    return r.ok ? { success: true, messageId: r.data.message_id } : { success: false, error: r.error };
  }

  async sendQuickReply(
    settings: TSettings,
    recipientId: string,
    messageText: string,
    quickReplies: { content_type: string; title: string; payload: string }[],
  ): Promise<SendResult> {
    const r = await this.graphPost(settings, `${this.cfg.apiBase}/me/messages`, {
      recipient: { id: recipientId },
      message: { text: this.truncate(messageText), quick_replies: quickReplies.slice(0, 13) },
    }, { errorLog: "Send quick reply error", fallbackError: "Failed to send quick reply" });
    return r.ok ? { success: true, messageId: r.data.message_id } : { success: false, error: r.error };
  }

  async replyToComment(settings: TSettings, commentId: string, message: string): Promise<{ success: boolean; commentId?: string; error?: string }> {
    const text = this.truncate(message);
    const r = await this.graphPost(settings, `${this.cfg.apiBase}/${commentId}/${this.cfg.commentReplyEdge}`, { message: text }, {
      before: `Replying to comment ${commentId} (${text.length} chars)`,
      describe: (status, data) => `Comment reply: HTTP ${status}${data?.id ? `, reply ${data.id}` : ""}${MetaChannelService.errorCodeSuffix(data)}`,
      errorLog: "Reply to comment error",
      fallbackError: "Failed to reply to comment",
    });
    return r.ok ? { success: true, commentId: r.data.id } : { success: false, error: r.error };
  }

  // ── Messages / conversations ──────────────────────────────────────────────

  /** Inserts one DM row; `senderName` / `platformMessageId` map to the platform's columns. */
  protected async insertMessage(
    businessAccountId: string,
    senderId: string,
    messageText: string | null,
    direction: "incoming" | "outgoing",
    options: { senderName?: string; platformMessageId?: string; messageType?: string; mediaUrl?: string },
  ): Promise<TMessage> {
    const c = this.cfg.columns;
    const [message] = await dbAny.insert(this.cfg.tables.messages).values({
      businessAccountId,
      senderId,
      messageText: messageText || null,
      direction,
      [c.senderName]: options.senderName || null,
      [c.platformMessageId]: options.platformMessageId || null,
      messageType: options.messageType || "text",
      mediaUrl: options.mediaUrl || null,
    }).returning();
    console.log(`${this.tag} Stored ${direction} message for sender ${senderId} (id: ${(message as any).id})`);
    return message as TMessage;
  }

  protected async findMessageByPlatformId(platformMessageId: string): Promise<TMessage | null> {
    const t = this.cfg.tables.messages;
    const [message] = await db.select().from(t).where(eq(t[this.cfg.columns.platformMessageId], platformMessageId)).limit(1);
    return (message as TMessage) || null;
  }

  async getConversations(
    businessAccountId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ conversations: any[]; total: number }> {
    const { limit = 20, offset = 0 } = options;
    const table = sql.raw(this.cfg.messagesTableName);
    const nameCol = sql.raw(this.cfg.columns.senderNameSql);

    const conversationsResult = await db.execute(sql`
      SELECT
        sender_id,
        MAX(${nameCol}) as ${nameCol},
        COUNT(*) as message_count,
        MAX(created_at) as last_message_at,
        (SELECT message_text FROM ${table} m2
         WHERE m2.business_account_id = ${businessAccountId}
         AND m2.sender_id = cm.sender_id
         ORDER BY m2.created_at DESC LIMIT 1) as last_message
      FROM ${table} cm
      WHERE business_account_id = ${businessAccountId}
      GROUP BY sender_id
      ORDER BY MAX(created_at) DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    const countResult = await db.execute(sql`
      SELECT COUNT(DISTINCT sender_id) as total
      FROM ${table}
      WHERE business_account_id = ${businessAccountId}
    `);

    return {
      conversations: conversationsResult.rows as any[],
      total: Number((countResult.rows[0] as any)?.total || 0),
    };
  }

  async getConversationBySenderId(
    businessAccountId: string,
    senderId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<{ messages: TMessage[]; hasMore: boolean }> {
    const { limit = 50, before } = options;
    const t = this.cfg.tables.messages;
    const conditions = [eq(t.businessAccountId, businessAccountId), eq(t.senderId, senderId)];
    if (before) conditions.push(sql`${t.createdAt} < ${before}::timestamp`);

    const messages = await db.select().from(t).where(and(...conditions)).orderBy(desc(t.createdAt)).limit(limit + 1);
    const hasMore = messages.length > limit;
    const result = hasMore ? messages.slice(0, limit) : messages;
    result.reverse();
    return { messages: result as TMessage[], hasMore };
  }

  async deleteConversation(businessAccountId: string, senderId: string): Promise<number> {
    const t = this.cfg.tables.messages;
    const result = await dbAny.delete(t).where(and(eq(t.businessAccountId, businessAccountId), eq(t.senderId, senderId))).returning();
    console.log(`${this.tag} Deleted ${result.length} messages for sender ${senderId}`);
    return result.length;
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  protected async findCommentByPlatformId(businessAccountId: string, commentId: string): Promise<TComment | null> {
    const t = this.cfg.tables.comments;
    const [comment] = await db.select().from(t)
      .where(and(eq(t.businessAccountId, businessAccountId), eq(t.commentId, commentId)))
      .limit(1);
    return (comment as TComment) || null;
  }

  /** `commenterName` maps to the platform's commenter-name column. */
  protected async insertComment(data: {
    businessAccountId: string;
    postId?: string;
    commentId?: string;
    commentText?: string;
    commenterName?: string;
    commenterId?: string;
    replyText?: string;
    replyCommentId?: string;
    status?: string;
  }): Promise<TComment> {
    const [comment] = await dbAny.insert(this.cfg.tables.comments).values({
      businessAccountId: data.businessAccountId,
      postId: data.postId || null,
      commentId: data.commentId || null,
      commentText: data.commentText || null,
      [this.cfg.columns.commenterName]: data.commenterName || null,
      commenterId: data.commenterId || null,
      replyText: data.replyText || null,
      replyCommentId: data.replyCommentId || null,
      status: data.status || "pending",
    }).returning();
    console.log(`${this.tag} Stored comment ${data.commentId} for business ${data.businessAccountId} (id: ${(comment as any).id})`);
    return comment as TComment;
  }

  // ── Leads ─────────────────────────────────────────────────────────────────

  protected async insertLead(
    businessAccountId: string,
    data: { senderId: string; senderName?: string; flowSessionId?: string; extractedData?: Record<string, any>; status?: string },
  ): Promise<TLead> {
    const [lead] = await dbAny.insert(this.cfg.tables.leads).values({
      businessAccountId,
      senderId: data.senderId,
      [this.cfg.columns.senderName]: data.senderName || null,
      flowSessionId: data.flowSessionId || null,
      extractedData: data.extractedData || {},
      status: data.status || "new",
      receivedAt: new Date(),
    }).returning();

    // Push to the account's CRM(s) in the background (no-op when none auto-syncs).
    (await import("../socialLeadCrmSync")).triggerSocialLeadCrmSync(this.cfg.platform, (lead as any).id);

    return lead as TLead;
  }

  protected async listLeads(
    businessAccountId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ leads: TLead[]; total: number }> {
    const { limit = 20, offset = 0 } = options;
    const t = this.cfg.tables.leads;
    const [totalResult] = await db.select({ count: count() }).from(t).where(eq(t.businessAccountId, businessAccountId));
    const leads = await db.select().from(t)
      .where(eq(t.businessAccountId, businessAccountId))
      .orderBy(desc(t.receivedAt))
      .limit(limit)
      .offset(offset);
    return { leads: leads as TLead[], total: totalResult?.count || 0 };
  }

  protected async removeLead(businessAccountId: string, leadId: string): Promise<void> {
    const t = this.cfg.tables.leads;
    await dbAny.delete(t).where(and(eq(t.id, leadId), eq(t.businessAccountId, businessAccountId)));
  }

  protected async listLeadFields(businessAccountId: string): Promise<TLeadField[]> {
    const t = this.cfg.tables.leadFields;
    let fields = await db.select().from(t).where(eq(t.businessAccountId, businessAccountId)).orderBy(asc(t.displayOrder));

    if (fields.length === 0) {
      const defaults = [
        { businessAccountId, fieldKey: "customer_name", fieldLabel: "Customer Name", fieldType: "text", isRequired: true, isDefault: true, isEnabled: true, displayOrder: 0 },
        { businessAccountId, fieldKey: "phone_number", fieldLabel: "Phone Number", fieldType: "phone", isRequired: false, isDefault: true, isEnabled: true, displayOrder: 1 },
        { businessAccountId, fieldKey: "email_address", fieldLabel: "Email Address", fieldType: "email", isRequired: false, isDefault: true, isEnabled: true, displayOrder: 2 },
      ];
      fields = await dbAny.insert(t).values(defaults).returning();
    }
    return fields as TLeadField[];
  }

  protected async addLeadField(
    businessAccountId: string,
    data: { fieldKey: string; fieldLabel: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean },
  ): Promise<TLeadField> {
    const t = this.cfg.tables.leadFields;
    const maxOrder = await db
      .select({ max: sql<number>`COALESCE(MAX(${t.displayOrder}), -1)` })
      .from(t)
      .where(eq(t.businessAccountId, businessAccountId));

    const [field] = await dbAny.insert(t).values({
      businessAccountId,
      fieldKey: data.fieldKey,
      fieldLabel: data.fieldLabel,
      fieldType: data.fieldType || "text",
      isRequired: data.isRequired || false,
      isDefault: false,
      isEnabled: data.isEnabled !== false,
      displayOrder: (maxOrder[0]?.max ?? -1) + 1,
    }).returning();
    return field as TLeadField;
  }

  protected async changeLeadField(
    businessAccountId: string,
    fieldId: string,
    data: { fieldLabel?: string; fieldType?: string; isRequired?: boolean; isEnabled?: boolean },
  ): Promise<TLeadField> {
    const t = this.cfg.tables.leadFields;
    const updateData: any = { updatedAt: new Date() };
    if (data.fieldLabel !== undefined) updateData.fieldLabel = data.fieldLabel;
    if (data.fieldType !== undefined) updateData.fieldType = data.fieldType;
    if (data.isRequired !== undefined) updateData.isRequired = data.isRequired;
    if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;

    const [field] = await dbAny.update(t).set(updateData)
      .where(and(eq(t.id, fieldId), eq(t.businessAccountId, businessAccountId)))
      .returning();
    return field as TLeadField;
  }

  protected async removeLeadField(businessAccountId: string, fieldId: string): Promise<void> {
    const t = this.cfg.tables.leadFields;
    await dbAny.delete(t).where(and(eq(t.id, fieldId), eq(t.businessAccountId, businessAccountId), eq(t.isDefault, false)));
  }

  /** GET a Graph object with the token as a query parameter. */
  protected graphGetUrl(path: string, fields: string, accessToken: string): string {
    return `${this.cfg.apiBase}/${path}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`;
  }
}
