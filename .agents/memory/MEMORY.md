# Agent Memory — AI Chroney

- [AI usage accounting](ai-usage-accounting.md) — pricing re-seeds from code constants every boot, so DB-only rate edits silently revert; audio tokens are ~17x text.
- [OpenAI Realtime API](openai-realtime-api.md) — the `OpenAI-Beta: realtime=v1` header is now rejected outright; GA endpoint takes auth only.
- [TopScholar launch identity](topscholar-launch-identity.md) — signed tokens outrank URL scope; voice needs one and chat doesn't; a refused WS upgrade is invisible to the browser.
- [Voice/chat parity](voice-chat-parity.md) — unpassed retrieval scope silently means "whole account"; anything the voice model can see, it will read aloud, so media goes around it — and then nothing is left choosing it.
- [Multi-job structured prompts](structured-output-prompts.md) — JSON key order decides what the model can condition on; a job-1 short-circuit output silently skips job 2.
- [Voice karaoke highlight](voice-karaoke-highlight.md) — clock highlights off audio scheduling, key to the bubble not the response, and tear down on every terminal path or the highlight sticks.
- [WhatsApp campaign engine](whatsapp-campaign-engine.md) — list and count must share one filter predicate; recording an inbound reply silently inherits the AI-enabled gate.
- [Spreadsheet contact import](spreadsheet-import.md) — Excel exports what it displays, so long numbers reach CSV pre-corrupted; a preview and the write it promises must share one routine.
- [Environment quirks](environment-quirks.md) — pgvector must exist before `db:push`; `.replit` is edited through the verify-and-replace flow, never directly.
- [Mongo/pgvector reader parity](mongo-pgvector-viewer-parity.md) — aggregation expressions treat missing ≠ null; `$ifNull`-normalize before sorting, and never spawn a second MongoClient cache.
- [TopScholar media relevance](topscholar-media-relevance.md) — images need source-bound lesson metadata and the shared exact-token gate; uncertainty or a missing placement marker means no image.
- [TopScholar Plan sync durability](topscholar-plan-sync-durability.md) — full Plan embedding is a leased, cancellable CP queue; never recreate unbounded direct workers from bulk actions.
- [Spreadsheet campaign dispatch reservations](spreadsheet-campaign-dispatch-reservations.md) — reserve a business record key only when a run is scheduled; cancelled review runs must remain eligible.
- [Tester client-store filters](topscholar-tester-client-store-filters.md) — Tester options may use stored client content, but preview must prove it matches live scope mapping until production authority migrates.
