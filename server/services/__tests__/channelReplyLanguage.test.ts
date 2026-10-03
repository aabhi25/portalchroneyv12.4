/**
 * Pure helpers of language/channelReplyLanguage.ts (no database, no AI).
 * Run: npx tsx server/services/__tests__/channelReplyLanguage.test.ts
 * (The full channel behaviour is in socialLanguage.integration.test.ts.)
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused@127.0.0.1:1/unused"; // never queried here

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ""}`); }
}

async function main() {
  const C = await import("../language/channelReplyLanguage");
  const L = await import("../language/languagePolicy");
  const { DEFAULT_AI_LANGUAGE_SETTINGS } = await import("@shared/replyLanguages");
  const policy = (over: any, ch: any) => L.policyFromSettings(L.normalizeLanguageSettings({ ...DEFAULT_AI_LANGUAGE_SETTINGS, ...over }), ch);

  expect(C.channelConversationKey("whatsapp", "b1", "+91 98765-43210") === "whatsapp:b1:9876543210" && C.channelConversationKey("whatsapp", "b1", "9876543210") === "whatsapp:b1:9876543210", "WhatsApp key: same chat for 91-prefixed and plain numbers (campaign + AI replies share it)");
  expect(C.channelConversationKey("instagram", "b1", "123", "comment") === "instagram-comment:b1:123" && C.channelConversationKey("facebook", "b1", null) === null, "comment keys are separate; no customer → no key");

  expect(C.isHandoffPrefill('Hi! I was asking about "fees" on your website.') && C.isHandoffPrefill("Hi! I was asking about Rolex Daytona on your website.") && C.isHandoffPrefill("Hi! I was chatting on your website."), "our hand-off pre-fill texts are recognised");
  expect(!C.isHandoffPrefill("Hi! I was asking about fees, can you tell me?") && !C.isHandoffPrefill("hello"), "customer texts are not");

  expect(/Roman/.test(C.scriptRuleFor("hinglish")) && /Devanagari/.test(C.scriptRuleFor("hi")) && /Tamil script/.test(C.scriptRuleFor("ta")) && /Latin script only/.test(C.scriptRuleFor("en")), "script rule per reply language");

  const p = policy({ mode: "restricted", allowed: ["en", "hi"], defaultLanguage: "en" }, "whatsapp");
  const resolution = L.resolveReplyLanguage({ policy: p, detected: "ta" });
  const lang = { language: resolution.language!, resolution, policy: p, withNote: true, rule: L.buildLanguageRule(resolution, p, { noteAllowed: true }) };
  const override = C.restrictedLanguageOverride(lang);
  expect(/REPLY LANGUAGE/.test(override) && /short friendly sentence/.test(override) && /Ignore the language of earlier messages/.test(override) && /SCRIPT RULE: Latin script only/.test(override) && !/ABSOLUTE OVERRIDE/.test(override), "restricted override = business rule + history + script line", override);
  const noNote = C.withoutLanguageNote(lang)!;
  expect(!noNote.withNote && !/short friendly sentence/.test(noNote.rule) && /ENTIRE reply in English/.test(noNote.rule), "second message of the same turn: same language, no note");
  expect(C.withoutLanguageNote(null) === null, "unrestricted stays null");
  expect(/followUp text in English/.test(C.flowResponseLanguageLine(lang, "followUp")) && /English or Hindi/.test(C.flowResponseLanguageLine(lang)) && /extracted values exactly/.test(C.flowResponseLanguageLine(lang)), "flow line names the field, the allowed languages and protects extracted values");

  expect(await C.checkReplyLanguage("b1", "Any text at all in any language here", null) === "Any text at all in any language here", "no restriction → reply untouched (no call)");
  expect(await C.ourText("b1", "Sorry, I'm having trouble answering right now.", null) === "Sorry, I'm having trouble answering right now.", "no restriction → our text untouched (no call)");

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log("\nAll channel reply-language helper checks passed.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
