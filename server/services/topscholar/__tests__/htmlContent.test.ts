import { MAX_EMBEDDING_INPUT_BYTES, splitTextForEmbedding } from '../htmlContent';

let failed = 0;

function expect(condition: unknown, message: string) {
  if (condition) {
    console.log(`✓ ${message}`);
    return;
  }
  failed++;
  console.error(`✗ ${message}`);
}

{
  const source = `${'A long curriculum question. '.repeat(600)}Final answer remains available.`;
  const chunks = splitTextForEmbedding(source);

  expect(chunks.length > 1, 'oversized source content is split into multiple embedding inputs');
  expect(
    chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= MAX_EMBEDDING_INPUT_BYTES),
    'every split chunk remains below the safe embedding byte limit',
  );
  expect(
    chunks.join(' ').replace(/\s+/g, ' ').trim() === source.replace(/\s+/g, ' ').trim(),
    'splitting preserves the complete source text instead of truncating it',
  );
}

{
  const source = '🙂'.repeat(3_500);
  const chunks = splitTextForEmbedding(source);
  expect(chunks.length > 1, 'UTF-8-heavy source content is split');
  expect(
    chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= MAX_EMBEDDING_INPUT_BYTES),
    'UTF-8-heavy chunks respect the byte limit',
  );
  expect(chunks.join('') === source, 'UTF-8 characters are never cut apart or lost');
}

console.log(failed === 0 ? '\nAll TopScholar embedding chunk tests passed' : `\n${failed} test(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);