import { Route } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { LeadKeywordInput } from "@/components/LeadKeywordInput";
import {
  CUSTOM_ASK_AFTER_MAX,
  CUSTOM_ASK_AFTER_MIN,
  DEFAULT_CUSTOM_ASK_AFTER,
  INTENT_CALLBACK_NOTE,
  INTENT_SENSITIVITY_OPTIONS,
  cleanKeywords,
  type IntentIntensity,
  type LeadCaptureStrategy,
  type LeadFieldConfig,
} from "@shared/leadTrainingConfig";

/**
 * "When to collect" for one lead field — shared by Train Chroney (account) and
 * the group training editor so both offer exactly the same timings and inputs:
 * At Start / Custom (ask after reply #) / Intent (sensitivity) / Keyword (list).
 */
export function LeadTimingSettings({
  field,
  onStrategyChange,
  onAskAfterChange,
  onIntensityChange,
  onKeywordsChange,
}: {
  field: Pick<LeadFieldConfig, "id" | "captureStrategy" | "customAskAfter" | "intentIntensity" | "captureKeywords">;
  onStrategyChange: (strategy: LeadCaptureStrategy) => void;
  onAskAfterChange: (n: number) => void;
  onIntensityChange: (level: IntentIntensity) => void;
  onKeywordsChange: (keywords: string[]) => void;
}) {
  const intensity = field.intentIntensity || "medium";
  const intensityOption = INTENT_SENSITIVITY_OPTIONS.find((o) => o.value === intensity) || INTENT_SENSITIVITY_OPTIONS[1];
  const keywordsMissing = field.captureStrategy === "keyword" && cleanKeywords(field.captureKeywords).length === 0;

  return (
    <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50">
      <div className="flex items-center gap-2 mb-2">
        <Route className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">When to collect</span>
      </div>
      <RadioGroup
        value={field.captureStrategy}
        onValueChange={(value) => onStrategyChange(value as LeadCaptureStrategy)}
        className="flex flex-wrap gap-3"
      >
        {([
          ["start", "At Start"],
          ["custom", "Custom"],
          ["intent", "Intent"],
          ["keyword", "Keyword"],
        ] as const).map(([value, label]) => (
          <div key={value} className="flex items-center space-x-1.5">
            <RadioGroupItem value={value} id={`timing-${value}-${field.id}`} className="h-3.5 w-3.5" data-testid={`radio-timing-${value}-${field.id}`} />
            <Label htmlFor={`timing-${value}-${field.id}`} className="text-xs cursor-pointer">{label}</Label>
          </div>
        ))}
      </RadioGroup>

      {field.captureStrategy === "start" && (
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 italic">
          AI will ask immediately at the start of the conversation
        </p>
      )}

      {field.captureStrategy === "custom" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-xs text-blue-600 dark:text-blue-400 italic">AI will ask after response #</p>
          <input
            type="number"
            min={CUSTOM_ASK_AFTER_MIN}
            max={CUSTOM_ASK_AFTER_MAX}
            data-testid={`input-ask-after-${field.id}`}
            value={field.customAskAfter ?? DEFAULT_CUSTOM_ASK_AFTER}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onAskAfterChange(Number.isFinite(n) ? Math.max(CUSTOM_ASK_AFTER_MIN, Math.min(CUSTOM_ASK_AFTER_MAX, n)) : DEFAULT_CUSTOM_ASK_AFTER);
            }}
            className="w-14 h-6 text-xs text-center border rounded bg-background px-1"
          />
          <span className="text-[11px] text-muted-foreground">({CUSTOM_ASK_AFTER_MIN}–{CUSTOM_ASK_AFTER_MAX})</span>
        </div>
      )}

      {field.captureStrategy === "intent" && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-blue-600 dark:text-blue-400 italic">Sensitivity:</p>
            <select
              value={intensity}
              data-testid={`select-intent-${field.id}`}
              onChange={(e) => onIntensityChange(e.target.value as IntentIntensity)}
              className="h-6 text-xs border rounded bg-background px-1 max-w-full"
            >
              {INTENT_SENSITIVITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground italic">{intensityOption.description}</p>
          <p className="text-[11px] text-muted-foreground">{INTENT_CALLBACK_NOTE}</p>
        </div>
      )}

      {field.captureStrategy === "keyword" && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-blue-600 dark:text-blue-400 italic">Keywords (press Enter or type a comma after each):</p>
          <LeadKeywordInput
            fieldId={field.id}
            keywords={field.captureKeywords}
            onChange={onKeywordsChange}
            invalid={keywordsMissing}
          />
          <p className="text-xs text-muted-foreground italic">
            AI will ask for this when the visitor's message contains any of these keywords
          </p>
        </div>
      )}
    </div>
  );
}

/** Inline list of lead-config warnings (block = red, warn = amber, info = blue). */
export function LeadWarningList({
  warnings,
  className = "",
}: {
  warnings: Array<{ level: "block" | "warn" | "info"; message: string; code?: string }>;
  className?: string;
}) {
  if (warnings.length === 0) return null;
  const tone = {
    block: "border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200",
    warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200",
    info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200",
  } as const;
  return (
    <div className={`space-y-1.5 ${className}`}>
      {warnings.map((w, i) => (
        <p
          key={`${w.code || "w"}-${i}`}
          data-testid={`lead-warning-${w.code || i}`}
          className={`text-[11px] leading-snug rounded-md border px-2.5 py-1.5 ${tone[w.level]}`}
        >
          {w.message}
        </p>
      ))}
    </div>
  );
}
