/**
 * Lead.Update recovery: fields the LeadSquared account doesn't have, and stored lead IDs that are
 * gone in LeadSquared (deleted / merged there).
 * Run manually: `npx tsx server/services/__tests__/leadsquaredUpdateRecovery.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { LeadSquaredService, unknownAttributesFromError, isLeadGoneError, type LeadDataContext } from "../leadsquaredService";
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

function mapping(leadsquaredField: string, sourceField: string): LeadsquaredFieldMapping {
  return {
    id: "m-" + leadsquaredField,
    businessAccountId: "biz-1",
    leadsquaredField,
    sourceType: "dynamic",
    sourceField,
    customValue: null,
    fallbackValue: null,
    displayName: leadsquaredField,
    isEnabled: "true",
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as LeadsquaredFieldMapping;
}

// ── Fake LeadSquared (in-memory, behind global.fetch) ───────────────────────
const fake = {
  fields: new Set(["FirstName", "EmailAddress", "Phone", "mx_City"]), // fields the account has
  leads: new Map<string, Record<string, string>>(), // id → attributes
  byPhone: new Map<string, string>(), // last 10 digits → id
  calls: [] as string[],
  n: 0,
};
function reply(status: number, body: any) {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, statusText: status < 400 ? "OK" : "Error", text: async () => text, json: async () => JSON.parse(text) } as any;
}
const originalFetch = global.fetch;
global.fetch = (async (input: any, init?: any) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  const attrs: Array<{ Attribute: string; Value: string }> = init?.body ? JSON.parse(init.body) : [];
  const phone = attrs.find(a => a.Attribute === "Phone")?.Value?.replace(/\D/g, "").slice(-10);
  if (u.pathname.endsWith("Lead.Update")) {
    const id = u.searchParams.get("leadId") || "";
    fake.calls.push(`update ${id} ${attrs.map(a => a.Attribute).join(",")}`);
    const unknown = attrs.filter(a => !fake.fields.has(a.Attribute)).map(a => a.Attribute);
    if (unknown.length) return reply(500, { Status: "Error", ExceptionType: "MXUnknownAttributeException", ExceptionMessage: `Attribute(s) does not exist - ${unknown.join(",")}.`, IsMXException: true });
    if (!fake.leads.has(id)) return reply(500, { Status: "Error", ExceptionType: "MXInvalidEntityException", ExceptionMessage: "Lead does not exist in the system.", IsMXException: true });
    for (const a of attrs) fake.leads.get(id)![a.Attribute] = a.Value;
    return reply(200, { Status: "Success", Message: { AffectedRows: 1 } });
  }
  if (u.pathname.endsWith("Lead.Capture")) {
    fake.calls.push(`capture ${attrs.map(a => a.Attribute).join(",")}`);
    if (phone && fake.byPhone.has(phone)) return reply(500, { Status: "Error", ExceptionType: "MXDuplicateEntryException", ExceptionMessage: "A Lead with same Phone Number already exists." });
    const id = `LSQ-${++fake.n}`;
    // Lead.Capture ignores fields the account doesn't have.
    fake.leads.set(id, Object.fromEntries(attrs.filter(a => fake.fields.has(a.Attribute)).map(a => [a.Attribute, a.Value])));
    if (phone) fake.byPhone.set(phone, id);
    return reply(200, { Status: "Success", Message: { Id: id } });
  }
  if (u.pathname.endsWith("RetrieveLeadByPhoneNumber")) {
    const id = fake.byPhone.get((u.searchParams.get("phone") || "").replace(/\D/g, "").slice(-10));
    fake.calls.push(`lookup ${id || "none"}`);
    return reply(200, id ? [{ ProspectID: id }] : []);
  }
  if (u.pathname.endsWith("Leads.GetByEmailaddress")) return reply(200, []);
  return reply(404, {});
}) as any;

function reset() {
  fake.leads.clear(); fake.byPhone.clear(); fake.calls = []; fake.n = 0;
}
function seed(id: string, phone: string, attrs: Record<string, string>) {
  fake.leads.set(id, { ...attrs }); fake.byPhone.set(phone.replace(/\D/g, "").slice(-10), id);
}

const svc = new LeadSquaredService({ accessKey: "ak", secretKey: "sk", region: "india" });
const mappings = [
  mapping("FirstName", "lead.name"),
  mapping("Phone", "lead.phone"),
  mapping("mx_City", "session.city"),
  mapping("Mx_Website_Campaign", "lead.sourceUrl"), // not a field in this LeadSquared account
  mapping("mx_convosummary", "conversation.summary"), // not a field either
];
function ctx(overrides: Partial<LeadDataContext["lead"]> = {}): LeadDataContext {
  return {
    lead: { name: "Priya", email: null, phone: "+91 98765 43210", sourceUrl: "https://example.com/mba", ...overrides },
    session: { city: "Pune" },
    business: { name: "Biz" },
    conversation: { summary: "Asked about fees." },
  };
}

(async () => {
  // ── Parsers ────────────────────────────────────────────────────────────────
  {
    const one = unknownAttributesFromError("Attribute(s) does not exist - Mx_Website_Campaign.");
    expect(one.length === 1 && one[0] === "Mx_Website_Campaign", "parses a single missing field");
    const many = unknownAttributesFromError("Attribute(s) does not exist - mx_convosummary,mx_convotopics,mx_course.");
    expect(many.join("|") === "mx_convosummary|mx_convotopics|mx_course", "parses several missing fields");
    expect(unknownAttributesFromError("Lead does not exist in the system.").length === 0, "other errors give no fields");
    expect(isLeadGoneError("Lead does not exist in the system") && isLeadGoneError("Lead does not exist in the system."), "recognises the lead-gone error");
    expect(!isLeadGoneError("Attribute(s) does not exist - mx_course."), "missing field is not lead-gone");
  }

  // ── 1. Missing fields: the update is resent without them ───────────────────
  {
    reset();
    seed("LSQ-A", "9876543210", { FirstName: "Old", Phone: "9876543210" });
    const r = await svc.updateLeadWithMappings("LSQ-A", mappings, ctx(), ["name", "city", "sourceUrl"]);
    expect(r.success, "update succeeds after dropping the missing fields");
    expect(fake.leads.get("LSQ-A")!.FirstName === "Priya" && fake.leads.get("LSQ-A")!.mx_City === "Pune", "the fields that exist reached LeadSquared");
    expect(/Mx_Website_Campaign/.test(r.message) && /mx_convosummary/.test(r.message), "result names the skipped fields");
    expect(r.syncPayload && !("Mx_Website_Campaign" in r.syncPayload) && r.syncPayload.FirstName === "Priya", "sync payload shows only what was sent");
    expect(fake.calls.filter(c => c.startsWith("update")).length === 2, "exactly one retry");
  }

  // ── 1b. Only missing fields: nothing left to send, fails as before ─────────
  {
    reset();
    seed("LSQ-A", "9876543210", { FirstName: "Old" });
    const r = await svc.updateLeadWithMappings("LSQ-A", [mapping("Mx_Website_Campaign", "lead.sourceUrl")], ctx(), ["sourceUrl"]);
    expect(!r.success && /does not exist/.test(r.message), "update with only missing fields still reports the error");
    expect(fake.calls.filter(c => c.startsWith("update")).length === 1, "no pointless retry with an empty update");
  }

  // ── 1c. Duplicate on create: the existing lead now gets the new details ────
  {
    reset();
    seed("LSQ-A", "9876543210", { FirstName: "Old", Phone: "9876543210" });
    const r = await svc.createLeadWithMappings(mappings, ctx());
    expect(r.success && r.leadId === "LSQ-A" && /updated it with the new details/.test(r.message), "duplicate lead updated, not just 'treated as synced'");
    expect(fake.leads.get("LSQ-A")!.FirstName === "Priya", "duplicate lead has the new name");
  }

  // ── 2. Lead gone, same person still in LeadSquared under another ID ────────
  {
    reset();
    seed("LSQ-NEW", "9876543210", { FirstName: "Old", Phone: "9876543210" }); // LSQ-OLD was merged into LSQ-NEW
    const r = await svc.updateLeadOrRecover("LSQ-OLD", mappings, ctx(), ["name"]);
    expect(r.success && r.leadId === "LSQ-NEW", "updates the person's current lead and returns its ID");
    expect(fake.leads.get("LSQ-NEW")!.FirstName === "Priya", "current lead has the new details");
    expect(!fake.calls.some(c => c.startsWith("capture")), "no duplicate lead created");
  }

  // ── 2b. Lead gone and not found: created again ─────────────────────────────
  {
    reset();
    const r = await svc.updateLeadOrRecover("LSQ-DELETED", mappings, ctx(), ["name"]);
    expect(r.success && !!r.leadId && r.leadId !== "LSQ-DELETED", "lead created again with a new ID");
    expect(fake.leads.get(r.leadId!)?.FirstName === "Priya", "re-created lead has the details");
  }

  // ── 2c. Healthy update: no lookup, no new ID ───────────────────────────────
  {
    reset();
    seed("LSQ-A", "9876543210", { FirstName: "Old" });
    const r = await svc.updateLeadOrRecover("LSQ-A", [mapping("FirstName", "lead.name")], ctx(), ["name"]);
    expect(r.success && !r.leadId, "normal update returns no new ID");
    expect(fake.calls.length === 1, "normal update makes a single call");
  }

  // ── 2d. Other failures are returned unchanged (no lookup / create) ─────────
  {
    reset();
    seed("LSQ-A", "9876543210", { FirstName: "Old" });
    const r = await svc.updateLeadOrRecover("LSQ-A", [mapping("Mx_Website_Campaign", "lead.sourceUrl")], ctx(), ["sourceUrl"]);
    expect(!r.success && /does not exist - Mx_Website_Campaign/.test(r.message), "non-gone error passed through");
    expect(!fake.calls.some(c => c.startsWith("lookup") || c.startsWith("capture")), "no recovery attempted for other errors");
  }

  global.fetch = originalFetch;
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll LeadSquared update-recovery tests passed.");
})();
