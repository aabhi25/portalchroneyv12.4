import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Loader2, Plus, Trash2, GripVertical,
  FileText, Shield, Save, AlertCircle, Link2, Sparkles, Zap
} from "lucide-react";

interface ExtractionField {
  key: string;
  label: string;
  required: boolean;
  formatRegex?: string;
  formatDescription?: string;
}

interface ValidationRules {
  duplicateCheck?: boolean;
  duplicateField?: string;
}

interface LeadFieldMapping {
  extractionFieldKey: string;
  leadFieldKey: string;
}

interface LeadField {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  isDefault: boolean;
  isEnabled: boolean;
  displayOrder: number;
}

interface DocumentTypeConfig {
  id: string;
  businessAccountId: string;
  key: string;
  name: string;
  isSystemDefault: boolean;
  isActive: boolean;
  promptTemplate: string | null;
  extractionFields: ExtractionField[];
  validationRules: ValidationRules | null;
  leadFieldMappings: LeadFieldMapping[];
  confirmationRequired: string | null;
  scanModel: string | null;
  version: number;
}

interface DocumentTypePayload {
  name: string;
  key?: string;
  promptTemplate: string | null;
  extractionFields: ExtractionField[];
  validationRules: ValidationRules | null;
  leadFieldMappings: LeadFieldMapping[];
  confirmationRequired?: string | null;
  scanModel?: string | null;
}

interface UpdateDocumentTypePayload extends DocumentTypePayload {
  id: string;
}

export default function DocumentTypeEditor() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/admin/document-type-editor/:id");
  const editId = params?.id;
  const isNew = !editId;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/whatsapp/document-types"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/document-types", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch document types");
      return res.json() as Promise<{ documentTypes: DocumentTypeConfig[] }>;
    },
  });

  const docType = editId ? data?.documentTypes?.find((dt) => dt.id === editId) : undefined;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/whatsapp-flow-settings")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
            <p className="text-gray-500">Failed to load document types. Please try again.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isNew && !docType && data) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/whatsapp-flow-settings")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-8 w-8 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500">Document type not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <EditorForm
      docType={isNew ? undefined : docType}
      isNew={isNew}
      onNavigateBack={() => navigate("/admin/whatsapp-flow-settings")}
      toast={toast}
    />
  );
}

function EditorForm({
  docType,
  isNew,
  onNavigateBack,
  toast,
}: {
  docType?: DocumentTypeConfig;
  isNew: boolean;
  onNavigateBack: () => void;
  toast: ReturnType<typeof import("@/hooks/use-toast").useToast>["toast"];
}) {
  const { data: leadFieldsData } = useQuery({
    queryKey: ["/api/whatsapp/lead-fields"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/lead-fields", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch lead fields");
      return res.json() as Promise<{ fields: LeadField[] }>;
    },
  });

  const availableLeadFields = (leadFieldsData?.fields || []).filter((f) => f.isEnabled);

  const [name, setName] = useState(docType?.name || "");
  const [key, setKey] = useState(docType?.key || "");
  const [promptTemplate, setPromptTemplate] = useState(docType?.promptTemplate || "");
  const [fields, setFields] = useState<ExtractionField[]>(
    docType?.extractionFields?.length ? docType.extractionFields : [{ key: "", label: "", required: true }]
  );

  const [duplicateCheck, setDuplicateCheck] = useState(docType?.validationRules?.duplicateCheck || false);
  const [duplicateField, setDuplicateField] = useState(docType?.validationRules?.duplicateField || "");
  const [leadFieldMappings, setLeadFieldMappings] = useState<LeadFieldMapping[]>(
    docType?.leadFieldMappings?.length ? docType.leadFieldMappings : []
  );
  const [confirmationRequired, setConfirmationRequired] = useState<string | null>(
    docType?.confirmationRequired ?? null
  );
  const [scanModel, setScanModel] = useState<"gpt-4o-mini" | "gpt-4o">(
    docType?.scanModel === "gpt-4o" ? "gpt-4o" : "gpt-4o-mini"
  );
  const [expandedFieldIdx, setExpandedFieldIdx] = useState<number | null>(null);

  const keyedFields = fields.filter((f) => f.key.trim() !== '');

  const addField = () => setFields([...fields, { key: "", label: "", required: false }]);
  const removeField = (idx: number) => {
    if (expandedFieldIdx === idx) setExpandedFieldIdx(null);
    else if (expandedFieldIdx !== null && expandedFieldIdx > idx) setExpandedFieldIdx(expandedFieldIdx - 1);
    setFields(fields.filter((_, i) => i !== idx));
  };
  const updateField = (idx: number, updates: Partial<ExtractionField>) => {
    setFields(fields.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  };

  const buildPayload = (): DocumentTypePayload | null => {
    const validFields = fields.filter((f) => f.key.trim() && f.label.trim());
    if (!name.trim() || validFields.length === 0) return null;

    const mappedFields: ExtractionField[] = validFields.map((f) => {
      const field: ExtractionField = {
        key: f.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        label: f.label.trim(),
        required: f.required,
      };
      if (f.formatRegex?.trim()) field.formatRegex = f.formatRegex.trim();
      if (f.formatDescription?.trim()) field.formatDescription = f.formatDescription.trim();
      return field;
    });

    const validMappings = leadFieldMappings.filter(
      (m) => m.extractionFieldKey.trim() && m.leadFieldKey.trim()
    );

    const payload: DocumentTypePayload = {
      name: name.trim(),
      promptTemplate: promptTemplate.trim() || null,
      extractionFields: mappedFields,
      validationRules: duplicateCheck
        ? { duplicateCheck, duplicateField: duplicateField || undefined }
        : null,
      leadFieldMappings: validMappings,
      confirmationRequired,
      scanModel,
    };

    if (isNew) {
      payload.key = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    }

    return payload;
  };

  const createMutation = useMutation({
    mutationFn: async (data: DocumentTypePayload) => {
      const res = await fetch("/api/whatsapp/document-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Document type created" });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/document-types"] });
      onNavigateBack();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: UpdateDocumentTypePayload) => {
      const res = await fetch(`/api/whatsapp/document-types/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Document type updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/document-types"] });
      onNavigateBack();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const validFieldCount = fields.filter((f) => f.key.trim() && f.label.trim()).length;
  const canSubmit = name.trim() && validFieldCount > 0 && (isNew ? key.trim() : true);

  const handleSubmit = () => {
    const payload = buildPayload();
    if (!payload) return;

    if (isNew) {
      createMutation.mutate(payload);
    } else if (docType) {
      updateMutation.mutate({ id: docType.id, ...payload });
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onNavigateBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Settings
        </Button>
        {!isNew && docType && (
          <span className="text-xs text-gray-400">v{docType.version} {docType.isSystemDefault ? "| System Default" : ""}</span>
        )}
      </div>

      <div>
        <h1 className="text-xl font-semibold">
          {isNew ? "Add New Document Type" : `Edit: ${docType?.name}`}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {isNew
            ? "Configure a new document type for AI-powered extraction."
            : "Update the extraction configuration for this document type."}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-purple-600" />
            Basic Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Document Name</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (isNew) setKey(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_"));
                }}
                placeholder="e.g. Mark Sheet"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Key (identifier)</Label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={!isNew}
                placeholder="e.g. mark_sheet"
                className={!isNew ? "bg-gray-50 text-gray-500" : ""}
              />
              {!isNew && (
                <p className="text-xs text-gray-400">Key cannot be changed after creation.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">AI Prompt Template</CardTitle>
          <p className="text-sm text-gray-500">
            Custom instruction for the AI when analyzing this document type. Leave empty for an auto-generated prompt.
          </p>
        </CardHeader>
        <CardContent>
          <Textarea
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            placeholder="You are an expert document analyzer. Analyze this document carefully..."
            rows={4}
            className="text-sm"
          />
          <p className="text-xs text-gray-400 mt-2">
            The extraction fields below will be automatically appended to this prompt.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Extraction Fields</CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                Define what data to extract from this document. Click the shield icon to add format validation per field.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={addField}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Field
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="hidden sm:grid grid-cols-[24px_1fr_1fr_auto_32px_32px] gap-2 items-center px-1 pb-1 border-b">
              <span />
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Field Key</span>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Display Label</span>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider w-24 text-center">Required</span>
              <span />
              <span />
            </div>

            {fields.map((field, idx) => (
              <div key={idx} className="space-y-2">
                <div className="grid grid-cols-[24px_1fr_1fr_auto_32px_32px] gap-2 items-center">
                  <GripVertical className="h-4 w-4 text-gray-300 cursor-grab" />
                  <Input
                    value={field.key}
                    onChange={(e) => updateField(idx, { key: e.target.value })}
                    placeholder="field_key"
                    className="text-sm h-9"
                  />
                  <Input
                    value={field.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    placeholder="Display Label"
                    className="text-sm h-9"
                  />
                  <div className="flex items-center gap-1.5 w-24 justify-center">
                    <Switch
                      checked={field.required}
                      onCheckedChange={(val) => updateField(idx, { required: val })}
                      className="scale-80"
                    />
                    <span className="text-xs text-gray-500 w-14">
                      {field.required ? "Required" : "Optional"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setExpandedFieldIdx(expandedFieldIdx === idx ? null : idx)}
                    className={`h-8 w-8 ${field.formatRegex || field.formatDescription ? "text-blue-500" : "text-gray-300"} hover:text-blue-600`}
                    title="Format validation"
                  >
                    <Shield className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeField(idx)}
                    className="h-8 w-8 text-red-400 hover:text-red-600"
                    disabled={fields.length <= 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {expandedFieldIdx === idx && (
                  <div className="ml-8 pl-3 border-l-2 border-blue-200 bg-blue-50/50 rounded-r-md p-3 grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">Format Regex</Label>
                      <Input
                        value={field.formatRegex || ""}
                        onChange={(e) => updateField(idx, { formatRegex: e.target.value })}
                        placeholder="e.g. ^\d{12}$"
                        className="text-sm h-8 bg-white"
                      />
                      <p className="text-xs text-gray-400">Regular expression to validate this field's value.</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-500">Format Description</Label>
                      <Input
                        value={field.formatDescription || ""}
                        onChange={(e) => updateField(idx, { formatDescription: e.target.value })}
                        placeholder="e.g. 12-digit number"
                        className="text-sm h-8 bg-white"
                      />
                      <p className="text-xs text-gray-400">Human-readable description shown in validation warnings.</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {fields.length === 0 && (
              <div className="text-center py-6 text-gray-400 text-sm">
                No fields yet. Click "Add Field" to get started.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4 text-purple-600" />
                Lead Field Mapping
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                Map extracted document fields to lead fields so they auto-fill when a document is processed.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setLeadFieldMappings([...leadFieldMappings, { extractionFieldKey: "", leadFieldKey: "" }])
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Mapping
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {leadFieldMappings.length > 0 && (
            <div className="space-y-3">
              <div className="hidden sm:grid grid-cols-[1fr_24px_1fr_32px] gap-2 items-center px-1 pb-1 border-b">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Extraction Field Key</span>
                <span />
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Lead Field Key</span>
                <span />
              </div>
              {leadFieldMappings.map((mapping, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_24px_1fr_32px] gap-2 items-center">
                  <select
                    value={mapping.extractionFieldKey}
                    onChange={(e) => {
                      const updated = [...leadFieldMappings];
                      updated[idx] = { ...updated[idx], extractionFieldKey: e.target.value };
                      setLeadFieldMappings(updated);
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select extraction field...</option>
                    {fields
                      .filter((f) => f.key.trim())
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label || f.key}
                        </option>
                      ))}
                  </select>
                  <span className="text-center text-gray-400 text-sm">→</span>
                  <select
                    value={mapping.leadFieldKey}
                    onChange={(e) => {
                      const updated = [...leadFieldMappings];
                      updated[idx] = { ...updated[idx], leadFieldKey: e.target.value };
                      setLeadFieldMappings(updated);
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select lead field...</option>
                    {availableLeadFields.length === 0 && (
                      <option disabled>No lead fields configured</option>
                    )}
                    {mapping.leadFieldKey && !availableLeadFields.some((lf) => lf.fieldKey === mapping.leadFieldKey) && (
                      <option value={mapping.leadFieldKey}>{mapping.leadFieldKey} (not found)</option>
                    )}
                    {availableLeadFields.map((lf) => (
                      <option key={lf.fieldKey} value={lf.fieldKey}>
                        {lf.fieldLabel || lf.fieldKey}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setLeadFieldMappings(leadFieldMappings.filter((_, i) => i !== idx))}
                    className="h-8 w-8 text-red-400 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {leadFieldMappings.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-sm">
              No mappings configured. Extracted data won't auto-fill lead fields.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Duplicate Detection</CardTitle>
          <p className="text-sm text-gray-500">
            Optionally check for duplicate documents based on a specific field value.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={duplicateCheck} onCheckedChange={setDuplicateCheck} />
            <Label>Enable duplicate check</Label>
          </div>
          {duplicateCheck && (
            <div className="space-y-1.5">
              <Label className="text-sm text-gray-500">Field key to check for duplicates</Label>
              <select
                value={duplicateField}
                onChange={(e) => setDuplicateField(e.target.value)}
                className="max-w-sm w-full border rounded-md p-2 text-sm"
              >
                <option value="">Select a field…</option>
                {keyedFields.length === 0 ? (
                  <option value="" disabled>No extraction fields configured yet</option>
                ) : (
                  keyedFields.map(f => (
                    <option key={f.key} value={f.key}>
                      {f.label || f.key} ({f.key})
                    </option>
                  ))
                )}
              </select>
              <p className="text-xs text-gray-400">
                Select the extraction field whose value will be checked for duplicates.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-600" />
            AI Scan Model
          </CardTitle>
          <p className="text-sm text-gray-500">
            Choose which OpenAI vision model is used as the primary scanner for this document type.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setScanModel("gpt-4o-mini")}
              data-testid="scan-model-mini"
              className={`text-left rounded-lg border-2 p-4 transition-all ${
                scanModel === "gpt-4o-mini"
                  ? "border-purple-500 bg-purple-50 ring-2 ring-purple-100"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <span className="font-semibold text-sm">GPT-4o Mini</span>
                </div>
                {scanModel === "gpt-4o-mini" && (
                  <span className="text-xs font-medium text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
                    Selected
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Faster &amp; cheaper. Auto-escalates to GPT-4o on low confidence.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setScanModel("gpt-4o")}
              data-testid="scan-model-full"
              className={`text-left rounded-lg border-2 p-4 transition-all ${
                scanModel === "gpt-4o"
                  ? "border-purple-500 bg-purple-50 ring-2 ring-purple-100"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  <span className="font-semibold text-sm">GPT-4o</span>
                </div>
                {scanModel === "gpt-4o" && (
                  <span className="text-xs font-medium text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
                    Selected
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                More accurate. Used directly — no escalation needed.
              </p>
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Extraction Confirmation</CardTitle>
          <p className="text-sm text-gray-500">
            Override the global confirmation setting for this document type
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            className="w-full border rounded-md p-2 text-sm"
            value={confirmationRequired ?? "inherit"}
            onChange={(e) => {
              const val = e.target.value;
              setConfirmationRequired(val === "inherit" ? null : val);
            }}
          >
            <option value="inherit">Inherit Global Setting</option>
            <option value="always">Always Require Confirmation</option>
            <option value="never">Never Require Confirmation</option>
          </select>
          <p className="text-xs text-gray-400">
            When set to "Inherit", the global confirmation setting from Flow Settings applies.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-2 pb-8">
        <Button variant="outline" onClick={onNavigateBack}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSaving || !canSubmit}
          className="min-w-[140px]"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {isNew ? "Create Document Type" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
