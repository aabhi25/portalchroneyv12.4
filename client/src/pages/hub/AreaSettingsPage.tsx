import { useLocation } from "wouter";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";
import { useHubAccess } from "@/components/hub/HubFrame";
import {
  hubArea, hubSettingsPath, settingsItemHref, visibleSettings,
  type HubArea, type HubAreaId, type HubSettingsItem,
} from "@/navigation/hubAreas";
import { SettingsErrorBoundary } from "@/pages/SettingsHub";
import { hubSettingsScreen } from "./hubSettingsScreens";

function SuperAdminBadge() {
  return <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10.5px] font-semibold text-orange-700">Super admin</span>;
}

/** Apple-style grouped list of an area's settings. */
function SettingsList({ area, items, activeKey, onOpen }: {
  area: HubArea; items: HubSettingsItem[]; activeKey: string | null; onOpen: (to: string) => void;
}) {
  const groups = Array.from(new Set(items.map(i => i.group)));
  return (
    <nav aria-label={`${area.label} settings`} className="space-y-6">
      {groups.map(group => (
        <section key={group}>
          <h2 className="px-1.5 pb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-gray-400">{group}</h2>
          <ul className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            {items.filter(i => i.group === group).map(item => {
              const Icon = item.icon;
              const active = item.key === activeKey;
              return (
                <li key={item.key} className="border-t border-black/[0.06] first:border-t-0">
                  <button
                    type="button"
                    onClick={() => onOpen(settingsItemHref(area, item))}
                    aria-current={active ? "page" : undefined}
                    data-testid={`area-settings-${area.id}-${item.key}`}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${active ? "bg-purple-50" : "hover:bg-gray-50"}`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${item.superAdminOnly ? "bg-orange-500" : area.tint}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-medium text-gray-900">
                        {item.label}
                        {item.superAdminOnly && <SuperAdminBadge />}
                      </span>
                      <span className="block text-[12.5px] text-gray-500">{item.description}</span>
                    </span>
                    {item.leavesArea
                      ? <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-300" />
                      : <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/**
 * An area's Settings tab (/admin/<area>/settings[/<item>]). Without an item it lists the area's
 * settings; with one it shows that setting's screen. Items that have their own page open it.
 */
export default function AreaSettingsPage({ areaId, itemKey, user }: { areaId: HubAreaId; itemKey?: string; user: MeResponseDto | null }) {
  const [, setLocation] = useLocation();
  const access = useHubAccess(user);
  const area = hubArea(areaId);
  const items = area && area.visible(access) ? visibleSettings(area, access) : [];
  const item = itemKey ? items.find(i => i.key === itemKey) : undefined;
  const screen = item && !item.href ? hubSettingsScreen(areaId, item.key) : undefined;

  if (!area || items.length === 0 || (itemKey && !screen)) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-10 md:px-8">
        <div className="rounded-2xl border border-black/[0.07] bg-white p-8 text-center">
          <p className="font-medium text-gray-900">This setting isn't available for this account</p>
          <p className="mt-1 text-sm text-gray-500">It may belong to a feature that isn't turned on.</p>
          {area && items.length > 0 && (
            <button type="button" className="mt-4 text-sm text-purple-700" onClick={() => setLocation(hubSettingsPath(areaId))}>
              Back to {area.label} settings
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!item || !screen) {
    return (
      <div className="mx-auto w-full max-w-[760px] px-4 py-8 md:px-8">
        <SettingsList area={area} items={items} activeKey={null} onOpen={setLocation} />
      </div>
    );
  }

  const header = (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setLocation(hubSettingsPath(areaId))}
        className={`mb-3 inline-flex items-center gap-0.5 text-[14px] text-purple-700 hover:text-purple-900 ${item.wide ? "" : "xl:hidden"}`}
        data-testid="area-settings-back"
      >
        <ChevronLeft className="h-4 w-4" />
        {area.label} settings
      </button>
      <h2 className="flex flex-wrap items-center gap-2 text-[24px] font-semibold tracking-tight text-gray-900" data-testid="area-settings-title">
        {item.label}
        {item.superAdminOnly && <SuperAdminBadge />}
      </h2>
      <p className="mt-1 text-[14px] text-gray-500">{item.description}</p>
    </div>
  );

  const body = (
    <SettingsErrorBoundary resetKey={item.key}>
      <div key={item.key}>{screen(user)}</div>
    </SettingsErrorBoundary>
  );

  // The chat widget designer has its own live preview, so it gets the full width.
  if (item.wide) {
    return (
      <div className="w-full px-4 pt-6 md:px-8">
        <div className="mx-auto max-w-[1400px]">{header}</div>
        {body}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-8 px-4 py-8 md:px-8 xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="hidden xl:block">
        <div className="sticky top-4">
          <SettingsList area={area} items={items} activeKey={item.key} onOpen={setLocation} />
        </div>
      </div>
      <div className="min-w-0">
        {header}
        {body}
      </div>
    </div>
  );
}
