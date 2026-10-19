import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { QuickBrowseButtons } from "@/components/QuickBrowseButtons";
import { MANY_CHOICES, matchChoices } from "@/lib/formAnswer";

const SHOWN_WHEN_LONG = 6;

/**
 * The options of a form question asked in the chat. Short lists are all buttons. Long lists
 * (more than MANY_CHOICES) show a few buttons plus "See all"; the visitor can also type in the
 * answer box below (`filter`) and the buttons switch to the matching options.
 */
export function ChatFormChoices({ options, filter, onPick, chatColor, chatColorEnd }: {
  options: string[];
  filter: string;
  onPick: (option: string) => void;
  chatColor: string;
  chatColorEnd?: string;
}) {
  const [listOpen, setListOpen] = useState(false);
  const long = options.length > MANY_CHOICES;
  const matches = long ? matchChoices(options, filter) : options;
  const searching = long && !!filter.trim();
  const shown = long ? matches.slice(0, searching ? MANY_CHOICES : SHOWN_WHEN_LONG) : options;
  const more = matches.length - shown.length;

  return (
    <div data-testid="form-choices">
      {shown.length > 0 && (
        <QuickBrowseButtons
          buttons={shown.map(o => ({ label: o, action: o }))}
          onSelect={onPick}
          chatColor={chatColor}
          chatColorEnd={chatColorEnd}
        />
      )}
      {searching && matches.length === 0 && (
        <p className="px-1 pb-2 text-sm text-gray-500">No option matches “{filter.trim()}”.</p>
      )}
      {long && (more > 0 || matches.length === 0) && (
        <button
          type="button"
          onClick={() => setListOpen(true)}
          className="-mt-1 mb-2 px-1 text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ color: chatColor }}
          data-testid="button-form-choices-all"
        >
          {searching && matches.length > 0 ? `${more} more ${more === 1 ? "match" : "matches"}` : `See all ${options.length} options`}
        </button>
      )}
      {listOpen && (
        <ChoiceList
          options={options}
          initialQuery={filter}
          onPick={(o) => { setListOpen(false); onPick(o); }}
          onClose={() => setListOpen(false)}
        />
      )}
    </div>
  );
}

/** Every option in a scrollable list with its own search, over the chat. */
function ChoiceList({ options, initialQuery, onPick, onClose }: {
  options: string[];
  initialQuery: string;
  onPick: (option: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = matchChoices(options, query);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // Above the widget's answer box, which sits on a very high layer.
    <div className="fixed inset-0 flex items-end justify-center p-3 sm:items-center" style={{ zIndex: 100000 }} onClick={onClose} data-testid="form-choices-list">
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative z-10 flex max-h-[80%] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose an option"
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) onPick(matches[0]); }}
            placeholder={`Search ${options.length} options`}
            className="min-w-0 flex-1 bg-transparent py-1 text-[15px] focus:outline-none"
            data-testid="input-form-choices-search"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="overflow-y-auto py-1">
          {matches.map(o => (
            <li key={o}>
              <button
                type="button"
                onClick={() => onPick(o)}
                className="w-full px-4 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50"
              >
                {o}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-500">No option matches “{query.trim()}”.</li>}
        </ul>
      </div>
    </div>
  );
}
