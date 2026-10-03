import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ReplyClassificationEditor } from "@/components/whatsapp/ReplyClassificationEditor";
import type { WizardCtx } from "./context";
import { StepSection } from "./StepSection";

export function StepAiReplies({ ctx }: { ctx: WizardCtx }) {
  const { v, set } = ctx;
  return (
    <div className="space-y-4">
      <StepSection
        title="Let AI answer replies"
        description="When someone replies to this campaign, the AI answers them using what you've taught it about your business."
        action={<Switch checked={v.aiEnabled} onCheckedChange={on => set({ aiEnabled: on })} data-testid="switch-ai-enabled" />}
      >
        {v.aiEnabled ? (
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
        ) : (
          <p className="text-sm text-gray-500">Replies will wait for your team in Campaign replies.</p>
        )}
      </StepSection>

      <StepSection
        title="Sort replies into outcomes (optional)"
        description="For example Interested / Not interested / Call me back. Works whether or not the AI answers."
      >
        <ReplyClassificationEditor value={v.replyClassifications} onChange={next => set({ replyClassifications: next })} />
      </StepSection>
    </div>
  );
}
