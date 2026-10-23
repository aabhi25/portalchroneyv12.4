import type { LucideIcon } from "lucide-react";
import {
  Sparkles, Route, Zap, MessagesSquare, Contact, BarChart3, Link2,
  UsersRound, FileCode2, Megaphone, Settings, ShieldCheck, Table2, Store,
} from "lucide-react";
import { SETTINGS_PATHS } from "@/pages/settings/settingsPaths";

/**
 * The one definition of what lives where in the WhatsApp area.
 *
 * The Campaigns pills in the WhatsApp area (navigation/hubAreas.ts) are built from CAMPAIGN_ITEMS
 * here; the Journeys pills are defined there. Before this existed there were two hand-maintained
 * sidebar layouts that had drifted apart, showing different screens under different names.
 *
 * The three sections are not a cosmetic grouping. They reflect a real split in the data:
 *
 *   Lead Gen   people message you; the AI answers and captures their details. Conversations,
 *              Leads and Insights all read the inbound lead tables exclusively.
 *   Campaigns  you start the conversation, in bulk. Campaign replies are written to a separate
 *              transcript and can never become leads, and each campaign carries its own AI
 *              persona and knowledge settings rather than using the Lead Gen ones.
 *   Setup      the connection itself, plus the settings that gate both of the above.
 *
 * Allowed Numbers belongs in Setup, not Lead Gen, despite looking like an inbound feature. It is
 * the first gate an incoming message hits — ahead of campaign handling — so switching it on
 * blocks campaign replies too. Filing it under Lead Gen would hide it from precisely the person
 * about to be surprised by it.
 */

export type WhatsappSectionId = "lead-gen" | "campaigns" | "setup";

/** Mirrors the server's readiness payload. Booleans and counts only — never credentials. */
export interface WhatsappReadiness {
  inboundReady: boolean;
  credentialsConfigured: boolean;
  connectionVerified: boolean;
  lastInboundAt: string | null;
  masterSwitchOn: boolean;
  autoReplyEnabled: boolean;
  aiAvailable: boolean;
  responseMode: string | null;
  allowlistEnabled: boolean;
  allowedNumberCount: number;
  blockingAllInbound: boolean;
  sessionTemplateConfigured: boolean;
  activeFlowCount: number;
  smartReplyCount: number;
  marketing: {
    usableTemplates: number;
    totalTemplates: number;
    usableAudiences: number;
    totalAudiences: number;
    canSend: boolean;
  } | null;
  problems: {
    id: string;
    severity: "blocking" | "warning";
    /** Which section resolves this. Decided server-side so the client never re-derives it. */
    section: WhatsappSectionId;
    title: string;
    consequence: string;
    fixHref: string;
    fixLabel: string;
  }[];
}

/** Display names, so a problem can say which section fixes it without re-deriving anything. */
export const WHATSAPP_SECTION_LABELS: Record<WhatsappSectionId, string> = {
  "lead-gen": "Replies",
  campaigns: "Campaigns",
  setup: "Settings",
};

export interface WhatsappNavItem {
  key: string;
  /** Sidebar label. Kept short. */
  label: string;
  /** Overview-page title when it should differ from the sidebar label (e.g. step numbering). */
  hubTitle?: string;
  /** One line explaining what the screen is for, shown on the overview page. */
  description: string;
  href: string;
  icon: LucideIcon;
  /** Previous label, so people who learned the old name can still recognise the screen. */
  formerly?: string;
  hubTestId?: string;
  sidebarTestId?: string;
  /** Sidebar icon treatment. */
  gradient: string;
  /** Overview-page icon treatment. */
  tone: string;
  /** Whether this item owns the given location, including its sub-routes. */
  matches: (location: string) => boolean;
  /** Short reason this cannot be used yet. The item stays reachable so it can explain itself. */
  blocked?: (r: WhatsappReadiness) => string | undefined;
}

export interface WhatsappSection {
  id: WhatsappSectionId;
  label: string;
  blurb: string;
  items: WhatsappNavItem[];
}

const LEAD_GEN_ITEMS: WhatsappNavItem[] = [
  {
    key: "leads",
    label: "Leads",
    description: "People whose details were captured",
    href: "/admin/whatsapp-leads",
    icon: Contact,
    sidebarTestId: "link-wa-leads",
    gradient: "bg-gradient-to-br from-blue-500 to-indigo-600",
    tone: "bg-green-50 group-hover:bg-green-100",
    matches: l => l === "/admin/whatsapp-leads" || l === "/admin/whatsapp-lead-capture-settings",
  },
  {
    key: "conversations",
    label: "Conversations",
    description: "Every chat, and what was said",
    href: "/admin/whatsapp-conversations",
    icon: MessagesSquare,
    sidebarTestId: "link-wa-conversations",
    gradient: "bg-gradient-to-br from-green-500 to-emerald-600",
    tone: "bg-blue-50 group-hover:bg-blue-100",
    matches: l => l === "/admin/whatsapp-conversations",
  },
  {
    key: "insights",
    label: "Insights",
    // Deliberately explicit. This screen contains no campaign metrics whatsoever, and sitting in
    // a neutral position previously implied it covered everything.
    description: "Volumes and trends for incoming messages",
    href: "/admin/wa-insights",
    icon: BarChart3,
    sidebarTestId: "link-wa-insights",
    gradient: "bg-gradient-to-br from-orange-500 to-amber-600",
    tone: "bg-orange-50 group-hover:bg-orange-100",
    matches: l => l === "/admin/wa-insights",
  },
  {
    key: "ai-setup",
    label: "AI replies",
    description: "How messages get answered, and what the AI knows",
    href: "/admin/whatsapp-ai-setup",
    icon: Sparkles,
    formerly: "AI Setup",
    hubTestId: "card-ai-setup",
    sidebarTestId: "link-wa-ai-setup",
    gradient: "bg-gradient-to-br from-purple-500 to-violet-600",
    tone: "bg-purple-50 group-hover:bg-purple-100",
    matches: l => l === "/admin/whatsapp-ai-setup",
    blocked: r => (!r.autoReplyEnabled ? "Auto-reply is off" : undefined),
  },
  {
    key: "flows",
    label: "Journeys",
    description: "Scripted button menus — no AI involved",
    href: "/admin/whatsapp-flows",
    icon: Route,
    formerly: "Guided journeys · AI Flows",
    sidebarTestId: "link-wa-flows",
    gradient: "bg-gradient-to-br from-purple-500 to-violet-600",
    tone: "bg-purple-50 group-hover:bg-purple-100",
    matches: l => l === "/admin/whatsapp-flows" || l === "/admin/whatsapp-flow-settings",
    blocked: r => (r.responseMode === "smart_ai" ? "Skipped — reply mode is Smart AI" : undefined),
  },
  {
    key: "dealers-stores",
    label: "Dealers & stores",
    description: "Dealers, stores and EMI schemes used by your journey dropdowns and CRM",
    href: "/admin/whatsapp-dealers-stores",
    icon: Store,
    sidebarTestId: "link-wa-dealers-stores",
    gradient: "bg-gradient-to-br from-teal-500 to-emerald-600",
    tone: "bg-teal-50 group-hover:bg-teal-100",
    matches: l => l === "/admin/whatsapp-dealers-stores",
  },
  {
    key: "smart-replies",
    label: "Keyword replies",
    description: "Fixed answers triggered by words",
    href: "/admin/whatsapp-smart-replies",
    icon: Zap,
    formerly: "Smart Replies",
    sidebarTestId: "link-wa-smart-replies",
    gradient: "bg-gradient-to-br from-amber-500 to-orange-600",
    tone: "bg-amber-50 group-hover:bg-amber-100",
    matches: l => l === "/admin/whatsapp-smart-replies",
  },
  {
    key: "allowed-numbers",
    label: "Allowed numbers",
    description: "Restrict who gets a reply — affects campaigns too",
    href: "/admin/whatsapp-whitelist",
    icon: ShieldCheck,
    formerly: "Whitelist",
    sidebarTestId: "link-wa-whitelist",
    gradient: "bg-gradient-to-br from-teal-500 to-emerald-600",
    tone: "bg-teal-50 group-hover:bg-teal-100",
    matches: l => l === "/admin/whatsapp-whitelist",
    blocked: r => (r.blockingAllInbound ? "Blocking every message" : undefined),
  },
];

// The four campaign screens, shown as pills under the Campaigns tab. Campaigns comes first so it
// is the tab's default entry; while nothing has been sent it shows the getting-started steps
// (audience, template, first campaign) above the list.
//
// Replies, Results and Automations are reached from the Campaigns screen rather than having a
// pill each: they are views of campaigns, not separate jobs. Opt-outs are a list of people, so
// they sit under Audiences as the "Do not message" list.
const CAMPAIGN_SCREENS_UNDER_CAMPAIGNS = [
  "/admin/whatsapp-campaign-home",
  "/admin/whatsapp-campaign-conversations",
  "/admin/whatsapp-campaign-replies",
  "/admin/whatsapp-campaign-results",
];
const CAMPAIGN_ITEMS: WhatsappNavItem[] = [
  {
    key: "campaigns",
    label: "Campaigns",
    description: "Send to an audience and let AI handle replies",
    href: "/admin/whatsapp-campaigns",
    icon: Megaphone,
    formerly: "All campaigns · Campaigns home · Campaign replies · Results · Automations",
    hubTestId: "card-wa-campaigns",
    sidebarTestId: "link-wa-campaigns",
    gradient: "bg-gradient-to-br from-emerald-500 to-green-600",
    tone: "bg-emerald-50 group-hover:bg-emerald-100",
    matches: l =>
      l.startsWith("/admin/whatsapp-campaigns") ||
      l.startsWith("/admin/whatsapp-campaign-automations") ||
      CAMPAIGN_SCREENS_UNDER_CAMPAIGNS.includes(l),
    blocked: r => (r.marketing && !r.marketing.canSend ? "Needs an audience and a template first" : undefined),
  },
  {
    key: "contact-groups",
    label: "Audiences",
    description: "Lists of people to message, and the Do not message list",
    href: "/admin/whatsapp-contact-groups",
    icon: UsersRound,
    formerly: "Contact Groups · Opt-outs · Do not message",
    hubTestId: "card-wa-contact-groups",
    sidebarTestId: "link-wa-contact-groups",
    gradient: "bg-gradient-to-br from-teal-500 to-cyan-600",
    tone: "bg-teal-50 group-hover:bg-teal-100",
    matches: l =>
      l.startsWith("/admin/whatsapp-contact-groups") ||
      l === "/admin/whatsapp-audiences" ||
      l.startsWith("/admin/whatsapp-opt-outs"),
    blocked: r =>
      r.marketing && r.marketing.usableAudiences === 0
        ? r.marketing.totalAudiences === 0
          ? "None yet"
          : "All empty"
        : undefined,
  },
  {
    key: "ai-workbooks",
    label: "AI Workbooks",
    description: "People with their own details; campaign results flow back in",
    href: "/admin/whatsapp-ai-workbooks",
    icon: Table2,
    sidebarTestId: "link-wa-ai-workbooks",
    gradient: "bg-gradient-to-br from-purple-500 to-violet-600",
    tone: "bg-purple-50 group-hover:bg-purple-100",
    matches: l => l.startsWith("/admin/whatsapp-ai-workbooks"),
  },
  {
    key: "templates",
    label: "Templates",
    description: "Pre-approved messages WhatsApp will deliver",
    href: "/admin/whatsapp-templates",
    icon: FileCode2,
    hubTestId: "card-wa-templates",
    sidebarTestId: "link-wa-templates",
    gradient: "bg-gradient-to-br from-emerald-500 to-teal-600",
    tone: "bg-emerald-50 group-hover:bg-emerald-100",
    matches: l => l.startsWith("/admin/whatsapp-templates"),
    blocked: r =>
      r.marketing && r.marketing.usableTemplates === 0
        ? r.marketing.totalTemplates === 0
          ? "None yet"
          : "None approved"
        : undefined,
  },
];

// Setup lives in the Settings hub (Settings > Channels > WhatsApp). The old /admin/whatsapp-config
// route redirects there, so `matches` only needs the legacy path; the hub supplies its own navigation.
const SETUP_ITEMS: WhatsappNavItem[] = [
  {
    key: "config",
    label: "Connection",
    description: "Credentials, webhook, and the master switch",
    href: SETTINGS_PATHS.whatsappConnection,
    icon: Settings,
    formerly: "Config",
    sidebarTestId: "link-wa-config",
    gradient: "bg-gradient-to-br from-gray-500 to-slate-600",
    tone: "bg-slate-50 group-hover:bg-slate-100",
    matches: l => l === "/admin/whatsapp-config",
    blocked: r => (!r.credentialsConfigured ? "Not connected yet" : undefined),
  },
];

/**
 * The sections, in display order.
 *
 * When marketing is not enabled the Campaigns section is omitted entirely rather than shown in a
 * disabled state — an account that cannot buy the feature should not be shown a permanent
 * advertisement for it in its main navigation.
 */
export function getWhatsappSections(opts: { marketingEnabled: boolean }): WhatsappSection[] {
  const sections: WhatsappSection[] = [
    {
      id: "lead-gen",
      label: "Lead Gen",
      blurb: "People message you. The AI answers and captures their details.",
      items: LEAD_GEN_ITEMS,
    },
  ];

  if (opts.marketingEnabled) {
    sections.push({
      id: "campaigns",
      label: "Campaigns",
      blurb: "You start the conversation, in bulk. Work through these in order.",
      items: CAMPAIGN_ITEMS,
    });
  }

  sections.push({
    id: "setup",
    label: "Setup",
    blurb: "The connection itself, and the settings that affect everything above.",
    items: SETUP_ITEMS,
  });

  return sections;
}

/**
 * Where a sidebar section row should land. Marketing-enabled accounts collapse the sidebar to
 * one row per section; clicking it opens the last screen used in that section (falling back to
 * the first), with the section panel alongside.
 */
export function whatsappSectionEntryHref(section: WhatsappSection): string {
  try {
    const last = sessionStorage.getItem(`waSectionLast:${section.id}`);
    if (last && section.items.some(i => i.href === last)) return last;
  } catch {
    // sessionStorage unavailable (privacy mode) — first item is a fine default.
  }
  return section.items[0].href;
}

/** Record which screen of a section the user is on, so the section row returns there. */
export function rememberWhatsappSectionLocation(location: string, sections: WhatsappSection[]): void {
  for (const s of sections) {
    const item = s.items.find(i => i.matches(location));
    if (item) {
      try {
        sessionStorage.setItem(`waSectionLast:${s.id}`, item.href);
      } catch {
        // best-effort only
      }
      return;
    }
  }
}

/** True when the given location belongs to any WhatsApp screen in any section. */
export function isWhatsappLocation(location: string): boolean {
  return (
    location.startsWith("/admin/whatsapp") ||
    location.startsWith("/admin/wa-")
  );
}
