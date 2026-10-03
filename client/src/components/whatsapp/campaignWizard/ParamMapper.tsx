import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fieldOf, fillFromSample, type SampleContact } from "./types";

const FIXED = "__fixed__";

/**
 * One row per template slot ({{1}}, {{2}} …): fill it from a contact detail
 * (name, phone, or any imported column) or type the same text for everyone.
 */
export function ParamMapper({
  count,
  values,
  onChange,
  fields,
  sample,
  testIdPrefix = "param",
}: {
  count: number;
  values: string[];
  onChange: (next: string[]) => void;
  fields: string[];
  sample: SampleContact | null | undefined;
  testIdPrefix?: string;
}) {
  const [fixedSlots, setFixedSlots] = useState<Set<number>>(() => new Set());
  if (count <= 0) return <p className="text-xs text-gray-500">This template has no blanks to fill in.</p>;
  const options = [
    { key: "name", label: "Contact's name" },
    { key: "phone", label: "Contact's phone number" },
    ...fields.filter(f => !["name", "phone"].includes(f.toLowerCase())).map(f => ({ key: f, label: f })),
  ];
  // Keep a saved mapping selectable even if the current audience doesn't list that column.
  for (const v of values) {
    const f = fieldOf(v);
    if (f && !options.some(o => o.key === f)) options.push({ key: f, label: f });
  }
  const setAt = (i: number, v: string) => {
    const next = Array.from({ length: count }, (_, j) => values[j] ?? "");
    next[i] = v;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => {
        const value = values[i] ?? "";
        const field = fieldOf(value);
        const mode = field ?? (value || fixedSlots.has(i) ? FIXED : "");
        const blank = !value.trim();
        const sampleValue = value ? fillFromSample(value, sample) : "";
        return (
          <div key={i} className="rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-700">Blank {i + 1} <span className="font-mono text-xs text-gray-400">{`{{${i + 1}}}`}</span></span>
              {sampleValue && sampleValue !== value && <span className="truncate text-xs text-emerald-700">e.g. {sampleValue}</span>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={mode || undefined}
                onValueChange={v => {
                  setFixedSlots(prev => {
                    const next = new Set(prev);
                    if (v === FIXED) next.add(i); else next.delete(i);
                    return next;
                  });
                  setAt(i, v === FIXED ? (field ? "" : value) : `{{${v}}}`);
                }}
              >
                <SelectTrigger className="sm:w-56" data-testid={`select-${testIdPrefix}-${i}`}>
                  <SelectValue placeholder="Fill with…" />
                </SelectTrigger>
                <SelectContent>
                  {options.map(o => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                  <SelectItem value={FIXED}>Same text for everyone</SelectItem>
                </SelectContent>
              </Select>
              {mode === FIXED && (
                <Input
                  className={blank ? "border-amber-400 focus-visible:ring-amber-400" : undefined}
                  value={value}
                  onChange={e => setAt(i, e.target.value)}
                  placeholder="e.g. 20% off"
                  data-testid={`input-${testIdPrefix}-${i}`}
                />
              )}
            </div>
            {blank && <p className="mt-1 text-xs text-amber-700">Required — WhatsApp won't deliver the message with an empty blank.</p>}
          </div>
        );
      })}
    </div>
  );
}
