---
name: Multi-job structured-output prompts
description: Rules for prompts that return JSON and do more than one job — key order, short-circuit output shapes, and never letting the model repeat an identifier.
---

# Prompts that return JSON and do more than one job

These read as "the model is being dumb" and are actually prompt structure
problems. Diagnose by logging the **raw** JSON, not the parsed result: a
post-processing step that silently discards a malformed field makes a model that
answered correctly look like it refused.

## Order keys decision-first, prose-last

Generation is left to right, so a field can only reflect a decision that appears
earlier in the JSON.

**Why:** a pass that had to both rewrite text and place markers inside it kept
returning a correct marker list alongside text containing no markers — the text
was generated before the list existed. Reordering the keys fixed placement with
no other change.

**How to apply:** any field that must cross-reference another (ids that also have
to appear inside a body of text) goes *after* the field it references. State in
the prompt that the order is deliberate.

## A "nothing to do" output shape will swallow the other jobs

If job 1 can answer with its own minimal object, the model emits that and never
reaches job 2.

**Why:** a two-job pass lost job 2 entirely for every input where job 1 found
nothing to do, silently and only for that subset.

**How to apply:** say explicitly that the later job applies to every input
including ones where job 1 found nothing, and make the minimal output shape
conditional on *all* jobs finding nothing.

## Never let a model reproduce an identifier you gave it

Hand it indexes into a list and substitute the real values yourself. It cannot
mangle or hallucinate a URL it was never shown, and validating an integer against
a range is trivial next to validating a URL.

**How to apply:** also cap on the *substituted output*, not on the model's
selection. A model that repeats a marker turns one selection into many rendered
items, which a selection-side cap cannot see.
