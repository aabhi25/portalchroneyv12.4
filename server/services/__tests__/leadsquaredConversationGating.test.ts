/**
 * Smoke tests for the post-summarization CRM push gating
 * (chatService.syncConversationSummaryToLeadSquared).
 * Run manually: `npx tsx server/services/__tests__/leadsquaredConversationGating.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 *
 * The gate must keep the post-summarization push strictly an UPDATE: it only
 * fires when LeadSquared is enabled+configured, an enabled conversation.* mapping
 * exists, and the conversation's lead is already CRM-synced (has a
 * leadsquaredLeadId) with a phone/email. Otherwise it must be a no-op.
 */
import { storage } from "../../storage";
import { chatService } from "../../chatService";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

// Invoke the private method under test (accessible at runtime in JS).
const runSync = (convId: string, bizId: string): Promise<void> =>
  (chatService as any).syncConversationSummaryToLeadSquared(convId, bizId);

const enabledSettings = {
  leadsquaredEnabled: "true",
  leadsquaredAccessKey: "ak",
  leadsquaredSecretKey: "enc-sk",
  leadsquaredRegion: "india",
};
const conversationMapping = [
  { id: "m1", isEnabled: "true", sourceType: "dynamic", sourceField: "conversation.summary" },
];

async function withStubs(
  overrides: {
    settings?: any;
    mappings?: any;
    lead?: any;
  },
  fn: () => Promise<void>,
) {
  const origSettings = (storage as any).getWidgetSettings;
  const origMappings = (storage as any).getLeadsquaredFieldMappings;
  const origLead = (storage as any).getLeadByConversation;
  const origFetch = global.fetch;

  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    return { ok: true, json: async () => ({ Status: "Success" }) } as any;
  }) as any;

  (storage as any).getWidgetSettings = async () => overrides.settings ?? enabledSettings;
  (storage as any).getLeadsquaredFieldMappings = async () => overrides.mappings ?? conversationMapping;
  (storage as any).getLeadByConversation = async () => overrides.lead;

  try {
    await fn();
    return () => fetchCalled;
  } finally {
    (storage as any).getWidgetSettings = origSettings;
    (storage as any).getLeadsquaredFieldMappings = origMappings;
    (storage as any).getLeadByConversation = origLead;
    global.fetch = origFetch;
  }
}

(async () => {
  // (a) Lead exists with phone but NO leadsquaredLeadId => no CRM call (no create).
  {
    let wasFetchCalled: (() => boolean) | undefined;
    wasFetchCalled = await withStubs(
      { lead: { id: "l1", phone: "+10000000000", email: null, leadsquaredLeadId: null } },
      () => runSync("c1", "b1"),
    );
    expect(wasFetchCalled() === false, "unsynced lead (no leadsquaredLeadId) => no CRM request");
  }

  // (b) LeadSquared disabled => no CRM call.
  {
    const wasFetchCalled = await withStubs(
      { settings: { leadsquaredEnabled: "false" }, lead: { id: "l1", phone: "+1", leadsquaredLeadId: "LSQ-1" } },
      () => runSync("c1", "b1"),
    );
    expect(wasFetchCalled() === false, "LeadSquared disabled => no CRM request");
  }

  // (c) No enabled conversation.* mapping => no CRM call.
  {
    const wasFetchCalled = await withStubs(
      {
        mappings: [{ id: "m1", isEnabled: "true", sourceType: "dynamic", sourceField: "lead.name" }],
        lead: { id: "l1", phone: "+1", leadsquaredLeadId: "LSQ-1" },
      },
      () => runSync("c1", "b1"),
    );
    expect(wasFetchCalled() === false, "no conversation.* mapping => no CRM request");
  }

  // (d) No lead for the conversation => no CRM call.
  {
    const wasFetchCalled = await withStubs({ lead: undefined }, () => runSync("c1", "b1"));
    expect(wasFetchCalled() === false, "no lead for conversation => no CRM request");
  }

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll post-summarization gating tests passed.");
  process.exit(0);
})();
