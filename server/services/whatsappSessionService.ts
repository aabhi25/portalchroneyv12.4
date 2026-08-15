import { db } from "../db";
import { whatsappSessions, whatsappLeads, type WhatsappSettings } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function updateSession(businessAccountId: string, phoneNumber: string): Promise<void> {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  try {
    const existing = await db
      .select()
      .from(whatsappSessions)
      .where(and(
        eq(whatsappSessions.businessAccountId, businessAccountId),
        eq(whatsappSessions.phoneNumber, cleanPhone)
      ))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(whatsappSessions)
        .set({
          lastUserMessageAt: new Date(),
          sessionActive: true,
          updatedAt: new Date(),
        })
        .where(eq(whatsappSessions.id, existing[0].id));
    } else {
      await db.insert(whatsappSessions).values({
        businessAccountId,
        phoneNumber: cleanPhone,
        lastUserMessageAt: new Date(),
        sessionActive: true,
      });
    }
    console.log(`[WA Session] Updated session for ${cleanPhone} (business: ${businessAccountId})`);
  } catch (err) {
    console.error(`[WA Session] Failed to update session for ${cleanPhone}:`, err);
  }
}

export async function isSessionActive(businessAccountId: string, phoneNumber: string): Promise<boolean> {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  try {
    const [session] = await db
      .select()
      .from(whatsappSessions)
      .where(and(
        eq(whatsappSessions.businessAccountId, businessAccountId),
        eq(whatsappSessions.phoneNumber, cleanPhone)
      ))
      .limit(1);

    if (!session) return false;
    if (!session.sessionActive) return false;

    const elapsed = Date.now() - new Date(session.lastUserMessageAt).getTime();
    return elapsed < SESSION_WINDOW_MS;
  } catch (err) {
    console.error(`[WA Session] Failed to check session for ${cleanPhone}:`, err);
    return false;
  }
}

export async function markSessionExpired(businessAccountId: string, phoneNumber: string): Promise<void> {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  try {
    await db
      .update(whatsappSessions)
      .set({ sessionActive: false, updatedAt: new Date() })
      .where(and(
        eq(whatsappSessions.businessAccountId, businessAccountId),
        eq(whatsappSessions.phoneNumber, cleanPhone)
      ));
    console.log(`[WA Session] Marked session expired for ${cleanPhone}`);
  } catch (err) {
    console.error(`[WA Session] Failed to mark session expired for ${cleanPhone}:`, err);
  }
}

export async function sendTemplateMessage(
  settings: WhatsappSettings,
  recipientPhone: string,
  templateName: string,
  params: Record<string, string> = {},
  opts: { language?: string; namespace?: string | null } = {},
): Promise<{ success: boolean; messageId?: string; error?: string; raw?: any }> {
  try {
    if (!settings.msg91AuthKey) {
      return { success: false, error: "MSG91 auth key not configured" };
    }
    if (!settings.msg91IntegratedNumberId) {
      return { success: false, error: "MSG91 integrated number ID not configured" };
    }

    const cleanPhone = recipientPhone.replace(/\D/g, "");

    // MSG91's wrapper carries integrated_number/content_type; everything inside
    // `payload` is forwarded as-is to Meta's WhatsApp Cloud API. Meta requires
    // `messaging_product: "whatsapp"` to live INSIDE that forwarded payload —
    // putting it at MSG91's wrapper root (where it was previously) means Meta
    // never sees it and rejects the send with "Failed By Meta — missing
    // 'messaging_product'".
    const body: Record<string, any> = {
      integrated_number: settings.msg91IntegratedNumberId,
      content_type: "template",
      payload: {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: templateName,
          language: {
            code: opts.language || "en",
            policy: "deterministic",
          },
          components: [] as any[],
        },
      },
    };

    if (Object.keys(params).length > 0) {
      const parameters = Object.values(params).map((value) => ({
        type: "text",
        text: value,
      }));
      body.payload.template.components.push({
        type: "body",
        parameters,
      });
    }

    const namespace = opts.namespace || settings.sessionTemplateNamespace;
    if (namespace) {
      body.payload.template.namespace = namespace;
    }

    const url = `https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/`;

    console.log(`[WA Session] Sending template "${templateName}" to ${cleanPhone}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authkey: settings.msg91AuthKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // Read the body first so we can include it in error returns even on non-2xx.
    let responseData: any = null;
    try {
      responseData = await response.json();
    } catch {
      responseData = { _parseError: true, _httpStatus: response.status };
    }
    console.log(`[WA Session] Template response (HTTP ${response.status}):`, responseData);

    // Enterprise-grade send confirmation: ANY non-2xx HTTP response is a hard
    // failure. MSG91's schema validator returns 4xx with the error in the body
    // (e.g. "missing: messaging_product"); without this check we'd treat the
    // request as "submitted" and only discover the rejection when Meta's async
    // webhook fires (or, worse, never).
    if (!response.ok) {
      return {
        success: false,
        error:
          (responseData && (responseData.errors || responseData.message || responseData.error)) ||
          `MSG91 HTTP ${response.status}`,
        raw: responseData,
      };
    }

    // MSG91-level documented failure shape — request was 200 but the provider
    // is telling us it couldn't accept the message.
    if (responseData?.status === "fail" || responseData?.hasError) {
      return {
        success: false,
        error: responseData.errors || responseData.message || `MSG91 error: ${response.status}`,
        raw: responseData,
      };
    }

    // The UUID is what later delivery webhooks key on. If MSG91 didn't return
    // one, we cannot match the eventual status update — treat as failure.
    // MSG91 v5 WhatsApp puts it under data.message_uuid; older endpoints used
    // data.id / message_id. Check all known field names.
    const messageId =
      responseData?.data?.message_uuid ||
      responseData?.data?.id ||
      responseData?.message_uuid ||
      responseData?.message_id;
    if (!messageId) {
      return {
        success: false,
        error: "MSG91 accepted the request but returned no message id; cannot track delivery",
        raw: responseData,
      };
    }

    await storeOutgoingTemplateMessage(
      settings.businessAccountId,
      recipientPhone,
      `[Template: ${templateName}]`
    );

    return {
      success: true,
      messageId,
      raw: responseData,
    };
  } catch (error) {
    console.error(`[WA Session] Template send error:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send template",
    };
  }
}

async function storeOutgoingTemplateMessage(
  businessAccountId: string,
  recipientPhone: string,
  text: string
): Promise<void> {
  try {
    const cleanPhone = recipientPhone.replace(/\D/g, "");
    await db.insert(whatsappLeads).values({
      businessAccountId,
      senderPhone: cleanPhone,
      rawMessage: text,
      status: "message_only",
      direction: "outgoing",
    });
  } catch (err) {
    console.error(`[WA Session] Failed to store outgoing template message:`, err);
  }
}

export function isSessionExpiredError(error: any): boolean {
  if (!error) return false;
  const errorStr = typeof error === "string" ? error : JSON.stringify(error);
  return errorStr.includes("131047") || errorStr.includes("Re-engagement");
}

export async function sendWithSessionCheck(
  settings: WhatsappSettings,
  recipientPhone: string,
  message: string,
  sendNormalMessage: (settings: WhatsappSettings, phone: string, msg: string, contextId?: string) => Promise<{ success: boolean; messageId?: string; error?: string }>,
  contextMessageId?: string
): Promise<{ success: boolean; messageId?: string; error?: string; usedTemplate?: boolean }> {
  const sessionActive = await isSessionActive(settings.businessAccountId, recipientPhone);

  if (sessionActive) {
    const result = await sendNormalMessage(settings, recipientPhone, message, contextMessageId);

    if (!result.success && result.error && isSessionExpiredError(result.error)) {
      console.log(`[WA Session] Got 131047 error, session expired — falling back to template`);
      await markSessionExpired(settings.businessAccountId, recipientPhone);
      return await sendTemplateFallback(settings, recipientPhone);
    }

    return result;
  }

  console.log(`[WA Session] Session expired for ${recipientPhone} — sending template`);
  return await sendTemplateFallback(settings, recipientPhone);
}

async function sendTemplateFallback(
  settings: WhatsappSettings,
  recipientPhone: string
): Promise<{ success: boolean; messageId?: string; error?: string; usedTemplate?: boolean }> {
  const templateName = settings.sessionTemplateName;
  if (!templateName) {
    console.error(`[WA Session] No session template configured for business ${settings.businessAccountId} — cannot send re-engagement message`);
    return {
      success: false,
      error: "WhatsApp 24-hour session expired and no re-engagement template is configured. Please configure a template in WhatsApp settings.",
      usedTemplate: false,
    };
  }

  const templateResult = await sendTemplateMessage(settings, recipientPhone, templateName);
  return { ...templateResult, usedTemplate: true };
}
