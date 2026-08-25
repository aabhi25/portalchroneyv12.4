import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AiWorkbookGrid } from "@/components/whatsapp/AiWorkbookGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Archive, ArrowLeft, Copy, Download, Eye, FileSpreadsheet, FolderOpen, History,
  Loader2, Megaphone, Plus, RefreshCw, RotateCcw, Save, Sheet, Upload, X,
} from "lucide-react";
import type { AiWorkbookColumn, AiWorkbookRow, AiWorkbookSheet } from "@shared/schema";

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
  const archive = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/whatsapp/ai-workbooks/${id}`, { status: "archived" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/ai-workbooks"] });
      toast({ title: "Workbook archived" });
    },
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
                  <Button size="icon" variant="ghost" onClick={() => archive.mutate(workbook.id)} title="Archive workbook">
                    <Archive className="h-4 w-4 text-gray-500" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create AI workbook</DialogTitle>
            <DialogDescription>Start blank or generate tabs from an existing campaign snapshot.</DialogDescription>
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
  const [activeSheetId, setActiveSheetId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [selectedRows, setSelectedRows] = useState(new Set<string>());
  const [filteredRows, setFilteredRows] = useState<AiWorkbookRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [previewSheetId, setPreviewSheetId] = useState("");
  const [sheetToRemove, setSheetToRemove] = useState<AiWorkbookSheet | null>(null);

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

  useEffect(() => {
    if (!workbook?.currentVersion || dirty) return;
    setSheets(workbook.currentVersion.sheets || []);
    setActiveSheetId(current => current && workbook.currentVersion!.sheets.some(s => s.id === current)
      ? current
      : workbook.currentVersion!.sheets[0]?.id || "");
  }, [workbook?.currentVersion?.id, workbook?.currentVersion?.revision]);

  useEffect(() => {
    if (!previewVersion) return;
    setPreviewSheetId(previewVersion.sheets[0]?.id || "");
  }, [previewVersion?.id]);

  const activeSheet = sheets.find(sheet => sheet.id === activeSheetId) || sheets[0];
  const updateSheet = (next: AiWorkbookSheet) => {
    setSheets(current => current.map(sheet => sheet.id === next.id ? next : sheet));
    setDirty(true);
  };

  const removeSheet = (sheetId: string) => {
    const sheet = sheets.find(item => item.id === sheetId);
    if (!sheet || sheets.length <= 1) {
      toast({ title: "Keep at least one tab", description: "A workbook must contain one tab.", variant: "destructive" });
      return;
    }
    const next = sheets.filter(item => item.id !== sheetId);
    setSheets(next);
    if (activeSheetId === sheetId) setActiveSheetId(next[0].id);
    setSelectedRows(new Set());
    setDirty(true);
  };

  const removeColumn = (sheetId: string, columnKey: string) => {
    setSheets(current => current.map(sheet => {
      if (sheet.id !== sheetId) return sheet;
      if (sheet.columns.length <= 1) {
        toast({ title: "Keep at least one column", description: "A tab must contain one column.", variant: "destructive" });
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

  const createAudience = useMutation({
    mutationFn: () => {
      if (!activeSheet) throw new Error("Choose a workbook tab");
      const sourceRows = selectedRows.size > 0
        ? activeSheet.rows.filter(row => selectedRows.has(row.id))
        : filteredRows;
      return apiRequest<{ group: { id: string }; importedContacts: number; skippedRows: number }>(
        "POST",
        `/api/whatsapp/ai-workbooks/${id}/audience`,
        {
          sheetId: activeSheet.id,
          rowIds: sourceRows.map(row => row.id),
          groupName: `${workbook?.name || "AI Workbook"} audience`,
        },
      );
    },
    onSuccess: result => {
      toast({ title: `${result.importedContacts} contacts ready`, description: result.skippedRows ? `${result.skippedRows} invalid or duplicate rows were skipped.` : undefined });
      setLocation(`/admin/whatsapp-campaigns/new?group=${result.group.id}&workbook=${encodeURIComponent(workbook?.name || "AI Workbook")}`);
    },
    onError: (error: Error) => toast({ title: "Couldn't create campaign audience", description: error.message, variant: "destructive" }),
  });

  const addTab = () => {
    const id = crypto.randomUUID();
    setSheets(current => [...current, {
      id,
      name: `Sheet ${current.length + 1}`,
      kind: "custom",
      columns: [
        { key: "name", label: "Name", type: "text", source: "operator", editable: true },
        { key: "phone", label: "Phone", type: "text", source: "operator", editable: true },
      ],
      rows: [],
    }]);
    setActiveSheetId(id);
    setDirty(true);
  };

  const importExcel = async (file: File) => {
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("Excel files are limited to 15 MB");
      const XLSX = await import("xlsx");
      const parsed = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      if (parsed.SheetNames.length > 20) throw new Error("A workbook can have at most 20 tabs");
      const imported: AiWorkbookSheet[] = parsed.SheetNames.map((name, index) => {
        const matrix = XLSX.utils.sheet_to_json<any[]>(parsed.Sheets[name], { header: 1, defval: "" });
        const headers = (matrix[0] || []).map(value => String(value).trim());
        const existing = sheets.find(sheet => sheet.name === name);
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
        return { id: existing?.id || crypto.randomUUID(), name, kind: existing?.kind || (index === 0 ? "custom" : "custom"), columns, rows };
      }).filter(sheet => sheet.columns.length > 0);
      if (imported.length === 0) throw new Error("No tab with headers was found");
      const importedNames = new Set(imported.map(sheet => sheet.name));
      const merged = [...imported, ...sheets.filter(sheet => !importedNames.has(sheet.name))];
      if (merged.length > 20) throw new Error("This import would create more than 20 tabs");
      createVersion.mutate({ sheets: merged, source: "import", sourceFileName: file.name });
    } catch (error: any) {
      toast({ title: "Excel import failed", description: error.message, variant: "destructive" });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (isLoading || !workbook) return <div className="p-6 text-gray-500">Loading workbook…</div>;
  if (!workbook.currentVersion || !activeSheet) return <div className="p-6">This workbook has no editable version.</div>;

  return (
    <div className="p-4 md:p-6 max-w-[1800px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => setLocation("/admin/whatsapp-ai-workbooks")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> AI Workbooks
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-bold truncate">{workbook.name}</h1>
            <Badge variant="outline">v{workbook.currentVersion.versionNumber}</Badge>
            {dirty && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Unsaved</Badge>}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {workbook.sourceCampaignId ? "Linked campaign workbook" : "Independent workbook"} · revision {workbook.currentVersion.revision}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workbook.sourceCampaignId && (
            <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending || dirty}>
              <RefreshCw className={`h-4 w-4 mr-1 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh outcomes
            </Button>
          )}
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> Import Excel
          </Button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => {
            const file = e.target.files?.[0];
            if (file) void importExcel(file);
          }} />
          <Button variant="outline" asChild>
            <a href={`/api/whatsapp/ai-workbooks/${id}/export.xlsx`}><Download className="h-4 w-4 mr-1" /> Export Excel</a>
          </Button>
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            <Eye className="h-4 w-4 mr-1" /> Version history
          </Button>
          <Button variant="outline" onClick={() => createVersion.mutate({ sheets, source: "manual" })} disabled={createVersion.isPending}>
            <History className="h-4 w-4 mr-1" /> Save as version
          </Button>
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 md:p-4">
          <div className="flex items-center gap-1 border-b mb-3 overflow-x-auto">
            {sheets.map(sheet => (
              <div
                key={sheet.id}
                className={`group flex items-center border-b-2 transition-colors ${
                  activeSheet.id === sheet.id
                    ? "border-violet-600 text-violet-700 font-semibold bg-violet-50/60"
                    : "border-transparent text-gray-600 hover:bg-gray-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => { setActiveSheetId(sheet.id); setSelectedRows(new Set()); }}
                  className="px-4 py-2.5 text-sm whitespace-nowrap"
                >
                  <Sheet className="h-3.5 w-3.5 inline mr-1.5" />
                  {sheet.name}
                  <span className="ml-1.5 text-xs text-gray-400">{sheet.rows.length}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 mr-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title={`Remove ${sheet.name} tab`}
                  onClick={() => {
                    if (sheets.length <= 1) {
                      toast({ title: "Keep at least one tab", description: "A workbook must contain one tab.", variant: "destructive" });
                      return;
                    }
                    setSheetToRemove(sheet);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="ml-1" onClick={addTab}><Plus className="h-4 w-4 mr-1" /> Tab</Button>
          </div>
          <AiWorkbookGrid
            sheet={activeSheet}
            onChange={updateSheet}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            onFilteredRowsChange={setFilteredRows}
            onRemoveColumn={columnKey => removeColumn(activeSheet.id, columnKey)}
          />
        </CardContent>
      </Card>

      <Dialog open={Boolean(sheetToRemove)} onOpenChange={open => !open && setSheetToRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove tab?</DialogTitle>
            <DialogDescription>
              Remove “{sheetToRemove?.name}” and all of its rows and columns? The change will take effect when you save this workbook.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSheetToRemove(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (sheetToRemove) removeSheet(sheetToRemove.id);
                setSheetToRemove(null);
              }}
            >
              Remove tab
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
                  <div className="flex items-center gap-1 border-b mb-3 overflow-x-auto">
                    {previewVersion.sheets.map(sheet => (
                      <button
                        key={sheet.id}
                        type="button"
                        onClick={() => setPreviewSheetId(sheet.id)}
                        className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 ${
                          previewSheetId === sheet.id ? "border-violet-600 text-violet-700 font-semibold" : "border-transparent text-gray-600"
                        }`}
                      >
                        <Sheet className="h-3 w-3 inline mr-1" /> {sheet.name}
                      </button>
                    ))}
                  </div>
                  {(() => {
                    const previewSheet = previewVersion.sheets.find(sheet => sheet.id === previewSheetId) || previewVersion.sheets[0];
                    return previewSheet ? (
                      <AiWorkbookGrid
                        sheet={previewSheet}
                        onChange={() => undefined}
                        selectedRows={new Set()}
                        onSelectedRowsChange={() => undefined}
                        readOnly
                      />
                    ) : null;
                  })()}
                </>
              ) : (
                <div className="h-full min-h-48 flex items-center justify-center text-sm text-red-600">This version is no longer available.</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-violet-50/60 p-4">
        <div>
          <div className="font-semibold flex items-center gap-1.5"><Megaphone className="h-4 w-4 text-violet-600" /> Run another campaign</div>
          <p className="text-xs text-gray-600 mt-0.5">
            {selectedRows.size > 0
              ? `Create a protected campaign audience from ${selectedRows.size.toLocaleString()} selected rows.`
              : `Create a protected campaign audience from ${filteredRows.length.toLocaleString()} currently filtered rows.`}
          </p>
        </div>
        <Button onClick={() => createAudience.mutate()} disabled={createAudience.isPending || (selectedRows.size === 0 && filteredRows.length === 0)}>
          {createAudience.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Create Campaign from Workbook
        </Button>
      </div>
    </div>
  );
}

export default function WhatsAppAiWorkbooks({ id }: { id?: string }) {
  return id ? <WorkbookEditor id={id} /> : <WorkbooksList />;
}
