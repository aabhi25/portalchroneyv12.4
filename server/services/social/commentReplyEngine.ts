/**
 * Comment auto-reply engine shared by Instagram and Facebook (instagramCommentReplyService.ts
 * / facebookCommentReplyService.ts are thin wrappers). Flow per comment: disabled → own
 * comment → duplicate → keyword filter → hourly caps → per-post cap → AI public reply →
 * optional AI private reply (platform-specific Graph call) to the commenter.
 */
import { db } from "../../db";
import { businessAccounts, widgetSettings } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { vectorSearchService } from "../vectorSearchService";
import { faqEmbeddingService } from "../faqEmbeddingService";
import { businessContextCache } from "../businessContextCache";
import { storage } from "../../storage";
import { createOpenAI, OPENAI_TIMEOUTS } from "../../lib/openaiClient";
import { commentReplyLimiter } from "../commentReplyLimiter";
import type { SocialPlatformId } from "./types";
import { appliesToChannel } from "@shared/knowledgeChannels";
import { restrictedReplyLanguage, channelConversationKey, checkReplyLanguage, withoutLanguageNote, type ChannelReplyLanguage } from "../language/channelReplyLanguage";

export interface SocialCommentData {
  commentId: string;
  commentText: string;
  commenterId: string;
  /** IG username (without @) or FB display name. */
  commenterName?: string;
  postId?: string;
}

/** The subset of the settings row this engine reads (same columns on both platforms). */
export interface CommentSettingsLike {
  commentAutoReplyEnabled: string;
  commentReplyMode: string;
  commentTriggerKeywords: unknown;
  commentReplyDelay: string;
  commentMaxRepliesPerPost: string;
  commentAutoDmEnabled?: string;
  commentDmMode?: string;
  commentDmTriggerKeywords?: unknown;
  commentDmTemplate?: string | null;
}

export interface SocialCommentPlatform<S extends CommentSettingsLike> {
  platform: SocialPlatformId;
  /** "Instagram" | "Facebook" — used in logs and prompts. */
  label: string;
  /** Log wording for the self-comment skip: "account" | "page". */
  ownAccountNoun: string;
  /** Our own IG account id / FB page id. */
  ownAccountId(settings: S): string | null | undefined;
  /** comments table (instagram_comments / facebook_comments). */
  commentsTable: any;
  /** Column holding the commenter's display name. */
  commenterNameColumn: "commenterUsername" | "commenterName";
  /** Cache key prefix: "ig" | "fb". */
  cachePrefix: string;
  /** Post media types the vision model can look at (IG: IMAGE/CAROUSEL_ALBUM, FB: photo/album). */
  visionMediaTypes: string[];
  replyToComment(settings: S, commentId: string, text: string): Promise<{ success: boolean; commentId?: string; error?: string }>;
  /** DM tied to the comment (IG recipient.comment_id, FB /private_replies). */
  sendPrivateReply(settings: S, commentId: string, text: string): Promise<{ success: boolean; error?: string }>;
  getPostContext(settings: S, postId: string): Promise<{ caption: string; mediaType: string; mediaUrl: string | null; permalink: string | null } | null>;
  prompts: {
    /** "Instagram post" | "Facebook post" (post context header). */
    postNoun: string;
    /** Label for the post text in the post context: "Caption" | "Post Text". */
    captionLabel: string;
    /** Public-reply guideline for detailed questions. */
    detailedQuestionHint: string;
    /** "@name" style mention for the user prompt. */
    commenterMention(name: string): string;
    /** "an Instagram post" | "a Facebook post". */
    postWithArticle: string;
    /** "DM" | "message" and "private DM" | "private message". */
    dmNoun: string;
    privateDmNoun: string;
  };
}

export class SocialCommentReplyEngine<S extends CommentSettingsLike> {
  constructor(private readonly p: SocialCommentPlatform<S>) {}

  private get tag(): string {
    return `[${this.p.label} Comment Reply]`;
  }

  private get dmTag(): string {
    return `[${this.p.label} Comment DM]`;
  }

  async processComment(
    settings: S,
    businessAccountId: string,
    commentData: SocialCommentData
  ): Promise<{ success: boolean; reply?: string; error?: string; status: string }> {
    try {
      console.log(`${this.tag} Processing comment ${commentData.commentId} from ${commentData.commenterId}`);

      if (settings.commentAutoReplyEnabled !== "true") {
        console.log(`${this.tag} Comment auto-reply disabled for business: ${businessAccountId}`);
        await this.storeComment(businessAccountId, commentData, null, null, "skipped");
        return { success: false, error: "Comment auto-reply is disabled", status: "skipped" };
      }

      // Never answer our own account's comments (including our own auto-replies coming back
      // through the webhook), whatever commentIgnoreOwnReplies says: that would loop forever.
      if (await this.isOwnComment(settings, businessAccountId, commentData)) {
        console.log(`${this.tag} Ignoring comment ${commentData.commentId} from our own ${this.p.ownAccountNoun}`);
        return { success: false, error: "Own comment ignored", status: "skipped" };
      }

      const existing = await this.findComment(businessAccountId, commentData.commentId);
      if (existing) {
        console.log(`${this.tag} Duplicate comment ${commentData.commentId} - skipping`);
        return { success: false, error: "Duplicate comment", status: "skipped" };
      }

      if (settings.commentReplyMode === "keyword_only") {
        const keywords = this.parseKeywords(settings.commentTriggerKeywords);
        if (keywords.length > 0) {
          const commentLower = commentData.commentText.toLowerCase();
          const matched = keywords.some(kw => commentLower.includes(kw.toLowerCase()));
          if (!matched) {
            console.log(`${this.tag} No keyword match for comment ${commentData.commentId}`);
            await this.storeComment(businessAccountId, commentData, null, null, "skipped");
            return { success: false, error: "No keyword match", status: "skipped" };
          }
          console.log(`${this.tag} Keyword match found in comment`);
        }
      }

      const limit = commentReplyLimiter.check(this.p.platform, businessAccountId, commentData.commenterId, commentData.postId);
      if (!limit.allowed) {
        console.log(`${this.tag} Hourly ${limit.reason === "commenter" ? "per-commenter" : "per-post"} reply cap reached — not replying to comment ${commentData.commentId}`);
        await this.storeComment(businessAccountId, commentData, null, null, "skipped");
        return { success: false, error: limit.reason === "commenter" ? "Too many replies to this commenter" : "Too many replies on this post", status: "skipped" };
      }

      if (commentData.postId && settings.commentMaxRepliesPerPost) {
        const maxReplies = parseInt(settings.commentMaxRepliesPerPost, 10) || 50;
        const currentCount = await this.getReplyCountForPost(businessAccountId, commentData.postId);
        if (currentCount >= maxReplies) {
          console.log(`${this.tag} Max replies (${maxReplies}) reached for post ${commentData.postId}`);
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

      // AI reply-language setting: null when this channel follows the commenter (the default) → prompt unchanged.
      const replyLanguage = await restrictedReplyLanguage({
        businessAccountId, channel: this.p.platform,
        conversationKey: channelConversationKey(this.p.platform, businessAccountId, commentData.commenterId, "comment"),
        message: commentData.commentText, apiKey,
      });

      const delay = parseInt(settings.commentReplyDelay || "5", 10) * 1000;
      if (delay > 0) {
        console.log(`${this.tag} Waiting ${delay / 1000}s before replying...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const generated = await this.generateCommentReply(
        apiKey,
        commentData.commentText,
        businessContext,
        businessAccount.name || "the business",
        commentData.commenterName,
        postContext,
        replyLanguage
      );
      // Restricted reply language: rewrite a reply that slipped into another language (no AI call when it matches).
      const aiReply = generated ? await checkReplyLanguage(businessAccountId, generated, replyLanguage) : generated;

      if (!aiReply) {
        await this.updateCommentStatus(businessAccountId, commentData.commentId, "failed", null, null);
        return { success: false, error: "Failed to generate AI response", status: "failed" };
      }

      const replyResult = await this.p.replyToComment(settings, commentData.commentId, aiReply);

      if (!replyResult.success) {
        console.error(`${this.tag} Failed to post reply: ${replyResult.error}`);
        await this.updateCommentStatus(businessAccountId, commentData.commentId, "failed", aiReply, null);
        return { success: false, error: replyResult.error, status: "failed" };
      }

      await this.updateCommentStatus(businessAccountId, commentData.commentId, "replied", aiReply, replyResult.commentId || null);

      console.log(`${this.tag} Successfully replied to comment ${commentData.commentId}`);

      await this.tryAutoDm(settings, businessAccountId, commentData, businessContext, businessAccount.name || "the business", postContext, apiKey, replyLanguage);

      return { success: true, reply: aiReply, status: "replied" };

    } catch (error) {
      console.error(`${this.tag} Error:`, error);
      try {
        await this.updateCommentStatus(businessAccountId, commentData.commentId, "failed", null, null);
      } catch {}
      return { success: false, error: error instanceof Error ? error.message : "Unknown error", status: "failed" };
    }
  }

  private parseKeywords(raw: unknown): string[] {
    if (!raw) return [];
    try {
      if (Array.isArray(raw)) return raw as string[];
      if (typeof raw === "string") return JSON.parse(raw);
      return [];
    } catch {
      return [];
    }
  }

  /** A comment written by our own account / Page, or one of our own replies echoed back. */
  private async isOwnComment(settings: S, businessAccountId: string, commentData: SocialCommentData): Promise<boolean> {
    const ownId = this.p.ownAccountId(settings);
    if (ownId && commentData.commenterId === ownId) return true;
    const t = this.p.commentsTable;
    const [ours] = await db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.businessAccountId, businessAccountId), eq(t.replyCommentId, commentData.commentId)))
      .limit(1);
    return !!ours;
  }

  private async storeComment(
    businessAccountId: string,
    commentData: SocialCommentData,
    replyText: string | null,
    replyCommentId: string | null,
    status: string
  ): Promise<void> {
    await db.insert(this.p.commentsTable).values({
      businessAccountId,
      postId: commentData.postId || null,
      commentId: commentData.commentId,
      commentText: commentData.commentText,
      [this.p.commenterNameColumn]: commentData.commenterName || null,
      commenterId: commentData.commenterId || null,
      replyText: replyText || null,
      replyCommentId: replyCommentId || null,
      status,
    });
  }

  private async findComment(businessAccountId: string, commentId: string) {
    const t = this.p.commentsTable;
    const [existing] = await db
      .select()
      .from(t)
      .where(and(eq(t.businessAccountId, businessAccountId), eq(t.commentId, commentId)))
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
    await this.updateComment(businessAccountId, commentId, updateData);
  }

  private async updateComment(businessAccountId: string, commentId: string, updateData: Record<string, unknown>): Promise<void> {
    const t = this.p.commentsTable;
    await db
      .update(t)
      .set(updateData)
      .where(and(eq(t.businessAccountId, businessAccountId), eq(t.commentId, commentId)));
  }

  private async getReplyCountForPost(businessAccountId: string, postId: string): Promise<number> {
    const t = this.p.commentsTable;
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(t)
      .where(and(eq(t.businessAccountId, businessAccountId), eq(t.postId, postId), eq(t.status, "replied")));
    return result?.count || 0;
  }

  private async buildBusinessContext(
    businessAccountId: string,
    commentText: string
  ): Promise<string> {
    let context = "";

    try {
      const cacheKey = `${this.p.cachePrefix}_comment_context_${businessAccountId}`;
      const cachedContext = await businessContextCache.getOrFetch(cacheKey, async () => {
        let staticContext = "";

        const [businessAccount, , trainingDocs] = await Promise.all([
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
            .filter(doc => appliesToChannel(doc.channels, this.p.platform))
            .slice(0, 5)
            .filter(doc => doc.summary)
            .map(doc => `- ${doc.originalFilename}: ${(doc.summary || "").substring(0, 500)}`)
            .join("\n");
          staticContext += `TRAINING DOCUMENTS:\n${docSummaries}\n\n`;
        }

        return staticContext;
      }, 300000);

      context = cachedContext || "";

      try {
        const searchResults = await vectorSearchService.search(commentText, businessAccountId, 3, 0.5, this.p.platform);
        if (searchResults && searchResults.length > 0) {
          context += "\nRELEVANT INFORMATION:\n";
          for (const result of searchResults) {
            context += `- ${result.chunkText?.substring(0, 300) || ""}\n`;
          }
        }
      } catch {}

      try {
        const faqResults = await faqEmbeddingService.searchFAQs(commentText, businessAccountId, 3, 0.5, this.p.platform);
        if (faqResults && faqResults.length > 0) {
          context += "\nRELEVANT FAQs:\n";
          for (const faq of faqResults) {
            context += `Q: ${faq.question}\nA: ${faq.answer}\n\n`;
          }
        }
      } catch {}

    } catch (error) {
      console.error(`${this.tag} Error building context:`, error);
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
      new RegExp("^[\\p{Emoji}\\s]+$", "u"),
      /^\d+$/,
      /^(nice|wow|love|beautiful|amazing|great|good|awesome|superb|best|fab|lovely)[\s!.]*$/i,
      /^(interested|available|dm|inbox)\b/i,
    ];
    return ambiguousPatterns.some(p => p.test(text));
  }

  private async runVisionAnalysis(mediaUrl: string, apiKey: string, postId: string): Promise<string> {
    try {
      console.log(`${this.tag} Running vision analysis for post ${postId}`);
      const openai = createOpenAI({ timeout: OPENAI_TIMEOUTS.vision, apiKey });
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
        console.log(`${this.tag} Vision description: ${description.substring(0, 80)}...`);
      }
      return description;
    } catch (visionErr) {
      console.error(`${this.tag} Vision analysis failed (non-fatal):`, visionErr);
      return '';
    }
  }

  private buildPostContextString(
    postData: { caption: string; mediaType: string; permalink: string | null },
    visualDescription: string
  ): string {
    const contextParts = [`POST CONTEXT (this comment is on the following ${this.p.prompts.postNoun}):`];
    if (postData.caption) {
      contextParts.push(`${this.p.prompts.captionLabel}: "${postData.caption}"`);
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
    settings: S,
    businessAccountId: string,
    postId: string | undefined,
    commentText: string,
    apiKey: string
  ): Promise<string | null> {
    if (!postId) {
      console.log(`${this.tag} No postId available — skipping post context`);
      return null;
    }

    try {
      const postDataCacheKey = `${this.p.cachePrefix}-postdata:${businessAccountId}:${postId}`;
      const postData = await businessContextCache.getOrFetch(postDataCacheKey, async () => {
        return await this.p.getPostContext(settings, postId);
      }, 1800000);

      if (!postData) return null;

      const needsVision = (!postData.caption || postData.caption.length < 20) || this.isAmbiguousComment(commentText);
      const canRunVision = postData.mediaUrl && this.p.visionMediaTypes.includes(postData.mediaType);

      if (needsVision && canRunVision) {
        const visionCacheKey = `${this.p.cachePrefix}-postvision:${businessAccountId}:${postId}`;
        const visualDescription = await businessContextCache.getOrFetch(visionCacheKey, async () => {
          return await this.runVisionAnalysis(postData.mediaUrl!, apiKey, postId);
        }, 1800000);

        return this.buildPostContextString(postData, visualDescription || '');
      }

      return this.buildPostContextString(postData, '');
    } catch (error) {
      console.error(`${this.tag} Error resolving post context (non-fatal):`, error);
      return null;
    }
  }

  private async generateCommentReply(
    apiKey: string,
    commentText: string,
    businessContext: string,
    businessName: string,
    commenterName?: string,
    postContext?: string | null,
    replyLanguage: ChannelReplyLanguage | null = null
  ): Promise<string | null> {
    try {
      const openai = createOpenAI({ apiKey });

      const systemPrompt = `You are a social media assistant for "${businessName}". You reply to public ${this.p.label} comments on behalf of the business.

IMPORTANT GUIDELINES:
- Keep replies SHORT (1-3 sentences max) — this is a public comment, not a DM
- Be warm, professional, and brand-appropriate
- Never share sensitive business details publicly
- ${this.p.prompts.detailedQuestionHint}
- Use a natural, conversational tone — avoid sounding robotic
- Do NOT use hashtags unless the brand typically does
- Do NOT start with "Hi [name]!" every time — vary your openings
- If the comment is just an emoji or a simple "nice", keep your reply equally brief
- If the comment is negative or a complaint, be empathetic and offer to help via DM
- Never argue or be defensive
${replyLanguage ? "- LANGUAGE: follow the REPLY LANGUAGE rule at the end." : "- LANGUAGE MATCHING: Always reply in the same language the commenter used. If they write in Hinglish (mix of Hindi and English), reply in Hinglish. If they write in Hindi, reply in Hindi. If they write in any other language, match that language. Only default to English if the comment is clearly in English."}
${postContext ? `\n${postContext}\n\nIMPORTANT: Use the POST CONTEXT above to understand what the post is about. If the comment asks about price, meaning, details, or refers to "this" or "it", ground your reply in the post content. Reference the post's subject naturally.` : ''}
${businessContext ? `\nBUSINESS CONTEXT:\n${businessContext}` : ""}${replyLanguage ? `\n\n${replyLanguage.rule}` : ""}`;

      const userPrompt = commenterName
        ? `${this.p.prompts.commenterMention(commenterName)} commented: "${commentText}"\n\nWrite a brief, appropriate reply.`
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
      console.error(`${this.tag} AI generation error:`, error);
      return null;
    }
  }

  private async tryAutoDm(
    settings: S,
    businessAccountId: string,
    commentData: SocialCommentData,
    businessContext: string,
    businessName: string,
    postContext: string | null,
    apiKey: string,
    commentLanguage: ChannelReplyLanguage | null = null
  ): Promise<void> {
    try {
      if (settings.commentAutoDmEnabled !== "true") return;
      if (!commentData.commenterId) {
        console.log(`${this.dmTag} No commenter ID — skipping DM`);
        return;
      }

      const dmMode = settings.commentDmMode || "all";
      if (dmMode === "keyword_only") {
        const dmKeywords = this.parseKeywords(settings.commentDmTriggerKeywords);
        if (dmKeywords.length === 0) return;
        const commentLower = commentData.commentText.toLowerCase();
        const matched = dmKeywords.some(kw => commentLower.includes(kw.toLowerCase()));
        if (!matched) {
          console.log(`${this.dmTag} No DM keyword match — skipping`);
          return;
        }
      }

      const dmTemplate = settings.commentDmTemplate || "";
      // Same language as the public reply; the "I can help in …" note is not repeated in the DM.
      const replyLanguage = withoutLanguageNote(commentLanguage);
      const generatedDm = await this.generateDmMessage(apiKey, commentData.commentText, businessContext, businessName, commentData.commenterName, postContext, dmTemplate, replyLanguage);
      const dmText = generatedDm ? await checkReplyLanguage(businessAccountId, generatedDm, replyLanguage) : generatedDm;

      if (!dmText) {
        console.log(`${this.dmTag} Failed to generate DM`);
        await this.updateCommentDmStatus(businessAccountId, commentData.commentId, "failed", null);
        return;
      }

      // The commenter may never have messaged us, so this must be a private reply tied to the
      // comment (IG: recipient: { comment_id }; FB: /{comment-id}/private_replies) — a plain
      // DM to their id is rejected.
      const result = await this.p.sendPrivateReply(settings, commentData.commentId, dmText);

      if (result.success) {
        console.log(`${this.dmTag} Sent private reply for comment ${commentData.commentId}`);
        await this.updateCommentDmStatus(businessAccountId, commentData.commentId, "sent", dmText);
      } else {
        console.error(`${this.dmTag} Failed: ${result.error}`);
        await this.updateCommentDmStatus(businessAccountId, commentData.commentId, "failed", dmText);
      }
    } catch (error) {
      console.error(`${this.dmTag} Error:`, error);
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
    await this.updateComment(businessAccountId, commentId, updateData);
  }

  private async generateDmMessage(
    apiKey: string,
    commentText: string,
    businessContext: string,
    businessName: string,
    commenterName?: string,
    postContext?: string | null,
    dmTemplate?: string,
    replyLanguage: ChannelReplyLanguage | null = null
  ): Promise<string | null> {
    const pr = this.p.prompts;
    try {
      const openai = createOpenAI({ apiKey });

      const systemPrompt = `You are a helpful assistant for "${businessName}". A user commented on ${pr.postWithArticle} and you are now sending them a ${pr.privateDmNoun} to continue the conversation.

IMPORTANT GUIDELINES:
- Be warm, friendly, and helpful — this is a private message, so you can be more detailed than a public comment
- Reference what they commented about so the ${pr.dmNoun} feels personal and relevant
- Provide useful information, answer their question, or offer to help further
- Keep it concise but informative (2-5 sentences)
${replyLanguage ? "- LANGUAGE: follow the REPLY LANGUAGE rule at the end." : "- LANGUAGE MATCHING: Always reply in the same language the user commented in. If they write in Hinglish, reply in Hinglish. If Hindi, reply in Hindi."}
- Do NOT sound robotic or overly formal
- Do NOT use excessive emojis or hashtags
${dmTemplate ? `\nSPECIAL INSTRUCTIONS FOR DM:\n${dmTemplate}` : ""}
${postContext ? `\n${postContext}` : ""}
${businessContext ? `\nBUSINESS CONTEXT:\n${businessContext}` : ""}${replyLanguage ? `\n\n${replyLanguage.rule}` : ""}`;

      const userPrompt = commenterName
        ? `${pr.commenterMention(commenterName)} commented on our post: "${commentText}"\n\nWrite a friendly ${pr.privateDmNoun} to send them.`
        : `Someone commented on our post: "${commentText}"\n\nWrite a friendly ${pr.privateDmNoun} to send them.`;

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
      console.error(`${this.dmTag} AI generation error:`, error);
      return null;
    }
  }
}
