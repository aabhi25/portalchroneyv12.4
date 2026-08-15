/**
 * Contact-import parsing and validation.
 *
 * This module is deliberately isomorphic and dependency-free: it runs unchanged
 * in the browser (to build the review screen) and on the server (to decide what
 * actually gets written). That is the whole point — the review screen and the
 * import MUST agree, and the only reliable way to guarantee that is to run the
 * same code over the same input rather than two implementations that happen to
 * match today.
 *
 * Workbook (.xlsx/.xls) decoding lives in the client lib, not here, so the
 * spreadsheet parser never runs on the server against an untrusted upload.
 * This file only ever sees already-extracted strings.
 */

/** Hard ceiling on rows accepted in a single import. */
export const MAX_IMPORT_ROWS = 50000;

/** Fewer digits than this and it cannot be a dialable number. */
export const MIN_PHONE_DIGITS = 7;

/** Header names we auto-detect as the phone column, in priority order. */
export const PHONE_COLUMN_CANDIDATES = ["phone", "mobile", "number", "whatsapp"];

/** Header names we auto-detect as the name column, in priority order. */
export const NAME_COLUMN_CANDIDATES = ["name", "full_name", "fullname", "first_name"];

// ---------------------------------------------------------------------------
// Phone handling
// ---------------------------------------------------------------------------

/** Reduce a phone to digits only. This is the form stored in the database. */
export function normalizePhone(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

/**
 * Apply a contact group's default country code to a phone number for sending.
 *
 * Rules:
 * - Strip non-digits and any leading zero (common in locally-typed numbers).
 * - If the group has a default country code:
 *     - If the cleaned digits are <= 10, prepend the country code (treat as
 *       a local number).
 *     - Otherwise leave as-is (treat as already international).
 * - If the group has NO default code (Mixed mode):
 *     - The number must be at least 11 digits AND not look like a 10-digit
 *       local — otherwise return an error so the recipient is marked failed
 *       instead of being silently shipped to MSG91 with a malformed `to`.
 */
export function applyCountryCode(
  rawPhone: string,
  defaultCountryCode: string | null | undefined,
): { phone: string | null; error?: string } {
  let cleaned = (rawPhone || "").replace(/\D/g, "");
  // Strip a single leading zero — typed local numbers often have one.
  if (cleaned.startsWith("0")) cleaned = cleaned.replace(/^0+/, "");
  if (!cleaned) return { phone: null, error: "Phone is empty" };

  const code = (defaultCountryCode || "").replace(/\D/g, "");
  if (code) {
    if (cleaned.length <= 10) return { phone: code + cleaned };
    return { phone: cleaned };
  }
  if (cleaned.length < 11) {
    return {
      phone: null,
      error: `Missing country code — group is set to Mixed, so each phone must include its country code (e.g. 919810560800).`,
    };
  }
  return { phone: cleaned };
}

/**
 * Render a number as plain digits, never scientific notation.
 *
 * This is the crux of the Excel phone-number problem. A 12-digit number with a
 * country code is past the width where Excel switches its *display* to
 * `9.19811E+11`, and anything that reads the displayed text rather than the
 * underlying value inherits that corruption. Reading the true cell value and
 * formatting it here keeps the number intact.
 */
export function numberToPlainString(value: number): string {
  if (!isFinite(value)) return "";
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return value.toFixed(0);
  const asString = String(value);
  if (!/e/i.test(asString)) return asString;
  // Fall back to a fixed rendering for the rare non-integer exponent case.
  const fixed = value.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
  return fixed;
}

// ---------------------------------------------------------------------------
// Text decoding
// ---------------------------------------------------------------------------

/**
 * Decode raw file bytes into text, honouring the encodings Excel actually emits.
 *
 * Excel's "CSV UTF-8" writes a UTF-8 BOM, its "Unicode Text" export writes
 * UTF-16LE with a BOM, and its plain "CSV" export on Windows writes the system
 * codepage (commonly windows-1252). Decoding everything as UTF-8 turns the
 * latter two into mojibake.
 */
export function decodeTextBytes(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeWith("utf-16le", bytes.subarray(2)), encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeWith("utf-16be", bytes.subarray(2)), encoding: "utf-16be" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeWith("utf-8", bytes.subarray(3)), encoding: "utf-8" };
  }

  const utf8 = decodeWith("utf-8", bytes);
  // U+FFFD means the bytes were not valid UTF-8; the usual culprit is a
  // Windows-codepage CSV. Retry rather than importing corrupted names.
  if (utf8.includes("\ufffd")) {
    const fallback = tryDecode("windows-1252", bytes);
    if (fallback !== null) return { text: fallback, encoding: "windows-1252" };
  }
  return { text: utf8, encoding: "utf-8" };
}

function decodeWith(encoding: string, bytes: Uint8Array): string {
  return new TextDecoder(encoding).decode(bytes);
}

function tryDecode(encoding: string, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Delimited-text parsing
// ---------------------------------------------------------------------------

/** One physical record from the source file, numbered as the user sees it. */
export interface SourceRecord {
  /** 1-based record number, matching the row number shown in Excel. */
  r: number;
  /** Cell values, left to right. */
  v: string[];
}

const DELIMITER_CANDIDATES = [",", ";", "\t", "|"];

/**
 * Pick the delimiter by counting candidates in the first record, ignoring
 * anything inside quotes. Excel exports semicolon-separated files in many
 * locales, which a comma-only parser collapses into a single column.
 */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITER_CANDIDATES.map(d => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "\n" || ch === "\r") break;
    if (counts.has(ch)) counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITER_CANDIDATES) {
    const c = counts.get(d) || 0;
    if (c > bestCount) { best = d; bestCount = c; }
  }
  return best;
}

/**
 * Parse delimited text into records.
 *
 * Unlike a line-splitting parser, this walks the text as a single stream so a
 * quoted field containing a line break stays one field. Splitting on newlines
 * first shifts every column after such a field, silently and with no error.
 */
export function parseDelimitedText(text: string, delimiterHint?: string): {
  records: SourceRecord[];
  delimiter: string;
} {
  const delimiter = delimiterHint || detectDelimiter(text);
  const records: SourceRecord[] = [];
  let field = "";
  let current: string[] = [];
  let inQuotes = false;
  let started = false;
  let rowNumber = 1;

  const endField = () => { current.push(field); field = ""; started = true; };
  const endRecord = () => {
    endField();
    records.push({ r: rowNumber, v: current });
    rowNumber++;
    current = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; started = true; continue; }
    if (ch === delimiter) { endField(); continue; }
    if (ch === "\r") { if (text[i + 1] === "\n") i++; endRecord(); continue; }
    if (ch === "\n") { endRecord(); continue; }
    field += ch;
    started = true;
  }
  if (started || field.length > 0 || current.length > 0) {
    current.push(field);
    records.push({ r: rowNumber, v: current });
  }

  return { records, delimiter };
}

// ---------------------------------------------------------------------------
// Sheet shaping
// ---------------------------------------------------------------------------

export interface ImportColumn {
  /** Stable lookup key. Lower-cased; this is what attribute keys are named. */
  key: string;
  /** The header text exactly as written in the file, for display. */
  label: string;
}

export interface SheetData {
  columns: ImportColumn[];
  /** Data rows only, each carrying its true source row number. */
  rows: SourceRecord[];
  /** Source row number that was treated as the header. */
  headerRow: number;
  /** Fully blank rows dropped from `rows` (they are not problems worth listing). */
  blankRowsSkipped: number;
  /** Header names that collided after lower-casing and had to be suffixed. */
  renamedColumns: { label: string; key: string }[];
}

function isBlankRecord(record: SourceRecord): boolean {
  return !record.v.some(cell => (cell ?? "").trim() !== "");
}

/**
 * Choose the header row.
 *
 * Real files often open with a title line ("Collections — September") sitting
 * above the actual headers. Requiring two or more filled cells skips those
 * without skipping a legitimate single-column sheet.
 */
export function detectHeaderRow(records: SourceRecord[]): number {
  for (const rec of records) {
    const filled = rec.v.filter(c => (c ?? "").trim() !== "").length;
    if (filled >= 2) return rec.r;
  }
  for (const rec of records) {
    if (!isBlankRecord(rec)) return rec.r;
  }
  return records[0]?.r ?? 1;
}

/**
 * Header names that must never become attribute keys verbatim.
 *
 * Attributes are built by assigning into a plain object, and a column literally
 * headed `__proto__` would rewrite that object's prototype rather than adding a
 * field. Renaming is enough — nothing legitimate uses these as column names.
 */
const UNSAFE_COLUMN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Canonicalise header names into attribute keys.
 *
 * Idempotent, so it is safe for the server to re-run over keys the browser
 * already produced — which it does, because those keys arrive over the wire
 * and become object keys.
 */
export function normalizeColumnKeys(rawKeys: string[]): {
  keys: string[];
  renamedIndexes: number[];
} {
  const seen = new Map<string, number>();
  const keys: string[] = [];
  const renamedIndexes: number[] = [];

  rawKeys.forEach((raw, idx) => {
    let base = (raw ?? "").trim().toLowerCase() || `column_${idx + 1}`;
    if (UNSAFE_COLUMN_KEYS.has(base)) base = `${base}_field`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) {
      keys.push(base);
    } else {
      // Suffix rather than overwrite: a duplicate header should not make a
      // column silently disappear.
      keys.push(`${base}_${count + 1}`);
      renamedIndexes.push(idx);
    }
  });

  return { keys, renamedIndexes };
}

/** Turn header cells into stable keys, keeping duplicates distinguishable. */
export function buildColumns(headerCells: string[]): {
  columns: ImportColumn[];
  renamed: { label: string; key: string }[];
} {
  const { keys, renamedIndexes } = normalizeColumnKeys(headerCells);
  const wasRenamed = new Set(renamedIndexes);
  const renamed: { label: string; key: string }[] = [];

  const columns = headerCells.map((raw, idx) => {
    const label = (raw ?? "").trim();
    const column = { key: keys[idx], label: label || `Column ${idx + 1}` };
    if (wasRenamed.has(idx)) renamed.push(column);
    return column;
  });

  return { columns, renamed };
}

/** Split raw records into a header and data rows. */
export function buildSheetData(records: SourceRecord[], headerRowOverride?: number): SheetData {
  if (records.length === 0) {
    return { columns: [], rows: [], headerRow: 1, blankRowsSkipped: 0, renamedColumns: [] };
  }
  const headerRow = headerRowOverride && headerRowOverride > 0
    ? headerRowOverride
    : detectHeaderRow(records);

  const headerRecord = records.find(r => r.r === headerRow);
  const { columns, renamed } = buildColumns(headerRecord?.v ?? []);

  const after = records.filter(r => r.r > headerRow);
  const rows = after.filter(r => !isBlankRecord(r));

  return {
    columns,
    rows,
    headerRow,
    blankRowsSkipped: after.length - rows.length,
    renamedColumns: renamed,
  };
}

/** Auto-detect which column holds the phone number. Falls back to the first. */
export function detectPhoneColumn(columns: ImportColumn[]): string {
  for (const candidate of PHONE_COLUMN_CANDIDATES) {
    const hit = columns.find(c => c.key === candidate);
    if (hit) return hit.key;
  }
  const loose = columns.find(c => PHONE_COLUMN_CANDIDATES.some(p => c.key.includes(p)));
  if (loose) return loose.key;
  return columns[0]?.key ?? "";
}

/** Auto-detect which column holds the contact name. Empty string if none. */
export function detectNameColumn(columns: ImportColumn[]): string {
  for (const candidate of NAME_COLUMN_CANDIDATES) {
    const hit = columns.find(c => c.key === candidate);
    if (hit) return hit.key;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Validation — the single verdict used by both preview and import
// ---------------------------------------------------------------------------

export type SkipReason =
  | "missing_phone"
  | "too_short"
  | "duplicate_in_file"
  | "already_in_group";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  missing_phone: "No phone number",
  too_short: "Phone number too short",
  duplicate_in_file: "Duplicated in this file",
  already_in_group: "Already in this group",
};

export interface EvaluatedRow {
  /** Source row number, matching what the user sees in Excel. */
  rowNumber: number;
  /** The phone exactly as it appeared in the file. */
  rawPhone: string;
  /** Digits-only form, as stored. */
  phone: string;
  /** The number as it will actually be dialled, with the group's country code. */
  sendPhone: string | null;
  name: string;
  attributes: Record<string, string>;
  status: "ready" | "skipped";
  reason?: SkipReason;
  /** Human-readable explanation for a skip. */
  message?: string;
  /** Set on an importable row that will still fail at send time. */
  warning?: string;
}

export interface ImportSummary {
  total: number;
  ready: number;
  skipped: number;
  warnings: number;
  byReason: Record<SkipReason, number>;
}

export interface EvaluateInput {
  columns: ImportColumn[];
  rows: SourceRecord[];
  phoneColumn: string;
  nameColumn: string;
  defaultCountryCode: string | null | undefined;
  /** Digits-only phones already stored in the target group. */
  existingPhones: Set<string>;
}

/**
 * Decide the fate of every row.
 *
 * Both the review screen and the import call this, so a row shown as "ready"
 * is the same row that gets written. Order matters and mirrors the original
 * import: invalid numbers are rejected first, then duplicates within the file,
 * then contacts already in the group. Only rows that survive all three are
 * counted as seen, so a number already in the group appearing twice is
 * reported twice as "already in group" rather than once as a duplicate.
 */
export function evaluateImportRows(input: EvaluateInput): {
  rows: EvaluatedRow[];
  summary: ImportSummary;
} {
  const { columns, rows, phoneColumn, nameColumn, defaultCountryCode, existingPhones } = input;

  const phoneIdx = columns.findIndex(c => c.key === phoneColumn);
  const nameIdx = nameColumn ? columns.findIndex(c => c.key === nameColumn) : -1;

  const seen = new Set<string>();
  const evaluated: EvaluatedRow[] = [];
  const byReason: Record<SkipReason, number> = {
    missing_phone: 0,
    too_short: 0,
    duplicate_in_file: 0,
    already_in_group: 0,
  };
  let ready = 0;
  let warnings = 0;

  for (const row of rows) {
    const cell = (idx: number) => (idx >= 0 ? (row.v[idx] ?? "").trim() : "");
    const rawPhone = cell(phoneIdx);
    const phone = normalizePhone(rawPhone);
    const name = cell(nameIdx);

    const attributes: Record<string, string> = {};
    columns.forEach((col, idx) => {
      if (idx === phoneIdx || idx === nameIdx) return;
      const value = cell(idx);
      if (value) attributes[col.key] = value;
    });

    const base = { rowNumber: row.r, rawPhone, phone, name, attributes };

    const skip = (reason: SkipReason, message: string) => {
      byReason[reason]++;
      evaluated.push({ ...base, sendPhone: null, status: "skipped", reason, message });
    };

    if (!phone) {
      skip("missing_phone", rawPhone ? `No digits in "${rawPhone}"` : "Phone is blank");
      continue;
    }
    if (phone.length < MIN_PHONE_DIGITS) {
      skip("too_short", `Only ${phone.length} digit${phone.length === 1 ? "" : "s"}: "${rawPhone}"`);
      continue;
    }
    if (seen.has(phone)) {
      skip("duplicate_in_file", `${phone} appears earlier in this file`);
      continue;
    }
    if (existingPhones.has(phone)) {
      skip("already_in_group", `${phone} is already a contact in this group`);
      continue;
    }

    seen.add(phone);
    const applied = applyCountryCode(phone, defaultCountryCode);
    if (applied.error) warnings++;
    ready++;
    evaluated.push({
      ...base,
      sendPhone: applied.phone,
      status: "ready",
      warning: applied.error,
    });
  }

  return {
    rows: evaluated,
    summary: {
      total: rows.length,
      ready,
      skipped: rows.length - ready,
      warnings,
      byReason,
    },
  };
}
