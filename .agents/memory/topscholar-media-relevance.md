---
name: TopScholar media relevance
description: Rules for keeping curriculum images relevant and consistent across text and voice.
---

Curriculum media must carry source-bound topic, concept, sub-concept, chapter, and caption/alt metadata alongside its chunk. Both text and voice must consume the same deterministic image gate: use exact normalized topic/concept terms, allow at most one clearly supported image, and fail closed on ambiguity or weak evidence. The display formatter must require an explicit placement marker; it must never append a selected image as a fallback.

**Why:** Vector retrieval may return useful neighbouring passages whose images are for a different lesson. Broad media lists or substring matching can surface an incorrect diagram in an otherwise correct answer.

**How to apply:** Preserve structured media in both storage backends and maintain legacy URL compatibility through normalization. When introducing an image source, attach it to matching lesson chunks or create a small source-bound chunk. Do not add an LLM, embedding, or vector call to the voice latency path to decide image relevance.

For a vague visual follow-up such as “show me an image,” inherit only a preceding student question that explicitly names the active chapter. The chapter scope alone must not approve every chapter image.

**Why:** Students naturally ask for a diagram after naming a topic, but using chapter scope as generic image evidence can surface an unrelated lesson illustration.

**How to apply:** Add the confirmed prior topic to the retrieval/relevance query only for visual-only follow-ups. Keep generic image requests with no established topic fail-closed, and normalize closely related curriculum forms (for example, gravitation/gravitational) without allowing substring matches.

TopScholar's S3-hosted diagrams can be valid image files while being served as `application/octet-stream`. Curriculum Markdown therefore needs a constrained same-origin fallback that detects file signatures and returns the actual image MIME type.

**Why:** Browser image requests can reject a generic binary response, leaving students with only image alt text even though the source object is reachable.

**How to apply:** Try the source URL first, then use the guarded curriculum-media fallback only after it fails. Keep the fallback limited to approved content hosts, HTTPS, bounded redirects and downloads, and recognized image formats; it must never become a general-purpose fetch proxy.

TopScholar video URLs must not be exposed to the tutor or student, although their transcript text may remain available as curriculum evidence.

**Why:** The client portal's embedded tutor cannot open those video resources, so presenting them gives students a broken action.

**How to apply:** Remove video URLs at the TopScholar resolver/tool boundary and retain an account-specific prompt prohibition. Do not apply this restriction to other education accounts unless their embedding context has the same limitation.