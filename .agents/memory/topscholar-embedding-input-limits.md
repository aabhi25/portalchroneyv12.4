---
name: TopScholar embedding input limits
description: How to recognize deterministic embedding token-limit failures across direct and Batch API sync paths.
---

# Token-limit failures are fix-required, not retryable

Treat an over-limit embedding input as non-retryable until the curriculum text has
been split below the model's token limit. The Batch API reports this as "maximum
input length is N tokens"; direct SDK calls report "This model's maximum context
length is N tokens" (often followed by the requested count). Both formats carry
the same remediation: split the content and resync.

**Why:** a retry uses the unchanged chunk and deterministically repeats the same
failure, leaving a Plan run stuck while adding unnecessary API work.

**How to apply:** use one shared classifier for Plan retry policy, admin status
and CP-level actions. Before any TopScholar embedding path, apply a final
UTF-8-byte-bounded split to every normalized record—not only notes and
transcripts—because a token consumes at least one byte and byte limits remain
safe for token-dense or non-Latin source text. Preserve source scope and media
metadata on each split record. When adding an embedding path or changing OpenAI
error wrapping, confirm its token-overflow wording is recognized before exposing
retry controls.