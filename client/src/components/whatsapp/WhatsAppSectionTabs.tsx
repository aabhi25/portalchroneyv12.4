import { useLocation } from "wouter";
import { getWhatsappSections } from "./sections";

/**
 * The secondary tab strip shown on inner WhatsApp screens.
 *
 * Shows the screens in whichever section you are currently in, so this strip and the sidebar
 * always agree. It previously hard-coded four screens — in two separate files that had already
 * fallen out of step with each other and with the sidebar, still advertising names that had been
 * changed elsewhere.
 *
 * Renders nothing when the current route is not inside a section, rather than guessing.
 */
export function WhatsAppSectionTabs({ marketingEnabled = true }: { marketingEnabled?: boolean }) {
  const [location, setLocation] = useLocation();

  const sections = getWhatsappSections({ marketingEnabled });
  const current = sections.find(s => s.items.some(i => i.matches(location)));
  if (!current) return null;

  return (
    <nav className="bg-white border-b px-4 relative z-10" aria-label={`${current.label} screens`}>
      <div className="flex items-center gap-1 overflow-x-auto">
        <span className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold pr-2 shrink-0">
          {current.label}
        </span>
        {current.items.map(item => {
          const Icon = item.icon;
          const isActive = item.matches(location);
          return (
            <button
              key={item.key}
              onClick={() => setLocation(item.href)}
              data-testid={`tab-${item.key}`}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? "border-emerald-500 text-emerald-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
