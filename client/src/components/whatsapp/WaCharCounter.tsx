import { waLength } from "@shared/whatsappLimits";

/**
 * "18 / 24" under a journey field, against Meta's WhatsApp limit. Amber when close, red with a
 * line saying what to do when over (the journey editor then blocks saving).
 */
export function WaCharCounter({ value, limit, className = "" }: { value: string | null | undefined; limit: number; className?: string }) {
  const len = waLength((value || "").trim());
  const over = len > limit;
  const close = !over && len >= Math.max(limit - 3, Math.floor(limit * 0.9));
  const tone = over ? "text-red-600" : close ? "text-amber-600" : "text-gray-400";
  return (
    <div className={`flex items-start justify-between gap-2 text-[11px] leading-4 ${className}`}>
      <span className="text-red-600">
        {over ? "Too long: WhatsApp cuts this off. Shorten it." : ""}
      </span>
      <span className={`tabular-nums whitespace-nowrap ${tone}`} data-testid="wa-char-counter">
        {len} / {limit}
      </span>
    </div>
  );
}
