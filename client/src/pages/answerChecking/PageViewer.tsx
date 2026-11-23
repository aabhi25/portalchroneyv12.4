import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCw, X } from "lucide-react";

export interface ViewerPage { src: string; label: string }

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Opens pages over the current screen instead of in a new tab: `open(pages, start)` from a click,
 * and `viewer` somewhere in the component's output.
 */
export function usePageViewer(): { open: (pages: ViewerPage[], start?: number) => void; viewer: ReactNode } {
  const [shown, setShown] = useState<{ pages: ViewerPage[]; start: number } | null>(null);
  const open = useCallback((pages: ViewerPage[], start = 0) => { if (pages.length) setShown({ pages, start: clamp(start, 0, pages.length - 1) }); }, []);
  return { open, viewer: shown ? <PageViewer pages={shown.pages} start={shown.start} onClose={() => setShown(null)} /> : null };
}

/**
 * An answer sheet's pages, full screen: zoom (buttons, pinch, Ctrl + scroll, double-click), drag to
 * move, turn a sideways photo (for viewing only), and go from page to page.
 */
export function PageViewer({ pages, start, onClose }: { pages: ViewerPage[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  // Zoom 1 = the whole page fits; x / y move it from the centre.
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [turns, setTurns] = useState<Record<number, number>>({});
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const page = pages[index];
  const turn = turns[index] ?? 0;
  const sideways = turn % 180 !== 0;

  const fit = natural && room.w && room.h
    ? Math.min(room.w / (sideways ? natural.h : natural.w), room.h / (sideways ? natural.w : natural.h))
    : 0;
  const size = { w: (natural?.w ?? 0) * fit, h: (natural?.h ?? 0) * fit };
  const onScreen = sideways ? { w: size.h, h: size.w } : size;

  /** Keeps the page from being moved out of sight. */
  const bound = useCallback((v: { zoom: number; x: number; y: number }) => {
    const overX = Math.max(0, (onScreen.w * v.zoom - room.w) / 2);
    const overY = Math.max(0, (onScreen.h * v.zoom - room.h) / 2);
    return { zoom: v.zoom, x: clamp(v.x, -overX, overX), y: clamp(v.y, -overY, overY) };
  }, [onScreen.w, onScreen.h, room.w, room.h]);

  /** Zooms by `by`, keeping the point at (cx, cy) — from the centre of the stage — where it is. */
  const zoomBy = useCallback((by: number, cx = 0, cy = 0) => {
    setView(v => {
      const zoom = clamp(v.zoom * by, MIN_ZOOM, MAX_ZOOM);
      const k = zoom / v.zoom;
      return bound({ zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
    });
  }, [bound]);

  const go = useCallback((to: number) => {
    if (to < 0 || to >= pages.length) return;
    setIndex(to);
    setNatural(null);
    setView({ zoom: 1, x: 0, y: 0 });
  }, [pages.length]);

  /** Fills the width, starting at the top of the page (a tall page is hard to read when it fits whole). */
  const fillWidth = () => {
    if (!onScreen.w) return;
    const zoom = clamp(room.w / onScreen.w, MIN_ZOOM, MAX_ZOOM);
    setView(bound({ zoom, x: 0, y: (onScreen.h * zoom - room.h) / 2 }));
  };

  useEffect(() => {
    if (!stage) return;
    const measure = () => setRoom({ w: stage.clientWidth, h: stage.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage]);
  useEffect(() => { setView(v => bound(v)); }, [bound]);

  // Not passive, so the browser's own page zoom and back-swipe don't take over.
  useEffect(() => {
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const box = stage.getBoundingClientRect();
        zoomBy(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.008)), e.clientX - box.left - box.width / 2, e.clientY - box.top - box.height / 2);
      } else {
        const step = e.deltaMode ? 20 : 1;
        setView(v => bound({ ...v, x: v.x - e.deltaX * step, y: v.y - e.deltaY * step }));
      }
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [stage, zoomBy, bound]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "PageDown") go(index + 1);
    else if (e.key === "ArrowLeft" || e.key === "PageUp") go(index - 1);
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(1 / 1.25);
    else if (e.key === "0") setView({ zoom: 1, x: 0, y: 0 });
    else if (e.key === "ArrowUp") setView(v => bound({ ...v, y: v.y + 80 }));
    else if (e.key === "ArrowDown") setView(v => bound({ ...v, y: v.y - 80 }));
    else return;
    e.preventDefault();
  }

  function fromCentre(e: { clientX: number; clientY: number }) {
    const box = stage!.getBoundingClientRect();
    return { x: e.clientX - box.left - box.width / 2, y: e.clientY - box.top - box.height / 2 };
  }

  function onPointerDown(e: React.PointerEvent) {
    stage?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, fromCentre(e));
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    const was = pointers.current.get(e.pointerId);
    if (!was) return;
    const now = fromCentre(e);
    const other = Array.from(pointers.current.entries()).find(([id]) => id !== e.pointerId)?.[1];
    pointers.current.set(e.pointerId, now);
    if (other) {
      // Two fingers: zoom around the point between them.
      const apart = (p: { x: number; y: number }) => Math.hypot(p.x - other.x, p.y - other.y);
      if (apart(was) > 0) zoomBy(apart(now) / apart(was), (now.x + other.x) / 2, (now.y + other.y) / 2);
    } else {
      setView(v => bound({ ...v, x: v.x + now.x - was.x, y: v.y + now.y - was.y }));
    }
  }
  function onPointerEnd(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) setDragging(false);
  }

  const tool = "grid h-9 min-w-9 place-items-center rounded-full px-2 text-[13px] font-medium text-white hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <DialogPrimitive.Root open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-gray-950/95" />
        <DialogPrimitive.Content className="fixed inset-0 z-[70] flex flex-col outline-none" onKeyDown={onKeyDown} aria-describedby={undefined} data-testid="page-viewer">
          <div className="flex flex-wrap items-center gap-1 px-3 py-2 text-white">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate px-1 text-[14px] font-medium" data-testid="viewer-label">{page.label}{pages.length > 1 && <span className="ml-2 text-white/60">{index + 1} of {pages.length}</span>}</DialogPrimitive.Title>
            <DialogPrimitive.Close className={`${tool} sm:order-last`} aria-label="Close" title="Close (Esc)" data-testid="viewer-close"><X className="h-5 w-5" /></DialogPrimitive.Close>
            <div className="flex w-full items-center justify-center gap-1 sm:w-auto">
              <button type="button" className={tool} onClick={() => zoomBy(1 / 1.25)} disabled={view.zoom <= MIN_ZOOM} aria-label="Zoom out" title="Zoom out" data-testid="viewer-zoom-out"><Minus className="h-4 w-4" /></button>
              <span className="w-12 text-center text-[13px] tabular-nums text-white/80" data-testid="viewer-zoom">{Math.round(view.zoom * 100)}%</span>
              <button type="button" className={tool} onClick={() => zoomBy(1.25)} disabled={view.zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in" data-testid="viewer-zoom-in"><Plus className="h-4 w-4" /></button>
              <button type="button" className={tool} onClick={() => setView({ zoom: 1, x: 0, y: 0 })} data-testid="viewer-fit">Whole page</button>
              <button type="button" className={tool} onClick={fillWidth} data-testid="viewer-width">Full width</button>
              <button type="button" className={tool} onClick={() => { setTurns({ ...turns, [index]: (turn + 90) % 360 }); setView({ zoom: 1, x: 0, y: 0 }); }} aria-label="Turn the page" title="Turn the page" data-testid="viewer-turn"><RotateCw className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1">
            {pages.length > 1 && (
              <div className="hidden w-[104px] shrink-0 space-y-2 overflow-y-auto p-2 sm:block" data-testid="viewer-pages">
                {pages.map((p, i) => (
                  <button key={p.src} type="button" onClick={() => go(i)} aria-current={i === index} className={`block w-full rounded-lg p-1 text-[11px] text-white/80 ${i === index ? "bg-white/20" : "hover:bg-white/10"}`}>
                    <img src={p.src} alt="" className="h-20 w-full rounded object-contain" draggable={false} />{p.label}
                  </button>
                ))}
              </div>
            )}
            <div
              ref={setStage}
              className={`relative min-w-0 flex-1 touch-none select-none overflow-hidden ${dragging ? "cursor-grabbing" : view.zoom > 1 ? "cursor-grab" : "cursor-zoom-in"}`}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
              onDoubleClick={e => { const p = fromCentre(e); if (view.zoom > 1.05) setView({ zoom: 1, x: 0, y: 0 }); else zoomBy(2.5, p.x, p.y); }}
              data-testid="viewer-stage"
            >
              <img
                key={page.src}
                src={page.src}
                alt={page.label}
                draggable={false}
                onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                className="absolute left-1/2 top-1/2 max-w-none"
                style={{ width: size.w || undefined, height: size.h || undefined, visibility: fit ? "visible" : "hidden", transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom}) rotate(${turn}deg)` }}
                data-testid="viewer-image"
              />
            </div>
            {pages.length > 1 && (
              <>
                <button type="button" onClick={() => go(index - 1)} disabled={index === 0} className="absolute bottom-4 left-4 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-30 sm:bottom-auto sm:left-[116px] sm:top-1/2 sm:-translate-y-1/2" aria-label="Previous page" data-testid="viewer-prev"><ChevronLeft className="h-6 w-6" /></button>
                <button type="button" onClick={() => go(index + 1)} disabled={index === pages.length - 1} className="absolute bottom-4 right-4 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-30 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2" aria-label="Next page" data-testid="viewer-next"><ChevronRight className="h-6 w-6" /></button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
