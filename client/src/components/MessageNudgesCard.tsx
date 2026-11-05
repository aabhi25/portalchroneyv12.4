import { useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGE_NUDGE_MAX_CHARS, MESSAGE_NUDGE_MAX_DELAY, MESSAGE_NUDGE_MIN_DELAY, type MessageNudgeItem } from "@shared/messageNudges";

/** The Message nudges settings: on an account's Website chat settings and a group's Extra training. */
export function MessageNudgesCard({ enabled, onEnabledChange, items, onItemsChange, intro, notes = [] }: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  items: MessageNudgeItem[];
  onItemsChange: (items: MessageNudgeItem[]) => void;
  /** Replaces the opening explanation. */
  intro?: string;
  /** Extra lines under the messages. */
  notes?: string[];
}) {
  const boxes = useRef<(HTMLTextAreaElement | null)[]>([]);

  const applyBold = (index: number) => {
    const el = boxes.current[index];
    if (!el) return;
    const value = items[index].message;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const replacement = selected ? `**${selected}**` : `**bold text**`;
    onItemsChange(items.map((item, i) => (i === index ? { ...item, message: value.slice(0, start) + replacement + value.slice(end) } : item)));
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + 2, selected ? end + 2 : start + 13);
    }, 0);
  };

  return (
    <Card className="border border-gray-200 bg-white shadow-sm">
      <CardContent className="py-5 px-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Message nudges</h3>
            <p className="mt-1 text-sm text-gray-500">
              {intro || "Messages that appear one after another above the chat button. When a visitor opens the chat, it starts with only the messages they have already seen, and replying continues from there."}
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Message nudges" />
        </div>
        {enabled && !items.some((item) => item.message.trim()) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Write at least one message: nothing shows until you do.</p>
        )}
        <div className="space-y-4">
          {items.map((item, index) => {
            const update = (changes: Partial<MessageNudgeItem>) =>
              onItemsChange(items.map((other, i) => (i === index ? { ...other, ...changes } : other)));
            return (
              <div key={index} className="rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`message-nudge-${index}`} className="text-sm font-semibold text-gray-800">
                    Message {index + 1}{index > 0 ? " (optional)" : ""}
                  </Label>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyBold(index);
                    }}
                    className="rounded border border-gray-200 px-2 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
                    title="Bold"
                  >
                    B
                  </button>
                </div>
                <Textarea
                  id={`message-nudge-${index}`}
                  ref={(el) => { boxes.current[index] = el; }}
                  value={item.message}
                  onChange={(e) => update({ message: e.target.value })}
                  placeholder={index === 0 ? "Early-bird scholarship closes soon. Want to know if you qualify?" : "Leave empty to skip this message"}
                  maxLength={MESSAGE_NUDGE_MAX_CHARS}
                  className="min-h-[90px]"
                />
                <p className="text-right text-xs text-gray-500">{item.message.length}/{MESSAGE_NUDGE_MAX_CHARS}</p>
                <div>
                  <Label className="text-xs text-gray-600">
                    {index === 0 ? "Show after the visitor starts browsing" : `Show after message ${index}`}
                  </Label>
                  <div className="mt-2 flex items-center gap-3">
                    <Slider
                      value={[item.delay]}
                      onValueChange={(value) => update({ delay: value[0] })}
                      min={MESSAGE_NUDGE_MIN_DELAY}
                      max={MESSAGE_NUDGE_MAX_DELAY}
                      step={5}
                      className="flex-1"
                    />
                    <span className="w-12 text-right text-sm font-semibold text-purple-700">{item.delay}s</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-gray-500">
          <li>Shown once per visit. Closing a bubble with ✕ stops them for a day, and that visitor gets the normal greeting.</li>
          <li>While this is on, the Proactive bubble in Nudges &amp; banners is paused.</li>
          <li>If a journey starts every chat, its first question appears right after these messages, and the visitor's reply answers that question.</li>
          {notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </CardContent>
    </Card>
  );
}
