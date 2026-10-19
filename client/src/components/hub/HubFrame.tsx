import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, Settings } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAiCallingAvailability } from "@/lib/aiCallingApi";
import {
  findHubLocation, getHubAccess, hubSettingsPath, visibleTabs, type HubAccess,
} from "@/navigation/hubAreas";
import type { MeResponseDto } from "@shared/dto";
import { HubFrameContext } from "./hubContext";

/** Business view (a business user, or a super admin viewing an account) with the standard layout. */
export function usesHubLayout(user: MeResponseDto | null | undefined): boolean {
  const role = user?.role;
  const isSuperAdminViewing = role === "super_admin" && !!user?.activeBusinessAccountId;
  const isBusinessView = (role !== "super_admin" && role !== "account_group_admin") || isSuperAdminViewing;
  // K12 tutors and job portals keep their own menus.
  const special = user?.businessAccount?.k12EducationEnabled === true || user?.businessAccount?.jobPortalEnabled === true;
  return isBusinessView && !special;
}

export function useHubAccess(user: MeResponseDto | null | undefined): HubAccess {
  const { enabled } = useAiCallingAvailability(usesHubLayout(user) ? user : null);
  return getHubAccess(user, enabled);
}

/**
 * A row that scrolls sideways (the tab bars on phones). Fades the edge where more tabs are
 * hidden, so it's clear the row scrolls, and keeps the selected tab in view.
 */
function ScrollRow({ className, fadeFrom, selectedKey, children, ...rest }: {
  className: string; fadeFrom: string; selectedKey?: string; children: ReactNode;
  role?: string; "aria-label"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelector<HTMLElement>('[aria-selected="true"],[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedKey]);
  return (
    <div className="relative">
      <div ref={ref} onScroll={update} className={className} {...rest}>{children}</div>
      {edges.left && <div className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r ${fadeFrom} to-transparent`} />}
      {edges.right && <div className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l ${fadeFrom} to-transparent`} />}
    </div>
  );
}

/**
 * Wraps every routed page. When the page belongs to an area (an AI agent, Leads, Training, …),
 * the area's name and tabs sit above it, so every agent looks and works the same way:
 * its screens on the left of the tab bar, its Settings on the right.
 */
export function HubFrame({ user, children }: { user: MeResponseDto | null; children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const access = useHubAccess(user);
  const match = usesHubLayout(user) ? findHubLocation(location, access) : null;
  if (!match) return <>{children}</>;

  const { area, tab, settingsItem } = match;
  const Icon = area.icon;
  const tabs = visibleTabs(area, access);
  const sectionItems = area.sections && tab?.key === area.sections.tabKey ? area.sections.items : null;
  // A settings item that opens its own page (e.g. Keyword replies) gets a way back to the list.
  const openedSettingsPage = settingsItem && settingsItem.href ? settingsItem : null;

  return (
    <div className="flex min-h-full flex-col bg-[#f5f5f7]" data-testid={`hub-${area.id}`}>
      <div className="border-b border-black/[0.06] bg-white">
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-5 md:px-8">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="-ml-2 hidden text-gray-400 lg:inline-flex" />
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white ${area.tint}`}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] leading-none text-gray-500">{area.kind}</p>
              <h1 className="mt-1 truncate text-[22px] font-semibold leading-tight tracking-tight text-gray-900 md:text-[26px]">{area.label}</h1>
            </div>
          </div>
          {tabs.length > 1 && (
            <div className="-mb-px mt-4">
            <ScrollRow role="tablist" aria-label={area.label} selectedKey={tab?.key} fadeFrom="from-white" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
              {tabs.map(t => {
                const active = t.key === tab?.key;
                const isSettings = t.key === "settings";
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setLocation(t.href)}
                    data-testid={`hub-tab-${area.id}-${t.key}`}
                    className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-3 pt-1.5 text-[14px] transition-colors ${
                      isSettings ? "ml-auto" : ""
                    } ${active ? "border-gray-900 font-semibold text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900"}`}
                  >
                    {isSettings && <Settings className="h-4 w-4" />}
                    {t.label}
                  </button>
                );
              })}
            </ScrollRow>
            </div>
          )}
        </div>
      </div>

      {sectionItems && (
        <div className="border-b border-black/[0.06] bg-white/70">
          <ScrollRow className="mx-auto flex w-full max-w-[1400px] gap-1.5 overflow-x-auto px-4 py-2.5 md:px-8 [scrollbar-width:none]" fadeFrom="from-white" selectedKey={location} role="group" aria-label={`${tab?.label} sections`}>
            {sectionItems.map(s => {
              const active = s.matches(location);
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setLocation(s.href)}
                  data-testid={`hub-section-${s.key}`}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                    active ? "bg-gray-900 font-semibold text-white" : "bg-black/[0.05] text-gray-600 hover:bg-black/[0.08]"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </ScrollRow>
        </div>
      )}

      {openedSettingsPage && (
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-4 md:px-8">
          <button
            type="button"
            onClick={() => setLocation(hubSettingsPath(area.id))}
            className="inline-flex items-center gap-0.5 text-[14px] text-purple-700 hover:text-purple-900"
            data-testid="hub-back-to-settings"
          >
            <ChevronLeft className="h-4 w-4" />
            {area.label} settings
          </button>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <HubFrameContext.Provider value={true}>{children}</HubFrameContext.Provider>
      </div>
    </div>
  );
}
