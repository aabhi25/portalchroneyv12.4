import { db } from "../db";
import { instagramSettings, instagramComments, businessAccounts, widgetSettings } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { vectorSearchService } from "./vectorSearchService";
import { faqEmbeddingService } from "./faqEmbeddingService";
import { businessContextCache } from "./businessContextCache";
import { instagramService } from "./instagramService";
import { storage } from "../storage";
import type { InstagramSettings } from "@shared/schema";
import OpenAI from "openai";

interface CommentData {
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterUsername?: string;
  postId?: string;
}

export class InstagramCommentReplyService {

  async processComment(
    settings: InstagramSettings,
    businessAccountId: string,
    commentData: CommentData
  ): Promise<{ success: boolean; reply?: string; error?: string; status: string }> {
    try {
      console.log(`[Instagram Comment Reply] Processing comment ${commentData.commentId} from @${commentData.commenterUsername || commentData.commenterId}`);

      if (settings.commentAutoReplyEnabled !== "true") {
        console.log(`[Instagram Comment Reply] Comment auto-reply disabled for business: ${businessAccountId}`);
        await this.storeComment(businessAccountId, commentData, null, null, "skipped");
        return { success: false, error: "Comment auto-reply is disabled", status: "skipped" };
      }

      if (settings.commentIgnoreOwnReplies === "true" && settings.igAccountId) {
        if (commentData.commenterId === settings.igAccountId) {
          console.log(`[Instagram Comment Reply] Ignoring own comment from account ${settings.igAccountId}`);
          return { success: false, error: "Own comment ignored", status: "skipped" };
        }
      }

      const existing = await this.findCommentByIgId(businessAccountId, commentData.commentId);
      if (existing) {
        console.log(`[Instagram Comment Reply] Duplicate comment ${commentData.commentId} - skipping`);
        return { success: false, error: "Duplicate comment", status: "skipped" };
      }

      if (settings.commentReplyMode === "keyword_only") {
        const keywords = this.getKeywords(settings);
        if (keywords.length > 0) {
          const commentLower = commentData.commentText.toLowerCase();
          const matched = keywords.some(kw => commentLower.includes(kw.toLowerCase()));
          if (!matched) {
            console.log(`[Instagram Comment Reply] No keyword match for comment: "${commentData.commentText.substring(0, 50)}..."`);
            await this.storeComment(businessAccountId, commentData, null, null, "skipped");
            return { success: false, error: "No keyword match", status: "skipped" };
          }
          console.log(`[Instagram Comment Reply] Keyword match found in comment`);
        }
      }

      if (commentData.postId && settings.commentMaxRepliesPerPost) {
        const maxReplies = parseInt(settings.commentMaxRepliesPerPost, 10) || 50;
        const currentCount = await this.getReplyCountForPost(businessAccountId, commentData.postId);
        if (currentCount >= maxReplies) {
          console.log(`[Instagram Comment Reply] Max replies (${maxReplies}) reached for post ${commentData.postId}`);
          await this.storeComment(businessAccountId, commentData, null, null, "skipped");
          return { success: false, error: "Max replies per post reached", status: "skipped" };
        }
      }

      await this.storeComment(businessAccountId, commentData, null, null, "pending");

      const businessAccount = await db.query.businessAccounts.findFirst({
        where: eq(businessAccounts.id, businessAccountId)
      });

      if (!businessAccount) {
        await this.updateCommentStatus(businessAccountId, commentData.commentId, "failed", null, null);
        return { success: false, error: "Business account not found", status: "failed" };
      }

      const apiKey = businessAccount.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        await this.updateCommentStatus(businessAccountId, commentData.commentId, "failed", null, null);
        return { success: false, error: "No OpenAI API key configured", status: "failed" };
      }

      const [businessContext, postContext] = await Promise.all([
        this.buildBusinessContext(businessAccountId, commentData.commentText),
        this.resolvePostContext(settings, businessAccountId, commentData.postId, commentData.commentText, apiKey)
      ]);

      const delay = parseInt(settings.commentReplyDelay || "5", 10) * 1000;
      if (delay > 0) {
        console.log(`[Instagram Comment Reply] Waiting ${delay / 1000}s before replying...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const aiReply = await this.generateCommentReply(
        apiKey,
        commentData.commentText,
        businessContext,
        businessAccount.name || "the business",
        commentData.commenterUsername,
        postContext
      );

      if (!aiReply) {
        await this.updateCommentStatus(businessAccountId, commentData.commentId, "failed", null, null);
        return { success: false, error: "Failed to generate AI response", status: "failed" };
      }

      const replyResult = await instagramService.replyToComment(settings, commentData.commentId, aiReply);

      if (!replyResult.success) {
        console.error(`[Instagram Comment Reply] Failed to post reply: ${replyResult.error}`);
        await this.updateCommentStatus(businessAccountId, commentData.commentId, "failed", aiReply, null);
        return { success: false, error: replyResult.error, status: "failed" };
      }

      await this.updateCommentStatus(businessAccountId, commentData.commentId, "replied", aiReply, replyResult.commentId || null);

      console.log(`[Instagram Comment Reply] Successfully replied to comment ${commentData.commentId}`);

      await this.tryAutoDm(settings, businessAccountId, commentData, businessContext, businessAccount.name || "the business", postContext, apiKey);

      return { success: true, reply: aiReply, status: "replied" };

    } catch (error) {
      console.error(`[Instagram Comment Reply] Error:`, error);
      try {
        await this.updateCommentStatus(businessAccountId, commentData.commentId, "failed", null, null);
      } catch {}
      return { success: false, error: error instanceof Error ? error.message : "Unknown error", status: "failed" };
    }
  }

  private getKeywords(settings: InstagramSettings): string[] {
    if (!settings.commentTriggerKeywords) return [];
    try {
      const keywords = settings.commentTriggerKeywords;
      if (Array.isArray(keywords)) return keywords as string[];
      if (typeof keywords === "string") return JSON.parse(keywords);
      return [];
    } catch {
      return [];
    }
  }

  private async storeComment(
    businessAccountId: string,
    commentData: CommentData,
    replyText: string | null,
    replyCommentId: string | null,
    status: string
  ): Promise<void> {
    await db.insert(instagramComments).values({
      businessAccountId,
      postId: commentData.postId || null,
      commentId: commentData.commentId,
      commentText: commentData.commentText,
      commenterUsername: commentData.commenterUsername || null,
      commenterId: commentData.commenterId || null,
      replyText,
      replyCommentId,
      status,
    });
  }

  private async findCommentByIgId(businessAccountId: string, commentId: string) {
    const [existing] = await db
      .select()
      .from(instagramComments)
      .where(
        and(
          eq(instagramComments.businessAccountId, businessAccountId),
          eq(instagramComments.commentId, commentId)
        )
      )
      .limit(1);
    return existing || null;
  }

  private async updateCommentStatus(
    businessAccountId: string,
    commentId: string,
    status: string,
    replyText: string | null,
    replyCommentId: string | null
  ): Promise<void> {
    const updateData: any = { status };
    if (replyText !== null) updateData.replyText = replyText;
    if (replyCommentId !== null) updateData.replyCommentId = replyCommentId;

    await db
      .update(instagramComments)
      .set(updateData)
      .where(
        and(
          eq(instagramComments.businessAccountId, businessAccountId),
          eq(instagramComments.commentId, commentId)
        )
      );
  }

  private async getReplyCountForPost(businessAccountId: string, postId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(instagramComments)
      .where(
        and(
          eq(instagramComments.businessAccountId, businessAccountId),
          eq(instagramComments.postId, postId),
          eq(instagramComments.status, "replied")
        )
      );
    return result?.count || 0;
  }

  private async buildBusinessContext(
    businessAccountId: string,
    commentText: string
  ): Promise<string> {
    let context = "";

    try {
      const cacheKey = `ig_comment_context_${businessAccountId}`;
      const cachedContext = await businessContextCache.getOrFetch(cacheKey, async () => {
        let staticContext = "";

        const [businessAccount, widgetSettingArr, trainingDocs] = await Promise.all([
          db.query.businessAccounts.findFirst({
            where: eq(businessAccounts.id, businessAccountId)
          }),
          db.select().from(widgetSettings).where(eq(widgetSettings.businessAccountId, businessAccountId)).limit(1),
          storage.getTrainingDocuments(businessAccountId)
        ]);

        if (businessAccount?.description) {
          staticContext += `BUSINESS OVERVIEW:\n${businessAccount.description}\n\n`;
        }

        if (trainingDocs && trainingDocs.length > 0) {
          const docSummaries = trainingDocs
            .slice(0, 5)
            .map(doc => `- ${doc.title}: ${(doc.content || "").substring(0, 500)}`)
            .join("\n");
          staticContext += `TRAINING DOCUMENTS:\n${docSummaries}\n\n`;
        }

        return staticContext;
      }, 300000);

      context = cachedContext || "";

      try {
        const searchResults = await vectorSearchService.search(businessAccountId, commentText, 3);
        if (searchResults && searchResults.length > 0) {
          context += "\nRELEVANT INFORMATION:\n";
          for (const result of searchResults) {
            context += `- ${result.content?.substring(0, 300) || ""}\n`;
          }
        }
      } catch {}

      try {
        const faqResults = await faqEmbeddingService.searchFAQs(businessAccountId, commentText, 3);
        if (faqResults && faqResults.length > 0) {
          context += "\nRELEVANT FAQs:\n";
          for (const faq of faqResults) {
            context += `Q: ${faq.question}\nA: ${faq.answer}\n\n`;
          }
        }
      } catch {}

    } catch (error) {
      console.error("[Instagram Comment Reply] Error building context:", error);
    }

    return context;
  }

  private isAmbiguousComment(commentText: string): boolean {
    const text = commentText.toLowerCase().trim();
    const ambiguousPatterns = [
      /^(what|how|why|where|when|which)\b/,
      /\b(how much|price|cost|rate|kitna|kya hai|ye kya|what is this|what does|what's this)\b/,
      /\b(details|info|information|tell me more|explain|meaning)\b/,
      /^.{0,5}$/,
      /^[\p{Emoji}\s]+$/u,
      /^\d+$/,
      /^(nice|wow|love|beautiful|amazing|great|good|awesome|superb|best|fab|lovely)[\s!.]*$/i,
      /^(interested|available|dm|inbox)\b/i,
    ];
    return ambiguousPatterns.some(p => p.test(text));
  }

  private async runVisionAnalysis(mediaUrl: string, apiKey: string, postId: string): Promise<string> {
    try {
      console.log(`[Instagram Comment Reply] Running vision analysis for post ${postId}`);
      const openai = new OpenAI({ apiKey });
      const visionResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Describe this image in 2-3 sentences. Focus on what is shown (products, designs, scenes) and any text visible in the image. Be specific and factual.',
              },
              {
                type: 'image_url',
                image_url: { url: mediaUrl, detail: 'low' },
              },
            ],
          },
        ],
        max_tokens: 150,
      });
      const description = visionResponse.choices[0]?.message?.content?.trim() || '';
      if (description) {
        console.log(`[Instagram Comment Reply] Vision description: ${description.substring(0, 80)}...`);
      }
      return description;
    } catch (visionErr) {
      console.error('[Instagram Comment Reply] Vision analysis failed (non-fatal):', visionErr);
      return '';
    }
  }

  private buildPostContextString(
    postData: { caption: string; mediaType: string; permalink: string | null },
    visualDescription: string
  ): string {
    const contextParts = ['POST CONTEXT (this comment is on the following Instagram post):'];
    if (postData.caption) {
      contextParts.push(`Caption: "${postData.caption}"`);
    }
    contextParts.push(`Media Type: ${postData.mediaType}`);
    if (visualDescription) {
      contextParts.push(`Visual Description: "${visualDescription}"`);
    }
    if (postData.permalink) {
      contextParts.push(`Permalink: ${postData.permalink}`);
    }
    return contextParts.join('\n');
  }

  private async resolvePostContext(
    settings: InstagramSettings,
    businessAccountId: string,
    postId: string | undefined,
    commentText: string,
    apiKey: string
  ): Promise<string | null> {
    if (!postId) {
      console.log('[Instagram Comment Reply] No postId available — skipping post context');
      return null;
    }

    try {
      const postDataCacheKey = `ig-postdata:${businessAccountId}:${postId}`;
      const postData = await businessContextCache.getOrFetch(postDataCacheKey, async () => {
        return await instagramService.getPostContext(settings, postId);
      }, 1800000);

      if (!postData) return null;

      const needsVision = (!postData.caption || postData.caption.length < 20) || this.isAmbiguousComment(commentText);
      const canRunVision = postData.mediaUrl && (postData.mediaType === 'IMAGE' || postData.mediaType === 'CAROUSEL_ALBUM');

      if (needsVision && canRunVision) {
        const visionCacheKey = `ig-postvision:${businessAccountId}:${postId}`;
        const visualDescription = await businessContextCache.getOrFetch(visionCacheKey, async () => {
          return await this.runVisionAnalysis(postData.mediaUrl!, apiKey, postId);
        }, 1800000);

        return this.buildPostContextString(postData, visualDescription || '');
      }

      return this.buildPostContextString(postData, '');
    } catch (error) {
      console.error('[Instagram Comment Reply] Error resolving post context (non-fatal):', error);
      return null;
    }
  }

  private async generateCommentReply(
    apiKey: string,
    commentText: string,
    businessContext: string,
    businessName: string,
    commenterUsername?: string,
    postContext?: string | null
  ): Promise<string | null> {
    try {
      const openai = new OpenAI({ apiKey });

      const systemPrompt = `You are a social media assistant for "${businessName}". You reply to public Instagram comments on behalf of the business.

IMPORTANT GUIDELINES:
- Keep replies SHORT (1-3 sentences max) — this is a public comment, not a DM
- Be warm, professional, and brand-appropriate
- Never share sensitive business details publicly
- If the comment asks detailed questions, invite them to DM for more info
- Use a natural, conversational tone — avoid sounding robotic
- Do NOT use hashtags unless the brand typically does
- Do NOT start with "Hi [name]!" every time — vary your openings
- If the comment is just an emoji or a simple "nice", keep your reply equally brief
- If the comment is negative or a complaint, be empathetic and offer to help via DM
- Never argue or be defensive
- LANGUAGE MATCHING: Always reply in the same language the commenter used. If they write in Hinglish (mix of Hindi and English), reply in Hinglish. If they write in Hindi, reply in Hindi. If they write in any other language, match that language. Only default to English if the comment is clearly in English.
${postContext ? `\n${postContext}\n\nIMPORTANT: Use the POST CONTEXT above to understand what the post is about. If the comment asks about price, meaning, details, or refers to "this" or "it", ground your reply in the post content. Reference the post's subject naturally.` : ''}
${businessContext ? `\nBUSINESS CONTEXT:\n${businessContext}` : ""}`;

      const userPrompt = commenterUsername
        ? `Instagram user @${commenterUsername} commented: "${commentText}"\n\nWrite a brief, appropriate reply.`
        : `Someone commented: "${commentText}"\n\nWrite a brief, appropriate reply.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error("[Instagram Comment Reply] AI generation error:", error);
      return null;
    }
  }
  private getDmKeywords(settings: InstagramSettings): string[] {
    if (!(settings as any).commentDmTriggerKeywords) return [];
    try {
      const keywords = (settings as any).commentDmTriggerKeywords;
      if (Array.isArray(keywords)) return keywords as string[];
      if (typeof keywords === "string") return JSON.parse(keywords);
      return [];
    } catch {
      return [];
    }
  }

  private async tryAutoDm(
    settings: InstagramSettings,
    businessAccountId: string,
    commentData: CommentData,
    businessContext: string,
    businessName: string,
    postContext: string | null,
    apiKey: string
  ): Promise<void> {
    try {
      if ((settings as any).commentAutoDmEnabled !== "true") return;
      if (!commentData.commenterId) {
        console.log(`[Instagram Comment DM] No commenter ID — skipping DM`);
        return;
      }

      const dmMode = (settings as any).commentDmMode || "all";
      if (dmMode === "keyword_only") {
        const dmKeywords = this.getDmKeywords(settings);
        if (dmKeywords.length === 0) return;
        const commentLower = commentData.commentText.toLowerCase();
        const matched = dmKeywords.some(kw => commentLower.includes(kw.toLowerCase()));
        if (!matched) {
          console.log(`[Instagram Comment DM] No DM keyword match — skipping`);
          return;
        }
      }

      const dmTemplate = (settings as any).commentDmTemplate || "";
      const dmText = await this.generateDmMessage(apiKey, commentData.commentText, businessContext, businessName, commentData.commenterUsername, postContext, dmTemplate);

      if (!dmText) {
        console.log(`[Instagram Comment DM] Failed to generate DM`);
        await this.updateCommentDmStatus(businessAccountId, commentData.commentId, "failed", null);
        return;
      }

      const result = await instagramService.sendMessage(settings, commentData.commenterId, dmText);

      if (result.success) {
        console.log(`[Instagram Comment DM] Sent DM to ${commentData.commenterUsername || commentData.commenterId}`);
        await this.updateCommentDmStatus(businessAccountId, commentData.commentId, "sent", dmText);
      } else {
        console.error(`[Instagram Comment DM] Failed: ${result.error}`);
        await this.updateCommentDmStatus(businessAccountId, commentData.commentId, "failed", dmText);
      }
    } catch (error) {
      console.error(`[Instagram Comment DM] Error:`, error);
      try {
        await this.updateCommentDmStatus(businessAccountId, commentData.commentId, "failed", null);
      } catch {}
    }
  }

  private async updateCommentDmStatus(
    businessAccountId: string,
    commentId: string,
    dmStatus: string,
    dmText: string | null
  ): Promise<void> {
    const updateData: any = { dmStatus };
    if (dmText !== null) updateData.dmText = dmText;
    await db
      .update(instagramComments)
      .set(updateData)
      .where(
        and(
          eq(instagramComments.businessAccountId, businessAccountId),
          eq(instagramComments.commentId, commentId)
        )
      );
  }

  private async generateDmMessage(
    apiKey: string,
    commentText: string,
    businessContext: string,
    businessName: string,
    commenterUsername?: string,
    postContext?: string | null,
    dmTemplate?: string
  ): Promise<string | null> {
    try {
      const openai = new OpenAI({ apiKey });

      const systemPrompt = `You are a helpful assistant for "${businessName}". A user commented on an Instagram post and you are now sending them a private DM to continue the conversation.

IMPORTANT GUIDELINES:
- Be warm, friendly, and helpful — this is a private message, so you can be more detailed than a public comment
- Reference what they commented about so the DM feels personal and relevant
- Provide useful information, answer their question, or offer to help further
- Keep it concise but informative (2-5 sentences)
- LANGUAGE MATCHING: Always reply in the same language the user commented in. If they write in Hinglish, reply in Hinglish. If Hindi, reply in Hindi.
- Do NOT sound robotic or overly formal
- Do NOT use excessive emojis or hashtags
${dmTemplate ? `\nSPECIAL INSTRUCTIONS FOR DM:\n${dmTemplate}` : ""}
${postContext ? `\n${postContext}` : ""}
${businessContext ? `\nBUSINESS CONTEXT:\n${businessContext}` : ""}`;

      const userPrompt = commenterUsername
        ? `Instagram user @${commenterUsername} commented on our post: "${commentText}"\n\nWrite a friendly private DM to send them.`
        : `Someone commented on our post: "${commentText}"\n\nWrite a friendly private DM to send them.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error("[Instagram Comment DM] AI generation error:", error);
      return null;
    }
  }
}

export const instagramCommentReplyService = new InstagramCommentReplyService();
