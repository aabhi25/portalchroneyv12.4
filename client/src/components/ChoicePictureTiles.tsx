import { useState } from "react";
import { Gift } from "lucide-react";

/**
 * A product journey's options as picture tiles (a gift finder's "Pendant / Rings / Earrings…"): a small product
 * photo with the option under it, three across. Options without a photo (e.g. "Surprise me") get a gift icon;
 * a photo that fails to load falls back to the same icon.
 */
export function ChoicePictureTiles({ options, images, onSelect, chatColor = "#9333ea" }: {
  options: string[];
  images: Record<string, string>;
  onSelect: (option: string) => void;
  chatColor?: string;
}) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  return (
    <div className="my-3 grid grid-cols-3 gap-2 px-1" role="group" aria-label="Choose one" data-testid="choice-picture-tiles">
      {options.map(option => {
        const src = images[option];
        const showPhoto = !!src && !broken[option];
        return (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left transition-all duration-200 hover:border-gray-400 hover:shadow-sm active:scale-[0.97]"
            data-testid={`choice-tile-${option}`}
          >
            <span className="relative block aspect-square w-full overflow-hidden bg-gray-50">
              {showPhoto ? (
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  onError={() => setBroken(b => ({ ...b, [option]: true }))}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <span className="grid h-full w-full place-items-center" style={{ color: chatColor }}>
                  <Gift className="h-7 w-7 opacity-70" />
                </span>
              )}
            </span>
            <span className="block px-2 py-1.5 text-center text-[12.5px] font-medium leading-tight text-gray-800">{option}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Picture tiles only when they help: at least two options have a photo, and at least half of them do. */
export function showPictureTiles(options: string[], images: Record<string, string> | undefined): boolean {
  if (!images) return false;
  const withPhoto = options.filter(o => images[o]).length;
  return withPhoto >= 2 && withPhoto * 2 >= options.length && options.length <= 9;
}
