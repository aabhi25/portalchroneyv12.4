/**
 * Lead-field timing for Instagram / Facebook DMs and WhatsApp (leadCapture/channelLeadFields.ts):
 * name / email / phone detection, "already asked" detection, keyword matching, the next-field
 * decision and the prompt wording. Pure functions — no database.
 *
 *   npx tsx server/services/__tests__/channelLeadFields.test.ts
 */
import {
  normalizeChannelLeadFields, analyzeLeadConversation, resolveNextLeadAsk, buildChannelLeadPrompt,
  detectName, detectEmail, extractContacts, askedKinds, matchedKeywords, currentConversation, ensureCurrentMessage,
  phoneValidationOf, sensitivityDescription, type ChatTurn,
} from "../leadCapture/channelLeadFields";
import { validatePhoneNumber } from "@shared/validation/phone";

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (!cond) { failed++; console.error(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); } else { console.log(`✓ ${label}`); }
}
const u = (content: string): ChatTurn => ({ role: "user", content });
const a = (content: string): ChatTurn => ({ role: "assistant", content });
const field = (id: string, extra: Record<string, any> = {}) => ({ id, enabled: true, required: false, priority: 1, captureStrategy: "start", ...extra });

// ── Names ────────────────────────────────────────────────────────────────────
const names: [ChatTurn[], string | null, string][] = [
  [[u("my name is Rahul Sharma")], "Rahul Sharma", "my name is X"],
  [[u("Hi, my name is Priya and I want to know the fees")], "Priya", "my name is X + more text"],
  [[u("I'm Ankit")], "Ankit", "I'm X as the whole message"],
  [[u("hello, I am Neha Verma")], "Neha Verma", "greeting + I am X"],
  [[u("mera naam Rahul hai")], "Rahul", "Hindi: mera naam X hai"],
  [[u("Mera naam hai Suresh Kumar")], "Suresh Kumar", "Hindi: mera naam hai X"],
  [[u("naam Pooja hai")], "Pooja", "Hindi: naam X hai"],
  [[u("Myself Karan from Pune")], "Karan", "Indian English: myself X"],
  [[u("Name: Ravi Teja")], "Ravi Teja", "Name: X"],
  [[u("my name is Anita Desai, anita@example.com, call me on 98123 45670")], "Anita Desai", "punctuation ends the name"],
  [[u("I'm Rahul.")], "Rahul", "I'm X with a full stop"],
  [[u("I'm interested in the MBA course")], null, "\"I'm interested…\" is not a name"],
  [[u("I am looking for a home loan")], null, "\"I am looking…\" is not a name"],
  [[u("I'm good, thanks")], null, "\"I'm good\" is not a name"],
  [[u("I'm Rahul and I need a loan")], null, "\"I'm X and …\" needs the whole message"],
  [[u("aapka naam kya hai?")], null, "a question about the bot's name is not a name"],
  [[a("May I know your name?"), u("Rahul Verma")], "Rahul Verma", "plain reply to a name ask"],
  [[a("May I know your name?"), u("it's Simran")], "Simran", "\"it's X\" reply to a name ask"],
  [[a("May I know your name?"), u("why?")], null, "\"why?\" after a name ask"],
  [[a("May I know your name?"), u("no")], null, "\"no\" after a name ask"],
  [[a("May I know your name?"), u("pricing please")], null, "a question after a name ask"],
  [[a("May I know your name?"), u("tell me the fees")], null, "\"tell me the fees\" after a name ask"],
  [[a("What are you looking for?"), u("Rahul Verma")], null, "bare words without a name ask"],
  [[u("my name is Rahul"), u("sorry, my name is Rahul Kumar")], "Rahul Kumar", "latest introduction wins"],
];
for (const [conv, want, label] of names) {
  const got = detectName(conv);
  expect(got === want, `name: ${label}`, got);
}

// ── Email / phone ────────────────────────────────────────────────────────────
expect(detectEmail([u("mail me at rahul.s@example.co.in please")]) === "rahul.s@example.co.in", "email detected inside a sentence");
{
  const c = extractContacts([u("my number is 98123 45670")], "10");
  expect(c.phone === "9812345670" && c.rejectedPhoneReason === null, "10-digit number passes the '10' rule", c);
}
{
  const c = extractContacts([u("call 98765 43210")], "12");
  expect(c.phone === null && c.rejectedPhoneReason === "too_short", "phoneValidation '12' is honoured (10 digits rejected)", c);
}
{
  const c = extractContacts([a("Could you share your mobile number?"), u("981234567")], "8-12");
  expect(c.phone === "981234567", "phoneValidation '8-12' accepts 9 digits", c);
}
{
  const c = extractContacts([u("my number is +91 98123 45670")], "10");
  const v = validatePhoneNumber("+91 98123 45670", "10");
  expect((c.phone !== null) === v.isValid, `"+91 98123 45670" with '10' follows shared/validation/phone.ts (currently ${v.isValid ? "valid" : "invalid"})`, c);
}
expect(extractContacts([u("budget is 15000000 rupees")], "10").phone === null && extractContacts([u("budget is 15000000 rupees")], "10").rejectedPhoneReason === null, "an 8-digit amount is not treated as a phone number");
expect(phoneValidationOf({ phoneValidation: "8-12" }) === "8-12" && phoneValidationOf({ digitCount: 12 }) === "12" && phoneValidationOf({}) === "10", "phoneValidation read from the UI value, legacy digitCount as fallback");

// ── Asks / keywords ──────────────────────────────────────────────────────────
expect([...askedKinds("Thanks! Could you share your email address?")].join() === "email", "email ask detected");
expect(askedKinds("Before I help, may I know your name?").has("name"), "name ask detected");
expect(askedKinds("Aapka naam kya hai?").has("name"), "Hindi name ask detected");
expect(askedKinds("Sure! Name please?").has("name"), "\"name please\" ask detected");
expect(askedKinds("Please share your mobile number so our team can call you.").has("phone"), "phone ask detected");
expect(askedKinds("Thanks for sharing your name, Rahul! Our MBA fee is 5 lakh.").size === 0, "an acknowledgement is not an ask");
expect(matchedKeywords("What is the PRICE?", ["price"]).length === 1, "keyword: case-insensitive");
expect(matchedKeywords("this is priceless", ["price"]).length === 0, "keyword: whole word only (price ≠ priceless)");
expect(matchedKeywords("send the fee   structure pls", ["fee structure"]).length === 1, "keyword: multi-word phrase, any spacing");
expect(matchedKeywords("fees?", ["fee structure"]).length === 0, "keyword: phrase needs all words");

// ── Conversation window ──────────────────────────────────────────────────────
{
  const t0 = new Date("2026-09-01T10:00:00Z");
  const h = (hours: number) => new Date(t0.getTime() + hours * 3600_000);
  const turns: ChatTurn[] = [
    { role: "user", content: "old", at: h(0) }, { role: "assistant", content: "old reply", at: h(0.1) },
    { role: "user", content: "new", at: h(30) }, { role: "assistant", content: "new reply", at: h(30.1) },
  ];
  expect(currentConversation(turns).map(t => t.content).join() === "new,new reply", "a new conversation starts after 24 h of silence");
  expect(ensureCurrentMessage([u("hi")], "hi").length === 1 && ensureCurrentMessage([u("hi"), a("hello")], "hi").length === 3, "current message added only when not stored yet");
}

// ── Decisions ────────────────────────────────────────────────────────────────
function decide(config: any[], conv: ChatTurn[], known = {}, exclude?: any) {
  const fields = normalizeChannelLeadFields({ fields: config }, exclude ? { excludeKinds: exclude } : {});
  const state = analyzeLeadConversation(fields, conv, known);
  const d = resolveNextLeadAsk(fields, state);
  return { d, state, fields, prompt: buildChannelLeadPrompt(d, state, fields, { channel: "instagram" }) };
}
{
  // Priority across timings: email (start, p1) before name (start, p2).
  const { d } = decide([field("name", { priority: 2 }), field("email", { priority: 1 })], [u("hi")]);
  expect(d.field?.id === "email" && d.mode === "after_answer", "lower priority number asked first, optional → after answering", d.mode);
}
{
  const cfg = [field("email", { captureStrategy: "custom", customAskAfter: 3 })];
  expect(decide(cfg, [u("1"), a("r"), u("2")]).d.mode === "none", "custom N=3: nothing on message 2");
  expect(decide(cfg, [u("1"), a("r"), u("2"), a("r"), u("3")]).d.field?.id === "email", "custom N=3: asked on message 3");
  expect(decide([field("email", { captureStrategy: "smart" })], [u("1"), a("r"), u("2")]).d.field?.id === "email", "legacy 'smart' = custom (default N=2)");
}
{
  const cfg = [field("name", { required: true })];
  const one = decide(cfg, [u("hi")]).d;
  const two = decide(cfg, [u("hi"), a("May I know your name?"), u("why?")]).d;
  const three = decide(cfg, [u("hi"), a("May I know your name?"), u("why?"), a("It helps us follow up. May I know your name?"), u("no")]).d;
  expect(one.mode === "block" && one.attempt === 1, "required start field blocks answering", one.mode);
  expect(two.mode === "block" && two.attempt === 2, "required field: one re-ask after a refusal", two);
  expect(three.mode === "none" && three.askedEnough.length === 1, "required field: capped at 2 asks", three.mode);
}
{
  const cfg = [field("email")];
  const d = decide(cfg, [u("hi"), a("Hello! Could you share your email address?"), u("no thanks"), a("Sure."), u("what are the timings?")]).d;
  expect(d.mode === "none" && d.askedEnough[0]?.id === "email", "optional field not re-asked after a decline", d.mode);
}
{
  const cfg = [field("name", { required: true, priority: 1 }), field("email", { required: true, priority: 2 })];
  const d = decide(cfg, [u("mera naam Rahul hai")]).d;
  expect(d.field?.id === "email" && d.collected.includes("name"), "name said in chat counts as collected", d);
  const saved = decide(cfg, [u("hello")], { name: "Rahul", email: "r@example.com" });
  expect(saved.d.mode === "none" && /never ask for this again|never ask for these again/.test(saved.prompt), "saved lead counts as collected", saved.prompt);
}
{
  const cfg = [field("email", { captureStrategy: "keyword", captureKeywords: ["price", "fee structure"] })];
  expect(decide(cfg, [u("is this priceless?")]).d.mode === "none", "keyword timing: no word-boundary match → no ask");
  expect(decide(cfg, [u("Fee Structure?")]).d.field?.id === "email", "keyword timing: multi-word match → ask");
  expect(decide(cfg, [u("price?"), a("It is 5k."), u("ok")]).d.field?.id === "email", "keyword timing: stays due after the keyword message");
}
{
  const cfg = [field("name", { captureStrategy: "intent", intentIntensity: "high", required: true })];
  const { d, prompt } = decide(cfg, [u("what courses?")]);
  expect(d.mode === "intent" && prompt.includes(sensitivityDescription("full name", "high")), "intent timing uses the website's sensitivity wording", prompt);
  const mixed = decide([field("name", { captureStrategy: "intent", priority: 1 }), field("email", { priority: 2 })], [u("hi")]);
  expect(mixed.d.field?.id === "email" && mixed.d.intentFirst?.id === "name" && mixed.prompt.includes("PRIORITY CHECK FIRST"), "higher-priority intent field is offered first, due field otherwise", mixed.d);
}
{
  const cfg = [field("mobile", { phoneValidation: "10", required: true })];
  const bad = decide(cfg, [u("my number is 12345")]);
  expect(bad.d.mode !== "fix_phone", "5 digits is not a phone attempt");
  const bad2 = decide(cfg, [a("Please share your mobile number?"), u("98765 4321")]);
  expect(bad2.d.mode === "fix_phone" && /not a valid mobile number/.test(bad2.prompt), "invalid number → one request for a correct one", bad2.prompt);
  const bad3 = decide(cfg, [a("Please share your mobile number?"), u("98765 4321"), a("That doesn't look right, could you share a valid 10-digit mobile number?"), u("98765 432")]);
  expect(bad3.d.mode !== "fix_phone" && bad3.d.mode !== "block", "second invalid number → stop asking for the phone", bad3.d.mode);
}
{
  // WhatsApp: phone fields are dropped, prompt says the phone is known; capture tool only when given.
  const fields = normalizeChannelLeadFields({ fields: [field("mobile", { required: true }), field("name", { priority: 2 })] }, { excludeKinds: ["phone"] });
  const state = analyzeLeadConversation(fields, [u("hi")]);
  const d = resolveNextLeadAsk(fields, state);
  const withTool = buildChannelLeadPrompt(d, state, fields, { channel: "whatsapp", captureTool: "capture_lead" });
  const without = buildChannelLeadPrompt(d, state, fields, { channel: "whatsapp" });
  expect(d.field?.id === "name" && /never ask for a phone/.test(withTool), "WhatsApp never asks for the phone", withTool);
  expect(withTool.includes("capture_lead") && !without.includes("capture_lead"), "capture tool mentioned only when it exists");
}

if (failed > 0) { console.error(`\n${failed} channel lead field check(s) failed.`); process.exit(1); }
console.log("\nAll channel lead field checks passed.");
