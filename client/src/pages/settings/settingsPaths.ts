/**
 * Every URL inside the Settings hub (/admin/settings/...), in one place.
 *
 * Kept free of React imports so any page can link into the hub without pulling the hub (and
 * every settings screen it embeds) into its own import graph.
 */
export const SETTINGS_ROOT = "/admin/settings";

export const SETTINGS_PATHS = {
  root: SETTINGS_ROOT,

  // Account
  account: `${SETTINGS_ROOT}/account`,
  usage: `${SETTINGS_ROOT}/usage`,

  // Channels
  website: `${SETTINGS_ROOT}/channels/website`,
  whatsappConnection: `${SETTINGS_ROOT}/channels/whatsapp/connection`,
  whatsappAiReplies: `${SETTINGS_ROOT}/channels/whatsapp/ai-replies`,
  whatsappFlowSettings: `${SETTINGS_ROOT}/channels/whatsapp/flow-settings`,
  whatsappLeadCapture: `${SETTINGS_ROOT}/channels/whatsapp/lead-capture`,
  instagramConnection: `${SETTINGS_ROOT}/channels/instagram/connection`,
  instagramLeadCapture: `${SETTINGS_ROOT}/channels/instagram/lead-capture`,
  instagramComments: `${SETTINGS_ROOT}/channels/instagram/comments`,
  facebookConnection: `${SETTINGS_ROOT}/channels/facebook/connection`,
  facebookComments: `${SETTINGS_ROOT}/channels/facebook/comments`,

  // Integrations
  integrations: `${SETTINGS_ROOT}/integrations`,

  // Lead privacy & data
  leadPrivacy: `${SETTINGS_ROOT}/lead-privacy`,
  dataRetention: `${SETTINGS_ROOT}/data-retention`,
  otp: `${SETTINGS_ROOT}/otp`,

  // Other
  conversationCategories: `${SETTINGS_ROOT}/conversation-categories`,
  visualSearch: `${SETTINGS_ROOT}/visual-search`,
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
};
