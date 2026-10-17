import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { HUB_AREAS, settingsItemHref, visibleSettings, visibleTabs, type HubAccess } from "@/navigation/hubAreas";
import { SETTINGS_PATHS } from "@/pages/settings/settingsPaths";

interface Entry {
  label: string;
  place: string;
  href: string;
  formerly?: string;
}

function buildEntries(access: HubAccess): Entry[] {
  const out: Entry[] = [];
  for (const area of HUB_AREAS) {
    if (!area.visible(access)) continue;
    for (const item of visibleSettings(area, access)) {
      out.push({ label: item.label, place: `${area.label} › ${item.group}`, href: settingsItemHref(area, item), formerly: item.formerly });
    }
    for (const tab of visibleTabs(area, access)) {
      if (tab.key === "settings") continue;
      out.push({ label: tab.label, place: area.label, href: tab.href });
    }
    for (const s of area.sections?.items ?? []) {
      if (area.id === "whatsapp" && !access.whatsappMarketing) continue;
      out.push({ label: s.label, place: `${area.label} › Campaigns`, href: s.href });
    }
  }
  out.push({ label: "Account & password", place: "Settings", href: SETTINGS_PATHS.account });
  out.push({ label: "Connected apps", place: "Settings", href: SETTINGS_PATHS.integrations, formerly: "CRM & integrations · LeadSquared · Salesforce · Custom CRM · Shopify · ERP" });
  if (access.isSuperAdminViewing) out.push({ label: "AI usage & limits", place: "Settings", href: SETTINGS_PATHS.usage });
  return out;
}

/** Sidebar search over every setting and screen; also finds things by their old names. */
export function FindSetting({ access }: { access: HubAccess }) {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => buildEntries(access), [access]);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length === 0 ? [] : entries.filter(e => {
    const hay = `${e.label} ${e.place} ${e.formerly ?? ""}`.toLowerCase();
    return words.every(w => hay.includes(w));
  }).slice(0, 8);

  const go = (href: string) => {
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
    setLocation(href);
  };

  return (
    <div className="relative px-2 pb-1 pt-2">
      <Search className="pointer-events-none absolute left-4 top-1/2 mt-0.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === "Enter" && hits[0]) go(hits[0].href);
          if (e.key === "Escape") { setQ(""); setOpen(false); }
        }}
        placeholder="Find a setting"
        aria-label="Find a setting"
        data-testid="input-find-setting"
        className="w-full rounded-lg border border-black/[0.08] bg-white py-1.5 pl-7 pr-2 text-[13px] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-300"
      />
      {open && words.length > 0 && (
        <div className="absolute left-2 right-2 top-full z-50 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-1 shadow-lg" role="listbox">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-[12.5px] text-gray-500">Nothing called "{q}". Try "delete", "OTP" or "voice".</p>
          ) : hits.map(h => {
            const viaOldName = h.formerly && !`${h.label} ${h.place}`.toLowerCase().includes(words[0]);
            return (
              <button
                key={`${h.href}-${h.label}`}
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={e => e.preventDefault()}
                onClick={() => go(h.href)}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-purple-50"
              >
                <span className="block text-[13px] font-medium text-gray-900">{h.label}</span>
                <span className="block text-[11.5px] text-gray-500">{h.place}</span>
                {viaOldName && <span className="block text-[11px] text-orange-600">Was: {h.formerly}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
