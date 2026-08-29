import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowLeft, BookOpen, Bot, CalendarClock, FileSpreadsheet, Loader2, Save, SlidersHorizontal, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { extractAutomationSampleHeaders, type HeaderSource } from "@/lib/automationSampleHeaders";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { CampaignAutomation } from "./WhatsAppCampaignAutomations";

type Template = { id: string; name: string; status: string; paramCount: number; bodyText: string };
type MappingSuggestion = { columns: string[]; confidence: "high" | "medium" | "low"; reason: string };
type MappingSuggestions = {
  phoneColumn: MappingSuggestion;
  nameColumn: MappingSuggestion;
  recordKeyColumn: MappingSuggestion;
  dateColumn: MappingSuggestion;
  statusColumn: MappingSuggestion;
  templateParams: MappingSuggestion[];
  warnings: string[];
};
type MappingResponse = { available: boolean; suggestions: MappingSuggestions };
type CampaignBlueprint = {
  id: string;
  name: string;
  status: string;
  startedAt?: string | null;
  templateId: string;
  templateParams?: string[] | null;
  aiEnabled: string;
  aiAgentName?: string | null;
  aiUseFaqs: string;
  aiUseDocs: string;
  aiUseProducts: string;
  replyClassifications?: unknown[] | null;
};
type WorkbookSummary = {
  id: string;
  name: string;
  status: string;
  sourceCampaignId?: string | null;
  latestVersion?: { versionNumber: number } | null;
};
type WorkbookDetail = {
  id: string;
  name: string;
  currentVersion: {
    id: string;
    versionNumber: number;
    sheets: { id: string; name: string; columns: { key: string; label: string }[] }[];
  } | null;
};

const EMPTY = {
  name: "",
  sourceType: "campaign_blueprint" as "upload" | "ai_workbook" | "campaign_blueprint",
  sourceCampaignId: "",
  sourceWorkbookId: "",
  sourceWorkbookSheetId: "",
  templateId: "",
  templateParams: [] as string[],
  phoneColumn: "phone",
  nameColumn: "customer name",
  recordKeyColumn: "loan id",
  dateColumn: "emi due date",
  dateOffsetDays: 0,
  statusColumn: "payment status",
  eligibleStatusesText: "pending, overdue",
  defaultCountryCode: "91",
  sendMode: "review" as "review" | "automatic",
  sendTime: "10:00",
  timezone: "Asia/Kolkata",
  enabled: true,
};

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function confidenceClass(confidence: MappingSuggestion["confidence"]) {
  if (confidence === "high") return "bg-emerald-100 text-emerald-800";
  if (confidence === "medium") return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-700";
}

export default function WhatsAppCampaignAutomationForm({ id }: { id?: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY);
  const [sampleFileName, setSampleFileName] = useState("");
  const [headerSources, setHeaderSources] = useState<HeaderSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [isExtractingHeaders, setIsExtractingHeaders] = useState(false);
  const [isSuggestingMappings, setIsSuggestingMappings] = useState(false);
  const [suggestions, setSuggestions] = useState<MappingResponse | null>(null);
  const [touchedMappingFields, setTouchedMappingFields] = useState<Set<string>>(() => new Set());
  const { data: templates = [] } = useQuery<Template[]>({ queryKey: ["/api/whatsapp/templates"] });
  const { data: campaigns = [] } = useQuery<CampaignBlueprint[]>({ queryKey: ["/api/whatsapp/campaigns"] });
  const { data: workbooks = [] } = useQuery<WorkbookSummary[]>({
    queryKey: ["/api/whatsapp/ai-workbooks"],
  });
  const { data: selectedWorkbook, isLoading: isLoadingWorkbook } = useQuery<WorkbookDetail>({
    queryKey: ["/api/whatsapp/ai-workbooks", form.sourceType === "campaign_blueprint"
      ? workbooks.find(workbook => workbook.sourceCampaignId === form.sourceCampaignId)?.id
      : form.sourceWorkbookId],
    queryFn: () => {
      const workbookId = form.sourceType === "campaign_blueprint"
        ? workbooks.find(workbook => workbook.sourceCampaignId === form.sourceCampaignId)?.id
        : form.sourceWorkbookId;
      return apiRequest("GET", `/api/whatsapp/ai-workbooks/${workbookId}`);
    },
    enabled: form.sourceType !== "upload" && Boolean(
      form.sourceType === "campaign_blueprint"
        ? workbooks.find(workbook => workbook.sourceCampaignId === form.sourceCampaignId)?.id
        : form.sourceWorkbookId,
    ),
  });
  const { data: existing, isLoading } = useQuery<CampaignAutomation & Record<string, any>>({
    queryKey: ["/api/whatsapp/campaign-automations", id],
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-automations/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      sourceType: existing.sourceType === "campaign_blueprint"
        ? "campaign_blueprint"
        : existing.sourceType === "ai_workbook" ? "ai_workbook" : "upload",
      sourceCampaignId: existing.sourceCampaignId || "",
      sourceWorkbookId: existing.sourceWorkbookId || "",
      sourceWorkbookSheetId: existing.sourceWorkbookSheetId || "",
      templateId: existing.templateId,
      templateParams: Array.isArray(existing.templateParams) ? existing.templateParams : [],
      phoneColumn: existing.phoneColumn,
      nameColumn: existing.nameColumn || "",
      recordKeyColumn: existing.recordKeyColumn,
      dateColumn: existing.dateColumn,
      dateOffsetDays: existing.dateOffsetDays,
      statusColumn: existing.statusColumn || "",
      eligibleStatusesText: Array.isArray(existing.eligibleStatuses) ? existing.eligibleStatuses.join(", ") : "",
      defaultCountryCode: existing.defaultCountryCode || "91",
      sendMode: existing.sendMode,
      sendTime: existing.sendTime,
      timezone: existing.timezone,
      enabled: existing.enabled,
    });
    setTouchedMappingFields(new Set([
      "phoneColumn", "nameColumn", "recordKeyColumn", "dateColumn", "statusColumn",
      ...((existing.templateParams || []) as string[]).map((_, index) => `templateParam:${index}`),
    ]));
  }, [existing]);

  const isBlueprintSource = form.sourceType === "campaign_blueprint";
  const isLegacyAutomation = Boolean(existing && existing.sourceType !== "campaign_blueprint");
  const eligibleBlueprints = campaigns.filter(campaign => campaign.status === "draft" && !campaign.startedAt);
  const selectedBlueprint = campaigns.find(campaign => campaign.id === form.sourceCampaignId);
  const linkedBlueprintWorkbooks = workbooks.filter(workbook =>
    workbook.status === "active" && workbook.sourceCampaignId === form.sourceCampaignId,
  );
  const blueprintWorkbook = linkedBlueprintWorkbooks.length === 1 ? linkedBlueprintWorkbooks[0] : null;
  const effectiveWorkbookId = isBlueprintSource ? blueprintWorkbook?.id || "" : form.sourceWorkbookId;
  const selectedTemplateId = isBlueprintSource ? selectedBlueprint?.templateId || "" : form.templateId;
  const selectedTemplateParams = isBlueprintSource
    ? Array.isArray(selectedBlueprint?.templateParams) ? selectedBlueprint.templateParams : []
    : form.templateParams;
  const selectedTemplate = templates.find(template => template.id === selectedTemplateId);
  const approvedTemplates = templates.filter(template => template.status === "approved");
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(current => ({ ...current, [key]: value }));
  const updateMapping = <K extends keyof typeof form>(key: K, value: (typeof form)[K], touchedKey = String(key)) => {
    setTouchedMappingFields(current => new Set(current).add(touchedKey));
    update(key, value);
  };
  const selectedUploadSource = headerSources.find(source => source.id === selectedSourceId) || headerSources[0];
  const selectedWorkbookSheet = selectedWorkbook?.currentVersion?.sheets.find(
    sheet => sheet.id === form.sourceWorkbookSheetId,
  ) || selectedWorkbook?.currentVersion?.sheets[0];
  const selectedSource: HeaderSource | undefined = form.sourceType !== "upload"
    ? selectedWorkbookSheet
      ? { id: selectedWorkbookSheet.id, label: selectedWorkbookSheet.name, columns: selectedWorkbookSheet.columns }
      : undefined
    : selectedUploadSource;
  const sampleColumnKeys = new Set(selectedSource?.columns.map(column => column.key) || []);

  const applySuggestion = (
    field: "phoneColumn" | "nameColumn" | "recordKeyColumn" | "dateColumn" | "statusColumn" | "templateParams",
    suggestion: MappingSuggestion,
    templateIndex?: number,
  ) => {
    if (suggestion.columns.length === 0) return;
    if (field === "templateParams") {
      if (templateIndex === undefined) return;
      const templateParams = [...form.templateParams];
      templateParams[templateIndex] = `{{${suggestion.columns[0]}}}`;
      updateMapping("templateParams", templateParams, `templateParam:${templateIndex}`);
      return;
    }
    const value = field === "recordKeyColumn" ? suggestion.columns.join(", ") : suggestion.columns[0];
    updateMapping(field, value);
  };

  const extractHeaders = async (file: File | undefined) => {
    if (!file) return;
    setIsExtractingHeaders(true);
    setSuggestions(null);
    try {
      const sources = await extractAutomationSampleHeaders(file);
      if (sources.length === 0) throw new Error("No usable header rows were found in that file");
      setSampleFileName(file.name);
      setHeaderSources(sources);
      setSelectedSourceId(sources[0].id);
      toast({
        title: "Headers extracted",
        description: sources.length === 1 ? `${sources[0].columns.length} columns detected.` : `${sources.length} candidate sheets or pages detected.`,
      });
    } catch (error: any) {
      setSampleFileName("");
      setHeaderSources([]);
      setSelectedSourceId("");
      toast({ title: "Could not read sample file", description: error.message, variant: "destructive" });
    } finally {
      setIsExtractingHeaders(false);
    }
  };

  const requestSuggestions = async () => {
    if (!selectedSource) {
      toast({
        title: form.sourceType !== "upload" ? "Workbook audience unavailable" : "Upload a sample first",
        description: isBlueprintSource
          ? "The selected campaign must have exactly one linked AI Workbook."
          : form.sourceType === "ai_workbook"
          ? "Choose an AI Workbook so we can read its saved columns."
          : "Choose an Excel, CSV, or table-based PDF sample so we can read its headers.",
        variant: "destructive",
      });
      return;
    }
    setIsSuggestingMappings(true);
    try {
      const result = await apiRequest<MappingResponse>("POST", "/api/whatsapp/campaign-automations/suggest-mappings", {
        columns: selectedSource.columns,
        templateId: selectedTemplateId || undefined,
      });
      setSuggestions(result);
      if (result.available) {
        // A request for suggestions is deliberate, but it must still never replace
        // anything an administrator has typed or a saved automation already uses.
        const applyUntouched = (field: keyof MappingSuggestions, target: "phoneColumn" | "nameColumn" | "recordKeyColumn" | "dateColumn" | "statusColumn") => {
          const suggestion = result.suggestions[field] as MappingSuggestion;
          if (!touchedMappingFields.has(target) && suggestion.confidence !== "low") {
            applySuggestion(target, suggestion);
          }
        };
        applyUntouched("phoneColumn", "phoneColumn");
        applyUntouched("nameColumn", "nameColumn");
        applyUntouched("recordKeyColumn", "recordKeyColumn");
        applyUntouched("dateColumn", "dateColumn");
        applyUntouched("statusColumn", "statusColumn");
        result.suggestions.templateParams.forEach((suggestion, index) => {
          if (!touchedMappingFields.has(`templateParam:${index}`) && suggestion.confidence !== "low") {
            applySuggestion("templateParams", suggestion, index);
          }
        });
      }
      toast({
        title: result.available ? "Suggestions ready for review" : "Manual mapping is still available",
        description: result.available
          ? "High and medium confidence suggestions filled untouched fields. Review every field before saving."
          : result.suggestions.warnings[0],
      });
    } catch (error: any) {
      toast({ title: "Could not suggest mappings", description: error.message, variant: "destructive" });
    } finally {
      setIsSuggestingMappings(false);
    }
  };

  const templateColumnReferences = selectedTemplateParams.flatMap((value, index) =>
    Array.from(String(value || "").matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))
      .map(match => ({ label: `Template field ${index + 1}`, column: match[1].trim().toLowerCase() }))
      // These are recipient properties, not spreadsheet attributes.
      .filter(reference => reference.column !== "name" && reference.column !== "phone"),
  );
  const sampleMappingIssues = selectedSource
    ? [
      { label: "Phone", columns: [form.phoneColumn] },
      { label: "Name", columns: form.nameColumn.trim() ? [form.nameColumn] : [] },
      { label: "Record key", columns: form.recordKeyColumn.split(",").map(value => value.trim()).filter(Boolean) },
      { label: "Date", columns: [form.dateColumn] },
      { label: "Status", columns: form.statusColumn.trim() ? [form.statusColumn] : [] },
      ...templateColumnReferences.map(reference => ({ label: reference.label, columns: [reference.column] })),
    ].flatMap(({ label, columns }) =>
      columns.some(column => !sampleColumnKeys.has(String(column).trim().toLowerCase()))
        ? [`${label} must match a detected sample header`]
        : [],
    )
    : [];
  const suggestionRows: { label: string; suggestion: MappingSuggestion; onUse: () => void }[] = suggestions
    ? [
      { label: "Phone column", suggestion: suggestions.suggestions.phoneColumn, onUse: () => applySuggestion("phoneColumn", suggestions.suggestions.phoneColumn) },
      { label: "Name column", suggestion: suggestions.suggestions.nameColumn, onUse: () => applySuggestion("nameColumn", suggestions.suggestions.nameColumn) },
      { label: "Record key", suggestion: suggestions.suggestions.recordKeyColumn, onUse: () => applySuggestion("recordKeyColumn", suggestions.suggestions.recordKeyColumn) },
      { label: "Date column", suggestion: suggestions.suggestions.dateColumn, onUse: () => applySuggestion("dateColumn", suggestions.suggestions.dateColumn) },
      { label: "Status column", suggestion: suggestions.suggestions.statusColumn, onUse: () => applySuggestion("statusColumn", suggestions.suggestions.statusColumn) },
      ...(!isBlueprintSource ? suggestions.suggestions.templateParams.map((suggestion, index) => ({
        label: `Template field ${index + 1}`,
        suggestion,
        onUse: () => applySuggestion("templateParams", suggestion, index),
      })) : []),
    ]
    : [];

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        sourceCampaignId: isBlueprintSource ? form.sourceCampaignId : null,
        sourceWorkbookId: isBlueprintSource
          ? blueprintWorkbook?.id || null
          : form.sourceType === "ai_workbook" ? form.sourceWorkbookId : null,
        sourceWorkbookSheetId: form.sourceType !== "upload"
          ? selectedWorkbookSheet?.id || form.sourceWorkbookSheetId || null
          : null,
        templateId: selectedTemplateId,
        templateParams: selectedTemplateParams,
        eligibleStatuses: form.eligibleStatusesText.split(",").map(value => value.trim()).filter(Boolean),
      };
      return id
        ? apiRequest("PATCH", `/api/whatsapp/campaign-automations/${id}`, payload)
        : apiRequest("POST", "/api/whatsapp/campaign-automations", payload);
    },
    onSuccess: (saved: CampaignAutomation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations"] });
      toast({ title: id ? "Automation updated" : "Automation created" });
      setLocation(`/admin/whatsapp-campaign-automations/${saved.id}`);
    },
    onError: (error: any) => toast({ title: "Could not save automation", description: error.message, variant: "destructive" }),
  });

  if (id && isLoading) return <div className="p-6 text-center text-gray-500">Loading automation...</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <Button variant="ghost" size="sm" onClick={() => setLocation(id ? `/admin/whatsapp-campaign-automations/${id}` : "/admin/whatsapp-campaign-automations")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to automations
      </Button>
      <div>
        <h1 className="text-2xl font-bold">{id ? "Edit WhatsApp automation" : "New WhatsApp automation"}</h1>
        <p className="text-sm text-gray-600 mt-1">
          Select a draft campaign blueprint, then add the recurring eligibility and delivery rules.
        </p>
      </div>

      <Section title={isLegacyAutomation ? "Campaign and template" : "Campaign blueprint"} icon={<FileSpreadsheet className="h-4 w-4 text-emerald-600" />}>
        <div className="space-y-2">
          <Label htmlFor="automation-name">Automation name</Label>
          <Input id="automation-name" value={form.name} onChange={event => update("name", event.target.value)} placeholder="EMI reminder — 3 days before due date" />
        </div>
        {isBlueprintSource ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Draft WhatsApp campaign</Label>
              <Select
                value={form.sourceCampaignId}
                onValueChange={sourceCampaignId => {
                  const campaign = campaigns.find(candidate => candidate.id === sourceCampaignId);
                  setForm(current => ({
                    ...current,
                    sourceCampaignId,
                    sourceWorkbookId: "",
                    sourceWorkbookSheetId: "",
                    templateId: campaign?.templateId || "",
                    templateParams: Array.isArray(campaign?.templateParams) ? campaign.templateParams : [],
                  }));
                  setSuggestions(null);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Choose an unsent draft campaign" /></SelectTrigger>
                <SelectContent>
                  {eligibleBlueprints.map(campaign => (
                    <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!eligibleBlueprints.length && (
                <p className="text-xs text-amber-700">
                  Create and save a WhatsApp campaign as a draft before creating its automation.
                </p>
              )}
            </div>
            {selectedBlueprint && (
              <div className="rounded-md border bg-gray-50 p-3 space-y-2 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <Bot className="h-4 w-4 text-violet-600" />
                  Campaign behavior inherited from {selectedBlueprint.name}
                </div>
                <p className="text-xs text-gray-600">
                  Template: {selectedTemplate?.name || "Unavailable"} · AI replies: {selectedBlueprint.aiEnabled === "false" ? "Off" : `On (${selectedBlueprint.aiAgentName || "Sales Agent"})`} · Reply outcomes: {selectedBlueprint.replyClassifications?.length || 0}
                </p>
                <p className="text-xs text-gray-500">
                  Template fields, persona, knowledge sources, AI limits, and reply outcomes are controlled by the campaign blueprint and copied into every run.
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Approved WhatsApp template</Label>
              <Select value={form.templateId} onValueChange={templateId => update("templateId", templateId)}>
                <SelectTrigger><SelectValue placeholder="Choose an approved template" /></SelectTrigger>
                <SelectContent>
                  {approvedTemplates.map(template => <SelectItem key={template.id} value={template.id}>{template.name} · {template.paramCount} fields</SelectItem>)}
                </SelectContent>
              </Select>
              {!approvedTemplates.length && <p className="text-xs text-amber-700">Sync an approved MSG91 template before creating an automation.</p>}
              {selectedTemplate && <p className="text-xs text-gray-500">{selectedTemplate.bodyText}</p>}
            </div>
          </>
        )}
        {!isBlueprintSource && selectedTemplate && selectedTemplate.paramCount > 0 && (
          <div className="rounded-md border bg-gray-50 p-3 space-y-2">
            <p className="text-sm font-medium">Template field mappings</p>
            <p className="text-xs text-gray-500">Use spreadsheet fields like <code>{"{{customer name}}"}</code> or static text. Field names must match the sheet headers after lowercasing.</p>
            {Array.from({ length: selectedTemplate.paramCount }, (_, index) => (
              <Input
                key={index}
                value={form.templateParams[index] || ""}
                onChange={event => {
                  const templateParams = [...form.templateParams];
                  templateParams[index] = event.target.value;
                  updateMapping("templateParams", templateParams, `templateParam:${index}`);
                }}
                placeholder={`Template field ${index + 1}, e.g. {{emi amount}}`}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title={isBlueprintSource ? "Campaign audience and field mapping" : "Automation source and AI mapping"} icon={<Sparkles className="h-4 w-4 text-violet-600" />}>
        {isBlueprintSource ? (
          <div className="space-y-3">
            {!selectedBlueprint ? (
              <p className="text-sm text-gray-500">Choose a campaign blueprint to see its configured audience.</p>
            ) : linkedBlueprintWorkbooks.length === 0 ? (
              <p className="flex gap-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Link one AI Workbook to this campaign before creating the automation.
              </p>
            ) : linkedBlueprintWorkbooks.length > 1 ? (
              <p className="flex gap-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This campaign is linked to multiple AI Workbooks. Keep exactly one linked workbook so the automation has one authoritative audience.
              </p>
            ) : (
              <div className="rounded-md border bg-emerald-50/50 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                  <BookOpen className="h-4 w-4" /> {blueprintWorkbook?.name}
                </p>
                <p className="mt-1 text-xs text-emerald-800">
                  This workbook is inherited from the campaign. It is not linked again in the automation, and each run pins the exact saved version it uses.
                </p>
              </div>
            )}
            {isLoadingWorkbook && <p className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading campaign audience columns…</p>}
          </div>
        ) : (
          <>
        <div className="space-y-2">
          <Label>Data source</Label>
          <Select
            value={form.sourceType}
            onValueChange={(sourceType: "upload" | "ai_workbook") => {
              update("sourceType", sourceType);
              setSuggestions(null);
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ai_workbook">AI Workbook (recommended)</SelectItem>
              <SelectItem value="upload">Upload a spreadsheet for each run</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500">
            {form.sourceType === "ai_workbook"
              ? "Each run reads the workbook’s latest saved version. Existing runs keep the version they used."
              : "Keep uploading a refreshed spreadsheet when you want to create a run."}
          </p>
        </div>

        {form.sourceType === "ai_workbook" ? (
          <div className="space-y-2">
            <Label>AI Workbook</Label>
            <Select
              value={form.sourceWorkbookId}
              onValueChange={sourceWorkbookId => {
                setForm(current => ({ ...current, sourceWorkbookId, sourceWorkbookSheetId: "" }));
                setSuggestions(null);
              }}
            >
              <SelectTrigger><SelectValue placeholder="Choose an AI Workbook" /></SelectTrigger>
              <SelectContent>
                {workbooks.map(workbook => (
                  <SelectItem key={workbook.id} value={workbook.id}>
                    {workbook.name}{workbook.latestVersion ? ` · version ${workbook.latestVersion.versionNumber}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!workbooks.length && (
              <p className="text-xs text-amber-700">Create an AI Workbook before using the recommended automation source.</p>
            )}
            {isLoadingWorkbook && <p className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading workbook columns…</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="automation-sample-file">Representative file</Label>
            <Input
              id="automation-sample-file"
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt,.pdf,application/pdf"
              disabled={isExtractingHeaders}
              onChange={event => {
                void extractHeaders(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <p className="text-xs text-gray-500">
              Upload Excel, CSV, or a table-based PDF (5 MB max). It is read locally in your browser to find headers, then discarded. Its rows are never sent to AI or saved.
            </p>
            {isExtractingHeaders && <p className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" /> Reading headers…</p>}
          </div>
        )}
          </>
        )}

        {selectedSource && (
          <div className="space-y-3 rounded-md border bg-gray-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  {form.sourceType !== "upload" && <BookOpen className="h-4 w-4 text-emerald-700" />}
                  {form.sourceType !== "upload" ? selectedWorkbook?.name : sampleFileName}
                </p>
                <p className="text-xs text-gray-500">
                  {form.sourceType !== "upload"
                    ? `${selectedSource.label} · ${selectedWorkbook?.currentVersion?.versionNumber ? `version ${selectedWorkbook.currentVersion.versionNumber}` : "latest saved version"}`
                    : "Choose the sheet or PDF page whose header row should be used for this automation."}
                </p>
              </div>
              {form.sourceType === "upload" && headerSources.length > 1 && (
                <Select value={selectedSource.id} onValueChange={value => { setSelectedSourceId(value); setSuggestions(null); }}>
                  <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {headerSources.map(source => <SelectItem key={source.id} value={source.id}>{source.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedSource.columns.map(column => (
                <span key={column.key} className="rounded-full border bg-white px-2 py-0.5 text-xs text-gray-700" title={column.label}>
                  {column.key}
                </span>
              ))}
            </div>
            <Button type="button" variant="secondary" onClick={() => void requestSuggestions()} disabled={isSuggestingMappings}>
              {isSuggestingMappings ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {isSuggestingMappings ? "Suggesting…" : "Suggest mappings with AI"}
            </Button>
          </div>
        )}

        {suggestions && (
          <div className="space-y-3 rounded-md border border-violet-200 bg-violet-50/40 p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 text-violet-700" />
              <div>
                <p className="text-sm font-medium text-violet-950">Review AI mapping suggestions</p>
                <p className="text-xs text-violet-900/70">Suggestions are limited to headers extracted above. Use a suggestion only after checking it matches your data.</p>
              </div>
            </div>
            {suggestionRows.map(({ label, suggestion, onUse }) => (
              <div key={label} className="flex flex-col gap-1 rounded border bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase ${confidenceClass(suggestion.confidence)}`}>
                      {suggestion.confidence}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">
                    {suggestion.columns.length ? suggestion.columns.join(", ") : "No safe match"} · {suggestion.reason}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={onUse} disabled={suggestion.columns.length === 0}>Use</Button>
              </div>
            ))}
            {suggestions.suggestions.warnings.map(warning => (
              <p key={warning} className="flex gap-2 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Spreadsheet matching rule" icon={<SlidersHorizontal className="h-4 w-4 text-emerald-600" />}>
        <p className="text-sm text-gray-600">
          Map the fields used for eligibility and message delivery. Use the exact column keys shown above.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Phone column</Label><Input list="automation-sample-columns" value={form.phoneColumn} onChange={event => updateMapping("phoneColumn", event.target.value)} /></div>
          <div className="space-y-2"><Label>Name column (optional)</Label><Input list="automation-sample-columns" value={form.nameColumn} onChange={event => updateMapping("nameColumn", event.target.value)} /></div>
          <div className="space-y-2"><Label>Unique record key column(s)</Label><Input list="automation-sample-columns" value={form.recordKeyColumn} onChange={event => updateMapping("recordKeyColumn", event.target.value)} /><p className="text-xs text-gray-500">Use one column, or comma-separated values such as loan id, installment id.</p></div>
          <div className="space-y-2"><Label>Date column</Label><Input list="automation-sample-columns" value={form.dateColumn} onChange={event => updateMapping("dateColumn", event.target.value)} /></div>
          <div className="space-y-2"><Label>Days relative to date</Label><Input type="number" min={-366} max={366} value={form.dateOffsetDays} onChange={event => update("dateOffsetDays", Number(event.target.value))} /><p className="text-xs text-gray-500">-3 sends three days before; 0 sends on the date; +1 sends one day after.</p></div>
          <div className="space-y-2"><Label>Status column (optional)</Label><Input list="automation-sample-columns" value={form.statusColumn} onChange={event => updateMapping("statusColumn", event.target.value)} /></div>
        </div>
        {selectedSource && <datalist id="automation-sample-columns">{selectedSource.columns.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</datalist>}
        {sampleMappingIssues.length > 0 && (
          <p className="flex gap-2 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{sampleMappingIssues.join(". ")}.</p>
        )}
        <div className="space-y-2">
          <Label>Allowed status values (optional, comma separated)</Label>
          <Input value={form.eligibleStatusesText} onChange={event => update("eligibleStatusesText", event.target.value)} placeholder="pending, overdue" />
          <p className="text-xs text-gray-500">Leave blank to include every record that matches the date rule.</p>
        </div>
      </Section>

      <Section title="Delivery control" icon={<CalendarClock className="h-4 w-4 text-emerald-600" />}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Send time</Label><Input type="time" value={form.sendTime} onChange={event => update("sendTime", event.target.value)} /></div>
          <div className="space-y-2"><Label>Timezone</Label><Input value={form.timezone} onChange={event => update("timezone", event.target.value)} placeholder="Asia/Kolkata" /></div>
          <div className="space-y-2"><Label>Default country calling code</Label><Input value={form.defaultCountryCode} onChange={event => update("defaultCountryCode", event.target.value)} placeholder="91" /></div>
          <div className="space-y-2"><Label>{form.sourceType !== "upload" ? "After a valid workbook run" : "After a valid upload"}</Label>
            <Select value={form.sendMode} onValueChange={(sendMode: "review" | "automatic") => update("sendMode", sendMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="review">Wait for review before scheduling</SelectItem>
                <SelectItem value="automatic">Schedule automatically</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t pt-4">
          <Switch checked={form.enabled} onCheckedChange={enabled => update("enabled", enabled)} id="automation-enabled" />
          <div><Label htmlFor="automation-enabled">Automation is active</Label><p className="text-xs text-gray-500">Paused automations keep their history but reject new runs.</p></div>
        </div>
      </Section>

      <div className="flex justify-end gap-2 pb-6">
        <Button variant="outline" onClick={() => setLocation("/admin/whatsapp-campaign-automations")}>Cancel</Button>
        <Button
          disabled={
            saveMutation.isPending
            || !form.name
            || !selectedTemplateId
            || sampleMappingIssues.length > 0
            || (isBlueprintSource && (!form.sourceCampaignId || linkedBlueprintWorkbooks.length !== 1 || !selectedSource))
            || (form.sourceType === "ai_workbook" && (!form.sourceWorkbookId || !selectedSource))
          }
          onClick={() => saveMutation.mutate()}
          data-testid="button-save-campaign-automation"
        >
          <Save className="h-4 w-4 mr-1" /> {saveMutation.isPending ? "Saving..." : id ? "Save changes" : "Create automation"}
        </Button>
      </div>
    </div>
  );
}