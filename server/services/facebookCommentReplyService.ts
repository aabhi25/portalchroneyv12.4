import { facebookComments } from "@shared/schema";
import type { FacebookSettings } from "@shared/schema";
import { facebookService } from "./facebookService";
import { SocialCommentReplyEngine, type SocialCommentData } from "./social/commentReplyEngine";

/** Facebook comment auto-replies (engine: social/commentReplyEngine.ts). */
export class FacebookCommentReplyService {
  private readonly engine = new SocialCommentReplyEngine<FacebookSettings>({
    platform: "facebook",
    label: "Facebook",
    ownAccountNoun: "page",
    ownAccountId: (s) => s.pageId,
    commentsTable: facebookComments,
    commenterNameColumn: "commenterName",
    cachePrefix: "fb",
    visionMediaTypes: ["photo", "album"],
    replyToComment: (s, id, text) => facebookService.replyToComment(s, id, text),
    // /{comment-id}/private_replies
    sendPrivateReply: (s, id, text) => facebookService.sendPrivateReply(s, id, text),
    getPostContext: (s, postId) => facebookService.getPostContext(s, postId),
    prompts: {
      postNoun: "Facebook post",
      captionLabel: "Post Text",
      detailedQuestionHint: "If the comment asks detailed questions, invite them to message the page for more info",
      commenterMention: (name) => `Facebook user ${name}`,
      postWithArticle: "a Facebook post",
      dmNoun: "message",
      privateDmNoun: "private message",
    },
  });

  processComment(
    settings: FacebookSettings,
    businessAccountId: string,
    commentData: SocialCommentData
  ): Promise<{ success: boolean; reply?: string; error?: string; status: string }> {
    return this.engine.processComment(settings, businessAccountId, commentData);
  }
}

export const facebookCommentReplyService = new FacebookCommentReplyService();
