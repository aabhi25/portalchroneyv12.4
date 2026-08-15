/**
 * Smoke tests for the conversation.* CRM source (Conversation Summary / Topics).
 * Run manually: `npx tsx server/services/__tests__/leadsquaredConversation.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { LeadSquaredService, type LeadDataContext } from "../leadsquaredService";
import type { LeadsquaredFieldMapping } from "@shared/schema";

let failed = 0;
function expect(cond: any, label: string) {
  if (!cond) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

function mapping(
  partial: Partial<LeadsquaredFieldMapping> &
    Pick<LeadsquaredFieldMapping, "leadsquaredField" | "sourceType" | "sourceField">,
): LeadsquaredFieldMapping {
  return {
    id: "m-" + partial.leadsquaredField,
    businessAccountId: "biz-1",
    customValue: null,
    fallbackValue: null,
    displayName: partial.leadsquaredField,
    isEnabled: "true",
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as LeadsquaredFieldMapping;
}

const svc = new LeadSquaredService({
  accessKey: "ak",
  secretKey: "sk",
  region: "india",
});

function baseContext(overrides: Partial<LeadDataContext> = {}): LeadDataContext {
  return {
    lead: { name: "Ada", email: "ada@example.com", phone: "+10000000000" },
    session: {},
    business: { name: "Biz" },
    ...overrides,
  };
}

// ── Resolver: conversation.summary / conversation.topics ───────────────────
{
  const mappings = [
    mapping({ leadsquaredField: "mx_Summary", sourceType: "dynamic", sourceField: "conversation.summary" }),
    mapping({ leadsquaredField: "mx_Topics", sourceType: "dynamic", sourceField: "conversation.topics" }),
  ];
  const ctx = baseContext({
    conversation: { summary: "Visitor asked about gold rings.", topics: "gold, rings, pricing" },
  });
  const attrs = svc.buildAttributesFromMappings(mappings, ctx);
  const byField = Object.fromEntries(attrs.map((a) => [a.Attribute, a.Value]));
  expect(byField["mx_Summary"] === "Visitor asked about gold rings.", "summary resolves to mapped CRM field");
  expect(byField["mx_Topics"] === "gold, rings, pricing", "topics resolve to mapped CRM field");
}

// ── Empty conversation values are skipped (no attribute emitted) ────────────
{
  const mappings = [
    mapping({ leadsquaredField: "mx_Summary", sourceType: "dynamic", sourceField: "conversation.summary" }),
  ];
  const attrs = svc.buildAttributesFromMappings(mappings, baseContext({ conversation: { summary: null } }));
  expect(attrs.find((a) => a.Attribute === "mx_Summary") === undefined, "empty summary emits no attribute");
}

// ── Update-filter: conversation.* included even when not in changedFields ───
async function testUpdateFilterInclusion() {
  let capturedBody: any[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (_url: any, init: any) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ Status: "Success" }),
    } as any;
  }) as any;

  try {
    const mappings = [
      mapping({ leadsquaredField: "FirstName", sourceType: "dynamic", sourceField: "lead.name" }),
      mapping({ leadsquaredField: "mx_Summary", sourceType: "dynamic", sourceField: "conversation.summary" }),
      mapping({ leadsquaredField: "mx_Topics", sourceType: "dynamic", sourceField: "conversation.topics" }),
    ];
    const ctx = baseContext({
      conversation: { summary: "Discussed bangles.", topics: "bangles, sizing" },
    });
    // changedFields lists only 'name' — conversation.* must still be included.
    await svc.updateLeadWithMappings("lead-123", mappings, ctx, ["name"]);
    const byField = Object.fromEntries(capturedBody.map((a: any) => [a.Attribute, a.Value]));
    expect(byField["FirstName"] === "Ada", "changed lead.name included on update");
    expect(byField["mx_Summary"] === "Discussed bangles.", "conversation.summary included despite not in changedFields");
    expect(byField["mx_Topics"] === "bangles, sizing", "conversation.topics included despite not in changedFields");
  } finally {
    global.fetch = originalFetch;
  }
}

// ── Update-filter: conversation.* excluded when value absent ────────────────
async function testUpdateFilterExclusionWhenEmpty() {
  let capturedBody: any[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (_url: any, init: any) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ Status: "Success" }) } as any;
  }) as any;

  try {
    const mappings = [
      mapping({ leadsquaredField: "FirstName", sourceType: "dynamic", sourceField: "lead.name" }),
      mapping({ leadsquaredField: "mx_Summary", sourceType: "dynamic", sourceField: "conversation.summary" }),
    ];
    const ctx = baseContext({ conversation: { summary: null } });
    await svc.updateLeadWithMappings("lead-123", mappings, ctx, ["name"]);
    const fields = capturedBody.map((a: any) => a.Attribute);
    expect(!fields.includes("mx_Summary"), "empty conversation.summary excluded from update payload");
  } finally {
    global.fetch = originalFetch;
  }
}

(async () => {
  await testUpdateFilterInclusion();
  await testUpdateFilterExclusionWhenEmpty();

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll conversation.* CRM source tests passed.");
})();
