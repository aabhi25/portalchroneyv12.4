export type PdfRenderErrorCode =
  | "FILE_TOO_LARGE"
  | "PASSWORD_REQUIRED"
  | "PASSWORD_WRONG"
  | "RENDER_TIMEOUT"
  | "RENDER_FAILED"
  | "NO_PAGES"
  | "DEPENDENCY_MISSING";

export class PdfRenderError extends Error {
  code: PdfRenderErrorCode;
  cause?: unknown;
  constructor(code: PdfRenderErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "PdfRenderError";
    this.code = code;
    this.cause = cause;
  }
}

export interface RenderedPage {
  pageNumber: number;
  jpegBuffer: Buffer;
  width: number;
  height: number;
}

export interface RenderOptions {
  password?: string;
  maxPages?: number;
  scale?: number;
  jpegQuality?: number;
  maxFileBytes?: number;
  maxPixelsPerPage?: number;
  perPageTimeoutMs?: number;
}

const DEFAULTS = {
  maxPages: 6,
  scale: 2.0,
  jpegQuality: 85,
  maxFileBytes: 15 * 1024 * 1024,
  maxPixelsPerPage: 8_000_000,
  perPageTimeoutMs: 20_000,
};

let mupdfCache: any | null = null;
async function loadMupdf(): Promise<any> {
  if (mupdfCache) return mupdfCache;
  try {
    mupdfCache = await import("mupdf");
    return mupdfCache;
  } catch (err: any) {
    throw new PdfRenderError(
      "DEPENDENCY_MISSING",
      `mupdf failed to load: ${err?.message || err}`,
      err
    );
  }
}

// NOTE: This is a best-effort soft timeout. mupdf rendering runs synchronously inside the WASM
// VM and will block the event loop while it works, so the timer cannot fire mid-render. It still
// guards against the surrounding async work hanging. For a hard wall-clock kill, page rendering
// would need to move to a worker thread — that's a future hardening item, not today's fix.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PdfRenderError("RENDER_TIMEOUT", `${label} timed out after ${ms}ms`)),
      ms
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// Global render concurrency limiter. mupdf runs synchronously in WASM and uses CPU + memory
// proportional to page size; allowing unbounded concurrent renders can exhaust the event loop
// and degrade chat responsiveness for other customers. Default 3 concurrent renders is a safe
// floor for typical small instances; tune via PDF_RENDER_CONCURRENCY env var if needed.
const RENDER_CONCURRENCY = Math.max(1, parseInt(process.env.PDF_RENDER_CONCURRENCY || "3", 10) || 3);
let activeRenders = 0;
const waitQueue: Array<() => void> = [];
async function acquireRenderSlot(): Promise<void> {
  if (activeRenders < RENDER_CONCURRENCY) {
    activeRenders++;
    return;
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activeRenders++;
}
function releaseRenderSlot(): void {
  activeRenders--;
  const next = waitQueue.shift();
  if (next) next();
}

export async function renderPdfPagesToJpegs(
  pdfBuffer: Buffer,
  options: RenderOptions = {}
): Promise<RenderedPage[]> {
  const opts = { ...DEFAULTS, ...options };

  if (pdfBuffer.length > opts.maxFileBytes) {
    throw new PdfRenderError(
      "FILE_TOO_LARGE",
      `PDF is ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB, exceeds limit of ${(opts.maxFileBytes / 1024 / 1024).toFixed(0)}MB`
    );
  }

  const mupdf = await loadMupdf();

  await acquireRenderSlot();
  try {
    return await renderInternal(mupdf, pdfBuffer, opts);
  } finally {
    releaseRenderSlot();
  }
}

async function renderInternal(mupdf: any, pdfBuffer: Buffer, opts: typeof DEFAULTS & RenderOptions): Promise<RenderedPage[]> {
  let doc: any;
  try {
    const u8 = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength);
    doc = mupdf.Document.openDocument(u8, "application/pdf");
  } catch (err: any) {
    throw new PdfRenderError("RENDER_FAILED", `Failed to open PDF: ${err?.message || err}`, err);
  }

  try {
    if (doc.needsPassword()) {
      if (!opts.password) {
        throw new PdfRenderError("PASSWORD_REQUIRED", "PDF is password-protected and no password was provided");
      }
      const result = doc.authenticatePassword(opts.password);
      // mupdf returns 0 on failure, non-zero on success (bitmask of permissions granted).
      if (!result) {
        throw new PdfRenderError("PASSWORD_WRONG", "PDF password is incorrect");
      }
    }

    const totalPages = doc.countPages();
    if (totalPages === 0) {
      throw new PdfRenderError("NO_PAGES", "PDF has no pages");
    }

    const pagesToRender = Math.min(totalPages, opts.maxPages);
    const rendered: RenderedPage[] = [];
    const colorspace = mupdf.ColorSpace.DeviceRGB;

    for (let i = 0; i < pagesToRender; i++) {
      const page = doc.loadPage(i);
      try {
        const bounds = page.getBounds();
        const baseWidth = Math.abs(bounds[2] - bounds[0]);
        const baseHeight = Math.abs(bounds[3] - bounds[1]);
        let scale = opts.scale;
        const pixels = (baseWidth * scale) * (baseHeight * scale);
        if (pixels > opts.maxPixelsPerPage) {
          scale = scale * Math.sqrt(opts.maxPixelsPerPage / pixels);
          console.log(
            `[PdfRenderer] Page ${i + 1}: clamped scale to ${scale.toFixed(2)} to stay under ${opts.maxPixelsPerPage} pixels`
          );
        }

        const matrix = mupdf.Matrix.scale(scale, scale);
        const pixmap: any = await withTimeout(
          Promise.resolve().then(() => page.toPixmap(matrix, colorspace, false)),
          opts.perPageTimeoutMs,
          `PDF page ${i + 1} render`
        );

        try {
          const width = pixmap.getWidth();
          const height = pixmap.getHeight();
          const jpegBytes = pixmap.asJPEG(opts.jpegQuality, false);
          rendered.push({
            pageNumber: i + 1,
            jpegBuffer: Buffer.from(jpegBytes),
            width,
            height,
          });
        } finally {
          try { pixmap.destroy(); } catch {}
        }
      } finally {
        try { page.destroy(); } catch {}
      }
    }

    if (rendered.length === 0) {
      throw new PdfRenderError("NO_PAGES", "PDF rendered zero pages");
    }
    return rendered;
  } catch (err: any) {
    if (err instanceof PdfRenderError) throw err;
    throw new PdfRenderError("RENDER_FAILED", `Page rendering failed: ${err?.message || err}`, err);
  } finally {
    try { doc.destroy(); } catch {}
  }
}

let selfTestPromise: Promise<{ ok: boolean; error?: string }> | null = null;

export async function pdfRendererSelfTest(): Promise<{ ok: boolean; error?: string }> {
  if (selfTestPromise) return selfTestPromise;
  selfTestPromise = (async () => {
    try {
      const mupdf = await loadMupdf();
      // Minimal valid PDF header probe — just verify the module loaded and Matrix/ColorSpace work.
      const m = mupdf.Matrix.scale(1, 1);
      const cs = mupdf.ColorSpace.DeviceRGB;
      if (!m || !cs) return { ok: false, error: "mupdf core objects unavailable" };
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  })();
  return selfTestPromise;
}
