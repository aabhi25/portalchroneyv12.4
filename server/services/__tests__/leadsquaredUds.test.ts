/**
 * Tests for the LeadSquared Universal Data Sync (UDS) connection type.
 * Run manually: `npx tsx server/services/__tests__/leadsquaredUds.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 *
 * A local HTTP server stands in for the client's UDS webhook.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  LeadSquaredService,
  hasLeadSquaredCredentials,
  isLeadSquaredUds,
  createLeadSquaredServiceFromSettings,
  validateUdsWebhookUrl,
  buildSampleLeadContext,
  type LeadDataContext,
} from "../leadsquaredService";
import type { LeadsquaredFieldMapping } from "@shared/schema";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-0123456789abcdef";

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
  partial: Partial<LeadsquaredFieldMapping> & Pick<LeadsquaredFieldMapping, "leadsquaredField" | "sourceType">,
): LeadsquaredFieldMapping {
  return {
    id: "m-" + partial.leadsquaredField,
    businessAccountId: "biz-1",
    sourceField: null,
    customValue: null,
    fallbackValue: null,
    valueWhenPresent: null,
    displayName: partial.leadsquaredField,
    isEnabled: "true",
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as LeadsquaredFieldMapping;
}

// The same kinds of rules used in production: dynamic, fallback, "value when present", fixed.
const mappings = [
  mapping({ leadsquaredField: "FirstName", sourceType: "dynamic", sourceField: "lead.name" }),
  mapping({ leadsquaredField: "Phone", sourceType: "dynamic", sourceField: "lead.phone" }),
  mapping({ leadsquaredField: "mx_Utm_Source", sourceType: "dynamic", sourceField: "session.utmSource" }),
  mapping({ leadsquaredField: "mx_Utm_Medium", sourceType: "dynamic", sourceField: "session.utmMedium", fallbackValue: "Direct" }),
  mapping({ leadsquaredField: "mx_Sub_Source", sourceType: "dynamic", sourceField: "session.utmSource", valueWhenPresent: "PRChat" }),
  mapping({ leadsquaredField: "Source", sourceType: "custom", customValue: "AI Chroney" }),
  mapping({ leadsquaredField: "mx_Disabled", sourceType: "custom", customValue: "x", isEnabled: "false" }),
];

const context: LeadDataContext = {
  lead: { name: "Sudeep Arya", phone: "7039163819", email: null },
  session: { utmSource: "google", city: "Mumbai" },
  business: { name: "Symbiosis OTP (Jaro)" },
};

interface Received { headers: http.IncomingHttpHeaders; body: any; url: string }

async function withServer(
  respond: (req: Received) => { status: number; body: string },
  run: (url: string, received: Received[]) => Promise<void>,
) {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      const entry = { headers: req.headers, body: raw ? JSON.parse(raw) : null, url: req.url || "" };
      received.push(entry);
      const { status, body } = respond(entry);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/uds/webhook`, received);
  } finally {
    server.close();
  }
}

async function main() {
  // ── Create: same mapped values as the API path, delivered as flat JSON ───────
  await withServer(() => ({ status: 200, body: '{"Status":"Success"}' }), async (url, received) => {
    const svc = new LeadSquaredService({ accessKey: "", secretKey: "", region: "other", uds: { webhookUrl: url, key: "ick-123" } });
    const result = await svc.createLeadWithMappings(mappings, context);

    expect(result.success, "create via UDS succeeds on 2xx");
    expect(received.length === 1, "exactly one webhook call");
    const body = received[0].body;
    expect(body && !Array.isArray(body), "payload is a flat JSON object, not the API attribute array");
    expect(body.FirstName === "Sudeep Arya" && body.Phone === "7039163819", "dynamic lead fields mapped");
    expect(body.mx_Utm_Source === "google", "utm source mapped");
    expect(body.mx_Utm_Medium === "Direct", "fallback value applied");
    expect(body.mx_Sub_Source === "PRChat", "value-when-present applied");
    expect(body.Source === "AI Chroney", "fixed custom value applied");
    expect(!("mx_Disabled" in body), "disabled mapping omitted");
    expect(received[0].headers["x-access-token"] === "ick-123", "ickey sent as x-access-token header");
    expect(!received[0].url.includes("ick-123"), "ickey not put in the URL");
    expect(result.leadId === undefined, "no lead ID when UDS does not return one");

    const apiAttrs = svc.buildAttributesFromMappings(mappings, context);
    const same = apiAttrs.length === Object.keys(body).length && apiAttrs.every(a => body[a.Attribute] === a.Value);
    expect(same, "UDS payload has exactly the fields/values the API path would send");
  });

  // ── Update: resends the full mapped lead (UDS lead capture upserts) ──────────
  await withServer(() => ({ status: 200, body: "OK" }), async (url, received) => {
    const svc = new LeadSquaredService({ accessKey: "", secretKey: "", region: "other", uds: { webhookUrl: url } });
    const result = await svc.updateLeadWithMappings("lsq-1", mappings, context, ["name"]);
    expect(result.success, "update via UDS succeeds with a non-JSON acknowledgement");
    expect(received[0].body.Phone === "7039163819", "update still sends Phone (search key) even when only name changed");
    expect(received[0].headers["x-access-token"] === undefined, "no key header when no key is configured");
  });

  // ── Lead ID picked up when the flow returns one ──────────────────────────────
  await withServer(() => ({ status: 200, body: '{"Status":"Success","Message":{"Id":"abc-123"}}' }), async (url) => {
    const svc = new LeadSquaredService({ accessKey: "", secretKey: "", region: "other", uds: { webhookUrl: url } });
    const result = await svc.createLeadWithMappings(mappings, context);
    expect(result.leadId === "abc-123", "LeadSquared lead ID captured from UDS response");
  });

  // ── Failures ─────────────────────────────────────────────────────────────────
  await withServer(() => ({ status: 401, body: '{"message":"Invalid ickey"}' }), async (url) => {
    const svc = new LeadSquaredService({ accessKey: "", secretKey: "", region: "other", uds: { webhookUrl: url, key: "bad" } });
    const result = await svc.createLeadWithMappings(mappings, context);
    expect(!result.success, "401 reported as failure");
    expect(/Invalid ickey/.test(result.message) && /ickey/.test(result.message), "failure message includes UDS error and key hint");
  });
  {
    const svc = new LeadSquaredService({ accessKey: "", secretKey: "", region: "other", uds: { webhookUrl: "http://127.0.0.1:1/unreachable" } });
    const result = await svc.createLeadWithMappings(mappings, context);
    expect(!result.success && !!result.message, "unreachable webhook reported as failure, not thrown");
  }
  {
    const svc = new LeadSquaredService({ accessKey: "", secretKey: "", region: "other", uds: { webhookUrl: "http://127.0.0.1:1/x" } });
    const result = await svc.createLeadWithMappings([], context);
    expect(!result.success && /No field mappings/.test(result.message), "no mappings → failure without calling webhook");
  }

  // ── Settings helpers ─────────────────────────────────────────────────────────
  expect(isLeadSquaredUds({ leadsquaredConnectionType: "uds" }), "isLeadSquaredUds true for 'uds'");
  expect(!isLeadSquaredUds({ leadsquaredConnectionType: "api" }) && !isLeadSquaredUds(null), "isLeadSquaredUds false otherwise");
  expect(hasLeadSquaredCredentials({ leadsquaredConnectionType: "uds", leadsquaredUdsWebhookUrl: "https://x" }), "UDS needs only the webhook URL");
  expect(!hasLeadSquaredCredentials({ leadsquaredConnectionType: "uds", leadsquaredAccessKey: "a", leadsquaredSecretKey: "s" }), "UDS without URL is not configured even if API keys exist");
  expect(hasLeadSquaredCredentials({ leadsquaredAccessKey: "a", leadsquaredSecretKey: "s" }), "API mode needs access + secret keys");
  expect(!hasLeadSquaredCredentials({ leadsquaredAccessKey: "a", leadsquaredSecretKey: "s" }, { requireRegion: true }), "requireRegion enforced in API mode");
  expect(hasLeadSquaredCredentials({ leadsquaredConnectionType: "uds", leadsquaredUdsWebhookUrl: "https://x" }, { requireRegion: true }), "requireRegion ignored in UDS mode");

  expect(validateUdsWebhookUrl("https://example.leadsquared.com/uds/abc") === null, "https webhook URL accepted");
  expect(validateUdsWebhookUrl("http://example.com") !== null, "http webhook URL rejected");
  expect(validateUdsWebhookUrl("not a url") !== null, "invalid URL rejected");

  // ── Factory: stored (encrypted) key is decrypted and used ────────────────────
  await withServer(() => ({ status: 200, body: "{}" }), async (url, received) => {
    const { encrypt } = await import("../encryptionService");
    const svc = await createLeadSquaredServiceFromSettings({
      leadsquaredConnectionType: "uds",
      leadsquaredUdsWebhookUrl: url,
      leadsquaredUdsKey: encrypt("stored-ick"),
    });
    expect(!!svc && svc.isUds(), "factory builds a UDS client from settings");
    await svc!.createLeadWithMappings(mappings, context);
    expect(received[0]?.headers["x-access-token"] === "stored-ick", "factory decrypts the stored UDS key");
  });
  expect(await createLeadSquaredServiceFromSettings({ leadsquaredConnectionType: "uds" }) === null, "factory returns null without a webhook URL");

  // ── Sample payload context covers journey mappings ───────────────────────────
  {
    const sample = buildSampleLeadContext(
      [...mappings, mapping({ leadsquaredField: "mx_Course", sourceType: "dynamic", sourceField: "journey.course" })],
      { name: "Biz", website: "https://biz.example" },
    );
    const svc = new LeadSquaredService({ accessKey: "", secretKey: "", region: "other" });
    const attrs = svc.buildAttributesFromMappings(
      [mapping({ leadsquaredField: "mx_Course", sourceType: "dynamic", sourceField: "journey.course" })],
      sample,
    );
    expect(attrs[0]?.Value === "Sample answer", "sample context fills journey.* fields");
    expect(sample.lead.name === "AI Chroney Test Lead", "sample lead is clearly labelled as a test");
  }

  if (failed > 0) {
    console.error(`\n${failed} UDS test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll LeadSquared UDS tests passed.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
