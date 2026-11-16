import { GitCompare, ShoppingBag, X } from "lucide-react";

interface TrayProduct {
  id: string;
  name: string;
  imageUrl?: string | null;
}

export const COMPARE_MAX = 3;

/**
 * Bar above the chat's message box while products are picked for comparison: a slot per product
 * (photo, remove), empty slots up to the maximum, and the Compare button (needs at least 2).
 * It sits in the page flow, so it never covers the message box or the last message.
 */
export default function CompareTray({
  products,
  count,
  chatColor,
  chatColorEnd,
  onRemove,
  onClear,
  onCompare,
}: {
  products: TrayProduct[];
  count: number;
  chatColor: string;
  chatColorEnd?: string;
  onRemove: (id: string) => void;
  onClear: () => void;
  onCompare: () => void;
}) {
  const ready = count >= 2;
  return (
    <div
      className="relative flex-shrink-0 border-t border-gray-200 bg-white px-3 py-2"
      data-testid="compare-tray"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: COMPARE_MAX }, (_, i) => {
            const p = products[i];
            return p ? (
              <div key={p.id} className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50" title={p.name}>
                {p.imageUrl
                  ? <img src={p.imageUrl} alt={p.name} className="h-full w-full object-contain p-0.5" />
                  : <ShoppingBag className="m-auto mt-2.5 h-4 w-4 text-gray-300" />}
                <button
                  type="button"
                  onClick={() => onRemove(p.id)}
                  className="absolute -right-0 -top-0 grid h-4 w-4 place-items-center rounded-bl-md bg-gray-900/70 text-white"
                  aria-label={`Remove ${p.name} from compare`}
                  data-testid={`compare-tray-remove-${p.id}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ) : (
              <div key={`empty-${i}`} className="h-10 w-10 shrink-0 rounded-lg border border-dashed border-gray-300" />
            );
          })}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[13px] font-semibold text-gray-900">
            {count} of {COMPARE_MAX} picked
          </p>
          <button type="button" onClick={onClear} className="text-[11px] text-gray-500 underline-offset-2 hover:underline" data-testid="compare-tray-clear">
            Clear
          </button>
        </div>
        <button
          type="button"
          onClick={onCompare}
          disabled={!ready}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-white shadow-sm transition-opacity disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${chatColor}, ${chatColorEnd || chatColor})` }}
          data-testid="compare-tray-open"
        >
          <GitCompare className="h-4 w-4" />
          {ready ? "Compare" : "Pick 1 more"}
        </button>
      </div>
    </div>
  );
}
