import type { VerificationResult, Finding } from "./types";

const VERDICT_HEADER: Record<VerificationResult["verdict"], string> = {
  Eligible: "✅ Verification complete — all checks passed.",
  "Conditionally Eligible": "⚠️ Verification complete with minor warnings.",
  Discrepancy: "❌ Verification found issues that need attention.",
  Pending: "⏳ Verification pending — some documents or data are missing.",
};

const SEVERITY_ICON: Record<Finding["severity"], string> = {
  info: "ℹ️",
  warning: "⚠️",
  blocker: "❌",
};

const STATUS_ICON: Record<Finding["status"], string> = {
  pass: "✅",
  fail: "❌",
  skipped: "⏳",
};

/**
 * Compose a human-readable WhatsApp message body summarizing a verification result.
 * Returns null if nothing actionable to report (verdict Eligible with no warnings).
 */
export function composeVerificationMessage(result: VerificationResult): string | null {
  const noteworthy = result.findings.filter(f => f.status !== "pass");
  // Spec: skip outbound entirely when nothing actionable to report.
  if (noteworthy.length === 0) return null;

  const lines: string[] = [];
  lines.push(VERDICT_HEADER[result.verdict]);
  lines.push("");
  lines.push(`*${result.ruleSetName}*`);
  lines.push(`Passed ${result.counts.pass} · Failed ${result.counts.fail} · Pending ${result.counts.skipped}`);

  // Group by severity (failures first, then skipped, then info)
  const buckets: Record<string, Finding[]> = { blocker: [], warning: [], info: [], skipped: [] };
  for (const f of noteworthy) {
    if (f.status === "skipped") buckets.skipped.push(f);
    else buckets[f.severity].push(f);
  }

  const sectionLabels: [keyof typeof buckets, string][] = [
    ["blocker", "Blocking issues"],
    ["warning", "Warnings"],
    ["skipped", "Pending checks"],
    ["info", "Notes"],
  ];

  for (const [key, label] of sectionLabels) {
    const items = buckets[key];
    if (!items.length) continue;
    lines.push("");
    lines.push(`_${label}_`);
    for (const f of items) {
      const icon = f.status === "skipped" ? STATUS_ICON.skipped : SEVERITY_ICON[f.severity];
      lines.push(`${icon} ${f.message}`);
    }
  }

  return lines.join("\n");
}

/**
 * Compose a short, focused WhatsApp message for incremental (per-upload)
 * rule failures. Used when one or more cross-document rules newly fail after
 * a document upload — distinct from the end-of-session verdict summary.
 */
export function composeIncrementalMessage(
  failures: { message: string; severity: Finding["severity"] }[],
  opts: { rejectingUploadedDoc?: boolean } = {},
): string | null {
  if (failures.length === 0) return null;
  const lines: string[] = [];
  if (opts.rejectingUploadedDoc) {
    // Blocker path — stop and ask for re-upload.
    lines.push("❌ The document you just uploaded does not match earlier information:");
  } else {
    // Warning path — accept the doc and continue, just FYI the customer.
    lines.push("⚠️ Just a heads up — we noticed something on your documents:");
  }
  lines.push("");
  for (const f of failures) {
    // info severity is being retired (Task #1) but kept in the schema for
    // back-compat — treat it visually as a warning.
    const icon = f.severity === "blocker" ? "❌" : "⚠️";
    lines.push(`${icon} ${f.message}`);
  }
  lines.push("");
  lines.push(
    opts.rejectingUploadedDoc
      ? "Please re-upload the correct document."
      : "We'll continue with this document — please reach out if any of the above looks wrong.",
  );
  return lines.join("\n");
}

/**
 * Send a short incremental-verification message over WhatsApp. Returns true on
 * success (or intentionally skipped), false on send failure.
 */
export async function sendIncrementalVerificationOutbound(args: {
  businessAccountId: string;
  recipientPhone: string | null | undefined;
  flowSessionId?: string | null;
  failures: Finding[] | { message: string; severity: Finding["severity"] }[];
  rejectingUploadedDoc?: boolean;
}): Promise<boolean> {
  if (!args.recipientPhone) return true;
  const body = composeIncrementalMessage(args.failures, { rejectingUploadedDoc: args.rejectingUploadedDoc });
  if (!body) return true;
  try {
    const { whatsappService } = await import("../whatsappService");
    const settings = await whatsappService.getSettings(args.businessAccountId);
    if (!settings?.msg91AuthKey || !settings?.msg91IntegratedNumberId) {
      console.log("[Verification:incremental] MSG91 not configured — skipping outbound");
      return true;
    }
    const { whatsappAutoReplyService } = await import("../whatsappAutoReplyService");
    const sendResult = await whatsappAutoReplyService.sendFlowResponse(
      settings,
      args.recipientPhone,
      { type: "text", text: body },
      args.flowSessionId || undefined,
    );
    if (!sendResult.success) {
      console.error(`[Verification:incremental] Send failed: ${sendResult.error}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[Verification:incremental] outbound error:", err);
    return false;
  }
}

/**
 * Send the verification summary out over WhatsApp. Returns true if sent (or
 * intentionally skipped), false if a send failure was logged.
 */
export async function sendVerificationOutbound(args: {
  businessAccountId: string;
  recipientPhone: string | null | undefined;
  flowSessionId?: string | null;
  result: VerificationResult;
}): Promise<boolean> {
  if (!args.recipientPhone) {
    console.log("[Verification] No recipient phone — skipping outbound");
    return true;
  }
  const body = composeVerificationMessage(args.result);
  if (!body) return true;

  try {
    const { whatsappService } = await import("../whatsappService");
    const settings = await whatsappService.getSettings(args.businessAccountId);
    if (!settings?.msg91AuthKey || !settings?.msg91IntegratedNumberId) {
      console.log("[Verification] MSG91 not configured — skipping outbound");
      return true;
    }
    const { whatsappAutoReplyService } = await import("../whatsappAutoReplyService");
    const sendResult = await whatsappAutoReplyService.sendFlowResponse(
      settings,
      args.recipientPhone,
      { type: "text", text: body },
      args.flowSessionId || undefined,
    );
    if (!sendResult.success) {
      console.error(`[Verification] Send failed: ${sendResult.error}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[Verification] sendVerificationOutbound error:", err);
    return false;
  }
}
