/**
 * Query embeddings come back as base64 (smaller, faster); they must decode to the exact
 * same float32 values as a plain number[]. Run: npx tsx server/services/__tests__/embeddingDecode.test.ts
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused'; // never queried here

let failed = 0;
function expect(cond: any, label: string, detail?: unknown) {
  if (cond) console.log(`✓ ${label}`);
  else { failed++; console.log(`✗ ${label}${detail !== undefined ? ` — got: ${JSON.stringify(detail)}` : ''}`); }
}

async function main() {
  const { decodeEmbedding } = await import('../embeddingService');
  const values = new Float32Array(1536).map((_, i) => Math.sin(i) * (i % 7 === 0 ? 1e-4 : 0.37));
  const b64 = Buffer.from(values.buffer).toString('base64');
  const out = decodeEmbedding(b64);
  expect(Array.isArray(out) && out.length === 1536, 'base64 → plain number[] of 1536 values', out.length);
  expect(out.every((x, i) => x === values[i]), 'every value identical to the float32 the API sent');
  expect(JSON.stringify(out).startsWith('[') && !JSON.stringify(out).includes('"0"'), 'serialises like a normal array (pgvector / JSON safe)');
  const plain = [0.1, -0.2, 0.3];
  expect(decodeEmbedding(plain) === plain, 'a float (number[]) response passes through unchanged');
  expect(decodeEmbedding(new Float32Array([1, 2])).join(',') === '1,2' && Array.isArray(decodeEmbedding(new Float32Array([1]))), 'typed arrays become plain arrays');
  let threw = false;
  try { decodeEmbedding({}); } catch { threw = true; }
  expect(threw, 'garbage is an error, not a silent empty vector');
  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nAll embedding decode checks passed.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
