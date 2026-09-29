/**
 * Per-channel wording, routes and colours for the shared Instagram / Facebook admin pages
 * (ChannelFlows, ChannelComments, ChannelCommentSettings, ChannelSettings, ChannelHome).
 * Instagram pages sit under the Instagram tab bar with the pink/purple theme; Facebook
 * pages have their own blue header with a Back button.
 */
export type SocialChannel = "instagram" | "facebook";

export interface SocialChannelConfig {
  channel: SocialChannel;
  label: string;
  /** "/api/instagram" | "/api/facebook" */
  apiBase: string;
  /** "/admin/instagram" | "/admin/facebook" (the channel home). */
  homePath: string;
  /** Builds "/admin/<channel>-<page>". */
  adminPath: (page: string) => string;
  /** Instagram renders InstagramTabBar; Facebook renders its own header. */
  usesTabBar: boolean;
  /** How DMs are called in UI copy: "Instagram DMs" | "Facebook Messenger". */
  dmsPhrase: string;
  /** Where comments come from: "Instagram post" | "Facebook page". */
  commentSource: string;
  /** "private message (DM)" | "private message" (comment settings). */
  privateMessagePhrase: string;
  /** "private DM" | "private message" */
  privateDmPhrase: string;
  /** Minimum comment reply delay allowed by the slider (IG 0, FB 1). */
  minReplyDelay: number;
  theme: {
    /** Primary action button gradient. */
    primaryButton: string;
    /** Flow step number / active flow badge background (+ text for the step number). */
    softGradient: string;
    softGradientText: string;
    /** Icon accent colours. */
    accent500: string;
    accent600: string;
    /** Selected flow card. */
    selectedCard: string;
    /** Comment "AI Reply" bubble. */
    replyBubble: string;
    replyBubbleLabel: string;
    /** Comment settings: section icon + save button. */
    commentIcon: string;
    commentSaveButton: string;
    /** Settings page save button. */
    settingsSaveButton: string;
  };
}

export const SOCIAL_CHANNELS: Record<SocialChannel, SocialChannelConfig> = {
  instagram: {
    channel: "instagram",
    label: "Instagram",
    apiBase: "/api/instagram",
    homePath: "/admin/instagram",
    adminPath: (page) => `/admin/instagram-${page}`,
    usesTabBar: true,
    dmsPhrase: "Instagram DMs",
    commentSource: "Instagram post",
    privateMessagePhrase: "private message (DM)",
    privateDmPhrase: "private DM",
    minReplyDelay: 0,
    theme: {
      primaryButton: "bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 hover:from-pink-600 hover:via-purple-600 hover:to-indigo-600",
      softGradient: "bg-gradient-to-r from-pink-100 to-purple-100",
      softGradientText: "text-purple-700",
      accent500: "text-purple-500",
      accent600: "text-purple-600",
      selectedCard: "border-purple-500 bg-purple-50",
      replyBubble: "bg-teal-50 rounded-lg p-3 ml-4 border-l-2 border-teal-300",
      replyBubbleLabel: "text-xs font-medium text-teal-700 mb-1",
      commentIcon: "w-5 h-5 text-teal-600",
      commentSaveButton: "bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700",
      settingsSaveButton: "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600",
    },
  },
  facebook: {
    channel: "facebook",
    label: "Facebook",
    apiBase: "/api/facebook",
    homePath: "/admin/facebook",
    adminPath: (page) => `/admin/facebook-${page}`,
    usesTabBar: false,
    dmsPhrase: "Facebook Messenger",
    commentSource: "Facebook page",
    privateMessagePhrase: "private message",
    privateDmPhrase: "private message",
    minReplyDelay: 1,
    theme: {
      primaryButton: "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600",
      softGradient: "bg-gradient-to-r from-blue-100 to-blue-200",
      softGradientText: "text-blue-700",
      accent500: "text-blue-500",
      accent600: "text-blue-600",
      selectedCard: "border-blue-500 bg-blue-50",
      replyBubble: "bg-blue-50 rounded-lg p-3 ml-4 border-l-2 border-blue-300",
      replyBubbleLabel: "text-xs font-medium text-blue-700 mb-1",
      commentIcon: "w-5 h-5 text-blue-600",
      commentSaveButton: "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600",
      settingsSaveButton: "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600",
    },
  },
};
