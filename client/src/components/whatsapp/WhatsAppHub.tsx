import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AlertTriangle, CheckCircle2, CircleDashed, Info } from "lucide-react";
import {
  getWhatsappSections,
  WHATSAPP_SECTION_LABELS,
  type WhatsappNavItem,
  type WhatsappReadiness,
  type WhatsappSection,
} from "./sections";

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

function TileCard({
  item,
  blockedReason,
  onOpen,
}: {
  item: WhatsappNavItem;
  blockedReason?: string;
  onOpen: (href: string) => void;
}) {
  const Icon = item.icon;
  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-all group ${
        blockedReason ? "border-amber-300 bg-amber-50/40" : "hover:border-green-300"
      }`}
      onClick={() => onOpen(item.href)}
      data-testid={item.hubTestId}
    >
      <CardContent className="pt-6 pb-5 flex flex-col items-center gap-3 text-center h-full">
        <div className={`p-3 rounded-xl ${item.tone} transition-colors`}>
          <Icon className="w-6 h-6 text-gray-700" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm">{item.hubTitle ?? item.label}</h3>
          <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
          {item.formerly && (
            <p className="text-[11px] text-muted-foreground/70 mt-1">Was called “{item.formerly}”</p>
          )}
        </div>
        {blockedReason && (
          <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-100 text-[11px] font-normal whitespace-normal">
            {blockedReason}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One section, with the problems that belong to it.
 *
 * Scoping matters: a campaign that cannot be sent is not a Lead Gen fault, and showing every
 * problem against every group is how users conclude the wrong thing is broken. The status panel
 * at the top still lists everything, so nothing is only visible after scrolling.
 */
export function SectionBlock({
  section,
  readiness,
  onOpen,
}: {
  section: WhatsappSection;
  readiness?: WhatsappReadiness;
  onOpen: (href: string) => void;
}) {
  if (section.items.length === 0) return null;
  const problems = readiness?.problems.filter(p => p.section === section.id) ?? [];

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          {section.label}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{section.blurb}</p>
      </div>

      {problems.length > 0 && (
        <ul className="space-y-1.5" data-testid={`section-problems-${section.id}`}>
          {problems.map(p => (
            <li
              key={p.id}
              className={`flex items-center gap-2 text-xs rounded-md px-3 py-2 border ${
                p.severity === "blocking"
                  ? "border-red-200 bg-red-50 text-red-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{p.title}</span>
              <button
                type="button"
                onClick={() => onOpen(p.fixHref)}
                className="underline underline-offset-2 font-medium shrink-0"
                data-testid={`section-fix-${p.id}`}
              >
                {p.fixLabel}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {section.items.map(item => (
          <TileCard
            key={item.key}
            item={item}
            blockedReason={readiness ? item.blocked?.(readiness) : undefined}
            onOpen={onOpen}
          />
        ))}
      </div>
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
      href: "/admin/whatsapp-config",
    },
    {
      label: "Receive your first message",
      hint: "Send a WhatsApp message to your business number to confirm it arrives.",
      done: r.connectionVerified,
      href: "/admin/whatsapp-config",
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
              <span className="font-medium text-gray-900">3. Guided journey</span> — your scripted
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

  const sections = getWhatsappSections({ marketingEnabled });

  return (
    <div className="space-y-8">
      {isLoading && (
        <div className="h-16 rounded-lg bg-gray-100 animate-pulse" aria-hidden />
      )}

      {r && !r.inboundReady && <FirstRunChecklist r={r} onOpen={onOpen} />}
      {r && <StatusStrip r={r} onOpen={onOpen} />}
      {r && <RoutingExplainer r={r} />}

      {/* Same sections, same order, same membership as the sidebar. Campaigns is absent
          entirely — heading included — when marketing is not enabled for this account. */}
      {sections.map(section => (
        <SectionBlock key={section.id} section={section} readiness={r} onOpen={onOpen} />
      ))}
    </div>
  );
}
