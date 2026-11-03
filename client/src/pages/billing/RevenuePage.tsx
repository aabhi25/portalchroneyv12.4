import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, Stat } from "@/components/agency/agencyUi";
import { INVOICES_KEY } from "@/pages/billing/InvoicesListPage";
import { formatInvoiceMoney, invoiceCurrency, todayIst, type InvoiceStatus } from "@shared/invoice";

interface InvoiceRow {
  id: string;
  status: InvoiceStatus;
  billedToName: string;
  invoiceDate: string;
  currency: string;
  amount: number;
  tax: number;
  total: number;
}

/** One bucket of raised invoices: a month, a financial year or a customer. */
interface Bucket {
  key: string;
  label: string;
  count: number;
  /** Before tax. */
  amount: number;
  tax: number;
  total: number;
  paid: number;
  unpaid: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BAR = "#7c3aed";

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Indian financial year (April to March) a date falls in, by its starting year: 2027-02-10 → 2026. */
const fyOf = (date: string) => { const y = Number(date.slice(0, 4)); return Number(date.slice(5, 7)) >= 4 ? y : y - 1; };
const fyLabel = (y: number) => `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
/** The FY's twelve months, April first: "2026-04" … "2027-03". */
const fyMonths = (y: number) => Array.from({ length: 12 }, (_, i) => { const m = (i + 3) % 12; return `${m < 3 ? y + 1 : y}-${String(m + 1).padStart(2, "0")}`; });
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function emptyBucket(key: string, label: string): Bucket {
  return { key, label, count: 0, amount: 0, tax: 0, total: 0, paid: 0, unpaid: 0 };
}
function add(b: Bucket, i: InvoiceRow) {
  b.count++;
  b.amount = round2(b.amount + i.amount);
  b.tax = round2(b.tax + i.tax);
  b.total = round2(b.total + i.total);
  if (i.status === "paid") b.paid = round2(b.paid + i.total);
  else b.unpaid = round2(b.unpaid + i.total);
}

/** "₹1.2L", "₹45K", "$3.4M": short amounts for the chart's axis. */
function shortMoney(n: number, code: string): string {
  const c = invoiceCurrency(code);
  const a = Math.abs(n);
  const [v, unit] = code === "INR"
    ? a >= 1e7 ? [a / 1e7, "Cr"] : a >= 1e5 ? [a / 1e5, "L"] : a >= 1e3 ? [a / 1e3, "K"] : [a, ""]
    : a >= 1e6 ? [a / 1e6, "M"] : a >= 1e3 ? [a / 1e3, "K"] : [a, ""];
  return `${n < 0 ? "-" : ""}${c.symbol}${Number(v.toFixed(1))}${unit}`;
}

/** Super admin › Invoices & billing › Revenue: what the raised invoices add up to, by month and by year. */
export default function RevenuePage() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<{ today: string; invoices: InvoiceRow[] }>({ queryKey: INVOICES_KEY });
  const today = data?.today ?? todayIst();
  const all = data?.invoices ?? [];

  // Raised = sent or paid. Drafts aren't raised yet; cancelled ones never count.
  const raised = all.filter(i => i.status === "sent" || i.status === "paid");
  const drafts = all.filter(i => i.status === "draft").length;

  const currencies = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of raised) n.set(i.currency, (n.get(i.currency) ?? 0) + 1);
    return Array.from(n).sort((a, b) => (b[0] === "INR" ? 1 : 0) - (a[0] === "INR" ? 1 : 0) || b[1] - a[1]).map(([c]) => c);
  }, [raised]);
  const [picked, setPicked] = useState<string | null>(null);
  const currency = picked && currencies.includes(picked) ? picked : currencies[0] ?? "INR";
  const rows = raised.filter(i => i.currency === currency);

  const thisFy = fyOf(today);
  const years = useMemo(() => {
    const ys = new Set<number>([thisFy]);
    for (const i of rows) ys.add(fyOf(i.invoiceDate));
    return Array.from(ys).sort((a, b) => b - a);
  }, [rows, thisFy]);
  const [view, setView] = useState<"monthly" | "yearly">("monthly");
  const [fy, setFy] = useState(thisFy);

  const months = useMemo(() => {
    const list = fyMonths(fy).map(ym => emptyBucket(ym, monthLabel(ym)));
    for (const i of rows) { const b = list.find(x => x.key === i.invoiceDate.slice(0, 7)); if (b) add(b, i); }
    return list;
  }, [rows, fy]);
  const yearly = useMemo(() => years.slice().reverse().map(y => {
    const b = emptyBucket(String(y), fyLabel(y));
    for (const i of rows) if (fyOf(i.invoiceDate) === y) add(b, i);
    return b;
  }), [rows, years]);
  const buckets = view === "monthly" ? months : yearly;

  const inScope = view === "monthly" ? rows.filter(i => fyOf(i.invoiceDate) === fy) : rows;
  const customers = useMemo(() => {
    const m = new Map<string, Bucket>();
    for (const i of inScope) {
      const name = i.billedToName || "No name";
      const b = m.get(name) ?? emptyBucket(name, name);
      add(b, i);
      m.set(name, b);
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
  }, [inScope]);

  const sum = (list: InvoiceRow[]) => { const b = emptyBucket("", ""); list.forEach(i => add(b, i)); return b; };
  const monthNow = sum(rows.filter(i => i.invoiceDate.slice(0, 7) === today.slice(0, 7)));
  const fyNow = sum(rows.filter(i => fyOf(i.invoiceDate) === thisFy));
  const waiting = sum(rows.filter(i => i.status === "sent"));
  const money = (n: number) => formatInvoiceMoney(n, currency);
  const totals = sum(inScope);

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`This month (${MONTHS[Number(today.slice(5, 7)) - 1]})`} value={money(monthNow.amount)} hint={`${monthNow.count} invoice${monthNow.count === 1 ? "" : "s"} · before GST`} />
        <Stat label={`This financial year (${fyLabel(thisFy)})`} value={money(fyNow.amount)} hint={`${fyNow.count} invoice${fyNow.count === 1 ? "" : "s"} · before GST`} />
        <Stat label="Paid this year" value={money(fyNow.paid)} hint="including GST" />
        <Stat label="Sent, not yet paid" value={money(waiting.total)} hint={`${waiting.count} invoice${waiting.count === 1 ? "" : "s"} · including GST`} />
      </div>

      <Panel
        title="Revenue"
        subtitle={`From invoices raised (sent or paid), by invoice date. Revenue is before GST.${drafts ? ` ${drafts} draft${drafts === 1 ? " isn't" : "s aren't"} counted until sent.` : ""}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {currencies.length > 1 && currencies.map(c => (
              <Chip key={c} on={c === currency} onClick={() => setPicked(c)}>{c}</Chip>
            ))}
            <div className="inline-flex rounded-full border border-black/[0.08] bg-white p-0.5">
              {(["monthly", "yearly"] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded-full px-3 py-1 text-[13px] ${view === v ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50"}`}
                  data-testid={`button-revenue-${v}`}
                >
                  {v === "monthly" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          </div>
        )}
      >
        {view === "monthly" && (
          <div className="mb-4 flex flex-wrap gap-2">
            {years.map(y => <Chip key={y} on={y === fy} onClick={() => setFy(y)} testId={`button-fy-${y}`}>{fyLabel(y)}</Chip>)}
          </div>
        )}

        {!rows.length ? (
          <div className="rounded-xl bg-gray-50 px-4 py-8 text-center">
            <p className="text-[14px] font-medium text-gray-900">No revenue yet</p>
            <p className="mt-1 text-[13px] text-gray-500">Invoices count here once they're marked as sent or paid.</p>
          </div>
        ) : (
          <>
            <div className="h-[240px] w-full" data-testid="chart-revenue">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart key={view} data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="label"
                    tickFormatter={(l: string) => (view === "monthly" ? l.slice(0, 3) : l.replace("FY ", ""))}
                    tick={{ fontSize: 12, fill: "#6b7280" }}
                    axisLine={{ stroke: "#e5e7eb" }}
                    tickLine={false}
                  />
                  <YAxis tickFormatter={(v: number) => shortMoney(v, currency)} tick={{ fontSize: 12, fill: "#6b7280" }} axisLine={false} tickLine={false} width={64} />
                  <Tooltip
                    cursor={{ fill: "rgba(124,58,237,0.06)" }}
                    content={({ active, payload }) => {
                      const b = active ? (payload?.[0]?.payload as Bucket | undefined) : undefined;
                      if (!b) return null;
                      return (
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-md">
                          <p className="mb-1 font-medium text-gray-900">{b.label}</p>
                          <p className="text-gray-700">Revenue <b className="tabular-nums">{money(b.amount)}</b></p>
                          <p className="text-gray-500">GST {money(b.tax)} · billed {money(b.total)}</p>
                          <p className="text-gray-500">{b.count} invoice{b.count === 1 ? "" : "s"}{b.unpaid ? ` · ${money(b.unpaid)} not paid yet` : ""}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="amount" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-[14px]" data-testid="table-revenue">
                <thead>
                  <tr className="border-b border-black/[0.06] text-[12px] text-gray-500">
                    <th className="py-2 pr-3 font-medium">{view === "monthly" ? "Month" : "Financial year"}</th>
                    <th className="py-2 pr-3 text-right font-medium">Invoices</th>
                    <th className="py-2 pr-3 text-right font-medium">Revenue (before GST)</th>
                    <th className="py-2 pr-3 text-right font-medium">GST</th>
                    <th className="py-2 pr-3 text-right font-medium">Total billed</th>
                    <th className="py-2 pr-3 text-right font-medium">Paid</th>
                    <th className="py-2 text-right font-medium">Not paid yet</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Newest first; months still to come are left out of the table (the chart keeps them). */}
                  {buckets.filter(b => view === "yearly" || b.count > 0 || b.key <= today.slice(0, 7)).reverse().map(b => <MoneyRow key={b.key} b={b} money={money} dim={!b.count} />)}
                </tbody>
                <tfoot>
                  <MoneyRow b={{ ...totals, key: "total", label: view === "monthly" ? `${fyLabel(fy)} total` : "All years" }} money={money} bold />
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Panel>

      {customers.length > 0 && (
        <Panel title="By customer" subtitle={view === "monthly" ? `Revenue from each customer in ${fyLabel(fy)}.` : "Revenue from each customer, all years."}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[14px]" data-testid="table-revenue-customers">
              <thead>
                <tr className="border-b border-black/[0.06] text-[12px] text-gray-500">
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 text-right font-medium">Invoices</th>
                  <th className="py-2 pr-3 text-right font-medium">Revenue (before GST)</th>
                  <th className="py-2 pr-3 text-right font-medium">Share</th>
                  <th className="py-2 pr-3 text-right font-medium">Total billed</th>
                  <th className="py-2 text-right font-medium">Not paid yet</th>
                </tr>
              </thead>
              <tbody>
                {customers.map(c => (
                  <tr
                    key={c.key}
                    className="cursor-pointer border-b border-black/[0.04] last:border-0 hover:bg-gray-50"
                    onClick={() => setLocation(`/super-admin/billing?q=${encodeURIComponent(c.label)}`)}
                  >
                    <td className="py-3 pr-3 text-gray-900">{c.label}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{c.count}</td>
                    <td className="py-3 pr-3 text-right font-medium tabular-nums">{money(c.amount)}</td>
                    <td className="py-3 pr-3 text-right tabular-nums text-gray-500">{totals.amount ? `${Math.round((c.amount / totals.amount) * 100)}%` : "—"}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{money(c.total)}</td>
                    <td className={`py-3 text-right tabular-nums ${c.unpaid ? "text-amber-700" : "text-gray-400"}`}>{c.unpaid ? money(c.unpaid) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function MoneyRow({ b, money, dim, bold }: { b: Bucket; money: (n: number) => string; dim?: boolean; bold?: boolean }) {
  const cell = `py-2.5 pr-3 text-right tabular-nums ${bold ? "font-semibold text-gray-900" : ""}`;
  return (
    <tr className={`${bold ? "border-t border-black/[0.08]" : "border-b border-black/[0.04]"} ${dim ? "text-gray-400" : "text-gray-800"}`}>
      <td className={`py-2.5 pr-3 ${bold ? "font-semibold text-gray-900" : ""}`}>{b.label}</td>
      <td className={cell}>{b.count || "—"}</td>
      <td className={`${cell} ${bold ? "" : "font-medium"}`}>{b.count ? money(b.amount) : "—"}</td>
      <td className={cell}>{b.count ? money(b.tax) : "—"}</td>
      <td className={cell}>{b.count ? money(b.total) : "—"}</td>
      <td className={cell}>{b.count ? money(b.paid) : "—"}</td>
      <td className={`py-2.5 text-right tabular-nums ${bold ? "font-semibold" : ""} ${b.unpaid ? "text-amber-700" : ""}`}>{b.count ? money(b.unpaid) : "—"}</td>
    </tr>
  );
}

function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[13px] ${on ? "border-gray-900 bg-gray-900 text-white" : "border-black/[0.08] bg-white text-gray-700 hover:bg-gray-50"}`}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
