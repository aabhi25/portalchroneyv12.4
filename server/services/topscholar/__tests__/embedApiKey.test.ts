import {
  createWindowLimiter,
  embedApiKeyMatches,
  extractEmbedApiKey,
  generateEmbedApiKey,
  hashEmbedApiKey,
} from '../embedApiKey';

let failed = 0;
function expect(condition: unknown, label: string) {
  if (!condition) {
    failed++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const first = generateEmbedApiKey();
const second = generateEmbedApiKey();
expect(first.key.startsWith('tsk_') && first.key.length > 40, 'generates a prefixed, long random key');
expect(first.key !== second.key, 'every key is different');
expect(first.hash === hashEmbedApiKey(first.key) && first.hash.length === 64, 'stores a SHA-256 hex hash');
expect(!first.hash.includes(first.key.slice(4, 20)), 'the hash does not contain the key');
expect(first.last4 === first.key.slice(-4), 'keeps the last 4 characters for display');

expect(embedApiKeyMatches(first.key, first.hash), 'accepts the right key');
expect(!embedApiKeyMatches(second.key, first.hash), 'rejects another key');
expect(!embedApiKeyMatches(first.key, null), 'rejects when no key is configured');
expect(!embedApiKeyMatches('', first.hash), 'rejects an empty key');
expect(!embedApiKeyMatches(first.key, 'abc'), 'rejects a malformed stored hash');

expect(extractEmbedApiKey({ authorization: `Bearer ${first.key}` }) === first.key, 'reads Authorization: Bearer');
expect(extractEmbedApiKey({ authorization: `bearer   ${first.key} ` }) === first.key, 'Bearer is case-insensitive and trimmed');
expect(extractEmbedApiKey({ 'x-api-key': first.key }) === first.key, 'reads X-Api-Key');
expect(extractEmbedApiKey({ authorization: 'Basic abc' }) === null, 'ignores other auth schemes');
expect(extractEmbedApiKey({}) === null, 'no header -> null');

const limiter = createWindowLimiter(3, 60_000);
const t0 = 1_000_000;
expect(limiter('a', t0).allowed && limiter('a', t0 + 1).allowed && limiter('a', t0 + 2).allowed, 'allows up to the limit');
const blocked = limiter('a', t0 + 10_000);
expect(!blocked.allowed && blocked.retryAfterSeconds === 50, 'blocks over the limit and says when to retry');
expect(limiter('b', t0 + 10_000).allowed, 'limits are per key');
expect(limiter('a', t0 + 60_000).allowed, 'a new window resets the count');

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll embed API key checks passed');
