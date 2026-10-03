import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Ban, ChevronLeft, ChevronRight, Download, Info, Loader2, Plus, Search, Trash2 } from "lucide-react";

interface OptOut {
  id: string;
  phone: string;
  reason: string | null;
  reasonLabel: string;
  campaignId: string | null;
  campaignName: string | null;
  createdAt: string;
}

interface OptOutPage {
  optOuts: OptOut[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PAGE_SIZES = [25, 50, 100, 250];

/** People who asked not to get WhatsApp campaign messages. Campaigns always skip them. */
export default function WhatsAppOptOuts() {
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [addOpen, setAddOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [removeTarget, setRemoveTarget] = useState<OptOut | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isFetching } = useQuery<OptOutPage>({
    queryKey: ["/api/whatsapp/opt-outs/search", { search, page, pageSize }],
    queryFn: () => apiRequest<OptOutPage>("GET", `/api/whatsapp/opt-outs/search?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`),
    placeholderData: previous => previous,
  });
  const rows = data?.optOuts || [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/opt-outs/search"] });
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/opt-outs"] });
  };

  const addMutation = useMutation({
    mutationFn: () => apiRequest<{ added: boolean; phone: string }>("POST", "/api/whatsapp/opt-outs", { phone: newPhone }),
    onSuccess: r => {
      invalidate();
      setAddOpen(false);
      setNewPhone("");
      toast({ title: r.added ? "Number added to the do-not-message list" : "That number was already on the list" });
    },
    onError: (e: Error) => toast({ title: "Couldn't add the number", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (phone: string) => apiRequest("DELETE", `/api/whatsapp/opt-outs/${encodeURIComponent(phone)}`),
    onSuccess: () => {
      invalidate();
      setRemoveTarget(null);
      toast({ title: "Removed from the list", description: "This number can receive campaign messages again." });
    },
    onError: (e: Error) => toast({ title: "Couldn't remove the number", description: e.message, variant: "destructive" }),
  });

  const digits = newPhone.replace(/\D/g, "");
  const phoneValid = digits.length >= 7 && digits.length <= 15;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Ban className="h-6 w-6 text-rose-600" /> Opted-out numbers
          </h1>
          <p className="text-sm text-gray-600 mt-1">People who asked not to receive campaign messages. Campaigns always skip these numbers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild data-testid="button-export-opt-outs">
            <a href="/api/whatsapp/opt-outs/export.csv" download><Download className="h-4 w-4 mr-1" /> Export CSV</a>
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-opt-out">
            <Plus className="h-4 w-4 mr-1" /> Add number
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>Numbers are added automatically when someone replies STOP. Only remove a number if the person has asked to receive messages again.</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row gap-2 p-3 border-b">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by phone number" className="pl-9" data-testid="input-search-opt-outs" />
            </div>
            <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n} per page</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-gray-500">{search ? `No opted-out number matches "${search}".` : "Nobody has opted out yet."}</div>
          ) : (
            <div className={`divide-y ${isFetching ? "opacity-70" : ""}`}>
              {rows.map(row => (
                <div key={row.id} className="px-4 py-3 flex items-center gap-3" data-testid={`row-opt-out-${row.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm">{row.phone}</div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {row.reasonLabel || "Opted out"}
                      {row.campaignName ? ` · after "${row.campaignName}"` : ""}
                      {` · ${new Date(row.createdAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setRemoveTarget(row)} data-testid={`button-remove-opt-out-${row.id}`}>
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
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <span>Page {Math.min(page, totalPages)} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a number</DialogTitle>
            <DialogDescription>This number will be skipped by every campaign until you remove it.</DialogDescription>
          </DialogHeader>
          <Input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="e.g. +91 98105 60800" data-testid="input-opt-out-phone" autoFocus />
          {newPhone.trim() && !phoneValid && <p className="text-xs text-red-600">Enter a phone number with 7 to 15 digits.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={!phoneValid || addMutation.isPending} data-testid="button-save-opt-out">
              {addMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add number
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeTarget} onOpenChange={open => { if (!open && !removeMutation.isPending) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow messages to this number again?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{removeTarget?.phone}</span> will be able to receive campaign messages again. Only do this if the person asked for it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={removeMutation.isPending}
              onClick={e => { e.preventDefault(); if (removeTarget) removeMutation.mutate(removeTarget.phone); }}
              data-testid="button-confirm-remove-opt-out"
            >
              {removeMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Remove from list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
