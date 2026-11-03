import path from "path";
import type OpenAI from "openai";
import { createOpenAI, OPENAI_TIMEOUTS } from "../lib/openaiClient";
import { storage } from "../storage";
import { renderPdfPagesToJpegs } from "./pdfRenderer";
import {
  invoiceReadChecks,
  isCurrency,
  isIsoDate,
  resolveBank,
  resolveLines,
  resolveParty,
  type InvoiceReadResult,
  type InvoiceTaxMode,
} from "@shared/invoice";

/**
 * Reads an existing invoice (PDF or photo) with AI for super admin › Invoices & billing:
 * who issued it, its bank details, who it's billed to, number, dates, lines, tax, notes.
 * The text layer and page pictures both go to the model (text for exact figures, pictures for
 * layout). Nothing is saved here; the pages show what was found and the person applies it.
 */

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const MAX_PAGES = 3;
const MAX_TEXT_CHARS = 20_000;

export class InvoiceReadError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** The platform's AI key: AI providers' primary key when switched on, else the server key, else any saved key. */
async function aiClient(): Promise<{ client: OpenAI; model: string }> {
  const master = await storage.getMasterAiSettings().catch(() => null);
  const pick = (provider: string, apiKey: string, model: string) => ({
    client: createOpenAI({
      apiKey, timeout: OPENAI_TIMEOUTS.document, feature: "invoice_reader", category: "document_analysis",
      ...(provider === "gemini" ? { baseURL: GEMINI_BASE_URL } : {}),
    }),
    // Figures matter here, so the full model on OpenAI; Gemini uses the model set for it.
    model: provider === "gemini" ? model : "gpt-4o",
  });
  if (master?.masterEnabled && master.primaryApiKey) return pick(master.primaryProvider || "openai", master.primaryApiKey, master.primaryModel);
  if (process.env.OPENAI_API_KEY) return pick("openai", process.env.OPENAI_API_KEY, "gpt-4o");
  if (master?.primaryApiKey) return pick(master.primaryProvider || "openai", master.primaryApiKey, master.primaryModel);
  if (master?.fallbackApiKey) return pick(master.fallbackProvider || "gemini", master.fallbackApiKey, master.fallbackModel);
  throw new InvoiceReadError("No AI key is set up. Add one under Platform › AI providers.", 503);
}

async function pdfText(buffer: Buffer): Promise<string> {
  try {
    const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/"),
      verbosity: 0,
    }).promise;
    let text = "";
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      // Keep the line structure: pdf.js marks the end of each printed line.
      text += content.items.map((i: any) => `${i.str}${i.hasEOL ? "\n" : " "}`).join("") + "\n\n";
    }
    return text.slice(0, MAX_TEXT_CHARS);
  } catch (e) {
    console.warn("[InvoiceReader] PDF text failed:", (e as Error).message);
    return "";
  }
}

const PARTY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    address: { type: "string", description: "Street lines only, joined with \\n; not the state, country or PIN" },
    state: { type: "string" },
    stateCode: { type: "string", description: "GST state code, e.g. 09; the first two digits of the GSTIN when not printed" },
    country: { type: "string" },
    pinCode: { type: "string" },
    gstin: { type: "string" },
    pan: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    extra: {
      type: "array",
      description: "Other IDs printed for this party (CIN, VAT, TRN, LUT…)",
      items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] },
    },
  },
  required: ["name", "address", "state", "stateCode", "country", "pinCode", "gstin", "pan", "email", "phone", "extra"],
} as const;

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    invoiceNumber: { type: "string" },
    invoiceDate: { type: "string", description: "YYYY-MM-DD or empty" },
    dueDate: { type: "string", description: "YYYY-MM-DD or empty" },
    periodStart: { type: "string", description: "Billing period start, YYYY-MM-DD, only when printed" },
    periodEnd: { type: "string", description: "Billing period end, YYYY-MM-DD, only when printed" },
    currency: { type: "string", description: "ISO code, e.g. INR, USD" },
    seller: PARTY_SCHEMA,
    bank: {
      type: "object",
      additionalProperties: false,
      properties: {
        accountName: { type: "string" },
        bankName: { type: "string" },
        accountNumber: { type: "string" },
        ifsc: { type: "string" },
        extra: {
          type: "array",
          description: "Other payment rows: SWIFT, branch, UPI ID, account type…",
          items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] },
        },
      },
      required: ["accountName", "bankName", "accountNumber", "ifsc", "extra"],
    },
    billedTo: PARTY_SCHEMA,
    placeOfSupply: { type: "string", description: "As printed, e.g. Uttar Pradesh (09)" },
    countryOfSupply: { type: "string" },
    taxType: { type: "string", enum: ["cgst_sgst", "igst", "other", "none"] },
    taxName: { type: "string", description: "Name of the tax when taxType is other (VAT, GST…)" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          item: { type: "string", description: "First line of the item name" },
          description: { type: "string", description: "The rest of the item text, without the HSN/SAC" },
          hsn: { type: "string" },
          qty: { type: "number" },
          rate: { type: "number", description: "Unit price before tax" },
          taxRate: { type: "number", description: "Total tax % on the line (CGST 9% + SGST 9% = 18)" },
        },
        required: ["item", "description", "hsn", "qty", "rate", "taxRate"],
      },
    },
    notes: { type: "string", description: "Notes section, one paragraph per line" },
    terms: { type: "string", description: "Terms and conditions, one per line" },
    printedTotal: { type: "number", description: "Grand total printed on the invoice; 0 if none" },
  },
  required: [
    "invoiceNumber", "invoiceDate", "dueDate", "periodStart", "periodEnd", "currency", "seller", "bank", "billedTo",
    "placeOfSupply", "countryOfSupply", "taxType", "taxName", "lines", "notes", "terms", "printedTotal",
  ],
} as const;

const INSTRUCTIONS = `You read business invoices and copy out their details exactly as printed.
- "seller" is the company that issued the invoice (Billed by / From / Supplier / Vendor). "billedTo" is the customer.
- Copy text exactly; never invent. Use an empty string (or an empty list) when something isn't on the invoice.
- Dates as YYYY-MM-DD. Indian invoices write dates day first (01/11/2026 = 1 November 2026).
- Addresses: only street lines in "address" (one per printed line, joined with \\n); the state, country and PIN go in their own fields.
- Lines: one entry per invoice row. qty and rate as plain numbers (no currency signs or commas). taxRate is the total tax percent on the row.
- taxType: cgst_sgst when CGST and SGST are charged, igst for IGST, other for any other tax (put its name in taxName), none when there is no tax.
- Ignore page footers like "page 1 of 2". printedTotal is the final amount payable.`;

/** Reads one invoice file. `dataUrl` is the uploaded file as a data: URL (PDF, JPG, PNG or WebP). */
export async function readInvoiceFile(dataUrl: string): Promise<InvoiceReadResult> {
  const m = /^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new InvoiceReadError("Upload a PDF, JPG, PNG or WebP file");
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > 10 * 1024 * 1024) throw new InvoiceReadError("The file must be 10 MB or smaller");
  // Before the work of opening the file, so a missing key is reported at once.
  const { client, model } = await aiClient();

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  if (m[1] === "application/pdf") {
    const text = await pdfText(buffer);
    let pages: { jpegBuffer: Buffer }[] = [];
    try {
      pages = await renderPdfPagesToJpegs(buffer, { maxPages: MAX_PAGES, scale: 1.6 });
    } catch (e) {
      console.warn("[InvoiceReader] PDF pages failed:", (e as Error).message);
    }
    if (!text.trim() && !pages.length) throw new InvoiceReadError("This PDF couldn't be opened. If it has a password, remove it and try again.");
    if (text.trim()) content.push({ type: "text", text: `Text of the invoice (from the PDF):\n\n${text}` });
    for (const p of pages) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${p.jpegBuffer.toString("base64")}`, detail: "high" } });
  } else {
    content.push({ type: "image_url", image_url: { url: dataUrl, detail: "high" } });
  }
  content.push({ type: "text", text: "Copy out this invoice's details." });

  const started = Date.now();
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: INSTRUCTIONS }, { role: "user", content }],
    response_format: { type: "json_schema", json_schema: { name: "invoice", strict: true, schema: RESULT_SCHEMA as unknown as Record<string, unknown> } },
  });
  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new InvoiceReadError("The AI didn't return anything. Please try again.", 502);
  console.log(`[InvoiceReader] read with ${model} in ${Date.now() - started} ms`);
  let o: any;
  try { o = JSON.parse(raw); } catch { throw new InvoiceReadError("The AI's answer couldn't be read. Please try again.", 502); }
  return toResult(o);
}

/** Cleans the model's answer into our shapes (exported for tests). */
export function toResult(o: any): InvoiceReadResult {
  const date = (v: unknown) => (isIsoDate(v) ? v : null);
  const upper = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  const party = (v: unknown) => {
    const p = resolveParty(v);
    p.gstin = upper(p.gstin);
    p.pan = upper(p.pan);
    if (!p.stateCode && /^\d{2}/.test(p.gstin)) p.stateCode = p.gstin.slice(0, 2);
    return p;
  };
  const taxMode: InvoiceTaxMode = o?.taxType === "cgst_sgst" ? "split" : o?.taxType === "none" ? "none" : "single";
  const taxLabels: [string, string] = o?.taxType === "cgst_sgst" ? ["CGST", "SGST"]
    : o?.taxType === "other" ? [String(o?.taxName || "Tax").slice(0, 20), "SGST"] : ["IGST", "SGST"];
  const bank = resolveBank(o?.bank);
  bank.ifsc = upper(bank.ifsc);
  const currency = typeof o?.currency === "string" && isCurrency(o.currency.toUpperCase()) ? o.currency.toUpperCase() : null;
  const printed = typeof o?.printedTotal === "number" && o.printedTotal > 0 ? Math.round(o.printedTotal * 100) / 100 : null;
  const base = {
    number: String(o?.invoiceNumber ?? "").trim().slice(0, 60),
    invoiceDate: date(o?.invoiceDate), dueDate: date(o?.dueDate),
    periodStart: date(o?.periodStart), periodEnd: date(o?.periodEnd),
    currency,
    seller: party(o?.seller), bank, billedTo: party(o?.billedTo),
    placeOfSupply: String(o?.placeOfSupply ?? "").slice(0, 120),
    countryOfSupply: String(o?.countryOfSupply ?? "").slice(0, 80),
    taxMode, taxLabels,
    lines: resolveLines(o?.lines).map(l => ({ ...l, taxRate: taxMode === "none" ? 0 : l.taxRate })),
    notes: String(o?.notes ?? "").slice(0, 4000),
    terms: String(o?.terms ?? "").slice(0, 4000),
    printedTotal: printed,
  };
  return { ...base, checks: invoiceReadChecks(base) };
}
