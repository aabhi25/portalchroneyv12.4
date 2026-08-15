/**
 * Browser-side spreadsheet reading for contact imports.
 *
 * Workbooks are decoded here rather than on the server on purpose: the
 * spreadsheet parser is the risky part of handling an arbitrary uploaded file,
 * and in the browser a malicious file can only affect the session of the person
 * who chose it. The server still recomputes every verdict — see
 * `shared/contactImport.ts`.
 */
import * as XLSX from "xlsx";
import {
  MAX_IMPORT_ROWS,
  decodeTextBytes,
  numberToPlainString,
  parseDelimitedText,
  type SourceRecord,
} from "@shared/contactImport";

/** Guard against pathological files locking up the tab. */
const MAX_COLUMNS = 200;

export interface ParsedSpreadsheet {
  kind: "workbook" | "delimited";
  /** Sheet names, empty for delimited files. */
  sheetNames: string[];
  /** Records keyed by sheet name. Delimited files use a single "" key. */
  recordsBySheet: Record<string, SourceRecord[]>;
  /** Detected text encoding, delimited files only. */
  encoding?: string;
  /** Detected column separator, delimited files only. */
  delimiter?: string;
}

function looksLikeWorkbook(bytes: Uint8Array, fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) return true;
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) return false;
  // ZIP header (xlsx) or legacy OLE compound-document header (xls).
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return true;
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf) return true;
  return false;
}

function formatExcelDate(serial: number): string {
  const parsed: any = (XLSX as any).SSF?.parse_date_code?.(serial);
  if (!parsed) return numberToPlainString(serial);
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
  if (parsed.H || parsed.M || parsed.S) return `${datePart} ${pad(parsed.H)}:${pad(parsed.M)}`;
  return datePart;
}

/**
 * Turn a cell into text without losing precision.
 *
 * Numeric cells are read from the stored value, never the displayed text. A
 * 12-digit phone number displays as `9.19811E+11` in Excel, and taking the
 * display string is exactly how phone lists get silently corrupted.
 */
function cellToString(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return "";
  switch (cell.t) {
    case "n": {
      const num = cell.v as number;
      const fmt = cell.z ? String(cell.z) : "";
      if (fmt && (XLSX as any).SSF?.is_date?.(fmt)) return formatExcelDate(num);
      return numberToPlainString(num);
    }
    case "b":
      return cell.v ? "TRUE" : "FALSE";
    case "d": {
      const date = cell.v as Date;
      if (!(date instanceof Date) || isNaN(date.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const h = date.getHours(), m = date.getMinutes();
      return h || m ? `${datePart} ${pad(h)}:${pad(m)}` : datePart;
    }
    case "e":
      return "";
    default:
      return String(cell.v);
  }
}

function sheetToRecords(worksheet: XLSX.WorkSheet): SourceRecord[] {
  const ref = worksheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rowCount = range.e.r - range.s.r + 1;
  if (rowCount > MAX_IMPORT_ROWS + 1) {
    throw new Error(
      `That sheet has ${rowCount.toLocaleString()} rows. The limit is ${MAX_IMPORT_ROWS.toLocaleString()} per import — split it into smaller files.`,
    );
  }
  const lastColumn = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1);

  const records: SourceRecord[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const values: string[] = [];
    for (let c = range.s.c; c <= lastColumn; c++) {
      values.push(cellToString(worksheet[XLSX.utils.encode_cell({ r, c })]));
    }
    // `r` is zero-based within the sheet, so +1 gives the row number the user
    // sees in Excel — including when the used range starts part-way down.
    records.push({ r: r + 1, v: values });
  }
  return records;
}

/** Read a chosen file into per-sheet records, preserving true row numbers. */
export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (looksLikeWorkbook(bytes, file.name)) {
    // `cellDates` turns date-formatted numerics into real Dates and `cellNF`
    // exposes the number format as a fallback. Without them a due date reads
    // back as its raw serial (46000), which is meaningless to a person and
    // useless to the AI that later reads these as contact details.
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellNF: true });
    const recordsBySheet: Record<string, SourceRecord[]> = {};
    for (const name of workbook.SheetNames) {
      recordsBySheet[name] = sheetToRecords(workbook.Sheets[name]);
    }
    if (workbook.SheetNames.length === 0) throw new Error("That workbook has no sheets");
    return { kind: "workbook", sheetNames: workbook.SheetNames, recordsBySheet };
  }

  const { text, encoding } = decodeTextBytes(bytes);
  const { records, delimiter } = parseDelimitedText(text);
  if (records.length > MAX_IMPORT_ROWS + 1) {
    throw new Error(
      `That file has ${records.length.toLocaleString()} rows. The limit is ${MAX_IMPORT_ROWS.toLocaleString()} per import — split it into smaller files.`,
    );
  }
  return {
    kind: "delimited",
    sheetNames: [],
    recordsBySheet: { "": records },
    encoding,
    delimiter,
  };
}

/** Pick the sheet most likely to hold the contacts: the first with real rows. */
export function pickDefaultSheet(parsed: ParsedSpreadsheet): string {
  if (parsed.kind === "delimited") return "";
  for (const name of parsed.sheetNames) {
    const records = parsed.recordsBySheet[name] ?? [];
    const filled = records.filter(rec => rec.v.some(cell => cell.trim() !== ""));
    if (filled.length > 1) return name;
  }
  return parsed.sheetNames[0] ?? "";
}

/** Human-readable delimiter name for the review screen. */
export function describeDelimiter(delimiter?: string): string {
  switch (delimiter) {
    case ",": return "comma";
    case ";": return "semicolon";
    case "\t": return "tab";
    case "|": return "pipe";
    default: return "comma";
  }
}
