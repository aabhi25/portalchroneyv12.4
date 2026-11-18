import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { REQUEST_STATUSES, type DesignSessionStatus } from "@shared/designStudio";

/**
 * Design Studio › Requests: designs shoppers asked the brand to make, newest first, with how far
 * each has got (New → Called → Quoted → Ordered), and the numbers for the chosen dates: how many
 * shoppers started designing, saw designs, asked for one, were quoted and ordered.
 */

interface DesignRequest {
  id: string;
  status: DesignSessionStatus;
  requestedAt: string | null;
  summary: string;
  designUrl: string | null;
  designs: { id: string; url: string; note: string }[];
  priceText: string | null;
  requestNote: string | null;
  staffNotes: string | null;
  leadId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}

interface RequestsResponse {
  requests: DesignRequest[];
  funnel: { started: number; designed: number; requested: number; quoted: number; ordered: number; images: number };
}

const RANGES = [{ days: 7, label: "Last 7 days" }, { days: 30, label: "Last 30 days" }, { days: 90, label: "Last 90 days" }];

const STATUS_TINT: Record<string, string> = {
  requested: "bg-blue-50 text-blue-700", contacted: "bg-amber-50 text-amber-700", quoted: "bg-purple-50 text-purple-700",
  ordered: "bg-green-50 text-green-700", closed: "bg-gray-100 text-gray-600",
};

export default function DesignStudioRequests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState<DesignRequest | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Whole days, so the address (and the cached answer) stays the same through the day.
  const to = new Date(); to.setHours(23, 59, 59, 999);
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const url = `/api/design-studio/requests?from=${from.toISOString()}&to=${to.toISOString()}`;
  const { data, isLoading, error } = useQuery<RequestsResponse>({ queryKey: [url] });

  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; status?: DesignSessionStatus; staffNotes?: string }) =>
      apiRequest("PATCH", `/api/design-studio/requests/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [url] }),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });

  const funnel = data?.funnel;
  const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");
  const cards = funnel ? [
    { label: "Started designing", value: funnel.started, sub: "opened the studio" },
    { label: "Saw designs", value: funnel.designed, sub: `${percent(funnel.designed, funnel.started)} of started` },
    { label: "Asked to have it made", value: funnel.requested, sub: `${percent(funnel.requested, funnel.designed)} of those who saw designs` },
    { label: "Quoted", value: funnel.quoted, sub: `${percent(funnel.quoted, funnel.requested)} of requests` },
    { label: "Ordered", value: funnel.ordered, sub: `${percent(funnel.ordered, funnel.requested)} of requests` },
  ] : [];

  return (
    <div className="space-y-4" data-testid="page-design-studio-requests">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {RANGES.map(r => (
            <button
              key={r.days} type="button" onClick={() => setDays(r.days)} data-testid={`button-design-range-${r.days}`}
              className={`rounded-full border px-3 py-1 text-[13px] font-medium ${days === r.days ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-600"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {funnel && <p className="text-[12.5px] text-gray-500">{funnel.images} design image{funnel.images === 1 ? "" : "s"} made</p>}
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}
      {error && <div className="rounded-2xl border border-black/[0.07] bg-white p-6 text-sm text-gray-600">Design requests couldn't be loaded. {error instanceof Error ? error.message : ""}</div>}

      {funnel && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {cards.map(c => (
            <div key={c.label} className="rounded-2xl border border-black/[0.07] bg-white p-4" data-testid={`card-design-${c.label}`}>
              <p className="text-[12px] text-gray-500">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{c.value}</p>
              <p className="mt-0.5 text-[11.5px] text-gray-500">{c.sub}</p>
            </div>
          ))}
        </div>
      )}

      {data && data.requests.length === 0 && (
        <div className="rounded-2xl border border-black/[0.07] bg-white px-6 py-12 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-gray-300" />
          <p className="mt-3 text-[14px] font-medium text-gray-800">No design requests in these dates yet</p>
          <p className="mt-1 text-[13px] text-gray-500">When a shopper taps “Make this for me” in your chat, the design shows up here and in Leads.</p>
        </div>
      )}

      <div className="space-y-3">
        {data?.requests.map(r => (
          <div key={r.id} className="flex flex-col gap-4 rounded-2xl border border-black/[0.07] bg-white p-4 sm:flex-row" data-testid="row-design-request">
            <button type="button" onClick={() => setOpen(r)} className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50" aria-label="See the designs">
              {r.designUrl && <img src={r.designUrl} alt="Chosen design" className="h-full w-full object-cover" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[15px] font-semibold text-gray-900">{r.name || "Shopper"}</p>
                <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS_TINT[r.status] || STATUS_TINT.closed}`}>{REQUEST_STATUSES.find(s => s.id === r.status)?.label || r.status}</span>
                <span className="text-[12px] text-gray-500">{r.requestedAt ? new Date(r.requestedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}</span>
              </div>
              <p className="mt-0.5 text-[13px] text-gray-700">{[r.phone, r.email].filter(Boolean).join(" · ") || "Contact details are on the lead"}</p>
              <p className="mt-2 text-[13.5px] text-gray-800">{r.summary}</p>
              <p className="mt-0.5 text-[12.5px] text-gray-500">
                {r.priceText ? `Estimate shown: ${r.priceText}` : "No estimate shown"}
                {r.designs.length > 1 ? ` · ${r.designs.length} designs made` : ""}
              </p>
              {r.requestNote && <p className="mt-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[13px] text-gray-700">“{r.requestNote}”</p>}
              <Link href="/admin/leads" className="mt-2 inline-block text-[12.5px] font-medium text-blue-600 hover:underline">See this shopper in Leads</Link>
            </div>
            <div className="w-full shrink-0 space-y-2 sm:w-56">
              <Select value={r.status} onValueChange={v => update.mutate({ id: r.id, status: v as DesignSessionStatus })}>
                <SelectTrigger data-testid="select-design-status"><SelectValue /></SelectTrigger>
                <SelectContent>{REQUEST_STATUSES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <Textarea
                rows={2} placeholder="Your notes (quote given, call back on…)" className="text-[13px]" data-testid="input-design-staff-notes"
                value={notes[r.id] ?? r.staffNotes ?? ""}
                onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))}
                onBlur={() => { if (notes[r.id] !== undefined && notes[r.id] !== (r.staffNotes ?? "")) update.mutate({ id: r.id, staffNotes: notes[r.id] }); }}
              />
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!open} onOpenChange={v => !v && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{open?.name || "Shopper"}: designs</DialogTitle></DialogHeader>
          <p className="text-[13px] text-gray-600">{open?.summary}</p>
          <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto">
            {open?.designs.map(d => (
              <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer" className={`overflow-hidden rounded-xl border ${d.url === open.designUrl ? "border-2 border-green-500" : "border-gray-200"}`}>
                <img src={d.url} alt={d.note} className="w-full" />
                <span className="block px-2 py-1.5 text-[12px] text-gray-700">{d.url === open.designUrl ? "Chosen · " : ""}{d.note}</span>
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
