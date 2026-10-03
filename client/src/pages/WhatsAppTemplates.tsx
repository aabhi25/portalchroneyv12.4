import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Clock, Download, FileCode2, HelpCircle, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw,
  Search, ShieldCheck, Trash2, Wand2, XCircle,
} from "lucide-react";

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  bodyText: string;
  headerType: string;
  headerText: string;
  footerText: string;
  paramCount: number;
  status: string;
  statusSource?: string | null;
  statusCheckedAt?: string | null;
  sourceType?: string;
  msg91TemplateId?: string | null;
  namespace?: string | null;
  rejectionReason?: string | null;
  updatedAt: string;
}

interface Form {
  name: string;
  language: string;
  category: string;
  bodyText: string;
  headerType: string;
  headerText: string;
  footerText: string;
  msg91TemplateId: string;
  namespace: string;
}

interface SyncResult { synced: number; added: number; updated: number; skipped: number; removed: number }
interface StatusCheck { id: string; name: string; found: boolean; previousStatus: string; status: string }
interface Draft {
  name: string;
  category: string;
  language: string;
  bodyText: string;
  footerText: string;
  variables: { index: number; meaning: string; example: string }[];
  categoryHint: string;
  warnings: string[];
}

// Pre-filled account code most businesses on the shared WhatsApp account use.
const DEFAULT_NAMESPACE = "e5656ce8_113b_4313_960e_b53051ef4247";
const BODY_LIMIT = 1024;
const FOOTER_LIMIT = 60;

const emptyForm: Form = {
  name: "",
  language: "en",
  category: "MARKETING",
  bodyText: "",
  headerType: "none",
  headerText: "",
  footerText: "",
  msg91TemplateId: "",
  namespace: DEFAULT_NAMESPACE,
};

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Updates",
  AUTHENTICATION: "Login codes",
};

type StatusKey = "approved" | "pending" | "rejected" | "not_verified";

function statusKey(status: string): StatusKey {
  if (status === "approved") return "approved";
  if (status === "pending") return "pending";
  if (status === "rejected") return "rejected";
  return "not_verified"; // not_verified, draft, anything unknown
}

function StatusBadge({ template }: { template: Template }) {
  const key = statusKey(template.status);
  if (key === "approved") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700" title={template.statusSource === "user_confirmed" ? "You confirmed this template is approved" : undefined}>
        <CheckCircle2 className="h-3 w-3 mr-1" /> Approved{template.statusSource === "user_confirmed" ? " (confirmed by you)" : ""}
      </Badge>
    );
  }
  if (key === "pending") return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700"><Clock className="h-3 w-3 mr-1" /> Waiting for approval</Badge>;
  if (key === "rejected") return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700"><XCircle className="h-3 w-3 mr-1" /> Rejected</Badge>;
  return <Badge variant="outline" className="border-gray-300 bg-gray-50 text-gray-700"><HelpCircle className="h-3 w-3 mr-1" /> Not verified</Badge>;
}

export default function WhatsAppTemplates() {
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Template | null>(null);
  const [viewing, setViewing] = useState<Template | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | StatusKey>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState<"recent" | "name">("recent");

  const [helpOpen, setHelpOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data: templates = [], isLoading } = useQuery<Template[]>({ queryKey: ["/api/whatsapp/templates"] });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates"] });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return templates
      .filter(t => statusFilter === "all" || statusKey(t.status) === statusFilter)
      .filter(t => categoryFilter === "all" || t.category === categoryFilter)
      .filter(t => !needle || t.name.toLowerCase().includes(needle) || (t.bodyText || "").toLowerCase().includes(needle))
      .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [templates, search, statusFilter, categoryFilter, sort]);
  const counts = useMemo(() => {
    const c = { approved: 0, pending: 0, rejected: 0, not_verified: 0 } as Record<StatusKey, number>;
    templates.forEach(t => { c[statusKey(t.status)]++; });
    return c;
  }, [templates]);

  const syncMutation = useMutation({
    mutationFn: async () => apiRequest<SyncResult>("POST", "/api/whatsapp/templates/sync"),
    onSuccess: data => {
      invalidate();
      toast({ title: "Approved templates imported", description: `${data.added} new · ${data.updated} updated · ${data.removed} removed` });
    },
    onError: (e: Error) => toast({ title: "Couldn't import templates", description: e.message, variant: "destructive" }),
  });

  const checkAllMutation = useMutation({
    mutationFn: async () => apiRequest<{ checked: StatusCheck[] }>("POST", "/api/whatsapp/templates/refresh-status", {}),
    onSuccess: r => {
      invalidate();
      const changed = r.checked.filter(c => c.found && c.status !== c.previousStatus).length;
      const missing = r.checked.filter(c => !c.found).length;
      toast({
        title: "Status checked",
        description: [`${changed} changed`, missing ? `${missing} not found on your WhatsApp account` : ""].filter(Boolean).join(" · "),
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't check the status", description: e.message, variant: "destructive" }),
  });

  const checkOneMutation = useMutation({
    mutationFn: async (id: string) => apiRequest<{ check: StatusCheck | null }>("POST", `/api/whatsapp/templates/${id}/refresh-status`, {}),
    onSuccess: r => {
      invalidate();
      const c = r.check;
      if (!c) return;
      toast(c.found
        ? { title: c.status === "approved" ? "Approved by WhatsApp" : c.status === "pending" ? "Still waiting for approval" : "Rejected by WhatsApp" }
        : { title: "Not found on your WhatsApp account", description: "Check the name and language match exactly. You can also confirm it yourself." });
    },
    onError: (e: Error) => toast({ title: "Couldn't check the status", description: e.message, variant: "destructive" }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/whatsapp/templates/${id}/confirm-approved`, {}),
    onSuccess: () => { invalidate(); setConfirmTarget(null); toast({ title: "Marked as approved", description: "This template can now be used in campaigns." }); },
    onError: (e: Error) => toast({ title: "Couldn't mark as approved", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => editing
      ? apiRequest<Template>("PATCH", `/api/whatsapp/templates/${editing.id}`, form)
      : apiRequest<Template>("POST", "/api/whatsapp/templates", form),
    onSuccess: saved => {
      invalidate();
      const wasEditing = Boolean(editing);
      closeForm();
      toast({ title: wasEditing ? "Template saved" : "Template added", description: saved.status === "approved" ? undefined : "Checking whether WhatsApp has approved it…" });
      // New / renamed templates: ask the provider right away (quietly — the badge shows the result).
      if (saved.status !== "approved") {
        apiRequest<{ check: StatusCheck | null }>("POST", `/api/whatsapp/templates/${saved.id}/refresh-status`, {})
          .then(r => {
            invalidate();
            if (r.check?.found && r.check.status === "approved") toast({ title: "Approved by WhatsApp", description: `"${saved.name}" is ready for campaigns.` });
          })
          .catch(() => { /* not connected — stays "Not verified"; the card explains what to do */ });
      }
    },
    onError: (e: Error) => toast({ title: "Couldn't save the template", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/whatsapp/templates/${id}`),
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast({ title: "Template deleted" }); },
    onError: (e: Error) => toast({ title: "Couldn't delete template", description: e.message, variant: "destructive" }),
  });

  const draftMutation = useMutation({
    mutationFn: async () => apiRequest<Draft>("POST", "/api/whatsapp/templates/draft", { goal, category: form.category, language: form.language }),
    onSuccess: d => {
      setDraft(d);
      setForm(f => ({
        ...f,
        name: f.name || d.name,
        category: d.category,
        bodyText: d.bodyText,
        footerText: d.footerText || f.footerText,
      }));
    },
    onError: (e: Error) => toast({ title: "Writing help isn't available", description: e.message, variant: "destructive" }),
  });

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm);
    setAdvancedOpen(false);
    setHelpOpen(false);
    setGoal("");
    setDraft(null);
  }

  const startNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const startEdit = (t: Template) => {
    setEditing(t);
    setForm({
      name: t.name,
      language: t.language || "en",
      category: t.category || "MARKETING",
      bodyText: t.bodyText || "",
      headerType: t.headerType || "none",
      headerText: t.headerText || "",
      footerText: t.footerText || "",
      msg91TemplateId: t.msg91TemplateId || "",
      namespace: t.namespace || "",
    });
    setViewing(null);
    setFormOpen(true);
  };

  const paramHint = new Set(form.bodyText.match(/\{\{\s*\d+\s*\}\}/g) || []).size;
  const renamingApproved = editing && editing.sourceType !== "msg91" && editing.status === "approved"
    && (form.name.trim() !== editing.name || form.language.trim() !== editing.language);
  const namespaceMissing = !form.namespace.trim();
  const canSave = form.name.trim() && form.bodyText.trim() && form.bodyText.length <= BODY_LIMIT && form.footerText.length <= FOOTER_LIMIT
    && (!namespaceMissing || Boolean(editing)) && !saveMutation.isPending;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCode2 className="h-6 w-6 text-emerald-600" />
            Message templates
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            WhatsApp only delivers campaign messages that use a template it has approved. Import your approved templates, or add one and check its status.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="button-sync-templates">
            {syncMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            Import approved templates
          </Button>
          <Button variant="outline" onClick={() => checkAllMutation.mutate()} disabled={checkAllMutation.isPending || templates.length === 0} data-testid="button-check-all-status">
            <RefreshCw className={`h-4 w-4 mr-1 ${checkAllMutation.isPending ? "animate-spin" : ""}`} /> Check status
          </Button>
          <Button onClick={startNew} data-testid="button-new-template">
            <Plus className="h-4 w-4 mr-1" /> Add template
          </Button>
        </div>
      </div>

      {templates.length > 0 && (
        <div className="flex flex-col xl:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or message" className="pl-9" data-testid="input-search-templates" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
              <SelectTrigger className="w-full xl:w-[190px]" data-testid="select-template-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses ({templates.length})</SelectItem>
                <SelectItem value="approved">Approved ({counts.approved})</SelectItem>
                <SelectItem value="pending">Waiting for approval ({counts.pending})</SelectItem>
                <SelectItem value="rejected">Rejected ({counts.rejected})</SelectItem>
                <SelectItem value="not_verified">Not verified ({counts.not_verified})</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full xl:w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="MARKETING">Marketing</SelectItem>
                <SelectItem value="UTILITY">Updates</SelectItem>
                <SelectItem value="AUTHENTICATION">Login codes</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={v => setSort(v as any)}>
              <SelectTrigger className="w-full xl:w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recently updated</SelectItem>
                <SelectItem value="name">Name (A–Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            <FileCode2 className="h-10 w-10 mx-auto text-emerald-200 mb-3" />
            <div className="font-medium text-gray-700">No templates yet</div>
            <div className="text-sm max-w-md mx-auto mt-1">
              Click <strong>Import approved templates</strong> to bring in the templates WhatsApp has already approved for your number,
              or <strong>Add template</strong> to write one yourself.
            </div>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card><CardContent className="text-center py-10 text-gray-500">No templates match these filters.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {visible.map(t => {
            const key = statusKey(t.status);
            const manual = t.sourceType !== "msg91";
            return (
              <Card key={t.id} data-testid={`card-template-${t.id}`} className="hover:border-emerald-300 hover:shadow-sm transition">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setViewing(t)} data-testid={`button-view-template-${t.id}`}>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-mono font-semibold break-all">{t.name}</span>
                        <StatusBadge template={t} />
                      </div>
                      <div className="text-xs text-gray-500">
                        {t.language} · {CATEGORY_LABELS[t.category] || t.category} · {t.paramCount} fill-in value{t.paramCount === 1 ? "" : "s"}
                      </div>
                      {t.headerText && <div className="text-sm font-semibold mt-1">{t.headerText}</div>}
                      <div className="text-sm text-gray-700 whitespace-pre-wrap mt-1 line-clamp-3">{t.bodyText}</div>
                      {key === "rejected" && t.rejectionReason && <div className="text-xs text-red-600 mt-1">Why: {t.rejectionReason}</div>}
                      {key === "not_verified" && (
                        <div className="text-xs text-gray-600 mt-2 flex items-start gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-px" />
                          Not usable in campaigns yet. Use “Check status”, or mark it approved if you've confirmed it on your WhatsApp account.
                        </div>
                      )}
                      {key === "pending" && <div className="text-xs text-gray-600 mt-2">WhatsApp is reviewing it. Check again later.</div>}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label="Template actions" data-testid={`button-template-actions-${t.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onSelect={() => startEdit(t)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => checkOneMutation.mutate(t.id)} disabled={checkOneMutation.isPending}>
                          <RefreshCw className="h-4 w-4 mr-2" /> Check status
                        </DropdownMenuItem>
                        {manual && key === "not_verified" && (
                          <DropdownMenuItem onSelect={() => setConfirmTarget(t)} data-testid={`button-confirm-approved-${t.id}`}>
                            <ShieldCheck className="h-4 w-4 mr-2" /> Mark as approved…
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600" onSelect={() => setDeleteTarget(t)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* View */}
      <Dialog open={!!viewing} onOpenChange={o => { if (!o) setViewing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-template-details">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span className="font-mono break-all">{viewing?.name}</span>
              {viewing && <StatusBadge template={viewing} />}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-gray-500">Language</div><div className="font-medium">{viewing.language}</div></div>
                <div><div className="text-xs text-gray-500">Type</div><div className="font-medium">{CATEGORY_LABELS[viewing.category] || viewing.category}</div></div>
                <div><div className="text-xs text-gray-500">Header</div><div className="font-medium">{viewing.headerType || "none"}</div></div>
                <div><div className="text-xs text-gray-500">Fill-in values</div><div className="font-medium">{viewing.paramCount}</div></div>
              </div>
              {viewing.headerText && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Header</div>
                  <div className="rounded-md border bg-gray-50 px-3 py-2 font-semibold">{viewing.headerText}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-gray-500 mb-1">Message</div>
                <div className="rounded-md border bg-gray-50 px-3 py-2 whitespace-pre-wrap" data-testid="text-template-body-full">{viewing.bodyText}</div>
              </div>
              {viewing.footerText && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Footer</div>
                  <div className="rounded-md border bg-gray-50 px-3 py-2 italic text-gray-600">{viewing.footerText}</div>
                </div>
              )}
              {viewing.rejectionReason && (
                <div>
                  <div className="text-xs text-red-600 mb-1">Why it was rejected</div>
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">{viewing.rejectionReason}</div>
                </div>
              )}
              <Collapsible>
                <CollapsibleTrigger className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-800">
                  <ChevronDown className="h-3.5 w-3.5" /> Advanced details
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2 text-xs">
                  <div><span className="text-gray-500">Template ID: </span><span className="font-mono break-all">{viewing.msg91TemplateId || "—"}</span></div>
                  <div><span className="text-gray-500">Account code: </span><span className="font-mono break-all">{viewing.namespace || "— not set —"}</span></div>
                  {viewing.statusCheckedAt && <div className="text-gray-500">Status last checked {new Date(viewing.statusCheckedAt).toLocaleString()}</div>}
                </CollapsibleContent>
              </Collapsible>
              <div className="text-xs text-gray-400">Last updated {new Date(viewing.updatedAt).toLocaleString()}</div>
            </div>
          )}
          <DialogFooter>
            {viewing && <Button variant="outline" onClick={() => startEdit(viewing)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>}
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / edit */}
      <Dialog open={formOpen} onOpenChange={o => { if (!o) closeForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit template" : "Add a template"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes here update Chroney's copy. The name and language must match the template approved on your WhatsApp account."
                : "Enter a template exactly as it was approved on your WhatsApp account. It starts as “Not verified” until its approval is confirmed."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="border-violet-200 text-violet-700 hover:bg-violet-50" data-testid="button-help-me-write">
                  <Wand2 className="h-4 w-4 mr-1" /> Help me write
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 rounded-lg border border-violet-100 bg-violet-50/40 p-3 space-y-2">
                <Label className="text-sm">What is this message for?</Label>
                <Textarea
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  rows={2}
                  placeholder="e.g. Tell customers our Diwali sale is on, mention the discount and the last day"
                  data-testid="input-template-goal"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">We'll draft a message that follows WhatsApp's rules. Review it before saving.</p>
                  <Button type="button" size="sm" onClick={() => draftMutation.mutate()} disabled={goal.trim().length < 5 || draftMutation.isPending} data-testid="button-generate-draft">
                    {draftMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />} Write it
                  </Button>
                </div>
                {draft && (
                  <div className="text-xs text-gray-700 space-y-1 pt-1">
                    <div><span className="font-medium">Suggested type:</span> {draft.categoryHint}</div>
                    {draft.variables.length > 0 && (
                      <div><span className="font-medium">Fill-in values:</span> {draft.variables.map(v => `{{${v.index}}} = ${v.meaning}${v.example ? ` (e.g. ${v.example})` : ""}`).join(" · ")}</div>
                    )}
                    {draft.warnings.map((w, i) => <div key={i} className="text-amber-700">{w}</div>)}
                    <div className="text-gray-500">A new template must still be submitted for approval on your WhatsApp provider's dashboard before it can be sent.</div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <Label className="text-sm">Template name</Label>
                <Input
                  className="mt-1"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                  placeholder="diwali_offer"
                  data-testid="input-template-name"
                />
              </div>
              <div>
                <Label className="text-sm">Language</Label>
                <Input className="mt-1" value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} placeholder="en" data-testid="input-template-language" />
              </div>
            </div>
            {renamingApproved && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Changing the name or language means this template will need to be verified again before campaigns can use it.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Type</Label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger className="mt-1" data-testid="select-template-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing (offers, announcements)</SelectItem>
                    <SelectItem value="UTILITY">Updates (orders, bookings, payments)</SelectItem>
                    <SelectItem value="AUTHENTICATION">Login codes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Header</Label>
                <Select value={form.headerType} onValueChange={v => setForm({ ...form, headerType: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="image">Image</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.headerType === "text" && (
              <div>
                <Label className="text-sm">Header text</Label>
                <Input className="mt-1" value={form.headerText} onChange={e => setForm({ ...form, headerText: e.target.value })} placeholder="Limited time offer!" />
              </div>
            )}
            <div>
              <Label className="text-sm">Message</Label>
              <Textarea
                className="mt-1"
                value={form.bodyText}
                onChange={e => setForm({ ...form, bodyText: e.target.value })}
                rows={6}
                placeholder="Hi {{1}}, get 20% off on {{2}} this week. Reply YES to claim."
                data-testid="input-template-body"
              />
              <div className="flex flex-wrap justify-between gap-2 text-xs mt-1">
                <span className="text-gray-500">Use {"{{1}}"}, {"{{2}}"}… for values filled in per person. Found: {paramHint}.</span>
                <span className={form.bodyText.length > BODY_LIMIT ? "text-red-600" : "text-gray-400"}>{form.bodyText.length}/{BODY_LIMIT}</span>
              </div>
            </div>
            <div>
              <Label className="text-sm">Footer (optional)</Label>
              <Input className="mt-1" value={form.footerText} onChange={e => setForm({ ...form, footerText: e.target.value })} placeholder="Reply STOP to opt out" />
              <div className={`text-xs text-right mt-1 ${form.footerText.length > FOOTER_LIMIT ? "text-red-600" : "text-gray-400"}`}>{form.footerText.length}/{FOOTER_LIMIT}</div>
            </div>

            <Collapsible open={advancedOpen || namespaceMissing} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="text-sm text-gray-600 flex items-center gap-1 hover:text-gray-900">
                <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen || namespaceMissing ? "rotate-180" : ""}`} /> Advanced (only if your provider asks for it)
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3 rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Account code</Label>
                  <Input className="mt-1 font-mono text-xs" value={form.namespace} onChange={e => setForm({ ...form, namespace: e.target.value })} data-testid="input-template-namespace" />
                  <p className="text-xs text-gray-500 mt-1">Shown as “namespace” in your provider's template details. Most businesses can keep the pre-filled value.</p>
                  {namespaceMissing && <p className="text-xs text-red-600 mt-1">An account code is needed to send this template.</p>}
                  {!namespaceMissing && form.namespace !== DEFAULT_NAMESPACE && !editing && (
                    <button type="button" className="text-xs text-violet-700 underline mt-1" onClick={() => setForm({ ...form, namespace: DEFAULT_NAMESPACE })}>Use the standard code</button>
                  )}
                </div>
                <div>
                  <Label className="text-sm">Template ID (optional)</Label>
                  <Input className="mt-1" value={form.msg91TemplateId} onChange={e => setForm({ ...form, msg91TemplateId: e.target.value })} placeholder="Leave blank if you don't have it" data-testid="input-template-msg91-id" />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button disabled={!canSave} onClick={() => saveMutation.mutate()} data-testid="button-save-template">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} {editing ? "Save changes" : "Add template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm approved by hand */}
      <AlertDialog open={!!confirmTarget} onOpenChange={o => { if (!o && !confirmMutation.isPending) setConfirmTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark "{confirmTarget?.name}" as approved?</AlertDialogTitle>
            <AlertDialogDescription>
              Only do this if you've checked on your WhatsApp account that a template with exactly this name and language ({confirmTarget?.language}) is approved.
              If it isn't, every message in a campaign using it will fail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmMutation.isPending}
              onClick={e => { e.preventDefault(); if (confirmTarget) confirmMutation.mutate(confirmTarget.id); }}
              data-testid="button-confirm-mark-approved"
            >
              {confirmMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Yes, it's approved
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be removed from Chroney and won't come back on future imports. Past campaign history is kept. It isn't deleted from your WhatsApp account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={e => { e.preventDefault(); if (deleteTarget && !deleteMutation.isPending) deleteMutation.mutate(deleteTarget.id); }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
