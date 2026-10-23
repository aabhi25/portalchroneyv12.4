import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowRight, CheckCircle2, FileCode2, Megaphone, UsersRound } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type HomeSummary = {
  steps: {
    audiences: { done: boolean; count: number; total: number };
    templates: { done: boolean; count: number; total: number };
    campaigns: { done: boolean; count: number };
  };
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

/**
 * The three things a first campaign needs, in order, with a tick on each one already done.
 * Sits above the campaign list and disappears once the first campaign has gone out: after that
 * the list itself is the useful view. (This used to be a separate Campaigns › Home page.)
 */
export function CampaignGettingStarted() {
  const [, setLocation] = useLocation();
  const tz = browserTimezone();
  const { data } = useQuery<HomeSummary>({
    queryKey: ["/api/whatsapp/campaign-home/summary", tz],
    queryFn: () => apiRequest("GET", `/api/whatsapp/campaign-home/summary?tz=${encodeURIComponent(tz)}`),
  });

  const s = data?.steps;
  if (!s || s.campaigns.done) return null;

  const steps = [
    {
      key: "audiences",
      number: 1,
      title: "Add an audience",
      explain: "The people to message, from a spreadsheet, an AI Workbook or pasted numbers.",
      status: s.audiences.done ? `${plural(s.audiences.count, "audience", "audiences")} ready` : s.audiences.total ? "Your audiences have no contacts yet" : "No audience yet",
      done: s.audiences.done,
      icon: UsersRound,
      action: { label: s.audiences.done ? "Open Audiences" : "Add an audience", href: "/admin/whatsapp-contact-groups" },
    },
    {
      key: "templates",
      number: 2,
      title: "Get a template approved",
      explain: "WhatsApp only delivers campaign messages it has approved, which can take a little while.",
      status: s.templates.done ? plural(s.templates.count, "approved template", "approved templates") : s.templates.total ? "Waiting for WhatsApp to approve" : "No template yet",
      done: s.templates.done,
      icon: FileCode2,
      action: { label: s.templates.done ? "Open Templates" : "Add a template", href: "/admin/whatsapp-templates" },
    },
    {
      key: "campaigns",
      number: 3,
      title: "Send your first campaign",
      explain: "Pick the audience and template, then send now or choose a time.",
      status: "Nothing sent yet",
      done: false,
      icon: Megaphone,
      action: { label: "Create a campaign", href: "/admin/whatsapp-campaigns/new" },
    },
  ];
  const nextKey = steps.find(step => !step.done)?.key;

  return (
    <div className="mb-5 space-y-2" data-testid="campaign-getting-started">
      <p className="text-sm text-gray-600">Three steps to your first campaign. This goes away once it is sent.</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {steps.map(step => {
          const Icon = step.icon;
          const isNext = step.key === nextKey;
          return (
            <Card key={step.key} className={`flex flex-col ${isNext ? "border-emerald-400 ring-2 ring-emerald-100" : ""}`} data-testid={`campaign-step-${step.key}`}>
              <CardContent className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {step.done ? (
                      <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-label="Done" />
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-gray-300 text-xs font-semibold text-gray-500">
                        {step.number}
                      </span>
                    )}
                    <h2 className="font-semibold">{step.title}</h2>
                  </div>
                  <Icon className="h-5 w-5 shrink-0 text-gray-400" />
                </div>
                <p className="flex-1 text-sm text-gray-600">{step.explain}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs ${step.done ? "text-emerald-700" : "text-gray-500"}`}>{step.status}</span>
                  {isNext && <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">Next step</Badge>}
                </div>
                <div>
                  <Button size="sm" variant={isNext ? "default" : "outline"} onClick={() => setLocation(step.action.href)}>
                    {step.action.label}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
