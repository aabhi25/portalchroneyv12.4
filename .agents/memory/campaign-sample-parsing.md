---
name: Campaign sample parsing
description: Privacy and safety boundary for spreadsheet/PDF samples used to configure WhatsApp campaign automations.
---

Representative spreadsheet and PDF files used to configure an automation must be parsed in the administrator's browser. The server-side AI mapping endpoint may receive only a bounded list of normalized header keys and labels, plus the selected tenant-owned WhatsApp template ID; it must never receive file bytes or data rows.

**Why:** XLSX ZIP expansion and PDF parsing can consume disproportionate server memory and CPU for small crafted uploads. Keeping parsing in the browser contains that risk to the person selecting the file, matches the existing spreadsheet-import trust boundary, and prevents sample values from being sent to the AI or persisted.

**How to apply:** Keep client-side file-size, sheet/page, column, and inspection limits. Support text-based PDFs through browser PDF.js extraction; present a clear error for PDFs without selectable table headers. Treat AI suggestions as untrusted: validate every selected key against the header list server-side.