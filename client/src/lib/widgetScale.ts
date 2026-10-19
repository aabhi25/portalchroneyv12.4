/**
 * How big the chat widget's text, buttons and spacing are, from the size the business picked
 * (Widget › Appearance › Size). Medium (400 × 600) is 1; Small is a little smaller, Large a
 * little bigger, so everything inside keeps its proportions instead of only the window changing.
 *
 * The widget's styles are almost all in rem, so the scale is applied by setting the root font
 * size of the widget's own page (it runs in an iframe, so nothing else is affected).
 */
const PRESET_SIZE: Record<string, { width: number; height: number }> = {
  small: { width: 350, height: 500 },
  medium: { width: 400, height: 600 },
  large: { width: 450, height: 700 },
};

const MIN_SCALE = 0.9375; // Small: 15px base text (chat text stays readable)
const MAX_SCALE = 1.0625; // Large: 17px base text

export function widgetUiScale(
  settings: { sizePreset?: string | null; widgetWidth?: string | number | null; widgetHeight?: string | number | null } | null | undefined,
  isMobile: boolean,
): number {
  // On phones the widget fills the screen and text must stay at least 16px (no iOS zoom).
  if (isMobile || !settings) return 1;
  const preset = PRESET_SIZE[settings.sizePreset || "medium"];
  const width = preset?.width ?? (Number(settings.widgetWidth) || 400);
  const height = preset?.height ?? (Number(settings.widgetHeight) || 600);
  const raw = Math.min(width / 400, height / 600);
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
  // Whole half-pixels of base text keep the type crisp.
  return Math.round(16 * clamped * 2) / 2 / 16;
}

/** A pixel size at the widget's scale, e.g. scalePx(16, 0.9375) → "15px". */
export function scalePx(px: number, scale: number): string {
  return `${Math.round(px * scale * 2) / 2}px`;
}
