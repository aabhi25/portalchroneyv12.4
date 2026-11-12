import type { LucideIcon } from "lucide-react";
import { Check, FilePlus2, Gem, GraduationCap, House, Scissors, ShoppingBag, Smile, Stethoscope } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

/** The short preview under the dropdown: features, hours and what it asks for (the full list shows once created). */
const PREVIEW_LINES = ["Switches on", "Opening hours", "Asks for"];

/** "What kind of business?" in the New account box: a dropdown of starter packs (Blank by default) and what the chosen one sets up. */
export function BusinessStarterPicker({ value, onChange }: { value: BusinessStarterKey; onChange: (key: BusinessStarterKey) => void }) {
  const chosen = getBusinessStarter(value);
  const preview = chosen && chosen.key !== "blank"
    ? describeBusinessStarter(chosen).filter(line => PREVIEW_LINES.some(p => line.startsWith(p)))
    : [];
  return (
    <div>
      <label htmlFor="business-starter" className="text-sm font-medium text-gray-900">What kind of business?</label>
      <Select value={value} onValueChange={(v) => onChange(v as BusinessStarterKey)}>
        <SelectTrigger id="business-starter" className="mt-1.5" data-testid="select-business-starter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BUSINESS_STARTERS.map(s => {
            const { icon: Icon, tint } = ICONS[s.key];
            return (
              <SelectItem key={s.key} value={s.key} data-testid={`starter-${s.key}`}>
                <span className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 shrink-0 ${tint}`} />
                  <span>{s.label}</span>
                  <span className="text-gray-400">· {s.description}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {preview.length > 0 ? (
        <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600" data-testid="text-starter-preview">
          {preview.map(line => (
            <li key={line} className="flex gap-1.5"><Check className="mt-0.5 h-3 w-3 shrink-0 text-green-600" />{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-xs text-gray-500">Pick a type to switch on the right features and fill in a starting setup. You can change it all later.</p>
      )}
    </div>
  );
}
