import assert from "node:assert/strict";
import { describeValue, fieldDetailRows, mentionedNames, mergeInstructions, sameValue, stableStringify, websiteHost } from "@shared/settingsCopy";

// Comparing.
assert.equal(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] }), stableStringify({ a: [{ c: 2, d: 1 }], b: 1 }));
assert.ok(sameValue("", null));
assert.ok(!sameValue("x", null));
assert.equal(describeValue('[{"a":1},{"a":2}]'), "2 items");
assert.equal(describeValue("true"), "On");

// Instructions.
let n = 0;
const newId = () => `new-${++n}`;
const own = JSON.stringify([{ id: "1", text: "Be kind", type: "always" }]);
const theirs = JSON.stringify([{ id: "1", text: "  be KIND ", type: "always" }, { id: "1", text: "Mention fees", type: "always" }, { id: "2", text: "Say hi", type: "always" }]);
const added = mergeInstructions(own, theirs, "add", newId);
assert.equal(added.added, 2);
assert.deepEqual(JSON.parse(added.value).map((i: any) => i.text), ["Be kind", "Mention fees", "Say hi"]);
assert.equal(new Set(JSON.parse(added.value).map((i: any) => i.id)).size, 3); // No id used twice.
const replaced = mergeInstructions(JSON.stringify([{ id: "9", text: "Mine only" }]), theirs, "replace", newId);
assert.equal(replaced.removed, 1);
assert.equal(replaced.value, theirs);
assert.equal(mergeInstructions(own, own, "add", newId).added, 0);
assert.equal(mergeInstructions("Older free text", null, "add", newId).added, 0);
assert.deepEqual(JSON.parse(mergeInstructions(null, "Older free text", "add", newId).value)[0].text, "Older free text");

// Names from the source account.
assert.deepEqual(mentionedNames("Welcome to Jaro Online MBA!", ["Jaro Online MBA"], "Other Uni"), ["Jaro Online MBA"]);
assert.deepEqual(mentionedNames("Welcome to Jaro!", ["Jaro"], "Jaro Delhi"), []);
assert.deepEqual(mentionedNames("Hello", ["Jaro"], "Other"), []);
assert.equal(websiteHost("https://www.jaro.in/mba"), "jaro.in");
assert.equal(websiteHost("jaro.in"), "jaro.in");
// The details panel.
assert.deepEqual(fieldDetailRows("chatColor", "#111111"), [{ label: "Main colour", value: "#111111", kind: "color" }]);
assert.deepEqual(fieldDetailRows("messageNudgeEnabled", "false"), [{ label: "Message nudges", value: "Off" }]);
assert.deepEqual(fieldDetailRows("inactivityNudgeDelay", "90"), [{ label: "After", value: "90 seconds" }]);
assert.deepEqual(fieldDetailRows("messageNudgeItems", [{ message: "One", delay: 20 }, { message: " ", delay: 20 }, { message: "Three", delay: 5 }]), [
  { label: "Message 1, after 20 seconds", value: "One" },
  { label: "Message 3, after 5 seconds", value: "Three" },
]);
assert.deepEqual(fieldDetailRows("conversationStarters", '["Fees?","Syllabus?"]'), [
  { label: "Question 1", value: "Fees?" },
  { label: "Question 2", value: "Syllabus?" },
]);
assert.equal(fieldDetailRows("availableLanguages", ["auto", "hi", "hinglish"])[0].value, "Detect automatically, Hindi, Hinglish");
assert.equal(fieldDetailRows("welcomeMessage", null)[0].value, "(empty)");

console.log("settingsCopy tests passed");

// Copying between accounts, against a test database: SETTINGS_COPY_TEST_DB=1 and DATABASE_URL.
if (process.env.SETTINGS_COPY_TEST_DB) {
  const { storage } = await import("../../storage");
  const { describeSource, previewCopy, runCopy, undoCopy, copyHistory, imageUsedByOtherAccount } = await import("../settingsCopyService");
  const { pool } = await import("../../db");
  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params).then((r: any) => r.rows);
  const account = async (name: string) => (await q("INSERT INTO business_accounts (name, website) VALUES ($1, 'https://www.sourceschool.example') RETURNING id", [name]))[0].id as string;
  const sourceId = await account("Source School");
  const targetA = await account("Target Alpha");
  const targetB = await account("Target Beta");
  const [{ id: ownerId }] = await q("SELECT id FROM users LIMIT 1");
  const [{ id: groupId }] = await q("INSERT INTO account_groups (name, owner_user_id) VALUES ('Copy test', $1) RETURNING id", [ownerId]);
  for (const id of [sourceId, targetA, targetB]) {
    await q("INSERT INTO account_group_members (group_id, business_account_id) VALUES ($1, $2)", [groupId, id]);
  }
  const journey = async (businessAccountId: string, name: string, extra = "'false'") =>
    (await q(`INSERT INTO conversation_journeys (business_account_id, name, journey_type, status, start_from_scratch) VALUES ($1, $2, 'form', 'active', ${extra}) RETURNING id`, [businessAccountId, name]))[0].id as string;
  const step = async (journeyId: string, order: number, text: string, branching: string | null = null) =>
    (await q("INSERT INTO journey_steps (journey_id, step_order, question_text, branching_condition) VALUES ($1, $2, $3, $4) RETURNING id", [journeyId, order, text, branching]))[0].id as string;
  const settings = (id: string) => storage.getWidgetSettings(id) as Promise<any>;
  const steps = async (journeyId: string) => (await q("SELECT id, question_text, branching_condition FROM journey_steps WHERE journey_id = $1 ORDER BY step_order", [journeyId]));
  try {
    await storage.upsertWidgetSettings(sourceId, {
      chatColor: "#111111",
      welcomeMessageType: "custom",
      welcomeMessage: "Welcome to Source School!",
      customInstructions: JSON.stringify([{ id: "s1", text: "Mention scholarships", type: "always" }]),
      leadTrainingConfig: { fields: [{ id: "mobile", enabled: true, required: true, priority: 1, captureStrategy: "start", otpEnabled: false }], captureStrategy: "smart", conversionUrl: "https://source.example/thanks" },
      avatarType: "custom",
      avatarUrl: "https://cdn.example/source.png",
      leadsquaredAccessKey: "must-not-travel",
    } as any);
    await storage.upsertWidgetSettings(targetA, {
      chatColor: "#222222",
      cachedIntro: "Old AI greeting",
      customInstructions: JSON.stringify([{ id: "a1", text: "Target's own", type: "always" }]),
      leadTrainingConfig: { fields: [{ id: "mobile", enabled: true, required: false, priority: 1, captureStrategy: "smart", otpEnabled: true }], captureStrategy: "smart", conversionUrl: "https://alpha.example/thanks" },
      leadsquaredAccessKey: "alpha-key",
    } as any);
    await storage.upsertWidgetSettings(targetB, { chatColor: "#111111", welcomeMessageType: "custom", welcomeMessage: "Welcome to Source School!" } as any);

    // Source journeys: a start-up form with branching, and another that will be left behind.
    const form = await journey(sourceId, "Admission form", "'true'");
    const q2Placeholder = await step(form, 1, "Second question?");
    const q1 = await step(form, 0, "First question?", JSON.stringify({ routes: [{ matchType: "contains", matchValue: "x", targetStepId: q2Placeholder }], defaultNextStepId: null }));
    await journey(sourceId, "Not copied");
    // Target Alpha: same-named journey with an extra question, and its own start-up journey.
    const alphaForm = await journey(targetA, "ADMISSION FORM");
    const alphaFirst = await step(alphaForm, 0, "Old first");
    await step(alphaForm, 1, "Old second");
    await step(alphaForm, 2, "Old third");
    const alphaStartup = await journey(targetA, "Alpha start-up", "'true'");
    // Source menu with a form button, a submenu and rich details.
    await q("INSERT INTO chat_menu_configs (business_account_id, enabled, welcome_message) VALUES ($1, 'true', 'Hi from Source School')", [sourceId]);
    const [{ id: parent }] = await q("INSERT INTO chat_menu_items (business_account_id, title, item_type) VALUES ($1, 'Programs', 'navigate') RETURNING id", [sourceId]);
    const [{ id: child }] = await q("INSERT INTO chat_menu_items (business_account_id, parent_id, title, item_type, action_value) VALUES ($1, $2, 'Apply', 'form', $3) RETURNING id", [sourceId, parent, form]);
    await q("INSERT INTO chat_menu_item_details (menu_item_id, tabs) VALUES ($1, $2)", [child, JSON.stringify([{ id: "t", label: "About", content: "Details" }])]);
    await q("INSERT INTO chat_menu_items (business_account_id, title, item_type) VALUES ($1, 'Alpha button', 'chat')", [targetA]);

    // What the source has.
    const described = await describeSource(sourceId);
    assert.equal(described.journeys.length, 2);
    assert.equal(described.items.find((i) => i.key === "menu")?.empty, false);
    // The details panel has the complete values.
    const details = (key: string) => JSON.stringify(described.items.find((i) => i.key === key)?.sections);
    assert.ok(details("instructions").includes("Mention scholarships"));
    assert.ok(details("lead-training").includes("Mandatory, asked at the start"));
    assert.ok(details("journeys").includes("First question?"));
    assert.ok(details("menu").includes('Programs \u203a Apply'));
    assert.ok(details("menu").includes('Opens the form \\"Admission form\\"'));
    assert.ok(!details("assistant-picture").includes("must-not-travel"));
    assert.ok(!JSON.stringify(described).includes("must-not-travel")); // No secrets, anywhere.

    const request = {
      sourceAccountId: sourceId,
      targetIds: [targetA, targetB],
      items: ["chat-colours", "welcome", "lead-training", "instructions", "journeys", "menu", "assistant-picture"],
      instructionsMode: "add" as const,
      journeyIds: [form],
    };

    // Review.
    const preview = await previewCopy(groupId, request);
    const alpha = preview.find((t) => t.businessAccountId === targetA)!;
    const beta = preview.find((t) => t.businessAccountId === targetB)!;
    assert.ok(alpha.changes.some((c) => c.key === "chat-colours"));
    assert.ok(!beta.changes.some((c) => c.key === "chat-colours")); // Already the same colour.
    assert.ok(!beta.changes.some((c) => c.key === "welcome"));
    assert.ok(alpha.warnings.some((w) => w.key === "welcome" && w.message.includes("Source School")));
    assert.ok(alpha.warnings.some((w) => w.message.includes("loses 1 question")));
    assert.ok(alpha.warnings.some((w) => w.message.includes("Alpha start-up")));
    assert.ok((await settings(targetA)).chatColor === "#222222"); // Review changes nothing.

    // Copy.
    const { copyId, results } = await runCopy(groupId, request, { id: ownerId, name: "tester" });
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    let a = await settings(targetA);
    assert.equal(a.chatColor, "#111111");
    assert.equal(a.welcomeMessage, "Welcome to Source School!");
    assert.equal(a.cachedIntro, null);
    assert.equal(a.leadsquaredAccessKey, "alpha-key"); // Never copied.
    assert.deepEqual(JSON.parse(a.customInstructions).map((i: any) => i.text), ["Target's own", "Mention scholarships"]);
    const phone = a.leadTrainingConfig.fields.find((f: any) => f.id === "mobile");
    assert.equal(phone.required, true);
    assert.equal(phone.otpEnabled, true); // Stays on the account.
    assert.equal(a.leadTrainingConfig.conversionUrl, "https://alpha.example/thanks");
    assert.ok(a.customAvatars.some((x: any) => x.url === "https://cdn.example/source.png"));
    assert.equal(await imageUsedByOtherAccount(sourceId, "https://cdn.example/source.png"), true);

    // Journeys: updated in place, the extra question gone, branching points at this account's steps.
    const alphaSteps = await steps(alphaForm);
    assert.deepEqual(alphaSteps.map((s: any) => s.question_text), ["First question?", "Second question?"]);
    assert.equal(alphaSteps[0].id, alphaFirst);
    assert.equal(JSON.parse(alphaSteps[0].branching_condition).routes[0].targetStepId, alphaSteps[1].id);
    const [{ start_from_scratch: alphaOld }] = await q("SELECT start_from_scratch FROM conversation_journeys WHERE id = $1", [alphaStartup]);
    assert.equal(alphaOld, "false");
    const betaJourneys = await q("SELECT id, name FROM conversation_journeys WHERE business_account_id = $1", [targetB]);
    assert.deepEqual(betaJourneys.map((j: any) => j.name), ["Admission form"]);
    assert.equal((await q("SELECT 1 FROM conversation_journeys WHERE business_account_id = $1 AND name = 'Not copied'", [targetA])).length, 0);

    // Menu: nesting, details, and the form button points at this account's own journey.
    const betaItems = await q("SELECT id, parent_id, title, action_value FROM chat_menu_items WHERE business_account_id = $1", [targetB]);
    const betaApply = betaItems.find((i: any) => i.title === "Apply");
    assert.equal(betaApply.parent_id, betaItems.find((i: any) => i.title === "Programs").id);
    assert.equal(betaApply.action_value, betaJourneys[0].id);
    assert.equal((await q("SELECT 1 FROM chat_menu_item_details WHERE menu_item_id = $1", [betaApply.id])).length, 1);
    assert.equal((await q("SELECT 1 FROM chat_menu_items WHERE business_account_id = $1 AND title = 'Alpha button'", [targetA])).length, 0);

    // Copying again changes nothing.
    const again = await previewCopy(groupId, request);
    assert.deepEqual(again.flatMap((t) => t.changes.map((c) => `${t.name}: ${c.label}`)), []);

    // Undo needs the newest copy.
    const { copyId: second } = await runCopy(groupId, { ...request, items: ["chat-colours"], targetIds: [targetA] }, { name: "tester" });
    await assert.rejects(() => undoCopy(groupId, copyId, "tester"), /newest/);
    await undoCopy(groupId, second, "tester");
    const history = await copyHistory(groupId);
    assert.equal(history.find((h) => h.canUndo)?.id, copyId);

    // Undo brings everything back.
    await undoCopy(groupId, copyId, "tester");
    a = await settings(targetA);
    assert.equal(a.chatColor, "#222222");
    assert.equal(a.leadTrainingConfig.conversionUrl, "https://alpha.example/thanks");
    assert.equal(a.leadTrainingConfig.fields.find((f: any) => f.id === "mobile").required, false);
    assert.deepEqual(JSON.parse(a.customInstructions).map((i: any) => i.text), ["Target's own"]);
    assert.deepEqual((await steps(alphaForm)).map((s: any) => s.question_text), ["Old first", "Old second", "Old third"]);
    assert.equal((await q("SELECT start_from_scratch FROM conversation_journeys WHERE id = $1", [alphaStartup]))[0].start_from_scratch, "true");
    assert.deepEqual((await q("SELECT title FROM chat_menu_items WHERE business_account_id = $1", [targetA])).map((i: any) => i.title), ["Alpha button"]);
    assert.equal((await q("SELECT 1 FROM conversation_journeys WHERE business_account_id = $1", [targetB])).length, 0);
    assert.equal((await q("SELECT 1 FROM chat_menu_items WHERE business_account_id = $1", [targetB])).length, 0);
    assert.equal((await q("SELECT 1 FROM chat_menu_configs WHERE business_account_id = $1", [targetB])).length, 0);
    await assert.rejects(() => undoCopy(groupId, copyId, "tester"), /newest/);

    // Replacing instructions warns about what goes.
    const replacePreview = await previewCopy(groupId, { ...request, items: ["instructions"], instructionsMode: "replace", targetIds: [targetA] });
    assert.ok(replacePreview[0].warnings.some((w) => w.message.includes("Removes 1 instruction")));

    // An account that has never been set up goes back to its defaults, and undo can be repeated if it failed.
    const fresh = await account("Never Set Up");
    await q("INSERT INTO account_group_members (group_id, business_account_id) VALUES ($1, $2)", [groupId, fresh]);
    await q("DELETE FROM widget_settings WHERE business_account_id = $1", [fresh]);
    const freshCopy = await runCopy(groupId, { ...request, items: ["chat-colours", "menu"], targetIds: [fresh] }, { name: "tester" });
    assert.equal((await settings(fresh)).chatColor, "#111111");
    await undoCopy(groupId, freshCopy.copyId, "tester");
    assert.notEqual((await settings(fresh)).chatColor, "#111111");
    assert.equal((await q("SELECT 1 FROM chat_menu_items WHERE business_account_id = $1", [fresh])).length, 0);
    assert.equal((await q("SELECT 1 FROM chat_menu_configs WHERE business_account_id = $1", [fresh])).length, 0);
    assert.equal((await copyHistory(groupId)).find((h) => h.id === freshCopy.copyId)?.undoneAt !== null, true);
    fresh && await q("DELETE FROM business_accounts WHERE id = $1", [fresh]);

    // LeadSquared: the UDS connection and the field mappings travel only when ticked; keys are never shown.
    const { encrypt, decrypt } = await import("../encryptionService");
    const { isLeadSquaredConfigured } = await import("../crmLeadSync");
    const UDS_URL = "https://in-uds.leadsquared.com/hook/abc?ickey=SECRETICKEY";
    const udsKey = encrypt("uds-secret-1");
    await storage.upsertWidgetSettings(sourceId, {
      leadsquaredEnabled: "true", leadsquaredConnectionType: "uds", leadsquaredUdsWebhookUrl: UDS_URL, leadsquaredUdsKey: udsKey,
    } as any);
    const mapping = (businessAccountId: string, field: string, type: string, value: string, order: number) =>
      q(`INSERT INTO leadsquared_field_mappings (business_account_id, leadsquared_field, source_type, source_field, custom_value, display_name, sort_order)
         VALUES ($1, $2, $3, $4, $5, $2, $6)`, [businessAccountId, field, type, type === "dynamic" ? value : null, type === "custom" ? value : null, order]);
    await mapping(sourceId, "FirstName", "dynamic", "lead.name", 1);
    await mapping(sourceId, "mx_Course", "custom", "Online MBA", 2);
    await mapping(targetA, "mx_Course", "custom", "Online MCA", 1);
    const mappingsOf = async (id: string) => (await q("SELECT leadsquared_field, source_type, custom_value FROM leadsquared_field_mappings WHERE business_account_id = $1 ORDER BY sort_order", [id]));
    const secrets = ["SECRETICKEY", "uds-secret-1", udsKey, "must-not-travel"];
    const noSecrets = (value: unknown) => secrets.every((secret) => !JSON.stringify(value).includes(secret));

    const lsqSource = await describeSource(sourceId);
    const connection = lsqSource.items.find((i) => i.key === "leadsquared-connection")!;
    assert.equal(connection.summary, "UDS · sync on");
    assert.equal(lsqSource.items.find((i) => i.key === "leadsquared-mappings")!.summary, "2 fields");
    assert.ok(noSecrets(lsqSource), "the source description shows no key or link secret");

    const lsqRequest = { ...request, items: ["leadsquared-connection"], targetIds: [targetA, targetB] };
    const connPreview = await previewCopy(groupId, lsqRequest);
    assert.ok(noSecrets(connPreview), "the review shows no key or link secret");
    const previewB = connPreview.find((p) => p.businessAccountId === targetB)!;
    assert.deepEqual(previewB.changes[0].details.map((d) => d.field), ["Sync to LeadSquared", "Connection method", "UDS webhook link", "UDS key"]);
    assert.ok(previewB.warnings.some((w) => w.message.includes("no LeadSquared field mappings")));
    assert.ok(previewB.warnings.some((w) => w.message.includes("Sync all to CRM")));
    assert.ok(!connPreview.find((p) => p.businessAccountId === targetA)!.warnings.some((w) => w.message.includes("no LeadSquared field mappings")));

    const mapPreview = await previewCopy(groupId, { ...lsqRequest, items: ["leadsquared-mappings"], targetIds: [targetA] });
    assert.ok(mapPreview[0].warnings.some((w) => w.message.includes('changes from "Online MCA" to "Online MBA"')));

    const lsqCopy = await runCopy(groupId, { ...lsqRequest, items: ["leadsquared-connection", "leadsquared-mappings"] }, { name: "tester" });
    assert.ok(lsqCopy.results.every((r) => r.ok));
    for (const id of [targetA, targetB]) {
      const s = await settings(id);
      assert.equal(s.leadsquaredConnectionType, "uds");
      assert.equal(s.leadsquaredUdsWebhookUrl, UDS_URL);
      assert.equal(decrypt(s.leadsquaredUdsKey), "uds-secret-1");
      assert.ok(isLeadSquaredConfigured(s), "the account now sends leads to LeadSquared");
      assert.deepEqual((await mappingsOf(id)).map((m: any) => m.custom_value ?? m.leadsquared_field), ["FirstName", "Online MBA"]);
    }
    assert.equal((await settings(targetA)).leadsquaredAccessKey, "alpha-key"); // A UDS copy leaves the API keys alone.
    // The same key encrypted again counts as the same: nothing left to copy.
    await storage.upsertWidgetSettings(targetB, { leadsquaredUdsKey: encrypt("uds-secret-1") } as any);
    const lsqAgain = await previewCopy(groupId, { ...lsqRequest, items: ["leadsquared-connection", "leadsquared-mappings"] });
    assert.ok(lsqAgain.every((p) => p.changes.length === 0));

    await undoCopy(groupId, lsqCopy.copyId, "tester");
    const undoneA = await settings(targetA);
    assert.notEqual(undoneA.leadsquaredConnectionType, "uds");
    assert.ok(!undoneA.leadsquaredUdsKey);
    assert.deepEqual((await mappingsOf(targetA)).map((m: any) => m.custom_value), ["Online MCA"]);
    assert.equal((await mappingsOf(targetB)).length, 0);
    await storage.upsertWidgetSettings(sourceId, { leadsquaredEnabled: "false" } as any);

    // One account failing doesn't stop the others; its reason is kept, and trying it again works.
    await q(`CREATE FUNCTION copy_test_fail() RETURNS trigger AS $$ BEGIN IF NEW.chat_color = '#FA11ED' AND NEW.business_account_id = '${targetA}' THEN RAISE EXCEPTION 'Forced failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await q("CREATE TRIGGER copy_test_fail BEFORE UPDATE ON widget_settings FOR EACH ROW EXECUTE FUNCTION copy_test_fail()");
    try {
      await storage.upsertWidgetSettings(sourceId, { chatColor: "#FA11ED" } as any);
      const failed = await runCopy(groupId, { ...request, items: ["chat-colours"] }, { name: "tester" });
      assert.equal(failed.results.find((r) => r.businessAccountId === targetA)?.ok, false);
      assert.match(failed.results.find((r) => r.businessAccountId === targetA)?.error ?? "", /Forced failure/);
      assert.equal(failed.results.find((r) => r.businessAccountId === targetB)?.ok, true);
      assert.equal((await settings(targetB)).chatColor, "#FA11ED");
    } finally {
      await q("DROP TRIGGER copy_test_fail ON widget_settings");
      await q("DROP FUNCTION copy_test_fail()");
    }
    const retried = await runCopy(groupId, { ...request, items: ["chat-colours"], targetIds: [targetA] }, { name: "tester" });
    assert.equal(retried.results[0].ok, true);
    assert.equal((await settings(targetA)).chatColor, "#FA11ED");

    console.log("settingsCopy database tests passed");
  } finally {
    await q("DELETE FROM account_groups WHERE id = $1", [groupId]);
    await q("DELETE FROM business_accounts WHERE id = ANY($1)", [[sourceId, targetA, targetB]]);
    await pool.end();
  }
  process.exit(0); // storage keeps timers running
}
