/**
 * Integration test for the shared WhatsApp number (real SQL): linking rules, the owner's sending
 * details filled in for linked accounts, routing incoming messages, shared opt-outs.
 *
 * DESTRUCTIVE: creates rows. It refuses to run unless DATABASE_URL points at localhost AND
 * SHARED_WA_TEST_DB=1 is set. Run against a throwaway Postgres with the migrations applied:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable \
 *   SHARED_WA_TEST_DB=1 npx tsx server/services/__tests__/sharedWhatsappNumber.integration.test.ts
 */
const url = process.env.DATABASE_URL || '';
if (process.env.SHARED_WA_TEST_DB !== '1' || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('Refusing to run: set SHARED_WA_TEST_DB=1 and point DATABASE_URL at a local throwaway database.');
  process.exit(1);
}

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}
async function expectError(fn: () => Promise<unknown>, pattern: RegExp, label: string) {
  try {
    await fn();
    expect(false, `${label} (no error)`);
  } catch (err: any) {
    expect(pattern.test(String(err?.message)), `${label}: "${err?.message}"`);
  }
}

async function main() {
  const { db } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const shared = await import("../whatsapp/sharedNumber");
  const { whatsappService } = await import("../whatsappService");
  const { contactGroupService } = await import("../contactGroupService");
  const { getConnectedWhatsappNumber } = await import("../whatsappHandoffService");

  const now = Date.now();
  const account = async (name: string, whatsappEnabled = "true") =>
    (await db.insert(schema.businessAccounts).values({ name, website: "https://example.com", whatsappEnabled } as any).returning())[0].id;
  const [owner] = await db.insert(schema.users).values({ username: `wa-share-${now}`, passwordHash: "x", role: "super_admin" }).returning();
  const O = await account("Symbiosis Online MBA");
  const A = await account("Symbiosis Online BBA");
  const B = await account("Symbiosis Online PGDBA");
  const C = await account("Symbiosis Off", "false");
  const D = await account("Other Group Account");
  const [group] = await db.insert(schema.accountGroups).values({ name: `Share group ${now}`, ownerUserId: owner.id }).returning();
  for (const id of [O, A, B, C]) await db.insert(schema.accountGroupMembers).values({ groupId: group.id, businessAccountId: id });

  await whatsappService.saveSettings(O, {
    msg91AuthKey: "owner-key", whatsappNumber: "+91 90000 00001", msg91IntegratedNumberId: "int-owner",
    sessionTemplateName: "owner_reengage", webhookSecret: "whsec_owner", autoReplyEnabled: "true",
  } as any);
  await whatsappService.saveSettings(A, { msg91AuthKey: "a-key", whatsappNumber: "919000000002", msg91IntegratedNumberId: "int-a", webhookSecret: "whsec_a", autoReplyEnabled: "false" } as any);

  try {
    // ── Linking rules ────────────────────────────────────────────────────────
    await expectError(() => shared.linkAccount(O, D, owner.id), /same account group/, "an account outside the group can't be linked");
    await expectError(() => shared.linkAccount(O, O, owner.id), /itself/, "an account can't link itself");
    const shareA = await shared.linkAccount(O, A, owner.id);
    const shareB = await shared.linkAccount(O, B, owner.id);
    expect(/^SOB-[A-Z2-9]{4}$/.test(shareA.tag), `landing-page tag from the name (${shareA.tag})`);
    await expectError(() => shared.linkAccount(O, A, owner.id), /already uses this number/, "linking twice is refused");
    await expectError(() => shared.linkAccount(A, B, owner.id), /uses another account's number/, "a linked account can't share a number");
    expect(!!(await whatsappService.getOwnSettings(B))?.webhookSecret, "an account without WhatsApp settings gets its own row");
    const candidates = await shared.linkCandidates(O);
    expect(candidates.find((c) => c.businessAccountId === A)?.linkedHere && candidates.find((c) => c.businessAccountId === C)?.whatsappEnabled === false, "candidates show linked and WhatsApp-off accounts");
    expect(!shareA.whatsappTurnedOn, "linking an account with WhatsApp on leaves it as it is");
    const shareC = await shared.linkAccount(O, C, owner.id);
    const [cAfter] = await db.select({ on: schema.businessAccounts.whatsappEnabled }).from(schema.businessAccounts).where(eq(schema.businessAccounts.id, C));
    expect(shareC.whatsappTurnedOn && cAfter.on === "true", "linking an account with WhatsApp off turns it on");
    await shared.unlinkAccount(O, C);

    // ── Sending details ─────────────────────────────────────────────────────
    const sA = await whatsappService.getSettings(A);
    expect(sA?.msg91AuthKey === "owner-key" && sA?.msg91IntegratedNumberId === "int-owner" && sA?.sessionTemplateName === "owner_reengage", "a linked account sends with the owner's key, number ID and template");
    expect(sA?.autoReplyEnabled === "false" && sA?.webhookSecret === "whsec_a", "its own AI and webhook settings stay its own");
    expect((await whatsappService.getOwnSettings(A))?.msg91AuthKey === "a-key", "its own saved key is kept for later");
    expect((await whatsappService.getSettings(O))?.msg91AuthKey === "owner-key", "the owner is unchanged");
    expect(await getConnectedWhatsappNumber(A) === "919000000001", "the website WhatsApp button of a linked account opens the owner's number");
    const summary = await shared.sharedNumberSummary(B);
    expect(summary.role === "linked" && summary.landingPageLink?.startsWith("https://wa.me/919000000001?text=") && summary.landingPageLink.includes(encodeURIComponent(`(${shareB.tag})`)), "a linked account gets its landing-page link");
    expect((await shared.sharedNumberSummary(O)).role === "owner", "the owner is shown as sharing");

    // ── Routing incoming messages ───────────────────────────────────────────
    const phone = (n: number) => `9198765${String(n).padStart(5, "0")}`;
    const [handoff] = await db.insert(schema.whatsappHandoffs).values({
      businessAccountId: B, code: "K7Q2MX", source: "header", targetNumber: "919000000001", connectedNumber: true,
      expiresAt: new Date(now + 86_400_000),
    }).returning();
    let route = await shared.routeSharedInbound(O, phone(1), "Hi! I was asking about fees. (Ref: K7Q2MX)");
    expect(route?.accountId === B && route.reason === "ref" && route.text.includes("K7Q2MX"), "a website chat code goes to the account that made it (code left for its hand-off step)");

    route = await shared.routeSharedInbound(O, phone(2), `${shared.LANDING_PAGE_MESSAGE} (${shareA.tag.toLowerCase()})`);
    expect(route?.accountId === A && route.reason === "tag" && route.text === shared.LANDING_PAGE_MESSAGE, "a landing-page tag goes to its account, and is removed");
    expect((await shared.routeSharedInbound(O, phone(3), `(${shareA.tag})`))?.text === "Hi", "a message that was only the tag becomes Hi");

    const [tpl] = await db.insert(schema.whatsappTemplates).values({ businessAccountId: B, name: "promo" } as any).returning();
    const [campaign] = await db.insert(schema.marketingCampaigns).values({ businessAccountId: B, name: "Promo", templateId: tpl.id, status: "completed" } as any).returning();
    await db.insert(schema.marketingCampaignRecipients).values({ campaignId: campaign.id, businessAccountId: B, phone: phone(4), sendPhone: phone(4), status: "delivered", sentAt: new Date(now - 3_600_000) } as any);
    await db.insert(schema.whatsappSessions).values({ businessAccountId: A, phoneNumber: phone(4), lastUserMessageAt: new Date(now - 7_200_000) });
    route = await shared.routeSharedInbound(O, phone(4), "Tell me more");
    expect(route?.accountId === B && route.reason === "campaign", "a reply to a campaign goes to the account that sent it (before an older chat)");

    await db.insert(schema.whatsappSessions).values({ businessAccountId: A, phoneNumber: phone(5), lastUserMessageAt: new Date(now - 86_400_000) });
    await db.insert(schema.whatsappSessions).values({ businessAccountId: O, phoneNumber: phone(5), lastUserMessageAt: new Date(now - 3 * 86_400_000) });
    route = await shared.routeSharedInbound(O, phone(5), "hello again");
    expect(route?.accountId === A && route.reason === "recent", "someone who chatted recently goes to the account they last wrote to");

    await db.insert(schema.whatsappSessions).values({ businessAccountId: A, phoneNumber: phone(6), lastUserMessageAt: new Date(now - 40 * 86_400_000) });
    route = await shared.routeSharedInbound(O, phone(6), "hello");
    expect(route?.accountId === O && route.reason === "owner", "an old chat (over 30 days) and anyone else goes to the owner");
    expect((await shared.routeSharedInbound(O, phone(7), undefined))?.accountId === O, "a photo with no text from someone new goes to the owner");
    expect(await shared.routeSharedInbound(C, phone(1), "hi") === null, "an account that shares nothing is not routed");

    // ── Receipts and opt-outs ──────────────────────────────────────────────
    expect((await shared.accountsOnNumber(O)).join() === [O, A, B].join() && (await shared.accountsOnNumber(A)).length === 3, "receipts are matched across every account on the number");
    expect((await shared.accountsOnNumber(C)).join() === C, "an account with its own number only checks itself");
    await db.insert(schema.whatsappOptOuts).values({ businessAccountId: A, phone: phone(8), reason: "user_stop" });
    expect((await contactGroupService.getOptOutSet(B)).has(phone(8)) && (await contactGroupService.getOptOutSet(O)).has(phone(8)), "Stop to one account stops every account on the number");
    expect(!(await contactGroupService.getOptOutSet(C)).has(phone(8)), "accounts on other numbers are not affected");

    // ── Removing ────────────────────────────────────────────────────────────
    expect(await shared.unlinkAccount(O, A), "an account can be removed");
    expect((await whatsappService.getSettings(A))?.msg91AuthKey === "a-key", "a removed account uses its own key again");
    expect(!(await contactGroupService.getOptOutSet(O)).has(phone(8)), "after removal its opt-outs are its own again");
    expect(await shared.unlinkAll(O) === 1, "stop sharing removes the rest");
    expect((await shared.sharedNumberSummary(B)).role === "none", "nothing is shared any more");
    void handoff;
  } finally {
    await db.delete(schema.accountGroups).where(eq(schema.accountGroups.id, group.id));
    for (const id of [O, A, B, C, D]) await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, id));
  }

  if (failed) {
    console.error(`\n${failed} shared-number check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll shared WhatsApp number checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
