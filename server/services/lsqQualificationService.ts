import { db } from "../db";
import { chatMenuConfigs, chatMenuItems } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * LeadSquared lead qualification gating.
 *
 * A business can mark specific dropdown options in a lead form as "qualifying".
 * Example: an "Education Level" dropdown where only "Graduate (Completed)" and
 * "Post Graduate" should push the lead into LeadSquared, while "10th Pass" and
 * "12th Pass" leads are kept in the local DB only.
 *
 * SECURITY: the capture endpoint this serves is public and unauthenticated, so
 * nothing in the request body can be treated as evidence. Qualification is
 * always evaluated from the tenant's saved form configuration loaded here.
 * In particular the caller-supplied form source is only ever allowed to ADD
 * gated fields to the check, never to select a weaker configuration — see
 * `collectGatedFields`.
 */

export interface CustomLeadFieldConfig {
  id: string;
  label: string;
  fieldType: "text" | "dropdown" | "textarea";
  options: string[];
  required: boolean;
  /**
   * When present and non-empty, this dropdown gates LeadSquared sync: the
   * submitted answer must be one of these values. Absent/empty means the field
   * places no restriction on syncing (legacy behaviour).
   */
  lsqQualifyValues?: string[];
}

export interface LsqQualificationResult {
  /** Whether this submission may be pushed to LeadSquared. */
  qualified: boolean;
  /** Human-readable explanation, stored on the lead when disqualified. */
  reason?: string;
}

/** Identifies which saved lead-form configuration a submission came from. */
export const PERSISTENT_CTA_FORM_SOURCE = "persistent_cta";

function parseCustomFields(raw?: string | null): CustomLeadFieldConfig[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const custom = (parsed as { custom?: unknown }).custom;
      if (Array.isArray(custom)) {
        return custom as CustomLeadFieldConfig[];
      }
    }
  } catch {
    // Legacy comma-separated format has no custom fields, so nothing to gate on.
  }
  return [];
}

function isGated(f: CustomLeadFieldConfig): boolean {
  return (
    !!f &&
    f.fieldType === "dropdown" &&
    Array.isArray(f.lsqQualifyValues) &&
    f.lsqQualifyValues.length > 0
  );
}

/**
 * Build the set of gated fields this submission must satisfy.
 *
 * The public caller tells us which form it used, but it could name a form with
 * no gate (or omit the source entirely) to dodge a gate configured elsewhere.
 * So we take the union of:
 *
 *  1. Gated fields on the form the caller *claims* it used. These are enforced
 *     even when the answer is missing, so omitting a field is not a bypass.
 *  2. Gated fields on ANY of the tenant's other lead forms whose field id
 *     actually appears in the submission. Answers are keyed by field id, so a
 *     caller that wants its answers recorded must name the real fields — which
 *     pulls the real form's gate back into the check regardless of the source
 *     it claimed.
 */
async function collectGatedFields(
  businessAccountId: string,
  leadFormSource: string | null | undefined,
  submittedIds: string[],
): Promise<CustomLeadFieldConfig[]> {
  const [menuConfig] = await db
    .select()
    .from(chatMenuConfigs)
    .where(eq(chatMenuConfigs.businessAccountId, businessAccountId))
    .limit(1);

  const menuLevelFields = parseCustomFields(menuConfig?.leadFormFields);

  // Resolve the claimed form. A menu item with no config of its own inherits
  // the menu-level config, matching what the widget renders.
  let claimedFields = menuLevelFields;
  if (leadFormSource && leadFormSource !== PERSISTENT_CTA_FORM_SOURCE) {
    const [item] = await db
      .select()
      .from(chatMenuItems)
      .where(
        and(
          eq(chatMenuItems.id, leadFormSource),
          eq(chatMenuItems.businessAccountId, businessAccountId),
        ),
      )
      .limit(1);
    if (item?.leadFormFields) {
      claimedFields = parseCustomFields(item.leadFormFields);
    }
  }

  const gated = new Map<string, CustomLeadFieldConfig>();
  for (const f of claimedFields) {
    if (isGated(f)) gated.set(f.id, f);
  }

  // Pull in gates from other forms of this tenant that the submission actually
  // references, so naming a softer form cannot drop them.
  //
  // Only fields the claimed form does NOT define at all are considered. If the
  // claimed form defines the field itself, its definition wins even when
  // another form happens to share the id and gate it. That matters because
  // configs get copied between accounts and menu items, so the same field id
  // can legitimately appear in two forms with different qualifying lists —
  // ANDing those together would falsely disqualify honest submissions, and a
  // false disqualification silently stops CRM syncing, which is the more
  // expensive failure. A submission carrying a field its own form never
  // declares is the inconsistent case, and that is what we gate on.
  const unclaimedIds = submittedIds.filter(
    (id) => !claimedFields.some((f) => f.id === id),
  );

  if (unclaimedIds.length > 0) {
    const items = await db
      .select()
      .from(chatMenuItems)
      .where(eq(chatMenuItems.businessAccountId, businessAccountId));

    const others = [menuLevelFields, ...items.map((i) => parseCustomFields(i.leadFormFields))];
    for (const fields of others) {
      for (const f of fields) {
        if (isGated(f) && unclaimedIds.includes(f.id) && !gated.has(f.id)) {
          gated.set(f.id, f);
        }
      }
    }
  }

  return Array.from(gated.values());
}

/**
 * Decide whether a lead submission qualifies for LeadSquared sync.
 *
 * Semantics:
 *  - No gated dropdown applies -> qualified (legacy behaviour, unchanged for
 *    every account that has not configured qualifying values).
 *  - Every applicable gated dropdown must be satisfied (AND).
 *  - A gated field with no submitted answer disqualifies the lead, so omitting
 *    the field is not a way around the gate.
 *  - An answer that is not one of the field's currently configured options
 *    disqualifies the lead (stale or tampered value).
 */
export async function evaluateLsqQualification(
  businessAccountId: string,
  leadFormSource: string | null | undefined,
  submittedFieldsById: Record<string, string> | null | undefined,
): Promise<LsqQualificationResult> {
  const answers =
    submittedFieldsById && typeof submittedFieldsById === "object" && !Array.isArray(submittedFieldsById)
      ? submittedFieldsById
      : {};

  let gatedFields: CustomLeadFieldConfig[];
  try {
    gatedFields = await collectGatedFields(businessAccountId, leadFormSource, Object.keys(answers));
  } catch (err) {
    // Never block a lead from syncing because config lookup failed — falling
    // back to legacy behaviour is safer than silently dropping leads from the
    // CRM on a transient database error.
    console.error("[LSQ Qualification] Could not load form config, allowing sync:", err);
    return { qualified: true };
  }

  if (gatedFields.length === 0) {
    return { qualified: true };
  }

  for (const field of gatedFields) {
    const rawAnswer = answers[field.id];
    const answer = typeof rawAnswer === "string" ? rawAnswer.trim() : "";

    if (!answer) {
      return {
        qualified: false,
        reason: `no answer was provided for "${field.label}"`,
      };
    }

    const options = Array.isArray(field.options) ? field.options : [];
    if (options.length > 0 && !options.includes(answer)) {
      return {
        qualified: false,
        reason: `"${answer}" is not a valid option for "${field.label}"`,
      };
    }

    if (!field.lsqQualifyValues!.includes(answer)) {
      return {
        qualified: false,
        reason: `"${field.label}" = "${answer}" is not a qualifying value`,
      };
    }
  }

  return { qualified: true };
}
