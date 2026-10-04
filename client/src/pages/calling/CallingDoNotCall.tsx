import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Info, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { normalizeCallPhone } from "@shared/aiCalling";
import { callingApi, callingKeys, isCallingUnavailable, type DoNotCallItem, type DoNotCallList } from "@/lib/aiCallingApi";
import { CallingPageHeader, CallingUnavailable } from "@/components/calling/RequireAiCalling";

const PAGE_SIZE = 50;
const SOURCE_LABEL: Record<string, string> = {
  call: "Asked on a call",
  staff: "Added by your team",
  import: "Imported",
};

/** Numbers the AI must never call. */
export default function CallingDoNotCall() {
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [removeTarget, setRemoveTarget] = useState<DoNotCallItem | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const offset = (page - 1) * PAGE_SIZE;
  const { data, isLoading, isFetching, error } = useQuery<DoNotCallList>({
    queryKey: callingKeys.dnc(search, offset, PAGE_SIZE),
    queryFn: () => callingApi.listDnc(search, offset, PAGE_SIZE),
    placeholderData: prev => prev,
    staleTime: 10_000,
    retry: false,
  });

  const normalized = normalizeCallPhone(phone);

  const add = useMutation({
    mutationFn: () => callingApi.addDnc(normalized!, reason.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: callingKeys.dncRoot });
      setAddOpen(false);
      setPhone("");
      setReason("");
      toast({ title: "Added to the do-not-call list", description: "The AI will never call this number." });
    },
    onError: (e: Error) => toast({ title: "Couldn't add the number", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => callingApi.removeDnc(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: callingKeys.dncRoot });
      setRemoveTarget(null);
      toast({ title: "Removed from the list", description: "The AI may call this number again." });
    },
    onError: (e: Error) => toast({ title: "Couldn't remove the number", description: e.message, variant: "destructive" }),
  });

  if (isCallingUnavailable(error) && !data) return <CallingUnavailable />;

  const rows = data?.items || [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <CallingPageHeader
        title="Do-not-call list"
        description="The AI never calls these numbers — not automatically, and not when someone presses “Call now”."
        actions={
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-dnc">
            <Plus className="h-4 w-4 mr-1" /> Add number
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Numbers are added automatically when someone asks the AI not to call them again. Only remove a number if the person has asked to be called.</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by phone number" className="pl-9" data-testid="input-search-dnc" />
            </div>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-gray-500"><Loader2 className="inline h-5 w-5 animate-spin" /></div>
          ) : error && !data ? (
            <div className="p-8 text-center text-sm text-gray-600">Couldn't load the list: {(error as Error).message}</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-gray-500">{search ? `No number matches "${search}".` : "No numbers on the list yet."}</div>
          ) : (
            <div className={`divide-y ${isFetching ? "opacity-70" : ""}`}>
              {rows.map(row => (
                <div key={row.id} className="px-4 py-3 flex items-center gap-3" data-testid={`row-dnc-${row.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm">{row.phone}</div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {SOURCE_LABEL[row.source] || "Added"}
                      {row.reason ? ` · ${row.reason}` : ""}
                      {` · ${new Date(row.createdAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setRemoveTarget(row)} data-testid={`button-remove-dnc-${row.id}`}>
                    <Trash2 className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Remove</span>
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t text-sm text-gray-600">
            <span>{total.toLocaleString()} {total === 1 ? "number" : "numbers"}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">Previous</span>
              </Button>
              <span>Page {Math.min(page, totalPages)} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={o => { if (!add.isPending) setAddOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a number</DialogTitle>
            <DialogDescription>The AI will never call this number until you remove it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dnc-phone">Phone number</Label>
              <Input id="dnc-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +91 98105 60800" inputMode="tel" autoFocus data-testid="input-dnc-phone" />
              {phone.trim() && !normalized && <p className="text-xs text-red-600">Enter a valid phone number (10 digits, or with country code).</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dnc-reason">Reason <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Input id="dnc-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder="e.g. Asked by email not to be called" data-testid="input-dnc-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={add.isPending}>Cancel</Button>
            <Button onClick={() => add.mutate()} disabled={!normalized || add.isPending} data-testid="button-save-dnc">
              {add.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add number
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={o => { if (!o && !remove.isPending) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow the AI to call this number again?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{removeTarget?.phone}</span> will be removed from the do-not-call list. Only do this if the person asked to be called.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" disabled={remove.isPending} onClick={e => { e.preventDefault(); if (removeTarget) remove.mutate(removeTarget.id); }} data-testid="button-confirm-remove-dnc">
              {remove.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Remove from list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
