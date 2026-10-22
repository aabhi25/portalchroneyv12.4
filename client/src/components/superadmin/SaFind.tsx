import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { SA_AREAS, ACCOUNT_TABS, accountHref } from "@/navigation/superAdminAreas";

interface Entry {
  label: string;
  place: string;
  href: string;
  formerly?: string;
}

interface AccountLite { id: string; name: string; website: string | null }

/** Things that live on every account's page, found by what they used to be called. */
const ACCOUNT_ITEMS: { tab: typeof ACCOUNT_TABS[number]["key"]; formerly: string }[] = [
  { tab: "overview", formerly: "Insights · leads · conversations · last login" },
  { tab: "features", formerly: "Features · product features · manage modules · agents · add-ons" },
  { tab: "keys", formerly: "API Keys · OpenAI key · ElevenLabs · Vista Studio · image model · photo search key" },
  { tab: "avatar", formerly: "Live AI avatar · HeyGen · Anam · avatar minutes" },
  { tab: "usage", formerly: "Usage & Limits · monthly limit · spend" },
  { tab: "privacy", formerly: "Auto-delete · data retention · hide contact details" },
  { tab: "details", formerly: "Edit · login credentials · reset password · currency · duplicate · disable · delete" },
  { tab: "demos", formerly: "Demo pages for this account" },
];

function areaEntries(): Entry[] {
  const out: Entry[] = [];
  for (const area of SA_AREAS) {
    for (const tab of area.tabs) {
      out.push({
        label: area.tabs.length > 1 ? tab.label : area.label,
        place: area.tabs.length > 1 ? area.label : area.kind,
        href: tab.href,
        formerly: area.formerly,
      });
    }
  }
  for (const item of ACCOUNT_ITEMS) {
    const label = ACCOUNT_TABS.find(t => t.key === item.tab)!.label;
    out.push({ label, place: "Each account's page (open an account)", href: "/super-admin", formerly: item.formerly });
  }
  return out;
}

/** Sidebar search: jumps to an account, a page or a setting; also understands the old menu names. */
export function SaFind() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const { data: accounts = [] } = useQuery<AccountLite[]>({
    queryKey: ["/api/business-accounts", "all"],
    queryFn: async () => {
      const res = await fetch("/api/business-accounts?limit=1000", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch business accounts");
      const data = await res.json();
      return data.accounts || data;
    },
    enabled: words.length > 0,
    staleTime: 60_000,
  });

  const entries = useMemo(() => areaEntries(), []);
  const hits = useMemo(() => {
    if (words.length === 0) return [];
    const accountHits: Entry[] = accounts
      .filter(a => words.every(w => `${a.name} ${a.website ?? ""}`.toLowerCase().includes(w)))
      .slice(0, 5)
      .map(a => ({ label: a.name, place: "Account", href: accountHref(a.id) }));
    const pageHits = entries.filter(e => {
      const hay = `${e.label} ${e.place} ${e.formerly ?? ""}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
    return [...accountHits, ...pageHits].slice(0, 8);
  }, [words.join(" "), accounts, entries]);

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
        placeholder="Find an account or setting"
        aria-label="Find an account or setting"
        data-testid="input-sa-find"
        className="w-full rounded-lg border border-black/[0.08] bg-white py-1.5 pl-7 pr-2 text-[13px] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-300"
      />
      {open && words.length > 0 && (
        <div className="absolute left-2 right-2 top-full z-50 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-1 shadow-lg" role="listbox">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-[12.5px] text-gray-500">Nothing called "{q}". Try an account name, "backup" or "OpenAI".</p>
          ) : hits.map(h => {
            // Show only the old name(s) that matched, not the whole list.
            const viaOldName = h.formerly && !`${h.label} ${h.place}`.toLowerCase().includes(words[0])
              ? h.formerly.split(" · ").filter(part => words.some(w => part.toLowerCase().includes(w))).join(" · ")
              : "";
            return (
              <button
                key={`${h.href}-${h.label}-${h.place}`}
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={e => e.preventDefault()}
                onClick={() => go(h.href)}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-purple-50"
              >
                <span className="block text-[13px] font-medium text-gray-900">{h.label}</span>
                <span className="block text-[11.5px] text-gray-500">{h.place}</span>
                {viaOldName && <span className="block text-[11px] text-orange-600">Was: {viaOldName}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
