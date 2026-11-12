import type { LucideIcon } from "lucide-react";
import { Check, FilePlus2, Gem, GraduationCap, House, Scissors, ShoppingBag, Smile, Stethoscope } from "lucide-react";
import { BUSINESS_STARTERS, describeBusinessStarter, getBusinessStarter, type BusinessStarterKey } from "@shared/businessStarters";

const ICONS: Record<BusinessStarterKey, { icon: LucideIcon; tint: string }> = {
  blank: { icon: FilePlus2, tint: "text-gray-500" },
  clinic: { icon: Stethoscope, tint: "text-sky-600" },
  dentist: { icon: Smile, tint: "text-cyan-600" },
  salon: { icon: Scissors, tint: "text-pink-600" },
  education: { icon: GraduationCap, tint: "text-indigo-600" },
  real_estate: { icon: House, tint: "text-emerald-600" },
  online_store: { icon: ShoppingBag, tint: "text-orange-600" },
  jewellery: { icon: Gem, tint: "text-amber-600" },
};

/** "What kind of business?" in the New account box: one tile per starter pack, and what the chosen one sets up. */
export function BusinessStarterPicker({ value, onChange }: { value: BusinessStarterKey; onChange: (key: BusinessStarterKey) => void }) {
  const chosen = getBusinessStarter(value);
  return (
    <div>
      <div className="text-sm font-medium text-gray-900">What kind of business?</div>
      <p className="mt-0.5 text-xs text-gray-500">Sets up a starting point you can change later in Features and Training.</p>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="What kind of business?">
        {BUSINESS_STARTERS.map(s => {
          const { icon: Icon, tint } = ICONS[s.key];
          const on = s.key === value;
          return (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(s.key)}
              data-testid={`starter-${s.key}`}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${on ? "border-violet-500 bg-violet-50 ring-1 ring-violet-500" : "border-black/[0.08] bg-white hover:bg-gray-50"}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${tint}`} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-gray-900">{s.label}</span>
                <span className="block truncate text-[11.5px] text-gray-500">{s.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      {chosen && (
        <ul className="mt-2.5 space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600" data-testid="text-starter-preview">
          {describeBusinessStarter(chosen).map(line => (
            <li key={line} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-green-600" />{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
