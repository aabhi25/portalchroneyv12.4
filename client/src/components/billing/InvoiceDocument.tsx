import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  amountInWords,
  computeInvoiceTotals,
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoiceNumber,
  formatPeriod,
  invoiceCurrency,
  lineTaxRateLabel,
  type InvoiceDto,
  type InvoiceParty,
} from "@shared/invoice";

/**
 * The invoice itself, laid out like our reference (Jaro, Sept–Oct 2026). Inline styles only, so the
 * same markup shows in the preview and prints on its own in a blank frame (printInvoice) as an A4 PDF.
 */

const INK = "#1f2937";
const MUTED = "#4b5563";
const SOFT = "#6b7280";
const LINE = "#e5e7eb";
const HEAD = "#111827";
const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";

const s = {
  page: { fontFamily: FONT, color: INK, background: "#fff", fontSize: 13, lineHeight: 1.45, padding: "22px 40px 24px", boxSizing: "border-box", width: "100%" } as CSSProperties,
  label: { color: SOFT, fontSize: 13 } as CSSProperties,
  value: { fontWeight: 700, fontSize: 14, color: HEAD } as CSSProperties,
  heading: (accent: string): CSSProperties => ({ color: accent, fontWeight: 700, fontSize: 11.5, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 6px" }),
  name: { fontWeight: 700, fontSize: 16.5, color: HEAD, margin: "0 0 6px", textTransform: "uppercase", wordBreak: "break-word" } as CSSProperties,
  addr: { color: MUTED, margin: "0 0 8px", whiteSpace: "pre-line", lineHeight: 1.55 } as CSSProperties,
  hr: { border: 0, borderTop: `1px solid ${LINE}`, margin: "12px 0" } as CSSProperties,
  th: { padding: "10px 8px", fontWeight: 500, fontSize: 13, textAlign: "left", verticalAlign: "middle" } as CSSProperties,
  td: { padding: "9px 8px 6px", verticalAlign: "top", fontSize: 12, color: INK } as CSSProperties,
};

function KeyVal({ k, v }: { k: string; v: string }) {
  if (!v.trim()) return null;
  return <div style={{ color: MUTED }}><b style={{ color: INK, fontWeight: 600 }}>{k}:</b> {v}</div>;
}

function PartyBlock({ title, party, accent, aligned }: { title: string; party: InvoiceParty; accent: string; aligned?: boolean }) {
  const ids: [string, string][] = [
    ["GSTIN", party.gstin], ["PAN", party.pan], ["Email", party.email], ["Phone", party.phone],
    ...party.extra.map(e => [e.label, e.value] as [string, string]),
  ];
  const address = [party.address.trim(), [party.state, [party.country, party.pinCode].filter(Boolean).join(" - ")].filter(Boolean).join(", ")]
    .filter(Boolean).join("\n");
  return (
    <div>
      <p style={s.heading(accent)}>{title}</p>
      <p style={s.name}>{party.name || "—"}</p>
      {address && <p style={s.addr}>{address}</p>}
      {aligned ? (
        <table style={{ borderCollapse: "collapse", color: MUTED }}>
          <tbody>
            {ids.filter(([, v]) => v.trim()).map(([k, v]) => (
              <tr key={k}><td style={{ padding: "3px 18px 3px 0", fontWeight: 600, color: INK, verticalAlign: "top" }}>{k}:</td><td style={{ padding: "3px 0" }}>{v}</td></tr>
            ))}
          </tbody>
        </table>
      ) : ids.map(([k, v]) => <KeyVal key={k} k={k} v={v} />)}
    </div>
  );
}

function Money({ amount, code, bold }: { amount: number; code: string; bold?: boolean }) {
  return <span style={{ fontWeight: bold ? 700 : 400, whiteSpace: "nowrap" }}>{formatInvoiceMoney(amount, code)}</span>;
}

function Paragraphs({ text, style }: { text: string; style?: CSSProperties }) {
  const parts = text.split(/\n+/).map(t => t.trim()).filter(Boolean);
  return <>{parts.map((p, i) => <p key={i} style={{ margin: "0 0 8px", fontSize: 14, color: "#374151", ...style }}>{p}</p>)}</>;
}

export function InvoiceDocument({ invoice }: { invoice: InvoiceDto }) {
  const { options: o, currency } = invoice;
  const accent = o.accent;
  const totals = computeInvoiceTotals(invoice.lines, o.taxMode, o.roundTotal);
  const taxCols = o.taxMode === "split" ? [o.taxLabels[0], o.taxLabels[1]] : o.taxMode === "single" ? [o.taxLabels[0]] : [];
  const rateHead = o.taxMode === "none" ? null : (/gst/i.test(taxCols.join("")) ? "GST Rate" : "Tax Rate");
  const period = formatPeriod(invoice.periodStart, invoice.periodEnd);
  const bank = invoice.seller.bank;
  const bankRows: [string, string][] = [
    ["A/C Name", bank.accountName], ["Bank", bank.bankName], ["A/C No", bank.accountNumber], ["IFSC", bank.ifsc],
    ...bank.extra.map(e => [e.label, e.value] as [string, string]),
  ].filter(([, v]) => v.trim()) as [string, string][];
  const meta: [string, string][] = [
    ["Invoice No", invoice.number], ["Invoice Date", formatInvoiceDate(invoice.invoiceDate)],
    ["Due Date", formatInvoiceDate(invoice.dueDate)], ["Billing Period", period],
  ].filter(([, v]) => v) as [string, string][];
  const summary: [string, number][] = [["Amount", totals.amount]];
  if (taxCols[0]) summary.push([taxCols[0], totals.tax1]);
  if (taxCols[1]) summary.push([taxCols[1], totals.tax2]);
  if (o.roundTotal && totals.roundOff !== 0) summary.push(["Round off", totals.roundOff]);

  return (
    <div style={s.page} data-testid="invoice-document">
      {/* Title, number, dates and logo */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
        <div>
          <h1 style={{ fontSize: 38, fontWeight: 300, color: "#374151", margin: "0 0 8px", letterSpacing: "-0.01em" }}>{o.title}</h1>
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {meta.map(([k, v]) => (
                <tr key={k}><td style={{ ...s.label, padding: "2px 36px 2px 0" }}>{k}</td><td style={{ ...s.value, padding: "2px 0" }}>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {invoice.seller.logoData && <img src={invoice.seller.logoData} alt="" style={{ maxHeight: 118, maxWidth: 200, objectFit: "contain" }} />}
      </div>
      <hr style={s.hr} />

      {/* Billed by + bank / billed to */}
      <div style={{ display: "flex", gap: 40 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PartyBlock title="Billed by" party={invoice.seller.party} accent={accent} />
          {bankRows.length > 0 && (
            <>
              <hr style={{ ...s.hr, margin: "10px 0" }} />
              <p style={s.heading(accent)}>Bank details</p>
              {bankRows.map(([k, v]) => <KeyVal key={k} k={k} v={v} />)}
            </>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PartyBlock title="Billed to" party={invoice.billedTo} accent={accent} aligned />
        </div>
      </div>
      <hr style={{ ...s.hr, margin: "12px -40px 10px" }} />

      {(invoice.countryOfSupply || invoice.placeOfSupply) && (
        <div style={{ display: "flex", justifyContent: "center", gap: 28, fontSize: 14, marginBottom: 12 }}>
          {invoice.countryOfSupply && <span><span style={{ color: SOFT, marginRight: 18 }}>Country of Supply:</span><b>{invoice.countryOfSupply}</b></span>}
          {invoice.placeOfSupply && <span><span style={{ color: SOFT, marginRight: 18 }}>Place of Supply:</span><b>{invoice.placeOfSupply}</b></span>}
        </div>
      )}

      {/* Lines */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: HEAD, color: "#fff" }}>
            <th style={{ ...s.th, width: 28 }}>#</th>
            <th style={s.th}>Item</th>
            {rateHead && <th style={{ ...s.th, width: 44 }}>{rateHead.split(" ")[0]}<br />{rateHead.split(" ")[1]}</th>}
            <th style={{ ...s.th, width: 44 }}>Qty</th>
            <th style={s.th}>Rate</th>
            <th style={{ ...s.th, textAlign: "right" }}>Amount</th>
            {taxCols.map(c => <th key={c} style={{ ...s.th, textAlign: "right" }}>{c}</th>)}
            <th style={{ ...s.th, textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l, i) => {
            const t = totals.lines[i];
            return (
              <tr key={i} style={{ borderBottom: `1px solid ${LINE}`, pageBreakInside: "avoid" }}>
                <td style={{ ...s.td, fontSize: 13 }}>{i + 1}.</td>
                <td style={{ ...s.td, maxWidth: 160 }}>
                  <div style={{ whiteSpace: "pre-line" }}>{l.item}</div>
                  {l.description && <div style={{ whiteSpace: "pre-line" }}>{l.description}</div>}
                  {o.showHsn && l.hsn && <div style={{ color: SOFT, fontSize: 11, marginTop: 6 }}>HSN/SAC: {l.hsn}</div>}
                </td>
                {rateHead && <td style={{ ...s.td, fontSize: 13 }}>{formatInvoiceNumber(l.taxRate, currency)}</td>}
                <td style={{ ...s.td, fontSize: 13 }}>{formatInvoiceNumber(l.qty, currency)}</td>
                <td style={{ ...s.td, fontSize: 13 }}>{formatInvoiceNumber(l.rate, currency)}</td>
                <td style={{ ...s.td, textAlign: "right", color: MUTED }}><Money amount={t.amount} code={currency} /></td>
                {taxCols[0] && <td style={{ ...s.td, textAlign: "right", color: MUTED }} title={lineTaxRateLabel(l.taxRate, o.taxMode)}><Money amount={t.tax1} code={currency} /></td>}
                {taxCols[1] && <td style={{ ...s.td, textAlign: "right", color: MUTED }}><Money amount={t.tax2} code={currency} /></td>}
                <td style={{ ...s.td, textAlign: "right" }}><Money amount={t.total} code={currency} bold /></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals and amount in words */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, marginTop: 10, pageBreakInside: "avoid" }}>
        <div style={{ flex: 1, paddingTop: 8 }}>
          {o.showAmountInWords && (
            <>
              <p style={{ ...s.label, margin: "0 0 4px" }}>Total (in words)</p>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 13.5, color: HEAD }} data-testid="invoice-amount-words">{amountInWords(totals.total, currency)}</p>
            </>
          )}
        </div>
        <div style={{ width: 366, border: `1px solid ${LINE}`, borderRadius: 8, overflow: "hidden" }}>
          {summary.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "9px 22px", borderBottom: `1px solid ${LINE}`, fontSize: 14 }}>
              <span>{k}</span><Money amount={v} code={currency} bold />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 22px", fontSize: 14, color: MUTED }} data-testid="invoice-total">
            <b>Total ({invoiceCurrency(currency).code})</b><Money amount={totals.total} code={currency} bold />
          </div>
        </div>
      </div>

      {/* Notes, terms, signature, footer */}
      <div style={{ marginTop: 28 }}>
        {invoice.notes.trim() && (
          <Section title="Notes" accent={accent}><Paragraphs text={invoice.notes} /></Section>
        )}
        {invoice.terms.trim() && (
          <Section title="Terms and conditions" accent={accent}><Paragraphs text={invoice.terms} style={{ fontSize: 14.5 }} /></Section>
        )}
        {o.showSignature && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, pageBreakInside: "avoid" }}>
            <div style={{ textAlign: "center", minWidth: 220 }}>
              <p style={{ margin: "0 0 52px", fontWeight: 600 }}>For {invoice.seller.party.name}</p>
              <p style={{ margin: 0, borderTop: `1px solid ${SOFT}`, paddingTop: 6, color: MUTED }}>{o.signatureLabel}</p>
            </div>
          </div>
        )}
        {o.footer.trim() && (
          <>
            <hr style={{ ...s.hr, margin: "22px -22px 18px" }} />
            <p style={{ textAlign: "center", color: MUTED, margin: 0, fontSize: 13 }}>{o.footer}</p>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18, pageBreakInside: "avoid" }}>
      <p style={{ ...s.heading(accent), fontSize: 14, letterSpacing: 0, marginBottom: 12 }}>{title}</p>
      {children}
    </div>
  );
}

const escapeHtml = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** A file name for the PDF: "INVJ092026-01". */
export function invoiceFileName(number: string): string {
  return number.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Invoice";
}

/**
 * Opens the browser's print window with only the invoice, on A4, so it can be saved as a PDF.
 * The page title becomes the suggested file name.
 */
export function printInvoice(invoice: InvoiceDto): void {
  const body = renderToStaticMarkup(<InvoiceDocument invoice={invoice} />);
  const name = invoiceFileName(invoice.number);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title><style>
    @page { size: A4; margin: 8mm 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style></head><body>${body}</body></html>`);
  doc.close();
  const pageTitle = document.title;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.title = pageTitle;
    frame.remove();
  };
  const go = () => {
    document.title = name; // some browsers name the PDF after the top page
    const w = frame.contentWindow!;
    w.addEventListener("afterprint", () => setTimeout(cleanup, 500));
    setTimeout(cleanup, 5 * 60_000);
    w.focus();
    w.print();
  };
  const images = Array.from(doc.images).filter(i => !i.complete);
  if (!images.length) setTimeout(go, 50);
  else Promise.all(images.map(i => new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(go, 50));
}
