import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  getWhatsappSections,
  rememberWhatsappSectionLocation,
  type WhatsappReadiness,
} from "./sections";
import type { MeResponseDto } from "@shared/dto";

/**
 * The persistent second-level panel for WhatsApp sections (marketing-enabled accounts only).
 *
 * Wraps the routed page content. When the current location belongs to a WhatsApp section
 * (Lead Gen / Campaigns / Setup), a slim vertical panel is shown to the left of the page
 * listing every screen in that section, with the current one highlighted — so switching
 * between a section's screens is always one click, like a folder column in a file manager.
 * On any other location (or for non-marketing accounts) it renders children untouched.
 */
export function WhatsAppSectionPanel({
  user,
  children,
}: {
  user: MeResponseDto | null;
  children: React.ReactNode;
}) {
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const whatsappEnabled = user?.businessAccount?.whatsappEnabled === true;
  const marketingEnabled =
    whatsappEnabled && user?.businessAccount?.whatsappMarketingEnabled === true;

  // Show the panel for every WhatsApp-enabled account, not just marketing ones.
  // marketingEnabled is still passed through so Campaigns only appears when purchased.
  const sections = whatsappEnabled ? getWhatsappSections({ marketingEnabled }) : [];
  const activeSection = sections.find(s => s.items.some(i => i.matches(location)));

  const { data: readiness } = useQuery<WhatsappReadiness>({
    queryKey: ["/api/whatsapp/readiness"],
    enabled: !!activeSection,
  });

  // Remember where the user is inside the section, so the sidebar row returns here next time.
  useEffect(() => {
    if (activeSection) rememberWhatsappSectionLocation(location, sections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, activeSection?.id]);

  if (!activeSection) return <>{children}</>;

  const items = activeSection.items;

  return (
    <div className="flex min-h-full items-stretch">
      {/* Desktop panel */}
      <aside
        className={`hidden md:flex flex-col shrink-0 border-r bg-white sticky top-0 max-h-[100dvh] overflow-y-auto transition-all duration-200 ${
          collapsed ? "w-10" : "w-52"
        }`}
        data-testid={`wa-section-panel-${activeSection.id}`}
      >
        <div className={`flex items-center border-b h-11 shrink-0 ${collapsed ? "justify-center" : "justify-between pl-3 pr-1.5"}`}>
          {!collapsed && (
            <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">
              {activeSection.label}
            </span>
          )}
          <button
            type="button"
            aria-label={collapsed ? "Expand section panel" : "Collapse section panel"}
            data-testid="wa-section-panel-toggle"
            onClick={() => setCollapsed(c => !c)}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {!collapsed && (
          <nav className="p-2 space-y-0.5">
            {items.map(item => {
              const Icon = item.icon;
              const isActive = item.matches(location);
              const blockedReason = readiness ? item.blocked?.(readiness) : undefined;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setLocation(item.href)}
                  data-testid={`wa-panel-${item.key}`}
                  className={`w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    isActive
                      ? "bg-purple-50 text-purple-800 font-medium"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isActive ? "text-purple-600" : "text-gray-400"}`} />
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-tight">{item.label}</span>
                    {blockedReason && (
                      <Badge
                        variant="outline"
                        className="mt-1 border-amber-300 text-amber-800 bg-amber-50 text-[10px] font-normal whitespace-normal"
                      >
                        {blockedReason}
                      </Badge>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
        )}
      </aside>

      {/* Content, with a horizontal picker on mobile where a side panel would not fit */}
      <div className="flex-1 min-w-0">
        <div className="md:hidden border-b bg-white px-2 py-1.5 flex gap-1 overflow-x-auto" data-testid="wa-section-pills">
          {items.map(item => {
            const isActive = item.matches(location);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setLocation(item.href)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs transition-colors ${
                  isActive ? "bg-purple-100 text-purple-800 font-medium" : "bg-gray-100 text-gray-600"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {children}
      </div>
    </div>
  );
}
