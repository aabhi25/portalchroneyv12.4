---
name: Spreadsheet contact import
description: Why Excel files must be read as .xlsx rather than CSV, and why a review screen must share one validation routine with the import it previews.
---

# Reading spreadsheets without losing data

Excel writes what it **displays**, not what it stores. A phone number with a
country code (12 digits) exceeds Excel's display width threshold, so exporting
that sheet to CSV writes `9.19811E+11` — the real number is gone from the file
before any parser sees it. Reading the `.xlsx` directly avoids this because
scientific notation there is only a display format.

**Rule:** for numeric cells always derive the string from the stored value
(`cell.v`), never the formatted display (`cell.w`).

**Why:** `cell.w` is where the corruption lives. This is also why a downloadable
sample workbook must write its phone column as text-formatted cells — a numeric
sample teaches Excel to keep mangling the column.

**How to apply:** any time a spreadsheet carries identifiers that are digits but
not quantities — phone numbers, account numbers, PIN codes, order IDs.

SheetJS does not expose number formats unless asked. Without `cellNF` a
date-formatted cell reads back as its raw serial (`46000`), and the date branch
of a cell reader silently never runs. Pass `cellDates` and `cellNF` together.

SheetJS date-only values can also land one millisecond before local midnight
because of floating-point conversion. Preserve local calendar components, not
UTC components, and round sub-second precision before extracting the date.

**Why:** UTC extraction shifts dates in positive-offset timezones, while the
one-millisecond artifact can still shift a local-midnight date to the previous
day.

**How to apply:** whenever a spreadsheet date is normalized to `YYYY-MM-DD`;
test the XLSX round-trip under the user's actual timezone, not only UTC.

Excel also emits three different CSV encodings depending on which "Save as" the
user picked: UTF-8 with BOM, UTF-16LE with BOM ("Unicode Text"), and the Windows
system codepage. Decoding everything as UTF-8 turns the latter two into
mojibake. Semicolon delimiters are normal in European locales.

A CSV parser that splits on newlines before handling quotes will shift every
column after a field containing a line break — silently, with no error. Walk the
text as one stream.

# Preview screens that promise numbers

**Rule:** a review screen and the operation it previews must call one routine
over one input, not two implementations that currently agree.

**Why:** a review that says 142 and delivers 138 is worse than no review — it
trains people to distrust the whole flow. This codebase has repeatedly produced
bugs of exactly this shape: separately-derived counts and lists disagreeing.

**How to apply:** the preview endpoint and the write endpoint take the same
payload and call the same evaluator; the write path filters the evaluator's
output rather than re-deciding. Where a legitimate divergence exists (rows that
became ineligible between preview and confirm), report it explicitly and
describe only what is verified — the two numbers — rather than guessing a cause.

Note the remaining gap: without a unique constraint on the target table,
concurrent commits can still both pass a read-then-insert dedupe check.
