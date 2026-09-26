/**
 * Tests for classifyLeadsquaredError: which sync failures the retry worker keeps
 * retrying (transient) and which go straight to 'needs_attention' (permanent).
 * Run manually: `npx tsx server/services/__tests__/leadsquaredRetryClassify.test.ts`
 * (No test runner is wired into this repo yet; this file is self-asserting.)
 */
import { classifyLeadsquaredError } from "../leadsquaredService";

let failed = 0;
function expectKind(message: string | null | undefined, kind: "transient" | "permanent") {
  const got = classifyLeadsquaredError(message);
  if (got !== kind) {
    failed++;
    console.error(`✗ ${JSON.stringify(message)} → ${got} (expected ${kind})`);
  } else {
    console.log(`✓ ${kind.padEnd(9)} ${JSON.stringify(message)}`);
  }
}

// Temporary problems: keep retrying.
expectKind("UDS webhook timed out after 30s", "transient");
expectKind("fetch failed", "transient");
expectKind("connect ECONNREFUSED 10.0.0.1:443", "transient");
expectKind("getaddrinfo ENOTFOUND api-in21.leadsquared.com", "transient");
expectKind("Failed to create lead: 500 Internal Server Error", "transient");
expectKind("Failed to create lead: 503 Service Unavailable", "transient");
expectKind("UDS webhook returned 502 Bad Gateway", "transient");
expectKind("Failed to create lead: 429 Too Many Requests", "transient");
expectKind("socket hang up", "transient");
expectKind("Something unexpected happened", "transient"); // unknown → retry
expectKind("", "transient");
expectKind(null, "transient");

// Problems retrying can't fix: stop and flag.
expectKind("No field mappings configured or no data available for sync", "permanent");
expectKind("UDS webhook returned 401 Unauthorized: Invalid ickey (check the UDS webhook key / ickey)", "permanent");
expectKind("UDS webhook returned 403 Forbidden", "permanent");
expectKind("Invalid Access Key or Secret Key", "permanent");
expectKind("Failed to create lead: 400 Bad Request", "permanent");
expectKind("Lead attribute mx_Course does not exist", "permanent");
expectKind("Field mx_Utm_Source not found", "permanent");
expectKind("Invalid attribute: mx_Foo", "permanent");
expectKind("MXInvalidInputException: bad value", "permanent");
expectKind("MXUnAuthorizedAccessException", "permanent");
expectKind("LeadSquared credentials not configured", "permanent");
expectKind("LeadSquared integration is not enabled", "permanent");
expectKind("This lead is not qualified for LeadSquared", "permanent");
expectKind("Failed to decrypt secret key", "permanent");

if (failed > 0) {
  console.error(`\n${failed} classification test(s) failed.`);
  process.exit(1);
}
console.log("\nAll retry classification tests passed.");
