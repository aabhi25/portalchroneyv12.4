---
name: AI workbook single-sheet model
description: Product decision for workbook structure, campaign data, and history visibility.
---

Every AI workbook has exactly one user-facing sheet. Campaign-linked workbooks consolidate recipient fields, imported attributes, campaign outcomes, captured reply values, and operator columns into that same table. Excel imports with multiple sheets must be rejected rather than merged or partially imported.

**Why:** Multi-sheet workbooks made ordinary campaign operations and result mapping unnecessarily complex. The user explicitly chose a simpler one-table workflow and confirmed that production multi-sheet data does not need migration.

**How to apply:** Enforce the one-sheet invariant for every new workbook write and keep snapshots, revisions, campaign-link records, and result-sync metadata as internal recovery and traceability mechanisms. Keep history/restore secondary; do not reintroduce add, delete, or switch-sheet UI.