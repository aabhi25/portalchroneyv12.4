/**
 * Design Studio (server/services/designStudio.ts), against a local Postgres/PGlite, with placeholder
 * pictures in place of the image AI and a stand-in for the AI's motif advice:
 *
 *  - the switch and the brand's settings (only photos from our own upload are kept);
 *  - a shopper's session: only theirs (visitor token), motif advice limited to the brand's motifs,
 *    three designs drawn in the background, a price range from the brand's rules;
 *  - a change needs the shopper's name and mobile number first; that makes the lead (on a chat made
 *    for it), tagged "Design Studio";
 *  - the limit on images per session;
 *  - "Make this for me": the session becomes a request, the lead carries the design, the chat shows it;
 *  - the brand's side: the request list, moving a request on, and the numbers.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55601/postgres?sslmode=disable \
 *   DESIGN_STUDIO_TEST_DB=1 npx tsx server/services/__tests__/designStudio.integration.test.ts
 */
import crypto from "crypto";
import http from "node:http";
import path from "path";
import { promises as fs } from "fs";
import type { AddressInfo } from "node:net";

const url = process.env.DATABASE_URL || "";
if (process.env.DESIGN_STUDIO_TEST_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set DESIGN_STUDIO_TEST_DB=1 and point DATABASE_URL at a local throwaway database.");
  process.exit(1);
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString("hex");
process.env.DESIGN_STUDIO_FAKE_RENDER = "1";
process.env.NODE_ENV = "test";
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;

let failed = 0;
function expect(cond: any, label: string, got?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}`, got === undefined ? "" : JSON.stringify(got)); } else { console.log(`✓ ${label}`); }
}

/** Stand-in for the AI's motif advice: two real motifs, one made up, one repeated. */
async function startFake() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const content = JSON.stringify({
        intro: "For your mother's wedding necklace, these would be beautiful:",
        picks: [{ id: "peacock", why: "A wedding classic she will treasure." }, { id: "unicorn", why: "Not a motif." }, { id: "lotus", why: "" }, { id: "peacock", why: "Again." }],
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => server.close() };
}

async function main() {
  const fake = await startFake();
  process.env.OPENAI_BASE_URL = fake.url;

  const { db, pool } = await import("../../db");
  const schema = await import("@shared/schema");
  const { eq, asc } = await import("drizzle-orm");
  const studio = await import("../designStudio");
  const { DesignStudioError } = studio;

  const code = async (work: () => Promise<unknown>): Promise<string> => {
    try { await work(); return "ok"; } catch (e) { return e instanceof DesignStudioError ? e.code : `threw: ${(e as Error).message}`; }
  };

  const stamp = Date.now();
  const [biz] = await db.insert(schema.businessAccounts).values({ name: `Design Studio ${stamp}`, website: "https://jeweller.example.com", openaiApiKey: "sk-test-not-real" } as any).returning();
  const B = biz.id;
  const uploads = path.join(process.cwd(), "uploads", "design-studio", B);

  try {
    // ── the switch and the settings ────────────────────────────────────────
    expect(!(await studio.isDesignStudioOn(B)), "off until switched on");
    await db.update(schema.businessAccounts).set({ designStudioEnabled: "true" }).where(eq(schema.businessAccounts.id, B));
    expect(await studio.isDesignStudioOn(B), "on once switched on");
    expect((await studio.getDesignStudioSettings(B)).ratesConfirmed === false, "a new account starts from the defaults (no prices shown)");

    const saved = await studio.saveDesignStudioSettings(B, {
      ratesConfirmed: true, makingChargePercent: 10, maxRendersPerSession: 5,
      metals: [{ id: "gold-18k-yellow", name: "18K yellow gold", ratePerGram: 10000 }],
      stones: [{ id: "ruby", name: "Ruby", pricePerStone: 1000 }],
      pieceWeights: { necklace: { min: 10, max: 40 } },
      stylePhotos: ["https://elsewhere.example.com/a.jpg", `/uploads/design-studio/${B}/style.jpg`],
      customMotifs: [{ name: "Jaipur jaali", meaning: "Our lattice", occasions: ["Wedding"], imageUrl: "https://elsewhere.example.com/m.jpg" }],
    });
    expect(saved.stylePhotos.length === 1 && saved.stylePhotos[0].startsWith("/uploads/design-studio/") && saved.customMotifs[0].imageUrl === null,
      "only photos from our own upload are kept", { style: saved.stylePhotos, motif: saved.customMotifs[0] });
    expect((await studio.getDesignStudioSettings(B)).metals[0].ratePerGram === 10000, "settings read back");
    expect((await studio.imageAiStatus(B)).ready, "image AI ready (placeholder pictures in this test)");

    // ── a shopper's session ────────────────────────────────────────────────
    let row = await studio.startSession({ businessAccountId: B, visitorToken: "visitor-1", pageUrl: "https://jeweller.example.com/rings" });
    expect(row.status === "started" && row.renderCount === 0 && !row.conversationId, "a session starts empty");
    expect(await code(() => studio.getSession(row.id, B, "someone-else")) === "not_found", "another visitor can't open it");
    expect(await code(() => studio.getSession("not-an-id", B, "visitor-1")) === "not_found", "a made-up id finds nothing");
    expect((await studio.getSession(row.id, B, "visitor-1")).id === row.id, "the shopper's own token opens it");

    const advice = await studio.suggestMotifs(B, { piece: "necklace", recipient: "Mother", occasion: "Wedding" });
    const ids = advice.suggestions.map(s => s.motifId);
    expect(advice.intro.startsWith("For your mother's wedding necklace") && ids.length === 4 && ids[0] === "peacock" && ids[1] === "lotus" && !ids.includes("unicorn") && new Set(ids).size === 4,
      "motif advice: the AI's picks kept in order, made-up and repeated ones dropped, topped up to four", advice);
    expect(advice.suggestions[0].why === "A wedding classic she will treasure." && advice.suggestions[1].why.length > 10, "each pick has a reason (the AI's, or our own when it gave none)", advice.suggestions);

    expect(await code(() => studio.startDesigns(row, { piece: "necklace" })) === "incomplete", "designs need a motif, a metal and a size");
    const choices = { piece: "necklace", recipient: "Mother", occasion: "Wedding", motifId: "peacock", metalId: "gold-18k-yellow", stoneId: "ruby", tier: "classic" };
    row = await studio.startDesigns(row, choices);
    expect(row.designs.length === 3 && row.designs.every(d => d.status === "pending" && d.round === 1) && row.renderCount === 3, "three designs start drawing at once", row.designs);
    // necklace 10–40 g in three sizes → classic 20–30 g × 10,000 × 1.1, plus 6–14 rubies
    expect(row.priceLow === 226000 && row.priceHigh === 344000, "price range from the brand's rules", [row.priceLow, row.priceHigh]);

    const waitFor = async (done: (r: typeof row) => boolean) => {
      for (let i = 0; i < 60; i++) {
        const r = await studio.getSession(row.id, B, "visitor-1");
        if (done(r)) return r;
        await new Promise(res => setTimeout(res, 500));
      }
      return studio.getSession(row.id, B, "visitor-1");
    };
    row = await waitFor(r => r.designs.every(d => d.status !== "pending"));
    expect(row.designs.every(d => d.status === "ready" && d.url?.startsWith(`/uploads/design-studio/${B}/`)) && row.status === "designed", "the three designs finish and are kept", row.designs);
    const file = await fs.stat(path.join(process.cwd(), row.designs[0].url!)).catch(() => null);
    expect(!!file && file.size > 1000, "the picture is on disk");

    const settings = await studio.getDesignStudioSettings(B);
    let pub = studio.toPublicSession(row, settings);
    expect(pub.priceText === "₹2,26,000 – ₹3,44,000" && !pub.hasContact && !pub.requested && pub.rendersLeft === 2, "what the widget sees", pub);

    // ── a change needs the shopper's details ───────────────────────────────
    const first = row.designs[0];
    expect(await code(() => studio.startChange(row, first.id, "make the peacock smaller")) === "contact_required", "a change asks for name and number first");
    expect(await code(() => studio.startDesigns(row, choices)) === "contact_required", "so does drawing a new set");
    expect(await code(() => studio.saveContact(row, { name: "Asha", phone: "12345" })) === "bad_contact", "a bad mobile number is refused");
    expect(await code(() => studio.saveContact(row, { name: "", phone: "9811204567" })) === "bad_contact", "a name is needed");
    row = await studio.saveContact(row, { name: "Asha Rao", phone: "9811204567" });
    expect(!!row.leadId && !!row.conversationId, "name and number make a lead on a chat");
    let [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, row.leadId!));
    expect(lead.name === "Asha Rao" && lead.phone === "9811204567" && lead.conversationId === row.conversationId && (lead.topicsOfInterest || []).includes("Design Studio")
      && /^Design Studio: Classic Necklace · Peacock motif/.test(lead.message || "") && lead.sourceUrl === "https://jeweller.example.com/rings", "the lead: details, page, tagged Design Studio, what they are designing", lead);

    expect(await code(() => studio.startChange(row, first.id, "x")) === "no_change", "a change needs a few words");
    expect(await code(() => studio.startChange(row, "nope", "bigger")) === "not_found", "a change needs a real design");
    row = await studio.startChange(row, first.id, "make the peacock   smaller");
    const changed = row.designs[3];
    expect(changed.status === "pending" && changed.parentId === first.id && changed.change === "make the peacock smaller" && changed.round === 2 && row.renderCount === 4, "the change starts drawing", changed);
    row = await waitFor(r => r.designs.every(d => d.status !== "pending"));
    expect(row.designs[3].status === "ready" && !!row.designs[3].url, "the changed design finishes");

    // ── limits ─────────────────────────────────────────────────────────────
    row = await studio.startChange(row, first.id, "add more rubies");
    expect(row.renderCount === 5, "fifth image allowed (limit 5)");
    expect(await code(() => studio.startChange(row, first.id, "one more please")) === "session_limit", "sixth image refused");
    row = await waitFor(r => r.designs.every(d => d.status !== "pending"));
    await studio.saveDesignStudioSettings(B, { ...(await studio.getDesignStudioSettings(B)), maxRendersPerSession: 12, dailyRenderCap: 5 });
    expect(await code(() => studio.startChange(row, first.id, "one more please")) === "daily_limit", "the account's daily limit refuses too");
    await studio.saveDesignStudioSettings(B, { ...(await studio.getDesignStudioSettings(B)), dailyRenderCap: 150 });

    // ── "Make this for me" ─────────────────────────────────────────────────
    expect(await code(() => studio.requestDesign(row, { designId: "nope" })) === "not_found", "a request needs a design");
    const chosen = row.designs[3];
    row = await studio.requestDesign(row, { designId: chosen.id, note: "Ring size not needed, wedding is 12 Dec" });
    expect(row.status === "requested" && !!row.requestedAt && row.chosenDesignId === chosen.id && row.requestNote === "Ring size not needed, wedding is 12 Dec", "the session becomes a request");
    [lead] = await db.select().from(schema.leads).where(eq(schema.leads.id, row.leadId!));
    expect((lead.message || "").includes(`design: ${chosen.url}`) && (lead.message || "").includes("estimate ₹2,26,000 – ₹3,44,000") && (lead.message || "").includes("wedding is 12 Dec"),
      "the lead carries the design, the estimate and the note", lead.message);
    const chat = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, row.conversationId!)).orderBy(asc(schema.messages.createdAt));
    expect(chat.length === 2 && chat[0].role === "user" && chat[1].role === "assistant" && chat[1].imageUrl === chosen.url, "the chat shows the request with the design", chat.map(m => [m.role, m.content, m.imageUrl]));
    pub = studio.toPublicSession(row, await studio.getDesignStudioSettings(B));
    expect(pub.requested && pub.hasContact && pub.chosenDesignId === chosen.id, "the widget sees it was requested");
    const again = await studio.requestDesign(row, { designId: first.id });
    expect(again.requestedAt?.getTime() === row.requestedAt?.getTime() && again.chosenDesignId === first.id, "asking again changes the chosen design, not when it was first asked");
    expect((await studio.similarProducts(row)).length === 0, "no products → no ready pieces (and no error)");

    // ── the same over the web addresses the chat and the portal use ────────
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    app.use((await import("../../routes/designStudio")).default);
    const web = await new Promise<import("node:http").Server>(r => { const srv = app.listen(0, "127.0.0.1", () => r(srv)); });
    const base = `http://127.0.0.1:${(web.address() as AddressInfo).port}/api/design-studio`;
    const post = async (pathname: string, body: Record<string, unknown>) => {
      const res = await fetch(`${base}/public/${pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessAccountId: B, ...body }) });
      return { status: res.status, body: await res.json() as any };
    };
    const config = await (await fetch(`${base}/public/config?businessAccountId=${B}`)).json() as any;
    expect(config.enabled && config.showPrices && config.pieces.some((p: any) => p.id === "necklace") && config.motifs[0].name === "Jaipur jaali"
      && !JSON.stringify(config).includes("ratePerGram") && !JSON.stringify(config).includes("stylePhotos"), "chat: the design kit, without the brand's rates or style photos", config.motifs?.[0]);
    const [offAccount] = await db.insert(schema.businessAccounts).values({ name: `Off ${stamp}`, website: "https://off.example.com" } as any).returning();
    const offConfig = await (await fetch(`${base}/public/config?businessAccountId=${offAccount.id}`)).json() as any;
    const offStart = await fetch(`${base}/public/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessAccountId: offAccount.id }) });
    expect(offConfig.enabled === false && offStart.status === 404, "chat: an account without the Design Studio gets nothing");
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, offAccount.id));

    const started = await post("sessions", { visitorToken: "visitor-2", pageUrl: "https://jeweller.example.com/" });
    const sid = started.body.session?.id;
    expect(started.status === 200 && !!sid && started.body.session.designs.length === 0 && !("visitorToken" in started.body.session), "chat: a session starts", started.body);
    expect((await post(`sessions/${sid}/state`, { visitorToken: "someone-else" })).status === 404, "chat: only the same visitor can read it");
    const webAdvice = await post(`sessions/${sid}/motifs`, { visitorToken: "visitor-2", choices: { piece: "necklace", occasion: "Wedding" } });
    expect(webAdvice.status === 200 && webAdvice.body.suggestions.length === 4, "chat: motif advice");
    const drawn = await post(`sessions/${sid}/designs`, { visitorToken: "visitor-2", choices: { ...choices, stoneId: "none", tier: "delicate" } });
    expect(drawn.status === 200 && drawn.body.session.designs.length === 3 && drawn.body.session.priceText === "₹1,10,000 – ₹2,20,000", "chat: designs start, with the estimate", drawn.body.session?.priceText);
    let webState = drawn;
    for (let i = 0; i < 60 && webState.body.session.designs.some((d: any) => d.status === "pending"); i++) {
      await new Promise(res => setTimeout(res, 500));
      webState = await post(`sessions/${sid}/state`, { visitorToken: "visitor-2" });
    }
    const webDesign = webState.body.session.designs[0];
    const gate = await post(`sessions/${sid}/change`, { visitorToken: "visitor-2", designId: webDesign.id, change: "add a small ruby" });
    expect(gate.status === 403 && gate.body.code === "contact_required" && /name and mobile/.test(gate.body.error), "chat: a change asks for details first, in words the shopper can read", gate.body);
    const badNumber = await post(`sessions/${sid}/request`, { visitorToken: "visitor-2", designId: webDesign.id, name: "Meera", phone: "111" });
    expect(badNumber.status === 400 && badNumber.body.code === "bad_contact", "chat: a request with a bad number is refused", badNumber.body);
    for (const [method, pathname] of [["GET", "settings"], ["PUT", "settings"], ["GET", "requests"], ["PATCH", `requests/${row.id}`], ["POST", "upload"]]) {
      const res = await fetch(`${base}/${pathname}`, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      expect(res.status === 401, `portal: ${method} ${pathname} needs a login`, res.status);
    }
    await new Promise(r => web.close(() => r(null)));
    // This second shopper saw designs and left: no request.

    // ── the brand's side ───────────────────────────────────────────────────
    const from = new Date(Date.now() - 3600_000), to = new Date(Date.now() + 3600_000);
    const requests = await studio.listRequests(B, from, to);
    expect(requests.length === 1 && requests[0].name === "Asha Rao" && requests[0].phone === "9811204567" && requests[0].designUrl === first.url && requests[0].designs.length === 5
      && requests[0].summary.startsWith("Classic Necklace · Peacock motif · 18K yellow gold · Ruby") && requests[0].priceText === "₹2,26,000 – ₹3,44,000", "the request list", requests[0]);
    let funnel = await studio.designFunnel(B, from, to);
    expect(funnel.started === 2 && funnel.designed === 2 && funnel.requested === 1 && funnel.quoted === 0 && funnel.ordered === 0 && funnel.images === 8, "the numbers: 2 started, 2 saw designs, 1 asked, 8 images", funnel);
    expect(await code(() => studio.updateRequest(B, row.id, { status: "started" })) === "bad_status", "a request can't be moved to a made-up status");
    await studio.updateRequest(B, row.id, { status: "ordered", staffNotes: "  Quoted 2.9L, paid advance  " });
    funnel = await studio.designFunnel(B, from, to);
    const [after] = await db.select().from(schema.designSessions).where(eq(schema.designSessions.id, row.id));
    expect(funnel.quoted === 1 && funnel.ordered === 1 && after.staffNotes === "Quoted 2.9L, paid advance", "moved to Ordered with a note", funnel);
    const [other] = await db.insert(schema.businessAccounts).values({ name: `Other ${stamp}`, website: "https://other.example.com" } as any).returning();
    expect(await code(() => studio.updateRequest(other.id, row.id, { status: "closed" })) === "not_found" && (await studio.listRequests(other.id, from, to)).length === 0, "another account can't see or change it");
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, other.id));
  } finally {
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, B)).catch(() => undefined);
    await fs.rm(uploads, { recursive: true, force: true }).catch(() => undefined);
  }

  fake.close();
  await pool.end().catch(() => {});
  if (failed) { console.error(`\n${failed} Design Studio checks failed`); process.exit(1); }
  console.log("\nAll Design Studio integration checks passed");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
