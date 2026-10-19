import { useEffect, useMemo, useRef } from "react";
import katex from "katex";
import type { BoardElement, BoardHighlight, BoardState, DiagramOp } from "@shared/tutorBoard";

/**
 * AI Tutor — the live board (a dark chalk board in every theme, like a classroom).
 * Renders the shared board model; anything that appears for the first time is "written in"
 * (handwriting wipe, diagram strokes drawn, figures fading in), so it feels like the tutor is
 * writing while speaking. Highlights act as the teacher's pointer.
 */

const FONT_ID = "tutor-board-font";
function ensureFont() {
  if (typeof document === "undefined" || document.getElementById(FONT_ID)) return;
  const link = document.createElement("link");
  link.id = FONT_ID;
  link.rel = "stylesheet";
  // Kalam: handwriting with Latin + Devanagari, so Hindi words look written too.
  link.href = "https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=swap";
  document.head.appendChild(link);
}

const COLORS: Record<string, string> = { ink: "#f3f1e9", blue: "#8fd3ff", red: "#ff9db4", green: "#9ff0b8", yellow: "#ffd76a" };

function useNewIds(board: BoardState): Set<string> {
  const seen = useRef<{ page: number; ids: Set<string> }>({ page: -1, ids: new Set() });
  return useMemo(() => {
    if (seen.current.page !== board.page) seen.current = { page: board.page, ids: new Set() };
    const fresh = new Set<string>();
    for (const el of board.elements) if (!seen.current.ids.has(el.id)) { fresh.add(el.id); seen.current.ids.add(el.id); }
    return fresh;
  }, [board]);
}

function wipeMs(text: string) {
  return Math.min(1800, 250 + text.length * 45);
}

function Highlight({ h }: { h?: BoardHighlight }) {
  if (!h || h.part) return null;
  if (h.mode === "underline") return <span className="tb-underline" aria-hidden="true" />;
  if (h.mode === "arrow") return <span className="tb-arrow" aria-hidden="true">➜</span>;
  return <span className="tb-circle" aria-hidden="true" />;
}

function MathView({ tex }: { tex: string }) {
  const html = useMemo(() => {
    try { return katex.renderToString(tex, { throwOnError: false, trust: false, displayMode: true, output: "html" }); }
    catch { return null; }
  }, [tex]);
  return html ? <div className="tb-math" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="tb-text">{tex}</div>;
}

function FlowView({ d, h }: { d: Extract<DiagramOp, { kind: "flow" }>; h?: BoardHighlight }) {
  // Simple layered layout: a node's level = longest path from a source.
  const level = new Map<string, number>(d.nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < d.nodes.length; i++) for (const e of d.edges) level.set(e.to, Math.max(level.get(e.to) ?? 0, (level.get(e.from) ?? 0) + 1));
  const rows: string[][] = [];
  for (const n of d.nodes) (rows[level.get(n.id) ?? 0] ||= []).push(n.id);
  const W = 520, rowH = 78, boxW = 150, boxH = 40;
  const pos = new Map<string, { x: number; y: number }>();
  rows.forEach((ids, r) => ids.forEach((id, i) => pos.set(id, { x: ((i + 1) * W) / (ids.length + 1), y: 30 + r * rowH })));
  const H = 30 + (rows.length - 1) * rowH + boxH + 20;
  const label = (id: string) => d.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tb-svg" role="img" aria-label={d.title || "diagram"}>
      <defs><marker id={`ah-${d.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={COLORS.ink} /></marker></defs>
      {d.edges.map((e, i) => {
        const a = pos.get(e.from)!, b = pos.get(e.to)!;
        return (
          <g key={i}>
            <line className="tb-stroke" x1={a.x} y1={a.y + boxH / 2} x2={b.x} y2={b.y - boxH / 2 - 2} stroke={COLORS.ink} strokeWidth={2.5} markerEnd={`url(#ah-${d.id})`} />
            {e.label && <text x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2} fill={COLORS.yellow} fontSize={15} className="tb-hand">{e.label}</text>}
          </g>
        );
      })}
      {d.nodes.map((n) => {
        const p = pos.get(n.id)!; const on = h?.target === d.id && h.part === n.id;
        return (
          <g key={n.id}>
            <rect className="tb-stroke" x={p.x - boxW / 2} y={p.y - boxH / 2} width={boxW} height={boxH} rx={10} fill="rgba(255,255,255,0.04)" stroke={on ? COLORS.yellow : COLORS.blue} strokeWidth={on ? 4 : 2.5} />
            <text x={p.x} y={p.y + 6} textAnchor="middle" fill={COLORS.ink} fontSize={17} className="tb-hand">{label(n.id)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function GeometryView({ d, h }: { d: Extract<DiagramOp, { kind: "geometry" }>; h?: BoardHighlight }) {
  const S = 34, pad = 28; // 0–10 grid → 340 px
  const P = (k: string) => { const [x, y] = d.points[k]; return { x: pad + x * S, y: pad + (10 - y) * S }; };
  const pts = Object.keys(d.points);
  const cx = pts.reduce((n, k) => n + P(k).x, 0) / pts.length, cy = pts.reduce((n, k) => n + P(k).y, 0) / pts.length;
  const neighbours = (k: string) => d.segments.filter(([a, b]) => a === k || b === k).map(([a, b]) => (a === k ? b : a));
  const hi = h?.target === d.id ? h.part : undefined;
  return (
    <svg viewBox={`0 0 ${pad * 2 + 10 * S} ${pad * 2 + 10 * S}`} className="tb-svg tb-geo" role="img" aria-label={d.title || "geometry"}>
      {d.segments.map(([a, b], i) => {
        const p = P(a), q = P(b); const on = hi === `${a}-${b}` || hi === `${b}-${a}`;
        return (
          <g key={i}>
            {on && <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={COLORS.yellow} strokeWidth={14} strokeLinecap="round" opacity={0.35} className="tb-pulse" />}
            <line className="tb-stroke" x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={COLORS.ink} strokeWidth={3} strokeLinecap="round" />
          </g>
        );
      })}
      {d.angles.map((a, i) => {
        const p = P(a.at); const nb = neighbours(a.at).slice(0, 2);
        if (nb.length < 2) return null;
        const u = nb.map((k) => { const q = P(k); const len = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: (q.x - p.x) / len, y: (q.y - p.y) / len }; });
        const r = 18;
        if (a.mark === "right") {
          const c1 = { x: p.x + u[0].x * r, y: p.y + u[0].y * r }, c3 = { x: p.x + u[1].x * r, y: p.y + u[1].y * r };
          const c2 = { x: c1.x + u[1].x * r, y: c1.y + u[1].y * r };
          return <polyline key={i} points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${c3.x},${c3.y}`} fill="none" stroke={COLORS.yellow} strokeWidth={2.5} />;
        }
        const s = { x: p.x + u[0].x * 26, y: p.y + u[0].y * 26 }, e = { x: p.x + u[1].x * 26, y: p.y + u[1].y * 26 };
        return (
          <g key={i}>
            <path d={`M${s.x},${s.y} A26,26 0 0,1 ${e.x},${e.y}`} fill="none" stroke={COLORS.yellow} strokeWidth={2.5} />
            {a.label && <text x={p.x + (u[0].x + u[1].x) * 22} y={p.y + (u[0].y + u[1].y) * 22 + 5} fill={COLORS.yellow} fontSize={15} className="tb-hand">{a.label}</text>}
          </g>
        );
      })}
      {d.sideLabels.map((l, i) => {
        const p = P(l.from), q = P(l.to); const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        const dx = mx - cx, dy = my - cy; const len = Math.hypot(dx, dy) || 1;
        return <text key={i} x={mx + (dx / len) * 22} y={my + (dy / len) * 22 + 6} textAnchor="middle" fill={COLORS.red} fontSize={19} fontWeight={700} className="tb-hand">{l.text}</text>;
      })}
      {pts.map((k) => {
        const p = P(k); const dx = p.x - cx, dy = p.y - cy; const len = Math.hypot(dx, dy) || 1;
        return (
          <g key={k}>
            <circle cx={p.x} cy={p.y} r={hi === k ? 9 : 3.5} fill={hi === k ? COLORS.yellow : COLORS.ink} className={hi === k ? "tb-pulse" : undefined} />
            <text x={p.x + (dx / len) * 18} y={p.y + (dy / len) * 18 + 6} textAnchor="middle" fill={COLORS.blue} fontSize={18} fontWeight={700} className="tb-hand">{k}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ElementView({ el, fresh, h }: { el: BoardElement; fresh: boolean; h?: BoardHighlight }) {
  const cls = `tb-el${fresh ? " tb-fresh" : ""}${h && !h.part ? " tb-pointed" : ""}`;
  if (el.op === "write") {
    const style = { color: COLORS[el.color] ?? COLORS.ink, ["--wipe" as any]: `${wipeMs(el.text)}ms` };
    return (
      <div className={`${cls} tb-write tb-${el.style}`} style={style}>
        <span className="tb-wipe">{el.text}</span>
        <Highlight h={h} />
      </div>
    );
  }
  if (el.op === "math") {
    return <div className={`${cls} tb-wipe-block`} style={{ ["--wipe" as any]: `${wipeMs(el.tex)}ms` }}><MathView tex={el.tex} /><Highlight h={h} /></div>;
  }
  if (el.op === "image") {
    return (
      <figure className={`${cls} tb-figure`}>
        {el.src ? <img src={el.src} alt={el.caption || "figure from the chapter"} loading="lazy" /> : null}
        {el.caption && <figcaption className="tb-hand">{el.caption}</figcaption>}
        <Highlight h={h} />
      </figure>
    );
  }
  if (el.op === "diagram") {
    return (
      <div className={`${cls} tb-diagram`}>
        {el.title && <div className="tb-hand tb-dtitle">{el.title}</div>}
        {el.kind === "flow" && <FlowView d={el} h={h} />}
        {el.kind === "geometry" && <GeometryView d={el} h={h} />}
        {el.kind === "table" && (
          <div className="tb-tablewrap">
            <table className="tb-table">
              <thead><tr>{el.header.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
              <tbody>{el.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
        <Highlight h={h} />
      </div>
    );
  }
  return null;
}

export function TutorBoard({ board, className, emptyText = "The board is ready." }: { board: BoardState; className?: string; emptyText?: string }) {
  useEffect(ensureFont, []);
  const fresh = useNewIds(board);
  const scroller = useRef<HTMLDivElement>(null);
  const highlight = board.highlights[0];
  // Keep the newest writing (or what the tutor points at) in view.
  useEffect(() => {
    const box = scroller.current; if (!box) return;
    const target = (highlight && box.querySelector(`[data-el="${highlight.target}"]`)) || box.lastElementChild;
    if (target && "scrollIntoView" in target) (target as HTMLElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [board, highlight]);

  return (
    <div className={`tutor-board ${className ?? ""}`} data-testid="tutor-board">
      <style>{BOARD_CSS}</style>
      <div className="tb-page" key={board.page} ref={scroller}>
        {board.elements.length === 0 ? <div className="tb-empty tb-hand">{emptyText}</div> : board.elements.map((el) => (
          <div key={el.id} data-el={el.id}>
            <ElementView el={el} fresh={fresh.has(el.id)} h={highlight?.target === el.id ? highlight : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}

const BOARD_CSS = `
.tutor-board{position:relative;background:#1f2e2b;border:8px solid #5b4636;border-radius:14px;box-shadow:inset 0 0 50px rgba(0,0,0,.35);color:#f3f1e9;overflow:hidden;min-height:220px;display:flex}
.tutor-board .tb-page{flex:1;overflow-y:auto;padding:16px 18px 22px;display:flex;flex-direction:column;gap:10px;animation:tb-page .35s ease-out}
.tutor-board .tb-hand,.tutor-board .tb-write{font-family:Kalam,"Comic Sans MS",cursive}
.tutor-board .tb-el{position:relative;max-width:100%}
.tutor-board .tb-title{font-size:1.6em;font-weight:700;color:#ffd76a !important;line-height:1.2}
.tutor-board .tb-body{font-size:1.2em;line-height:1.35}
.tutor-board .tb-note{font-size:1em;opacity:.85}
.tutor-board .tb-math{font-size:1.15em;overflow-x:auto;overflow-y:hidden}
.tutor-board .tb-math .katex{color:#f3f1e9}
.tutor-board .tb-figure{margin:0;display:inline-flex;flex-direction:column;gap:4px;align-self:flex-start;background:#f7f5ee;border-radius:8px;padding:6px}
.tutor-board .tb-figure img{max-height:220px;max-width:100%;object-fit:contain;border-radius:4px}
.tutor-board .tb-figure figcaption{color:#2b2b2b;font-size:.95em;text-align:center}
.tutor-board .tb-svg{width:100%;max-width:520px;height:auto;display:block}
.tutor-board .tb-geo{max-width:300px}
.tutor-board .tb-dtitle{color:#ffd76a;font-size:1.05em}
.tutor-board .tb-tablewrap{overflow-x:auto}
.tutor-board .tb-table{border-collapse:collapse;font-family:Kalam,cursive;font-size:1.02em}
.tutor-board .tb-table th,.tutor-board .tb-table td{border:2px solid rgba(243,241,233,.55);padding:4px 10px;text-align:left}
.tutor-board .tb-table th{color:#ffd76a}
.tutor-board .tb-empty{opacity:.6;font-size:1.1em;margin:auto}
.tutor-board .tb-circle{position:absolute;inset:-6px -10px;border:3px solid #ffd76a;border-radius:50%;pointer-events:none;animation:tb-pulse 1.4s ease-in-out 3}
.tutor-board .tb-underline{position:absolute;left:0;right:0;bottom:-4px;height:3px;background:#ffd76a;border-radius:2px;animation:tb-grow .5s ease-out}
.tutor-board .tb-arrow{position:absolute;left:-26px;top:50%;transform:translateY(-50%);color:#ffd76a;font-size:1.3em;animation:tb-nudge .8s ease-in-out 3}
.tutor-board .tb-pulse{animation:tb-pulse 1.4s ease-in-out 3}
.tutor-board .tb-fresh .tb-wipe,.tutor-board .tb-fresh.tb-wipe-block{display:inline-block;animation:tb-wipe var(--wipe,900ms) steps(24,end) both}
.tutor-board .tb-fresh .tb-stroke{stroke-dasharray:900;stroke-dashoffset:900;animation:tb-draw 1.1s ease-out forwards}
.tutor-board .tb-fresh.tb-figure,.tutor-board .tb-fresh.tb-diagram{animation:tb-fade .6s ease-out both}
@keyframes tb-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes tb-draw{to{stroke-dashoffset:0}}
@keyframes tb-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes tb-pulse{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes tb-grow{from{transform:scaleX(0);transform-origin:left}to{transform:scaleX(1)}}
@keyframes tb-nudge{0%,100%{transform:translate(0,-50%)}50%{transform:translate(6px,-50%)}}
@keyframes tb-page{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.tutor-board *{animation:none !important}}
`;
