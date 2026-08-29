import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AiWorkbookGrid } from "@/components/whatsapp/AiWorkbookGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft, Copy, Download, Eye, FileSpreadsheet, FolderOpen,
  Link2, Loader2, Megaphone, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Save, Upload, Wand2, X,
  Trash2,
} from "lucide-react";
import type { AiWorkbookCampaignResultMapping, AiWorkbookColumn, AiWorkbookRow, AiWorkbookSheet } from "@shared/schema";

interface WorkbookListItem {
  id: string;
  name: string;
  description: string | null;
  sourceCampaignId: string | null;
  status: string;
  updatedAt: string;
  latestVersion: {
    id: string;
    versionNumber: number;
    revision: number;
    source: string;
    rowCount: number;
    sheetCount: number;
    updatedAt: string;
  } | null;
}

interface WorkbookDetail extends Omit<WorkbookListItem, "latestVersion"> {
  versions: Array<{
    id: string;
    versionNumber: number;
    revision: number;
    source: string;
    sourceFileName: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  currentVersion: {
    id: string;
    versionNumber: number;
    revision: number;
    source: string;
    sheets: AiWorkbookSheet[];
    updatedAt: string;
  } | null;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  totalRecipients: number;
  repliedCount: number;
}

interface WorkbookResultSync {
  id: string;
  sheetId: string;
  campaignId: string | null;
  mappings: AiWorkbookCampaignResultMapping[];
  status: string;
  syncedRowCount: number;
  lastSyncedAt: string | null;
  campaign: { id: string; name: string; status: string } | null;
}

const RESULT_SOURCE_OPTIONS = [
  { value: "outcome_label", label: "Reply outcome" },
  { value: "outcome_key", label: "Outcome code" },
  { value: "delivery_status", label: "Delivery status" },
  { value: "callback_required", label: "Callback required" },
  { value: "callback_reason", label: "Callback reason" },
  { value: "customer_feedback", label: "Customer feedback" },
  { value: "reply_count", label: "Reply count" },
  { value: "first_reply_at", label: "First reply date" },
  { value: "classified_at", label: "Classified date" },
] as const;

/** Mirrors the server's detection: a linked sheet with no extra system/AI column besides name/phone was linked in custom mode. */
function isCustomLinkedSheet(sheet: AiWorkbookSheet | undefined) {
  if (!sheet) return false;
  return !sheet.columns.some(c => c.source !== "operator" && !["name", "phone"].includes(c.key));
}

interface CampaignWorkbookField {
  value: string;
  label: string;
  formats: readonly string[];
}

function MapColumnForm({
  column, fields, onSave, isPending, onCancel,
}: {
  column: AiWorkbookColumn;
  fields: CampaignWorkbookField[];
  onSave: (mapping: { source: string; format: string } | null) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  const [source, setSource] = useState(column.campaignMapping?.source || "");
  const field = fields.find(f => f.value === source);
  const [format, setFormat] = useState(column.campaignMapping?.format || field?.formats[0] || "text");
  useEffect(() => {
    const next = fields.find(f => f.value === source);
    if (next && !next.formats.includes(format)) setFormat(next.formats[0]);
  }, [source]);

  return (
    <div className="space-y-4 py-1">
      <div className="space-y-1.5">
        <Label>Campaign field</Label>
        <Select value={source || "__none__"} onValueChange={value => setSource(value === "__none__" ? "" : value)}>
          <SelectTrigger data-testid="select-map-column-source"><SelectValue placeholder="Leave unmapped" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not mapped (plain manual field)</SelectItem>
            {fields.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {source && field && field.formats.length > 1 && (
        <div className="space-y-1.5">
          <Label>Format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {field.formats.includes("text") && <SelectItem value="text">Text</SelectItem>}
              {field.formats.includes("yes_no") && <SelectItem value="yes_no">Yes / No</SelectItem>}
              {field.formats.includes("date") && <SelectItem value="date">Date</SelectItem>}
              {field.formats.includes("iso_date") && <SelectItem value="iso_date">Date & time</SelectItem>}
              {field.formats.includes("number") && <SelectItem value="number">Number</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave(source ? { source, format } : null)} disabled={isPending} data-testid="button-save-column-mapping">
          {isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />} {source ? "Save mapping" : "Clear mapping"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function uniqueColumnKey(label: string, columns: AiWorkbookColumn[]) {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "column";
  let key = base;
  for (let n = 2; columns.some(c => c.key === key); n++) key = `${base}_${n}`;
  return key;
}

function WorkbooksList() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [campaignId, setCampaignId] = useState("blank");
  const [deleteTarget, setDeleteTarget] = useState<WorkbookListItem | null>(null);

  const { data: workbooks = [], isLoading } = useQuery<WorkbookListItem[]>({
    queryKey: ["/api/whatsapp/ai-workbooks"],
  });
  const { data: campaigns = [] } = useQuery<Campaign[]>({ queryKey: ["/api/whatsapp/campaigns"] });

  const create = useMutation({
    mutationFn: () => apiRequest<WorkbookDetail>("POST", "/api/whatsapp/ai-workbooks", {
      name,
      sourceCampaignId: campaignId === "blank" ? null : campaignId,
    }),
    onSuccess: workbook => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      setCreateOpen(false);
      setLocation(`/admin/whatsapp-ai-workbooks/${workbook.id}`);
    },
    onError: (error: Error) => toast({ title: "Couldn't create workbook", description: error.message, variant: "destructive" }),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => apiRequest<WorkbookDetail>("POST", `/api/whatsapp/ai-workbooks/${id}/duplicate`),
    onSuccess: copy => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({ title: "Workbook duplicated" });
      setLocation(`/admin/whatsapp-ai-workbooks/${copy.id}`);
    },
  });
  const deleteWorkbook = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/whatsapp/ai-workbooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      setDeleteTarget(null);
      toast({ title: "Workbook deleted" });
    },
    onError: (error: Error) => toast({ title: "Couldn't delete workbook", description: error.message, variant: "destructive" }),
  });

  const openCreate = () => {
    const selected = campaigns[0];
    setCampaignId(selected?.id || "blank");
    setName(selected ? `${selected.name} Workbook` : "New AI Workbook");
    setCreateOpen(true);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => setLocation("/admin/whatsapp-campaigns")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Campaigns
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-violet-600" /> AI Workbooks
          </h1>
          <p className="text-sm text-gray-600 mt-1">Turn campaign recipients and AI reply outcomes into reusable spreadsheet workspaces.</p>
        </div>
        <Button onClick={openCreate} data-testid="button-new-ai-workbook">
          <Plus className="h-4 w-4 mr-1" /> New AI Workbook
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-gray-500">Loading workbooks…</div>
      ) : workbooks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <FileSpreadsheet className="h-10 w-10 mx-auto text-violet-300 mb-3" />
            <h2 className="font-semibold text-lg">No AI workbooks yet</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">Create one from a campaign to organise recipients, outcomes, Promise-to-Pay data, callbacks, and team notes.</p>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Create workbook</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workbooks.map(workbook => (
            <Card key={workbook.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{workbook.name}</CardTitle>
                    <p className="text-xs text-gray-500 mt-1">Updated {new Date(workbook.updatedAt).toLocaleString()}</p>
                  </div>
                  {workbook.sourceCampaignId && <Badge variant="outline">Campaign linked</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-center mb-4">
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-semibold">{workbook.latestVersion?.sheetCount ?? 0}</div><div className="text-[11px] text-gray-500">Tabs</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-semibold">{workbook.latestVersion?.rowCount?.toLocaleString() ?? 0}</div><div className="text-[11px] text-gray-500">Rows</div></div>
                  <div className="rounded-md bg-slate-50 p-2"><div className="font-semibold">v{workbook.latestVersion?.versionNumber ?? 1}</div><div className="text-[11px] text-gray-500">Version</div></div>
                </div>
                <div className="flex items-center gap-1">
                  <Button className="flex-1" size="sm" onClick={() => setLocation(`/admin/whatsapp-ai-workbooks/${workbook.id}`)}>
                    <FolderOpen className="h-4 w-4 mr-1" /> Open
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => duplicate.mutate(workbook.id)} title="Duplicate workbook">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="outline" asChild title="Export Excel">
                    <a href={`/api/whatsapp/ai-workbooks/${workbook.id}/export.xlsx`}><Download className="h-4 w-4" /></a>
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(workbook)} title="Delete workbook" data-testid={`button-delete-workbook-${workbook.id}`}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleteWorkbook.isPending) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workbook?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-semibold">"{deleteTarget?.name}"</span>, including its workbook data, version history, and linked workbook records. The connected campaign and its recipients will not be affected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteWorkbook.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              onClick={event => {
                event.preventDefault();
                if (deleteTarget && !deleteWorkbook.isPending) deleteWorkbook.mutate(deleteTarget.id);
              }}
              disabled={deleteWorkbook.isPending}
              data-testid="button-confirm-delete-workbook"
            >
              {deleteWorkbook.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create AI workbook</DialogTitle>
            <DialogDescription>Start blank or generate a single table from an existing campaign snapshot.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Workbook name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Source campaign</Label>
              <Select value={campaignId} onValueChange={value => {
                setCampaignId(value);
                const campaign = campaigns.find(c => c.id === value);
                if (campaign) setName(`${campaign.name} Workbook`);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">Blank workbook</SelectItem>
                  {campaigns.map(campaign => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name} · {campaign.repliedCount} replies
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Create workbook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkbookEditor({ id }: { id: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sheets, setSheets] = useState<AiWorkbookSheet[]>([]);
  const [dirty, setDirty] = useState(false);
  const [selectedRows, setSelectedRows] = useState(new Set<string>());
  const [filteredRows, setFilteredRows] = useState<AiWorkbookRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingInstruction, setMappingInstruction] = useState("");
  const [resultMappings, setResultMappings] = useState<AiWorkbookCampaignResultMapping[]>([]);
  const [mappingFeedback, setMappingFeedback] = useState<{ confidence: "low" | "medium" | "high"; warnings: string[] } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkCampaignId, setLinkCampaignId] = useState("");
  const [linkMode, setLinkMode] = useState<"full" | "custom">("full");
  const [mapColumnTarget, setMapColumnTarget] = useState<AiWorkbookColumn | null>(null);

  const { data: workbook, isLoading } = useQuery<WorkbookDetail>({
    queryKey: [`/api/whatsapp/ai-workbooks/${id}`],
    refetchOnMount: "always",
  });
  const { data: previewVersion, isFetching: previewLoading } = useQuery<{
    id: string;
    versionNumber: number;
    revision: number;
    source: string;
    sourceFileName: string | null;
    sheets: AiWorkbookSheet[];
    updatedAt: string;
  }>({
    queryKey: [`/api/whatsapp/ai-workbooks/${id}/versions/${previewVersionId}`],
    enabled: Boolean(previewVersionId),
  });
  const { data: resultSyncs = [] } = useQuery<WorkbookResultSync[]>({
    queryKey: [`/api/whatsapp/ai-workbooks/${id}/result-syncs`],
    enabled: Boolean(workbook),
  });
  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["/api/whatsapp/campaigns"],
    enabled: Boolean(workbook) && (linkOpen || Boolean(workbook?.sourceCampaignId)),
  });
  const linkedCampaign = workbook?.sourceCampaignId
    ? campaigns.find(campaign => campaign.id === workbook.sourceCampaignId) || null
    : null;
  const isCustomLinked = Boolean(workbook?.sourceCampaignId) && isCustomLinkedSheet(sheets[0]);
  const { data: campaignFields } = useQuery<{ fields: CampaignWorkbookField[]; captureFields: CampaignWorkbookField[] }>({
    queryKey: [`/api/whatsapp/campaigns/${workbook?.sourceCampaignId}/workbook-fields`],
    enabled: Boolean(workbook?.sourceCampaignId) && isCustomLinked,
  });
  const mappableFields = [...(campaignFields?.fields || []), ...(campaignFields?.captureFields || [])];
  const campaignIsLive = Boolean(linkedCampaign && ["running", "sending", "scheduled", "in_progress", "active"].includes(linkedCampaign.status));
  const lastCampaignSync = workbook?.versions
    ?.filter(version => version.source === "campaign" || version.source === "campaign_sync")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

  useEffect(() => {
    if (!workbook?.currentVersion || dirty) return;
    setSheets(workbook.currentVersion.sheets || []);
  }, [workbook?.currentVersion?.id, workbook?.currentVersion?.revision]);

  const activeSheet = sheets[0];
  const resultDestinationColumns = (activeSheet?.columns || []).filter(column => !["name", "phone"].includes(column.key));
  const activeResultSync = resultSyncs.find(sync => sync.sheetId === activeSheet?.id && sync.campaignId) || null;
  const addResultMapping = () => {
    const destination = resultDestinationColumns.find(column => !resultMappings.some(mapping => mapping.destinationColumnKey === column.key));
    if (!destination) {
      toast({ title: "No available destination columns", description: "Add another team column before mapping more campaign results.", variant: "destructive" });
      return;
    }
    setResultMappings(current => [...current, {
      destinationColumnKey: destination.key,
      source: "outcome_label",
      format: "text",
      overwrite: "if_empty",
    }]);
  };
  const updateResultMapping = (index: number, patch: Partial<AiWorkbookCampaignResultMapping>) => {
    setResultMappings(current => current.map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, ...patch } : mapping));
  };
  const updateSheet = (next: AiWorkbookSheet) => {
    setSheets(current => current.map(sheet => sheet.id === next.id ? next : sheet));
    setDirty(true);
  };

  const removeColumn = (sheetId: string, columnKey: string) => {
    setSheets(current => current.map(sheet => {
      if (sheet.id !== sheetId) return sheet;
      if (sheet.columns.length <= 1) {
        toast({ title: "Keep at least one column", description: "A sheet must contain one column.", variant: "destructive" });
        return sheet;
      }
      return {
        ...sheet,
        columns: sheet.columns.filter(column => column.key !== columnKey),
        rows: sheet.rows.map(row => {
          const values = { ...row.values };
          delete values[columnKey];
          return { ...row, values };
        }),
      };
    }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => apiRequest<WorkbookDetail["currentVersion"]>("PUT", `/api/whatsapp/ai-workbooks/${id}/versions/${workbook!.currentVersion!.id}`, {
      revision: workbook!.currentVersion!.revision,
      sheets,
    }),
    onSuccess: version => {
      setDirty(false);
      queryClient.setQueryData<WorkbookDetail>([`/api/whatsapp/ai-workbooks/${id}`], current => current && version
        ? { ...current, currentVersion: version as NonNullable<WorkbookDetail["currentVersion"]> }
        : current);
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({ title: "Workbook saved" });
    },
    onError: (error: Error) => toast({ title: "Couldn't save workbook", description: error.message, variant: "destructive" }),
  });

  const createVersion = useMutation({
    mutationFn: (payload?: { sheets?: AiWorkbookSheet[]; source?: string; sourceFileName?: string }) =>
      apiRequest("POST", `/api/whatsapp/ai-workbooks/${id}/versions`, {
        ...(payload || { sheets, source: "manual" }),
        expectedCurrentVersionId: workbook!.currentVersion!.id,
        expectedRevision: workbook!.currentVersion!.revision,
      }),
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/ai-workbooks/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({ title: "New workbook version created" });
    },
    onError: (error: Error) => toast({ title: "Couldn't create version", description: error.message, variant: "destructive" }),
  });

  const restoreVersion = useMutation({
    mutationFn: () => {
      const currentVersion = workbook?.currentVersion;
      if (!previewVersion || !currentVersion) throw new Error("Choose an older version first");
      return apiRequest(
        "POST",
        `/api/whatsapp/ai-workbooks/${id}/versions/${previewVersion.id}/restore`,
        {
          expectedCurrentVersionId: currentVersion.id,
          expectedRevision: currentVersion.revision,
        },
      );
    },
    onSuccess: () => {
      setPreviewVersionId(null);
      setHistoryOpen(false);
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/ai-workbooks/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({ title: "Version restored", description: "The older workbook is now the current version, and the previous history remains available." });
    },
    onError: (error: Error) => toast({ title: "Couldn't restore version", description: error.message, variant: "destructive" }),
  });

  const rename = useMutation({
    mutationFn: () => apiRequest<{ id: string; name: string; updatedAt: string }>(
      "PATCH",
      `/api/whatsapp/ai-workbooks/${id}`,
      { name: renameValue.trim() },
    ),
    onSuccess: updated => {
      setRenameOpen(false);
      queryClient.setQueryData<WorkbookDetail>([`/api/whatsapp/ai-workbooks/${id}`], current => current
        ? { ...current, name: updated.name, updatedAt: updated.updatedAt }
        : current);
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({ title: "Workbook renamed" });
    },
    onError: (error: Error) => toast({ title: "Couldn't rename workbook", description: error.message, variant: "destructive" }),
  });

  const linkCampaign = useMutation({
    mutationFn: (input: { campaignId: string | null; mode: "full" | "custom" }) => apiRequest("POST", `/api/whatsapp/ai-workbooks/${id}/link`, {
      campaignId: input.campaignId,
      mode: input.mode,
      expectedCurrentVersionId: workbook?.currentVersion?.id,
      expectedRevision: workbook?.currentVersion?.revision,
    }),
    onSuccess: (_result, input) => {
      setLinkOpen(false);
      setLinkCampaignId("");
      setLinkMode("full");
      if (input.campaignId) setDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/ai-workbooks/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast(input.campaignId
        ? { title: "Workbook linked to campaign", description: input.mode === "custom"
            ? "Rows were pulled in with Name and Phone only. Add your own columns and map them to campaign fields when you're ready."
            : "Campaign data was pulled in. Rows were matched by phone number and your columns were kept." }
        : { title: "Campaign unlinked", description: "The workbook is independent again. Its data was not changed." });
    },
    onError: (error: Error) => toast({ title: "Couldn't update campaign link", description: error.message, variant: "destructive" }),
  });

  const openMapColumn = (column: AiWorkbookColumn) => {
    if (dirty) {
      toast({ title: "Save your changes first", description: "Mapping a column creates a new workbook version.", variant: "destructive" });
      return;
    }
    setMapColumnTarget(column);
  };

  const mapColumn = useMutation({
    mutationFn: (input: { columnKey: string; mapping: { source: string; format: string } | null }) =>
      apiRequest("POST", `/api/whatsapp/ai-workbooks/${id}/columns/map`, {
        ...input,
        expectedCurrentVersionId: workbook?.currentVersion?.id,
        expectedRevision: workbook?.currentVersion?.revision,
      }),
    onSuccess: () => {
      setMapColumnTarget(null);
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/ai-workbooks/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({ title: "Column mapping updated" });
    },
    onError: (error: Error) => toast({ title: "Couldn't update column mapping", description: error.message, variant: "destructive" }),
  });

  const refresh = useMutation({
    mutationFn: () => apiRequest("POST", `/api/whatsapp/ai-workbooks/${id}/refresh`),
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/ai-workbooks/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({ title: "Campaign outcomes refreshed", description: "Team columns and notes were preserved in a new version." });
    },
    onError: (error: Error) => toast({ title: "Refresh failed", description: error.message, variant: "destructive" }),
  });

  const suggestResultMappings = useMutation({
    mutationFn: () => {
      if (!activeSheet) throw new Error("Workbook sheet is unavailable");
      return apiRequest<{
        mappings: AiWorkbookCampaignResultMapping[];
        mode: "ai" | "header_suggestions";
        confidence: "low" | "medium" | "high";
        warnings: string[];
      }>(
        "POST",
        `/api/whatsapp/ai-workbooks/${id}/result-mapping-suggestions`,
        { sheetId: activeSheet.id, instruction: mappingInstruction },
      );
    },
    onSuccess: result => {
      setResultMappings(result.mappings);
      setMappingFeedback({ confidence: result.confidence, warnings: result.warnings });
      toast({
        title: result.mode === "ai" ? "AI mapping ready for review" : "Column suggestions ready for review",
        description: "Confirm or edit the destinations before creating the campaign.",
      });
    },
    onError: (error: Error) => toast({ title: "Couldn't suggest a result mapping", description: error.message, variant: "destructive" }),
  });

  const syncCampaignResults = useMutation({
    mutationFn: (linkId: string) => apiRequest<{ updatedRows: number; changedCells: number }>(
      "POST",
      `/api/whatsapp/ai-workbooks/${id}/result-syncs/${linkId}/sync`,
    ),
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/ai-workbooks/${id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/ai-workbooks/${id}/result-syncs`] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({
        title: result.updatedRows ? "Campaign results synced" : "No new campaign results to sync",
        description: result.updatedRows ? `${result.updatedRows} workbook rows were updated in a new version.` : undefined,
      });
    },
    onError: (error: Error) => toast({ title: "Couldn't sync campaign results", description: error.message, variant: "destructive" }),
  });

  const createAudience = useMutation({
    mutationFn: () => {
      if (!activeSheet) throw new Error("Workbook sheet is unavailable");
      const sourceRows = selectedRows.size > 0
        ? activeSheet.rows.filter(row => selectedRows.has(row.id))
        : filteredRows;
      return apiRequest<{ group: { id: string }; importedContacts: number; skippedRows: number; resultSync: { id: string } | null }>(
        "POST",
        `/api/whatsapp/ai-workbooks/${id}/audience`,
        {
          sheetId: activeSheet.id,
          rowIds: sourceRows.map(row => row.id),
          groupName: `${workbook?.name || "AI Workbook"} audience`,
          resultMappings,
        },
      );
    },
    onSuccess: result => {
      toast({
        title: `${result.importedContacts} contacts ready`,
        description: result.resultSync
          ? "Campaign results will be ready to sync back after replies are classified."
          : result.skippedRows ? `${result.skippedRows} invalid or duplicate rows were skipped.` : undefined,
      });
      setLocation(`/admin/whatsapp-campaigns/new?group=${result.group.id}&workbook=${encodeURIComponent(workbook?.name || "AI Workbook")}`);
    },
    onError: (error: Error) => toast({ title: "Couldn't create campaign audience", description: error.message, variant: "destructive" }),
  });

  const importExcel = async (file: File) => {
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("Excel files are limited to 15 MB");
      const XLSX = await import("xlsx");
      const parsed = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      if (parsed.SheetNames.length !== 1) throw new Error("Please import an Excel file with exactly one sheet");
      const name = parsed.SheetNames[0];
      const matrix = XLSX.utils.sheet_to_json<any[]>(parsed.Sheets[name], { header: 1, defval: "" });
      const headers = (matrix[0] || []).map(value => String(value).trim());
      const existing = sheets[0];
      const visibleHeaders = headers.filter(header => header && !header.startsWith("_"));
      const columns: AiWorkbookColumn[] = [];
      for (const label of visibleHeaders.slice(0, 100)) {
        const matched = existing?.columns.find(c => c.label === label);
        columns.push(matched || {
          key: uniqueColumnKey(label, columns),
          label,
          type: "text",
          source: "operator",
          editable: true,
        });
      }
      const rowIdIndex = headers.indexOf("_row_id");
      const sourceIdIndex = headers.indexOf("_source_recipient_id");
      const rows: AiWorkbookRow[] = matrix.slice(1, 50_001).filter(row => row.some(value => String(value).trim() !== "")).map(row => {
        const values: AiWorkbookRow["values"] = {};
        for (const col of columns) {
          const headerIndex = headers.indexOf(col.label);
          values[col.key] = row[headerIndex] === "" ? null : row[headerIndex];
        }
        return {
          id: rowIdIndex >= 0 && row[rowIdIndex] ? String(row[rowIdIndex]) : crypto.randomUUID(),
          sourceRecipientId: sourceIdIndex >= 0 && row[sourceIdIndex] ? String(row[sourceIdIndex]) : undefined,
          values,
        };
      });
      if (columns.length === 0) throw new Error("No sheet with headers was found");
      const imported = {
        id: existing?.id || crypto.randomUUID(),
        name: name || existing?.name || "Sheet 1",
        kind: existing?.kind || "custom" as const,
        columns,
        rows,
      };
      createVersion.mutate({ sheets: [imported], source: "import", sourceFileName: file.name });
    } catch (error: any) {
      toast({ title: "Excel import failed", description: error.message, variant: "destructive" });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (isLoading || !workbook) return <div className="p-6 text-gray-500">Loading workbook…</div>;
  if (!workbook.currentVersion || !activeSheet) return <div className="p-6">This workbook has no editable version.</div>;

  return (
    <div className="min-h-screen bg-slate-50/60 p-4 md:p-8">
      <div className="max-w-[1800px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-5 mb-6">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-3 text-slate-500 hover:text-slate-900" onClick={() => setLocation("/admin/whatsapp-ai-workbooks")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> AI Workbooks
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900 truncate">{workbook.name}</h1>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-slate-400 hover:bg-violet-50 hover:text-violet-700"
              title="Rename workbook"
              aria-label="Rename workbook"
              onClick={() => {
                setRenameValue(workbook.name);
                setRenameOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-slate-500">
            {workbook.sourceCampaignId ? (
              <span className="inline-flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                {linkedCampaign ? `Linked to ${linkedCampaign.name}` : "Linked campaign workbook"}
                {campaignIsLive && (
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0 text-[10px]">
                    Campaign running — new replies may arrive
                  </Badge>
                )}
              </span>
            ) : (
              <span>Independent workbook</span>
            )}
            <span className="text-slate-300">•</span>
            <span>Last saved {new Date(workbook.currentVersion.updatedAt).toLocaleString()}</span>
            {lastCampaignSync && (
              <><span className="text-slate-300">•</span><span>Last synced {new Date(lastCampaignSync.createdAt).toLocaleString()}</span></>
            )}
            {dirty && <><span className="text-slate-300">•</span><span className="font-medium text-amber-600">Unsaved changes</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {workbook.sourceCampaignId ? (
            <Button
              variant="outline"
              className="bg-white border-slate-200 text-slate-700 shadow-sm"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending || dirty}
              title={dirty ? "Save your changes before refreshing" : "Pull the latest campaign replies into this workbook"}
              data-testid="button-refresh-outcomes"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh outcomes
            </Button>
          ) : (
            <Button
              variant="outline"
              className="bg-white border-slate-200 text-slate-700 shadow-sm"
              onClick={() => setLinkOpen(true)}
              data-testid="button-link-campaign"
            >
              <Link2 className="h-4 w-4 mr-2" /> Link campaign
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="bg-white border-slate-200 text-slate-700 shadow-sm">
                <MoreHorizontal className="h-4 w-4 mr-2" /> More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {workbook.sourceCampaignId && (
                <>
                  <DropdownMenuItem onSelect={() => refresh.mutate()} disabled={refresh.isPending || dirty}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh outcomes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => linkCampaign.mutate({ campaignId: null, mode: "full" })} disabled={linkCampaign.isPending || dirty}>
                    <X className="h-4 w-4 mr-2" /> Unlink campaign
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onSelect={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Import Excel
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/whatsapp/ai-workbooks/${id}/export.xlsx`}><Download className="h-4 w-4 mr-2" /> Export Excel</a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                <Eye className="h-4 w-4 mr-2" /> Version history
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => {
            const file = e.target.files?.[0];
            if (file) void importExcel(file);
          }} />
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="min-w-[104px] shadow-sm">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} {save.isPending ? "Saving" : "Save"}
          </Button>
        </div>
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardContent className="p-3 md:p-5">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 mb-4 px-1 pb-3">
            <div className="text-sm font-medium text-slate-700">{activeSheet.name}</div>
            <div className="text-xs text-slate-500">{activeSheet.rows.length.toLocaleString()} rows</div>
          </div>
          <AiWorkbookGrid
            sheet={activeSheet}
            onChange={updateSheet}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            onFilteredRowsChange={setFilteredRows}
            onRemoveColumn={columnKey => removeColumn(activeSheet.id, columnKey)}
            mappableFields={isCustomLinked ? mappableFields : undefined}
            onMapColumn={isCustomLinked ? openMapColumn : undefined}
          />
        </CardContent>
      </Card>

      <Dialog open={Boolean(mapColumnTarget)} onOpenChange={open => !open && setMapColumnTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Map "{mapColumnTarget?.label}"</DialogTitle>
            <DialogDescription>
              Choose a campaign field to feed this column. It fills in now and again on every refresh. Leave it unmapped to keep this as a plain manual field.
            </DialogDescription>
          </DialogHeader>
          {mapColumnTarget && (
            <MapColumnForm
              column={mapColumnTarget}
              fields={mappableFields}
              onSave={mapping => mapColumn.mutate({ columnKey: mapColumnTarget.key, mapping })}
              isPending={mapColumn.isPending}
              onCancel={() => setMapColumnTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={open => { setLinkOpen(open); if (!open) { setLinkCampaignId(""); setLinkMode("full"); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link this workbook to a campaign</DialogTitle>
            <DialogDescription>
              Campaign replies and outcomes are pulled into this workbook. Existing rows are matched by phone number, and your own columns and notes are kept. You can refresh anytime — even while the campaign is still running.
            </DialogDescription>
          </DialogHeader>
          <div className="py-1 space-y-4">
            <div>
              <Label>Campaign</Label>
              <Select value={linkCampaignId} onValueChange={setLinkCampaignId}>
                <SelectTrigger className="mt-1" data-testid="select-link-campaign">
                  <SelectValue placeholder="Choose a campaign…" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map(campaign => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      <div className="flex items-center gap-2">
                        <span className="truncate">{campaign.name}</span>
                        <span className="text-xs text-slate-400">
                          {campaign.totalRecipients} recipients · {campaign.status}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {campaigns.length === 0 && (
                <p className="text-xs text-slate-500 mt-2">No campaigns yet — create one from All campaigns first.</p>
              )}
            </div>
            <div>
              <Label>Columns</Label>
              <div className="mt-1.5 space-y-2">
                <button
                  type="button"
                  onClick={() => setLinkMode("full")}
                  data-testid="button-link-mode-full"
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${linkMode === "full" ? "border-violet-400 bg-violet-50/60" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <div className="text-sm font-medium text-slate-700">All columns as configured</div>
                  <div className="text-xs text-slate-500">Pull in every system and AI column the campaign defines.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setLinkMode("custom")}
                  data-testid="button-link-mode-custom"
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${linkMode === "custom" ? "border-violet-400 bg-violet-50/60" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <div className="text-sm font-medium text-slate-700">Custom columns</div>
                  <div className="text-xs text-slate-500">Only Name and Phone are pulled in. Add your own columns and choose what campaign data feeds them.</div>
                </button>
              </div>
            </div>
            {dirty && (
              <p className="text-xs text-amber-600">You have unsaved changes. Save them first — linking creates a new workbook version.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button
              onClick={() => linkCampaign.mutate({ campaignId: linkCampaignId, mode: linkMode })}
              disabled={!linkCampaignId || linkCampaign.isPending || dirty}
              data-testid="button-confirm-link-campaign"
            >
              {linkCampaign.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />} Link campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mappingOpen} onOpenChange={setMappingOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Connect campaign results</DialogTitle>
            <DialogDescription>
              Describe where campaign results should go. AI only reviews the column headers and your instruction; you confirm every result before it is used.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="result-mapping-instruction">What should be written back?</Label>
              <Textarea
                id="result-mapping-instruction"
                value={mappingInstruction}
                onChange={event => setMappingInstruction(event.target.value)}
                placeholder='Example: Put the reply outcome in Result, callback status in Follow-up Required, and the first reply date in Last Contacted.'
                rows={3}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">No customer names, phone numbers, or reply content are sent for this suggestion.</p>
                <Button variant="outline" size="sm" onClick={() => suggestResultMappings.mutate()} disabled={suggestResultMappings.isPending}>
                  {suggestResultMappings.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
                  Suggest with AI
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b bg-slate-50 px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-slate-800">Result mapping</div>
                  <div className="text-xs text-slate-500">Each selected result writes to one workbook column.</div>
                </div>
                <Button variant="ghost" size="sm" onClick={addResultMapping}><Plus className="h-4 w-4 mr-1" /> Add column</Button>
              </div>
              {resultMappings.length === 0 ? (
                <div className="p-5 text-sm text-slate-500">
                  Add a destination manually, or describe your preferred result columns and let AI prepare a suggestion.
                </div>
              ) : (
                <div className="divide-y">
                  {resultMappings.map((mapping, index) => (
                    <div key={`${mapping.destinationColumnKey}-${index}`} className="grid gap-2 p-3 md:grid-cols-[minmax(0,1.1fr),minmax(0,1.1fr),130px,130px,32px] md:items-center">
                      <Select value={mapping.destinationColumnKey} onValueChange={value => updateResultMapping(index, { destinationColumnKey: value })}>
                        <SelectTrigger><SelectValue placeholder="Workbook column" /></SelectTrigger>
                        <SelectContent>
                          {resultDestinationColumns.map(column => <SelectItem key={column.key} value={column.key}>{column.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="space-y-1">
                        <Select
                          value={mapping.source.startsWith("capture:") ? "__capture__" : mapping.source}
                          onValueChange={value => updateResultMapping(index, {
                            source: (value === "__capture__" ? "capture:" : value) as AiWorkbookCampaignResultMapping["source"],
                            format: value === "callback_required" ? "yes_no" : value === "reply_count" ? "number" : ["first_reply_at", "classified_at"].includes(value) ? "date" : "text",
                          })}
                        >
                          <SelectTrigger><SelectValue placeholder="Campaign result" /></SelectTrigger>
                          <SelectContent>
                            {RESULT_SOURCE_OPTIONS.map(source => <SelectItem key={source.value} value={source.value}>{source.label}</SelectItem>)}
                            <SelectItem value="__capture__">Captured field…</SelectItem>
                          </SelectContent>
                        </Select>
                        {mapping.source.startsWith("capture:") && (
                          <Input
                            value={mapping.source.slice("capture:".length)}
                            onChange={event => updateResultMapping(index, {
                              source: `capture:${event.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}` as AiWorkbookCampaignResultMapping["source"],
                            })}
                            placeholder="e.g. promised_date"
                            className="h-8 text-xs"
                          />
                        )}
                      </div>
                      <Select value={mapping.format} onValueChange={value => updateResultMapping(index, { format: value as AiWorkbookCampaignResultMapping["format"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Text</SelectItem>
                          <SelectItem value="yes_no">Yes / No</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                          <SelectItem value="iso_date">Date & time</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={mapping.overwrite} onValueChange={value => updateResultMapping(index, { overwrite: value as AiWorkbookCampaignResultMapping["overwrite"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="if_empty">Keep edits</SelectItem>
                          <SelectItem value="always">Replace values</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="Remove result mapping"
                        onClick={() => setResultMappings(current => current.filter((_, mappingIndex) => mappingIndex !== index))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {mappingFeedback && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${
                mappingFeedback.confidence === "high"
                  ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                  : "border-amber-100 bg-amber-50 text-amber-900"
              }`}>
                <div className="font-medium capitalize">{mappingFeedback.confidence} confidence suggestion</div>
                {mappingFeedback.warnings.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {mappingFeedback.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingOpen(false)}>Cancel</Button>
            <Button
              onClick={() => setMappingOpen(false)}
              disabled={resultMappings.some(mapping => mapping.source === "capture:")}
            >
              Use this mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename workbook</DialogTitle>
            <DialogDescription>Choose a clear name your team will recognize in the workbook library.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={event => setRenameValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && renameValue.trim() && !rename.isPending) rename.mutate();
            }}
            placeholder="e.g. April Promise-to-Pay follow-up"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button onClick={() => rename.mutate()} disabled={!renameValue.trim() || rename.isPending}>
              {rename.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={open => {
        setHistoryOpen(open);
        if (!open) setPreviewVersionId(null);
      }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>Open any prior version in read-only mode. Restoring creates a new current version and keeps all history intact.</DialogDescription>
          </DialogHeader>
          <div className="grid md:grid-cols-[240px,minmax(0,1fr)] gap-4 min-h-0 flex-1 overflow-hidden">
            <div className="border rounded-lg overflow-y-auto">
              {workbook.versions.map(version => {
                const current = version.id === workbook.currentVersion?.id;
                return (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setPreviewVersionId(version.id)}
                    className={`w-full text-left p-3 border-b last:border-b-0 hover:bg-slate-50 ${
                      previewVersionId === version.id ? "bg-violet-50 ring-1 ring-inset ring-violet-200" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm">Version {version.versionNumber}</span>
                      {current && <Badge variant="outline" className="text-[10px]">Current</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 capitalize">{version.source}{version.sourceFileName ? ` · ${version.sourceFileName}` : ""}</div>
                    <div className="mt-1 text-[11px] text-gray-400">{new Date(version.updatedAt).toLocaleString()}</div>
                  </button>
                );
              })}
            </div>
            <div className="min-w-0 overflow-auto border rounded-lg p-3">
              {!previewVersionId ? (
                <div className="h-full min-h-48 flex items-center justify-center text-sm text-gray-500">Select a version to preview it.</div>
              ) : previewLoading ? (
                <div className="h-full min-h-48 flex items-center justify-center text-sm text-gray-500"><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading version…</div>
              ) : previewVersion ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <div className="font-semibold">Version {previewVersion.versionNumber}</div>
                      <div className="text-xs text-gray-500 capitalize">Read-only preview · {previewVersion.source}</div>
                    </div>
                    {previewVersion.id !== workbook.currentVersion.id && (
                      <Button
                        onClick={() => restoreVersion.mutate()}
                        disabled={restoreVersion.isPending || dirty}
                        title={dirty ? "Save or discard your current edits before restoring a version" : undefined}
                      >
                        {restoreVersion.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                        Restore as new version
                      </Button>
                    )}
                  </div>
                  {dirty && previewVersion.id !== workbook.currentVersion.id && (
                    <p className="mb-3 text-xs text-amber-700">Save or discard current edits before restoring an older version.</p>
                  )}
                  {previewVersion.sheets[0] ? (
                    <AiWorkbookGrid
                      sheet={previewVersion.sheets[0]}
                      onChange={() => undefined}
                      selectedRows={new Set()}
                      onSelectedRowsChange={() => undefined}
                      readOnly
                    />
                  ) : null}
                </>
              ) : (
                <div className="h-full min-h-48 flex items-center justify-center text-sm text-red-600">This version is no longer available.</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-100 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-violet-50 p-2"><Megaphone className="h-4 w-4 text-violet-600" /></div>
          <div>
          <div className="font-semibold text-slate-900">Run another campaign</div>
          <p className="text-xs text-slate-500 mt-0.5">
            {selectedRows.size > 0
              ? `Create a protected campaign audience from ${selectedRows.size.toLocaleString()} selected rows.`
              : `Create a protected campaign audience from ${filteredRows.length.toLocaleString()} currently filtered rows.`}
          </p>
          <p className="text-xs text-violet-700 mt-1">
            {resultMappings.length
              ? `${resultMappings.length} campaign result ${resultMappings.length === 1 ? "column" : "columns"} ready to sync back.`
              : "Optional: map campaign results back into this sheet before creating the audience."}
          </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="border-slate-200 text-slate-700 hover:bg-slate-50" onClick={() => setMappingOpen(true)}>
            <Wand2 className="h-4 w-4 mr-1" /> Map results
          </Button>
          <Button
            variant="outline"
            className="border-violet-200 text-violet-700 hover:bg-violet-50"
            onClick={() => createAudience.mutate()}
            disabled={createAudience.isPending || (selectedRows.size === 0 && filteredRows.length === 0) || resultMappings.some(mapping => mapping.source === "capture:")}
          >
            {createAudience.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create campaign
          </Button>
        </div>
      </div>
      {activeResultSync && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50/50 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-white p-2 shadow-sm"><Link2 className="h-4 w-4 text-sky-700" /></div>
            <div>
              <div className="font-medium text-slate-900">Campaign results connected{activeResultSync.campaign ? ` · ${activeResultSync.campaign.name}` : ""}</div>
              <p className="mt-0.5 text-xs text-slate-600">
                {activeResultSync.lastSyncedAt
                  ? `${activeResultSync.syncedRowCount} rows were updated ${new Date(activeResultSync.lastSyncedAt).toLocaleString()}.`
                  : `${activeResultSync.mappings.length} mapped columns are ready to receive campaign replies and delivery results.`}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-sky-200 bg-white text-sky-800 hover:bg-sky-100"
            onClick={() => syncCampaignResults.mutate(activeResultSync.id)}
            disabled={syncCampaignResults.isPending || dirty}
            title={dirty ? "Save current workbook edits before syncing campaign results" : undefined}
          >
            {syncCampaignResults.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Sync results
          </Button>
        </div>
      )}
      </div>
    </div>
  );
}

export default function WhatsAppAiWorkbooks({ id }: { id?: string }) {
  return id ? <WorkbookEditor id={id} /> : <WorkbooksList />;
}
