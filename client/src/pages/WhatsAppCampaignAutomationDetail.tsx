import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, BookOpen, CheckCircle2, FileSpreadsheet, Pencil, Play, Trash2, Upload, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseSpreadsheetFile, pickDefaultSheet } from "@/lib/spreadsheetImport";
import { buildSheetData } from "@shared/contactImport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { describeDateRule, type CampaignAutomation } from "./WhatsAppCampaignAutomations";
import { AutomationScheduleCard } from "./WhatsAppCampaignAutomationSchedule";

type Preview = {
  targetDate: string;
  summary: { totalRows: number; eligibleRows: number; excludedRows: number; invalidRows: number; duplicateRows: number };
  invalid: { rowNumber: number; reason: string }[];
  previewRecipients: { rowNumber: number; recordKey: string; phone: string; name: string; params: string[] }[];
  source: {
    type: "upload" | "ai_workbook" | "campaign_blueprint";
    campaignId?: string;
    campaignName?: string;
    campaignUpdatedAt?: string;
    workbookId?: string;
    workbookName?: string;
    versionId?: string;
    versionNumber?: number;
    revision?: number;
    sheetName?: string;
    audienceType?: "ai_workbook" | "contact_groups";
    groupNames?: string[];
  };
};
type Run = {
  id: string; sourceFileName: string; status: string; scheduledAt: string | null; totalRows: number; eligibleRows: number;
  excludedRows: number; invalidRows: number; duplicateRows: number; createdAt: string;
  sourceType?: "upload" | "ai_workbook" | "campaign_blueprint"; sourceWorkbookVersionId?: string | null;
  sourceCampaignId?: string | null; sourceCampaignName?: string | null;
  campaignId: string | null; campaign?: { status: string; id: string } | null;
  trigger?: "manual" | "schedule";
};

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  awaiting_review: "outline", scheduled: "secondary", completed: "default", failed: "destructive", cancelled: "destructive",
};
const RUN_STATUS_LABELS: Record<string, string> = {
  awaiting_review: "Waiting for approval", scheduled: "Scheduled", completed: "Finished", failed: "Failed", cancelled: "Cancelled",
};
const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Not scheduled", scheduled: "Scheduled", sending: "Sending", completed: "Finished", cancelled: "Cancelled", failed: "Failed", paused: "Paused",
};

export default function WhatsAppCampaignAutomationDetail({ id }: { id: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [payload, setPayload] = useState<any>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [cancelRunId, setCancelRunId] = useState<string | null>(null);
  const { data: automation, isLoading } = useQuery<CampaignAutomation & Record<string, any>>({
    queryKey: ["/api/whatsapp/campaign-automations", id],
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-automations/${id}`),
  });
  const { data: sourceCampaign } = useQuery<{ id: string; name: string }>({
    queryKey: [`/api/whatsapp/campaigns/${automation?.sourceCampaignId}`],
    enabled: Boolean(automation?.sourceCampaignId),
  });
  const { data: runs = [] } = useQuery<Run[]>({
    queryKey: ["/api/whatsapp/campaign-automations", id, "runs"],
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-automations/${id}/runs`),
    refetchInterval: 20_000,
  });
  const isBlueprintSource = automation?.sourceType === "campaign_blueprint";
  const isWorkbookSource = automation?.sourceType === "ai_workbook" || Boolean(automation?.sourceWorkbookId);
  const isManagedSource = automation?.sourceType !== "upload";
  const isGroupSource = isBlueprintSource && !isWorkbookSource;

  const previewMutation = useMutation({
    mutationFn: () => apiRequest(
      "POST",
      `/api/whatsapp/campaign-automations/${id}/upload-preview`,
       isManagedSource ? { sourceType: automation?.sourceType } : payload,
    ),
    onSuccess: (result: Preview) => setPreview(result),
    onError: (error: any) => toast({
      title: isManagedSource ? "Could not validate audience" : "Could not validate file",
      description: error.message,
      variant: "destructive",
    }),
  });
  const createRunMutation = useMutation({
    mutationFn: () => apiRequest(
      "POST",
      `/api/whatsapp/campaign-automations/${id}/runs`,
      isManagedSource
        ? {
             sourceType: automation?.sourceType,
            expectedWorkbookVersionId: preview?.source.versionId,
            expectedWorkbookRevision: preview?.source.revision,
            expectedCampaignUpdatedAt: preview?.source.campaignUpdatedAt,
          }
        : { ...payload, sourceFileName: fileName },
    ),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations", id, "runs"] });
      if (!isManagedSource) {
        setPayload(null);
        setFileName("");
      }
      setPreview(null);
      if (fileInput.current) fileInput.current.value = "";
      toast({ title: result.run.status === "scheduled" ? "Campaign scheduled" : "Run created for review" });
    },
    onError: (error: any) => toast({ title: "Could not create run", description: error.message, variant: "destructive" }),
  });
  const approveMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", `/api/whatsapp/campaign-automations/${id}/runs/${runId}/approve`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations", id, "runs"] }); toast({ title: "Run approved and scheduled" }); },
    onError: (error: any) => toast({ title: "Could not schedule run", description: error.message, variant: "destructive" }),
  });
  const cancelMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", `/api/whatsapp/campaign-automations/${id}/runs/${runId}/cancel`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations", id, "runs"] }); toast({ title: "Run cancelled" }); },
    onError: (error: any) => toast({ title: "Could not cancel run", description: error.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/whatsapp/campaign-automations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaign-automations"] });
      toast({ title: "Automation deleted" });
      setLocation("/admin/whatsapp-campaign-automations");
    },
    onError: (error: any) => toast({ title: "Could not delete automation", description: error.message, variant: "destructive" }),
  });

  const handleFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = await parseSpreadsheetFile(file);
      const sheetName = pickDefaultSheet(parsed);
      const sheet = buildSheetData(parsed.recordsBySheet[sheetName] || []);
      if (!sheet.columns.length || !sheet.rows.length) throw new Error("The selected sheet has no header and data rows");
      setFileName(file.name);
      setPayload({ columns: sheet.columns, rows: sheet.rows });
      setPreview(null);
    } catch (error: any) {
      toast({ title: "Could not read spreadsheet", description: error.message, variant: "destructive" });
      setPayload(null); setPreview(null);
    }
  };

  if (isLoading) return <div className="p-6 text-center text-gray-500">Loading automation...</div>;
  if (!automation) return <div className="p-6 text-center text-gray-500">Automation not found.</div>;
  const runCampaignIds = new Map(runs.map(run => [run.id, run.campaignId]));

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/whatsapp-campaign-automations")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to automations
      </Button>
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{automation.name}</h1><Badge variant={automation.enabled ? "default" : "outline"}>{automation.enabled ? "Active" : "Paused"}</Badge></div>
          <p className="text-sm text-gray-600 mt-1">
            Messages people {describeDateRule(automation.dateOffsetDays, automation.dateColumn)} · sends at {automation.sendTime} ({automation.timezone})
          </p>
          {isBlueprintSource && (
            <p className="text-xs text-violet-700 mt-1">
              Based on campaign <span className="font-medium">{sourceCampaign?.name || preview?.source.campaignName || "(no longer available)"}</span>. Every run uses its message, AI replies and reply outcomes.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setLocation(`/admin/whatsapp-campaign-automations/${id}/edit`)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
          <AlertDialog open={isDeleteDialogOpen} onOpenChange={open => { if (!deleteMutation.isPending) setIsDeleteDialogOpen(open); }}>
            <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={() => setIsDeleteDialogOpen(true)} data-testid="button-delete-campaign-automation">
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete automation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will stop future runs for <strong>{automation.name}</strong> and remove it from the active automation list. Already-sent messages and campaign run history will be preserved. Pending review or scheduled work will be cancelled.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  disabled={deleteMutation.isPending}
                  onClick={event => {
                    event.preventDefault();
                    deleteMutation.mutate();
                  }}
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete automation"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <AutomationScheduleCard automationId={id} runCampaignIds={runCampaignIds} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {isManagedSource
              ? <BookOpen className="h-4 w-4 text-emerald-600" />
              : <Upload className="h-4 w-4 text-emerald-600" />}
            {isManagedSource ? "Run now" : "Upload today's file"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            {isBlueprintSource
              ? isGroupSource
                ? "Check who in the chosen audiences is due today. Nothing is sent until you create the run."
                : "Check who in the AI Workbook is due today. Each run keeps a copy of the exact rows it used."
              : isWorkbookSource
              ? "Check who in the AI Workbook is due today. Each run keeps a copy of the exact rows it used."
              : "Upload the refreshed client file. We validate the configured fields and calculate today’s eligible recipients before creating any campaign."}
          </p>
          {isManagedSource ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending || !automation.enabled}>
                <CheckCircle2 className="h-4 w-4 mr-1" />
                {previewMutation.isPending ? "Checking..." : isGroupSource ? "Check who is due" : "Check latest workbook"}
              </Button>
              {isWorkbookSource && !automation.sourceWorkbookId && <span className="text-sm text-red-700">The linked workbook is no longer available. Edit this automation to choose another source.</span>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileInput} type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt" className="hidden" onChange={event => handleFile(event.target.files?.[0])} />
              <Button variant="outline" onClick={() => fileInput.current?.click()}><FileSpreadsheet className="h-4 w-4 mr-1" /> Choose spreadsheet</Button>
              {fileName && <span className="text-sm text-gray-600">{fileName}</span>}
              {payload && <Button onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}><CheckCircle2 className="h-4 w-4 mr-1" /> {previewMutation.isPending ? "Checking..." : "Check file"}</Button>}
            </div>
          )}

          {preview && (
            <div className="space-y-4 border rounded-lg p-4 bg-gray-50">
              <div>
                <h3 className="font-medium">Who is due</h3>
                <p className="text-sm text-gray-600">Target date: <span className="font-medium">{preview.targetDate}</span></p>
                {preview.source.type !== "upload" && (
                  <p className="text-xs text-gray-500">
                    {preview.source.campaignName ? `${preview.source.campaignName} · ` : ""}
                    {preview.source.audienceType === "contact_groups"
                      ? preview.source.groupNames?.join(", ")
                      : `${preview.source.workbookName} · version ${preview.source.versionNumber}.${preview.source.revision} · ${preview.source.sheetName}`}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                <div><span className="block text-gray-500">Rows</span><strong>{preview.summary.totalRows}</strong></div>
                <div><span className="block text-gray-500">Eligible</span><strong className="text-emerald-700">{preview.summary.eligibleRows}</strong></div>
                <div><span className="block text-gray-500">Not due</span><strong>{preview.summary.excludedRows}</strong></div>
                <div><span className="block text-gray-500">Already sent</span><strong>{preview.summary.duplicateRows}</strong></div>
                <div><span className="block text-gray-500">Missing details</span><strong className="text-red-700">{preview.summary.invalidRows}</strong></div>
              </div>
              {preview.summary.eligibleRows > 0 ? (
                <Button onClick={() => createRunMutation.mutate()} disabled={createRunMutation.isPending} data-testid="button-create-automation-run">
                  <Play className="h-4 w-4 mr-1" /> {createRunMutation.isPending ? "Creating..." : automation.sendMode === "automatic" ? "Create and schedule campaign" : "Create run for review"}
                </Button>
              ) : <Alert variant="destructive"><AlertTitle>No recipients ready</AlertTitle><AlertDescription>Correct the date rule, source data, or duplicate history before creating a run.</AlertDescription></Alert>}
              {preview.previewRecipients.length > 0 && (
                <div className="rounded-md border bg-white overflow-hidden">
                  <div className="px-3 py-2 text-sm font-medium border-b">Recipient preview (first {preview.previewRecipients.length})</div>
                  <div className="max-h-52 overflow-auto text-xs">
                    {preview.previewRecipients.map(recipient => (
                      <div key={`${recipient.rowNumber}-${recipient.recordKey}`} className="grid grid-cols-[64px_1fr_1fr_1fr] gap-2 px-3 py-2 border-b last:border-b-0">
                        <span className="text-gray-500">Row {recipient.rowNumber}</span>
                        <span className="truncate">{recipient.name || "—"}</span>
                        <span className="truncate">{recipient.phone}</span>
                        <span className="truncate text-gray-500">{recipient.recordKey}</span>
                        {recipient.params.length > 0 && <span className="col-span-4 text-gray-500 truncate">Template values: {recipient.params.join(" · ")}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {preview.invalid.length > 0 && <div className="text-xs text-red-700 space-y-1"><p className="font-medium">First invalid rows</p>{preview.invalid.map(problem => <p key={`${problem.rowNumber}-${problem.reason}`}>Row {problem.rowNumber}: {problem.reason}</p>)}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Run history</CardTitle></CardHeader>
        <CardContent>
          {!runs.length ? <p className="text-sm text-gray-500 py-4">No runs yet.</p> : (
            <div className="space-y-3">
              {runs.map(run => (
                <div key={run.id} className="border rounded-lg p-3 flex flex-wrap gap-3 items-center">
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-sm">{run.sourceFileName}</span><Badge variant={statusVariant[run.status] || "outline"}>{RUN_STATUS_LABELS[run.status] || run.status.replace("_", " ")}</Badge>{run.trigger === "schedule" && <Badge variant="outline" className="border-emerald-300 text-emerald-700">Automatic</Badge>}{run.campaign && <Badge variant={statusVariant[run.campaign.status] || "outline"}>Campaign: {CAMPAIGN_STATUS_LABELS[run.campaign.status] || run.campaign.status}</Badge>}</div>
                    <div className="text-xs text-gray-500 mt-1">{run.eligibleRows} due · {run.excludedRows} not due · {run.duplicateRows} already messaged · {run.invalidRows} missing details · created {new Date(run.createdAt).toLocaleString()}</div>
                    {run.scheduledAt && <div className="text-xs text-gray-500">Scheduled: {new Date(run.scheduledAt).toLocaleString()}</div>}
                  </div>
                  <div className="flex gap-2">
                    {run.status === "awaiting_review" && <Button size="sm" onClick={() => approveMutation.mutate(run.id)} disabled={approveMutation.isPending}><CheckCircle2 className="h-4 w-4 mr-1" /> Approve & schedule</Button>}
                    {["awaiting_review", "scheduled"].includes(run.status) && <Button size="sm" variant="outline" onClick={() => setCancelRunId(run.id)} disabled={cancelMutation.isPending}><XCircle className="h-4 w-4 mr-1" /> Cancel</Button>}
                    {run.campaignId && <Button size="sm" variant="ghost" onClick={() => setLocation(`/admin/whatsapp-campaigns/${run.campaignId}`)}>Campaign</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!cancelRunId} onOpenChange={open => { if (!open && !cancelMutation.isPending) setCancelRunId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
            <AlertDialogDescription>
              Its campaign will not be sent. The people in it become eligible again, so a later run can message them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={cancelMutation.isPending}
              onClick={event => {
                event.preventDefault();
                if (cancelRunId) cancelMutation.mutate(cancelRunId, { onSettled: () => setCancelRunId(null) });
              }}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}