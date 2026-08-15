/**
 * The one place WhatsApp settings are turned into something safe to send to a browser.
 *
 * This exists because sanitising the GET handler alone was not enough: the PUT handler returned
 * the freshly-saved row directly, so every save handed back the credentials the GET had just
 * been taught to withhold. Two handlers each doing their own redaction is a standing invitation
 * for exactly that kind of drift, so both now call this.
 *
 * Two credentials must never reach the client:
 *   - msg91AuthKey   authorises sending WhatsApp messages as this business
 *   - webhookSecret  authenticates inbound webhook deliveries
 *
 * The UI only ever needs to know *whether* each is set, which is what the `*Configured`
 * booleans carry. The webhook secret is still obtainable for MSG91 setup, but only from the
 * dedicated on-demand endpoint, which logs who asked for it.
 */
export function toWhatsappSettingsDto(settings: any) {
  const { msg91AuthKey, webhookSecret, ...safeSettings } = settings as any;

  // Backstop for columns added later: anything that looks like a credential is dropped even if
  // nobody remembers to update the destructure above.
  for (const key of Object.keys(safeSettings)) {
    if (/authkey|secret|token|password|apikey/i.test(key)) delete safeSettings[key];
  }

  return {
    ...safeSettings,
    // Presence, not value — this is what the UI actually needs.
    msg91AuthKeyConfigured: Boolean(msg91AuthKey),
    webhookSecretConfigured: Boolean(webhookSecret),
    autoSyncToLeadsquared: settings.autoSyncToLeadsquared === "true",
    leadCaptureEnabled: settings.leadCaptureEnabled !== "false",
    requireName: settings.requireName === "true",
    requirePhone: settings.requirePhone === "true",
    requireEmail: settings.requireEmail === "true",
    minFieldsRequired: settings.minFieldsRequired ?? 1,
    autoReplyEnabled: settings.autoReplyEnabled === "true",
    msg91IntegratedNumberId: settings.msg91IntegratedNumberId || "",
    newApplicationCooldownDays: settings.newApplicationCooldownDays ?? 7,
    phoneNumberLength: settings.phoneNumberLength ?? 10,
    updateLeadEnabled: settings.updateLeadEnabled !== "false",
    whitelistEnabled: settings.whitelistEnabled === "true",
    useCaseMode: settings.useCaseMode || "lead_capture",
    // AI Setup fields
    aiResponseMode: settings.aiResponseMode ?? null,
    useMasterTraining: settings.useMasterTraining !== "false",
    useLeadTraining: settings.useLeadTraining !== "false",
    useFaqKnowledge: settings.useFaqKnowledge !== "false",
    useDocumentKnowledge: settings.useDocumentKnowledge !== "false",
    useWebsiteKnowledge: settings.useWebsiteKnowledge !== "false",
    useProductCatalogKnowledge: settings.useProductCatalogKnowledge !== "false",
  };
}
