/**
 * Handles Instagram and Facebook webhook events (DMs and comments) after the route has
 * answered Meta with 200 and the signature guard has accepted the request. Gives the
 * Meta channels the protections the WhatsApp agent has:
 *
 * - Duplicates: every event (not every request — Meta batches entry[].messaging[] and
 *   changes[]) is claimed in the persistent webhook_events table first, so a Meta retry of
 *   the same message id / comment id is processed once, across restarts and pods. The claim
 *   is marked processed once handling finished (or once the incoming message was stored —
 *   replaying it after that would duplicate the reply), and released when nothing was done,
 *   so a redelivery can still process it.
 * - One message at a time per customer: DMs from the same sender (flow step + AI reply)
 *   run in order, different senders in parallel (PerKeyQueue, bounded wait).
 * - Spam / bot loops: DMs go through inboundMessageLimiter (opt-out words bypass it).
 *   Comments: see commentReplyLimiter and the self-comment block in the comment services.
 */
import { db } from "../db";
import { businessAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { PerKeyQueue } from "../lib/perKeyQueue";
import { runWithContext } from "../lib/requestContext";
import { webhookIdempotency } from "./webhookIdempotencyService";
import { inboundMessageLimiter } from "./inboundMessageLimiter";

export type MetaPlatform = "instagram" | "facebook";

// Longest a DM waits for the previous one from the same customer (an AI reply with tool
// calls and product images can take a while); after that it runs anyway.
const DM_QUEUE_MAX_WAIT_MS = 120_000;
const dmQueue = new PerKeyQueue({ maxWaitMs: DM_QUEUE_MAX_WAIT_MS, name: "Meta DM queue" });

const RATE_LIMIT_NOTICE = "You're sending messages very quickly. Please wait a few minutes and then send your message again.";

interface FlowResult {
  handled: boolean;
  response?: { type: "text" | "buttons"; text: string; buttons?: { id: string; title: string }[] };
  shouldFallbackToAI?: boolean;
  flowCompleted?: boolean;
  collectedData?: Record<string, any>;
  sessionId?: string;
}

type SendResult = { success: boolean; messageId?: string; error?: string };

interface Adapter {
  tag: string;
  feature: string;
  findBusiness(accountId: string): Promise<{ businessAccountId: string; settings: any } | null>;
  isEnabled(account: { instagramEnabled?: string | null; facebookEnabled?: string | null }): boolean;
  findExistingMessage(mid: string): Promise<unknown>;
  resolveSenderName(settings: any, senderId: string): Promise<string | undefined>;
  storeIncoming(businessAccountId: string, senderId: string, text: string, senderName: string | undefined, mid: string | undefined, message: any): Promise<unknown>;
  storeOutgoing(businessAccountId: string, senderId: string, text: string): Promise<unknown>;
  sendText(settings: any, senderId: string, text: string): Promise<SendResult>;
  sendQuickReply(settings: any, senderId: string, text: string, quickReplies: { content_type: "text"; title: string; payload: string }[]): Promise<SendResult>;
  processFlow(businessAccountId: string, senderId: string, text: string): Promise<FlowResult>;
  createLead(businessAccountId: string, data: { senderId: string; senderName?: string; flowSessionId?: string; extractedData: Record<string, any> }): Promise<unknown>;
  generateAndSendReply(businessAccountId: string, senderId: string, text: string): Promise<{ success: boolean; error?: string }>;
  processComment(settings: any, businessAccountId: string, comment: { commentId: string; commentText: string; commenterId: string; commenterName?: string; postId?: string }): Promise<{ status: string }>;
}

async function getAdapter(platform: MetaPlatform): Promise<Adapter> {
  if (platform === "instagram") {
    const { instagramService } = await import("./instagramService");
    return {
      tag: "[Instagram Webhook]",
      feature: "instagram_webhook",
      findBusiness: (id) => instagramService.findBusinessByIgAccountId(id),
      isEnabled: (a) => a.instagramEnabled === "true",
      findExistingMessage: (mid) => instagramService.findMessageByIgId(mid),
      resolveSenderName: async (settings, senderId) => {
        try {
          const token = instagramService.getDecryptedAccessToken(settings);
          if (!token) return undefined;
          return (await instagramService.getUserProfile(token, senderId))?.username || undefined;
        } catch { return undefined; }
      },
      storeIncoming: (biz, senderId, text, name, mid, message) => instagramService.storeMessage(biz, senderId, text, "incoming", {
        senderUsername: name || undefined,
        igMessageId: mid || undefined,
        messageType: message?.attachments ? "image" : "text",
        mediaUrl: message?.attachments?.[0]?.payload?.url || undefined,
      }),
      storeOutgoing: (biz, senderId, text) => instagramService.storeMessage(biz, senderId, text, "outgoing", { messageType: "text" }),
      sendText: (settings, senderId, text) => instagramService.sendMessage(settings, senderId, text),
      sendQuickReply: (settings, senderId, text, qr) => instagramService.sendQuickReply(settings, senderId, text, qr),
      processFlow: async (biz, senderId, text) => (await import("./instagramFlowService")).instagramFlowService.processMessage(biz, senderId, text),
      createLead: (biz, d) => instagramService.createInstagramLead(biz, {
        senderId: d.senderId, senderUsername: d.senderName, flowSessionId: d.flowSessionId, extractedData: d.extractedData,
      }),
      generateAndSendReply: async (biz, senderId, text) => (await import("./instagramAutoReplyService")).instagramAutoReplyService.generateAndSendReply(biz, senderId, text),
      processComment: async (settings, biz, c) => (await import("./instagramCommentReplyService")).instagramCommentReplyService.processComment(settings, biz, {
        commentId: c.commentId, commentText: c.commentText, commenterId: c.commenterId, commenterUsername: c.commenterName, postId: c.postId,
      }),
    };
  }
  const { facebookService } = await import("./facebookService");
  return {
    tag: "[Facebook Webhook]",
    feature: "facebook_webhook",
    findBusiness: (id) => facebookService.findBusinessByPageId(id),
    isEnabled: (a) => a.facebookEnabled === "true",
    findExistingMessage: (mid) => facebookService.findMessageByFbId(mid),
    resolveSenderName: async (settings, senderId) => {
      try {
        const token = facebookService.getDecryptedAccessToken(settings);
        if (!token) return undefined;
        const profile = await facebookService.getUserProfile(token, senderId);
        return profile?.firstName ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") : undefined;
      } catch { return undefined; }
    },
    storeIncoming: (biz, senderId, text, name, mid, message) => facebookService.storeMessage(biz, senderId, text, "incoming", {
      senderName: name || undefined,
      fbMessageId: mid || undefined,
      messageType: message?.attachments ? "image" : "text",
      mediaUrl: message?.attachments?.[0]?.payload?.url || undefined,
    }),
    storeOutgoing: (biz, senderId, text) => facebookService.storeMessage(biz, senderId, text, "outgoing", { messageType: "text" }),
    sendText: (settings, senderId, text) => facebookService.sendMessage(settings, senderId, text),
    sendQuickReply: (settings, senderId, text, qr) => facebookService.sendQuickReply(settings, senderId, text, qr),
    processFlow: async (biz, senderId, text) => (await import("./facebookFlowService")).facebookFlowService.processMessage(biz, senderId, text),
    createLead: (biz, d) => facebookService.createFacebookLead(biz, {
      senderId: d.senderId, senderName: d.senderName, flowSessionId: d.flowSessionId, extractedData: d.extractedData,
    }),
    generateAndSendReply: async (biz, senderId, text) => (await import("./facebookAutoReplyService")).facebookAutoReplyService.generateAndSendReply(biz, senderId, text),
    processComment: async (settings, biz, c) => (await import("./facebookCommentReplyService")).facebookCommentReplyService.processComment(settings, biz, {
      commentId: c.commentId, commentText: c.commentText, commenterId: c.commenterId, commenterName: c.commenterName, postId: c.postId,
    }),
  };
}

/**
 * Processes one webhook body. Every event is handled independently; the returned promise
 * settles when all of them have (tests await it; the route does not).
 */
export async function processMetaWebhook(platform: MetaPlatform, body: any): Promise<void> {
  const expectedObject = platform === "instagram" ? "instagram" : "page";
  if (!body || body.object !== expectedObject) return;
  const tasks: Promise<void>[] = [];
  for (const entry of body.entry || []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const comment = parseComment(platform, change);
      if (comment) tasks.push(handleComment(platform, entry.id, comment));
    }
    // DMs are queued synchronously, in the order Meta sent them.
    for (const event of entry.messaging || []) {
      const task = dispatchDm(platform, event);
      if (task) tasks.push(task);
    }
  }
  await Promise.all(tasks.map((t) => t.catch((err) => console.error(`[Meta Webhook] ${platform} event error:`, err instanceof Error ? err.message : err))));
}

// ── Direct messages ──────────────────────────────────────────────────────────

function dispatchDm(platform: MetaPlatform, event: any): Promise<void> | null {
  if (!event?.message || !event.sender?.id) return null;
  if (event.message.is_echo) return null;
  const senderId: string = String(event.sender.id);
  const accountId: string | undefined = event.recipient?.id ? String(event.recipient.id) : undefined;
  if (!accountId) return null;
  // The recipient account id maps to exactly one business, so this is a per business +
  // customer key known without a DB lookup (which keeps the queue order = arrival order).
  return dmQueue.run(`${platform}:${accountId}:${senderId}`, () => handleDm(platform, accountId, senderId, event));
}

async function handleDm(platform: MetaPlatform, accountId: string, senderId: string, event: any): Promise<void> {
  const a = await getAdapter(platform);
  const messageText: string = event.message?.text || "";
  const mid: string | undefined = event.message?.mid || undefined;

  console.log(`${a.tag} Incoming DM from ${senderId} (${messageText.length} chars${event.message?.attachments ? ", with attachment" : ""})`);

  const businessData = await a.findBusiness(accountId);
  if (!businessData) {
    console.warn(`${a.tag} No business found for account ${accountId}`);
    return;
  }
  const { businessAccountId, settings } = businessData;

  if (mid) {
    const fresh = await webhookIdempotency.claim(businessAccountId, platform, mid, "inbound", true);
    if (!fresh) {
      console.log(`${a.tag} Duplicate message ${mid} - skipping`);
      return;
    }
  }

  let stored = false;
  try {
    // Messages stored before the persistent claim existed.
    if (mid && await a.findExistingMessage(mid)) {
      console.log(`${a.tag} Message ${mid} already stored - skipping`);
      await webhookIdempotency.markProcessed(businessAccountId, platform, mid);
      return;
    }

    const senderName = await a.resolveSenderName(settings, senderId);
    await a.storeIncoming(businessAccountId, senderId, messageText, senderName, mid, event.message);
    stored = true;

    if (messageText) {
      await runWithContext({ businessAccountId, feature: a.feature }, () =>
        handleDmText(platform, a, businessAccountId, settings, senderId, senderName, messageText));
    }
  } catch (err) {
    console.error(`${a.tag} Error handling DM ${mid || "(no id)"}:`, err instanceof Error ? err.message : err);
    // Nothing was stored: forget the claim so a redelivery is processed. Once the message
    // is stored (and possibly answered), replaying it would duplicate it — keep it handled.
    if (mid && !stored) {
      await webhookIdempotency.release(businessAccountId, platform, mid);
      return;
    }
  }
  if (mid) await webhookIdempotency.markProcessed(businessAccountId, platform, mid);
}

async function handleDmText(
  platform: MetaPlatform,
  a: Adapter,
  businessAccountId: string,
  settings: any,
  senderId: string,
  senderName: string | undefined,
  messageText: string,
): Promise<void> {
  const businessAccount = await db.query.businessAccounts.findFirst({ where: eq(businessAccounts.id, businessAccountId) });
  if (!businessAccount || !a.isEnabled(businessAccount as any)) return;

  if (isInboundLimited(platform, a, businessAccountId, settings, senderId, messageText)) return;

  let flowResult: FlowResult | null = null;
  try {
    flowResult = await a.processFlow(businessAccountId, senderId, messageText);
  } catch (flowError) {
    console.error(`${a.tag} Flow processing error:`, flowError instanceof Error ? flowError.message : flowError);
  }

  if (flowResult?.handled && flowResult.response) {
    const response = flowResult.response;
    const sendResult = response.type === "buttons" && response.buttons && response.buttons.length > 0
      ? await a.sendQuickReply(settings, senderId, response.text, response.buttons.map((b) => ({ content_type: "text" as const, title: b.title, payload: b.id })))
      : await a.sendText(settings, senderId, response.text);
    if (sendResult.success) await a.storeOutgoing(businessAccountId, senderId, response.text);

    if (flowResult.flowCompleted && flowResult.collectedData && Object.keys(flowResult.collectedData).length > 0) {
      try {
        if (settings.leadCaptureEnabled === "true") {
          await a.createLead(businessAccountId, {
            senderId,
            senderName: senderName || undefined,
            flowSessionId: flowResult.sessionId || undefined,
            extractedData: flowResult.collectedData,
          });
          console.log(`${a.tag} Lead created from flow completion for sender ${senderId}`);
        }
      } catch (leadError) {
        console.error(`${a.tag} Error creating lead from flow:`, leadError instanceof Error ? leadError.message : leadError);
      }
    }
    return;
  }

  const wantsAi = !flowResult || flowResult.shouldFallbackToAI || !flowResult.handled;
  if (wantsAi && settings.autoReplyEnabled === "true") {
    // Awaited inside the per-customer queue: the next message from this customer waits
    // for this reply. A failed AI answer sends the customer a short notice (auto-reply service).
    try {
      const result = await a.generateAndSendReply(businessAccountId, senderId, messageText);
      if (!result.success) console.log(`${a.tag} Auto-reply not sent: ${result.error}`);
    } catch (err) {
      console.error(`${a.tag} Auto-reply error:`, err instanceof Error ? err.message : err);
    }
  }
}

// Spam / bot-loop protection (same rules as WhatsApp). Opt-out words always get through.
// Returns true when the message must not be processed.
function isInboundLimited(platform: MetaPlatform, a: Adapter, businessAccountId: string, settings: any, senderId: string, text: string): boolean {
  if (/\b(stop|unsubscribe|opt[-\s]?out)\b/i.test(text || "")) return false;
  const decision = inboundMessageLimiter.check(`${platform}:${businessAccountId}:${senderId}`, text || "");
  if (decision.allowed) return false;
  console.log(`${a.tag} Inbound limit (${decision.reason}) for ${senderId} until ${new Date(decision.until).toISOString()} — not processing`);
  if (decision.notify) {
    a.sendText(settings, senderId, RATE_LIMIT_NOTICE)
      .then(async (r) => {
        if (r.success) await a.storeOutgoing(businessAccountId, senderId, RATE_LIMIT_NOTICE);
        else console.error(`${a.tag} Limit notice not sent: ${r.error}`);
      })
      .catch((err) => console.error(`${a.tag} Limit notice error:`, err instanceof Error ? err.message : err));
  }
  return true;
}

// ── Comments ─────────────────────────────────────────────────────────────────

interface ParsedComment { commentId: string; commentText: string; commenterId: string; commenterName?: string; postId?: string }

function parseComment(platform: MetaPlatform, change: any): ParsedComment | null {
  const v = change?.value;
  if (!v) return null;
  let parsed: Partial<ParsedComment>;
  if (platform === "instagram") {
    if (change.field !== "comments") return null;
    parsed = { commentId: v.id, commentText: v.text || "", commenterId: v.from?.id, commenterName: v.from?.username, postId: v.media?.id };
  } else {
    if (change.field !== "feed" || v.item !== "comment" || v.verb !== "add") return null;
    parsed = { commentId: v.comment_id, commentText: v.message || "", commenterId: v.from?.id, commenterName: v.from?.name, postId: v.post_id };
  }
  if (!parsed.commentId || !parsed.commentText || !parsed.commenterId) {
    console.warn(`[Meta Webhook] ${platform}: incomplete comment data - skipping`);
    return null;
  }
  return {
    commentId: String(parsed.commentId),
    commentText: parsed.commentText,
    commenterId: String(parsed.commenterId),
    commenterName: parsed.commenterName,
    postId: parsed.postId ? String(parsed.postId) : undefined,
  };
}

async function handleComment(platform: MetaPlatform, entryId: string | undefined, c: ParsedComment): Promise<void> {
  const a = await getAdapter(platform);
  console.log(`${a.tag} Incoming comment ${c.commentId} from ${c.commenterId} (${c.commentText.length} chars)`);
  if (!entryId) return;

  // Our own account's comments (including our replies echoed back) are never answered.
  if (c.commenterId === String(entryId)) {
    console.log(`${a.tag} Comment ${c.commentId} is from our own account - ignoring`);
    return;
  }

  const businessData = await a.findBusiness(String(entryId));
  if (!businessData) {
    console.warn(`${a.tag} No business found for account (comment): ${entryId}`);
    return;
  }
  const { businessAccountId, settings } = businessData;

  const account = await db.query.businessAccounts.findFirst({ where: eq(businessAccounts.id, businessAccountId) });
  if (!account || !a.isEnabled(account as any)) {
    console.warn(`${a.tag} ${platform} not enabled for business ${businessAccountId} - skipping comment`);
    return;
  }

  const providerId = `comment:${c.commentId}`;
  const fresh = await webhookIdempotency.claim(businessAccountId, platform, providerId, "comment", true);
  if (!fresh) {
    console.log(`${a.tag} Duplicate comment ${c.commentId} - skipping`);
    return;
  }
  try {
    await runWithContext({ businessAccountId, feature: a.feature }, () => a.processComment(settings, businessAccountId, c));
  } catch (err) {
    // processComment records its own failures; an exception means it didn't get that far.
    console.error(`${a.tag} Comment reply error:`, err instanceof Error ? err.message : err);
    await webhookIdempotency.release(businessAccountId, platform, providerId);
    return;
  }
  await webhookIdempotency.markProcessed(businessAccountId, platform, providerId);
}
