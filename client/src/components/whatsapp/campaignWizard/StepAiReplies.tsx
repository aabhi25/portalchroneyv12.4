import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ReplyClassificationEditor } from "@/components/whatsapp/ReplyClassificationEditor";
import type { WizardCtx } from "./context";
import { StepSection } from "./StepSection";
import type { WhatsappReadiness } from "@/components/whatsapp/sections";

type ReplyChoice = "campaign_ai" | "journey" | "usual";

/**
 * Who answers when someone replies to this campaign. Three plain choices instead of an AI on/off
 * switch, because "off" never meant "nobody answers": it meant the usual WhatsApp replies.
 * Starting the journey uses the business's one switched-on journey (only one can be on at a time).
 */
export function StepAiReplies({ ctx }: { ctx: WizardCtx }) {
  const { v, set } = ctx;
  const [, setLocation] = useLocation();
  const { data: flowsData } = useQuery<{ flows: { id: string; name: string; isActive: string }[] }>({ queryKey: ["/api/whatsapp/flows"] });
  const { data: readiness } = useQuery<WhatsappReadiness>({ queryKey: ["/api/whatsapp/readiness"] });
  const journey = flowsData?.flows.find(f => f.isActive === "true");
  const smartAi = readiness?.responseMode === "smart_ai";
  const journeyBlocked = !journey ? "No journey is switched on yet." : smartAi ? "Your reply mode is Smart AI, so journeys don't run." : null;

  const choice: ReplyChoice = v.aiEnabled ? "campaign_ai" : v.replyStartsJourney ? "journey" : "usual";
  const choose = (next: ReplyChoice) => set({ aiEnabled: next === "campaign_ai", replyStartsJourney: next === "journey" });
  const options: { key: ReplyChoice; title: string; text: string; disabled?: string | null }[] = [
    {
      key: "campaign_ai",
      title: "This campaign's AI answers",
      text: "Uses the instructions below. Your journey and keyword replies stay quiet for these people while the campaign runs. Replies stay with the campaign and don't become leads.",
    },
    {
      key: "journey",
      title: journey ? `Start your journey “${journey.name}”` : "Start your journey",
      text: "Their first reply starts your WhatsApp journey, so their details are captured and they become a lead. Replies are still counted for this campaign.",
      disabled: journeyBlocked,
    },
    {
      key: "usual",
      title: "Your usual WhatsApp replies",
      text: "Replies are answered as if the person had messaged you first (journey, keyword replies, AI). Your team can read them under Conversations › Campaign replies.",
    },
  ];

  return (
    <div className="space-y-4">
      <StepSection title="When people reply" description="Choose who answers someone who replies to this campaign.">
        <div className="grid gap-2" role="radiogroup" aria-label="When people reply">
          {options.map(o => {
            const selected = choice === o.key;
            const disabled = Boolean(o.disabled) && !selected;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => choose(o.key)}
                className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                  selected ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : disabled ? "cursor-not-allowed border-gray-200 opacity-60" : "border-gray-200 hover:border-emerald-300 hover:bg-gray-50"
                }`}
                data-testid={`reply-choice-${o.key}`}
              >
                <span className="block text-sm font-medium text-gray-800">{o.title}</span>
                <span className="mt-1 block text-xs text-gray-500">{o.text}</span>
                {o.disabled && <span className="mt-1 block text-xs font-medium text-amber-700">{o.disabled}</span>}
              </button>
            );
          })}
        </div>
        {choice === "journey" && journeyBlocked && (
          <p className="text-xs text-amber-700">{journeyBlocked} Until that changes, replies get your usual WhatsApp replies.</p>
        )}
        {journeyBlocked && !journey && (
          <Button variant="ghost" size="sm" className="h-auto px-0 text-emerald-700" onClick={() => setLocation("/admin/whatsapp-flows")}>Set up a journey</Button>
        )}
      </StepSection>

      {v.aiEnabled && (
        <StepSection title="The campaign's AI" description="It answers using what you've taught it about your business.">
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700" htmlFor="ai-agent-name">Name the AI uses</label>
              <Input id="ai-agent-name" className="mt-1" value={v.aiAgentName} onChange={e => set({ aiAgentName: e.target.value })} placeholder="Sales Agent" data-testid="input-ai-agent-name" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700" htmlFor="ai-instructions">What should the AI do in these chats? <span className="font-normal text-gray-400">(optional)</span></label>
              <Textarea
                id="ai-instructions"
                className="mt-1"
                rows={4}
                value={v.aiSystemPrompt}
                onChange={e => set({ aiSystemPrompt: e.target.value })}
                placeholder="Be friendly. Our Diwali offer is 15% off until 31 October. Try to book a store visit."
                data-testid="input-ai-system-prompt"
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">The AI can use</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {([
                  ["aiUseFaqs", "Your FAQs"],
                  ["aiUseDocs", "Your training documents"],
                  ["aiUseProducts", "Your products"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                    <Checkbox checked={v[key]} onCheckedChange={c => set({ [key]: !!c } as any)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </StepSection>
      )}

      <StepSection
        title="Sort replies into outcomes (optional)"
        description="For example Interested / Not interested / Call me back. Works whether or not the AI answers."
      >
        <ReplyClassificationEditor value={v.replyClassifications} onChange={next => set({ replyClassifications: next })} />
      </StepSection>
    </div>
  );
}
