import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  KNOWLEDGE_CHANNELS,
  KNOWLEDGE_CHANNEL_LABELS,
  appliesToChannel,
  describeChannels,
  isChannelRestricted,
  sanitizeChannels,
  type KnowledgeChannel,
} from "@shared/knowledgeChannels";

/** Value used by ChannelFilterSelect: 'all' (no filter) or one channel. */
export type ChannelFilterValue = "all" | KnowledgeChannel;

/**
 * Does an item tagged `channels` show up under the given filter? "Used on that channel" means
 * untagged items (all channels) plus items tagged with that channel.
 */
export function matchesChannelFilter(
  channels: readonly string[] | null | undefined,
  filter: ChannelFilterValue,
): boolean {
  if (filter === "all") return true;
  return appliesToChannel(channels, filter);
}

interface ChannelOptionsProps {
  value: string[] | null | undefined;
  onChange: (channels: KnowledgeChannel[] | null) => void;
  disabled?: boolean;
  idPrefix: string;
}

/**
 * The radio "All channels" / "Only on…" plus the 4 checkboxes. Keeps the "Only on…" choice and
 * the ticked boxes locally, so picking "Only on…" with nothing ticked (or all four ticked) is a
 * valid in-between state while the emitted value stays null (= all channels).
 */
function ChannelOptions({ value, onChange, disabled, idPrefix }: ChannelOptionsProps) {
  const saved = sanitizeChannels(value);
  const savedKey = saved ? saved.join(",") : "";
  const [mode, setMode] = useState<"all" | "only">(saved ? "only" : "all");
  const [checked, setChecked] = useState<KnowledgeChannel[]>(saved ?? []);

  // Re-sync when the value changes from outside (dialog reset, row switched, server refresh).
  useEffect(() => {
    if (saved) {
      setMode("only");
      setChecked(saved);
      return;
    }
    // Value is "all channels". Only reset the local state if it currently describes a real
    // restriction (i.e. the value was changed from outside); an empty / all-four selection the
    // user is still building stays as it is.
    if (sanitizeChannels(checked) !== null) {
      setMode("all");
      setChecked([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const handleMode = (next: string) => {
    if (next === "all") {
      setMode("all");
      setChecked([]);
      onChange(null);
    } else {
      setMode("only");
      // Nothing ticked yet → value stays "all channels" until a box is ticked.
      onChange(sanitizeChannels(checked));
    }
  };

  const toggle = (channel: KnowledgeChannel, on: boolean) => {
    const set = new Set(checked);
    if (on) set.add(channel);
    else set.delete(channel);
    const next = KNOWLEDGE_CHANNELS.filter(c => set.has(c));
    setChecked(next);
    onChange(sanitizeChannels(next));
  };

  return (
    <div className="space-y-2">
      <RadioGroup value={mode} onValueChange={handleMode} disabled={disabled} className="gap-1.5">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="all" id={`${idPrefix}-all`} data-testid="channel-option-all" />
          <Label htmlFor={`${idPrefix}-all`} className="text-sm font-normal cursor-pointer">
            All channels
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="only" id={`${idPrefix}-only`} data-testid="channel-option-only" />
          <Label htmlFor={`${idPrefix}-only`} className="text-sm font-normal cursor-pointer">
            Only on…
          </Label>
        </div>
      </RadioGroup>
      {mode === "only" && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pl-6">
          {KNOWLEDGE_CHANNELS.map(channel => (
            <div key={channel} className="flex items-center gap-2">
              <Checkbox
                id={`${idPrefix}-${channel}`}
                checked={checked.includes(channel)}
                onCheckedChange={v => toggle(channel, v === true)}
                disabled={disabled}
                data-testid={`channel-option-${channel}`}
              />
              <Label htmlFor={`${idPrefix}-${channel}`} className="text-sm font-normal cursor-pointer">
                {KNOWLEDGE_CHANNEL_LABELS[channel]}
              </Label>
            </div>
          ))}
        </div>
      )}
      {mode === "only" && !saved && (
        <p className="text-xs text-muted-foreground pl-6">
          Tick at least one channel (all or none ticked = all channels).
        </p>
      )}
    </div>
  );
}

let pickerIdCounter = 0;
function usePickerId() {
  const [id] = useState(() => `channel-picker-${++pickerIdCounter}`);
  return id;
}

export interface ChannelPickerProps {
  value: string[] | null | undefined;
  onChange: (channels: KnowledgeChannel[] | null) => void;
  disabled?: boolean;
  /**
   * Compact = a small button that opens a popover. Changes in the popover are kept as a draft
   * and handed to `onChange` only when "Save" is clicked (one request per edit on list rows).
   */
  compact?: boolean;
}

export function ChannelPicker({ value, onChange, disabled, compact }: ChannelPickerProps) {
  const idPrefix = usePickerId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<KnowledgeChannel[] | null>(sanitizeChannels(value));

  if (!compact) {
    return (
      <div className="grid gap-2" data-testid="channel-picker">
        <Label>Channels</Label>
        <ChannelOptions value={value} onChange={onChange} disabled={disabled} idPrefix={idPrefix} />
        <p className="text-xs text-muted-foreground">
          Where the AI may use this. Leave on "All channels" unless it should only be used on some channels.
        </p>
      </div>
    );
  }

  const savedKey = (sanitizeChannels(value) ?? []).join(",");
  const draftKey = (draft ?? []).join(",");

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        if (next) setDraft(sanitizeChannels(value));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 px-2 text-xs text-muted-foreground"
          title={`Channels: ${describeChannels(value)}`}
          data-testid="channel-picker"
          onClick={e => e.stopPropagation()}
        >
          <Radio className="h-3.5 w-3.5 mr-1" />
          Channels
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        align="end"
        onClick={e => e.stopPropagation()}
      >
        <div className="space-y-3">
          <p className="text-sm font-medium">Channels</p>
          <ChannelOptions value={draft} onChange={setDraft} disabled={disabled} idPrefix={idPrefix} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled || draftKey === savedKey}
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
              data-testid="channel-picker-save"
            >
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Small outline badge ("WhatsApp only", "Website, WhatsApp"); nothing for untagged items. */
export function ChannelBadge({
  channels,
  className,
}: {
  channels: readonly string[] | null | undefined;
  className?: string;
}) {
  if (!isChannelRestricted(channels)) return null;
  const clean = sanitizeChannels(channels as unknown) ?? [];
  const text = clean.length === 1 ? `${KNOWLEDGE_CHANNEL_LABELS[clean[0]]} only` : describeChannels(clean);
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-medium px-1.5 py-0 h-5 text-muted-foreground", className)}
      title={`Used only on: ${describeChannels(clean)}`}
      data-testid="channel-badge"
    >
      {text}
    </Badge>
  );
}

/** "All channels" + the 4 channels. Picking a channel = items used there (untagged + tagged). */
export function ChannelFilterSelect({
  value,
  onChange,
  className,
}: {
  value: ChannelFilterValue;
  onChange: (value: ChannelFilterValue) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={v => onChange(v as ChannelFilterValue)}>
      <SelectTrigger className={cn("w-[150px] h-9 text-sm", className)} data-testid="channel-filter">
        <SelectValue placeholder="All channels" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All channels</SelectItem>
        {KNOWLEDGE_CHANNELS.map(channel => (
          <SelectItem key={channel} value={channel}>
            {KNOWLEDGE_CHANNEL_LABELS[channel]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default ChannelPicker;
