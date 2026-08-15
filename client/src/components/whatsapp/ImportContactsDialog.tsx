/**
 * Contact import with a review step.
 *
 * The file is parsed in the browser for an instant preview, but every count and
 * verdict shown here comes back from the server, which recomputes them with the
 * same routine it uses to do the actual write. That is deliberate: a review
 * screen that can disagree with the import teaches people to distrust it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload,
} from "lucide-react";
import {
  SKIP_REASON_LABELS,
  buildSheetData,
  detectNameColumn,
  detectPhoneColumn,
  type ImportColumn,
  type SkipReason,
} from "@shared/contactImport";
import {
  describeDelimiter,
  parseSpreadsheetFile,
  pickDefaultSheet,
  type ParsedSpreadsheet,
} from "@/lib/spreadsheetImport";
import { downloadContactSampleWorkbook } from "@/lib/contactSampleWorkbook";

const NO_NAME_COLUMN = "__none__";

interface EvaluatedRow {
  rowNumber: number;
  rawPhone: string;
  phone: string;
  sendPhone: string | null;
  name: string;
  attributes: Record<string, string>;
  status: "ready" | "skipped";
  reason?: SkipReason;
  message?: string;
  warning?: string;
}

interface ReviewResponse {
  columns: ImportColumn[];
  phoneColumn: string;
  nameColumn: string;
  attributeColumns: ImportColumn[];
  defaultCountryCode: string | null;
  summary: {
    total: number;
    ready: number;
    skipped: number;
    warnings: number;
    byReason: Record<SkipReason, number>;
  };
  problemRows: EvaluatedRow[];
  previewRows: EvaluatedRow[];
}

export function ImportContactsDialog({
  groupId,
  open,
  onOpenChange,
  defaultCountryCode,
  onImported,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCountryCode: string | null;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [phoneColumn, setPhoneColumn] = useState("");
  const [nameColumn, setNameColumn] = useState("");
  const [parseError, setParseError] = useState("");

  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const requestSeq = useRef(0);

  const reset = () => {
    setFileName(""); setParsed(null); setSheetName(""); setHeaderRow(null);
    setPhoneColumn(""); setNameColumn(""); setParseError("");
    setReview(null); setReviewError(""); setReviewing(false);
  };

  const records = useMemo(
    () => (parsed ? parsed.recordsBySheet[sheetName] ?? [] : []),
    [parsed, sheetName],
  );

  const sheet = useMemo(
    () => buildSheetData(records, headerRow ?? undefined),
    [records, headerRow],
  );

  // Re-detect the mapping whenever the shape of the sheet changes (different
  // sheet, different header row) and the current choice no longer exists.
  useEffect(() => {
    if (sheet.columns.length === 0) return;
    const has = (key: string) => sheet.columns.some(c => c.key === key);
    if (!has(phoneColumn)) setPhoneColumn(detectPhoneColumn(sheet.columns));
    if (nameColumn && !has(nameColumn)) setNameColumn(detectNameColumn(sheet.columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.columns]);

  // Ask the server for the verdict. Stale responses are discarded so a slow
  // earlier request can never overwrite the mapping the user is looking at.
  useEffect(() => {
    if (!open || !parsed || sheet.columns.length === 0 || !phoneColumn) {
      setReview(null);
      return;
    }
    const seq = ++requestSeq.current;
    setReviewing(true);
    setReviewError("");

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/whatsapp/contact-groups/${groupId}/import-preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            columns: sheet.columns,
            rows: sheet.rows,
            phoneColumn,
            nameColumn: nameColumn || "",
          }),
        });
        const body = await response.json();
        if (seq !== requestSeq.current) return;
        if (!response.ok) throw new Error(body?.error || "Could not read that file");
        setReview(body as ReviewResponse);
      } catch (error: any) {
        if (seq !== requestSeq.current) return;
        setReviewError(error.message || "Could not read that file");
        setReview(null);
      } finally {
        if (seq === requestSeq.current) setReviewing(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [open, parsed, sheet, phoneColumn, nameColumn, groupId]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/whatsapp/contact-groups/${groupId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          columns: sheet.columns,
          rows: sheet.rows,
          phoneColumn,
          nameColumn: nameColumn || "",
          reviewedReady: review?.summary.ready ?? 0,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Import failed");
      return body as { imported: number; skipped: number; total: number; driftNote: string | null };
    },
    onSuccess: result => {
      onImported();
      toast({
        title: `Imported ${result.imported} contact${result.imported === 1 ? "" : "s"}`,
        description: result.driftNote
          ?? `${result.skipped} skipped of ${result.total} rows read.`,
      });
      reset();
      onOpenChange(false);
    },
    onError: (error: any) =>
      toast({ title: "Import failed", description: error.message, variant: "destructive" }),
  });

  const handleFile = async (file: File) => {
    reset();
    setFileName(file.name);
    try {
      const result = await parseSpreadsheetFile(file);
      const sheetKey = pickDefaultSheet(result);
      setParsed(result);
      setSheetName(sheetKey);
      const initial = buildSheetData(result.recordsBySheet[sheetKey] ?? []);
      setHeaderRow(initial.headerRow);
      setPhoneColumn(detectPhoneColumn(initial.columns));
      setNameColumn(detectNameColumn(initial.columns));
    } catch (error: any) {
      setParseError(error.message || "Could not read that file");
    }
  };

  const rowNumbers = records.map(r => r.r);
  const minRow = rowNumbers.length ? Math.min(...rowNumbers) : 1;
  const maxRow = rowNumbers.length ? Math.max(...rowNumbers) : 1;
  const summary = review?.summary;
  const canImport = !!summary && summary.ready > 0 && !reviewing && !importMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={next => { if (!next) reset(); onOpenChange(next); }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-import-contacts">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            {parsed ? "Review before importing" : "Import contacts"}
          </DialogTitle>
          <DialogDescription>
            {parsed
              ? "Check what will be added and what will be skipped. Nothing is saved until you confirm."
              : "Upload an Excel or CSV file. You'll get a chance to review it first."}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />

        {!parsed ? (
          /* ---------------------------- File chooser ---------------------------- */
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => fileRef.current?.click()}
              data-testid="dropzone-import"
            >
              <Upload className="h-7 w-7 mx-auto text-gray-400 mb-2" />
              <div className="font-medium text-gray-700">Choose an Excel or CSV file</div>
              <div className="text-xs text-gray-500 mt-1">
                .xlsx, .xls or .csv — nothing is saved until you confirm
              </div>
            </div>

            {parseError && (
              <div className="text-sm text-red-600 flex items-start gap-2" data-testid="text-parse-error">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {parseError}
              </div>
            )}

            <div className="rounded-lg bg-gray-50 border p-3 text-sm text-gray-600">
              <div className="font-medium text-gray-800 mb-1">Not sure how to lay it out?</div>
              <p className="text-xs mb-3">
                The sample has the right columns and keeps phone numbers formatted as text, so
                Excel can't turn a country-code number into <code className="bg-white px-1 rounded">9.19811E+11</code>.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadContactSampleWorkbook(defaultCountryCode)}
                data-testid="button-download-sample"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Download sample file
              </Button>
            </div>
          </div>
        ) : (
          /* ------------------------------- Review ------------------------------- */
          <div className="space-y-4">
            {/* Source */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm">
                  <span className="font-medium">{fileName}</span>
                  {parsed.kind === "delimited" && (
                    <span className="text-xs text-gray-500 ml-2">
                      {describeDelimiter(parsed.delimiter)}-separated · {parsed.encoding}
                    </span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={reset} data-testid="button-choose-other-file">
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Choose another file
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {parsed.sheetNames.length > 1 && (
                  <div>
                    <label className="text-xs font-medium text-gray-600">Sheet</label>
                    <Select value={sheetName} onValueChange={value => { setSheetName(value); setHeaderRow(null); }}>
                      <SelectTrigger data-testid="select-sheet"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {parsed.sheetNames.map(name => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-gray-600">Header row</label>
                  <Input
                    type="number"
                    min={minRow}
                    max={maxRow}
                    value={sheet.headerRow}
                    onChange={e => {
                      const value = parseInt(e.target.value, 10);
                      setHeaderRow(Number.isFinite(value) ? value : null);
                    }}
                    data-testid="input-header-row"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Row {sheet.headerRow} is being read as the column names.
                    {sheet.headerRow > minRow && " Rows above it are ignored."}
                  </p>
                </div>
              </div>
            </div>

            {/* Column mapping */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Phone number column</label>
                  <Select value={phoneColumn} onValueChange={setPhoneColumn}>
                    <SelectTrigger data-testid="select-phone-column"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sheet.columns.map(column => (
                        <SelectItem key={column.key} value={column.key}>{column.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Name column</label>
                  <Select
                    value={nameColumn || NO_NAME_COLUMN}
                    onValueChange={value => setNameColumn(value === NO_NAME_COLUMN ? "" : value)}
                  >
                    <SelectTrigger data-testid="select-name-column"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_NAME_COLUMN}>No name column</SelectItem>
                      {sheet.columns.filter(c => c.key !== phoneColumn).map(column => (
                        <SelectItem key={column.key} value={column.key}>{column.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {review && review.attributeColumns.length > 0 && (
                <div className="text-xs text-gray-600">
                  <span className="font-medium">Imported as contact details: </span>
                  {review.attributeColumns.map(c => c.label).join(", ")}
                  <span className="text-gray-400"> — usable as template placeholders and readable by the AI.</span>
                </div>
              )}

              {sheet.renamedColumns.length > 0 && (
                <p className="text-xs text-amber-700">
                  Duplicate column names were renamed so nothing is lost:{" "}
                  {sheet.renamedColumns.map(c => c.key).join(", ")}.
                </p>
              )}
            </div>

            {reviewError && (
              <div className="text-sm text-red-600 flex items-start gap-2" data-testid="text-review-error">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {reviewError}
              </div>
            )}

            {reviewing && !summary && (
              <div className="text-sm text-gray-500 flex items-center gap-2 py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking your file…
              </div>
            )}

            {summary && (
              <>
                {/* Tally */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border p-3" data-testid="tile-rows-found">
                    <div className="text-xs text-gray-500">Rows found</div>
                    <div className="text-xl font-bold text-gray-800">{summary.total}</div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="tile-will-import">
                    <div className="text-xs text-emerald-700">Will import</div>
                    <div className="text-xl font-bold text-emerald-700">{summary.ready}</div>
                  </div>
                  <div className="rounded-lg border p-3" data-testid="tile-will-skip">
                    <div className="text-xs text-gray-500">Will be skipped</div>
                    <div className="text-xl font-bold text-gray-500">{summary.skipped}</div>
                  </div>
                </div>

                {sheet.blankRowsSkipped > 0 && (
                  <p className="text-xs text-gray-500">
                    {sheet.blankRowsSkipped} completely empty row{sheet.blankRowsSkipped === 1 ? " was" : "s were"} ignored.
                  </p>
                )}

                {/* Why rows are skipped */}
                {summary.skipped > 0 && (
                  <div className="rounded-lg border divide-y" data-testid="list-skip-reasons">
                    {(Object.keys(summary.byReason) as SkipReason[])
                      .filter(reason => summary.byReason[reason] > 0)
                      .map(reason => (
                        <div key={reason} className="flex items-center justify-between px-3 py-2 text-sm">
                          <span className="text-gray-700">{SKIP_REASON_LABELS[reason]}</span>
                          <span className="font-medium text-gray-600">{summary.byReason[reason]}</span>
                        </div>
                      ))}
                  </div>
                )}

                {/* Country-code warning: importable, but undeliverable as-is */}
                {summary.warnings > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">{summary.warnings} number{summary.warnings === 1 ? "" : "s"} will fail at send time.</span>{" "}
                      This group is set to Mixed, so each number must already include its country code.
                      They will still be imported — set a default country code on the group, or fix the numbers.
                    </div>
                  </div>
                )}

                {/* Problem rows, with the numbers the user sees in Excel */}
                {review!.problemRows.length > 0 && (
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">Rows that need attention</div>
                    <div className="rounded-lg border divide-y max-h-52 overflow-y-auto" data-testid="list-problem-rows">
                      {review!.problemRows.map(row => (
                        <div key={`${row.rowNumber}-${row.rawPhone}`} className="px-3 py-2 text-sm flex items-start gap-3">
                          <span className="text-xs font-mono text-gray-400 w-16 shrink-0 pt-0.5">Row {row.rowNumber}</span>
                          <span className="flex-1 text-gray-700">{row.message}</span>
                          <span className="text-xs text-gray-500 shrink-0">
                            {row.reason ? SKIP_REASON_LABELS[row.reason] : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    {summary.skipped > review!.problemRows.length && (
                      <p className="text-xs text-gray-500 mt-1">
                        Showing the first {review!.problemRows.length} of {summary.skipped}.
                      </p>
                    )}
                  </div>
                )}

                {/* What will actually be sent */}
                {review!.previewRows.length > 0 && (
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">
                      Preview — numbers shown exactly as they will be dialled
                    </div>
                    <div className="rounded-lg border divide-y max-h-52 overflow-y-auto" data-testid="list-preview-rows">
                      {review!.previewRows.map(row => (
                        <div key={row.rowNumber} className="px-3 py-2 text-sm flex items-start gap-3">
                          <span className="text-xs font-mono text-gray-400 w-16 shrink-0 pt-0.5">Row {row.rowNumber}</span>
                          <span className="font-mono text-gray-800 w-36 shrink-0">
                            {row.sendPhone ? `+${row.sendPhone}` : row.phone}
                          </span>
                          <div className="flex-1 min-w-0">
                            {row.name && <div className="text-gray-700 truncate">{row.name}</div>}
                            {Object.keys(row.attributes).length > 0 && (
                              <div className="text-xs text-gray-500 truncate">
                                {Object.entries(row.attributes).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(" · ")}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {summary.ready === 0 && (
                  <div className="text-sm text-gray-600 text-center py-2">
                    Nothing here can be imported. Check the phone column selection above, or fix the rows listed.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            Cancel
          </Button>
          {parsed && (
            <Button
              disabled={!canImport}
              onClick={() => importMutation.mutate()}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Importing…</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Import {summary?.ready ?? 0} contact{(summary?.ready ?? 0) === 1 ? "" : "s"}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
