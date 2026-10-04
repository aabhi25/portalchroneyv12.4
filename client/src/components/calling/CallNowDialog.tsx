import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Check, Loader2, Phone, Search, UserRound } from "lucide-react";
import { normalizeCallPhone } from "@shared/aiCalling";
import { callingApi, callingKeys, type CreateCallResponse, type LeadSearchItem } from "@/lib/aiCallingApi";

export interface CallTarget {
  leadId?: string;
  phone?: string;
  name?: string;
  note?: string;
  /** For the confirm text. */
  displayName: string;
  displayPhone: string;
}

/** Pick a lead (search) or type a number + name + note. Calls onChange with a valid target or null. */
export function CallTargetPicker({ onChange, showNote = true }: { onChange: (t: CallTarget | null) => void; showNote?: boolean }) {
  const [tab, setTab] = useState<"lead" | "number">("lead");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [lead, setLead] = useState<LeadSearchItem | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const leads = useQuery({
    queryKey: ["/api/leads", "calling-picker", search],
    queryFn: () => callingApi.searchLeads(search),
    enabled: tab === "lead",
    staleTime: 30_000,
    retry: false,
  });

  const normalized = normalizeCallPhone(phone);

  useEffect(() => {
    if (tab === "lead") {
      if (!lead) return onChange(null);
      onChange({
        leadId: lead.id,
        note: note.trim() || undefined,
        displayName: lead.name || "this lead",
        displayPhone: lead.phone || "",
      });
    } else {
      if (!normalized) return onChange(null);
      onChange({
        phone: normalized,
        name: name.trim() || undefined,
        note: note.trim() || undefined,
        displayName: name.trim() || normalized,
        displayPhone: normalized,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, lead, normalized, name, note]);

  const rows = (leads.data?.leads || []).filter(l => !!l.phone);

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={v => setTab(v as "lead" | "number")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="lead" data-testid="tab-call-pick-lead">Pick a lead</TabsTrigger>
          <TabsTrigger value="number" data-testid="tab-call-type-number">Type a number</TabsTrigger>
        </TabsList>
        <TabsContent value="lead" className="space-y-2 mt-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search leads by name or phone" className="pl-9" data-testid="input-call-lead-search" />
          </div>
          <div className="max-h-52 overflow-y-auto rounded-md border divide-y">
            {leads.isLoading ? (
              <div className="p-4 text-center text-sm text-gray-500"><Loader2 className="inline h-4 w-4 animate-spin mr-1" /> Searching…</div>
            ) : leads.isError ? (
              <div className="p-4 text-center text-sm text-gray-500">Couldn't load leads. You can type a number instead.</div>
            ) : rows.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">{search ? `No lead with a phone number matches "${search}".` : "No leads with a phone number yet."}</div>
            ) : (
              rows.map(l => {
                const selected = lead?.id === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLead(selected ? null : l)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 ${selected ? "bg-purple-50" : ""}`}
                    data-testid={`option-call-lead-${l.id}`}
                  >
                    <UserRound className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.name || "Unnamed lead"}</span>
                      <span className="block truncate text-xs text-gray-500">{l.phone}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 text-purple-600" />}
                  </button>
                );
              })
            )}
          </div>
        </TabsContent>
        <TabsContent value="number" className="space-y-3 mt-3">
          <div className="space-y-1.5">
            <Label htmlFor="call-phone">Phone number</Label>
            <Input id="call-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. 98105 60800 or +91 98105 60800" inputMode="tel" data-testid="input-call-phone" />
            {phone.trim() && !normalized && <p className="text-xs text-red-600">Enter a valid phone number (10 digits, or with country code).</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="call-name">Name <span className="text-gray-400 font-normal">(optional)</span></Label>
            <Input id="call-name" value={name} onChange={e => setName(e.target.value)} placeholder="Who is the AI calling?" data-testid="input-call-name" />
          </div>
        </TabsContent>
      </Tabs>
      {showNote && (
        <div className="space-y-1.5">
          <Label htmlFor="call-note">Note for the AI <span className="text-gray-400 font-normal">(optional)</span></Label>
          <Textarea id="call-note" value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} placeholder="e.g. They asked about the 2BHK price list — follow up on that." data-testid="input-call-note" />
        </div>
      )}
    </div>
  );
}

export function useCreateCall(opts?: { onDone?: (r: CreateCallResponse) => void; test?: boolean }) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (t: CallTarget) => callingApi.createCall({ leadId: t.leadId, phone: t.phone, name: t.name, note: t.note }),
    onSuccess: r => {
      queryClient.invalidateQueries({ queryKey: callingKeys.callsRoot });
      queryClient.invalidateQueries({ queryKey: callingKeys.incoming });
      const scheduled = r.scheduledAt && new Date(r.scheduledAt).getTime() > Date.now() + 60_000;
      toast({
        title: scheduled ? "Call scheduled" : opts?.test ? "Test call on its way" : "Call started",
        description:
          r.message ||
          (scheduled
            ? `The AI will call at ${new Date(r.scheduledAt!).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
            : opts?.test
              ? "Your portal will ring in a few seconds."
              : "The AI is dialling now. You'll see it in Calls."),
      });
      opts?.onDone?.(r);
    },
    onError: (e: Error) => toast({ title: "Couldn't place the call", description: e.message, variant: "destructive" }),
  });
}

/** "Call someone now": pick → confirm → POST /api/calling/calls. */
export function CallNowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [target, setTarget] = useState<CallTarget | null>(null);
  const [confirming, setConfirming] = useState(false);
  const create = useCreateCall({ onDone: () => { setConfirming(false); onOpenChange(false); } });

  useEffect(() => {
    if (!open) { setConfirming(false); setTarget(null); }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={o => { if (!create.isPending) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Phone className="h-5 w-5 text-purple-600" /> Call someone now</DialogTitle>
          <DialogDescription>The AI phones them straight away (within your calling hours) and talks about your business.</DialogDescription>
        </DialogHeader>
        {/* Kept mounted while confirming so "Back" returns to the same choice. */}
        <div className={confirming ? "hidden" : ""}>{open && <CallTargetPicker onChange={setTarget} />}</div>
        {!confirming ? (
          <>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setConfirming(true)} disabled={!target} data-testid="button-call-now-next">Continue</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="rounded-lg border bg-purple-50/60 p-4 text-sm">
              <p className="font-medium text-gray-900">
                The AI will call {target?.displayName}
                {target?.displayPhone && target.displayPhone !== target.displayName ? ` on ${target.displayPhone}` : ""} now.
              </p>
              <p className="mt-1 text-gray-600">If it's outside your calling hours, the call is scheduled for the next allowed time instead.</p>
              {target?.note && <p className="mt-2 text-gray-600"><span className="font-medium">Note:</span> {target.note}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={create.isPending}>Back</Button>
              <Button onClick={() => target && create.mutate(target)} disabled={create.isPending || !target} data-testid="button-call-now-confirm">
                {create.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Phone className="h-4 w-4 mr-1" />} Call now
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
