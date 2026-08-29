const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function excelSerialDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial >= 2_958_466) return null;
  const wholeDays = Math.floor(serial);
  if (wholeDays === 60) return null; // Excel's fictitious 1900-02-29.
  const adjustedDays = wholeDays > 60 ? wholeDays - 1 : wholeDays;
  const date = new Date(Date.UTC(1899, 11, 31) + adjustedDays * DAY_MS);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Normalize dates accepted from spreadsheets and Workbook cells.
 * Supports Date objects, ISO dates, day-first dates, and Excel's 1900 serial system.
 */
export function parseSpreadsheetDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // SheetJS materializes date-only cells at local midnight. Preserve those
    // calendar components rather than shifting the date through UTC. Its
    // floating-point conversion can land 1 ms before midnight, so round that
    // sub-second artifact before reading the local calendar date.
    const calendarDate = new Date(Math.round(value.getTime() / 1000) * 1000);
    return isoDate(calendarDate.getFullYear(), calendarDate.getMonth() + 1, calendarDate.getDate());
  }

  if (typeof value === "number") return excelSerialDate(value);

  const text = String(value ?? "").trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s.*)?$/);
  if (dayFirst) return isoDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));

  if (/^\d+(?:\.\d+)?$/.test(text)) return excelSerialDate(Number(text));
  return null;
}