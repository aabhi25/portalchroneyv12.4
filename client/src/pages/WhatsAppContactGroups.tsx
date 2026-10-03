import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, FileSpreadsheet, Info, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, UserPlus, Users } from "lucide-react";
import {
  AudiencePreviewLine, AudienceRulesEditor, LeadFilterFields, describeRules, useAudiencePreview,
  type AudienceRules, type LeadFilter,
} from "@/components/whatsapp/AudienceRulesEditor";

interface Audience {
  id: string;
  name: string;
  description: string;
  contactCount: number;
  updatedAt: string;
  audienceType?: string;
  rules?: AudienceRules | null;
  lastRefreshedAt?: string | null;
}

type SortKey = "recent" | "name" | "size";
type CreateMode = null | "empty" | "leads" | "dynamic";

export default function WhatsAppContactGroups() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<Audience[] | null>(null);

  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leadFilter, setLeadFilter] = useState<LeadFilter>({ lastNDays: 30 });
  const [keepUpdated, setKeepUpdated] = useState(false);
  const [rules, setRules] = useState<AudienceRules>({ source: "leads", leads: { lastNDays: 30 } });

  const { data: groups = [], isLoading } = useQuery<Audience[]>({ queryKey: ["/api/whatsapp/contact-groups"] });

  const groupNames = useMemo(() => new Map(groups.map(g => [g.id, g.name])), [groups]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = groups.filter(g => !needle || g.name.toLowerCase().includes(needle) || (g.description || "").toLowerCase().includes(needle));
    return [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name)
        : sort === "size" ? b.contactCount - a.contactCount
          : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [groups, search, sort]);

  const previewRules: AudienceRules | null =
    createMode === "leads" ? { source: "leads", leads: leadFilter }
      : createMode === "dynamic" ? rules
        : null;
  const preview = useAudiencePreview(previewRules);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/contact-groups"] });
  const closeCreate = () => {
    setCreateMode(null);
    setName("");
    setDescription("");
    setLeadFilter({ lastNDays: 30 });
    setKeepUpdated(false);
    setRules({ source: "leads", leads: { lastNDays: 30 } });
  };

  const createMutation = useMutation({
    mutationFn: async (): Promise<{ id: string }> => {
      if (createMode === "leads") {
        const r = await apiRequest<{ group: { id: string } }>("POST", "/api/whatsapp/audiences/from-leads", { name: name.trim(), description, filter: leadFilter, dynamic: keepUpdated });
        return r.group;
      }
      if (createMode === "dynamic") {
        const r = await apiRequest<{ group: { id: string } }>("POST", "/api/whatsapp/audiences/dynamic", { name: name.trim(), description, rules });
        return r.group;
      }
      return apiRequest<{ id: string }>("POST", "/api/whatsapp/contact-groups", { name: name.trim(), description });
    },
    onSuccess: group => {
      invalidate();
      closeCreate();
      toast({ title: "Audience created" });
      setLocation(`/admin/whatsapp-contact-groups/${group.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't create the audience", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => apiRequest<{ removed: number }>("POST", "/api/whatsapp/audiences/bulk-delete", { ids }),
    onSuccess: r => {
      invalidate();
      setSelected(new Set());
      setDeleteTargets(null);
      toast({ title: r.removed === 1 ? "Audience deleted" : `${r.removed} audiences deleted` });
    },
    onError: (e: Error) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: async (id: string) => apiRequest<{ added: number; total: number }>("POST", `/api/whatsapp/audiences/${id}/refresh`),
    onSuccess: r => {
      invalidate();
      toast({ title: "Audience updated", description: `${r.total.toLocaleString()} people now.` });
    },
    onError: (e: Error) => toast({ title: "Couldn't update the audience", description: e.message, variant: "destructive" }),
  });

  const allVisibleSelected = visible.length > 0 && visible.every(g => selected.has(g.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    on ? next.add(id) : next.delete(id);
    setSelected(next);
  };

  const canCreate = name.trim().length > 0 && !createMutation.isPending
    && (createMode === "empty" || (preview.data !== undefined && !preview.error));

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-teal-600" />
            Audiences
          </h1>
          <p className="text-sm text-gray-600 mt-1">The lists of people your WhatsApp campaigns are sent to.</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button data-testid="button-new-contact-group"><Plus className="h-4 w-4 mr-1" /> New audience <ChevronDown className="h-4 w-4 ml-1" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onSelect={() => setCreateMode("empty")} data-testid="menu-new-audience-empty">
              <UserPlus className="h-4 w-4 mr-2 shrink-0" />
              <div><div className="font-medium">A list you fill yourself</div><div className="text-xs text-gray-500">Import a spreadsheet or add people one by one</div></div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCreateMode("leads")} data-testid="menu-new-audience-leads">
              <Users className="h-4 w-4 mr-2 shrink-0" />
              <div><div className="font-medium">From your leads</div><div className="text-xs text-gray-500">People who contacted you, filtered by date and channel</div></div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCreateMode("dynamic")} data-testid="menu-new-audience-dynamic">
              <Sparkles className="h-4 w-4 mr-2 shrink-0" />
              <div><div className="font-medium">Self-updating audience</div><div className="text-xs text-gray-500">Saved rules — always up to date when a campaign is sent</div></div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLocation("/admin/whatsapp-ai-workbooks")}>
              <FileSpreadsheet className="h-4 w-4 mr-2 shrink-0" />
              <div><div className="font-medium">From an AI workbook</div><div className="text-xs text-gray-500">Open a workbook, pick rows, then "Create audience & campaign"</div></div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>An <strong>audience</strong> is the list of people a campaign is sent to. A <strong>workbook</strong> is your spreadsheet with AI columns — you can create an audience from a workbook. People who replied STOP are always left out when a campaign is sent.</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search audiences" className="pl-9" data-testid="input-search-audiences" />
        </div>
        <Select value={sort} onValueChange={v => setSort(v as SortKey)}>
          <SelectTrigger className="w-full sm:w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Recently updated</SelectItem>
            <SelectItem value="name">Name (A–Z)</SelectItem>
            <SelectItem value="size">Most people</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1 text-sm">
          <label className="flex items-center gap-2 text-gray-600">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={v => setSelected(v === true ? new Set(visible.map(g => g.id)) : new Set())}
              data-testid="checkbox-select-all-audiences"
            />
            {selected.size > 0 ? `${selected.size} selected` : `${visible.length} audience${visible.length === 1 ? "" : "s"}`}
          </label>
          {selected.size > 0 && (
            <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setDeleteTargets(groups.filter(g => selected.has(g.id)))} data-testid="button-bulk-delete-audiences">
              <Trash2 className="h-4 w-4 mr-1" /> Delete selected
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            <Users className="h-10 w-10 mx-auto text-teal-200 mb-3" />
            <div className="font-medium text-gray-700">No audiences yet</div>
            <div className="text-sm mt-1">Create one from a spreadsheet, from your leads, or with self-updating rules.</div>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card><CardContent className="text-center py-10 text-gray-500">No audiences match "{search}".</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {visible.map(g => {
            const dynamic = g.audienceType === "dynamic";
            const fromLeads = !dynamic && g.rules?.source === "leads";
            return (
              <Card key={g.id} className="hover:shadow-md transition-shadow" data-testid={`card-group-${g.id}`}>
                <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                  <Checkbox checked={selected.has(g.id)} onCheckedChange={v => toggle(g.id, v === true)} aria-label={`Select ${g.name}`} />
                  <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setLocation(`/admin/whatsapp-contact-groups/${g.id}`)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold truncate">{g.name}</span>
                      {dynamic && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700"><Sparkles className="h-3 w-3 mr-1" />Self-updating</Badge>}
                      {fromLeads && <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">From leads</Badge>}
                    </div>
                    {(dynamic || fromLeads) && g.rules
                      ? <div className="text-xs text-gray-500 mt-0.5 truncate">{describeRules(g.rules, groupNames)}</div>
                      : g.description && <div className="text-sm text-gray-600 mt-0.5 truncate">{g.description}</div>}
                    <div className="text-xs text-gray-500 mt-1">
                      {g.contactCount.toLocaleString()} {g.contactCount === 1 ? "person" : "people"}
                      {dynamic && g.lastRefreshedAt ? ` · counted ${new Date(g.lastRefreshedAt).toLocaleString()}` : ""}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    {(dynamic || fromLeads) && (
                      <Button variant="ghost" size="icon" title={dynamic ? "Recount now" : "Add new matching leads"} onClick={() => refreshMutation.mutate(g.id)} disabled={refreshMutation.isPending}>
                        <RefreshCw className={`h-4 w-4 text-gray-500 ${refreshMutation.isPending && refreshMutation.variables === g.id ? "animate-spin" : ""}`} />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTargets([g])} data-testid={`button-delete-group-${g.id}`} aria-label={`Delete ${g.name}`}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                    <ChevronRight className="h-5 w-5 text-gray-400 hidden sm:block" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteTargets} onOpenChange={open => { if (!open && !deleteMutation.isPending) setDeleteTargets(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTargets && deleteTargets.length > 1 ? `Delete ${deleteTargets.length} audiences?` : "Delete this audience?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTargets && deleteTargets.length === 1
                ? <>"{deleteTargets[0].name}" and its {deleteTargets[0].contactCount.toLocaleString()} people will be removed.</>
                : <>These audiences and everyone in them will be removed.</>}
              {" "}Campaigns already sent keep their history, but scheduled campaigns using them will have nobody to send to. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
              onClick={e => { e.preventDefault(); if (deleteTargets) deleteMutation.mutate(deleteTargets.map(g => g.id)); }}
              data-testid="button-confirm-delete-audiences"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createMode !== null} onOpenChange={open => { if (!open) closeCreate(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {createMode === "leads" ? "New audience from your leads" : createMode === "dynamic" ? "New self-updating audience" : "New audience"}
            </DialogTitle>
            <DialogDescription>
              {createMode === "leads"
                ? "Pick which leads to include. Each phone number is added once, and people who opted out are left out."
                : createMode === "dynamic"
                  ? "Save rules instead of a fixed list. Whenever a campaign is sent, the audience is recalculated so it always has the right people."
                  : "Create an empty list, then import a spreadsheet or add people."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={createMode === "leads" ? "Leads from last month" : "VIP customers"} data-testid="input-group-name" className="mt-1" />
            </div>
            {createMode === "empty" && (
              <div>
                <Label className="text-sm">Description (optional)</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} data-testid="input-group-description" className="mt-1" />
              </div>
            )}
            {createMode === "leads" && (
              <>
                <LeadFilterFields value={leadFilter} onChange={setLeadFilter} />
                <label className="flex items-start gap-3 rounded-lg border px-3 py-2">
                  <Switch checked={keepUpdated} onCheckedChange={setKeepUpdated} data-testid="switch-keep-updated" />
                  <span className="text-sm">
                    <span className="font-medium">Keep it updated automatically</span>
                    <span className="block text-xs text-gray-500">New matching leads join by themselves before each campaign is sent. Leave off for a fixed list.</span>
                  </span>
                </label>
              </>
            )}
            {createMode === "dynamic" && <AudienceRulesEditor value={rules} onChange={setRules} />}
            {createMode !== "empty" && createMode !== null && (
              <AudiencePreviewLine preview={preview.data} isFetching={preview.isFetching} error={preview.error as Error | null} />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCreate}>Cancel</Button>
            <Button disabled={!canCreate} onClick={() => createMutation.mutate()} data-testid="button-create-group">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Create audience
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
