/**
 * Lead story across channels (leadTimelineService): who counts as the same person, the events
 * from each channel, the AI story (cached, stale on new activity, deleted with the lead), the
 * brief an AI call gets and the call context WhatsApp replies get.
 *
 * DESTRUCTIVE: creates rows. Run against a local throwaway database only:
 *   LEAD_TIMELINE_TEST_DB=1 DATABASE_URL=postgresql://…@127.0.0.1:…/… npx tsx server/services/__tests__/leadTimeline.integration.test.ts
 */
const url = process.env.DATABASE_URL || "";
if (process.env.LEAD_TIMELINE_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set LEAD_TIMELINE_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-at-least-32-characters-long";

let failed = 0;
function expect(cond: unknown, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const svc = await import("../leadTimelineService");

  const stamp = Date.now();
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Timeline Test ${stamp}`, website: "https://t.example.com", whatsappEnabled: "true" } as any).returning();
  const B = biz.id as string;
  const digits = String(stamp).slice(-8);
  const phone = `98${digits}`; // the lead's number (10 digits)
  const t0 = Date.now() - 3 * 60 * 60 * 1000;
  const at = (min: number) => new Date(t0 + min * 60_000);

  // Website chat → lead
  const [conv] = await db.insert(schema.conversations).values({ businessAccountId: B, title: "Chat", createdAt: at(0) } as any).returning();
  await db.insert(schema.messages).values([
    { conversationId: conv.id, role: "user", content: "What are the fees for the online MBA?", createdAt: at(0) },
    { conversationId: conv.id, role: "assistant", content: "The fee depends on the specialisation. May I have your number?", createdAt: at(1) },
  ] as any);
  const [lead] = await db.insert(schema.leads).values({ businessAccountId: B, name: "Priya", phone, conversationId: conv.id, createdAt: at(2), leadsquaredSyncStatus: "synced", leadsquaredSyncedAt: at(3) } as any).returning();

  // Before any call: the typed number isn't confirmed → WhatsApp from that number is not hers yet.
  const [waIn] = await db.insert(schema.whatsappLeads).values({ businessAccountId: B, senderPhone: `91${phone}`, rawMessage: "Is EMI available?", status: "new", direction: "incoming", receivedAt: at(40) } as any).returning();
  let tl = await svc.getLeadTimeline(B, { channel: "website", id: lead.id });
  expect(tl && tl.events.some((e) => e.channel === "website" && e.title === "Website chat" && /fees for the online MBA/.test(e.detail || "")) && tl.events.some((e) => e.title === "Shared their details") && tl.events.some((e) => e.title === "Sent to LeadSquared"),
    "website lead: the chat (first question), details shared and the CRM sync are on the timeline", tl?.events.map((e) => e.title));
  expect(tl && !tl.events.some((e) => e.channel === "whatsapp"), "an unconfirmed typed number doesn't pull in WhatsApp chats from it");

  // An answered AI call confirms the number; its follow-up and the WhatsApp reply join.
  const [call] = await db.insert(schema.aiCalls).values({
    businessAccountId: B, direction: "outbound", status: "completed", trigger: "auto_lead", provider: "simulator", phone: `+91${phone}`, leadId: lead.id,
    startedAt: at(30), answeredAt: at(30), endedAt: at(33), durationSec: 180, outcome: "interested", summary: "Priya wants the online MBA in marketing and asked about EMI.",
    followUpSentAt: at(34), followUpStatus: "read", followUpTemplate: "online_mba", followUpDeliveredAt: at(34), followUpReadAt: at(35),
  } as any).returning();
  await db.insert(schema.whatsappLeads).values({ businessAccountId: B, senderPhone: `91${phone}`, rawMessage: "Hi Priya, here are the MBA details…", status: "message_only", direction: "outgoing", receivedAt: at(34), extractedData: { _template: "online_mba" } } as any);
  await db.insert(schema.whatsappLeads).values({ businessAccountId: B, senderPhone: `91${phone}`, rawMessage: "Promo", status: "message_only", direction: "outgoing", receivedAt: at(90), extractedData: { _template: "diwali_offer" } } as any);
  await db.insert(schema.instagramLeads).values({ businessAccountId: B, senderId: `ig-${stamp}`, senderUsername: "priya.s", extractedData: { mobile: `+91 ${phone}` }, receivedAt: at(120) } as any);
  await db.insert(schema.instagramLeads).values({ businessAccountId: B, senderId: `ig2-${stamp}`, senderUsername: "someone.else", extractedData: { mobile: "9000000001" }, receivedAt: at(121) } as any);

  tl = await svc.getLeadTimeline(B, { channel: "website", id: lead.id });
  const titles = tl?.events.map((e) => `${e.channel}:${e.title}`) || [];
  const ordered = tl ? tl.events.every((e, i, a) => i === 0 || new Date(a[i - 1].at).getTime() <= new Date(e.at).getTime()) : false;
  expect(titles.includes("call:AI call · Interested") && tl!.events.find((e) => e.channel === "call")?.link?.id === call.id, "the AI call shows with its outcome and links to the call", titles);
  expect(titles.includes("whatsapp:WhatsApp follow-up sent") && /“online_mba” · delivered, read/.test(tl!.events.find((e) => e.title === "WhatsApp follow-up sent")?.detail || ""), "the follow-up shows with delivered / read", tl?.events.find((e) => e.title === "WhatsApp follow-up sent"));
  expect(titles.filter((x) => x === "whatsapp:WhatsApp message sent").length === 1 && tl!.events.some((e) => e.title === "WhatsApp message sent" && /diwali_offer/.test(e.detail || "")), "other templates show once; the follow-up's own template isn't listed twice", titles);
  expect(tl!.events.some((e) => e.title === "WhatsApp chat" && /“Is EMI available\?”/.test(e.detail || "")), "the WhatsApp chat (their first message) joins once the number is confirmed");
  expect(tl!.events.some((e) => e.channel === "instagram" && /priya\.s/.test(e.detail || "")) && !tl!.events.some((e) => /someone\.else/.test(e.detail || "")), "an Instagram DM that gave her number joins; another person's doesn't");
  expect(ordered, "events are oldest first");

  // Opening the WhatsApp lead shows the same story.
  const fromWa = await svc.getLeadTimeline(B, { channel: "whatsapp", id: waIn.id });
  expect(fromWa && fromWa.events.some((e) => e.title === "Website chat") && fromWa.events.some((e) => e.channel === "call"), "from the WhatsApp lead: the website chat and the call are there too");

  // Another account can't read it.
  const [other] = await db.insert(schema.businessAccounts).values({ name: `Timeline Other ${stamp}`, website: "https://o.example.com" } as any).returning();
  expect(await svc.getLeadTimeline(other.id, { channel: "website", id: lead.id }) === null, "another account gets nothing for this lead");

  // Story: written, cached, stale after new activity, deleted with the lead.
  expect(tl!.storyStatus === "none" && tl!.story === null, "no story until one is written");
  let seenTranscript = "";
  svc.setStoryWriterForTesting(async ({ transcript }) => { seenTranscript = transcript; return { summary: "Priya wants the online MBA (marketing) and asked about EMI.", course: "Online MBA", budget: null, questions: ["EMI"], booked: "Brochure sent on WhatsApp", nextStep: "Call about EMI options" }; });
  const story = await svc.writeLeadStory(B, { channel: "website", id: lead.id });
  expect(story?.course === "Online MBA" && /fees for the online MBA/.test(seenTranscript) && /Is EMI available/.test(seenTranscript) && /AI call/.test(seenTranscript), "the story writer reads the timeline plus the latest website and WhatsApp words", seenTranscript.slice(0, 300));
  tl = await svc.getLeadTimeline(B, { channel: "website", id: lead.id });
  expect(tl!.storyStatus === "ready" && tl!.story?.nextStep === "Call about EMI options", "the story is cached and up to date");
  await db.insert(schema.whatsappLeads).values({ businessAccountId: B, senderPhone: `91${phone}`, rawMessage: "Can I pay in instalments?", status: "message_only", direction: "incoming", receivedAt: new Date(Date.now() + 2 * 24 * 3600_000) } as any);
  tl = await svc.getLeadTimeline(B, { channel: "website", id: lead.id });
  expect(tl!.storyStatus === "stale", "new activity on any channel marks the story out of date", tl!.storyStatus);
  expect(svc.sanitizeStory({ summary: "  ", course: "x" }) === null && svc.sanitizeStory({ summary: "Ok.", budget: "null", questions: ["a", 3, null] })?.budget === null, "an empty / 'null' story from the model is cleaned up");

  // The AI call's brief and WhatsApp's call context.
  const brief = await svc.leadHistoryBrief(B, lead.id);
  expect(brief && /online MBA/.test(brief) && /EMI/.test(brief), "an AI call to this lead gets the story as its brief", brief);
  const ctx = await svc.recentCallContext(B, `91${phone}`);
  expect(/RECENT PHONE CALL/.test(ctx) && /asked about EMI/.test(ctx) && /Interested/.test(ctx) && (await svc.recentCallContext(B, "919000000001")) === "", "WhatsApp replies to this number get the recent call; other numbers don't", ctx);

  await db.delete(schema.leads).where(eq(schema.leads.id, lead.id));
  const left = await db.select().from(schema.leadStories).where(eq(schema.leadStories.businessAccountId, B));
  expect(left.length === 0, "deleting the lead deletes its story");

  svc.setStoryWriterForTesting(null);
  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll lead timeline checks passed.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
