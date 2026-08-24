---
name: TopScholar subject labels
description: Source-of-truth constraint for normalizing Tester subject labels from the client content store.
---

The configured client embedding collection cannot currently supply short subject
names for the affected CPs: it stores a `subject_id`, but its `subject` value is
the full CP label and there is no `subjectName` or metadata subject field.

**Why:** Importing that field into app-side Tester mappings faithfully preserves
the long label instead of turning it into `English`, `EVS`, or `Mathematics`.

**How to apply:** Use a client-provided subject-master source keyed by
`subject_id` (or an API that returns the clean subject name) before attempting
to normalize these labels. Do not infer a shorter label from the CP name.