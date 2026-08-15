/**
 * Generates the downloadable sample contact workbook.
 *
 * The phone column is written as text-formatted cells rather than numbers. That
 * matters more than it looks: if the sample shipped phone numbers as numeric
 * cells, Excel would render a country-code number as `9.19811E+11` and any
 * re-save to CSV would bake that corruption in. Text cells keep the digits, and
 * new rows typed underneath inherit the formatting.
 */
import * as XLSX from "xlsx";

const CONTACT_HEADERS = ["phone", "name", "city", "plan", "due_date"];

const SAMPLE_ROWS: string[][] = [
  ["9810560800", "Ravi Kumar", "Delhi", "Gold", "2026-09-10"],
  ["919820011223", "Surbhi Sharma", "Mumbai", "Silver", "2026-09-14"],
  ["08800224433", "Aditya Nair", "Bengaluru", "Gold", "2026-09-18"],
];

function instructionSheet(defaultCountryCode: string | null): XLSX.WorkSheet {
  const codeNote = defaultCountryCode
    ? `This group is set to +${defaultCountryCode}. You can enter local numbers without the country code — they are prefixed automatically when messages are sent.`
    : `This group is set to Mixed, so every number must already include its country code (for example 919810560800).`;

  const rows: string[][] = [
    ["How to fill in the Contacts sheet"],
    [""],
    ["Column", "Required?", "What it does"],
    ["phone", "Required", "The WhatsApp number to message. Keep this column formatted as Text."],
    ["name", "Optional", "Used to personalise messages, e.g. {{name}} in a template."],
    ["", "", ""],
    ["Any other column", "Optional", "Becomes a saved detail for that contact."],
    ["", "", "You can use it in a template as a placeholder, e.g. {{city}}."],
    ["", "", "The AI assistant can also read it when replying, so a column like"],
    ["", "", "emi_amount or due_date lets it answer questions about that contact."],
    ["", "", "Columns you leave out are things the AI cannot answer about."],
    ["", "", ""],
    ["Country codes"],
    [codeNote],
    ["", "", ""],
    ["Notes"],
    ["The first row must be the column headers. Do not add a title row above it."],
    ["Rows with no phone number, or numbers already in this group, are skipped."],
    ["You will see exactly what will be imported, and what will be skipped, before anything is saved."],
    ["The sheet name does not matter — you will be asked which sheet to read if there is more than one."],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 72 }];
  return sheet;
}

function contactsSheet(): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet([CONTACT_HEADERS, ...SAMPLE_ROWS]);

  // Force the phone column to Text so Excel never reinterprets it as a number.
  for (let row = 1; row <= SAMPLE_ROWS.length; row++) {
    const address = XLSX.utils.encode_cell({ r: row, c: 0 });
    const cell = sheet[address];
    if (cell) {
      cell.t = "s";
      cell.z = "@";
    }
  }

  sheet["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
  return sheet;
}

/** Build and download the sample workbook. */
export function downloadContactSampleWorkbook(defaultCountryCode: string | null): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, contactsSheet(), "Contacts");
  XLSX.utils.book_append_sheet(workbook, instructionSheet(defaultCountryCode), "How to fill this in");
  XLSX.writeFile(workbook, "contact-import-sample.xlsx");
}
