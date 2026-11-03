import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  INVOICE_CURRENCIES, INVOICE_STATUS_LABEL, computeInvoiceTotals, formatInvoiceMoney,
  type InvoiceBank, type InvoiceLine, type InvoiceParty, type InvoiceStatus, type InvoiceTaxMode,
} from "@shared/invoice";

/** Form pieces shared by the billing pages (our details, billing list, invoice editor). */

export function Field({ label, hint, children, className = "" }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-[13px]">{label}</Label>
      {children}
      {hint && <p className="text-[12px] text-gray-500">{hint}</p>}
    </div>
  );
}

const toNum = (v: string): number => (v.trim() === "" ? 0 : Number(v));

function ExtraRows({ rows, onChange, placeholder, testId }: {
  rows: { label: string; value: string }[];
  onChange: (rows: { label: string; value: string }[]) => void;
  placeholder: string;
  testId: string;
}) {
  return (
    <div className="space-y-2 sm:col-span-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input className="w-40" value={r.label} placeholder="Label" onChange={e => onChange(rows.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
          <Input value={r.value} placeholder="Value" onChange={e => onChange(rows.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove row"><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" className="text-violet-700" onClick={() => onChange([...rows, { label: "", value: "" }])} data-testid={testId}>
        <Plus className="mr-1 h-4 w-4" />{placeholder}
      </Button>
    </div>
  );
}

/** Name, address, state, tax IDs and contact of a company. */
export function PartyFields({ value, onChange, idPrefix }: { value: InvoiceParty; onChange: (p: InvoiceParty) => void; idPrefix: string }) {
  const set = <K extends keyof InvoiceParty>(k: K, v: InvoiceParty[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Company name" className="sm:col-span-2">
        <Input value={value.name} onChange={e => set("name", e.target.value)} data-testid={`${idPrefix}-name`} />
      </Field>
      <Field label="Address" className="sm:col-span-2" hint="One line per row. State and country are added below it.">
        <Textarea rows={3} value={value.address} onChange={e => set("address", e.target.value)} data-testid={`${idPrefix}-address`} />
      </Field>
      <div className="grid grid-cols-[1fr_80px] gap-3">
        <Field label="State">
          <Input value={value.state} onChange={e => set("state", e.target.value)} placeholder="Uttar Pradesh" data-testid={`${idPrefix}-state`} />
        </Field>
        <Field label="Code">
          <Input value={value.stateCode} onChange={e => set("stateCode", e.target.value)} placeholder="09" data-testid={`${idPrefix}-state-code`} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country">
          <Input value={value.country} onChange={e => set("country", e.target.value)} data-testid={`${idPrefix}-country`} />
        </Field>
        <Field label="PIN code">
          <Input value={value.pinCode} onChange={e => set("pinCode", e.target.value)} data-testid={`${idPrefix}-pin`} />
        </Field>
      </div>
      <Field label="GSTIN"><Input value={value.gstin} onChange={e => set("gstin", e.target.value.toUpperCase())} data-testid={`${idPrefix}-gstin`} /></Field>
      <Field label="PAN"><Input value={value.pan} onChange={e => set("pan", e.target.value.toUpperCase())} data-testid={`${idPrefix}-pan`} /></Field>
      <Field label="Email"><Input value={value.email} onChange={e => set("email", e.target.value)} data-testid={`${idPrefix}-email`} /></Field>
      <Field label="Phone"><Input value={value.phone} onChange={e => set("phone", e.target.value)} data-testid={`${idPrefix}-phone`} /></Field>
      <ExtraRows rows={value.extra} onChange={rows => set("extra", rows)} placeholder="Add another tax ID or line (CIN, VAT…)" testId={`${idPrefix}-add-extra`} />
    </div>
  );
}

export function BankFields({ value, onChange }: { value: InvoiceBank; onChange: (b: InvoiceBank) => void }) {
  const set = <K extends keyof InvoiceBank>(k: K, v: InvoiceBank[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Account name"><Input value={value.accountName} onChange={e => set("accountName", e.target.value)} data-testid="bank-account-name" /></Field>
      <Field label="Bank"><Input value={value.bankName} onChange={e => set("bankName", e.target.value)} data-testid="bank-name" /></Field>
      <Field label="Account number"><Input value={value.accountNumber} onChange={e => set("accountNumber", e.target.value)} data-testid="bank-account-number" /></Field>
      <Field label="IFSC"><Input value={value.ifsc} onChange={e => set("ifsc", e.target.value.toUpperCase())} data-testid="bank-ifsc" /></Field>
      <ExtraRows rows={value.extra} onChange={rows => set("extra", rows)} placeholder="Add a row (SWIFT, branch, UPI…)" testId="bank-add-extra" />
    </div>
  );
}

export function CurrencySelect({ value, onChange, testId = "select-currency" }: { value: string; onChange: (c: string) => void; testId?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        {INVOICE_CURRENCIES.map(c => <SelectItem key={c.code} value={c.code}>{c.code} ({c.symbol.trim()})</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function blankLine(hsn: string, taxRate: number): InvoiceLine {
  return { item: "", description: "", hsn, qty: 1, rate: 0, taxRate };
}

/** Invoice lines: item, second line, HSN/SAC, tax rate, quantity and rate, with each line's total. */
export function LinesEditor({ lines, onChange, currency, taxMode, defaults }: {
  lines: InvoiceLine[];
  /** Gets an update of the latest lines, so quick successive edits never undo each other. */
  onChange: (update: (prev: InvoiceLine[]) => InvoiceLine[]) => void;
  currency: string;
  taxMode: InvoiceTaxMode;
  defaults: { hsn: string; taxRate: number };
}) {
  const totals = computeInvoiceTotals(lines, taxMode);
  const set = (i: number, patch: Partial<InvoiceLine>) => onChange(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-3">
      {lines.map((l, i) => (
        <div key={i} className="rounded-xl border border-black/[0.06] bg-gray-50/60 p-3" data-testid={`line-${i}`}>
          <div className="flex items-start gap-2">
            <span className="mt-2 w-5 text-[13px] text-gray-500">{i + 1}.</span>
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <Input value={l.item} placeholder="Item, e.g. Public Chat Development" onChange={e => set(i, { item: e.target.value })} data-testid={`line-${i}-item`} />
              <Input value={l.description} placeholder="Second line (optional)" onChange={e => set(i, { description: e.target.value })} data-testid={`line-${i}-description`} />
            </div>
            <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => onChange(prev => prev.filter((_, j) => j !== i))} aria-label="Remove line" data-testid={`line-${i}-remove`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="ml-7 mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <label className="text-[11px] text-gray-500">HSN/SAC<Input className="mt-0.5" value={l.hsn} onChange={e => set(i, { hsn: e.target.value })} data-testid={`line-${i}-hsn`} /></label>
            <label className="text-[11px] text-gray-500">Tax rate %<Input className="mt-0.5" type="number" min={0} max={100} step="0.01" value={String(l.taxRate)} disabled={taxMode === "none"} onChange={e => set(i, { taxRate: toNum(e.target.value) })} data-testid={`line-${i}-tax`} /></label>
            <label className="text-[11px] text-gray-500">Qty<Input className="mt-0.5" type="number" step="any" value={String(l.qty)} onChange={e => set(i, { qty: toNum(e.target.value) })} data-testid={`line-${i}-qty`} /></label>
            <label className="text-[11px] text-gray-500">Rate<Input className="mt-0.5" type="number" step="any" value={String(l.rate)} onChange={e => set(i, { rate: toNum(e.target.value) })} data-testid={`line-${i}-rate`} /></label>
            <div className="text-[11px] text-gray-500">Line total<p className="mt-2 text-[14px] font-semibold tabular-nums text-gray-900">{formatInvoiceMoney(totals.lines[i]?.total ?? 0, currency)}</p></div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(prev => [...prev, blankLine(defaults.hsn, defaults.taxRate)])} data-testid="button-add-line">
        <Plus className="mr-1 h-4 w-4" />Add line
      </Button>
    </div>
  );
}

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-sky-50 text-sky-700",
  paid: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

export function InvoiceStatusPill({ status, overdue }: { status: InvoiceStatus; overdue?: boolean }) {
  if (status === "sent" && overdue) {
    return <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Payment overdue</span>;
  }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}>{INVOICE_STATUS_LABEL[status]}</span>;
}
