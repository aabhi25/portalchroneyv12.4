import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Globe, Loader2, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, Upload,
} from "lucide-react";
import { ImportContactsDialog } from "@/components/whatsapp/ImportContactsDialog";
import { downloadContactSampleWorkbook } from "@/lib/contactSampleWorkbook";
import {
  AudiencePreviewLine, AudienceRulesEditor, describeRules, useAudiencePreview, type AudienceRules,
} from "@/components/whatsapp/AudienceRulesEditor";

interface Contact {
  id: string;
  phone: string;
  name: string;
  attributes: Record<string, string>;
}

interface ContactsPage {
  contacts: Contact[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Audience {
  id: string;
  name: string;
  description?: string;
  contactCount: number;
  defaultCountryCode: string | null;
  audienceType?: string;
  rules?: AudienceRules | null;
  lastRefreshedAt?: string | null;
}

const COUNTRY_CODE_OPTIONS: { code: string; label: string }[] = [
  { code: "91", label: "🇮🇳 India (+91)" },
  { code: "1", label: "🇺🇸 US / 🇨🇦 Canada (+1)" },
  { code: "44", label: "🇬🇧 UK (+44)" },
  { code: "971", label: "🇦🇪 UAE (+971)" },
  { code: "966", label: "🇸🇦 Saudi Arabia (+966)" },
  { code: "65", label: "🇸🇬 Singapore (+65)" },
  { code: "61", label: "🇦🇺 Australia (+61)" },
  { code: "60", label: "🇲🇾 Malaysia (+60)" },
  { code: "62", label: "🇮🇩 Indonesia (+62)" },
  { code: "63", label: "🇵🇭 Philippines (+63)" },
  { code: "880", label: "🇧🇩 Bangladesh (+880)" },
  { code: "94", label: "🇱🇰 Sri Lanka (+94)" },
  { code: "92", label: "🇵🇰 Pakistan (+92)" },
  { code: "977", label: "🇳🇵 Nepal (+977)" },
  { code: "49", label: "🇩🇪 Germany (+49)" },
  { code: "33", label: "🇫🇷 France (+33)" },
  { code: "39", label: "🇮🇹 Italy (+39)" },
  { code: "34", label: "🇪🇸 Spain (+34)" },
  { code: "55", label: "🇧🇷 Brazil (+55)" },
  { code: "52", label: "🇲🇽 Mexico (+52)" },
];
const MIXED_VALUE = "__mixed__";
const PAGE_SIZES = [25, 50, 100, 250, 500];

export default function WhatsAppContactGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editName, setEditName] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [bulkDelete, setBulkDelete] = useState<null | "selected" | "matching">(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState("newest");

  const [rulesOpen, setRulesOpen] = useState(false);
  const [draftRules, setDraftRules] = useState<AudienceRules | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => { setSelected(new Set()); }, [search, page, pageSize, sort]);

  const { data: group } = useQuery<Audience>({ queryKey: [`/api/whatsapp/contact-groups/${id}`] });
  const { data: allGroups = [] } = useQuery<Audience[]>({ queryKey: ["/api/whatsapp/contact-groups"] });
  const groupNames = useMemo(() => new Map(allGroups.map(g => [g.id, g.name])), [allGroups]);
  const contactsKey = ["/api/whatsapp/audiences", id, "contacts", { page, pageSize, search, sort }];
  const { data: pageData, isLoading, isFetching } = useQuery<ContactsPage>({
    queryKey: contactsKey,
    queryFn: () => apiRequest<ContactsPage>(
      "GET",
      `/api/whatsapp/audiences/${id}/contacts?page=${page}&pageSize=${pageSize}&sort=${sort}&search=${encodeURIComponent(search)}`,
    ),
    placeholderData: previous => previous,
  });
  const contacts = pageData?.contacts || [];
  const total = pageData?.total ?? 0;
  const totalPages = pageData?.totalPages ?? 1;
  useEffect(() => {
    if (pageData && pageData.page !== page) setPage(pageData.page);
  }, [pageData?.page]);

  const dynamic = group?.audienceType === "dynamic";
  const fromLeads = !dynamic && group?.rules?.source === "leads";
  const rulesPreview = useAudiencePreview(rulesOpen ? draftRules : null, id);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/audiences", id] });
    queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/contact-groups/${id}/contacts`] });
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/contact-groups"] });
  };

  const addMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/whatsapp/contact-groups/${id}/contacts`, { phone: newPhone, name: newName }),
    onSuccess: () => {
      refreshAll();
      setAddOpen(false); setNewPhone(""); setNewName("");
      toast({ title: "Person added" });
    },
    onError: (e: Error) => toast({ title: "Couldn't add", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async () =>
      apiRequest("PATCH", `/api/whatsapp/contact-groups/${id}/contacts/${editContact!.id}`, { phone: editPhone, name: editName }),
    onSuccess: () => {
      refreshAll();
      setEditOpen(false);
      setEditContact(null);
      toast({ title: "Contact updated" });
    },
    onError: (e: Error) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (contactId: string) => apiRequest("DELETE", `/api/whatsapp/contact-groups/${id}/contacts/${contactId}`),
    onSuccess: () => { refreshAll(); setDeleteTarget(null); toast({ title: "Removed from audience" }); },
    onError: (e: Error) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
  });

  const bulkMutation = useMutation({
    mutationFn: async (mode: "selected" | "matching") => apiRequest<{ removed: number }>(
      "POST",
      `/api/whatsapp/audiences/${id}/contacts/bulk-delete`,
      mode === "selected" ? { contactIds: Array.from(selected) } : { allMatching: true, search },
    ),
    onSuccess: r => {
      refreshAll();
      setSelected(new Set());
      setBulkDelete(null);
      toast({ title: `${r.removed.toLocaleString()} removed from this audience` });
    },
    onError: (e: Error) => toast({ title: "Couldn't remove", description: e.message, variant: "destructive" }),
  });

  const countryMutation = useMutation({
    mutationFn: async (defaultCountryCode: string | null) => apiRequest("PATCH", `/api/whatsapp/contact-groups/${id}`, { defaultCountryCode }),
    onSuccess: () => { refreshAll(); toast({ title: "Default country code updated" }); },
    onError: (e: Error) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: async () => apiRequest<{ added: number; total: number }>("POST", `/api/whatsapp/audiences/${id}/refresh`),
    onSuccess: r => {
      refreshAll();
      toast({ title: dynamic ? "Audience recounted" : `${r.added.toLocaleString()} new ${r.added === 1 ? "lead" : "leads"} added`, description: `${r.total.toLocaleString()} people now.` });
    },
    onError: (e: Error) => toast({ title: "Couldn't update the audience", description: e.message, variant: "destructive" }),
  });

  const rulesMutation = useMutation({
    mutationFn: async () => apiRequest<{ total: number }>("PUT", `/api/whatsapp/audiences/${id}/rules`, { rules: draftRules }),
    onSuccess: r => { refreshAll(); setRulesOpen(false); toast({ title: "Rules saved", description: `${r.total.toLocaleString()} people match now.` }); },
    onError: (e: Error) => toast({ title: "Couldn't save the rules", description: e.message, variant: "destructive" }),
  });

  const currentCode: string | null = group?.defaultCountryCode ?? null;
  const isMixed = !currentCode;
  const minPhoneDigits = isMixed ? 11 : 1;
  const phoneInvalid = newPhone.trim().length > 0 && newPhone.replace(/\D/g, "").length < minPhoneDigits;
  const editPhoneInvalid = editPhone.trim().length > 0 && editPhone.replace(/\D/g, "").length < minPhoneDigits;

  const openEdit = (c: Contact) => {
    setEditContact(c);
    setEditPhone(c.phone);
    setEditName(c.name || "");
    setEditOpen(true);
  };

  const allOnPageSelected = contacts.length > 0 && contacts.every(c => selected.has(c.id));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => setLocation("/admin/whatsapp-contact-groups")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to audiences
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold truncate">{group?.name || "Loading…"}</h1>
            {dynamic && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700"><Sparkles className="h-3 w-3 mr-1" />Self-updating</Badge>}
            {fromLeads && <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">From leads</Badge>}
          </div>
          {group?.description && <p className="text-sm text-gray-600 mt-1">{group.description}</p>}
          <p className="text-xs text-gray-500 mt-1">{(group?.contactCount ?? total).toLocaleString()} {(group?.contactCount ?? total) === 1 ? "person" : "people"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dynamic ? (
            <>
              <Button variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
                <RefreshCw className={`h-4 w-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} /> Recount now
              </Button>
              <Button onClick={() => { setDraftRules(group?.rules || null); setRulesOpen(true); }} data-testid="button-edit-rules">
                <Pencil className="h-4 w-4 mr-1" /> Edit rules
              </Button>
            </>
          ) : (
            <>
              {fromLeads && (
                <Button variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} data-testid="button-refresh-from-leads">
                  <RefreshCw className={`h-4 w-4 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} /> Add new matching leads
                </Button>
              )}
              <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import-contacts">
                <Upload className="h-4 w-4 mr-1" /> Import spreadsheet
              </Button>
              <Button onClick={() => setAddOpen(true)} data-testid="button-add-contact">
                <Plus className="h-4 w-4 mr-1" /> Add person
              </Button>
            </>
          )}
        </div>
      </div>

      {!dynamic && (
        <ImportContactsDialog
          groupId={id!}
          open={importOpen}
          onOpenChange={setImportOpen}
          defaultCountryCode={currentCode || null}
          onImported={refreshAll}
        />
      )}

      {(dynamic || fromLeads) && group?.rules && (
        <Card className="mb-4 border-violet-100">
          <CardContent className="p-4 text-sm">
            <div className="font-medium text-gray-800">{dynamic ? "Who is in this audience" : "Built from"}</div>
            <div className="text-gray-600 mt-0.5">{describeRules(group.rules, groupNames)}</div>
            <div className="text-xs text-gray-500 mt-1">
              {dynamic
                ? "Recalculated automatically every time a campaign is sent to it, so new matches are included and people who opted out are left out."
                : "This is a fixed list. Use \"Add new matching leads\" to top it up."}
              {group.lastRefreshedAt ? ` Last updated ${new Date(group.lastRefreshedAt).toLocaleString()}.` : ""}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Globe className="h-4 w-4 text-gray-500" /> Default country code
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-2">
          <Select value={currentCode || MIXED_VALUE} onValueChange={val => countryMutation.mutate(val === MIXED_VALUE ? null : val)} disabled={countryMutation.isPending}>
            <SelectTrigger className="w-full sm:w-72" data-testid="select-default-country-code">
              <SelectValue placeholder="Choose a default country code" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MIXED_VALUE}>Mixed (numbers must include country code)</SelectItem>
              {COUNTRY_CODE_OPTIONS.map(opt => <SelectItem key={opt.code} value={opt.code}>{opt.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {isMixed ? (
            <p className="text-xs text-amber-700">
              Mixed: every phone number must include its country code (e.g. <code className="bg-gray-100 px-1 rounded">919810560800</code>). Numbers without one can't be delivered.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Local numbers are sent as <code className="bg-gray-100 px-1 rounded">+{currentCode}&lt;number&gt;</code>. You can enter numbers with or without the country code.
            </p>
          )}
        </CardContent>
      </Card>

      {!dynamic && (
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-gray-500" /> Spreadsheet format
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-gray-600 space-y-3">
            <p>
              Upload an Excel file (<code className="bg-gray-100 px-1 rounded">.xlsx</code>) or a CSV with headers in the first row.
              It needs a <code className="bg-gray-100 px-1 rounded">phone</code> column (also accepted: mobile, number, whatsapp). A <code className="bg-gray-100 px-1 rounded">name</code> column is optional.
              Any other column (city, plan…) becomes a detail you can use in messages, like <code className="bg-gray-100 px-1 rounded">{`{{city}}`}</code>.
            </p>
            <p className="text-xs text-gray-500">You'll see what will be imported and what will be skipped before anything is saved.</p>
            <Button variant="outline" size="sm" onClick={() => downloadContactSampleWorkbook(currentCode || null)} data-testid="button-download-sample-format">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download sample Excel file
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row gap-2 p-3 border-b">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search name, phone or any detail" className="pl-9" data-testid="input-search-contacts" />
            </div>
            <div className="flex gap-2">
              <Select value={sort} onValueChange={v => { setSort(v); setPage(1); }}>
                <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="name">Name (A–Z)</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="w-full sm:w-[130px]" data-testid="select-page-size"><SelectValue /></SelectTrigger>
                <SelectContent>{PAGE_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n} per page</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {!dynamic && contacts.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b bg-gray-50/60 text-sm">
              <label className="flex items-center gap-2 text-gray-600">
                <Checkbox
                  checked={allOnPageSelected}
                  onCheckedChange={v => setSelected(v === true ? new Set(contacts.map(c => c.id)) : new Set())}
                  data-testid="checkbox-select-page"
                />
                {selected.size > 0 ? `${selected.size} selected on this page` : "Select this page"}
              </label>
              <div className="flex flex-wrap gap-2">
                {selected.size > 0 && (
                  <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setBulkDelete("selected")} data-testid="button-bulk-remove-selected">
                    <Trash2 className="h-4 w-4 mr-1" /> Remove selected
                  </Button>
                )}
                {search && total > 0 && (
                  <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setBulkDelete("matching")}>
                    Remove all {total.toLocaleString()} matching
                  </Button>
                )}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading…</div>
          ) : contacts.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              {search ? `Nobody matches "${search}".` : dynamic ? "Nobody matches the rules right now." : "No one here yet. Import a spreadsheet or add people one by one."}
            </div>
          ) : (
            <div className={`divide-y ${isFetching ? "opacity-70" : ""}`}>
              {contacts.map(c => (
                <div key={c.id} className="px-4 py-3 flex items-center gap-3" data-testid={`row-contact-${c.id}`}>
                  {!dynamic && (
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={v => {
                        const next = new Set(selected);
                        v === true ? next.add(c.id) : next.delete(c.id);
                        setSelected(next);
                      }}
                      aria-label={`Select ${c.phone}`}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm">{c.phone}</div>
                    {c.name && <div className="text-sm text-gray-700 truncate">{c.name}</div>}
                    {Object.keys(c.attributes || {}).length > 0 && (
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        {Object.entries(c.attributes).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                      </div>
                    )}
                  </div>
                  {!dynamic && (
                    <>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(c)} data-testid={`button-edit-${c.id}`} aria-label="Edit">
                        <Pencil className="h-4 w-4 text-gray-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(c)} data-testid={`button-remove-${c.id}`} aria-label="Remove">
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t text-sm text-gray-600">
            <span data-testid="text-contacts-range">
              {total === 0 ? "0 people" : `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${total.toLocaleString()}`}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="button-prev-page">
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <span>Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-next-page">
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add person */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a person</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder={isMixed ? "919810560800 (include the country code)" : `9810560800 — sent as +${currentCode}`}
                data-testid="input-new-phone"
              />
              {phoneInvalid && (
                <p className="text-xs text-red-600 mt-1" data-testid="text-phone-validation">
                  This audience is set to Mixed, so include the country code (at least 11 digits, e.g. 919810560800).
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Name (optional)</label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} data-testid="input-new-name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button disabled={!newPhone.trim() || phoneInvalid || addMutation.isPending} onClick={() => addMutation.mutate()}>
              {addMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove one */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !removeMutation.isPending) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this person?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>Remove <span className="font-mono font-medium">{deleteTarget.phone}</span>{deleteTarget.name ? ` (${deleteTarget.name})` : ""} from this audience? This can't be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={removeMutation.isPending}
              onClick={e => { e.preventDefault(); if (deleteTarget) removeMutation.mutate(deleteTarget.id); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove many */}
      <AlertDialog open={!!bulkDelete} onOpenChange={open => { if (!open && !bulkMutation.isPending) setBulkDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkDelete === "matching" ? `Remove all ${total.toLocaleString()} people matching "${search}"?` : `Remove ${selected.size} selected ${selected.size === 1 ? "person" : "people"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>They will be removed from this audience only. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={bulkMutation.isPending}
              onClick={e => { e.preventDefault(); if (bulkDelete) bulkMutation.mutate(bulkDelete); }}
              data-testid="button-confirm-bulk-remove"
            >
              {bulkMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit person */}
      <Dialog open={editOpen} onOpenChange={open => { setEditOpen(open); if (!open) setEditContact(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit person</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Phone</label>
              <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder={isMixed ? "919810560800 (include the country code)" : "9810560800"} data-testid="input-edit-phone" />
              {editPhoneInvalid && (
                <p className="text-xs text-red-600 mt-1">This audience is set to Mixed, so include the country code (at least 11 digits).</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Name (optional)</label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} data-testid="input-edit-name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); setEditContact(null); }}>Cancel</Button>
            <Button disabled={!editPhone.trim() || editPhoneInvalid || editMutation.isPending} onClick={() => editMutation.mutate()}>
              {editMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit rules (self-updating audiences) */}
      <Dialog open={rulesOpen} onOpenChange={open => { if (!rulesMutation.isPending) setRulesOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit who is in this audience</DialogTitle>
            <DialogDescription>The audience is recalculated right away and again every time a campaign is sent.</DialogDescription>
          </DialogHeader>
          {draftRules && (
            <div className="space-y-4">
              <AudienceRulesEditor value={draftRules} onChange={setDraftRules} excludeGroupId={id} />
              <AudiencePreviewLine preview={rulesPreview.data} isFetching={rulesPreview.isFetching} error={rulesPreview.error as Error | null} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRulesOpen(false)} disabled={rulesMutation.isPending}>Cancel</Button>
            <Button onClick={() => rulesMutation.mutate()} disabled={!draftRules || rulesMutation.isPending || !!rulesPreview.error} data-testid="button-save-rules">
              {rulesMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save rules
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
