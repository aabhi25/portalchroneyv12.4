import type { LucideIcon } from "lucide-react";
import {
  Globe, MessageCircle, Camera, Facebook, Phone, Gem, Contact, GraduationCap, Package, CalendarDays, PackageOpen,
  Palette, Sparkles, Mic, Video, Zap, ShoppingBag, UserPlus, KeyRound, Bell, Percent, Compass, LayoutList, Tag, Code,
  Plug, ShieldCheck, Route, FileText, Store, MessageSquareText, EyeOff, Clock, Link2, SlidersHorizontal,
} from "lucide-react";
import type { MeResponseDto } from "@shared/dto";
import { getWhatsappSections } from "@/components/whatsapp/sections";
import { SETTINGS_PATHS, integrationPath } from "@/pages/settings/settingsPaths";

/**
 * The one map of the business portal: which areas exist (agents, Leads, shared tools), the tabs
 * inside each, and the settings that belong to each.
 *
 * The sidebar, the area frame above every page (name + tabs) and the per-area Settings pages are
 * all built from this, so a screen can only ever live in one place. Rule of thumb when adding a
 * setting: put it in the area whose behaviour it changes. Only account-wide things (login,
 * connected apps, AI usage) belong in the account Settings hub.
 *
 * Kept free of page imports: the settings screens themselves are attached in
 * pages/hub/hubSettingsScreens.tsx, so the sidebar stays light.
 */

export type HubAreaId =
  | "website" | "whatsapp" | "instagram" | "facebook" | "calls" | "vista"
  | "leads" | "training" | "products" | "appointments" | "orders";

export interface HubAccess {
  isSuperAdminViewing: boolean;
  website: boolean;
  whatsapp: boolean;
  whatsappMarketing: boolean;
  instagram: boolean;
  facebook: boolean;
  calls: boolean;
  vista: boolean;
  supportTickets: boolean;
  training: boolean;
  products: boolean;
  shopify: boolean;
  appointments: boolean;
  orders: boolean;
  fullFeatures: boolean;
  topScholar: boolean;
}

/** Same rules the sidebar has always used, gathered in one place. */
export function getHubAccess(user: MeResponseDto | null | undefined, aiCallingEnabled: boolean): HubAccess {
  const ba = user?.businessAccount;
  const isSuperAdmin = user?.role === "super_admin";
  const isSuperAdminViewing = isSuperAdmin && !!user?.activeBusinessAccountId;
  const productTier = ba?.productTier || "chroney";
  const website = ba?.chroneyEnabled === true;
  const whatsapp = ba?.whatsappEnabled === true;
  const instagram = ba?.instagramEnabled === true;
  const facebook = ba?.facebookEnabled === true;
  const jewelry = productTier === "jewelry_showcase" || productTier === "jewelry_showcase_chroney";
  const vista = jewelry && (productTier === "jewelry_showcase" || ba?.jewelryShowcaseEnabled === true);
  const fullFeatures = isSuperAdminViewing || (ba?.systemMode || "full") === "full";
  return {
    isSuperAdminViewing,
    website,
    whatsapp,
    whatsappMarketing: whatsapp && ba?.whatsappMarketingEnabled === true,
    instagram,
    facebook,
    calls: aiCallingEnabled,
    vista,
    supportTickets: ba?.supportTicketsEnabled === true && fullFeatures,
    training: (website || whatsapp || instagram || facebook) && fullFeatures,
    products: website || whatsapp || jewelry,
    shopify: ba?.shopifyEnabled === true,
    appointments: ba?.appointmentsEnabled === true && website,
    orders: ba?.demoOrdersEnabled === true,
    fullFeatures,
    topScholar: ba?.isTopscholar === true,
  };
}

export interface HubTab {
  key: string;
  label: string;
  href: string;
  matches: (location: string) => boolean;
  visible?: (a: HubAccess) => boolean;
}

export interface HubSettingsItem {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group: string;
  /**
   * An existing screen with its own address. The area claims that address, so the screen opens
   * under this area's name with the Settings tab selected. Items without `href` open inside the
   * area's Settings page (see hubSettingsScreens.tsx).
   */
  href?: string;
  /** Other addresses that belong to this item (sub-pages, old addresses). */
  alsoMatches?: (location: string) => boolean;
  /** Opens a page in another area (e.g. Connected apps). Not claimed by this area. */
  leavesArea?: boolean;
  /** Needs the whole width (the chat widget designer has its own live preview). */
  wide?: boolean;
  superAdminOnly?: boolean;
  /** Where this used to be, so search finds it by its old name. */
  formerly?: string;
  visible?: (a: HubAccess) => boolean;
}

export interface HubArea {
  id: HubAreaId;
  label: string;
  /** Small line above the title. */
  kind: string;
  icon: LucideIcon;
  /** Icon tile colour (full Tailwind class so it survives purging). */
  tint: string;
  description: string;
  tabs: HubTab[];
  settings?: HubSettingsItem[];
  /** Second row of choices under one tab (WhatsApp campaign screens). */
  sections?: { tabKey: string; items: HubTab[] };
  /** Other addresses that belong to this area without being a tab. */
  alsoMatches?: (location: string) => boolean;
  visible: (a: HubAccess) => boolean;
  isAgent?: boolean;
}

const exact = (...paths: string[]) => (l: string) => paths.includes(l);
const prefix = (...paths: string[]) => (l: string) => paths.some(p => l === p || l.startsWith(`${p}/`));
const settingsPath = (area: HubAreaId, key?: string) => `/admin/${area === "calls" ? "calling" : area}/settings${key ? `/${key}` : ""}`;
export const hubSettingsPath = settingsPath;

const settingsTab = (area: HubAreaId): HubTab => ({
  key: "settings",
  label: "Settings",
  href: settingsPath(area),
  matches: prefix(settingsPath(area)),
});

const WHATSAPP_CAMPAIGN_ITEMS: HubTab[] = (
  getWhatsappSections({ marketingEnabled: true }).find(s => s.id === "campaigns")?.items ?? []
).map(i => ({ key: i.key, label: i.label, href: i.href, matches: i.matches }));

export const HUB_AREAS: HubArea[] = [
  {
    id: "leads",
    label: "Leads",
    kind: "Every channel",
    icon: Contact,
    tint: "bg-orange-500",
    description: "Everyone who left their details with any of your AI agents, in one list.",
    visible: a => a.website || a.whatsapp || a.instagram || a.facebook || a.calls,
    tabs: [
      { key: "all", label: "All leads", href: "/admin/leads", matches: exact("/admin/leads") },
      { ...settingsTab("leads"), label: "Lead settings" },
    ],
    settings: [
      { key: "export", label: "Export & phone masking", description: "Who can download leads, and whether phone numbers are partly hidden", icon: EyeOff, group: "Privacy", formerly: "Settings › Lead privacy & data › Lead export & masking" },
      { key: "auto-delete", label: "Auto-delete", description: "How long leads and chats are kept before they are deleted", icon: Clock, group: "Privacy", formerly: "Settings › Lead privacy & data › Data retention" },
      { key: "crm", label: "Send leads to your CRM", description: "LeadSquared, Salesforce or your own CRM", icon: Link2, group: "Send leads elsewhere", href: SETTINGS_PATHS.integrations, leavesArea: true, formerly: "Settings › CRM & integrations" },
    ],
  },
  {
    id: "website",
    label: "Website chat",
    kind: "AI agent",
    icon: Globe,
    tint: "bg-indigo-500",
    description: "The chat and voice assistant on your website.",
    isAgent: true,
    visible: a => a.website,
    tabs: [
      { key: "conversations", label: "Conversations", href: "/conversations", matches: exact("/conversations") },
      { key: "leads", label: "Leads", href: "/admin/website/leads", matches: exact("/admin/website/leads") },
      { key: "insights", label: "Insights", href: "/insights", matches: exact("/insights"), visible: a => !a.topScholar },
      { key: "tickets", label: "Support tickets", href: "/tickets", matches: l => l.startsWith("/tickets") || l === "/automation-analytics", visible: a => a.supportTickets },
      settingsTab("website"),
    ],
    alsoMatches: exact("/admin/website"),
    settings: [
      { key: "appearance", label: "Appearance", description: "Colours, button, size and position of the chat", icon: Palette, group: "Look & feel", wide: true, formerly: "Settings › Chat widget › Appearance" },
      { key: "avatar", label: "Avatar", description: "The picture next to each answer, and the live video avatar", icon: Video, group: "Look & feel", wide: true, formerly: "Settings › Chat widget › Avatar" },
      { key: "voice", label: "Voice", description: "Let visitors talk to the assistant", icon: Mic, group: "Look & feel", wide: true, formerly: "Settings › Chat widget › Voice" },
      { key: "behaviour", label: "Welcome & behaviour", description: "Welcome message, tone, auto-open, starters, languages", icon: Sparkles, group: "How it talks", wide: true, formerly: "Settings › Chat widget › Behavior" },
      { key: "keyword-replies", label: "Keyword replies", description: "Fixed answers for exact words", icon: Zap, group: "How it talks", href: "/admin/smart-replies", formerly: "Training › Smart Replies" },
      { key: "shopping", label: "Products in chat", description: "Product cards, carousel, compare, WhatsApp ordering", icon: ShoppingBag, group: "How it talks", wide: true, formerly: "Settings › Chat widget › Shopping" },
      { key: "lead-capture", label: "Details to collect", description: "Which contact details the assistant asks for, and how they are checked", icon: UserPlus, group: "Leads", formerly: "Training › Train Chroney › Lead Training" },
      { key: "verification", label: "Phone verification (OTP)", description: "SMS / WhatsApp code sender and message", icon: KeyRound, group: "Leads", formerly: "Settings › Lead privacy & data › OTP / SMS verification" },
      { key: "nudges", label: "Nudges & banners", description: "Messages that bring visitors into a chat", icon: Bell, group: "Engage visitors", wide: true, formerly: "Settings › Chat widget › Nudges" },
      { key: "offers", label: "Offers & discounts", description: "Urgency, exit-intent and idle offers", icon: Percent, group: "Engage visitors", href: "/admin/smart-discounts", alsoMatches: prefix("/admin/smart-discounts"), formerly: "More › Smart Discounts" },
      { key: "guidance", label: "Guidance campaigns", description: "Help on chosen pages of your site", icon: Compass, group: "Engage visitors", href: "/guidance-campaigns", alsoMatches: l => l.startsWith("/guidance-campaigns") || l.startsWith("/proactive-guidance"), formerly: "More › Guidance" },
      { key: "menu", label: "Chat menu & forms", description: "Buttons and lead forms inside the chat", icon: LayoutList, group: "Engage visitors", href: "/admin/menu-builder", alsoMatches: prefix("/admin/menu-builder"), formerly: "More › Menu Builder" },
      { key: "categories", label: "Conversation categories", description: "How chats are grouped in Insights", icon: Tag, group: "Sorting", formerly: "Settings › Other › Conversation categories" },
      { key: "install", label: "Install on your website", description: "Embed code, open from your own button", icon: Code, group: "Install", wide: true, formerly: "Settings › Chat widget › Embed" },
    ],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    kind: "AI agent",
    icon: MessageCircle,
    tint: "bg-green-600",
    description: "Answers messages to your WhatsApp Business number and sends your campaigns.",
    isAgent: true,
    visible: a => a.whatsapp,
    tabs: [
      { key: "overview", label: "Overview", href: "/admin/whatsapp/overview", matches: l => l === "/admin/whatsapp/overview" || l.startsWith("/admin/whatsapp-hub") },
      { key: "conversations", label: "Conversations", href: "/admin/whatsapp-conversations", matches: exact("/admin/whatsapp-conversations") },
      { key: "leads", label: "Leads", href: "/admin/whatsapp-leads", matches: exact("/admin/whatsapp-leads") },
      { key: "campaigns", label: "Campaigns", href: "/admin/whatsapp-campaign-home", matches: l => WHATSAPP_CAMPAIGN_ITEMS.some(i => i.matches(l)), visible: a => a.whatsappMarketing },
      { key: "insights", label: "Insights", href: "/admin/wa-insights", matches: exact("/admin/wa-insights") },
      settingsTab("whatsapp"),
    ],
    sections: { tabKey: "campaigns", items: WHATSAPP_CAMPAIGN_ITEMS },
    settings: [
      { key: "connection", label: "Number & connection", description: "MSG91 details, webhook, 24-hour template and the main switch", icon: Plug, group: "Connection", formerly: "Settings › Channels › WhatsApp › Connection" },
      { key: "allowed-numbers", label: "Allowed numbers", description: "Reply only to chosen numbers (also affects campaigns)", icon: ShieldCheck, group: "Connection", href: "/admin/whatsapp-whitelist", formerly: "WhatsApp › Allowed numbers" },
      { key: "ai-replies", label: "How the AI replies", description: "Main switch, reply mode, goal and what the AI knows", icon: Sparkles, group: "Replies", formerly: "Settings › Channels › WhatsApp › AI replies" },
      { key: "keyword-replies", label: "Keyword replies", description: "Fixed answers for exact words", icon: Zap, group: "Replies", href: "/admin/whatsapp-smart-replies", formerly: "WhatsApp › Keyword replies" },
      { key: "journeys", label: "Guided journeys", description: "Button menus and step-by-step flows", icon: Route, group: "Replies", href: "/admin/whatsapp-flows", alsoMatches: l => l.startsWith("/admin/document-type-editor"), formerly: "WhatsApp › Guided journeys" },
      { key: "journey-settings", label: "Journey settings & documents", description: "Document types, confirmation step, cooldown", icon: FileText, group: "Replies", formerly: "Settings › Channels › WhatsApp › Flow settings" },
      { key: "lead-capture", label: "Lead capture", description: "When leads are created, which details are picked up", icon: UserPlus, group: "Leads", formerly: "Settings › Channels › WhatsApp › Lead capture" },
      { key: "stores", label: "Dealers, stores & EMI", description: "Lists used by journeys and the CRM", icon: Store, group: "Leads", href: "/admin/whatsapp-dealers-stores", formerly: "WhatsApp › Dealers & stores" },
    ],
  },
  {
    id: "instagram",
    label: "Instagram",
    kind: "AI agent",
    icon: Camera,
    tint: "bg-pink-600",
    description: "Replies to DMs and comments on your Instagram account.",
    isAgent: true,
    visible: a => a.instagram,
    tabs: [
      { key: "conversations", label: "Messages", href: "/admin/instagram-conversations", matches: exact("/admin/instagram-conversations") },
      { key: "comments", label: "Comments", href: "/admin/instagram-comments", matches: exact("/admin/instagram-comments") },
      { key: "leads", label: "Leads", href: "/admin/instagram-leads", matches: exact("/admin/instagram-leads") },
      { key: "insights", label: "Insights", href: "/admin/instagram-insights", matches: exact("/admin/instagram-insights") },
      settingsTab("instagram"),
    ],
    alsoMatches: exact("/admin/instagram"),
    settings: [
      { key: "connection", label: "Account & connection", description: "Webhook, tokens and the AI on/off switch", icon: Plug, group: "Connection", formerly: "Settings › Channels › Instagram › Connection" },
      { key: "comments", label: "Comment replies & DMs", description: "Answer comments and message the people who comment", icon: MessageSquareText, group: "Replies", formerly: "Settings › Channels › Instagram › Comment replies" },
      { key: "keyword-replies", label: "Keyword replies", description: "Fixed answers for exact words", icon: Zap, group: "Replies", href: "/admin/instagram-smart-replies", formerly: "Instagram › Smart Replies" },
      { key: "flows", label: "Flows", description: "Step-by-step DM conversations", icon: Route, group: "Replies", href: "/admin/instagram-flows", formerly: "Instagram › AI Flows" },
      { key: "lead-capture", label: "Lead capture", description: "Details picked up from DMs", icon: UserPlus, group: "Leads", formerly: "Settings › Channels › Instagram › Lead capture" },
    ],
  },
  {
    id: "facebook",
    label: "Facebook",
    kind: "AI agent",
    icon: Facebook,
    tint: "bg-blue-600",
    description: "Replies to Messenger and comments on your Facebook page.",
    isAgent: true,
    visible: a => a.facebook,
    tabs: [
      { key: "conversations", label: "Messages", href: "/admin/facebook-conversations", matches: exact("/admin/facebook-conversations") },
      { key: "comments", label: "Comments", href: "/admin/facebook-comments", matches: exact("/admin/facebook-comments") },
      { key: "leads", label: "Leads", href: "/admin/facebook-leads", matches: exact("/admin/facebook-leads") },
      { key: "insights", label: "Insights", href: "/admin/facebook-insights", matches: exact("/admin/facebook-insights") },
      settingsTab("facebook"),
    ],
    alsoMatches: exact("/admin/facebook"),
    settings: [
      { key: "connection", label: "Page & connection", description: "Webhook, tokens, AI replies and lead capture", icon: Plug, group: "Connection", formerly: "Settings › Channels › Facebook › Connection" },
      { key: "comments", label: "Comment replies & messages", description: "Answer comments and message the people who comment", icon: MessageSquareText, group: "Replies", formerly: "Settings › Channels › Facebook › Comment replies" },
      { key: "keyword-replies", label: "Keyword replies", description: "Fixed answers for exact words", icon: Zap, group: "Replies", href: "/admin/facebook-smart-replies", formerly: "Facebook › Smart Replies" },
      { key: "flows", label: "Flows", description: "Step-by-step Messenger conversations", icon: Route, group: "Replies", href: "/admin/facebook-flows", formerly: "Facebook › AI Flows" },
    ],
  },
  {
    id: "calls",
    label: "Phone calls",
    kind: "AI agent",
    icon: Phone,
    tint: "bg-cyan-600",
    description: "Calls new leads and answers your number in a natural voice.",
    isAgent: true,
    visible: a => a.calls,
    tabs: [
      { key: "calls", label: "Calls", href: "/admin/calling", matches: l => l === "/admin/calling" || l.startsWith("/admin/calling/calls") },
      { key: "try", label: "Try a call", href: "/admin/calling/try", matches: prefix("/admin/calling/try") },
      { key: "dnc", label: "Do-not-call list", href: "/admin/calling/do-not-call", matches: prefix("/admin/calling/do-not-call") },
      settingsTab("calls"),
    ],
  },
  {
    id: "vista",
    label: "Vista",
    kind: "AI agent · visual search",
    icon: Gem,
    tint: "bg-rose-500",
    description: "Customers upload a photo and Vista finds matching designs. Studio creates product photos.",
    isAgent: true,
    visible: a => a.vista,
    tabs: [
      { key: "search", label: "Visual search", href: "/jewelry-showcase", matches: exact("/jewelry-showcase") },
      { key: "studio", label: "Studio", href: "/admin/jewelry-image-generator", matches: exact("/admin/jewelry-image-generator") },
      { key: "history", label: "Match history", href: "/admin/uploads", matches: exact("/admin/uploads") },
      { key: "insights", label: "Insights", href: "/vista-insights", matches: exact("/vista-insights") },
      settingsTab("vista"),
    ],
    settings: [
      { key: "visual-search", label: "Match strictness", description: "How close a photo must be to count as a match", icon: SlidersHorizontal, group: "Search", formerly: "Settings › Other › Visual search" },
      { key: "erp", label: "ERP product sync", description: "Bring designs in from your ERP", icon: Link2, group: "Stock", href: integrationPath("erp"), leavesArea: true, formerly: "Settings › Integrations › ERP" },
    ],
  },
  {
    id: "training",
    label: "Training",
    kind: "Shared by every agent",
    icon: GraduationCap,
    tint: "bg-purple-600",
    description: "What your AI knows. Each item can be used by every agent or only some.",
    visible: a => a.training,
    tabs: [
      { key: "overview", label: "Overview", href: "/admin/training", matches: exact("/admin/training") },
      { key: "instructions", label: "Instructions", href: "/train-chroney", matches: exact("/train-chroney") },
      { key: "faqs", label: "FAQs", href: "/admin/faqs", matches: exact("/admin/faqs") },
      { key: "website", label: "Website scan", href: "/admin/about", matches: exact("/admin/about") },
      { key: "links", label: "Web links", href: "/admin/url-training", matches: exact("/admin/url-training") },
      { key: "documents", label: "Documents", href: "/admin/scan-docs", matches: exact("/admin/scan-docs") },
      { key: "journeys", label: "Journeys", href: "/conversation-journeys", matches: exact("/conversation-journeys") },
      { key: "suggestions", label: "Suggestions", href: "/ai-insights", matches: exact("/ai-insights") },
      { key: "gaps", label: "Unanswered questions", href: "/question-bank", matches: exact("/question-bank") },
    ],
  },
  {
    id: "products",
    label: "Products",
    kind: "Shared by every agent",
    icon: Package,
    tint: "bg-amber-600",
    description: "What your agents can recommend.",
    visible: a => a.products,
    tabs: [
      { key: "catalog", label: "Catalog", href: "/admin/products", matches: exact("/admin/products") },
      { key: "import", label: "Import from Excel", href: "/products/import-excel", matches: exact("/products/import-excel") },
      { key: "shopify", label: "Shopify", href: "/admin/shopify", matches: exact("/admin/shopify"), visible: a => a.shopify },
    ],
  },
  {
    id: "appointments",
    label: "Appointments",
    kind: "Shared by every agent",
    icon: CalendarDays,
    tint: "bg-teal-600",
    description: "Bookings made by your agents, and the hours people can book.",
    visible: a => a.appointments,
    tabs: [{ key: "calendar", label: "Calendar", href: "/admin/calendar", matches: exact("/admin/calendar") }],
  },
  {
    id: "orders",
    label: "Demo orders",
    kind: "Shared by every agent",
    icon: PackageOpen,
    tint: "bg-slate-500",
    description: "Sample orders your agents can look up when someone asks about an order.",
    visible: a => a.orders,
    tabs: [{ key: "orders", label: "Orders", href: "/admin/demo-orders", matches: exact("/admin/demo-orders") }],
  },
];

export const SIDEBAR_GROUPS: { label?: string; areas: HubAreaId[] }[] = [
  { areas: ["leads"] },
  { label: "AI agents", areas: ["website", "whatsapp", "instagram", "facebook", "calls", "vista"] },
  { label: "Shared by every agent", areas: ["training", "products", "appointments", "orders"] },
];

export function hubArea(id: HubAreaId): HubArea {
  return HUB_AREAS.find(a => a.id === id)!;
}

export function visibleTabs(area: HubArea, access: HubAccess): HubTab[] {
  return area.tabs.filter(t => (t.visible ? t.visible(access) : true) && (t.key !== "settings" || visibleSettings(area, access).length > 0 || area.id === "calls"));
}

export function visibleSettings(area: HubArea, access: HubAccess): HubSettingsItem[] {
  return (area.settings ?? []).filter(s => (s.visible ? s.visible(access) : true) && (!s.superAdminOnly || access.isSuperAdminViewing));
}

/** Which area, tab and settings item own this address. */
export function findHubLocation(location: string, access: HubAccess): { area: HubArea; tab: HubTab | null; settingsItem: HubSettingsItem | null } | null {
  for (const area of HUB_AREAS) {
    if (!area.visible(access)) continue;
    for (const item of visibleSettings(area, access)) {
      if (item.leavesArea) continue;
      if ((item.href && location === item.href) || item.alsoMatches?.(location) || location === settingsPath(area.id, item.key)) {
        return { area, tab: area.tabs.find(t => t.key === "settings") ?? null, settingsItem: item };
      }
    }
    const tab = visibleTabs(area, access).find(t => t.matches(location));
    if (tab) return { area, tab, settingsItem: null };
    if (area.alsoMatches?.(location)) return { area, tab: null, settingsItem: null };
  }
  return null;
}

/** Address a settings item opens at. */
export function settingsItemHref(area: HubArea, item: HubSettingsItem): string {
  return item.href ?? settingsPath(area.id, item.key);
}
