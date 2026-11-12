/**
 * Applies a business starter pack (shared/businessStarters.ts) to a newly
 * created account: feature switches, booking hours, chat tone and welcome
 * message, Training instructions, booking suggestions and lead details.
 *
 * Only ever called right after POST /api/business-accounts creates the
 * account, so it writes over the defaults rather than merging with anything
 * the business set up — there is nothing yet.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { businessAccounts, scheduleTemplates } from "@shared/schema";
import { describeBusinessStarter, starterLeadConfig, type BusinessStarter } from "@shared/businessStarters";

const flag = (on: boolean | undefined) => (on ? "true" : "false");

export async function applyBusinessStarter(accountId: string, businessName: string, starter: BusinessStarter): Promise<{ key: string; label: string; summary: string[] }> {
  const result = { key: starter.key, label: starter.label, summary: describeBusinessStarter(starter) };
  if (starter.key === "blank") return result;
  const s = starter.switches;
  const tag = `starter-${starter.key}`;

  await db.update(businessAccounts).set({
    chroneyEnabled: "true",
    whatsappEnabled: flag(s.whatsapp),
    appointmentsEnabled: flag(s.appointments),
    supportTicketsEnabled: flag(s.supportTickets),
    visualSearchEnabled: flag(s.visualSearch),
    // Jewelry Showcase next to Website chat needs both the jewellery tier and the showcase switch (see hubAreas.ts).
    ...(s.jewelryShowcase ? { productTier: "jewelry_showcase_chroney", jewelryShowcaseEnabled: "true" } : {}),
  }).where(eq(businessAccounts.id, accountId));

  if (starter.hours) {
    const h = starter.hours;
    await db.insert(scheduleTemplates).values(h.days.map(day => ({
      businessAccountId: accountId,
      dayOfWeek: String(day),
      startTime: h.start,
      endTime: h.end,
      slotDurationMinutes: String(h.slotMinutes),
      isActive: "true",
    })));
  }

  await storage.upsertWidgetSettings(accountId, {
    ...(starter.personality ? { personality: starter.personality } : {}),
    ...(starter.welcomeMessage ? { welcomeMessageType: "custom", welcomeMessage: starter.welcomeMessage.replace(/\{business\}/g, businessName) } : {}),
    ...(starter.instructions.length ? {
      customInstructions: JSON.stringify(starter.instructions.map((ins, i) => ({ id: `${tag}-${i + 1}`, ...ins }))),
    } : {}),
    ...(starter.bookingTriggers?.length ? {
      appointmentBookingEnabled: "true",
      appointmentSuggestRules: starter.bookingTriggers.map((t, i) => ({ id: `${tag}-booking-${i + 1}`, keywords: t.keywords, prompt: t.prompt, enabled: true })),
    } : {}),
    ...(starter.leadDetails ? { leadTrainingConfig: starterLeadConfig(starter.leadDetails) } : {}),
  });

  return result;
}
