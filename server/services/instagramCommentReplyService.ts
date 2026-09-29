import { instagramComments } from "@shared/schema";
import type { InstagramSettings } from "@shared/schema";
import { instagramService } from "./instagramService";
import { SocialCommentReplyEngine } from "./social/commentReplyEngine";

interface CommentData {
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterUsername?: string;
  postId?: string;
}

/** Instagram comment auto-replies (engine: social/commentReplyEngine.ts). */
export class InstagramCommentReplyService {
  private readonly engine = new SocialCommentReplyEngine<InstagramSettings>({
    platform: "instagram",
    label: "Instagram",
    ownAccountNoun: "account",
    ownAccountId: (s) => s.igAccountId,
    commentsTable: instagramComments,
    commenterNameColumn: "commenterUsername",
    cachePrefix: "ig",
    visionMediaTypes: ["IMAGE", "CAROUSEL_ALBUM"],
    replyToComment: (s, id, text) => instagramService.replyToComment(s, id, text),
    // recipient: { comment_id } on /me/messages
    sendPrivateReply: (s, id, text) => instagramService.sendPrivateReply(s, id, text),
    getPostContext: (s, postId) => instagramService.getPostContext(s, postId),
    prompts: {
      postNoun: "Instagram post",
      captionLabel: "Caption",
      detailedQuestionHint: "If the comment asks detailed questions, invite them to DM for more info",
      commenterMention: (name) => `Instagram user @${name}`,
      postWithArticle: "an Instagram post",
      dmNoun: "DM",
      privateDmNoun: "private DM",
    },
  });

  processComment(
    settings: InstagramSettings,
    businessAccountId: string,
    commentData: CommentData
  ): Promise<{ success: boolean; reply?: string; error?: string; status: string }> {
    const { commenterUsername, ...rest } = commentData;
    return this.engine.processComment(settings, businessAccountId, { ...rest, commenterName: commenterUsername });
  }
}

export const instagramCommentReplyService = new InstagramCommentReplyService();
