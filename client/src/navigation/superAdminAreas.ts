import type { LucideIcon } from "lucide-react";
import {
  Building2, Link2, Presentation, Sunrise, ClipboardList, Gauge, Bot, Database, Server, ScrollText, UserCog,
} from "lucide-react";

/**
 * The super admin side, in one map: the sidebar groups, each area's tabs, and what "Find" can jump to.
 * SuperAdminFrame draws the area name and tabs above the page; detail pages (one account, one group)
 * draw their own header with SaHeader. Old addresses redirect in App.tsx.
 */

export interface SaTab {
  key: string;
  label: string;
  href: string;
  /** The page scrolls itself and fills the screen (e.g. Live logs). */
  fill?: boolean;
}

export type SaGroup = "Customers" | "Reports" | "Platform";

export interface SaArea {
  id: string;
  label: string;
  /** Small label above the title, e.g. "Platform". */
  kind: string;
  icon: LucideIcon;
  tint: string;
  group: SaGroup | null;
  href: string;
  tabs: SaTab[];
  /** Detail pages under this area (they draw their own header). */
  detail?: RegExp;
  /** Old names, so "Find" still understands them. */
  formerly?: string;
}

export const SA_AREAS: SaArea[] = [
  {
    id: "accounts", label: "Accounts", kind: "Customers", icon: Building2, tint: "bg-violet-600", group: "Customers",
    href: "/super-admin",
    tabs: [{ key: "all", label: "All accounts", href: "/super-admin" }],
    detail: /^\/super-admin\/accounts\/[^/]+/,
    formerly: "Business accounts · new account",
  },
  {
    id: "groups", label: "Account groups", kind: "Customers", icon: Link2, tint: "bg-indigo-600", group: "Customers",
    href: "/super-admin/account-groups",
    tabs: [{ key: "all", label: "All groups", href: "/super-admin/account-groups" }],
    detail: /^\/super-admin\/account-groups\/[^/]+/,
    formerly: "Group admins · group training · group insights · LeadSquared sync",
  },
  {
    id: "demos", label: "Demo pages", kind: "Customers", icon: Presentation, tint: "bg-amber-500", group: "Customers",
    href: "/super-admin/demo",
    tabs: [{ key: "all", label: "All demo pages", href: "/super-admin/demo" }],
    formerly: "Demo",
  },
  {
    id: "today", label: "Today", kind: "Reports", icon: Sunrise, tint: "bg-sky-600", group: "Reports",
    href: "/super-admin/today",
    tabs: [{ key: "today", label: "At a glance", href: "/super-admin/today" }],
    formerly: "Overview · dashboard · alerts",
  },
  {
    id: "mis", label: "MIS report", kind: "Reports", icon: ClipboardList, tint: "bg-fuchsia-600", group: "Reports",
    href: "/super-admin/mis",
    tabs: [{ key: "mtd", label: "Month to date", href: "/super-admin/mis" }],
    formerly: "MIS · partners · PDF",
  },
  {
    id: "spend", label: "AI spend & limits", kind: "Reports", icon: Gauge, tint: "bg-emerald-600", group: "Reports",
    href: "/super-admin/usage",
    tabs: [
      { key: "accounts", label: "By account", href: "/super-admin/usage" },
      { key: "breakdown", label: "Breakdown", href: "/super-admin/costs" },
    ],
    formerly: "Usage & Limits · Cost Analytics · monthly limit · tokens",
  },
  {
    id: "providers", label: "AI providers", kind: "Platform", icon: Bot, tint: "bg-cyan-600", group: "Platform",
    href: "/super-admin/ai-providers",
    tabs: [
      { key: "chat", label: "Chat", href: "/super-admin/ai-providers" },
      { key: "avatar", label: "Live avatar", href: "/super-admin/ai-providers/avatar" },
      { key: "photo", label: "Photo search", href: "/super-admin/ai-providers/photo-search" },
    ],
    formerly: "Chat APIs · master keys · fallback · HeyGen · Anam · Gemini platform key",
  },
  {
    id: "backups", label: "Backups & storage", kind: "Platform", icon: Database, tint: "bg-blue-600", group: "Platform",
    href: "/super-admin/backups",
    tabs: [
      { key: "cloud", label: "Cloud backups", href: "/super-admin/backups" },
      { key: "download", label: "Download", href: "/super-admin/backups/download" },
      { key: "storage", label: "Storage", href: "/super-admin/backups/storage" },
      { key: "index", label: "Search index", href: "/super-admin/backups/search-index" },
    ],
    formerly: "Database backup · restore · R2 storage · FAQ embeddings · product embeddings",
  },
  {
    id: "server", label: "Server", kind: "Platform", icon: Server, tint: "bg-slate-600", group: "Platform",
    href: "/super-admin/server-info",
    tabs: [
      { key: "status", label: "Status", href: "/super-admin/server-info" },
      { key: "logs", label: "Live logs", href: "/super-admin/live-logs", fill: true },
    ],
    formerly: "Server Info · outbound IP · Live Logs · console",
  },
  {
    id: "audit", label: "Audit log", kind: "Platform", icon: ScrollText, tint: "bg-zinc-700", group: "Platform",
    href: "/super-admin/audit-logs",
    tabs: [{ key: "all", label: "Activity", href: "/super-admin/audit-logs" }],
    formerly: "Audit Logs · logins · exports",
  },
  {
    id: "me", label: "My account", kind: "Your login", icon: UserCog, tint: "bg-gray-600", group: null,
    href: "/super-admin/settings",
    tabs: [{ key: "password", label: "Password", href: "/super-admin/settings" }],
    formerly: "Settings · change password",
  },
];

export const SA_GROUPS: SaGroup[] = ["Customers", "Reports", "Platform"];

export function saArea(id: string): SaArea {
  return SA_AREAS.find(a => a.id === id)!;
}

/** The area (and tab) a super admin address belongs to. */
export function findSaLocation(path: string): { area: SaArea; tab: SaTab | null; isDetail: boolean } | null {
  const clean = path.replace(/\/+$/, "") || "/";
  for (const area of SA_AREAS) {
    if (area.detail?.test(clean)) return { area, tab: null, isDetail: true };
  }
  for (const area of SA_AREAS) {
    const tab = area.tabs.find(t => t.href === clean);
    if (tab) return { area, tab, isDetail: false };
  }
  return null;
}

/** Tabs on one business account's page (/super-admin/accounts/:id/...). */
export const ACCOUNT_TABS = [
  { key: "overview", label: "Overview" },
  { key: "features", label: "Features" },
  { key: "keys", label: "AI & keys" },
  { key: "avatar", label: "Live avatar" },
  { key: "usage", label: "Usage & limit" },
  { key: "privacy", label: "Data & privacy" },
  { key: "details", label: "Details & login" },
  { key: "demos", label: "Demo pages" },
] as const;
export type AccountTabKey = typeof ACCOUNT_TABS[number]["key"];

export function accountHref(id: string, tab: AccountTabKey = "overview"): string {
  return tab === "overview" ? `/super-admin/accounts/${id}` : `/super-admin/accounts/${id}/${tab}`;
}

/** Tabs on one account group's page (/super-admin/account-groups/:id/...). */
export const GROUP_TABS = [
  { key: "overview", label: "Accounts & admins" },
  { key: "insights", label: "Insights" },
  { key: "training", label: "Training" },
  { key: "privacy", label: "Auto-delete" },
] as const;
export type GroupTabKey = typeof GROUP_TABS[number]["key"];

export function groupHref(id: string, tab: GroupTabKey = "overview"): string {
  return tab === "overview" ? `/super-admin/account-groups/${id}` : `/super-admin/account-groups/${id}/${tab}`;
}
