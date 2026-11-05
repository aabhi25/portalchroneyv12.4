import assert from "node:assert/strict";
import { normalizeMessageNudgeItems, shownMessageNudges } from "@shared/messageNudges";

// Always three slots, so a message keeps its number.
assert.equal(normalizeMessageNudgeItems(null).length, 3);
assert.equal(normalizeMessageNudgeItems([{ message: "a", delay: 5 }, {}, {}, { message: "d", delay: 5 }]).length, 3);
assert.deepEqual(normalizeMessageNudgeItems([{ message: "a ", delay: 1 }])[0], { message: "a ", delay: 5 });
assert.equal(normalizeMessageNudgeItems([{ message: "a", delay: 999 }])[0].delay, 120);
assert.equal(normalizeMessageNudgeItems([{ message: "x".repeat(600), delay: 10 }])[0].message.length, 500);
assert.equal(normalizeMessageNudgeItems([{ message: 5, delay: "soon" }])[0].delay, 20);

const items = [{ message: " one ", delay: 5 }, { message: "   ", delay: 5 }, { message: "three", delay: 5 }];
// Only the numbers asked for, in the business's order, without empty slots or unknown numbers.
assert.deepEqual(shownMessageNudges(items, [2, 0, 1, 7, "0"]), [{ index: 0, text: "one" }, { index: 2, text: "three" }]);
assert.deepEqual(shownMessageNudges(items, []), []);
assert.deepEqual(shownMessageNudges(items, "0"), []);
assert.deepEqual(shownMessageNudges(null, [0]), []);

console.log("messageNudges tests passed");

// Saving, against a test database: MESSAGE_NUDGE_TEST_DB=1 and DATABASE_URL.
if (process.env.MESSAGE_NUDGE_TEST_DB) {
  const { storage } = await import("../../storage");
  const { saveShownMessageNudges } = await import("../messageNudgeService");
  const { pool } = await import("../../db");
  const { rows: [{ id: businessAccountId }] } = await pool.query("SELECT id FROM business_accounts LIMIT 1");
  const { rows: [{ id: otherBusinessId }] } = await pool.query("SELECT id FROM business_accounts WHERE id <> $1 LIMIT 1", [businessAccountId]);
  const before = await storage.getWidgetSettings(businessAccountId);
  const conversation = await storage.createConversation({ businessAccountId, title: "Message nudge test" });
  const otherChat = await storage.createConversation({ businessAccountId: otherBusinessId, title: "Message nudge test" });
  const texts = async () => (await storage.getMessagesByConversation(conversation.id, businessAccountId)).map((m) => m.content);
  try {
    const nudgeItems = [{ message: "First **one**", delay: 5 }, { message: "Second\nline", delay: 5 }, { message: "Third", delay: 5 }];

    // Off: nothing is saved.
    await storage.upsertWidgetSettings(businessAccountId, { messageNudgeEnabled: "false", messageNudgeItems: nudgeItems });
    assert.deepEqual(await saveShownMessageNudges(businessAccountId, conversation.id, [0]), []);
    assert.deepEqual(await texts(), []);

    await storage.upsertWidgetSettings(businessAccountId, { messageNudgeEnabled: "true", messageNudgeItems: nudgeItems });
    // Another business's chat, and a spam chat: nothing is saved.
    assert.deepEqual(await saveShownMessageNudges(businessAccountId, otherChat.id, [0]), []);
    assert.deepEqual(await saveShownMessageNudges(businessAccountId, "temp_x", [0]), []);
    // Only the messages shown, with the text from the settings.
    assert.deepEqual(await saveShownMessageNudges(businessAccountId, conversation.id, [0, 1]), ["First **one**", "Second\nline"]);
    assert.deepEqual(await texts(), ["First **one**", "Second\nline"]);
    // A chat that has messages already is left alone.
    assert.deepEqual(await saveShownMessageNudges(businessAccountId, conversation.id, [2]), []);
    assert.deepEqual(await texts(), ["First **one**", "Second\nline"]);
    // Publishing from a group.
    const { rows: [{ id: groupId }] } = await pool.query("INSERT INTO account_groups (name, owner_user_id) SELECT 'Message nudge test', id FROM users LIMIT 1 RETURNING id");
    try {
      await pool.query("INSERT INTO account_group_members (group_id, business_account_id) VALUES ($1, $2)", [groupId, businessAccountId]);
      // A group with no messages leaves the account's own alone.
      await storage.upsertGroupExtraSettings(groupId, { messageNudgeEnabled: "false", messageNudgeItems: normalizeMessageNudgeItems(null) });
      await storage.publishGroupExtraSettingsToMembers(groupId);
      let account = await storage.getWidgetSettings(businessAccountId);
      assert.equal(account?.messageNudgeEnabled, "true");
      assert.equal(shownMessageNudges(account?.messageNudgeItems, [0])[0].text, "First **one**");
      // A group with messages replaces them; switching it off turns them off everywhere.
      await storage.upsertGroupExtraSettings(groupId, { messageNudgeEnabled: "true", messageNudgeItems: [{ message: "From the group", delay: 15 }] });
      await storage.publishGroupExtraSettingsToMembers(groupId);
      account = await storage.getWidgetSettings(businessAccountId);
      assert.deepEqual(normalizeMessageNudgeItems(account?.messageNudgeItems)[0], { message: "From the group", delay: 15 });
      await storage.upsertGroupExtraSettings(groupId, { messageNudgeEnabled: "false" });
      await storage.publishGroupExtraSettingsToMembers(groupId);
      account = await storage.getWidgetSettings(businessAccountId);
      assert.equal(account?.messageNudgeEnabled, "false");
    } finally {
      await pool.query("DELETE FROM account_groups WHERE id = $1", [groupId]);
    }
    console.log("messageNudges database tests passed");
  } finally {
    await storage.upsertWidgetSettings(businessAccountId, {
      // Publishing also copies these from the group.
      responseLength: before?.responseLength,
      autoOpenChat: before?.autoOpenChat,
      openingSoundEnabled: before?.openingSoundEnabled,
      openingSoundStyle: before?.openingSoundStyle,
      inactivityNudgeEnabled: before?.inactivityNudgeEnabled,
      inactivityNudgeDelay: before?.inactivityNudgeDelay,
      inactivityNudgeMessage: before?.inactivityNudgeMessage,
      smartNudgeEnabled: before?.smartNudgeEnabled,
      messageNudgeEnabled: before?.messageNudgeEnabled ?? "false",
      messageNudgeItems: before?.messageNudgeItems ?? null,
    });
    await pool.query("DELETE FROM messages WHERE conversation_id = ANY($1)", [[conversation.id, otherChat.id]]);
    await pool.query("DELETE FROM conversations WHERE id = ANY($1)", [[conversation.id, otherChat.id]]);
    await pool.end();
  }
  process.exit(0); // storage keeps timers running
}
