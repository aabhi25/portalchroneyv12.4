import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileCode2, Trash2, Pencil, RefreshCw, ExternalLink } from "lucide-react";

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

const DEFAULT_NAMESPACE = "e5656ce8_113b_4313_960e_b53051ef4247";

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

export default function WhatsAppTemplates() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [viewing, setViewing] = useState<Template | null>(null);
  const [namespaceMode, setNamespaceMode] = useState<"default" | "custom">("default");
  const [customNamespace, setCustomNamespace] = useState("");

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["/api/whatsapp/templates"],
  });

  const syncMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/whatsapp/templates/sync"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates"] });
      toast({
        title: data?.synced > 0
          ? `Synced ${data.synced} template${data.synced !== 1 ? "s" : ""} from MSG91`
          : "No new templates found",
        description: data?.synced === 0
          ? "All your approved templates are already up to date, or none exist yet on MSG91."
          : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return await apiRequest("PATCH", `/api/whatsapp/templates/${editingId}`, form);
      }
      return await apiRequest("POST", "/api/whatsapp/templates", form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates"] });
      setOpen(false); setEditingId(null); setForm(emptyForm);
      toast({ title: editingId ? "Template updated" : "Template added" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/whatsapp/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const startEdit = (t: Template) => {
    setEditingId(t.id);
    const ns = t.namespace || "";
    const isDefault = ns === DEFAULT_NAMESPACE;
    setNamespaceMode(isDefault ? "default" : "custom");
    setCustomNamespace(isDefault ? "" : ns);
    setForm({
      name: t.name,
      language: t.language,
      category: t.category,
      bodyText: t.bodyText,
      headerType: t.headerType || "none",
      headerText: t.headerText || "",
      footerText: t.footerText || "",
      msg91TemplateId: t.msg91TemplateId || "",
      namespace: ns,
    });
    setOpen(true);
  };

  const startNew = () => {
    setEditingId(null);
    setNamespaceMode("default");
    setCustomNamespace("");
    setForm(emptyForm);
    setOpen(true);
  };

  const paramHint = (() => {
    const matches = form.bodyText.match(/\{\{\s*\d+\s*\}\}/g);
    return matches ? new Set(matches).size : 0;
  })();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCode2 className="h-6 w-6 text-emerald-600" />
            WhatsApp Templates
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Mirror your Meta-approved MSG91 templates here so campaigns can send them. Anything you save here is immediately usable in campaigns.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync-templates"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing…" : "Sync from MSG91"}
          </Button>
          <Button onClick={startNew} data-testid="button-new-template">
            <Plus className="h-4 w-4 mr-1" /> Add manually
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading...</div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            <div className="mb-2">No templates yet.</div>
            <div className="text-xs max-w-md mx-auto">
              Open your MSG91 dashboard, click <strong>Code (JSON)</strong> on each approved
              template, then click <strong>Add Template</strong> here to mirror it
              (name, namespace, body).
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {templates.map(t => (
            <Card key={t.id} data-testid={`card-template-${t.id}`} className="hover:border-emerald-300 hover:shadow-sm transition cursor-pointer">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div
                    className="flex-1 min-w-0"
                    onClick={() => setViewing(t)}
                    data-testid={`button-view-template-${t.id}`}
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono font-semibold">{t.name}</span>
                      {!t.namespace && (
                        <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50" title="Namespace missing — campaigns may fail. Edit and add namespace from MSG91.">
                          No namespace
                        </Badge>
                      )}
                      <span className="text-xs text-gray-500">{t.language} · {t.category} · {t.paramCount} params</span>
                    </div>
                    {t.headerText && <div className="text-sm font-semibold mt-1">{t.headerText}</div>}
                    <div className="text-sm text-gray-700 whitespace-pre-wrap mt-1 line-clamp-3">{t.bodyText}</div>
                    {t.footerText && <div className="text-xs text-gray-500 mt-1 italic">{t.footerText}</div>}
                    {t.rejectionReason && <div className="text-xs text-red-600 mt-1">Rejection: {t.rejectionReason}</div>}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); startEdit(t); }} data-testid={`button-edit-template-${t.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete template "${t.name}"?`)) deleteMutation.mutate(t.id); }}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-template-details">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span className="font-mono">{viewing?.name}</span>
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Language</div>
                  <div className="font-medium">{viewing.language}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Category</div>
                  <div className="font-medium">{viewing.category}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Header type</div>
                  <div className="font-medium">{viewing.headerType || "none"}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Param count</div>
                  <div className="font-medium">{viewing.paramCount}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Namespace</div>
                  <div className="font-mono text-xs break-all">{viewing.namespace || <span className="text-amber-700">— not set —</span>}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">MSG91 Template ID</div>
                  <div className="font-mono text-xs break-all">{viewing.msg91TemplateId || <span className="text-gray-400">— not set —</span>}</div>
                </div>
              </div>

              {viewing.headerText && (
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Header</div>
                  <div className="rounded-md border bg-gray-50 px-3 py-2 font-semibold">{viewing.headerText}</div>
                </div>
              )}

              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Message body</div>
                <div className="rounded-md border bg-gray-50 px-3 py-2 whitespace-pre-wrap" data-testid="text-template-body-full">
                  {viewing.bodyText}
                </div>
              </div>

              {viewing.footerText && (
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Footer</div>
                  <div className="rounded-md border bg-gray-50 px-3 py-2 italic text-gray-600">{viewing.footerText}</div>
                </div>
              )}

              {viewing.rejectionReason && (
                <div>
                  <div className="text-xs text-red-600 uppercase tracking-wide mb-1">Rejection reason</div>
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">{viewing.rejectionReason}</div>
                </div>
              )}

              <div className="text-xs text-gray-400">Last updated {new Date(viewing.updatedAt).toLocaleString()}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
            {viewing && (
              <Button onClick={() => { const t = viewing; setViewing(null); startEdit(t); }} data-testid="button-edit-from-details">
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit template" : "Add template manually"}</DialogTitle></DialogHeader>
          {!editingId && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 -mt-2">
              <strong>Tip:</strong> Use <strong>Sync from MSG91</strong> (top-right button) to import all your approved templates automatically.
              Use this form only if you need to add a single template that didn't sync.
              The template must already be approved on MSG91 — saving here does <em>not</em> submit anything to MSG91 or Meta.{" "}
              <a href="https://control.msg91.com" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                Open MSG91 <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-sm font-medium">Template name</label>
                <Input
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_")})}
                  placeholder="continue_chat_session"
                  data-testid="input-template-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Language</label>
                <Input value={form.language} onChange={e => setForm({...form, language: e.target.value})} placeholder="en" data-testid="input-template-language" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Namespace <span className="text-red-600">*</span></label>
              <Select
                value={namespaceMode}
                onValueChange={(v: "default" | "custom") => {
                  setNamespaceMode(v);
                  if (v === "default") {
                    setForm({ ...form, namespace: DEFAULT_NAMESPACE });
                  } else {
                    setForm({ ...form, namespace: customNamespace });
                  }
                }}
              >
                <SelectTrigger data-testid="select-template-namespace-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default ({DEFAULT_NAMESPACE})</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {namespaceMode === "custom" && (
                <Input
                  className="mt-2"
                  value={customNamespace}
                  onChange={e => {
                    setCustomNamespace(e.target.value);
                    setForm({ ...form, namespace: e.target.value });
                  }}
                  placeholder="Enter your namespace"
                  data-testid="input-template-namespace"
                />
              )}
              <p className="text-xs text-gray-500 mt-1">From MSG91 → Code (JSON) → <code className="bg-gray-100 px-1 rounded">namespace</code> field. Required to send.</p>
            </div>
            <div>
              <label className="text-sm font-medium">MSG91 Template ID (optional)</label>
              <Input
                value={form.msg91TemplateId}
                onChange={e => setForm({...form, msg91TemplateId: e.target.value})}
                placeholder="Leave blank if you don't have it"
                data-testid="input-template-msg91-id"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Category</label>
                <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
                  <SelectTrigger data-testid="select-template-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utility</SelectItem>
                    <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Header</label>
                <Select value={form.headerType} onValueChange={v => setForm({...form, headerType: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                <label className="text-sm font-medium">Header text</label>
                <Input value={form.headerText} onChange={e => setForm({...form, headerText: e.target.value})} placeholder="Limited time offer!" />
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Body</label>
              <Textarea
                value={form.bodyText}
                onChange={e => setForm({...form, bodyText: e.target.value})}
                rows={6}
                placeholder="Hi {{1}}, get 20% off on {{2}} this week. Reply YES to claim."
                data-testid="input-template-body"
              />
              <p className="text-xs text-gray-500 mt-1">
                Use <code className="bg-gray-100 px-1 rounded">{`{{1}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{2}}`}</code>... for dynamic params. Detected: {paramHint} param(s).
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Footer (optional)</label>
              <Input value={form.footerText} onChange={e => setForm({...form, footerText: e.target.value})} placeholder="Reply STOP to unsubscribe" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.name.trim() || !form.bodyText.trim() || !form.namespace.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              data-testid="button-save-template"
            >
              {editingId ? "Save changes" : "Add template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
