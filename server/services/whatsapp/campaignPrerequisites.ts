/**
 * Single source of truth for "can this business actually send a campaign?".
 *
 * These checks are shared by the campaign create/send endpoints and by the
 * WhatsApp readiness summary. Keeping one definition matters: if the hub says a
 * business is ready to send while the send endpoint disagrees, the user is sent
 * down a path that dead-ends, which is the exact failure this is meant to stop.
 *
 * Two definitions are deliberately stricter than "a row exists":
 *
 *  - A template counts only when it is APPROVED. A draft, pending or rejected
 *    template cannot be dispatched by MSG91, so offering it is a trap.
 *  - An audience counts only when it holds at least one contact. An empty group
 *    passes a naive "has a group" check and produces a campaign addressed to
 *    nobody.
 */
import { db } from "../../db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { whatsappTemplates, contactGroups, contactGroupContacts } from "../../../shared/schema";
import type { WhatsappTemplate } from "../../../shared/schema";

/** The only template status MSG91 will accept for a send. */
export const USABLE_TEMPLATE_STATUS = "approved";

export function isTemplateUsable(tpl: Pick<WhatsappTemplate, "status"> | null | undefined): boolean {
  return !!tpl && tpl.status === USABLE_TEMPLATE_STATUS;
}

/** Number of approved, sendable templates this business owns. */
export async function countUsableTemplates(businessAccountId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.businessAccountId, businessAccountId),
        eq(whatsappTemplates.status, USABLE_TEMPLATE_STATUS),
      ),
    );
  return row?.n ?? 0;
}

/** Number of contact groups that actually contain at least one contact. */
export async function countUsableAudiences(businessAccountId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${contactGroups.id})::int` })
    .from(contactGroups)
    .innerJoin(contactGroupContacts, eq(contactGroupContacts.groupId, contactGroups.id))
    .where(eq(contactGroups.businessAccountId, businessAccountId));
  return row?.n ?? 0;
}

/** Total contacts across the given groups, scoped to the business. */
export async function countContactsInGroups(
  businessAccountId: string,
  groupIds: string[],
): Promise<number> {
  if (!groupIds || groupIds.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contactGroupContacts)
    .innerJoin(contactGroups, eq(contactGroupContacts.groupId, contactGroups.id))
    .where(
      and(
        eq(contactGroups.businessAccountId, businessAccountId),
        inArray(contactGroups.id, groupIds),
      ),
    );
  return row?.n ?? 0;
}

export type PrerequisiteFailure = {
  /** Machine-readable so the client can link to the right screen. */
  code: "no_template_selected" | "template_not_found" | "template_not_approved" | "no_audience_selected" | "audience_empty";
  message: string;
};

/**
 * Validate the template + audience a campaign is about to use.
 *
 * Called on create AND on send, deliberately. A group can be emptied or a
 * template withdrawn between drafting a campaign and dispatching it, so
 * create-time validation alone would still let an empty send through.
 */
export async function checkCampaignPrerequisites(
  businessAccountId: string,
  opts: { templateId?: string | null; groupIds?: string[] | null },
): Promise<PrerequisiteFailure | null> {
  const { templateId, groupIds } = opts;

  if (!templateId) {
    return {
      code: "no_template_selected",
      message: "Choose an approved message template before saving this campaign.",
    };
  }

  const [tpl] = await db
    .select()
    .from(whatsappTemplates)
    .where(and(eq(whatsappTemplates.id, templateId), eq(whatsappTemplates.businessAccountId, businessAccountId)))
    .limit(1);

  if (!tpl) {
    return { code: "template_not_found", message: "That message template no longer exists." };
  }
  if (!isTemplateUsable(tpl)) {
    return {
      code: "template_not_approved",
      message: `The template "${tpl.name}" is ${tpl.status}, not approved. WhatsApp only delivers approved templates, so this campaign cannot be sent. Get it approved on your MSG91 dashboard, then sync it here.`,
    };
  }

  if (!groupIds || groupIds.length === 0) {
    return {
      code: "no_audience_selected",
      message: "Choose at least one audience to send this campaign to.",
    };
  }

  const contacts = await countContactsInGroups(businessAccountId, groupIds);
  if (contacts === 0) {
    return {
      code: "audience_empty",
      message:
        groupIds.length === 1
          ? "The audience you selected has no contacts in it, so this campaign would reach nobody. Add contacts to it first."
          : "None of the audiences you selected contain any contacts, so this campaign would reach nobody. Add contacts to at least one of them first.",
    };
  }

  return null;
}
