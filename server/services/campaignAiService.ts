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

export const campaignAiService = {
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

      const persona =
        (campaign.aiSystemPrompt || "").trim() ||
        `You are ${campaign.aiAgentName || "a friendly sales agent"} for ${biz.name}. Your goal is to convert this WhatsApp campaign reply into a booking, demo, or sale. Be warm, concise, and persuasive. Always end with a clear next step. Never invent prices, policies, or product details — use only the knowledge below.`;

      const systemPrompt = [
        persona,
        "",
        "Channel: WhatsApp. Keep replies short (2-4 sentences). No markdown.",
        "If you genuinely cannot help and the user wants a human, say so briefly.",
        "Customer name: " + (recipient.name || "(unknown)"),
        "",
        template ? `This conversation started from this campaign template:\n${template.bodyText}\n` : "",
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
