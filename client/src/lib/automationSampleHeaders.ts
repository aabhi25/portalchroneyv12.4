import { buildColumns, buildSheetData, type ImportColumn } from "@shared/contactImport";
import { parseSpreadsheetFile, pickDefaultSheet } from "@/lib/spreadsheetImport";

const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;
const MAX_SAMPLE_SHEETS = 12;
const MAX_SAMPLE_PAGES = 12;
const MAX_SAMPLE_COLUMNS = 100;
const MAX_HEADER_ROWS_TO_INSPECT = 40;

export type HeaderSource = {
  id: string;
  label: string;
  columns: ImportColumn[];
  headerRow?: number;
  repeatedHeader?: boolean;
};

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function sourceFromRecords(id: string, label: string, records: Parameters<typeof buildSheetData>[0]): HeaderSource | null {
  const sheet = buildSheetData(records.slice(0, MAX_HEADER_ROWS_TO_INSPECT));
  if (sheet.columns.length === 0) return null;
  return {
    id,
    label,
    columns: sheet.columns.slice(0, MAX_SAMPLE_COLUMNS),
    headerRow: sheet.headerRow,
  };
}

async function extractSpreadsheetHeaders(file: File): Promise<HeaderSource[]> {
  const parsed = await parseSpreadsheetFile(file);
  if (parsed.kind === "delimited") {
    const source = sourceFromRecords("delimited", "Detected table", parsed.recordsBySheet[""] || []);
    if (!source) throw new Error("We could not find a header row in that file");
    return [source];
  }

  const defaultSheet = pickDefaultSheet(parsed);
  const sources = parsed.sheetNames.slice(0, MAX_SAMPLE_SHEETS).flatMap((sheetName, index) => {
    const source = sourceFromRecords(`sheet-${index + 1}`, sheetName, parsed.recordsBySheet[sheetName] || []);
    return source ? [source] : [];
  });
  if (sources.length === 0) throw new Error("We could not find a header row in that workbook");
  return sources.sort((left, right) => left.label === defaultSheet ? -1 : right.label === defaultSheet ? 1 : 0);
}

type PdfTextItem = { text: string; x: number; y: number };

function pdfRows(items: PdfTextItem[]): string[][] {
  const lines: { y: number; items: PdfTextItem[] }[] = [];
  for (const item of items) {
    const line = lines.find(candidate => Math.abs(candidate.y - item.y) <= 2);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines
    .sort((left, right) => right.y - left.y)
    .map(line => line.items
      .sort((left, right) => left.x - right.x)
      .map(item => item.text.trim())
      .filter(Boolean))
    .filter(row => row.length > 0);
}

function pickPdfHeader(rows: string[][]): string[] | null {
  for (let index = 0; index < Math.min(rows.length - 1, MAX_HEADER_ROWS_TO_INSPECT); index++) {
    const row = rows[index].slice(0, MAX_SAMPLE_COLUMNS);
    const next = rows[index + 1];
    const concise = row.length >= 2 && row.every(value => value.length <= 80);
    if (concise && next.length >= Math.max(2, row.length - 2)) return row;
  }
  return rows.find(row => row.length >= 2)?.slice(0, MAX_SAMPLE_COLUMNS) || null;
}

async function extractPdfHeaders(file: File): Promise<HeaderSource[]> {
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: true,
    verbosity: 0,
  }).promise;

  try {
    const sources: HeaderSource[] = [];
    const seen = new Map<string, number>();
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, MAX_SAMPLE_PAGES); pageNumber++) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const items: PdfTextItem[] = text.items
        .map((item: any) => ({
          text: String(item.str || "").trim(),
          x: Number(item.transform?.[4] || 0),
          y: Number(item.transform?.[5] || 0),
        }))
        .filter((item: PdfTextItem) => item.text);
      const headers = pickPdfHeader(pdfRows(items));
      if (!headers) continue;
      const { columns } = buildColumns(headers);
      const signature = columns.map(column => column.key).join("\u001f");
      const priorPage = seen.get(signature);
      seen.set(signature, pageNumber);
      sources.push({
        id: `pdf-page-${pageNumber}`,
        label: priorPage ? `Page ${pageNumber} (same header as page ${priorPage})` : `Page ${pageNumber}`,
        columns,
        repeatedHeader: priorPage !== undefined,
      });
    }
    if (sources.length === 0) {
      throw new Error("We could not detect a selectable table header in this PDF. Export it as Excel/CSV, or use a text-based PDF with a visible header row.");
    }
    return sources;
  } finally {
    await document.destroy();
  }
}

export async function extractAutomationSampleHeaders(file: File): Promise<HeaderSource[]> {
  if (file.size === 0) throw new Error("Choose an Excel, CSV, or PDF sample file");
  if (file.size > MAX_SAMPLE_BYTES) throw new Error("Sample files must be 5 MB or smaller");
  return isPdf(file) ? extractPdfHeaders(file) : extractSpreadsheetHeaders(file);
}