import type { LucideIcon } from "lucide-react";
import { UserCog, Gauge, Link2 } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";
import Settings from "@/pages/Settings";
import { UsageDashboard } from "@/components/usage/UsageDashboard";
import IntegrationsSettings, { visibleIntegrationTabs, type IntegrationsAccess } from "./IntegrationsSettings";
import { SETTINGS_PATHS } from "./settingsPaths";

export type SettingsGroupId = "account" | "integrations";

export interface SettingsItem {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Hub path. Omitted for items that only link out (see `href`). */
  path?: string;
  /** Link to a page outside the hub instead of rendering inside it. */
  href?: string;
  /** Sub-heading inside the group (e.g. the channel name). */
  subgroup?: string;
  /** Also owns sub-paths (e.g. integration tabs). */
  matchPrefix?: boolean;
  /** Needs the full content width, so the hub's side navigation is replaced by a back link. */
  wide?: boolean;
  render?: () => JSX.Element;
}

export interface SettingsGroup {
  id: SettingsGroupId;
  label: string;
  items: SettingsItem[];
}

/**
 * Feature access for the Settings hub. Derived the same way AppSidebar derives it, so the hub
 * never offers a screen the sidebar would hide.
 */
export function getSettingsAccess(user: MeResponseDto | null) {
  const role = user?.role;
  const isSuperAdmin = role === "super_admin";
  const isSuperAdminImpersonating = isSuperAdmin && !!user?.activeBusinessAccountId;
  const isGroupAdmin = role === "account_group_admin";
  const isBusinessView = (!isSuperAdmin && !isGroupAdmin) || isSuperAdminImpersonating;

  const ba = user?.businessAccount;
  const productTier = ba?.productTier || "chroney";
  const hasChroney = ba?.chroneyEnabled === true;
  const hasWhatsapp = ba?.whatsappEnabled === true;
  const hasInstagram = ba?.instagramEnabled === true;
  const hasFacebook = ba?.facebookEnabled === true;
  const hasJewelry = productTier === "jewelry_showcase" || productTier === "jewelry_showcase_chroney";
  const isK12 = ba?.k12EducationEnabled === true;
  const isJobPortal = ba?.jobPortalEnabled === true;
  const hasProductsAccess = hasChroney || hasWhatsapp || hasJewelry;
  // The website widget is what the Website agent, K12 and job-portal layouts all expose.
  const hasWebsiteChat = hasChroney || isK12 || isJobPortal;

  const integrations: IntegrationsAccess = {
    crm: hasChroney || hasWhatsapp || hasInstagram || hasFacebook || isK12 || isJobPortal,
    shopify: ba?.shopifyEnabled === true && hasProductsAccess,
    erp: hasJewelry,
  };

  return {
    isSuperAdminImpersonating, isGroupAdmin, isBusinessView,
    hasChroney, hasWhatsapp, hasInstagram, hasFacebook, hasJewelry, hasWebsiteChat, integrations,
  };
}

export function buildSettingsGroups(user: MeResponseDto | null): SettingsGroup[] {
  const a = getSettingsAccess(user);

  // Group admins have their own dashboard; they only get personal account settings here.
  if (a.isGroupAdmin) {
    return [
      {
        id: "account",
        label: "Account",
        items: [
          {
            key: "account",
            label: "Account & password",
            description: "Change your password",
            icon: UserCog,
            path: SETTINGS_PATHS.account,
            render: () => <Settings section="account" embedded />,
          },
        ],
      },
    ];
  }

  if (!a.isBusinessView) return [];

  const groups: SettingsGroup[] = [];

  groups.push({
    id: "account",
    label: "Account",
    items: [
      {
        key: "account",
        label: "Account & password",
        description: "Password and account-wide preferences",
        icon: UserCog,
        path: SETTINGS_PATHS.account,
        render: () => <Settings section="account" embedded />,
      },
      // AI spend is for super admins only (viewing as the account); business users never see it.
      ...(a.isSuperAdminImpersonating ? [{
        key: "usage",
        label: "AI usage & limits",
        description: "AI usage and spend this month, by channel",
        icon: Gauge,
        path: SETTINGS_PATHS.usage,
        render: () => <UsageDashboard />,
      }] : []),
    ],
  });

  if (visibleIntegrationTabs(a.integrations).length > 0) {
    const access = a.integrations;
    groups.push({
      id: "integrations",
      label: "Connected apps",
      items: [
        {
          key: "integrations",
          label: "Connected apps",
          description: access.crm
            ? "LeadSquared, Salesforce, custom CRM and other systems every agent uses"
            : "Systems your products come from",
          icon: Link2,
          path: SETTINGS_PATHS.integrations,
          matchPrefix: true,
          render: () => <IntegrationsSettings access={access} />,
        },
      ],
    });
  }

  return groups;
}

/** The hub item that owns `location`, if any. */
export function findSettingsItem(groups: SettingsGroup[], location: string): { group: SettingsGroup; item: SettingsItem } | null {
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.path) continue;
      if (location === item.path || (item.matchPrefix && location.startsWith(item.path + "/"))) {
        return { group, item };
      }
    }
  }
  return null;
}
