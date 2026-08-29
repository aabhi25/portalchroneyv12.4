---
name: Workbook automation source locking
description: Concurrency and audit rules when an AI Workbook is used as a campaign automation source.
---

A workbook-backed run must bind to both the workbook version ID and that version's mutable revision. Preview tokens are required, and run creation must recheck them while holding the same workbook-row lock used by every source-changing workbook operation.

**Why:** A saved workbook version can be edited in place by incrementing its revision, while other actions create a new version. Checking only the version ID—or checking outside the commit transaction—can schedule recipients from data that changed after review.

**How to apply:** Any operation that changes workbook rows, columns, revisions, versions, campaign linkage, mappings, or deletion must lock the workbook row first. Historical run provenance must remain an immutable snapshot even if the workbook is later deleted.