// K12 tutor: a question photo and the note typed with it go out as ONE message —
// "[IMAGE_UPLOAD] file.jpg" on the first line, the note on the lines after it.
// (The server reads the same shape: server/services/k12TurnRules.ts.)

export const IMAGE_UPLOAD_PREFIX = '[IMAGE_UPLOAD]';
const PHOTO_NOTE_MAX_CHARS = 500;

/** The message to send for a photo, with whatever the student has typed in the box as its note. */
export function photoMessage(fileName: string, typedNote?: string | null): string {
  const name = (fileName || '').replace(/\s+/g, ' ').trim();
  const note = (typedNote || '').replace(/\s+/g, ' ').trim().slice(0, PHOTO_NOTE_MAX_CHARS).trim();
  return `${IMAGE_UPLOAD_PREFIX} ${name}`.trimEnd() + (note ? `\n${note}` : '');
}

export function isPhotoMessage(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.trimStart().startsWith(IMAGE_UPLOAD_PREFIX);
}

/** A photo message split into the file name and the note typed with it (either may be empty). */
export function splitPhotoMessage(content: string | null | undefined): { fileName: string; note: string } {
  const rest = (content || '').trimStart().slice(IMAGE_UPLOAD_PREFIX.length);
  const nl = rest.indexOf('\n');
  return {
    fileName: (nl === -1 ? rest : rest.slice(0, nl)).trim(),
    note: nl === -1 ? '' : rest.slice(nl + 1).trim(),
  };
}

/**
 * Runs `run` as soon as `isBusy()` is false (checked every 150 ms). If it is still busy after
 * `maxMs`, calls `giveUp` instead. Returns a function that cancels the wait.
 */
export function whenIdle(isBusy: () => boolean, run: () => void, giveUp: () => void, maxMs = 90_000): () => void {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const check = () => {
    if (cancelled) return;
    if (!isBusy()) { run(); return; }
    if (Date.now() - startedAt >= maxMs) { giveUp(); return; }
    timer = setTimeout(check, 150);
  };
  check();
  return () => { cancelled = true; if (timer) clearTimeout(timer); };
}
