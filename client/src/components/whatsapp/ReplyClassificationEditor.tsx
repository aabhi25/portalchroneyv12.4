import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ChevronDown, ChevronRight, Tags } from "lucide-react";
import { CLASSIFICATION_PRESETS, GENERIC_CLASSIFICATIONS } from "@shared/campaignPresets";
import type { ReplyClassification, ClassificationCaptureField } from "@shared/schema";

/**
 * Editor for a campaign's reply-classification config.
 *
 * The operator picks an industry preset as a starting point and then edits it
 * freely — nothing about a preset is privileged once applied, it is just a way
 * to avoid typing ten categories from scratch. An empty list is a valid, normal
 * state: it means "broadcast only", and the engine skips classification (and
 * its token cost) entirely.
 */

const FIELD_TYPES: { value: ClassificationCaptureField["fieldType"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No" },
];

/** Mirror of the server's key normalisation so what the user sees is what gets stored. */
function toKey(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function ReplyClassificationEditor({
  value,
  onChange,
}: {
  value: ReplyClassification[];
  onChange: (next: ReplyClassification[]) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    const next = new Set(expanded);
    next.has(i) ? next.delete(i) : next.add(i);
    setExpanded(next);
  };

  const update = (i: number, patch: Partial<ReplyClassification>) => {
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const remove = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
    setExpanded(new Set());
  };

  const addCategory = () => {
    onChange([...value, { key: "", label: "", description: "", captureFields: [] }]);
    setExpanded(new Set([value.length]));
  };

  const applyPreset = (presetId: string) => {
    if (presetId === "__none__") {
      onChange([]);
      return;
    }
    if (presetId === "__generic__") {
      onChange(GENERIC_CLASSIFICATIONS.map(c => ({ ...c, captureFields: [...(c.captureFields || [])] })));
      return;
    }
    const preset = CLASSIFICATION_PRESETS.find(p => p.id === presetId);
    if (preset) {
      onChange(preset.classifications.map(c => ({ ...c, captureFields: [...(c.captureFields || [])] })));
    }
    setExpanded(new Set());
  };

  // Duplicate keys are rejected by the server; surface them inline rather than
  // letting the user discover it only when saving fails.
  const keyCounts = new Map<string, number>();
  for (const c of value) {
    const k = toKey(c.key);
    if (k) keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
  }

  return (
    <div className="space-y-3" data-testid="reply-classification-editor">
      <div>
        <label className="text-sm font-medium text-gray-700">Start from a template</label>
        <Select onValueChange={applyPreset}>
          <SelectTrigger className="mt-1" data-testid="select-classification-preset">
            <SelectValue placeholder="Choose an industry preset…" />
          </SelectTrigger>
          <SelectContent>
            {CLASSIFICATION_PRESETS.map(p => (
              <SelectItem key={p.id} value={p.id}>
                <div>
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-gray-500">{p.description}</div>
                </div>
              </SelectItem>
            ))}
            <SelectItem value="__generic__">
              <div>
                <div className="font-medium">Generic (Positive / Negative / Question)</div>
                <div className="text-xs text-gray-500">Simple sentiment buckets for any campaign</div>
              </div>
            </SelectItem>
            <SelectItem value="__none__">
              <div>
                <div className="font-medium">None — broadcast only</div>
                <div className="text-xs text-gray-500">Don't classify replies</div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500 mt-1">
          Applying a preset replaces the list below. You can edit, rename or remove anything afterwards.
        </p>
      </div>

      {value.length === 0 ? (
        <div className="text-center py-6 border border-dashed rounded-lg text-sm text-gray-500" data-testid="classifications-empty">
          <Tags className="h-5 w-5 mx-auto mb-2 text-gray-300" />
          No categories yet — replies won't be classified.
          <div className="text-xs mt-1">Pick a preset above or add your own categories.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {value.map((c, i) => {
            const normKey = toKey(c.key);
            const isDupe = normKey ? (keyCounts.get(normKey) || 0) > 1 : false;
            const isOpen = expanded.has(i);
            return (
              <div key={i} className="border rounded-lg overflow-hidden" data-testid={`classification-row-${i}`}>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                  <button
                    type="button"
                    onClick={() => toggle(i)}
                    className="text-gray-500 hover:text-gray-700 shrink-0"
                    data-testid={`button-toggle-classification-${i}`}
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <span className="text-sm font-medium text-gray-800 truncate flex-1">
                    {c.label?.trim() || normKey || <span className="text-gray-400 italic">Untitled category</span>}
                  </span>
                  {normKey && (
                    <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                      {normKey}
                    </Badge>
                  )}
                  {(c.captureFields?.length || 0) > 0 && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {c.captureFields!.length} field{c.captureFields!.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-gray-400 hover:text-red-600 h-7 w-7 p-0 shrink-0"
                    onClick={() => remove(i)}
                    data-testid={`button-remove-classification-${i}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {isOpen && (
                  <div className="p-3 space-y-3 border-t">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-medium text-gray-600">Display name</label>
                        <Input
                          className="mt-1"
                          value={c.label}
                          onChange={e => update(i, { label: e.target.value })}
                          placeholder="Promise to Pay"
                          data-testid={`input-classification-label-${i}`}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600">Key</label>
                        <Input
                          className="mt-1 font-mono text-xs"
                          value={c.key}
                          onChange={e => update(i, { key: e.target.value })}
                          placeholder="PTP"
                          data-testid={`input-classification-key-${i}`}
                        />
                        {isDupe && (
                          <p className="text-xs text-red-600 mt-1">Duplicate key — each must be unique.</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-600">
                        When to use this <span className="text-gray-400 font-normal">(the AI reads this to decide)</span>
                      </label>
                      <Textarea
                        className="mt-1"
                        rows={2}
                        value={c.description}
                        onChange={e => update(i, { description: e.target.value })}
                        placeholder="Customer commits to paying on a specific date."
                        data-testid={`input-classification-description-${i}`}
                      />
                    </div>

                    <Separator />

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-gray-600">
                          Details to capture <span className="text-gray-400 font-normal">(optional)</span>
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            update(i, {
                              captureFields: [
                                ...(c.captureFields || []),
                                { fieldKey: "", fieldLabel: "", fieldType: "text" },
                              ],
                            })
                          }
                          data-testid={`button-add-capture-field-${i}`}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add field
                        </Button>
                      </div>

                      {(c.captureFields || []).length === 0 ? (
                        <p className="text-xs text-gray-400">
                          Nothing extra extracted — only the category is recorded.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {(c.captureFields || []).map((f, fi) => (
                            <div key={fi} className="flex items-center gap-2">
                              <Input
                                className="flex-1 h-8 text-xs"
                                value={f.fieldLabel}
                                onChange={e => {
                                  const next = [...(c.captureFields || [])];
                                  next[fi] = { ...f, fieldLabel: e.target.value };
                                  update(i, { captureFields: next });
                                }}
                                placeholder="Promised Payment Date"
                                data-testid={`input-capture-label-${i}-${fi}`}
                              />
                              <Input
                                className="w-32 h-8 text-xs font-mono"
                                value={f.fieldKey}
                                onChange={e => {
                                  const next = [...(c.captureFields || [])];
                                  next[fi] = { ...f, fieldKey: e.target.value };
                                  update(i, { captureFields: next });
                                }}
                                placeholder="ptp_date"
                                data-testid={`input-capture-key-${i}-${fi}`}
                              />
                              <Select
                                value={f.fieldType}
                                onValueChange={v => {
                                  const next = [...(c.captureFields || [])];
                                  next[fi] = { ...f, fieldType: v as ClassificationCaptureField["fieldType"] };
                                  update(i, { captureFields: next });
                                }}
                              >
                                <SelectTrigger className="w-24 h-8 text-xs" data-testid={`select-capture-type-${i}-${fi}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FIELD_TYPES.map(t => (
                                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-gray-400 hover:text-red-600"
                                onClick={() =>
                                  update(i, { captureFields: (c.captureFields || []).filter((_, x) => x !== fi) })
                                }
                                data-testid={`button-remove-capture-${i}-${fi}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={addCategory}
        data-testid="button-add-classification"
      >
        <Plus className="h-4 w-4 mr-1" /> Add category
      </Button>
    </div>
  );
}
