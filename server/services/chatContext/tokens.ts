/**
 * Token accounting for prompt budgets. No tokenizer package is installed, so we use
 * the standard ~4 characters per token approximation for English text (OpenAI's own
 * rule of thumb). Budgets are soft limits, so a small estimation error is fine.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Cut text to roughly `maxTokens`, preferring a sentence or word boundary. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (!text) return '';
  const maxChars = Math.max(0, Math.floor(maxTokens * 4));
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'), slice.lastIndexOf('\n'));
  if (sentenceEnd > maxChars * 0.6) return slice.slice(0, sentenceEnd + 1).trimEnd() + ' …';
  const wordEnd = slice.lastIndexOf(' ');
  return (wordEnd > maxChars * 0.6 ? slice.slice(0, wordEnd) : slice).trimEnd() + ' …';
}
