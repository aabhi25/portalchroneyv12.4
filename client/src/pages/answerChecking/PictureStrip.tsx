import { useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { MAX_QUESTION_PICTURES, photoToDataUrl, pictureSrc, type PictureRef } from "./answerCheckApi";

/**
 * A question's pictures (its own figure, or its model answer's diagram): thumbnails that open full
 * size. With `onChange` it is editable — remove a picture, or add one (JPG / PNG, shrunk first).
 */
export function PictureStrip({ pictures, onChange, addLabel = "Add a picture", testId }: { pictures: PictureRef[]; onChange?: (next: PictureRef[]) => void; addLabel?: string; testId?: string }) {
  const [error, setError] = useState("");
  if (!pictures.length && !onChange) return null;

  async function add(list: FileList | null) {
    if (!list || !onChange) return;
    setError("");
    const next = [...pictures];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_QUESTION_PICTURES) { setError(`At most ${MAX_QUESTION_PICTURES} pictures.`); break; }
      try { next.push({ data: await photoToDataUrl(f) }); }
      catch (e: any) { setError(e.message); }
    }
    onChange(next);
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid={testId}>
      {pictures.map((p, i) => (
        <div key={p.id || i} className="relative">
          <a href={pictureSrc(p)} target="_blank" rel="noreferrer">
            <img src={pictureSrc(p)} alt={`Picture ${i + 1}`} className="h-20 max-w-[160px] rounded-lg border bg-white object-contain" />
          </a>
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[11px] text-white">{i + 1}</span>
          {onChange && (
            <button type="button" onClick={() => onChange(pictures.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-gray-900 text-white" aria-label={`Remove picture ${i + 1}`}>
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {onChange && pictures.length < MAX_QUESTION_PICTURES && (
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 text-[12px] font-medium text-gray-600 hover:border-violet-400 hover:text-violet-700">
          <ImagePlus className="h-3.5 w-3.5" />{addLabel}
          <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { add(e.target.files); e.target.value = ""; }} />
        </label>
      )}
      {error && <span className="text-[12px] text-red-600">{error}</span>}
    </div>
  );
}
