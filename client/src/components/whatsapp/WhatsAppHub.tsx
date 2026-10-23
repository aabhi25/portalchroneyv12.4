import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { SETTINGS_PATHS } from "@/pages/settings/settingsPaths";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Info, Megaphone, Route } from "lucide-react";
import { WHATSAPP_SECTION_LABELS, type WhatsappReadiness } from "./sections";

// Re-exported because this used to be the type's home and other screens import it from here.
export type { WhatsappReadiness };

/**
 * The WhatsApp hub.
 *
 * Extracted out of the main WhatsApp page deliberately. That page is a 5,000-line route
 * multiplexer holding the hub, Leads, Conversations, Config, Allowed Numbers and the whole
 * flow builder in one component. Adding readiness state and grouping logic into it would have
 * coupled this screen's state to five unrelated ones.
 *
 * Two products live behind this hub and they are NOT the same job:
 *   - answering people who message you (inbound AI)
 *   - messaging a list of people (outbound marketing)
 * The old flat grid of twelve identical tiles gave no clue which was which, in what order
 * anything had to be done, or whether any of it was actually switched on.
 */

/**
 * The two jobs WhatsApp does, side by side, each opening its own tab. The tabs above already list
 * every screen, so the overview no longer repeats them as a grid of cards.
 */
function TwoJobs({ r, marketingEnabled, onOpen }: { r?: WhatsappReadiness; marketingEnabled: boolean; onOpen: (href: string) => void }) {
  const smartAi = r?.responseMode === "smart_ai";
  const journeyStatus = !r
    ? ""
    : smartAi
      ? "Not running: reply mode is Smart AI"
      : r.activeFlowCount > 0
        ? `${r.activeFlowCount} switched on`
        : "None switched on";
  const campaignStatus = !r?.marketing
    ? ""
    : r.marketing.canSend
      ? "Ready to send"
      : "Needs an audience and an approved template";

  const jobs = [
    {
      key: "journeys",
      title: "Journeys",
      what: "Answer people who message you, with button menus and questions that capture their details. Always on.",
      status: journeyStatus,
      warn: smartAi,
      href: "/admin/whatsapp-flows",
      icon: Route,
      show: true,
    },
    {
      key: "campaigns",
      title: "Campaigns",
      what: "Message many people at once, now or on a schedule. Replies can go to the campaign's AI or to your journeys.",
      status: campaignStatus,
      warn: !!r?.marketing && !r.marketing.canSend,
      href: "/admin/whatsapp-campaigns",
      icon: Megaphone,
      show: marketingEnabled,
    },
  ].filter(j => j.show);

  return (
    <div className={`grid gap-3 ${jobs.length > 1 ? "md:grid-cols-2" : ""}`} data-testid="whatsapp-two-jobs">
      {jobs.map(job => {
        const Icon = job.icon;
        return (
          <Card key={job.key} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => onOpen(job.href)} data-testid={`card-job-${job.key}`}>
            <CardContent className="flex items-start gap-3 p-5">
              <div className="rounded-xl bg-green-50 p-2.5">
                <Icon className="h-5 w-5 text-green-700" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{job.title}</h3>
                  <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
                </div>
                <p className="mt-1 text-sm text-gray-600">{job.what}</p>
                {job.status && (
                  <p className={`mt-2 text-xs ${job.warn ? "font-medium text-amber-700" : "text-gray-500"}`}>{job.status}</p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Shown only while the account has not got inbound replies working. Grouping tiles alone does
 * not tell a brand-new account what to do first, and the required order is not the order the
 * tiles are read in.
 */
function FirstRunChecklist({ r, onOpen }: { r: WhatsappReadiness; onOpen: (href: string) => void }) {
  const steps = [
    {
      label: "Connect your WhatsApp number",
      hint: "Add your MSG91 auth key and number, then paste the webhook URL into MSG91.",
      done: r.credentialsConfigured,
      href: SETTINGS_PATHS.whatsappConnection,
    },
    {
      label: "Receive your first message",
      hint: "Send a WhatsApp message to your business number to confirm it arrives.",
      done: r.connectionVerified,
      href: SETTINGS_PATHS.whatsappConnection,
    },
    {
      label: "Turn on automatic replies",
      hint: "Decide how messages get answered and switch auto-reply on.",
      done: r.autoReplyEnabled,
      href: "/admin/whatsapp-ai-setup",
    },
    {
      label: "Check nothing is being blocked",
      hint: "Allowed Numbers must either be off, or contain the numbers you expect to hear from.",
      done: !r.blockingAllInbound,
      href: "/admin/whatsapp-whitelist",
    },
  ];
  const firstIncomplete = steps.findIndex(s => !s.done);

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardContent className="pt-6 pb-5">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-3">
            <div>
              <h3 className="font-semibold text-base text-blue-900">Get WhatsApp replying to people</h3>
              <p className="text-sm text-blue-800 mt-0.5">
                Four steps, in this order. This checklist disappears once messages are being answered.
              </p>
            </div>
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <li key={s.label} className="flex items-start gap-2.5">
                  {s.done ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                  ) : (
                    <CircleDashed className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className={`text-sm ${s.done ? "text-gray-500 line-through" : "font-medium text-gray-900"}`}>
                      {s.label}
                    </p>
                    {!s.done && <p className="text-xs text-gray-600 mt-0.5">{s.hint}</p>}
                  </div>
                  {i === firstIncomplete && (
                    <Button size="sm" onClick={() => onOpen(s.href)} data-testid="button-checklist-next">
                      Start
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Status summary. Says "configured" when that is all it knows — never claims a working link. */
function StatusStrip({ r, onOpen }: { r: WhatsappReadiness; onOpen: (href: string) => void }) {
  const blocking = r.problems.filter(p => p.severity === "blocking");
  const warnings = r.problems.filter(p => p.severity === "warning");

  if (r.problems.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>
          WhatsApp is connected and answering messages
          {r.lastInboundAt && ` — last message ${new Date(r.lastInboundAt).toLocaleDateString()}`}.
        </span>
      </div>
    );
  }

  const tone = blocking.length > 0
    ? { border: "border-red-300", bg: "bg-red-50", text: "text-red-900", icon: "text-red-600" }
    : { border: "border-amber-300", bg: "bg-amber-50", text: "text-amber-900", icon: "text-amber-600" };

  return (
    <Card className={`${tone.border} ${tone.bg}`}>
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`h-5 w-5 ${tone.icon}`} />
          <h3 className={`font-semibold text-sm ${tone.text}`}>
            {blocking.length > 0
              ? blocking.length === 1
                ? "WhatsApp is not working right now"
                : `WhatsApp is not working right now (${blocking.length} problems)`
              : `WhatsApp is working, with ${warnings.length} thing${warnings.length === 1 ? "" : "s"} to look at`}
          </h3>
        </div>
        <ul className="space-y-2.5">
          {[...blocking, ...warnings].map(p => (
            <li key={p.id} className="flex items-start gap-3" data-testid={`problem-${p.id}`}>
              <span
                className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                  p.severity === "blocking" ? "bg-red-500" : "bg-amber-500"
                }`}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-gray-900">{p.title}</p>
                  <Badge variant="outline" className="text-[10px] font-normal bg-white/70">
                    {WHATSAPP_SECTION_LABELS[p.section]}
                  </Badge>
                </div>
                <p className="text-xs text-gray-700 mt-0.5">{p.consequence}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="bg-white shrink-0"
                onClick={() => onOpen(p.fixHref)}
                data-testid={`button-fix-${p.id}`}
              >
                {p.fixLabel}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * How an incoming message is actually answered.
 *
 * This mirrors the order the webhook applies, including the two rules nobody can guess:
 * Smart AI mode skips scripted journeys entirely, and a running campaign takes the
 * conversation over. Describing the intuitive order instead of the real one would be worse
 * than saying nothing, because users would trust it and build against it.
 */
function RoutingExplainer({ r }: { r: WhatsappReadiness }) {
  const smartAi = r.responseMode === "smart_ai";
  const guidedOnly = r.responseMode === "guided_flows";

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="routing" className="border rounded-lg px-4 bg-white">
        <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
          What decides the reply when someone messages you?
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <ol className="space-y-3 text-sm text-gray-700">
            <li>
              <span className="font-medium text-gray-900">1. Allowed Numbers</span> — if the gate is
              on and the sender is not on the list, the message is discarded here and nothing else
              runs.{" "}
              {r.allowlistEnabled ? (
                <span className="text-amber-700">
                  Currently on, with {r.allowedNumberCount} number{r.allowedNumberCount === 1 ? "" : "s"} allowed.
                </span>
              ) : (
                <span className="text-gray-500">Currently off, so everyone gets through.</span>
              )}
            </li>
            <li>
              <span className="font-medium text-gray-900">2. Recent campaign</span> — replying STOP
              always wins here and opts the person out immediately, whatever else is set up. Beyond
              that, if this person was messaged by a campaign that has its own AI replies switched
              on, that campaign answers and nothing below runs. A campaign with AI replies switched
              off does not take over, so the message carries on down this list.
            </li>
            <li>
              <span className="font-medium text-gray-900">3. Journey</span> — your scripted
              button menu, if one is active.{" "}
              {smartAi ? (
                <span className="text-amber-700 font-medium">
                  Skipped entirely, because your reply mode is set to Smart AI. Journeys you have
                  built will not run until you change that.
                </span>
              ) : (
                <span className="text-gray-500">
                  {r.activeFlowCount > 0 ? "One journey is active." : "No journey is active."}
                </span>
              )}
            </li>
            <li>
              <span className="font-medium text-gray-900">4. Keyword reply</span> — a fixed answer
              matched on words in the message.{" "}
              <span className="text-gray-500">
                {r.smartReplyCount > 0
                  ? `${r.smartReplyCount} set up.`
                  : "None set up."}
              </span>
            </li>
            <li>
              <span className="font-medium text-gray-900">5. AI reply</span> — the AI writes an
              answer when nothing above handled the message.{" "}
              {guidedOnly ? (
                <span className="text-amber-700">
                  Mostly off: your reply mode is Guided journeys only, so unmatched messages get no
                  AI answer. A journey that is built to hand over to AI still does.
                </span>
              ) : !r.aiAvailable ? (
                <span className="text-amber-700">Unavailable — no AI key is configured.</span>
              ) : (
                <span className="text-gray-500">Active.</span>
              )}
            </li>
          </ol>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export default function WhatsAppHub({ marketingEnabled }: { marketingEnabled: boolean }) {
  const [, setLocation] = useLocation();
  const onOpen = (href: string) => setLocation(href);

  const { data: readiness, isLoading } = useQuery<WhatsappReadiness>({
    queryKey: ["/api/whatsapp/readiness"],
  });

  const r = readiness;

  return (
    <div className="space-y-8">
      {isLoading && (
        <div className="h-16 rounded-lg bg-gray-100 animate-pulse" aria-hidden />
      )}

      {r && !r.inboundReady && <FirstRunChecklist r={r} onOpen={onOpen} />}
      {r && <StatusStrip r={r} onOpen={onOpen} />}
      <TwoJobs r={r} marketingEnabled={marketingEnabled} onOpen={onOpen} />
      {r && <RoutingExplainer r={r} />}
    </div>
  );
}
