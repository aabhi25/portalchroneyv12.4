import type { LucideIcon } from "lucide-react";
import {
  UserCog, Gauge, Globe, MessageSquare, Camera, MessageCircle, Link2, EyeOff, ShieldCheck,
  KeyRound, Tag, SlidersHorizontal, Sparkles, Route, Contact, MessageSquareText,
} from "lucide-react";
import type { MeResponseDto } from "@shared/dto";
import Settings from "@/pages/Settings";
import WidgetSettings from "@/pages/WidgetSettings";
import WhatsApp from "@/pages/WhatsApp";
import WhatsAppAISetup from "@/pages/WhatsAppAISetup";
import WhatsAppFlowSettings from "@/pages/WhatsAppFlowSettings";
import InstagramSettings from "@/pages/InstagramSettings";
import InstagramLeads from "@/pages/InstagramLeads";
import InstagramCommentSettings from "@/pages/InstagramCommentSettings";
import FacebookSettings from "@/pages/FacebookSettings";
import FacebookCommentSettings from "@/pages/FacebookCommentSettings";
import OtpSettings from "@/pages/OtpSettings";
import CategorySettings from "@/pages/CategorySettings";
import VisualSearchSettings from "@/pages/VisualSearchSettings";
import { UsageDashboard } from "@/components/usage/UsageDashboard";
import IntegrationsSettings, { visibleIntegrationTabs, type IntegrationsAccess } from "./IntegrationsSettings";
import DataRetentionSettings from "./DataRetentionSettings";
import { SETTINGS_PATHS } from "./settingsPaths";

export type SettingsGroupId = "account" | "channels" | "integrations" | "privacy" | "other";

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

  const channels: SettingsItem[] = [];
  if (a.hasWebsiteChat) {
    channels.push({
      key: "website",
      subgroup: "Website",
      label: "Chat widget",
      description: "Design and customize the website chat widget",
      icon: Globe,
      path: SETTINGS_PATHS.website,
      wide: true,
      render: () => <WidgetSettings />,
    });
  }
  if (a.hasWhatsapp) {
    channels.push(
      {
        key: "whatsapp-connection",
        subgroup: "WhatsApp",
        label: "Connection",
        description: "Credentials, webhook and the master switch",
        icon: MessageSquare,
        path: SETTINGS_PATHS.whatsappConnection,
        render: () => <WhatsApp embeddedPage="config" />,
      },
      {
        key: "whatsapp-ai-replies",
        subgroup: "WhatsApp",
        label: "AI replies",
        description: "How messages get answered, and what the AI knows",
        icon: Sparkles,
        path: SETTINGS_PATHS.whatsappAiReplies,
        render: () => <WhatsAppAISetup />,
      },
      {
        key: "whatsapp-flow-settings",
        subgroup: "WhatsApp",
        label: "Flow settings",
        description: "Global settings for guided journeys and document types",
        icon: Route,
        path: SETTINGS_PATHS.whatsappFlowSettings,
        render: () => <WhatsAppFlowSettings />,
      },
      {
        key: "whatsapp-lead-capture",
        subgroup: "WhatsApp",
        label: "Lead capture",
        description: "Which details are extracted from incoming messages",
        icon: Contact,
        path: SETTINGS_PATHS.whatsappLeadCapture,
        render: () => <WhatsApp embeddedPage="lead-capture-settings" />,
      },
    );
  }
  if (a.hasInstagram) {
    channels.push(
      {
        key: "instagram-connection",
        subgroup: "Instagram",
        label: "Connection",
        description: "Webhook, access token and AI agent settings",
        icon: Camera,
        path: SETTINGS_PATHS.instagramConnection,
        render: () => <InstagramSettings embedded />,
      },
      {
        key: "instagram-lead-capture",
        subgroup: "Instagram",
        label: "Lead capture",
        description: "Which details are extracted from Instagram messages",
        icon: Contact,
        path: SETTINGS_PATHS.instagramLeadCapture,
        render: () => <InstagramLeads embeddedPage="lead-capture-settings" />,
      },
      {
        key: "instagram-comments",
        subgroup: "Instagram",
        label: "Comment replies",
        description: "Automatic replies to comments on your posts",
        icon: MessageSquareText,
        path: SETTINGS_PATHS.instagramComments,
        render: () => <InstagramCommentSettings embedded />,
      },
    );
  }
  if (a.hasFacebook) {
    channels.push(
      {
        key: "facebook-connection",
        subgroup: "Facebook",
        label: "Connection",
        description: "Webhook, page token and AI agent settings",
        icon: MessageCircle,
        path: SETTINGS_PATHS.facebookConnection,
        render: () => <FacebookSettings embedded />,
      },
      {
        key: "facebook-comments",
        subgroup: "Facebook",
        label: "Comment replies",
        description: "Automatic replies to comments on your page",
        icon: MessageSquareText,
        path: SETTINGS_PATHS.facebookComments,
        render: () => <FacebookCommentSettings embedded />,
      },
    );
  }
  if (channels.length) groups.push({ id: "channels", label: "Channels", items: channels });

  if (visibleIntegrationTabs(a.integrations).length > 0) {
    const access = a.integrations;
    groups.push({
      id: "integrations",
      label: "Integrations",
      items: [
        {
          key: "integrations",
          label: access.crm ? "CRM & integrations" : "Integrations",
          description: access.crm
            ? "LeadSquared, Salesforce, custom CRM and other connected systems"
            : "Connected systems for your products",
          icon: Link2,
          path: SETTINGS_PATHS.integrations,
          matchPrefix: true,
          render: () => <IntegrationsSettings access={access} />,
        },
      ],
    });
  }

  const privacy: SettingsItem[] = [
    {
      key: "lead-privacy",
      label: "Lead export & masking",
      description: "Who can export leads, and whether phone numbers are masked",
      icon: EyeOff,
      path: SETTINGS_PATHS.leadPrivacy,
      render: () => <Settings section="lead-privacy" embedded />,
    },
    {
      key: "data-retention",
      label: "Data retention",
      description: "How long leads and chats are kept before auto-delete",
      icon: ShieldCheck,
      path: SETTINGS_PATHS.dataRetention,
      render: () => <DataRetentionSettings user={user} />,
    },
  ];
  if (a.hasWebsiteChat) {
    privacy.push({
      key: "otp",
      label: "OTP / SMS verification",
      description: "MSG91 credentials and the OTP message visitors receive",
      icon: KeyRound,
      path: SETTINGS_PATHS.otp,
      render: () => <OtpSettings embedded />,
    });
  }
  groups.push({ id: "privacy", label: "Lead privacy & data", items: privacy });

  const other: SettingsItem[] = [];
  if (a.hasWebsiteChat) {
    other.push({
      key: "conversation-categories",
      label: "Conversation categories",
      description: "How the AI classifies conversations in Insights",
      icon: Tag,
      path: SETTINGS_PATHS.conversationCategories,
      render: () => <CategorySettings embedded />,
    });
  }
  if (a.hasJewelry) {
    other.push({
      key: "visual-search",
      label: "Visual search",
      description: "Match thresholds and similarity labels for visual product search",
      icon: SlidersHorizontal,
      path: SETTINGS_PATHS.visualSearch,
      render: () => <VisualSearchSettings embedded />,
    });
  }
  if (other.length) groups.push({ id: "other", label: "Other", items: other });

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
