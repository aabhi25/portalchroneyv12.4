/**
 * A content chunk above the embedding model's input limit will fail identically
 * on every retry until the source is split. Keep this classification server-side
 * so queue actions cannot re-submit known invalid content.
 */
export function isNonRetryableEmbeddingFailure(error: string | null | undefined): boolean {
  if (!error) return false;
  return [
    // Batch API per-input validation, e.g. "Invalid input[3]: maximum input
    // length is 8192 tokens".
    /maximum input length is \d+ tokens/i,
    // Direct OpenAI SDK validation, e.g. "This model's maximum context length
    // is 8192 tokens, however you requested 9001 tokens".
    /(?:this model(?:'s)?|model)\s+maximum context length is \d+ tokens/i,
  ].some((pattern) => pattern.test(error));
}