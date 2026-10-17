/**
 * Every settings URL, in one place: the account Settings hub (/admin/settings/...) and the
 * settings that now live inside their own area (/admin/<area>/settings/...).
 *
 * Kept free of React imports so any page can link into the hub without pulling the hub (and
 * every settings screen it embeds) into its own import graph.
 */
export const SETTINGS_ROOT = "/admin/settings";

export const SETTINGS_PATHS = {
  root: SETTINGS_ROOT,

  // Account-wide (stay in the Settings hub)
  account: `${SETTINGS_ROOT}/account`,
  usage: `${SETTINGS_ROOT}/usage`,
  features: `${SETTINGS_ROOT}/features`,
  integrations: `${SETTINGS_ROOT}/integrations`,

  // These belong to one area and live in that area's Settings tab (see navigation/hubAreas.ts).
  website: "/admin/website/settings/appearance",
  whatsappConnection: "/admin/whatsapp/settings/connection",
  whatsappAiReplies: "/admin/whatsapp/settings/ai-replies",
  whatsappFlowSettings: "/admin/whatsapp/settings/journey-settings",
  whatsappLeadCapture: "/admin/whatsapp/settings/lead-capture",
  instagramConnection: "/admin/instagram/settings/connection",
  instagramLeadCapture: "/admin/instagram/settings/lead-capture",
  instagramComments: "/admin/instagram/settings/comments",
  facebookConnection: "/admin/facebook/settings/connection",
  facebookComments: "/admin/facebook/settings/comments",
  leadPrivacy: "/admin/leads/settings/export",
  dataRetention: "/admin/leads/settings/auto-delete",
  otp: "/admin/website/settings/verification",
  conversationCategories: "/admin/website/settings/categories",
  visualSearch: "/admin/vista/settings/visual-search",
} as const;

export type IntegrationTabId = "leadsquared" | "salesforce" | "custom-crm" | "shopify" | "erp";

export function integrationPath(tab?: IntegrationTabId): string {
  return tab ? `${SETTINGS_PATHS.integrations}/${tab}` : SETTINGS_PATHS.integrations;
}

export function socialSettingsPath(channel: "instagram" | "facebook", page: "connection" | "comments"): string {
  if (channel === "instagram") return page === "connection" ? SETTINGS_PATHS.instagramConnection : SETTINGS_PATHS.instagramComments;
  return page === "connection" ? SETTINGS_PATHS.facebookConnection : SETTINGS_PATHS.facebookComments;
}

/**
 * Old standalone settings routes and where they now live. App.tsx redirects each of these
 * (query string preserved) so bookmarks, server-generated links (e.g. WhatsApp readiness
 * "fix" links) and OAuth/return URLs keep working.
 */
export const LEGACY_SETTINGS_REDIRECTS: Record<string, string> = {
  "/admin/usage": SETTINGS_PATHS.usage,
  "/admin/widget-settings": SETTINGS_PATHS.website,
  "/admin/whatsapp-config": SETTINGS_PATHS.whatsappConnection,
  "/admin/whatsapp-flow-settings": SETTINGS_PATHS.whatsappFlowSettings,
  "/admin/whatsapp-lead-capture-settings": SETTINGS_PATHS.whatsappLeadCapture,
  "/admin/instagram-settings": SETTINGS_PATHS.instagramConnection,
  "/admin/instagram-lead-capture-settings": SETTINGS_PATHS.instagramLeadCapture,
  "/admin/instagram-comment-settings": SETTINGS_PATHS.instagramComments,
  "/admin/facebook-settings": SETTINGS_PATHS.facebookConnection,
  "/admin/facebook-comment-settings": SETTINGS_PATHS.facebookComments,
  "/admin/crm": integrationPath(),
  "/admin/leadsquared": integrationPath("leadsquared"),
  "/admin/salesforce": integrationPath("salesforce"),
  "/admin/custom-crm": integrationPath("custom-crm"),
  "/admin/erp": integrationPath("erp"),
  "/admin/otp-settings": SETTINGS_PATHS.otp,
  "/admin/category-settings": SETTINGS_PATHS.conversationCategories,
  "/admin/visual-search-settings": SETTINGS_PATHS.visualSearch,
  "/admin/more": "/admin/website/settings",
  // Settings hub addresses from before settings moved into their areas (October 2026).
  [`${SETTINGS_ROOT}/channels/website`]: SETTINGS_PATHS.website,
  [`${SETTINGS_ROOT}/channels/whatsapp/connection`]: SETTINGS_PATHS.whatsappConnection,
  [`${SETTINGS_ROOT}/channels/whatsapp/ai-replies`]: SETTINGS_PATHS.whatsappAiReplies,
  [`${SETTINGS_ROOT}/channels/whatsapp/flow-settings`]: SETTINGS_PATHS.whatsappFlowSettings,
  [`${SETTINGS_ROOT}/channels/whatsapp/lead-capture`]: SETTINGS_PATHS.whatsappLeadCapture,
  [`${SETTINGS_ROOT}/channels/instagram/connection`]: SETTINGS_PATHS.instagramConnection,
  [`${SETTINGS_ROOT}/channels/instagram/lead-capture`]: SETTINGS_PATHS.instagramLeadCapture,
  [`${SETTINGS_ROOT}/channels/instagram/comments`]: SETTINGS_PATHS.instagramComments,
  [`${SETTINGS_ROOT}/channels/facebook/connection`]: SETTINGS_PATHS.facebookConnection,
  [`${SETTINGS_ROOT}/channels/facebook/comments`]: SETTINGS_PATHS.facebookComments,
  [`${SETTINGS_ROOT}/lead-privacy`]: SETTINGS_PATHS.leadPrivacy,
  [`${SETTINGS_ROOT}/data-retention`]: SETTINGS_PATHS.dataRetention,
  [`${SETTINGS_ROOT}/otp`]: SETTINGS_PATHS.otp,
  [`${SETTINGS_ROOT}/conversation-categories`]: SETTINGS_PATHS.conversationCategories,
  [`${SETTINGS_ROOT}/visual-search`]: SETTINGS_PATHS.visualSearch,
};
