import { db } from "../db";
import {
  customerIdentities,
  customerMemorySnapshots,
  whatsappLeads,
  instagramMessages,
  facebookMessages,
  messages,
  conversations,
  leads,
  businessAccounts,
} from "../../shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getIdentitiesForProfile } from "./customerProfileService";
import OpenAI from "openai";

interface NormalizedMessage {
  platform: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export async function getMessagesFromPlatform(
  businessAccountId: string,
  platform: string,
  platformUserId: string,
  limit: number = 20
): Promise<NormalizedMessage[]> {
  switch (platform) {
    case "whatsapp":
      return getWhatsAppMessages(businessAccountId, platformUserId, limit);
    case "instagram":
      return getInstagramMessages(businessAccountId, platformUserId, limit);
    case "facebook":
      return getFacebookMessages(businessAccountId, platformUserId, limit);
    case "website":
      return getWebsiteMessages(businessAccountId, platformUserId, limit);
    default:
      return [];
  }
}

async function getWhatsAppMessages(
  businessAccountId: string,
  senderPhone: string,
  limit: number
): Promise<NormalizedMessage[]> {
  const rows = await db
    .select({
      rawMessage: whatsappLeads.rawMessage,
      direction: whatsappLeads.direction,
      receivedAt: whatsappLeads.receivedAt,
    })
    .from(whatsappLeads)
    .where(
      and(
        eq(whatsappLeads.businessAccountId, businessAccountId),
        eq(whatsappLeads.senderPhone, senderPhone)
      )
    )
    .orderBy(desc(whatsappLeads.receivedAt))
    .limit(limit);

  return rows
    .filter((r) => r.rawMessage)
    .reverse()
    .map((r) => ({
      platform: "whatsapp",
      role: r.direction === "incoming" ? ("user" as const) : ("assistant" as const),
      content: r.rawMessage!,
      timestamp: r.receivedAt,
    }));
}

async function getInstagramMessages(
  businessAccountId: string,
  senderId: string,
  limit: number
): Promise<NormalizedMessage[]> {
  const rows = await db
    .select({
      messageText: instagramMessages.messageText,
      direction: instagramMessages.direction,
      createdAt: instagramMessages.createdAt,
    })
    .from(instagramMessages)
    .where(
      and(
        eq(instagramMessages.businessAccountId, businessAccountId),
        eq(instagramMessages.senderId, senderId)
      )
    )
    .orderBy(desc(instagramMessages.createdAt))
    .limit(limit);

  return rows
    .filter((r) => r.messageText)
    .reverse()
    .map((r) => ({
      platform: "instagram",
      role: r.direction === "incoming" ? ("user" as const) : ("assistant" as const),
      content: r.messageText!,
      timestamp: r.createdAt,
    }));
}

async function getFacebookMessages(
  businessAccountId: string,
  senderId: string,
  limit: number
): Promise<NormalizedMessage[]> {
  const rows = await db
    .select({
      messageText: facebookMessages.messageText,
      direction: facebookMessages.direction,
      createdAt: facebookMessages.createdAt,
    })
    .from(facebookMessages)
    .where(
      and(
        eq(facebookMessages.businessAccountId, businessAccountId),
        eq(facebookMessages.senderId, senderId)
      )
    )
    .orderBy(desc(facebookMessages.createdAt))
    .limit(limit);

  return rows
    .filter((r) => r.messageText)
    .reverse()
    .map((r) => ({
      platform: "facebook",
      role: r.direction === "incoming" ? ("user" as const) : ("assistant" as const),
      content: r.messageText!,
      timestamp: r.createdAt,
    }));
}

async function getWebsiteMessages(
  businessAccountId: string,
  platformUserId: string,
  limit: number
): Promise<NormalizedMessage[]> {
  let convRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.businessAccountId, businessAccountId),
        eq(conversations.visitorToken, platformUserId)
      )
    );

  if (convRows.length === 0) {
    const directConv = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, platformUserId),
          eq(conversations.businessAccountId, businessAccountId)
        )
      )
      .limit(1);
    if (directConv.length > 0) {
      convRows = directConv;
    }
  }

  if (convRows.length === 0) {
    const leadConvs = await db
      .select({ conversationId: leads.conversationId })
      .from(leads)
      .where(
        and(
          eq(leads.businessAccountId, businessAccountId),
          eq(leads.phone, platformUserId)
        )
      );
    const convIds = leadConvs
      .map((l) => l.conversationId)
      .filter(Boolean) as string[];
    if (convIds.length === 0) return [];

    const validConvs = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.businessAccountId, businessAccountId),
          sql`${conversations.id} IN (${sql.join(convIds.map(id => sql`${id}`), sql`, `)})`
        )
      );
    const validConvIds = validConvs.map((c) => c.id);
    if (validConvIds.length === 0) return [];

    const rows = await db
      .select({
        content: messages.content,
        role: messages.role,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(sql`${messages.conversationId} IN (${sql.join(validConvIds.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    return rows.reverse().map((r) => ({
      platform: "website",
      role: r.role === "user" ? ("user" as const) : ("assistant" as const),
      content: r.content,
      timestamp: r.createdAt,
    }));
  }

  const convIds = convRows.map((c) => c.id);
  const rows = await db
    .select({
      content: messages.content,
      role: messages.role,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(sql`${messages.conversationId} IN (${sql.join(convIds.map(id => sql`${id}`), sql`, `)})`)
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.reverse().map((r) => ({
    platform: "website",
    role: r.role === "user" ? ("user" as const) : ("assistant" as const),
    content: r.content,
    timestamp: r.createdAt,
  }));
}

export async function shouldRefreshSnapshot(
  profileId: string,
  platform: string
): Promise<boolean> {
  const snapshots = await db
    .select()
    .from(customerMemorySnapshots)
    .where(
      and(
        eq(customerMemorySnapshots.profileId, profileId),
        eq(customerMemorySnapshots.platform, platform)
      )
    )
    .limit(1);

  if (snapshots.length === 0) return true;

  const snapshot = snapshots[0];
  if (snapshot.turnsSinceRefresh >= 3) return true;

  if (snapshot.lastMessageAt) {
    const staleMs = Date.now() - snapshot.lastMessageAt.getTime();
    if (staleMs > 30 * 60 * 1000) return true;
  }

  return false;
}

export async function refreshSnapshot(
  businessAccountId: string,
  profileId: string,
  platform: string,
  platformUserId: string
): Promise<void> {
  try {
    const recentMessages = await getMessagesFromPlatform(
      businessAccountId,
      platform,
      platformUserId,
      20
    );

    if (recentMessages.length === 0) return;

    const existingSnapshots = await db
      .select()
      .from(customerMemorySnapshots)
      .where(
        and(
          eq(customerMemorySnapshots.profileId, profileId),
          eq(customerMemorySnapshots.platform, platform)
        )
      )
      .limit(1);

    const existingSummary =
      existingSnapshots.length > 0 ? existingSnapshots[0].summary : null;

    const messagesText = recentMessages
      .slice(-15)
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Agent"}: ${m.content.substring(0, 200)}`
      )
      .join("\n");

    const prompt = existingSummary
      ? `You have an existing conversation summary:\n${existingSummary}\n\nHere are recent messages:\n${messagesText}\n\nProduce an updated structured summary. Format:\nTOPICS: ... | PREFERENCES: ... | STAGE: ... | OPEN QUESTIONS: ... | KEY FACTS: ...\nKeep under 600 characters. Be factual. Merge old and new info.`
      : `Here are conversation messages:\n${messagesText}\n\nProduce a structured summary. Format:\nTOPICS: ... | PREFERENCES: ... | STAGE: ... | OPEN QUESTIONS: ... | KEY FACTS: ...\nKeep under 600 characters. Be factual.`;

    const biz = await db
      .select({ openaiApiKey: businessAccounts.openaiApiKey })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessAccountId))
      .limit(1);
    const apiKey = biz[0]?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a conversation analyst. Produce concise, factual summaries of customer conversations. Never include greetings or filler.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 200,
    });

    const summary = response.choices[0]?.message?.content?.trim();
    if (!summary) return;

    const lastMsg = recentMessages[recentMessages.length - 1];
    const currentVersion =
      existingSnapshots.length > 0
        ? existingSnapshots[0].snapshotVersion
        : 0;

    if (existingSnapshots.length > 0) {
      await db
        .update(customerMemorySnapshots)
        .set({
          summary,
          lastMessageAt: lastMsg.timestamp,
          turnsSinceRefresh: 0,
          snapshotVersion: currentVersion + 1,
          updatedAt: new Date(),
        })
        .where(eq(customerMemorySnapshots.id, existingSnapshots[0].id));
    } else {
      await db.insert(customerMemorySnapshots).values({
        profileId,
        businessAccountId,
        platform,
        summary,
        lastMessageAt: lastMsg.timestamp,
        turnsSinceRefresh: 0,
        snapshotVersion: 1,
      });
    }
  } catch (error) {
    console.error(
      `[CrossPlatformMemory] Error refreshing snapshot for profile ${profileId} on ${platform}:`,
      error
    );
  }
}

export async function composeCrossPlatformContext(
  businessAccountId: string,
  currentPlatform: string,
  profileId: string,
  isFirstMessage: boolean = true
): Promise<string> {
  try {
    const identities = await getIdentitiesForProfile(profileId, businessAccountId);

    const otherPlatformIdentities = identities.filter(
      (i) => i.platform !== currentPlatform
    );
    if (otherPlatformIdentities.length === 0) return "";

    const sections: string[] = [];
    const platformNames: string[] = [];

    for (const identity of otherPlatformIdentities) {
      const snapshot = await db
        .select()
        .from(customerMemorySnapshots)
        .where(
          and(
            eq(customerMemorySnapshots.profileId, profileId),
            eq(customerMemorySnapshots.platform, identity.platform)
          )
        )
        .limit(1);

      const recentMessages = await getMessagesFromPlatform(
        businessAccountId,
        identity.platform,
        identity.platformUserId,
        3
      );

      if (
        (snapshot.length === 0 || !snapshot[0].summary) &&
        recentMessages.length === 0
      )
        continue;

      const platformLabel =
        identity.platform.charAt(0).toUpperCase() +
        identity.platform.slice(1);
      platformNames.push(platformLabel);

      let section = `[${platformLabel}]`;
      if (identity.lastSeenAt) {
        section += ` (last active: ${formatDate(identity.lastSeenAt)})`;
      }
      section += ":";

      if (snapshot.length > 0 && snapshot[0].summary) {
        section += `\nSummary: ${snapshot[0].summary}`;
      }

      if (recentMessages.length > 0) {
        section += "\nRecent:";
        for (const msg of recentMessages.slice(-3)) {
          const label = msg.role === "user" ? "User" : "Agent";
          const truncated =
            msg.content.length > 120
              ? msg.content.substring(0, 120) + "..."
              : msg.content;
          section += `\n- ${label}: "${truncated}" (${formatDate(msg.timestamp)})`;
        }
      }

      sections.push(section);
    }

    if (sections.length === 0) return "";

    const greetingRule = isFirstMessage
      ? `- This is a RETURNING customer. Warmly acknowledge them (e.g., "Welcome back!" or "Great to see you again!") in your first reply. Keep it brief and natural — one line, not a recap of their history.`
      : `- You have already greeted this returning customer. Do NOT greet them again or say "welcome back" / "great to see you again." Just continue the conversation naturally.`;

    const instructions = `CROSS-PLATFORM CUSTOMER CONTEXT:
IMPORTANT INSTRUCTIONS:
${greetingRule}
- Use their previous context (interests, preferences, past topics) to personalize the conversation naturally.
- Do NOT proactively mention which platform they previously interacted on. Only reveal the platform name if the customer specifically asks how you know them.`;

    const details = `\nPrevious interactions via ${platformNames.join(", ")}.\n\n${sections.join("\n\n")}`;

    const maxDetailsLength = 1500 - instructions.length;
    const trimmedDetails = details.length > maxDetailsLength
      ? details.substring(0, maxDetailsLength) + "..."
      : details;

    const context = instructions + trimmedDetails;

    return context;
  } catch (error) {
    console.error(
      `[CrossPlatformMemory] Error composing context for profile ${profileId}:`,
      error
    );
    return "";
  }
}

export async function triggerSnapshotUpdate(
  businessAccountId: string,
  profileId: string,
  platform: string,
  platformUserId: string
): Promise<void> {
  setImmediate(async () => {
    try {
      await db
        .update(customerMemorySnapshots)
        .set({
          turnsSinceRefresh: sql`${customerMemorySnapshots.turnsSinceRefresh} + 1`,
        })
        .where(
          and(
            eq(customerMemorySnapshots.profileId, profileId),
            eq(customerMemorySnapshots.platform, platform)
          )
        );

      const needsRefresh = await shouldRefreshSnapshot(profileId, platform);
      if (needsRefresh) {
        await refreshSnapshot(
          businessAccountId,
          profileId,
          platform,
          platformUserId
        );
      }
    } catch (error) {
      console.error(
        `[CrossPlatformMemory] Error in snapshot update for profile ${profileId}:`,
        error
      );
    }
  });
}

function formatDate(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}
