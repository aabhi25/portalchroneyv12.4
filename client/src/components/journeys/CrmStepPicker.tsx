import { Send } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NOW = "__now__";
const shorten = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * "Send the lead to your CRM": as soon as it's ready (default), or only after one question of the
 * journey. Used by the website journey builder and the WhatsApp journey steps.
 */
export function CrmStepPicker({ steps, value, onChange, busy, defaultLabel }: {
  /** The journey's questions in order. */
  steps: { id: string; text: string }[];
  /** The chosen step, or null for the default. */
  value: string | null;
  onChange: (stepId: string | null) => void;
  busy?: boolean;
  /** What happens without a step (website and WhatsApp differ). */
  defaultLabel: string;
}) {
  const known = value && steps.some(s => s.id === value) ? value : null;
  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white p-4" data-testid="crm-step-picker">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Send className="h-4 w-4" /></span>
          <div>
            <p className="text-sm font-medium text-gray-900">Send the lead to your CRM</p>
            <p className="text-xs text-gray-500">
              {known
                ? "Only once they answer this question or finish the journey. People who stop earlier stay in Leads as “Waiting for journey step”, with a Sync now button."
                : "Pick a question to keep people who leave early (often junk numbers) out of your CRM."}
            </p>
          </div>
        </div>
        <Select value={known ?? NOW} onValueChange={(v) => onChange(v === NOW ? null : v)} disabled={busy}>
          <SelectTrigger className="w-full sm:ml-11 sm:w-[calc(100%-2.75rem)]" data-testid="select-crm-step"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NOW}>{defaultLabel}</SelectItem>
            {steps.map((s, i) => (
              <SelectItem key={s.id} value={s.id}>After Q{i + 1}: {shorten(s.text || "(no words yet)")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
