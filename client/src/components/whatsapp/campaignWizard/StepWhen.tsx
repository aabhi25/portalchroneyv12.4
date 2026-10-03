import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Moon, Clock, BellRing } from "lucide-react";
import type { WizardCtx } from "./context";
import { StepSection } from "./StepSection";
import { ParamMapper } from "./ParamMapper";
import { TemplatePicker } from "./StepMessage";
import { COMMON_TIMEZONES } from "./types";

export const DEFAULT_QUIET = { start: "21:00", end: "09:00" };

export function StepWhen({ ctx }: { ctx: WizardCtx }) {
  const { v, set, scheduleMode, setScheduleMode, approvedTemplates, templates, fields, sample } = ctx;
  const quietOn = Boolean(v.quietHoursStart || v.quietHoursEnd);
  const followUp = v.followUps[0];
  const followUpTpl = followUp ? templates.find(t => t.id === followUp.templateId) : undefined;
  const tz = v.quietHoursTimezone || "Asia/Kolkata";
  const zones = COMMON_TIMEZONES.includes(tz) ? COMMON_TIMEZONES : [tz, ...COMMON_TIMEZONES];
  const setFollowUp = (patch: Partial<NonNullable<typeof followUp>>) =>
    set({ followUps: [{ ...(followUp ?? { delayHours: 24, templateId: "", templateParams: [] }), ...patch }] });

  return (
    <div className="space-y-4">
      <StepSection title="When should it go out?">
        <RadioGroup
          value={scheduleMode ? "later" : "now"}
          onValueChange={val => { setScheduleMode(val === "later"); if (val === "now") set({ scheduledAt: "" }); }}
          className="gap-2"
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-gray-50">
            <RadioGroupItem value="now" className="mt-0.5" data-testid="radio-send-now" />
            <span>
              <span className="block text-sm font-medium text-gray-800">Send right away</span>
              <span className="block text-xs text-gray-500">You'll see how many people get it and confirm on the last step.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-gray-50">
            <RadioGroupItem value="later" className="mt-0.5" data-testid="radio-send-later" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-800">Schedule for later</span>
              <span className="block text-xs text-gray-500">It starts by itself at the time you pick.</span>
              {scheduleMode && (
                <Input
                  className="mt-2 w-full sm:w-64"
                  type="datetime-local"
                  value={v.scheduledAt}
                  min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  onChange={e => set({ scheduledAt: e.target.value })}
                  data-testid="input-schedule"
                />
              )}
            </span>
          </label>
        </RadioGroup>
      </StepSection>

      <StepSection
        title="Quiet hours"
        description="Don't message people at night. If sending reaches the quiet time, it pauses and carries on by itself when quiet hours end."
        action={
          <Switch
            checked={quietOn}
            onCheckedChange={on => set(on
              ? { quietHoursStart: DEFAULT_QUIET.start, quietHoursEnd: DEFAULT_QUIET.end }
              : { quietHoursStart: "", quietHoursEnd: "", quietHoursTimezone: "" })}
            data-testid="switch-quiet-hours"
          />
        }
      >
        {quietOn && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-gray-600"><Moon className="mr-1 inline h-3 w-3" />Don't send from</label>
              <Input type="time" className="mt-1" value={v.quietHoursStart} onChange={e => set({ quietHoursStart: e.target.value })} data-testid="input-quiet-start" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600"><Clock className="mr-1 inline h-3 w-3" />Until</label>
              <Input type="time" className="mt-1" value={v.quietHoursEnd} onChange={e => set({ quietHoursEnd: e.target.value })} data-testid="input-quiet-end" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Time zone</label>
              <Select value={tz} onValueChange={val => set({ quietHoursTimezone: val === "Asia/Kolkata" ? "" : val })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{zones.map(z => <SelectItem key={z} value={z}>{z.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {v.quietHoursStart && v.quietHoursStart === v.quietHoursEnd && (
              <p className="text-sm text-amber-700 sm:col-span-3">Start and end can't be the same time.</p>
            )}
          </div>
        )}
      </StepSection>

      <StepSection
        title="Reminder if they don't reply"
        description="Send one more template to people who haven't replied after a while. It stops for anyone who replies or opts out, and follows your quiet hours."
        action={
          <Switch
            checked={Boolean(followUp)}
            onCheckedChange={on => set({ followUps: on ? [{ delayHours: 24, templateId: "", templateParams: [] }] : [] })}
            data-testid="switch-follow-up"
          />
        }
      >
        {followUp && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <BellRing className="h-4 w-4 text-gray-400" />
              <span>If there's no reply within</span>
              <Input
                type="number"
                min={1}
                max={720}
                className="w-20"
                value={Number.isFinite(followUp.delayHours) ? followUp.delayHours : ""}
                onChange={e => setFollowUp({ delayHours: e.target.value === "" ? NaN : Math.round(Number(e.target.value)) })}
                data-testid="input-follow-up-hours"
              />
              <span>hours, send:</span>
            </div>
            <TemplatePicker
              templates={approvedTemplates}
              value={followUp.templateId}
              onChange={id => setFollowUp({ templateId: id, templateParams: [] })}
              placeholder="Choose the reminder template"
              testId="select-follow-up-template"
            />
            {followUpTpl && (
              <ParamMapper
                count={followUpTpl.paramCount || 0}
                values={followUp.templateParams}
                onChange={next => setFollowUp({ templateParams: next })}
                fields={fields}
                sample={sample}
                testIdPrefix="param-follow-up"
              />
            )}
          </div>
        )}
      </StepSection>
    </div>
  );
}
