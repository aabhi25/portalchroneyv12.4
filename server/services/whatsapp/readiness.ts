/**
 * Server-computed readiness summary for the WhatsApp hub.
 *
 * Why this lives on the server rather than being assembled in the browser:
 *
 *  - Several inputs are counts the client has no business fetching (allowed numbers,
 *    approved templates, contacts per group). Aggregating them client-side would mean
 *    shipping more data to the browser, not less.
 *  - It must agree with the campaign endpoints about what "usable" means. Those definitions
 *    live in campaignPrerequisites and are imported here rather than restated.
 *  - It returns only booleans, counts and status labels. No credential value ever appears in
 *    this payload.
 *
 * The distinction between `credentialsConfigured` and `connectionVerified` is deliberate.
 * Having an auth key stored proves only that somebody typed something into a form. Claiming
 * the integration is "connected" on that basis is how a broken setup ends up displaying a
 * green tick. Verification requires evidence that a real message actually arrived.
 */
import { db } from "../../db";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  whatsappWhitelist,
  whatsappSessions,
  whatsappFlows,
  whatsappTemplates,
  contactGroups,
  smartReplies,
  businessAccounts,
} from "../../../shared/schema";
import { countUsableTemplates, countUsableAudiences } from "./campaignPrerequisites";

/**
 * Which part of the WhatsApp area resolves a problem.
 *
 * Decided here rather than in the browser so the overview page and the sidebar cannot disagree
 * about whose fault something is, and so adding a new problem forces the author to say where it
 * belongs instead of leaving it to be guessed from the fix link.
 */
export type WhatsappSectionId = "lead-gen" | "campaigns" | "setup";

export type ReadinessProblem = {
  id: string;
  /** `blocking` means WhatsApp is not working right now. `warning` means it is degraded. */
  severity: "blocking" | "warning";
  /** The section a user must go to in order to fix this. */
  section: WhatsappSectionId;
  title: string;
  /** What actually happens to the user's business because of this. */
  consequence: string;
  fixHref: string;
  fixLabel: string;
};

export type WhatsappReadiness = {
  /** True once the account has everything needed to receive and reply to a message. */
  inboundReady: boolean;
  /** Credentials are filled in. Says nothing about whether they work. */
  credentialsConfigured: boolean;
  /** A real inbound message has been seen. This is the only honest "it works" signal. */
  connectionVerified: boolean;
  lastInboundAt: string | null;
  masterSwitchOn: boolean;
  autoReplyEnabled: boolean;
  aiAvailable: boolean;
  responseMode: string | null;
  allowlistEnabled: boolean;
  allowedNumberCount: number;
  /** The silent killer: gate on, list empty, every inbound message discarded. */
  blockingAllInbound: boolean;
  sessionTemplateConfigured: boolean;
  activeFlowCount: number;
  smartReplyCount: number;
  /** null when marketing is not enabled for this account — the checks are not even run. */
  marketing: {
    usableTemplates: number;
    totalTemplates: number;
    usableAudiences: number;
    totalAudiences: number;
    canSend: boolean;
  } | null;
  problems: ReadinessProblem[];
};

async function countRows(table: any, businessAccountId: string, extra?: any): Promise<number> {
  const conditions = [eq(table.businessAccountId, businessAccountId)];
  if (extra) conditions.push(extra);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(and(...conditions));
  return row?.n ?? 0;
}

export async function computeWhatsappReadiness(
  businessAccountId: string,
  settings: any,
  opts: { marketingEnabled: boolean },
): Promise<WhatsappReadiness> {
  const [
    allowedNumberCount,
    activeFlowCount,
    smartReplyCount,
    lastSession,
    [businessAccount],
  ] = await Promise.all([
    countRows(whatsappWhitelist, businessAccountId),
    countRows(whatsappFlows, businessAccountId, eq(whatsappFlows.isActive, "true")),
    countRows(smartReplies, businessAccountId),
    db
      .select({ lastUserMessageAt: whatsappSessions.lastUserMessageAt })
      .from(whatsappSessions)
      .where(eq(whatsappSessions.businessAccountId, businessAccountId))
      .orderBy(desc(whatsappSessions.lastUserMessageAt))
      .limit(1),
    db
      .select({ openaiApiKey: businessAccounts.openaiApiKey })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId))
      .limit(1),
  ]);

  // Marketing counts are skipped entirely — not computed and hidden — when the feature is off,
  // so a tenant without marketing never pays for queries about templates it cannot use.
  const marketing = opts.marketingEnabled
    ? await (async () => {
        const [usableTemplates, usableAudiences, totalTemplates, totalAudiences] = await Promise.all([
          countUsableTemplates(businessAccountId),
          countUsableAudiences(businessAccountId),
          countRows(whatsappTemplates, businessAccountId),
          countRows(contactGroups, businessAccountId),
        ]);
        return {
          usableTemplates,
          usableAudiences,
          totalTemplates,
          totalAudiences,
          canSend: usableTemplates > 0 && usableAudiences > 0,
        };
      })()
    : null;

  const credentialsConfigured = Boolean(settings?.msg91AuthKey && settings?.msg91IntegratedNumberId);
  const lastInboundAt = lastSession?.[0]?.lastUserMessageAt ?? null;
  // Evidence, not assumption: a session row only exists because a real message arrived.
  const connectionVerified = Boolean(lastInboundAt);
  const masterSwitchOn = settings?.whatsappEnabled !== "false";
  const autoReplyEnabled = settings?.autoReplyEnabled === "true";
  const aiAvailable = Boolean(businessAccount?.openaiApiKey || process.env.OPENAI_API_KEY);
  const allowlistEnabled = settings?.whitelistEnabled === "true";
  const blockingAllInbound = allowlistEnabled && allowedNumberCount === 0;
  const sessionTemplateConfigured = Boolean(settings?.sessionTemplateName);
  const responseMode = settings?.aiResponseMode ?? null;

  const problems: ReadinessProblem[] = [];

  if (blockingAllInbound) {
    problems.push({
      id: "allowlist_blocking_all",
      section: "setup",
      severity: "blocking",
      title: "Every incoming message is being discarded",
      consequence:
        "Allowed Numbers is switched on but the list is empty, so no message reaches your AI — no leads are captured and nobody gets a reply.",
      fixHref: "/admin/whatsapp-whitelist",
      fixLabel: "Fix allowed numbers",
    });
  }

  if (!credentialsConfigured) {
    problems.push({
      id: "credentials_missing",
      section: "setup",
      severity: "blocking",
      title: "WhatsApp is not connected yet",
      consequence:
        "Without your MSG91 auth key and number, messages cannot be received or sent at all.",
      fixHref: "/admin/whatsapp-config",
      fixLabel: "Add credentials",
    });
  } else if (!connectionVerified) {
    problems.push({
      id: "connection_unverified",
      section: "setup",
      severity: "warning",
      title: "Connected details saved, but no message has arrived yet",
      consequence:
        "Your credentials are filled in, but nothing has come through this number so far. If you have already sent a test message, the webhook URL may not be set correctly in MSG91.",
      fixHref: "/admin/whatsapp-config",
      fixLabel: "Check webhook setup",
    });
  }

  if (!masterSwitchOn) {
    problems.push({
      id: "master_switch_off",
      section: "setup",
      severity: "blocking",
      title: "The WhatsApp agent is switched off",
      consequence: "Incoming messages are received but nothing is processed and no replies are sent.",
      fixHref: "/admin/whatsapp-config",
      fixLabel: "Switch it on",
    });
  }

  if (!autoReplyEnabled) {
    problems.push({
      id: "auto_reply_off",
      section: "lead-gen",
      severity: "warning",
      title: "Automatic replies are off",
      consequence:
        "Messages are captured, but nobody gets an automatic answer. Every conversation waits for a human.",
      fixHref: "/admin/whatsapp-ai-setup",
      fixLabel: "Turn on auto-reply",
    });
  }

  if (!aiAvailable) {
    problems.push({
      id: "ai_unavailable",
      section: "lead-gen",
      severity: "warning",
      title: "AI replies are unavailable",
      consequence:
        "No OpenAI key is configured, so the AI cannot write answers. Keyword Smart Replies still work; anything needing generated text does not.",
      fixHref: "/admin/whatsapp-ai-setup",
      fixLabel: "Set up AI",
    });
  }

  if (!sessionTemplateConfigured) {
    problems.push({
      id: "session_template_missing",
      section: "setup",
      severity: "warning",
      title: "You cannot reply after 24 hours of silence",
      consequence:
        "WhatsApp only allows free-form replies within 24 hours of the customer's last message. Without a re-engagement template, older conversations cannot be continued.",
      fixHref: "/admin/whatsapp-config",
      fixLabel: "Set a template",
    });
  }

  if (marketing && !marketing.canSend) {
    problems.push({
      id: "marketing_not_sendable",
      section: "campaigns",
      severity: "warning",
      title: "Campaigns cannot be sent yet",
      consequence:
        marketing.usableTemplates === 0
          ? "You have no approved message template. WhatsApp only delivers templates it has approved in advance."
          : "You have no audience with contacts in it, so a campaign would reach nobody.",
      fixHref: marketing.usableTemplates === 0 ? "/admin/whatsapp-templates" : "/admin/whatsapp-contact-groups",
      fixLabel: marketing.usableTemplates === 0 ? "Add a template" : "Add contacts",
    });
  }

  const inboundReady =
    credentialsConfigured && masterSwitchOn && !blockingAllInbound && autoReplyEnabled;

  return {
    inboundReady,
    credentialsConfigured,
    connectionVerified,
    lastInboundAt: lastInboundAt ? new Date(lastInboundAt).toISOString() : null,
    masterSwitchOn,
    autoReplyEnabled,
    aiAvailable,
    responseMode,
    allowlistEnabled,
    allowedNumberCount,
    blockingAllInbound,
    sessionTemplateConfigured,
    activeFlowCount,
    smartReplyCount,
    marketing,
    problems,
  };
}
