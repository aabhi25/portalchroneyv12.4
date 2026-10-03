import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowRight, CalendarClock, CheckCircle2, Eye, FileCode2, Megaphone, MessageCircle, Send,
  Table2, TrendingUp, UsersRound,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type HomeSummary = {
  timezone: string;
  steps: {
    audiences: { done: boolean; count: number; total: number };
    templates: { done: boolean; count: number; total: number };
    campaigns: { done: boolean; count: number };
    replies: { done: boolean; count: number };
  };
  month: { start: string; campaigns: number; messagesSent: number; read: number; readRate: number | null; replies: number };
};

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

type Step = {
  key: string;
  number: number;
  title: string;
  explain: string;
  status: string;
  done: boolean;
  icon: React.ComponentType<{ className?: string }>;
  actions: { label: string; href: string; primary?: boolean }[];
};

/**
 * Landing page of the Campaigns section: the four-step journey with a tick on
 * every step this business has already done, and this month at a glance.
 * Message counts only; no cost or AI-usage figures.
 */
export default function WhatsAppCampaignHome() {
  const [, setLocation] = useLocation();
  const tz = browserTimezone();
  const { data, isLoading, isError } = useQuery<HomeSummary>({
    queryKey: ["/api/whatsapp/campaign-home/summary", tz],
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-home/summary?tz=${encodeURIComponent(tz)}`),
  });

  const s = data?.steps;
  const steps: Step[] = [
    {
      key: "audiences",
      number: 1,
      title: "Audiences",
      explain: "Add the people you want to message, from a spreadsheet or by pasting numbers.",
      status: s ? (s.audiences.done ? `${plural(s.audiences.count, "audience", "audiences")} ready` : s.audiences.total ? "Your audiences have no contacts yet" : "No audience yet") : "",
      done: !!s?.audiences.done,
      icon: UsersRound,
      actions: [{ label: s?.audiences.done ? "Open Audiences" : "Add an audience", href: "/admin/whatsapp-contact-groups", primary: true }],
    },
    {
      key: "templates",
      number: 2,
      title: "Template",
      explain: "Pick the message to send. WhatsApp only delivers campaign messages it has approved.",
      status: s ? (s.templates.done ? `${plural(s.templates.count, "approved template", "approved templates")}` : s.templates.total ? "Waiting for WhatsApp to approve" : "No template yet") : "",
      done: !!s?.templates.done,
      icon: FileCode2,
      actions: [{ label: s?.templates.done ? "Open Templates" : "Add a template", href: "/admin/whatsapp-templates", primary: true }],
    },
    {
      key: "campaigns",
      number: 3,
      title: "Campaign",
      explain: "Choose an audience and a template, then send now or pick a time.",
      status: s ? (s.campaigns.done ? `${plural(s.campaigns.count, "campaign", "campaigns")} sent` : "Nothing sent yet") : "",
      done: !!s?.campaigns.done,
      icon: Megaphone,
      actions: s?.campaigns.done
        ? [{ label: "All campaigns", href: "/admin/whatsapp-campaigns", primary: true }, { label: "New campaign", href: "/admin/whatsapp-campaigns/new" }]
        : [{ label: "Create a campaign", href: "/admin/whatsapp-campaigns/new", primary: true }],
    },
    {
      key: "results",
      number: 4,
      title: "Replies & results",
      explain: "Read what people wrote back and see how each campaign did.",
      status: s ? (s.replies.done ? `${plural(s.replies.count, "person has", "people have")} replied` : "No replies yet") : "",
      done: !!s?.replies.done,
      icon: MessageCircle,
      actions: [
        { label: "Campaign replies", href: "/admin/whatsapp-campaign-conversations", primary: true },
        { label: "Results", href: "/admin/whatsapp-campaign-results" },
      ],
    },
  ];
  const nextStep = s ? steps.find(step => !step.done) : undefined;

  const monthName = data?.month.start
    ? new Date(`${data.month.start}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
    : "This month";
  const stats = data ? [
    { label: "Campaigns", value: data.month.campaigns.toLocaleString(), icon: Megaphone },
    { label: "Messages sent", value: data.month.messagesSent.toLocaleString(), icon: Send },
    { label: "Read rate", value: data.month.readRate === null ? "—" : `${data.month.readRate}%`, icon: Eye },
    { label: "Replies", value: data.month.replies.toLocaleString(), icon: MessageCircle },
  ] : [];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6" data-testid="page-campaign-home">
      <div>
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <p className="text-sm text-gray-600 mt-1">
          Message many people at once on WhatsApp. Work through these four steps — a tick means it is done.
        </p>
      </div>

      {isError && (
        <Card><CardContent className="p-4 text-sm text-gray-600">Could not load your campaign summary. Please refresh the page.</CardContent></Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map(step => {
          const Icon = step.icon;
          const isNext = nextStep?.key === step.key;
          return (
            <Card
              key={step.key}
              className={`flex flex-col ${isNext ? "border-emerald-400 ring-2 ring-emerald-100" : ""}`}
              data-testid={`campaign-step-${step.key}`}
            >
              <CardContent className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {step.done ? (
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" aria-label="Done" />
                    ) : (
                      <span className="h-6 w-6 rounded-full border-2 border-gray-300 text-xs font-semibold text-gray-500 flex items-center justify-center shrink-0">
                        {step.number}
                      </span>
                    )}
                    <h2 className="font-semibold">{step.title}</h2>
                  </div>
                  <Icon className="h-5 w-5 text-gray-400 shrink-0" />
                </div>
                <p className="text-sm text-gray-600 flex-1">{step.explain}</p>
                <div className="flex items-center gap-2 flex-wrap min-h-[22px]">
                  {isLoading ? (
                    <span className="h-4 w-28 rounded bg-gray-100 animate-pulse" />
                  ) : (
                    <span className={`text-xs ${step.done ? "text-emerald-700" : "text-gray-500"}`}>{step.status}</span>
                  )}
                  {isNext && <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">Next step</Badge>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {step.actions.map(action => (
                    <Button
                      key={action.href}
                      size="sm"
                      variant={action.primary ? (isNext || !nextStep ? "default" : "outline") : "ghost"}
                      onClick={() => setLocation(action.href)}
                    >
                      {action.label}
                      {action.primary && <ArrowRight className="h-3.5 w-3.5 ml-1" />}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">{monthName}</h2>
          <Button variant="ghost" size="sm" className="h-8 text-emerald-700"onClick={() => setLocation("/admin/whatsapp-campaign-results")}>
            <TrendingUp className="h-4 w-4 mr-1" /> See all results
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(isLoading ? [0, 1, 2, 3] : stats).map((stat: any, index) => (
            <Card key={stat?.label ?? index}>
              <CardContent className="p-4">
                {isLoading ? (
                  <div className="space-y-2">
                    <div className="h-3 w-20 rounded bg-gray-100 animate-pulse" />
                    <div className="h-7 w-14 rounded bg-gray-100 animate-pulse" />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <stat.icon className="h-3.5 w-3.5" /> {stat.label}
                    </div>
                    <div className="text-2xl font-bold mt-1" data-testid={`campaign-home-stat-${index}`}>{stat.value}</div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setLocation("/admin/whatsapp-campaign-automations")}>
          <CardContent className="p-4 flex items-start gap-3">
            <CalendarClock className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-medium text-sm">Automations</h3>
              <p className="text-xs text-gray-500 mt-0.5">Send a campaign by itself every day — for example reminders a few days before a due date.</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setLocation("/admin/whatsapp-ai-workbooks")}>
          <CardContent className="p-4 flex items-start gap-3">
            <Table2 className="h-5 w-5 text-violet-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-medium text-sm">AI Workbooks</h3>
              <p className="text-xs text-gray-500 mt-0.5">Review campaign recipients and what the AI found out, in one sheet.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
