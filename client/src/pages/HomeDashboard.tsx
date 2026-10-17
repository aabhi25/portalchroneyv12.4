import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, formatDistanceToNowStrict, startOfDay } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronRight, HelpCircle, LifeBuoy, MessageSquare, RefreshCw } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useHubAccess } from "@/components/hub/HubFrame";
import { hubArea, visibleTabs, type HubAreaId } from "@/navigation/hubAreas";
import type { WhatsappReadiness } from "@/components/whatsapp/sections";
import { ChannelBadge, type UnifiedLeadsResponse } from "@/components/leads/UnifiedLeadParts";

interface HomeSummary {
  agents: {
    website: { people: number; leads: number };
    whatsapp: { people: number; leads: number };
    instagram: { people: number; leads: number };
    facebook: { people: number; leads: number };
    calls: { calls: number; answered: number };
  };
  attention: { unansweredQuestions: number; crmSyncProblems: number };
}

interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  href: string;
  icon: typeof AlertTriangle;
  tint: string;
}

const card = "rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Home: what every AI agent did today, what needs attention, and the latest leads. */
export default function HomeDashboard({ user }: { user: MeResponseDto | null }) {
  const [, setLocation] = useLocation();
  const access = useHubAccess(user);
  const since = useMemo(() => startOfDay(new Date()).toISOString(), []);
  const accountKey = user?.activeBusinessAccountId || user?.businessAccount?.id;

  const { data: summary } = useQuery<HomeSummary>({
    queryKey: ["/api/home/summary", accountKey, since],
    queryFn: async () => {
      const res = await fetch(`/api/home/summary?since=${encodeURIComponent(since)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the summary");
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const { data: latest } = useQuery<UnifiedLeadsResponse>({
    queryKey: ["/api/leads", "unified", accountKey, "home-latest"],
    queryFn: async () => {
      const res = await fetch("/api/leads/unified?groupByPerson=1&page=1&limit=5", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leads");
      return res.json();
    },
  });
  const { data: tickets } = useQuery<{ open: number }>({ queryKey: ["/api/tickets/stats"], enabled: access.supportTickets });
  const { data: readiness } = useQuery<WhatsappReadiness>({ queryKey: ["/api/whatsapp/readiness"], enabled: access.whatsapp });

  const agents = (["website", "whatsapp", "instagram", "facebook", "calls", "vista"] as HubAreaId[])
    .map(hubArea)
    .filter(a => a.visible(access));

  const numbersFor = (id: HubAreaId): [string, number][] | null => {
    const a = summary?.agents;
    if (!a) return null;
    switch (id) {
      case "website": return [["Conversations", a.website.people], ["Leads", a.website.leads]];
      case "whatsapp": return [["People", a.whatsapp.people], ["Leads", a.whatsapp.leads]];
      case "instagram": return [["People", a.instagram.people], ["Leads", a.instagram.leads]];
      case "facebook": return [["People", a.facebook.people], ["Leads", a.facebook.leads]];
      case "calls": return [["Calls", a.calls.calls], ["Answered", a.calls.answered]];
      default: return null;
    }
  };

  const a = summary?.agents;
  const people = a
    ? (access.website ? a.website.people : 0) + (access.whatsapp ? a.whatsapp.people : 0) + (access.instagram ? a.instagram.people : 0) + (access.facebook ? a.facebook.people : 0) + (access.calls ? a.calls.answered : 0)
    : null;
  const leadsToday = a ? a.website.leads + a.whatsapp.leads + a.instagram.leads + a.facebook.leads : null;

  const attention: AttentionItem[] = [];
  if (summary?.attention.crmSyncProblems) {
    const n = summary.attention.crmSyncProblems;
    attention.push({ key: "crm", title: `${n} lead${n === 1 ? "" : "s"} did not reach your CRM`, detail: "Open Leads and press Retry on each one", href: "/admin/leads", icon: RefreshCw, tint: "bg-orange-500" });
  }
  for (const p of readiness?.problems ?? []) {
    attention.push({ key: `wa-${p.id}`, title: p.title, detail: p.consequence, href: p.fixHref, icon: AlertTriangle, tint: p.severity === "blocking" ? "bg-red-500" : "bg-green-600" });
  }
  if (access.supportTickets && tickets?.open) {
    attention.push({ key: "tickets", title: `${tickets.open} support ticket${tickets.open === 1 ? "" : "s"} open`, detail: "The AI could not solve these by itself", href: "/tickets", icon: LifeBuoy, tint: "bg-indigo-500" });
  }
  if (access.training && summary?.attention.unansweredQuestions) {
    const n = summary.attention.unansweredQuestions;
    attention.push({ key: "gaps", title: `${n} question${n === 1 ? "" : "s"} the AI could not answer`, detail: "Add the answers in Training", href: "/question-bank", icon: HelpCircle, tint: "bg-purple-600" });
  }

  const goArea = (id: HubAreaId) => setLocation(visibleTabs(hubArea(id), access)[0]?.href ?? "/");

  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 md:px-8 md:pt-10">
        <div className="flex items-start gap-3">
          <SidebarTrigger className="-ml-2 mt-1 hidden text-gray-400 lg:inline-flex" />
          <div className="min-w-0">
            <p className="text-[13px] text-gray-500">{format(new Date(), "EEEE, d MMMM")}</p>
            <h1 className="mt-1 text-balance text-[30px] font-semibold leading-tight tracking-tight text-gray-900 md:text-[38px]" data-testid="home-headline">
              {greeting()}.{" "}
              {people !== null && people > 0 && `Your agents spoke with ${people.toLocaleString("en-IN")} ${people === 1 ? "person" : "people"} today.`}
              {people === 0 && !leadsToday && "No conversations yet today."}
            </h1>
            {!!leadsToday && (
              <p className="mt-2 text-[16px] text-gray-500">
                {leadsToday.toLocaleString("en-IN")} {leadsToday === 1 ? "person" : "people"} left their details today.
              </p>
            )}
          </div>
        </div>

        {agents.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-[20px] font-semibold tracking-tight text-gray-900">Your AI agents</h2>
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map(area => {
                const Icon = area.icon;
                const nums = numbersFor(area.id);
                return (
                  <button key={area.id} type="button" onClick={() => goArea(area.id)} className={`${card} flex flex-col gap-4 p-5 text-left transition-transform hover:-translate-y-0.5`} data-testid={`home-agent-${area.id}`}>
                    <span className="flex items-center gap-2.5">
                      <span className={`grid h-9 w-9 place-items-center rounded-[10px] text-white ${area.tint}`}><Icon className="h-[18px] w-[18px]" /></span>
                      <span className="text-[15.5px] font-semibold text-gray-900">{area.label}</span>
                      <ChevronRight className="ml-auto h-4 w-4 text-gray-300" />
                    </span>
                    {nums ? (
                      <span className="flex gap-6">
                        {nums.map(([label, n]) => (
                          <span key={label}>
                            <span className="block text-[24px] font-semibold tabular-nums tracking-tight text-gray-900">{n.toLocaleString("en-IN")}</span>
                            <span className="text-[12px] text-gray-500">{label} today</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-[13px] text-gray-500">{area.description}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <section>
            <h2 className="mb-3 text-[20px] font-semibold tracking-tight text-gray-900">Needs your attention</h2>
            <div className={`${card} overflow-hidden`}>
              {attention.length === 0 ? (
                <div className="flex items-center gap-3 px-5 py-4 text-[14px] text-gray-600" data-testid="home-all-clear">
                  <CheckCircle2 className="h-5 w-5 text-green-600" /> All clear. Nothing needs you right now.
                </div>
              ) : attention.map(item => {
                const Icon = item.icon;
                return (
                  <button key={item.key} type="button" onClick={() => setLocation(item.href)} className="flex w-full items-center gap-3 border-t border-black/[0.06] px-5 py-3.5 text-left first:border-t-0 hover:bg-gray-50" data-testid={`home-attention-${item.key}`}>
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${item.tint}`}><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-medium text-gray-900">{item.title}</span>
                      <span className="block text-[12.5px] text-gray-500">{item.detail}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                  </button>
                );
              })}
            </div>

            {access.website && (
              <>
                <h2 className="mb-3 mt-8 text-[20px] font-semibold tracking-tight text-gray-900">Try your assistant</h2>
                <div className={`${card} p-5`}>
                  <p className="text-[14px] text-gray-600">Chat or talk with your website assistant exactly as visitors do, or share a link to it.</p>
                  <button type="button" onClick={() => setLocation("/admin/website/try")} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-[14px] font-medium text-white hover:bg-purple-700" data-testid="home-try-assistant">
                    <MessageSquare className="h-4 w-4" /> Open test chat
                  </button>
                </div>
              </>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[20px] font-semibold tracking-tight text-gray-900">Latest leads</h2>
              <button type="button" onClick={() => setLocation("/admin/leads")} className="text-[14px] text-purple-700 hover:text-purple-900">See all</button>
            </div>
            <div className={`${card} overflow-hidden`}>
              {!latest ? (
                <p className="px-5 py-4 text-[14px] text-gray-500">Loading…</p>
              ) : latest.leads.length === 0 ? (
                <p className="px-5 py-4 text-[14px] text-gray-500">No leads yet. They appear here as soon as someone leaves their details.</p>
              ) : latest.leads.map(row => (
                <button key={row.key} type="button" onClick={() => setLocation("/admin/leads")} className="flex w-full items-center gap-3 border-t border-black/[0.06] px-5 py-3 text-left first:border-t-0 hover:bg-gray-50">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-purple-50 text-[13px] font-semibold text-purple-700">
                    {(row.name || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium text-gray-900">{row.name || "Anonymous"}</span>
                    <span className="block truncate text-[12.5px] text-gray-500">{row.email || row.phone || "No contact details"}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <ChannelBadge channel={row.channel} />
                    <span className="text-[11.5px] text-gray-400">{formatDistanceToNowStrict(new Date(row.capturedAt), { addSuffix: true })}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
