import OpenAI from "openai";
import { db } from "../db";
import {
  marketingCampaigns,
  marketingCampaignRecipients,
  marketingCampaignMessages,
  whatsappTemplates,
  faqs,
  trainingDocuments,
  products,
  businessAccounts,
  type MarketingCampaign,
  type ReplyClassification,
} from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { safeDecrypt } from "./encryptionService";
import { marketingCampaignService } from "./marketingCampaignService";

interface BuildContextOptions {
  campaign: MarketingCampaign;
  businessAccountId: string;
}

async function buildKnowledgeContext({ campaign, businessAccountId }: BuildContextOptions): Promise<string> {
  const blocks: string[] = [];

  if (campaign.aiUseFaqs === "true") {
    const faqRows = await db
      .select({ question: faqs.question, answer: faqs.answer })
      .from(faqs)
      .where(eq(faqs.businessAccountId, businessAccountId))
      .limit(40);
    if (faqRows.length > 0) {
      blocks.push(
        "FAQS:\n" +
          faqRows
            .map(f => `Q: ${f.question}\nA: ${f.answer}`)
            .join("\n\n")
      );
    }
  }

  if (campaign.aiUseDocs === "true") {
    const allowedIds = (campaign.aiKnowledgeDocIds || []) as string[];
    const docRows = await db
      .select({
        id: trainingDocuments.id,
        title: trainingDocuments.originalFilename,
        summary: trainingDocuments.summary,
        content: trainingDocuments.extractedText,
      })
      .from(trainingDocuments)
      .where(
        allowedIds.length > 0
          ? and(eq(trainingDocuments.businessAccountId, businessAccountId), inArray(trainingDocuments.id, allowedIds))
          : eq(trainingDocuments.businessAccountId, businessAccountId)
      )
      .limit(allowedIds.length > 0 ? allowedIds.length : 8);
    if (docRows.length > 0) {
      blocks.push(
        "TRAINING DOCS:\n" +
          docRows
            .map(d => {
              const body = (d.content || d.summary || "").toString();
              return `# ${d.title || "Doc"}\n${body.substring(0, 4000)}`;
            })
            .join("\n---\n")
      );
    }
  }

  if (campaign.aiUseProducts === "true") {
    const productRows = await db
      .select({
        name: products.name,
        description: products.description,
        price: products.price,
      })
      .from(products)
      .where(eq(products.businessAccountId, businessAccountId))
      .limit(30);
    if (productRows.length > 0) {
      blocks.push(
        "PRODUCT CATALOG (for offers and recommendations):\n" +
          productRows
            .map(p => `- ${p.name}${p.price ? ` (₹${p.price})` : ""}${p.description ? `: ${(p.description || "").substring(0, 200)}` : ""}`)
            .join("\n")
      );
    }
  }

  return blocks.join("\n\n=========\n\n");
}

export interface CampaignAiReply {
  text: string;
  blockedReason?: string;
}

export interface ClassificationResult {
  primaryClassification: string | null;
  dispositionData: Record<string, string>;
  callbackRequired: boolean;
  callbackReason: string | null;
  customerFeedback: string | null;
}

/**
 * Render the recipient's imported attributes as grounding context.
 *
 * `attributes` is whatever the operator imported — loan fields for a lender,
 * appointment fields for a clinic, order fields for a retailer. Injecting it
 * verbatim is what lets one prompt serve every vertical: the agent answers
 * from the row it was given, and is told explicitly not to go beyond it.
 */
function buildRecipientContext(attributes: Record<string, string> | null | undefined): string {
  if (!attributes) return "";
  const entries = Object.entries(attributes).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "");
  if (entries.length === 0) return "";
  return [
    "RECIPIENT DETAILS (this specific customer's data — answer only from these values):",
    ...entries.map(([k, v]) => `${k}: ${v}`),
    "",
    "Rules for using these details:",
    "- Quote these values exactly when asked. Never recalculate, estimate or round them.",
    "- If asked something these details do not cover, reply: \"I don't have that information available here — our team will follow up with you.\" Never guess or invent an answer.",
    "- Never reveal details belonging to any other customer.",
    "- Do not promise any outcome, exception or concession that is not explicitly stated above or in the knowledge base.",
  ].join("\n");
}

/**
 * Second LLM pass: classify the customer's inbound message into one of the
 * campaign's configured categories and extract that category's capture fields.
 *
 * Returns null when the campaign has no classification config (broadcast-only
 * campaigns skip this entirely and pay nothing for it).
 */
async function classifyInboundReply(opts: {
  apiKey: string;
  classifications: ReplyClassification[];
  inboundText: string;
  recipientAttributes: Record<string, string> | null | undefined;
  onTokens: (n: number) => Promise<void>;
}): Promise<ClassificationResult | null> {
  const { apiKey, classifications, inboundText, recipientAttributes, onTokens } = opts;
  if (!classifications || classifications.length === 0) return null;

  const categoryLines = classifications
    .map(c => {
      const fields = (c.captureFields || [])
        .map(f => `      - ${f.fieldKey} (${f.fieldType}): ${f.fieldLabel}`)
        .join("\n");
      return `- ${c.key} — ${c.label}: ${c.description}${fields ? `\n    Extract when this category applies:\n${fields}` : ""}`;
    })
    .join("\n");

  const contextBlock = buildRecipientContext(recipientAttributes);

  const system = [
    "You classify a customer's WhatsApp reply into exactly one business outcome category.",
    "",
    "AVAILABLE CATEGORIES:",
    categoryLines,
    "",
    contextBlock ? `For context, the customer's record:\n${contextBlock}\n` : "",
    "Respond with JSON only, matching this shape:",
    "{",
    '  "primary_classification": "<one category key from the list above, or null if the message carries no meaningful business signal>",',
    '  "disposition_data": { "<capture field key>": "<extracted value>" },',
    '  "callback_required": <true if the customer asked for a human, or asked something the record above cannot answer>,',
    '  "callback_reason": "<short reason if callback_required, else null>",',
    '  "customer_feedback": "<one-line paraphrase of what the customer actually said>"',
    "}",
    "",
    "Rules:",
    "- Use only category keys from the list. Never invent a new key.",
    "- Dates in disposition_data must be ISO format (YYYY-MM-DD). Resolve relative dates ('tomorrow', 'next Friday') against today's date.",
    "- Omit capture fields you cannot determine — do not fill them with guesses or placeholders.",
    "- Greetings, acknowledgements and emoji-only replies carry no business signal: return null for primary_classification.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const openai = new OpenAI({ apiKey, timeout: 20000 });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Today's date is ${new Date().toISOString().slice(0, 10)}.\n\nCustomer's message:\n${inboundText.substring(0, 2000)}`,
        },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    await onTokens(completion.usage?.total_tokens ?? 0);

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // Only accept a key the campaign actually defines — the model can hallucinate
    // a plausible-looking category, and an unknown key would silently vanish from
    // every dashboard tally that groups by the configured list.
    const validKeys = new Set(classifications.map(c => c.key));
    const claimed = typeof parsed.primary_classification === "string" ? parsed.primary_classification : null;
    const primaryClassification = claimed && validKeys.has(claimed) ? claimed : null;
    if (claimed && !primaryClassification) {
      console.warn(`[CampaignAI] Classifier returned unknown category "${claimed}" — storing as unclassified`);
    }

    // Keep only capture fields declared on the matched category, so dispositionData
    // never accumulates stray keys the dashboard and sheet export don't know about.
    const allowedFields = new Set(
      (classifications.find(c => c.key === primaryClassification)?.captureFields || []).map(f => f.fieldKey)
    );
    const dispositionData: Record<string, string> = {};
    if (parsed.disposition_data && typeof parsed.disposition_data === "object") {
      for (const [k, v] of Object.entries(parsed.disposition_data)) {
        if (allowedFields.has(k) && v !== null && v !== undefined && String(v).trim() !== "") {
          dispositionData[k] = String(v).trim();
        }
      }
    }

    return {
      primaryClassification,
      dispositionData,
      callbackRequired: parsed.callback_required === true,
      callbackReason: typeof parsed.callback_reason === "string" && parsed.callback_reason.trim()
        ? parsed.callback_reason.trim().substring(0, 500)
        : null,
      customerFeedback: typeof parsed.customer_feedback === "string" && parsed.customer_feedback.trim()
        ? parsed.customer_feedback.trim().substring(0, 1000)
        : null,
    };
  } catch (err) {
    // Classification is best-effort: a failure here must never cost the customer
    // their reply, so we log and let the conversation continue unclassified.
    console.error("[CampaignAI] classifyInboundReply error:", err);
    return null;
  }
}

export const campaignAiService = {
  /**
   * Classify one inbound customer reply and persist the outcome.
   *
   * Called fire-and-forget from recordInbound for every inbound message. Exits
   * cheaply (before any LLM spend) when the campaign has no classification
   * config, so broadcast-only campaigns are unaffected.
   */
  async classifyAndStore(campaignId: string, recipientId: string, inboundText: string): Promise<void> {
    try {
      const [campaign] = await db
        .select()
        .from(marketingCampaigns)
        .where(eq(marketingCampaigns.id, campaignId))
        .limit(1);
      if (!campaign) return;

      const classifications = (campaign.replyClassifications || []) as ReplyClassification[];
      if (classifications.length === 0) return; // classification not configured — no spend

      const text = (inboundText || "").trim();
      if (!text) return;

      const budget = await marketingCampaignService.checkClassificationBudget(campaignId);
      if (!budget.allowed) {
        console.log(`[CampaignAI] Skipping classification for ${recipientId}: ${budget.reason}`);
        return;
      }

      const [recipient] = await db
        .select({ attributes: marketingCampaignRecipients.attributes })
        .from(marketingCampaignRecipients)
        .where(eq(marketingCampaignRecipients.id, recipientId))
        .limit(1);
      if (!recipient) return;

      const [biz] = await db
        .select()
        .from(businessAccounts)
        .where(eq(businessAccounts.id, campaign.businessAccountId))
        .limit(1);
      if (!biz) return;

      const apiKey = biz.openaiApiKey ? safeDecrypt(biz.openaiApiKey) : process.env.OPENAI_API_KEY;
      if (!apiKey) return;

      const result = await classifyInboundReply({
        apiKey,
        classifications,
        inboundText: text,
        recipientAttributes: recipient.attributes,
        onTokens: (n) => marketingCampaignService.addAiTokensUsed(campaignId, n),
      });
      if (!result) return;

      await marketingCampaignService.applyClassification(recipientId, result);
      console.log(
        `[CampaignAI] Classified recipient ${recipientId} as ${result.primaryClassification || "unclassified"}` +
          (result.callbackRequired ? " (callback required)" : "")
      );
    } catch (err) {
      console.error("[CampaignAI] classifyAndStore error:", err);
    }
  },

  async generateReply(
    campaignId: string,
    recipientId: string,
    inboundText: string
  ): Promise<CampaignAiReply | null> {
    try {
      const [campaign] = await db
        .select()
        .from(marketingCampaigns)
        .where(eq(marketingCampaigns.id, campaignId))
        .limit(1);
      if (!campaign) return null;
      if (campaign.aiEnabled !== "true") return null;

      const [recipient] = await db
        .select()
        .from(marketingCampaignRecipients)
        .where(eq(marketingCampaignRecipients.id, recipientId))
        .limit(1);
      if (!recipient) return null;

      // ---- Hard guardrails BEFORE any LLM cost ----
      const budget = await marketingCampaignService.checkAiBudget(campaignId, recipientId);
      if (!budget.allowed) {
        console.log(`[CampaignAI] Blocked reply for campaign ${campaignId} recipient ${recipientId}: ${budget.reason}`);
        return { text: "", blockedReason: budget.reason };
      }

      // Inbound payload size cap (defends against giant pasted blocks)
      const inboundClipped = (inboundText || "").substring(0, 2000);

      const [biz] = await db
        .select()
        .from(businessAccounts)
        .where(eq(businessAccounts.id, campaign.businessAccountId))
        .limit(1);
      if (!biz) return null;

      const apiKey = biz.openaiApiKey ? safeDecrypt(biz.openaiApiKey) : process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error("[CampaignAI] No OpenAI API key available for business", biz.id);
        return null;
      }

      const [template] = await db
        .select()
        .from(whatsappTemplates)
        .where(eq(whatsappTemplates.id, campaign.templateId))
        .limit(1);

      const knowledge = await buildKnowledgeContext({
        campaign,
        businessAccountId: campaign.businessAccountId,
      });

      const history = await db
        .select()
        .from(marketingCampaignMessages)
        .where(eq(marketingCampaignMessages.recipientId, recipientId))
        .orderBy(desc(marketingCampaignMessages.createdAt))
        .limit(20);

      const ordered = history.slice().reverse();

      // Default persona is deliberately vertical-neutral. A campaign that is
      // chasing payments, confirming appointments or handling RSVPs all land
      // here when the operator hasn't written a custom prompt, so this must not
      // assume a sales context.
      const persona =
        (campaign.aiSystemPrompt || "").trim() ||
        `You are ${campaign.aiAgentName || "an assistant"} for ${biz.name}, replying to someone who has responded to a WhatsApp message we sent them. Be warm, concise and helpful. Answer using only the recipient details and knowledge below, and finish with a clear next step. Never invent amounts, dates, prices, policies or product details.`;

      const recipientContext = buildRecipientContext(recipient.attributes);

      const systemPrompt = [
        persona,
        "",
        "Channel: WhatsApp. Keep replies short (2-4 sentences). No markdown.",
        "If you genuinely cannot help and the user wants a human, say so briefly and tell them a team member will call back.",
        "Customer name: " + (recipient.name || "(unknown)"),
        "",
        recipientContext,
        template ? `\nThis conversation started from this campaign template:\n${template.bodyText}\n` : "",
        knowledge ? `KNOWLEDGE BASE:\n${knowledge}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
      ];

      for (const m of ordered) {
        if (m.direction === "inbound") {
          messages.push({ role: "user", content: m.body });
        } else if (m.direction === "outbound_ai") {
          messages.push({ role: "assistant", content: m.body });
        } else if (m.direction === "outbound_template") {
          messages.push({ role: "assistant", content: `[Sent campaign template] ${m.body.substring(0, 300)}` });
        }
      }
      messages.push({ role: "user", content: inboundClipped });

      const openai = new OpenAI({ apiKey, timeout: 30000 });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.5,
        max_tokens: 250,
      });

      const text = completion.choices[0]?.message?.content?.trim();
      const usedTokens = completion.usage?.total_tokens ?? 0;
      // Always charge usage (even if no text), so a runaway loop still moves toward the daily cap
      await marketingCampaignService.addAiTokensUsed(campaignId, usedTokens);

      if (!text) return null;
      return { text };
    } catch (err) {
      console.error("[CampaignAI] generateReply error:", err);
      return null;
    }
  },
};
