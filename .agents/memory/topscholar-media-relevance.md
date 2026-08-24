---
name: TopScholar media relevance
description: Rules for keeping curriculum images relevant and consistent across text and voice.
---

Curriculum media must carry source-bound topic, concept, sub-concept, chapter, and caption/alt metadata alongside its chunk. Both text and voice must consume the same deterministic image gate: use exact normalized topic/concept terms, allow at most one clearly supported image, and fail closed on ambiguity or weak evidence. The display formatter must require an explicit placement marker; it must never append a selected image as a fallback.

**Why:** Vector retrieval may return useful neighbouring passages whose images are for a different lesson. Broad media lists or substring matching can surface an incorrect diagram in an otherwise correct answer.

**How to apply:** Preserve structured media in both storage backends and maintain legacy URL compatibility through normalization. When introducing an image source, attach it to matching lesson chunks or create a small source-bound chunk. Do not add an LLM, embedding, or vector call to the voice latency path to decide image relevance.

TopScholar video URLs must not be exposed to the tutor or student, although their transcript text may remain available as curriculum evidence.

**Why:** The client portal's embedded tutor cannot open those video resources, so presenting them gives students a broken action.

**How to apply:** Remove video URLs at the TopScholar resolver/tool boundary and retain an account-specific prompt prohibition. Do not apply this restriction to other education accounts unless their embedding context has the same limitation.