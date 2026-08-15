---
name: AI usage accounting
description: How model pricing is seeded and why the token breakdown must be treated as subsets, not addenda.
---

# Pricing is owned by code, not the database

Model rates are re-seeded from code constants into the pricing table on **every
boot**.

**Why:** it makes the constants the single source of truth and self-heals a bad
row. The trap is the inverse: editing a rate directly in the database looks like
it worked, then silently reverts on the next restart.

**How to apply:** to change a rate, change the constant — a DB-only fix is always
wrong. Rates are also cached in-process for a few minutes, so clear that cache
after re-seeding or a correction appears to do nothing.

# Audio tokens are ~17x text tokens

Realtime voice bills audio and text at completely different rates (audio in/out
around $10/$20 per 1M against text around $0.60/$2.40). Pricing a voice session
at a single flat rate under-reports spend by roughly 30-50x.

**Why:** a realtime turn is mostly audio tokens, and the totals the API returns
do not distinguish them without reading the nested detail objects.

**How to apply:** any new model added to the pricing constants that accepts or
emits audio needs its audio rates set. A model missing from the constants
entirely falls back to `gpt-4o-mini` text rates — which fails silently and looks
plausible in the dashboard.

# The token breakdown columns are subsets, not addenda

On `ai_usage_events`, the audio/cached token columns are portions **of** the
existing totals, never extra tokens on top. `tokens_input` remains the grand
total.

**Why:** every existing report sums `tokens_input`/`tokens_output`. Making the
new columns additive would have double-counted across the whole history.

**How to apply:** never add a breakdown column into a total. When splitting
input four ways ({fresh, cached} x {text, audio}) the provider reports
overlapping aggregates, so the cached/audio intersection has to be clamped into
`[max(0, cached + audio - total), min(cached, audio)]`. The lower bound is the
pigeonhole minimum and is the part that is easy to miss: without it, a payload
that omits the nested cached-audio figure bills the same tokens twice, once as
fresh audio and once as cached text.
