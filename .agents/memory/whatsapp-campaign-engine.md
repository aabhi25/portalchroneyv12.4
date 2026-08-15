---
name: WhatsApp campaign engine constraints
description: Non-obvious coupling and recurring review failures in the marketing campaign / reply-classification code.
---

## Paginated recipient views must share one predicate

Every filter dimension has to be applied to BOTH the list query and the count
query, through a single shared condition helper — never duplicated inline.

**Why:** code review on this area has rejected on this exact defect four separate
times. When counts and list narrow differently, the footer advertises a total the
list cannot deliver and the user lands on blank pages. The classification filter
added a second dimension on top of the status filter, which multiplies the ways
they can drift.

**How to apply:** when adding any new recipient filter, thread it through the
shared condition helper used by both `listRecipients` and `countRecipients`, reset
page to 0 when the filter changes, and add a clamping effect so the page index
follows `filterTotal` down when live polling shrinks it. `totalPages` must floor
at 1 or the footer renders "Page 1 / 0".

## Recording an inbound reply is gated on AI being enabled

The webhook's campaign-ownership gate historically only recorded inbound
messages when the campaign had AI auto-replies switched on; with AI off the
message fell straight through to the journey path and left no campaign record.

**Why:** anything hung off `recordInbound` silently inherits that gate. Outcome
classification was attached there and therefore produced nothing at all for
manually-worked campaigns — the exact deployments most likely to want outcome
tracking.

**How to apply:** treat "campaign owns this conversation" and "campaign should
reply" as two independent decisions. Record and classify on the first; only
suppress the journey and generate a reply on the second.

## Classification merges must be atomic SQL

Outcome merging for a recipient is expressed as one UPDATE using SQL
(`COALESCE`, `||` for jsonb, `OR` for the sticky callback flag), never as a
JS-side read-modify-write.

**Why:** classification is fired per inbound message, so a customer sending two
messages seconds apart runs two merges concurrently. A read-merge-write lets the
slower one overwrite the newer disposition or drop captured fields.

**How to apply:** merge semantics that must survive concurrency — a null
classification must not wipe an earlier real one, captured fields accumulate, a
callback flag is sticky-true — all belong in the SQL expression, not in
TypeScript.

## Outcome categories are config, not code

Reply categories live as per-campaign JSON. The classifier prompt, dashboard rows
and CSV columns all read that config at runtime.

**Why:** the stated product requirement is that a new vertical (RSVPs, clinic
reminders, collections) needs campaign config only, never a code change.

**How to apply:** keep vertical-specific wording confined to the preset list.
Engine defaults — especially the fallback AI persona and the recipient-context
rules — must stay neutral; a sales-flavoured default leaks into every campaign
whose operator never wrote a custom prompt.
