import { useState } from "react";
import { X } from "lucide-react";
import { cleanKeywords } from "@shared/leadTrainingConfig";

/**
 * Keyword list for the "Keyword" lead-capture timing. Type a keyword and press
 * Enter or a comma (or leave the box) to add it; pasted "a, b, c" adds all
 * three. Committed keywords show as removable chips, so it is always visible
 * what will actually be saved.
 */
export function LeadKeywordInput({
  fieldId,
  keywords,
  onChange,
  invalid,
}: {
  fieldId: string;
  keywords: string[] | undefined;
  onChange: (next: string[]) => void;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const current = keywords || [];

  const commit = (text: string) => {
    const added = cleanKeywords(text);
    setDraft("");
    if (added.length === 0) return;
    const next = cleanKeywords([...current, ...added]);
    if (next.length !== current.length) onChange(next);
  };

  const remove = (kw: string) => onChange(current.filter((k) => k !== kw));

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        data-testid={`input-keywords-${fieldId}`}
        aria-label="Add keyword"
        placeholder={current.length ? "Add another keyword…" : "e.g. pricing, demo, enroll — press Enter after each"}
        value={draft}
        onChange={(e) => {
          const t = e.target.value;
          if (t.includes(",")) {
            // Commit everything before the last comma; keep what follows as the draft.
            const lastComma = t.lastIndexOf(",");
            commit(t.slice(0, lastComma));
            setDraft(t.slice(lastComma + 1).trimStart());
          } else {
            setDraft(t);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && current.length > 0) {
            remove(current[current.length - 1]);
          }
        }}
        onBlur={() => commit(draft)}
        className={`w-full h-7 text-xs border rounded bg-background px-2 ${invalid ? "border-amber-500" : ""}`}
      />
      {current.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid={`keywords-${fieldId}`}>
          {current.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center gap-1 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 border border-blue-200/70 dark:border-blue-900/50 px-1.5 py-0.5 text-[11px]"
            >
              {kw}
              <button
                type="button"
                onClick={() => remove(kw)}
                className="opacity-60 hover:opacity-100"
                aria-label={`Remove keyword ${kw}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
