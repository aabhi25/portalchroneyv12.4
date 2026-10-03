import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Smartphone, Pencil } from "lucide-react";
import type { WizardCtx } from "./context";
import { StepSection } from "./StepSection";
import { AudienceCounts } from "./StepWho";
import { WhatsAppMessagePreview } from "./WhatsAppMessagePreview";
import { TestSendDialog, type TestSendTarget } from "./TestSendDialog";
import { fillFromSample } from "./types";

export type WizardStepKey = "who" | "message" | "when" | "ai" | "review";

function Row({ label, children, onEdit }: { label: string; children: React.ReactNode; onEdit?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <div className="mt-0.5 break-words text-sm text-gray-900">{children}</div>
      </div>
      {onEdit && (
        <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-gray-500" onClick={onEdit} aria-label={`Change ${label}`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export function StepReview({ ctx, goTo }: { ctx: WizardCtx; goTo: (step: WizardStepKey) => void }) {
  const { v, isAutomation, templates, groups, sample, workbookName } = ctx;
  const [testTarget, setTestTarget] = useState<TestSendTarget | null>(null);
  const tplA = templates.find(t => t.id === v.templateId);
  const tplB = templates.find(t => t.id === v.variantBTemplateId);
  const abOn = Boolean(tplB);
  const followUp = v.followUps[0];
  const followUpTpl = followUp ? templates.find(t => t.id === followUp.templateId) : undefined;
  const groupNames = v.groupIds.map(id => groups.find(g => g.id === id)?.name || "Audience").join(", ");
  const quietOn = Boolean(v.quietHoursStart && v.quietHoursEnd);

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {!isAutomation && (
          <StepSection title="Who gets it">
            <AudienceCounts ctx={ctx} />
          </StepSection>
        )}
        <StepSection title="Summary">
          <div className="divide-y">
            <Row label="Name">{v.name || "—"}</Row>
            <Row label={isAutomation ? "Contacts from" : "Audiences"} onEdit={() => goTo("who")}>
              {isAutomation
                ? (v.recipientSourceType === "contact_groups" ? groupNames || "—" : workbookName || "AI Workbook")
                : groupNames || "—"}
            </Row>
            <Row label="Message" onEdit={() => goTo("message")}>
              {abOn
                ? <>A: {tplA?.name || "—"} · B: {tplB?.name} <span className="text-gray-500">({100 - v.variantSplitPercent}% / {v.variantSplitPercent}%)</span></>
                : tplA?.name || "—"}
            </Row>
            {!isAutomation && (
              <>
                <Row label="When" onEdit={() => goTo("when")}>
                  {v.scheduledAt ? new Date(v.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Right away, when you press Send now"}
                </Row>
                <Row label="Quiet hours" onEdit={() => goTo("when")}>
                  {quietOn ? `No messages from ${v.quietHoursStart} to ${v.quietHoursEnd} (${v.quietHoursTimezone || "Asia/Kolkata"})` : "Off — sends at any time"}
                </Row>
                <Row label="Reminder" onEdit={() => goTo("when")}>
                  {followUp ? `${followUpTpl?.name || "—"} after ${followUp.delayHours} hours without a reply` : "Off"}
                </Row>
              </>
            )}
            <Row label="AI replies" onEdit={() => goTo("ai")}>
              {v.aiEnabled ? `On, as "${v.aiAgentName || "Sales Agent"}"` : "Off"}
              {v.replyClassifications.length > 0 && <span className="text-gray-500"> · {v.replyClassifications.length} reply outcome{v.replyClassifications.length === 1 ? "" : "s"}</span>}
            </Row>
          </div>
        </StepSection>
      </div>

      <div className="space-y-3 xl:sticky xl:top-[120px]">
        <p className="text-sm font-medium text-gray-700">What people will see{abOn ? " (message A)" : ""}</p>
        <WhatsAppMessagePreview template={tplA} values={v.templateParams.map(p => fillFromSample(p, sample))} />
        {!isAutomation && (
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={() => setTestTarget({ templateId: v.templateId, templateParams: v.templateParams, groupIds: v.groupIds })}
              disabled={!tplA}
              data-testid="button-open-test-send"
            >
              <Smartphone className="mr-1.5 h-4 w-4" /> Send test to my phone
            </Button>
            {abOn && (
              <Button
                variant="outline"
                onClick={() => setTestTarget({ templateId: v.variantBTemplateId, templateParams: v.variantBTemplateParams, groupIds: v.groupIds })}
              >
                <Smartphone className="mr-1.5 h-4 w-4" /> Send test of message B
              </Button>
            )}
          </div>
        )}
      </div>
      {testTarget && <TestSendDialog open onOpenChange={open => { if (!open) setTestTarget(null); }} target={testTarget} />}
    </div>
  );
}
