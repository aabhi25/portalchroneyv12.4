import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, ArrowRight, AlertTriangle, Check, Megaphone, Send } from "lucide-react";
import type { ReplyClassification } from "@shared/schema";
import {
  AB_PENDING,
  type AudiencePreview,
  type CampaignFormValues,
  type CampaignSubmitOptions,
  type SampleContact,
  type WizardGroup,
  type WizardTemplate,
} from "@/components/whatsapp/campaignWizard/types";
import type { WizardCtx, WorkbookSheet, WorkbookSummary } from "@/components/whatsapp/campaignWizard/context";
import { StepWho } from "@/components/whatsapp/campaignWizard/StepWho";
import { StepMessage } from "@/components/whatsapp/campaignWizard/StepMessage";
import { StepWhen } from "@/components/whatsapp/campaignWizard/StepWhen";
import { StepAiReplies } from "@/components/whatsapp/campaignWizard/StepAiReplies";
import { StepReview, type WizardStepKey } from "@/components/whatsapp/campaignWizard/StepReview";

/**
 * Shared campaign set-up, used by the create, duplicate and edit pages so they cannot drift
 * apart. It is a step-by-step wizard — Who / Message / When / AI replies / Review — that owns
 * its own state; the parent supplies the starting values and decides what happens on submit.
 */

export type Template = WizardTemplate;
export type Group = WizardGroup;
export type { CampaignFormValues, CampaignSubmitOptions };

export const EMPTY_CAMPAIGN_FORM: CampaignFormValues = {
  name: "",
  campaignType: "one_time",
  templateId: "",
  groupIds: [],
  templateParams: [],
  scheduledAt: "",
  aiEnabled: true,
  aiAgentName: "Sales Agent",
  aiSystemPrompt: "",
  aiUseFaqs: true,
  aiUseDocs: true,
  aiUseProducts: true,
  replyClassifications: [],
  recipientSourceType: "ai_workbook",
  recipientWorkbookId: "",
  recipientWorkbookSheetId: "",
  recipientPhoneColumn: "",
  recipientNameColumn: "",
  recipientRecordKeyColumn: "",
  recipientDateColumn: "",
  recipientDateOffsetDays: 0,
  recipientStatusColumn: "",
  recipientEligibleStatuses: [],
  recipientAiAllowedFields: [],
  quietHoursStart: "",
  quietHoursEnd: "",
  quietHoursTimezone: "",
  variantBTemplateId: "",
  variantBTemplateParams: [],
  variantSplitPercent: 50,
  followUps: [],
};

/**
 * The stored campaign columns this form can round-trip. The AI flags are persisted as
 * 'true'/'false' text rather than booleans, so they need converting on the way in.
 */
export interface StoredCampaignConfig {
  name: string;
  campaignType?: "one_time" | "automation" | null;
  templateId: string;
  templateParams: string[] | null;
  groupIds: string[] | null;
  scheduledAt: string | null;
  aiEnabled: string;
  aiAgentName: string | null;
  aiSystemPrompt: string | null;
  aiUseFaqs: string;
  aiUseDocs: string;
  aiUseProducts: string;
  replyClassifications?: ReplyClassification[] | null;
  recipientSourceType?: "ai_workbook" | "contact_groups" | null;
  recipientWorkbookId?: string | null;
  recipientWorkbookSheetId?: string | null;
  recipientPhoneColumn?: string | null;
  recipientNameColumn?: string | null;
  recipientRecordKeyColumn?: string | null;
  recipientDateColumn?: string | null;
  recipientDateOffsetDays?: number | null;
  recipientStatusColumn?: string | null;
  recipientEligibleStatuses?: string[] | null;
  recipientAiAllowedFields?: string[] | null;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  quietHoursTimezone?: string | null;
  variantBTemplateId?: string | null;
  variantBTemplateParams?: string[] | null;
  variantSplitPercent?: number | null;
  /** Saved follow-up steps (returned by the campaign detail API). */
  followUps?: { delayHours: number; templateId: string; templateParams: string[] | null }[] | null;
}

/** Convert a stored ISO timestamp into the local-time string a datetime-local input expects. */
export function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Map a saved campaign onto form values. Shared by the edit and duplicate flows. */
export function campaignToFormValues(campaign: StoredCampaignConfig): CampaignFormValues {
  return {
    name: campaign.name ?? "",
    campaignType: campaign.campaignType === "automation" ? "automation" : "one_time",
    templateId: campaign.templateId ?? "",
    groupIds: Array.isArray(campaign.groupIds) ? campaign.groupIds : [],
    templateParams: Array.isArray(campaign.templateParams) ? campaign.templateParams : [],
    scheduledAt: toDateTimeLocal(campaign.scheduledAt),
    aiEnabled: campaign.aiEnabled !== "false",
    aiAgentName: campaign.aiAgentName || EMPTY_CAMPAIGN_FORM.aiAgentName,
    aiSystemPrompt: campaign.aiSystemPrompt ?? "",
    aiUseFaqs: campaign.aiUseFaqs !== "false",
    aiUseDocs: campaign.aiUseDocs !== "false",
    aiUseProducts: campaign.aiUseProducts !== "false",
    replyClassifications: Array.isArray(campaign.replyClassifications) ? campaign.replyClassifications : [],
    recipientSourceType: campaign.recipientSourceType === "contact_groups" ? "contact_groups" : "ai_workbook",
    recipientWorkbookId: campaign.recipientWorkbookId || "",
    recipientWorkbookSheetId: campaign.recipientWorkbookSheetId || "",
    recipientPhoneColumn: campaign.recipientPhoneColumn || "",
    recipientNameColumn: campaign.recipientNameColumn || "",
    recipientRecordKeyColumn: campaign.recipientRecordKeyColumn || "",
    recipientDateColumn: campaign.recipientDateColumn || "",
    recipientDateOffsetDays: campaign.recipientDateOffsetDays || 0,
    recipientStatusColumn: campaign.recipientStatusColumn || "",
    recipientEligibleStatuses: Array.isArray(campaign.recipientEligibleStatuses) ? campaign.recipientEligibleStatuses : [],
    recipientAiAllowedFields: Array.isArray(campaign.recipientAiAllowedFields) ? campaign.recipientAiAllowedFields : [],
    quietHoursStart: campaign.quietHoursStart || "",
    quietHoursEnd: campaign.quietHoursEnd || "",
    quietHoursTimezone: campaign.quietHoursTimezone || "",
    variantBTemplateId: campaign.variantBTemplateId || "",
    variantBTemplateParams: Array.isArray(campaign.variantBTemplateParams) ? campaign.variantBTemplateParams : [],
    variantSplitPercent: campaign.variantSplitPercent || 50,
    followUps: Array.isArray(campaign.followUps)
      ? campaign.followUps.map(f => ({ delayHours: f.delayHours, templateId: f.templateId, templateParams: Array.isArray(f.templateParams) ? f.templateParams : [] }))
      : [],
  };
}

/** Shown instead of the form when the campaign it depends on can't be loaded or used. */
export function CampaignNotice({ title, body, backLabel, onBack }: {
  title: string; body: string; backLabel: string; onBack: () => void;
}) {
  return (
    <div className="p-6 max-w-2xl mx-auto" data-testid="campaign-notice">
      <Button variant="ghost" size="sm" className="mb-4" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>
      <Card>
        <CardContent className="pt-6 text-center space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-600">{body}</p>
          <Button onClick={onBack} data-testid="button-notice-back">{backLabel}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function interpolatePreview(body: string, params: string[]): string {
  let result = body;
  for (let i = 0; i < params.length; i++) {
    const val = params[i]?.trim() || `{{${i + 1}}}`;
    result = result.replace(new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g"), val);
  }
  return result;
}

interface WorkbookDetail {
  id: string;
  name: string;
  currentVersion: { id: string; versionNumber: number; sheets: WorkbookSheet[] } | null;
}

export interface CampaignFormProps {
  heading: string;
  /** Starting values. Mount the form only once these are known — they seed state and are not re-read. */
  initialValues?: CampaignFormValues;
  submitting: boolean;
  pendingLabel: string;
  /** Kept for the pages that use this form; shown on the review step. */
  readyPrefix?: string;
  submitLabel: (hasSchedule: boolean, campaignType: CampaignFormValues["campaignType"]) => React.ReactNode;
  /** Offer "Send now" on the review step (after a confirmation showing how many people get it). */
  allowSendNow?: boolean;
  onSubmit: (values: CampaignFormValues, options?: CampaignSubmitOptions) => void;
  onCancel: () => void;
}

const STEP_LABEL: Record<WizardStepKey, string> = {
  who: "Who",
  message: "Message",
  when: "When",
  ai: "AI replies",
  review: "Review",
};

const pad = (values: string[], count: number) => Array.from({ length: count }, (_, i) => (values[i] ?? "").trim());

export default function CampaignForm({
  heading,
  initialValues = EMPTY_CAMPAIGN_FORM,
  submitting,
  pendingLabel,
  submitLabel,
  allowSendNow = false,
  onSubmit,
  onCancel,
}: CampaignFormProps) {
  const [, setLocation] = useLocation();
  const [v, setV] = useState<CampaignFormValues>(() => ({ ...EMPTY_CAMPAIGN_FORM, ...initialValues }));
  const set = (patch: Partial<CampaignFormValues>) => setV(prev => ({ ...prev, ...patch }));
  const [scheduleMode, setScheduleMode] = useState(Boolean(initialValues.scheduledAt));
  const [step, setStep] = useState<WizardStepKey>("who");
  const [confirmSend, setConfirmSend] = useState(false);
  const isAutomation = v.campaignType === "automation";
  const source = v.recipientSourceType || "ai_workbook";

  const { data: templates = [], isLoading: templatesLoading } = useQuery<WizardTemplate[]>({ queryKey: ["/api/whatsapp/templates"] });
  const { data: groups = [], isLoading: groupsLoading } = useQuery<WizardGroup[]>({ queryKey: ["/api/whatsapp/contact-groups"] });
  const { data: workbooks = [] } = useQuery<WorkbookSummary[]>({ queryKey: ["/api/whatsapp/ai-workbooks"], enabled: isAutomation });
  const { data: selectedWorkbook } = useQuery<WorkbookDetail>({
    queryKey: ["/api/whatsapp/ai-workbooks", v.recipientWorkbookId],
    queryFn: () => apiRequest("GET", `/api/whatsapp/ai-workbooks/${v.recipientWorkbookId}`),
    enabled: isAutomation && source === "ai_workbook" && Boolean(v.recipientWorkbookId),
  });
  const workbookSheet = isAutomation && source === "ai_workbook" ? selectedWorkbook?.currentVersion?.sheets[0] : undefined;

  const groupKey = [...v.groupIds].sort().join(",");
  const previewEnabled = v.groupIds.length > 0 && (!isAutomation || source === "contact_groups");
  const { data: preview, isFetching: previewLoading } = useQuery<AudiencePreview>({
    queryKey: ["/api/whatsapp/campaigns/audience-preview", groupKey],
    queryFn: () => apiRequest("POST", "/api/whatsapp/campaigns/audience-preview", { groupIds: groupKey.split(",") }),
    enabled: previewEnabled,
    staleTime: 30_000,
  });

  // Sample contact + fillable fields: the first audience contact, or the first workbook row.
  const { sample, fields } = useMemo((): { sample: SampleContact | null; fields: string[] } => {
    if (workbookSheet) {
      const row = workbookSheet.rows?.[0]?.values;
      const attrs: Record<string, string> = {};
      for (const [k, val] of Object.entries(row || {})) attrs[k] = val === null || val === undefined ? "" : String(val);
      return {
        sample: row ? { name: attrs[v.recipientNameColumn || "name"] || attrs.name || "", phone: attrs[v.recipientPhoneColumn || ""] || "", attributes: attrs } : null,
        fields: workbookSheet.columns.map(c => c.key),
      };
    }
    return { sample: previewEnabled ? preview?.sampleContact ?? null : null, fields: previewEnabled ? preview?.fields ?? [] : [] };
  }, [workbookSheet, preview, previewEnabled, v.recipientNameColumn, v.recipientPhoneColumn]);

  const approvedTemplates = templates.filter(t => t.status === "approved");
  const tplA = templates.find(t => t.id === v.templateId);
  const abOn = !isAutomation && Boolean(v.variantBTemplateId);
  const tplB = templates.find(t => t.id === v.variantBTemplateId);
  const followUp = !isAutomation ? v.followUps[0] : undefined;
  const followUpTpl = followUp ? templates.find(t => t.id === followUp.templateId) : undefined;
  const totalContacts = groups.filter(g => v.groupIds.includes(g.id)).reduce((sum, g) => sum + g.contactCount, 0);
  const blanks = (tpl: WizardTemplate | undefined, values: string[]) =>
    Array.from({ length: tpl?.paramCount || 0 }, (_, i) => i).filter(i => !(values[i] ?? "").trim());

  /** Nothing can be sent at all until both of these exist — said up front, before any effort. */
  const missingPrerequisite = templatesLoading || groupsLoading ? null
    : approvedTemplates.length === 0
      ? {
        title: "You need an approved template first",
        body: templates.length === 0
          ? "WhatsApp only lets businesses start conversations with a template it has approved in advance. Add one on the Templates page, then come back."
          : "None of your templates are approved yet. WhatsApp will not deliver an unapproved template.",
        href: "/admin/whatsapp-templates",
        cta: "Go to Templates",
      }
      : !isAutomation && groups.every(g => g.contactCount === 0)
        ? {
          title: "You need an audience with contacts in it",
          body: groups.length === 0 ? "A campaign is sent to an audience. Create one and add contacts, then come back." : "Your audiences are all empty, so a campaign would reach nobody. Add contacts first.",
          href: "/admin/whatsapp-contact-groups",
          cta: "Go to Audiences",
        }
        : null;

  const steps: WizardStepKey[] = isAutomation ? ["who", "message", "ai", "review"] : ["who", "message", "when", "ai", "review"];

  /** Why a step can't be left yet (null = fine). Mirrors the server's checks. */
  const problemOf = (key: WizardStepKey): string | null => {
    if (key === "who") {
      if (!v.name.trim()) return "Give the campaign a name.";
      if (isAutomation) {
        if (source === "ai_workbook" && !(v.recipientWorkbookId && v.recipientPhoneColumn)) return "Choose a workbook and its mobile number column.";
        if (source === "contact_groups" && v.groupIds.length === 0) return "Choose at least one audience.";
        return null;
      }
      if (v.groupIds.length === 0) return "Choose at least one audience.";
      if (totalContacts === 0) return "The audiences you picked have no contacts.";
      if (preview && preview.willSend === 0) return "Nobody in these audiences can receive the message.";
      return null;
    }
    if (key === "message") {
      if (!v.templateId) return "Choose a template.";
      if (!tplA) return "Loading template details…";
      if (tplA.status !== "approved") return "This template isn't approved, so WhatsApp won't deliver it.";
      if (blanks(tplA, v.templateParams).length) return "Fill in every blank in the message.";
      if (abOn) {
        if (!tplB || v.variantBTemplateId === AB_PENDING) return "Choose a template for message B, or switch the A/B test off.";
        if (blanks(tplB, v.variantBTemplateParams).length) return "Fill in every blank in message B.";
      }
      return null;
    }
    if (key === "when") {
      if (scheduleMode) {
        if (!v.scheduledAt) return "Pick a date and time, or choose Send right away.";
        if (new Date(v.scheduledAt).getTime() <= Date.now()) return "The scheduled time is in the past.";
      }
      if (v.quietHoursStart || v.quietHoursEnd) {
        if (!/^\d\d:\d\d$/.test(v.quietHoursStart) || !/^\d\d:\d\d$/.test(v.quietHoursEnd)) return "Set both quiet-hours times.";
        if (v.quietHoursStart === v.quietHoursEnd) return "Quiet hours can't start and end at the same time.";
      }
      if (followUp) {
        if (!Number.isInteger(followUp.delayHours) || followUp.delayHours < 1 || followUp.delayHours > 720) return "Reminder wait must be between 1 and 720 hours.";
        if (!followUp.templateId) return "Choose the reminder template.";
        if (followUpTpl && blanks(followUpTpl, followUp.templateParams).length) return "Fill in every blank in the reminder.";
      }
      return null;
    }
    return null;
  };

  const stepIndex = steps.indexOf(step);
  const firstBlocked = steps.findIndex(k => problemOf(k) !== null);
  const reachable = (i: number) => firstBlocked === -1 || i <= firstBlocked;
  const currentProblem = problemOf(step);
  const goTo = (key: WizardStepKey) => { if (reachable(steps.indexOf(key))) setStep(key); };
  const allValid = firstBlocked === -1;

  const buildValues = (): CampaignFormValues => {
    const out: CampaignFormValues = {
      ...v,
      name: v.name.trim(),
      templateParams: pad(v.templateParams, tplA?.paramCount || 0),
      scheduledAt: isAutomation || !scheduleMode ? "" : v.scheduledAt,
      groupIds: isAutomation && source === "ai_workbook" ? [] : v.groupIds,
      quietHoursStart: isAutomation ? "" : v.quietHoursStart,
      quietHoursEnd: isAutomation ? "" : v.quietHoursEnd,
      quietHoursTimezone: isAutomation || !v.quietHoursStart ? "" : v.quietHoursTimezone,
      variantBTemplateId: abOn && tplB ? v.variantBTemplateId : "",
      variantBTemplateParams: abOn && tplB ? pad(v.variantBTemplateParams, tplB.paramCount || 0) : [],
      variantSplitPercent: v.variantSplitPercent || 50,
      followUps: followUp && followUpTpl
        ? [{ delayHours: followUp.delayHours, templateId: followUp.templateId, templateParams: pad(followUp.templateParams, followUpTpl.paramCount || 0) }]
        : [],
    };
    if (isAutomation) {
      out.recipientSourceType = source;
      out.recipientWorkbookId = source === "ai_workbook" ? v.recipientWorkbookId : "";
      out.recipientWorkbookSheetId = source === "ai_workbook" ? workbookSheet?.id || v.recipientWorkbookSheetId : "";
      out.recipientAiAllowedFields = source === "ai_workbook" ? v.recipientAiAllowedFields : [];
    } else {
      // One-time campaigns don't carry a live recipient source; sending those fields would
      // make the server validate a workbook nobody chose.
      for (const key of [
        "recipientSourceType", "recipientWorkbookId", "recipientWorkbookSheetId", "recipientPhoneColumn",
        "recipientNameColumn", "recipientRecordKeyColumn", "recipientDateColumn", "recipientDateOffsetDays",
        "recipientStatusColumn", "recipientEligibleStatuses", "recipientAiAllowedFields",
      ] as const) delete out[key];
    }
    return out;
  };

  const submit = (options?: CampaignSubmitOptions) => {
    if (!allValid || submitting) return;
    onSubmit(buildValues(), options);
  };

  const ctx: WizardCtx = {
    v, set, isAutomation, templates, approvedTemplates, groups,
    preview: previewEnabled ? preview : undefined,
    previewLoading: previewEnabled && previewLoading,
    sample, fields, scheduleMode, setScheduleMode,
    workbooks, workbookName: selectedWorkbook?.name ?? null, workbookSheet,
  };
  const willSend = preview?.willSend ?? totalContacts;
  const hasSchedule = !isAutomation && scheduleMode && Boolean(v.scheduledAt);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Top bar with steps */}
      <div className="sticky top-0 z-10 border-b bg-white shadow-sm">
        <div className="flex items-center gap-2 px-3 py-2.5 sm:px-6">
          <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5 text-gray-600">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
          </Button>
          <Megaphone className="h-5 w-5 shrink-0 text-emerald-600" />
          <h1 className="truncate text-base font-semibold sm:text-lg">{heading}</h1>
        </div>
        <nav className="overflow-x-auto px-3 pb-2.5 sm:px-6" aria-label="Campaign steps">
          <ol className="flex min-w-max items-center gap-1.5">
            {steps.map((key, i) => {
              const active = key === step;
              const done = i < stepIndex && problemOf(key) === null;
              return (
                <li key={key} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => goTo(key)}
                    disabled={!reachable(i)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                      active ? "bg-emerald-600 text-white" : done ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                    aria-current={active ? "step" : undefined}
                    data-testid={`wizard-step-${key}`}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${active ? "bg-white/20" : "bg-white"}`}>
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    {STEP_LABEL[key]}
                  </button>
                  {i < steps.length - 1 && <span className="h-px w-3 bg-gray-300 sm:w-6" />}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {/* Body */}
      <div className="mx-auto w-full max-w-5xl flex-1 p-3 sm:p-6">
        {missingPrerequisite && step === "who" && (
          <Card className="mb-4 border-amber-300 bg-amber-50">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">{missingPrerequisite.title}</p>
                <p className="mt-1 text-sm text-amber-800">{missingPrerequisite.body}</p>
                <Button size="sm" variant="outline" className="mt-3 bg-white" onClick={() => setLocation(missingPrerequisite.href)} data-testid="button-fix-prerequisite">
                  {missingPrerequisite.cta}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {step === "who" && <StepWho ctx={ctx} />}
        {step === "message" && <StepMessage ctx={ctx} />}
        {step === "when" && <StepWhen ctx={ctx} />}
        {step === "ai" && <StepAiReplies ctx={ctx} />}
        {step === "review" && <StepReview ctx={ctx} goTo={goTo} />}
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 border-t bg-white px-3 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className={`text-sm ${currentProblem ? "text-amber-700" : "text-gray-500"}`} data-testid="text-step-status">
            {currentProblem
              ?? (step === "review"
                ? (isAutomation ? "Ready — next you'll choose when it repeats." : hasSchedule ? "Ready to schedule." : "Ready. Save it as a draft or send it now.")
                : `Step ${stepIndex + 1} of ${steps.length}`)}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {stepIndex > 0 ? (
              <Button variant="outline" onClick={() => setStep(steps[stepIndex - 1])}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Button>
            ) : (
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
            )}
            {step !== "review" ? (
              <Button onClick={() => setStep(steps[stepIndex + 1])} disabled={Boolean(currentProblem)} data-testid="button-wizard-next">
                Next <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button
                  variant={allowSendNow && !hasSchedule && !isAutomation ? "outline" : "default"}
                  disabled={!allValid || submitting}
                  onClick={() => submit()}
                  className="gap-1.5"
                  data-testid="button-submit-campaign"
                >
                  {submitting ? pendingLabel : submitLabel(hasSchedule, v.campaignType)}
                </Button>
                {allowSendNow && !hasSchedule && !isAutomation && (
                  <Button disabled={!allValid || submitting} onClick={() => setConfirmSend(true)} className="gap-1.5" data-testid="button-send-now">
                    <Send className="h-4 w-4" /> Send now
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {willSend.toLocaleString()} {willSend === 1 ? "person" : "people"} now?</AlertDialogTitle>
            <AlertDialogDescription>
              Messages start going out right away and can't be taken back.
              {v.quietHoursStart && v.quietHoursEnd ? ` Nothing is sent between ${v.quietHoursStart} and ${v.quietHoursEnd}; sending waits and carries on after that.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => submit({ sendNow: true })} data-testid="button-confirm-send-now">Send now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
