import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  INVOICE_READ_SECTIONS, computeInvoiceTotals, formatInvoiceDate, formatInvoiceMoney, formatPeriod,
  type InvoiceParty, type InvoiceReadResult, type InvoiceReadSection,
} from "@shared/invoice";

const MAX_BYTES = 10 * 1024 * 1024;

/** A button that opens ReadInvoiceDialog. */
export function ReadInvoiceButton({ sections, onApply, label = "Fill from a PDF", variant = "outline", testId = "button-read-invoice", startOpen = false }: {
  sections: InvoiceReadSection[];
  onApply: (r: InvoiceReadResult, chosen: Set<InvoiceReadSection>) => void;
  label?: string;
  variant?: "outline" | "default" | "ghost";
  testId?: string;
  /** Open the dialog straight away (e.g. arriving from "Read an invoice" on the list). */
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)} data-testid={testId}><Sparkles className="mr-1 h-4 w-4" />{label}</Button>
      {open && <ReadInvoiceDialog sections={sections} onApply={onApply} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Upload an invoice (PDF or photo); AI reads its details; the person ticks what to fill in.
 * Nothing is saved until they save the page it fills.
 */
export function ReadInvoiceDialog({ sections, onApply, onClose }: {
  sections: InvoiceReadSection[];
  onApply: (r: InvoiceReadResult, chosen: Set<InvoiceReadSection>) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InvoiceReadResult | null>(null);
  const [chosen, setChosen] = useState<Set<InvoiceReadSection>>(new Set(sections));

  const read = (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)) return setError("Upload a PDF, JPG, PNG or WebP file.");
    if (file.size > MAX_BYTES) return setError("The file must be 10 MB or smaller.");
    setFileName(file.name);
    setReading(true);
    setResult(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await apiRequest<{ result: InvoiceReadResult }>("POST", "/api/super-admin/billing/read-invoice", { file: String(reader.result), name: file.name });
        setResult(r.result);
      } catch (e) {
        setError((e as Error).message.replace(/^\d+:\s*/, ""));
      } finally {
        setReading(false);
      }
    };
    reader.onerror = () => { setReading(false); setError("The file couldn't be opened."); };
    reader.readAsDataURL(file);
  };

  const toggle = (k: InvoiceReadSection, on: boolean) => setChosen(prev => {
    const next = new Set(prev);
    if (on) next.add(k); else next.delete(k);
    return next;
  });
  const code = result?.currency ?? "INR";

  return (
    <Dialog open onOpenChange={o => { if (!o && !reading) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-600" />Fill from an invoice</DialogTitle>
          <DialogDescription>Upload an invoice PDF (or a photo of one). AI reads the company, bank, customer, lines and dates; you choose what to fill in and can check everything before saving.</DialogDescription>
        </DialogHeader>

        <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={e => { read(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-read-invoice-file" />
        {!result && (
          <button
            type="button"
            disabled={reading}
            onClick={() => input.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); read(e.dataTransfer.files?.[0]); }}
            className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-black/10 bg-gray-50 px-4 py-10 text-center hover:border-violet-300 hover:bg-violet-50/40"
          >
            {reading ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-violet-600" />
                <p className="text-[14px] font-medium text-gray-900">Reading {fileName}…</p>
                <p className="text-[12px] text-gray-500">This usually takes 10 to 30 seconds.</p>
              </>
            ) : (
              <>
                <FileUp className="h-7 w-7 text-gray-400" />
                <p className="text-[14px] font-medium text-gray-900">Choose an invoice, or drop it here</p>
                <p className="text-[12px] text-gray-500">PDF, JPG, PNG or WebP, up to 10 MB</p>
              </>
            )}
          </button>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700" data-testid="text-read-error">{error}</p>}

        {result && (
          <div className="space-y-4" data-testid="read-invoice-result">
            <div className="space-y-1.5">
              {result.checks.map((c, i) => (
                <p key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] ${c.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                  {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}{c.text}
                </p>
              ))}
            </div>
            <p className="text-[13px] text-gray-600">Tick what to fill in from <b>{fileName}</b>:</p>
            <div className="space-y-2">
              {INVOICE_READ_SECTIONS.filter(s => sections.includes(s.key)).map(s => (
                <label key={s.key} className="flex cursor-pointer gap-3 rounded-xl border border-black/[0.06] p-3 hover:bg-gray-50">
                  <Checkbox checked={chosen.has(s.key)} onCheckedChange={v => toggle(s.key, v === true)} className="mt-0.5" data-testid={`check-read-${s.key}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-gray-900">{s.label}</p>
                    <div className="mt-1 text-[12.5px] text-gray-600">{summary(s.key, result, code)}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {result && <Button type="button" variant="ghost" onClick={() => { setResult(null); input.current?.click(); }}>Use another file</Button>}
          <Button type="button" variant="outline" onClick={onClose} disabled={reading}>Cancel</Button>
          {result && (
            <Button type="button" disabled={chosen.size === 0} onClick={() => { onApply(result, chosen); onClose(); }} data-testid="button-apply-read">
              Fill in
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function partyLine(p: InvoiceParty): ReactNode {
  if (!p.name) return <span className="text-gray-400">Not found</span>;
  const ids = [p.gstin && `GSTIN ${p.gstin}`, p.pan && `PAN ${p.pan}`].filter(Boolean).join(" · ");
  return <><b className="text-gray-800">{p.name}</b>{p.state ? `, ${p.state}` : ""}{ids ? <span className="block">{ids}</span> : null}</>;
}

function summary(k: InvoiceReadSection, r: InvoiceReadResult, code: string): ReactNode {
  switch (k) {
    case "seller": {
      const b = r.bank;
      const bank = [b.bankName, b.accountNumber && `A/C ${b.accountNumber}`, b.ifsc && `IFSC ${b.ifsc}`].filter(Boolean).join(" · ");
      return <>{partyLine(r.seller)}<span className="block">{bank || "No bank details found"}</span></>;
    }
    case "billedTo":
      return partyLine(r.billedTo);
    case "details": {
      const tax = r.taxMode === "split" ? "CGST + SGST" : r.taxMode === "single" ? r.taxLabels[0] : "No tax";
      return [
        r.number && `No. ${r.number}`,
        r.invoiceDate && `dated ${formatInvoiceDate(r.invoiceDate)}`,
        r.dueDate && `due ${formatInvoiceDate(r.dueDate)}`,
        formatPeriod(r.periodStart, r.periodEnd) && `for ${formatPeriod(r.periodStart, r.periodEnd)}`,
        r.currency, tax,
      ].filter(Boolean).join(" · ") || <span className="text-gray-400">Not found</span>;
    }
    case "lines": {
      if (!r.lines.length) return <span className="text-gray-400">Not found</span>;
      const t = computeInvoiceTotals(r.lines, r.taxMode);
      return (
        <>
          <ul className="list-inside list-disc">
            {r.lines.slice(0, 6).map((l, i) => <li key={i} className="truncate">{[l.item, l.description].filter(Boolean).join(" ")} — {l.qty} × {l.rate}</li>)}
            {r.lines.length > 6 && <li>and {r.lines.length - 6} more</li>}
          </ul>
          <span className="block">Total {formatInvoiceMoney(t.total, code)}</span>
        </>
      );
    }
    case "notes":
      return [r.notes && "Notes", r.terms && "Terms"].filter(Boolean).join(" and ") || <span className="text-gray-400">None found</span>;
  }
}
