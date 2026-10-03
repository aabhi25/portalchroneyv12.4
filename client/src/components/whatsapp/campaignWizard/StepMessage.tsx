import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WizardCtx } from "./context";
import { StepSection } from "./StepSection";
import { ParamMapper } from "./ParamMapper";
import { WhatsAppMessagePreview } from "./WhatsAppMessagePreview";
import { AB_PENDING, fillFromSample, type WizardTemplate } from "./types";

export function TemplatePicker({ templates, value, onChange, placeholder = "Choose a template", testId }: {
  templates: WizardTemplate[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger data-testid={testId}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {templates.length === 0 && <div className="p-3 text-sm text-gray-500">No approved templates yet.</div>}
        {templates.map(t => (
          <SelectItem key={t.id} value={t.id}>
            <span className="font-medium">{t.name}</span>
            <span className="ml-2 text-xs text-gray-500">
              {[t.language, t.headerType && t.headerType !== "none" ? t.headerType : null, `${t.paramCount} blank${t.paramCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function StepMessage({ ctx }: { ctx: WizardCtx }) {
  const { v, set, isAutomation, templates, approvedTemplates, fields, sample } = ctx;
  const [previewArm, setPreviewArm] = useState<"A" | "B">("A");
  const tplA = templates.find(t => t.id === v.templateId);
  const tplB = templates.find(t => t.id === v.variantBTemplateId);
  const abOn = !isAutomation && Boolean(v.variantBTemplateId);
  const showB = abOn && previewArm === "B";
  const previewTemplate = showB ? tplB : tplA;
  const previewValues = (showB ? v.variantBTemplateParams : v.templateParams).map(p => fillFromSample(p, sample));

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <StepSection title={abOn ? "Message A" : "Message"} description="WhatsApp only lets businesses start a chat with a template it has approved.">
          <TemplatePicker
            templates={approvedTemplates}
            value={v.templateId}
            onChange={id => set({ templateId: id, templateParams: [] })}
            testId="select-campaign-template"
          />
          {tplA && tplA.status !== "approved" && (
            <p className="text-sm text-amber-700">This template isn't approved, so WhatsApp won't deliver it. Pick an approved one.</p>
          )}
          {tplA && (
            <ParamMapper count={tplA.paramCount || 0} values={v.templateParams} onChange={next => set({ templateParams: next })} fields={fields} sample={sample} />
          )}
        </StepSection>

        {!isAutomation && (
          <StepSection
            title="Test two messages (A/B test)"
            description="Send message A to some people and message B to the rest, then compare which one gets more replies."
            action={
              <Switch
                checked={abOn}
                onCheckedChange={on => { set(on ? { variantBTemplateId: AB_PENDING, variantBTemplateParams: [], variantSplitPercent: v.variantSplitPercent || 50 } : { variantBTemplateId: "", variantBTemplateParams: [] }); setPreviewArm(on ? "B" : "A"); }}
                data-testid="switch-ab-test"
              />
            }
          >
            {abOn && (
              <>
                <TemplatePicker
                  templates={approvedTemplates}
                  value={v.variantBTemplateId === AB_PENDING ? "" : v.variantBTemplateId}
                  onChange={id => set({ variantBTemplateId: id, variantBTemplateParams: [] })}
                  placeholder="Choose template for message B"
                  testId="select-template-b"
                />
                {tplB && (
                  <ParamMapper count={tplB.paramCount || 0} values={v.variantBTemplateParams} onChange={next => set({ variantBTemplateParams: next })} fields={fields} sample={sample} testIdPrefix="param-b" />
                )}
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-700">Message A: {100 - v.variantSplitPercent}%</span>
                    <span className="font-medium text-gray-700">Message B: {v.variantSplitPercent}%</span>
                  </div>
                  <Slider min={10} max={90} step={5} value={[v.variantSplitPercent]} onValueChange={([n]) => set({ variantSplitPercent: n })} />
                  <p className="text-xs text-gray-500">Each person is put in group A or B when sending starts, and stays there.</p>
                </div>
              </>
            )}
          </StepSection>
        )}
      </div>

      <div className="space-y-2 xl:sticky xl:top-[120px]">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Preview</p>
          {abOn && (
            <Tabs value={previewArm} onValueChange={val => setPreviewArm(val as "A" | "B")}>
              <TabsList className="h-8">
                <TabsTrigger value="A" className="px-3 text-xs">A</TabsTrigger>
                <TabsTrigger value="B" className="px-3 text-xs">B</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
        <WhatsAppMessagePreview template={previewTemplate} values={previewValues} />
        <p className="text-xs text-gray-500">
          {sample
            ? <>Shown with the details of <span className="font-medium">{sample.name || sample.phone}</span>, the first person in your audience.</>
            : isAutomation ? "Sample values appear once a source with rows is chosen." : "Pick an audience to see real sample values."}
        </p>
      </div>
    </div>
  );
}
