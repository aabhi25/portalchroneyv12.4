# Agent Memory — AI Chroney

- [AI usage accounting](ai-usage-accounting.md) — pricing re-seeds from code constants every boot, so DB-only rate edits silently revert; audio tokens are ~17x text.
- [OpenAI Realtime API](openai-realtime-api.md) — the `OpenAI-Beta: realtime=v1` header is now rejected outright; GA endpoint takes auth only.
- [TopScholar launch identity](topscholar-launch-identity.md) — signed tokens outrank URL scope; voice needs one and chat doesn't; a refused WS upgrade is invisible to the browser.
- [Environment quirks](environment-quirks.md) — pgvector must exist before `db:push`; `.replit` is edited through the verify-and-replace flow, never directly.
