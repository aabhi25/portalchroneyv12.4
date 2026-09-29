# Website chat: prompt context

How one website-chat turn (`POST /api/chat/widget/stream` → `chatService.streamMessage`)
decides what goes into the model's prompt. Code: `server/services/chatContext/`.

## What changed (retrieval mode, the default)

| | Before (legacy) | Now (retrieval) |
|---|---|---|
| Business context | Every analyzed website page and every training-document summary, in full (a 40-page site ≈ 15k tokens), cached 5 min | A compact **business profile** (≤ 1,500 tokens: name, about, contact, hours, pricing, offer lists, site map of page titles, list of documents). Sites whose whole content is ≤ 2,500 tokens are still inlined verbatim. |
| Page / document detail | Only reached the model on the second (tool-continuation) call | Retrieved per question and put in the **first** call |
| Retrieval | FAQ vector top-3 (≥ 0.40) and doc/URL chunk top-5 (≥ 0.50), separately, on the raw message | One hybrid list over FAQs + document chunks + trained-URL chunks + website-page and document-summary passages: 0.7 × vector similarity + 0.3 × keyword coverage, near-duplicates dropped, MMR-style diversity, ≤ 1,800 tokens |
| Follow-ups ("and for seniors?") | Searched with the raw message | Short / elliptical messages also search with the last 1–2 user turns (optional LLM rewrite: `CHAT_QUERY_REWRITE=llm`, off by default) |
| History to the model | Everything in the 15-minute memory | Last 20 messages / 3,000 tokens; older turns become a one-paragraph note of what the visitor said (no extra AI call). Lead-capture logic still sees the full history. |
| Prompt order | Minute-precision date/time, "message #N" status and handoff notes **prepended**; funnel stage "(Message N)" inside the system prompt | Stable content first (system prompt + profile, custom instructions, business context, mode prompts). Date (day precision; time only if appointments are live or the message is time-sensitive), turn status and retrieved knowledge **last** → OpenAI prompt caching works |
| Language detection (`language: auto`) | AI call on every turn the heuristic was unsure about (any English message longer than 4 words) | Script/Hinglish heuristic → "clearly English" check → the conversation's earlier result → AI only when still unsure, cached per conversation |
| Vector indexes | None on `faqs`, `document_chunks`, `url_content_chunks` | HNSW (`vector_cosine_ops`, matching the `<=>` queries) — migration `0004_knowledge_vector_hnsw_indexes` |

Untouched: TopScholar and K12 content-only conversations (always the legacy path), tools
(products, appointments, journeys, orders, jobs), lead capture / OTP / captcha gates,
starter Q&A, voice routing, WhatsApp / Instagram / Facebook.

Page and document-summary passages have no table; they are embedded once per process in
the background (one batched embedding call per account, first 512 dimensions kept in
memory, ~2 KB each, capped at 12k passages) and matched by keywords until then.

## Safety valve — switch back to the old behaviour

Any one of these puts accounts back on the legacy builder (context, retrieval, history,
language detection):

| Scope | How | Takes effect |
|---|---|---|
| All accounts | env `CHAT_CONTEXT_MODE=legacy` | restart |
| Some accounts | env `CHAT_CONTEXT_LEGACY_ACCOUNTS=<id>,<id>` | restart |
| All accounts | `system_settings` key `chat_context_mode` = `legacy` | ≤ 30 s, no restart |
| Some accounts | `system_settings` key `chat_context_legacy_accounts` = `<id>,<id>` | ≤ 30 s, no restart |

```sql
INSERT INTO system_settings (key, value, is_encrypted) VALUES ('chat_context_mode', 'legacy', 'false')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_encrypted = 'false';
-- undo: DELETE FROM system_settings WHERE key = 'chat_context_mode';
```

## Measuring

`scripts/chat-context-benchmark.ts` seeds a 40-page / 10-document / 30-FAQ business into
a local throwaway database and runs sample conversations through the real
`streamMessage` against a fake OpenAI, printing per-turn prompt tokens, LLM and embedding
calls, whether the answering chunk reached the model, and the stable prefix length.

```bash
DATABASE_URL=postgresql://…@127.0.0.1:…/… CHAT_BENCH_DB=1 npx tsx scripts/chat-context-benchmark.ts
```

Tests: `server/services/__tests__/chatContext.test.ts` (unit) and
`chatContext.integration.test.ts` (`CHAT_CONTEXT_TEST_DB=1`, local database).
