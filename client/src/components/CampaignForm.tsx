import { useState, useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Megaphone, FileCode2, Users, Calendar, Bot,
  MessageSquare, Clock, Sparkles, AlertTriangle, Tags,
} from "lucide-react";
import { useLocation } from "wouter";
import { ReplyClassificationEditor } from "@/components/whatsapp/ReplyClassificationEditor";
import type { ReplyClassification } from "@shared/schema";

/**
 * Shared campaign configuration form, used by both the create and edit pages so the two
 * cannot drift apart as fields are added. The form owns its own state; the parent supplies
 * the starting values and decides what happens on submit.
 */

export interface Template {
  id: string;
  name: string;
  status: string;
  paramCount: number;
  bodyText: string;
  msg91TemplateId?: string | null;
}

export interface Group {
  id: string;
  name: string;
  contactCount: number;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  attributes?: Record<string, string>;
}

export interface CampaignFormValues {
  name: string;
  campaignType: "one_time" | "automation";
  templateId: string;
  groupIds: string[];
  templateParams: string[];
  /** datetime-local string ("" means no schedule) */
  scheduledAt: string;
  aiEnabled: boolean;
  aiAgentName: string;
  aiSystemPrompt: string;
  aiUseFaqs: boolean;
  aiUseDocs: boolean;
  aiUseProducts: boolean;
  /** Outcome categories the AI sorts inbound replies into. Empty = broadcast only. */
  replyClassifications: ReplyClassification[];
}

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

function SectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-5">
        <CardTitle className="text-base flex items-center gap-2 text-gray-800">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-3">
        {children}
      </CardContent>
    </Card>
  );
}

const ALWAYS_AVAILABLE = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
];

function FieldChips({
  extraKeys,
  onInsert,
}: {
  extraKeys: string[];
  onInsert: (placeholder: string) => void;
}) {
  const all = [
    ...ALWAYS_AVAILABLE,
    ...extraKeys.filter(k => !["name", "phone"].includes(k)).map(k => ({ key: k, label: k })),
  ];
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      <span className="text-xs text-gray-400 self-center">Insert field:</span>
      {all.map(f => (
        <button
          key={f.key}
          type="button"
          onClick={() => onInsert(`{{${f.key}}}`)}
          className="inline-flex items-center rounded-full border border-dashed border-emerald-400 bg-emerald-50 px-2.5 py-0.5 text-xs font-mono text-emerald-800 hover:bg-emerald-100 hover:border-emerald-500 transition-colors cursor-pointer"
        >
          {`{{${f.key}}}`}
        </button>
      ))}
    </div>
  );
}

export interface CampaignFormProps {
  heading: string;
  /** Starting values. Mount the form only once these are known — they seed state and are not re-read. */
  initialValues?: CampaignFormValues;
  submitting: boolean;
  pendingLabel: string;
  /** Leading text in the footer when the form is valid, e.g. "Ready to create". */
  readyPrefix: string;
  submitLabel: (hasSchedule: boolean, campaignType: CampaignFormValues["campaignType"]) => React.ReactNode;
  onSubmit: (values: CampaignFormValues) => void;
  onCancel: () => void;
}

export default function CampaignForm({
  heading,
  initialValues = EMPTY_CAMPAIGN_FORM,
  submitting,
  pendingLabel,
  readyPrefix,
  submitLabel,
  onSubmit,
  onCancel,
}: CampaignFormProps) {
  const [name, setName] = useState(initialValues.name);
  const [campaignType, setCampaignType] = useState<CampaignFormValues["campaignType"]>(initialValues.campaignType);
  const [templateId, setTemplateId] = useState(initialValues.templateId);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(initialValues.groupIds);
  const [params, setParams] = useState<string[]>(initialValues.templateParams);
  const [scheduleAt, setScheduleAt] = useState(initialValues.scheduledAt);
  const [aiEnabled, setAiEnabled] = useState(initialValues.aiEnabled);
  const [aiAgentName, setAiAgentName] = useState(initialValues.aiAgentName);
  const [aiSystemPrompt, setAiSystemPrompt] = useState(initialValues.aiSystemPrompt);
  const [replyClassifications, setReplyClassifications] = useState<ReplyClassification[]>(
    initialValues.replyClassifications || []
  );
  const [aiUseFaqs, setAiUseFaqs] = useState(initialValues.aiUseFaqs);
  const [aiUseDocs, setAiUseDocs] = useState(initialValues.aiUseDocs);
  const [aiUseProducts, setAiUseProducts] = useState(initialValues.aiUseProducts);
  const [, setLocation] = useLocation();

  const { data: templates = [] } = useQuery<Template[]>({ queryKey: ["/api/whatsapp/templates"] });
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/whatsapp/contact-groups"] });

  // Fetch a sample of contacts from each selected group to discover attribute keys
  const contactSampleQueries = useQueries({
    queries: selectedGroups.map(groupId => ({
      queryKey: ["/api/whatsapp/contact-groups", groupId, "contacts-sample"],
      queryFn: async () => {
        const res = await apiRequest("GET", `/api/whatsapp/contact-groups/${groupId}/contacts?limit=50`);
        return (Array.isArray(res) ? res : res.contacts ?? []) as Contact[];
      },
      staleTime: 60_000,
    })),
  });

  const extraAttributeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const q of contactSampleQueries) {
      for (const contact of (q.data ?? [])) {
        for (const k of Object.keys(contact.attributes ?? {})) {
          keys.add(k);
        }
      }
    }
    return Array.from(keys).sort();
  }, [contactSampleQueries]);

  const selectedTemplate = templates.find(t => t.id === templateId);
  const requiredParams = selectedTemplate?.paramCount || 0;

  // These two bars mirror the server's prerequisite checks exactly. WhatsApp only delivers
  // approved templates, and a group with no contacts produces a campaign addressed to nobody.
  // If the form were more permissive than the server, the user would fill everything in and
  // only discover the problem when the save is rejected.
  const approvedTemplates = templates.filter(t => t.status === "approved");
  const nonEmptyGroups = groups.filter(g => g.contactCount > 0);
  const selectedTemplateApproved = !selectedTemplate || selectedTemplate.status === "approved";
  const isAutomation = campaignType === "automation";

  const totalContacts = groups
    .filter(g => selectedGroups.includes(g.id))
    .reduce((sum, g) => sum + g.contactCount, 0);

  /** Nothing can be sent at all until both of these exist — shown before the form is filled in. */
  const missingPrerequisite =
    approvedTemplates.length === 0
      ? {
          title: "You need an approved template first",
          body:
            templates.length === 0
              ? "WhatsApp only lets businesses start conversations using a template it has approved in advance. Add one on the Templates page, then come back."
              : "None of your templates are approved yet. WhatsApp will not deliver an unapproved template, so a campaign using one would fail for every recipient.",
          href: "/admin/whatsapp-templates",
          cta: "Go to Templates",
        }
      : !isAutomation && nonEmptyGroups.length === 0
        ? {
            title: "You need an audience with contacts in it",
            body:
              groups.length === 0
                ? "A campaign sends to a contact group. Create one and add contacts, then come back."
                : "Your contact groups are all empty, so a campaign would reach nobody. Add contacts to a group first.",
            href: "/admin/whatsapp-contact-groups",
            cta: "Go to Contact Groups",
          }
        : null;

  // How many parameters we submit is derived from the selected template's metadata. When
  // editing, the campaign's template is known before the templates list has loaded — saving in
  // that window would compute zero required parameters and wipe the stored values. Block
  // submission until the template actually resolves.
  const templateResolved = !templateId || Boolean(selectedTemplate);

  // WhatsApp refuses to deliver a message with an empty personalization slot, and it refuses it
  // for every recipient, so a blank here is not a partial send — it is a campaign that fails
  // wholesale once it is too late to edit.
  const blankParams = Array.from({ length: requiredParams }, (_, i) => i)
    .filter(i => !(params[i] ?? "").trim());
  const paramsComplete = blankParams.length === 0;

  const basicsComplete = Boolean(name.trim()) && Boolean(templateId) && (isAutomation || selectedGroups.length > 0);
  // totalContacts > 0 is the client-side twin of the server's empty-audience refusal.
  const audienceUsable = isAutomation || totalContacts > 0;
  const canSubmit =
    basicsComplete && templateResolved && paramsComplete && audienceUsable && selectedTemplateApproved;

  const handleSubmit = () => {
    if (!selectedTemplate || !paramsComplete) return;
    const padded: string[] = [];
    for (let i = 0; i < requiredParams; i++) padded.push((params[i] ?? "").trim());
    onSubmit({
      name,
      campaignType,
      templateId,
      groupIds: isAutomation ? [] : selectedGroups,
      templateParams: padded,
      scheduledAt: isAutomation ? "" : scheduleAt,
      aiEnabled,
      aiAgentName,
      aiSystemPrompt,
      aiUseFaqs,
      aiUseDocs,
      aiUseProducts,
      replyClassifications,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b px-6 py-3 flex items-center gap-3 shadow-sm">
        <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5 text-gray-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <Megaphone className="h-5 w-5 text-emerald-600" />
        <h1 className="text-lg font-semibold">{heading}</h1>
      </div>

      {/* Body */}
      <div className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {/* Stated up front, before the user invests effort in a form that cannot be saved.
            The server refuses these too; this is what stops the refusal being a surprise. */}
        {missingPrerequisite && (
          <Card className="mb-6 border-amber-300 bg-amber-50">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900">{missingPrerequisite.title}</p>
                  <p className="text-sm text-amber-800 mt-1">{missingPrerequisite.body}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 bg-white"
                    onClick={() => setLocation(missingPrerequisite.href)}
                    data-testid="button-fix-prerequisite"
                  >
                    {missingPrerequisite.cta}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">

          {/* Left: form */}
          <div className="space-y-4">

            {/* Campaign basics */}
            <SectionCard icon={<Megaphone className="h-4 w-4 text-emerald-600" />} title="Campaign basics">
              <div>
                <label className="text-sm font-medium text-gray-700">Campaign type <span className="text-red-500">*</span></label>
                <p className="text-xs text-gray-500 mt-0.5 mb-2">Choose whether this campaign is sent once or reused by a recurring automation.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    ["one_time", "One-time campaign", "Choose the audience and optional send time here."],
                    ["automation", "Automation campaign", "Save the message and AI behavior; choose audience and recurring timing later."],
                  ] as const).map(([value, label, description]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setCampaignType(value);
                        if (value === "automation") {
                          setSelectedGroups([]);
                          setScheduleAt("");
                        }
                      }}
                      className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                        campaignType === value
                          ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                          : "border-gray-200 hover:border-emerald-300 hover:bg-gray-50"
                      }`}
                      data-testid={`button-campaign-type-${value}`}
                    >
                      <span className="block text-sm font-medium text-gray-800">{label}</span>
                      <span className="block text-xs text-gray-500 mt-1">{description}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Campaign name <span className="text-red-500">*</span></label>
                <Input
                  className="mt-1"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Diwali offer 2026"
                  data-testid="input-campaign-name"
                />
              </div>
            </SectionCard>

            {/* Template */}
            <SectionCard icon={<FileCode2 className="h-4 w-4 text-blue-600" />} title="Template">
              <div>
                <label className="text-sm font-medium text-gray-700">Choose template <span className="text-red-500">*</span></label>
                <Select value={templateId} onValueChange={v => { setTemplateId(v); setParams([]); }}>
                  <SelectTrigger className="mt-1" data-testid="select-campaign-template">
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.length === 0 && (
                      <div className="p-3 text-sm text-gray-500">
                        No templates yet — add one on the Templates page first.
                      </div>
                    )}
                    {templates.length > 0 && approvedTemplates.length === 0 && (
                      <div className="p-3 text-sm text-gray-500">
                        None of your templates are approved yet, so none can be sent.
                      </div>
                    )}
                    {/* Only approved templates are offered. Listing an unapproved one as a
                        choosable option invites the user to build a campaign that can never send. */}
                    {approvedTemplates.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="font-mono">{t.name}</span>
                        <span className="ml-2 text-gray-500 text-xs">· {t.paramCount} param{t.paramCount !== 1 ? "s" : ""}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

            </SectionCard>

            {/* Template parameters — only shown when template has params */}
            {requiredParams > 0 && (
              <SectionCard icon={<Sparkles className="h-4 w-4 text-amber-500" />} title="Template parameters">
                <p className="text-xs text-gray-500">
                  Type a fixed value like <code className="bg-gray-100 px-1 rounded">"50%"</code>, or click a field chip below to personalise per contact (e.g. each person's name).
                </p>
                {selectedGroups.length === 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    Select a contact group above to see available contact fields.
                  </p>
                )}
                {Array.from({ length: requiredParams }).map((_, i) => (
                  <div key={i}>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Parameter {i + 1} <span className="font-mono text-gray-400">{`{{${i + 1}}}`}</span>
                    </label>
                    <Input
                      value={params[i] || ""}
                      onChange={e => {
                        const next = [...params];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                      placeholder={`e.g. {{name}} or "Diwali Offer"`}
                      aria-invalid={blankParams.includes(i)}
                      className={blankParams.includes(i) ? "border-amber-400 focus-visible:ring-amber-400" : undefined}
                      data-testid={`input-param-${i}`}
                    />
                    {blankParams.includes(i) && (
                      <p className="text-xs text-amber-700 mt-1" data-testid={`text-param-required-${i}`}>
                        Required — WhatsApp won't deliver the message if this is blank.
                      </p>
                    )}
                    <FieldChips
                      extraKeys={extraAttributeKeys}
                      onInsert={placeholder => {
                        const next = [...params];
                        next[i] = placeholder;
                        setParams(next);
                      }}
                    />
                  </div>
                ))}
              </SectionCard>
            )}

            {/* Audience — automation campaigns choose this later in Automations. */}
            {!isAutomation && <SectionCard icon={<Users className="h-4 w-4 text-purple-600" />} title="Audience">
              <div>
                <label className="text-sm font-medium text-gray-700">Contact groups <span className="text-red-500">*</span></label>
                <p className="text-xs text-gray-500 mt-0.5 mb-2">Select one or more groups to receive this campaign.</p>
                <div className="border rounded-lg divide-y">
                  {groups.length === 0 && (
                    <div className="text-sm text-gray-500 p-4 text-center">No groups yet — create a contact group first.</div>
                  )}
                  {groups.map(g => {
                    // An empty group is not a valid audience — the server refuses it too, so it
                    // is shown but not selectable, with the reason stated inline.
                    const isEmpty = g.contactCount === 0;
                    return (
                      <label
                        key={g.id}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                          isEmpty ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-50 cursor-pointer"
                        }`}
                      >
                        <Checkbox
                          checked={selectedGroups.includes(g.id)}
                          disabled={isEmpty}
                          onCheckedChange={(checked) => {
                            setSelectedGroups(prev => checked ? [...prev, g.id] : prev.filter(x => x !== g.id));
                          }}
                          data-testid={`checkbox-group-${g.id}`}
                        />
                        <Users className="h-4 w-4 text-gray-400 shrink-0" />
                        <span className="flex-1 text-sm font-medium">{g.name}</span>
                        {isEmpty ? (
                          <span className="text-xs text-gray-500">Empty — add contacts to use this</span>
                        ) : (
                          <Badge variant="outline" className="text-xs font-normal">{g.contactCount} contacts</Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
                {selectedGroups.length > 0 && (
                  <p className="text-xs text-emerald-700 font-medium mt-1.5">
                    {selectedGroups.length} group{selectedGroups.length !== 1 ? "s" : ""} selected · ~{totalContacts} recipients
                  </p>
                )}
              </div>
            </SectionCard>}

            {/* Schedule — recurring automation timing is configured separately. */}
            {!isAutomation && <SectionCard icon={<Calendar className="h-4 w-4 text-amber-600" />} title="Schedule">
              <div>
                <label className="text-sm font-medium text-gray-700">Send at (optional)</label>
                <Input
                  className="mt-1"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={e => setScheduleAt(e.target.value)}
                  data-testid="input-schedule"
                />
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Leave blank to send immediately when you click "Send Now" on the campaigns list.
                </p>
              </div>
            </SectionCard>}

            {/* AI replies */}
            <SectionCard icon={<Bot className="h-4 w-4 text-indigo-600" />} title="AI replies">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-700">AI replies on inbound messages</div>
                  <div className="text-xs text-gray-500 mt-0.5">When a recipient replies, an AI agent negotiates using your knowledge base.</div>
                </div>
                <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} data-testid="switch-ai-enabled" />
              </div>

              {aiEnabled && (
                <>
                  <Separator />
                  <div>
                    <label className="text-sm font-medium text-gray-700">Agent name</label>
                    <Input
                      className="mt-1"
                      value={aiAgentName}
                      onChange={e => setAiAgentName(e.target.value)}
                      placeholder="Sales Agent"
                      data-testid="input-ai-agent-name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Custom persona / instructions <span className="text-gray-400 font-normal">(optional)</span></label>
                    <Textarea
                      className="mt-1"
                      value={aiSystemPrompt}
                      onChange={e => setAiSystemPrompt(e.target.value)}
                      rows={4}
                      placeholder="You are a warm sales rep promoting our Diwali offer. Goal: get them to book a demo. Allowed discount: up to 15%..."
                      data-testid="input-ai-system-prompt"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-2">Knowledge base sources</label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <Checkbox checked={aiUseFaqs} onCheckedChange={c => setAiUseFaqs(!!c)} />
                        FAQs
                      </label>
                      <label className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <Checkbox checked={aiUseDocs} onCheckedChange={c => setAiUseDocs(!!c)} />
                        Training docs
                      </label>
                      <label className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <Checkbox checked={aiUseProducts} onCheckedChange={c => setAiUseProducts(!!c)} />
                        Products
                      </label>
                    </div>
                  </div>
                </>
              )}
            </SectionCard>

            {/* Reply classification — intentionally outside the AI-replies toggle:
                outcomes are still recorded for campaigns that don't auto-reply. */}
            <SectionCard icon={<Tags className="h-4 w-4 text-violet-600" />} title="Reply outcomes">
              <p className="text-xs text-gray-500 -mt-1">
                Sort every inbound reply into your own outcome categories and pull out the details you
                care about. Works whether or not AI replies are switched on.
              </p>
              <ReplyClassificationEditor
                value={replyClassifications}
                onChange={setReplyClassifications}
              />
            </SectionCard>

          </div>

          {/* Right: sticky preview */}
          <div className="lg:sticky lg:top-[60px] space-y-4">
            <Card className="overflow-hidden">
              <CardHeader className="bg-emerald-600 py-3 px-4">
                <CardTitle className="text-white text-sm flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" /> Message preview
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 bg-[#e5ddd5] min-h-[180px]">
                {selectedTemplate ? (
                  <div className="bg-white rounded-lg rounded-tl-none shadow-sm p-3 max-w-[90%] text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {interpolatePreview(selectedTemplate.bodyText, params)}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 text-center text-gray-500 text-sm gap-2">
                    <MessageSquare className="h-6 w-6 text-gray-300" />
                    Select a template to see the preview
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Campaign summary */}
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm text-gray-700 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" /> Campaign summary
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Template</span>
                  <span className="font-mono font-medium text-right truncate max-w-[160px]">
                    {selectedTemplate ? selectedTemplate.name : <span className="text-gray-400 font-sans font-normal">—</span>}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Groups</span>
                   <span className="font-medium">{isAutomation ? <span className="text-violet-700">Choose in Automations</span> : selectedGroups.length > 0 ? `${selectedGroups.length} selected` : <span className="text-gray-400">—</span>}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Recipients</span>
                   <span className="font-medium text-emerald-700">{isAutomation ? <span className="text-violet-700">Later</span> : totalContacts > 0 ? `~${totalContacts}` : <span className="text-gray-400">—</span>}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Schedule</span>
                   <span className="font-medium">{isAutomation ? <span className="text-violet-700">Recurring setup later</span> : scheduleAt ? new Date(scheduleAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : <span className="text-gray-400">Send manually</span>}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">AI replies</span>
                  <span className={`font-medium ${aiEnabled ? "text-indigo-700" : "text-gray-400"}`}>{aiEnabled ? `On · ${aiAgentName}` : "Off"}</span>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>

      {/* Sticky bottom action bar */}
      <div className="sticky bottom-0 bg-white border-t px-6 py-3 flex items-center justify-between shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <div className="text-sm text-gray-500">
          {!canSubmit && (
            templateId && !templateResolved
              ? <span>Loading template details&hellip;</span>
                 : !basicsComplete
                 ? <span>Fill in name, template, and at least one group to continue.</span>
                : !selectedTemplateApproved
                  ? <span className="text-amber-700">This template is not approved, so WhatsApp will not deliver it. Pick an approved one.</span>
                : !audienceUsable
                  ? <span className="text-amber-700" data-testid="text-empty-audience">
                      The groups you picked have no contacts, so this campaign would reach nobody.
                    </span>
                : <span data-testid="text-blank-params">
                    Fill in {blankParams.length === 1 ? "parameter" : "parameters"}{" "}
                    {blankParams.map(i => i + 1).join(", ")} &mdash; WhatsApp won't deliver a message with a blank value.
                  </span>
          )}
          {canSubmit && <span className="text-emerald-700 font-medium">
            {isAutomation
              ? `${readyPrefix} — message and AI behavior ready for automation setup.`
              : `${readyPrefix} — ${totalContacts} recipients in ${selectedGroups.length} group${selectedGroups.length !== 1 ? "s" : ""}.`}
          </span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
            data-testid="button-submit-campaign"
            className="gap-1.5"
          >
            {submitting ? pendingLabel : submitLabel(Boolean(scheduleAt), campaignType)}
          </Button>
        </div>
      </div>
    </div>
  );
}
