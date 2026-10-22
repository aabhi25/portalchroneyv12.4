import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { HubFrameContext } from "@/components/hub/hubContext";
import { findSaLocation } from "@/navigation/superAdminAreas";
import type { MeResponseDto } from "@shared/dto";

/** A super admin on their own side (not viewing a business account). */
export function isSuperAdminHome(user: MeResponseDto | null | undefined): boolean {
  return user?.role === "super_admin" && !user?.activeBusinessAccountId;
}

export interface SaHeaderTab {
  key: string;
  label: string;
  href: string;
}

/**
 * The white band at the top of every super admin page: icon tile, a small label, the page name,
 * optional actions on the right and an underline tab bar. Same look as the business portal's areas.
 */
export function SaHeader({ icon: Icon, tint, kind, title, subtitle, back, actions, tabs, activeTab }: {
  icon: LucideIcon;
  tint: string;
  kind: string;
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { label: string; href: string };
  actions?: ReactNode;
  tabs?: SaHeaderTab[];
  activeTab?: string;
}) {
  const [, setLocation] = useLocation();
  const tabRow = useRef<HTMLDivElement>(null);
  // Keep the selected tab visible when the row scrolls sideways (narrow screens).
  useEffect(() => {
    tabRow.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);
  return (
    <div className="border-b border-black/[0.06] bg-white">
      <div className="mx-auto w-full max-w-[1400px] px-4 pt-5 md:px-8">
        {back && (
          <button
            type="button"
            onClick={() => setLocation(back.href)}
            className="-ml-1 mb-2 inline-flex items-center gap-0.5 text-[13px] font-medium text-violet-700 hover:text-violet-900"
            data-testid="sa-back"
          >
            <ChevronLeft className="h-4 w-4" />{back.label}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SidebarTrigger className="-ml-2 hidden text-gray-400 lg:inline-flex" />
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white ${tint}`}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] leading-none text-gray-500">{kind}</p>
            <h1 className="mt-1 truncate text-[22px] font-semibold leading-tight tracking-tight text-gray-900 md:text-[26px]" data-testid="sa-title">{title}</h1>
            {subtitle && <div className="mt-0.5 text-[13px] text-gray-500">{subtitle}</div>}
          </div>
          {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
        </div>
        {tabs && tabs.length > 1 ? (
          <div ref={tabRow} className="-mb-px mt-4 flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
            {tabs.map(t => {
              const active = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setLocation(t.href)}
                  data-testid={`sa-tab-${t.key}`}
                  className={`shrink-0 whitespace-nowrap border-b-2 px-3 pb-3 pt-1.5 text-[14px] transition-colors ${
                    active ? "border-gray-900 font-semibold text-gray-900" : "border-transparent text-gray-500 hover:text-gray-900"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="h-5" />
        )}
      </div>
    </div>
  );
}

/** Page body width and padding used under the header. */
export function SaBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1400px] space-y-5 px-4 py-6 md:px-8 ${className}`}>{children}</div>;
}

/**
 * Wraps every super admin route. Area pages get the area header and tabs from superAdminAreas.ts;
 * detail pages (one account, one group) draw their own SaHeader.
 */
export function SuperAdminFrame({ user, children }: { user: MeResponseDto | null; children: ReactNode }) {
  const [location] = useLocation();
  const match = isSuperAdminHome(user) ? findSaLocation(location) : null;
  if (!match) return <>{children}</>;

  const { area, tab, isDetail } = match;
  if (isDetail) {
    return (
      <HubFrameContext.Provider value={true}>
        <div className="min-h-full bg-[#f5f5f7]">{children}</div>
      </HubFrameContext.Provider>
    );
  }
  const fill = !!tab?.fill;
  return (
    <HubFrameContext.Provider value={true}>
      <div className={`flex flex-col bg-[#f5f5f7] ${fill ? "h-full min-h-0" : "min-h-full"}`} data-testid={`sa-area-${area.id}`}>
        <SaHeader icon={area.icon} tint={area.tint} kind={area.kind} title={area.label} tabs={area.tabs} activeTab={tab?.key} />
        {fill ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : <SaBody>{children}</SaBody>}
      </div>
    </HubFrameContext.Provider>
  );
}
