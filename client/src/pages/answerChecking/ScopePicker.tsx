import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { API } from "./answerCheckApi";
import { useScopes } from "./AssessmentSwitch";

export interface Scope {
  board: string;
  medium: string;
  grade: string;
  subject: string;
  chapter: string;
}

export const EMPTY_SCOPE: Scope = { board: "", medium: "", grade: "", subject: "", chapter: "" };

const selectClass = "mt-1 block h-9 w-full min-w-[120px] rounded-md border border-input bg-white px-2 text-[14px] disabled:opacity-50";
const uniq = (xs: string[]) => Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/** A scope is usable once board, medium and grade are chosen (subject and chapter optional unless required). */
export function scopeReady(s: Scope, needSubject = false): boolean {
  return !!(s.board && s.medium && s.grade && (!needSubject || s.subject));
}

/**
 * Board → Medium → Grade → Subject → Chapter, the same choices as the Widget Tester (synced
 * content packs; chapters from the content store). With `anyLabel`, every level may stay on
 * "any" (the Random question then uses Settings); otherwise the first options are chosen.
 */
export function ScopePicker({ value, onChange, anyLabel, needSubject = false }: { value: Scope; onChange: (s: Scope) => void; anyLabel?: string; needSubject?: boolean }) {
  const { scopes, error, loading } = useScopes();
  const boards = useMemo(() => uniq(scopes.map(s => s.board)), [scopes]);
  const mediums = useMemo(() => uniq(scopes.filter(s => s.board === value.board).map(s => s.medium)), [scopes, value.board]);
  const grades = useMemo(() => uniq(scopes.filter(s => s.board === value.board && s.medium === value.medium).map(s => s.grade)), [scopes, value.board, value.medium]);
  const subjects = useMemo(() => uniq(scopes.filter(s => s.board === value.board && s.medium === value.medium && s.grade === value.grade).flatMap(s => s.subjects)), [scopes, value.board, value.medium, value.grade]);
  const chaptersQ = useQuery<{ chapters: string[]; error?: string }>({
    queryKey: [`${API}/chapters?${new URLSearchParams({ board: value.board, medium: value.medium, grade: value.grade, subject: value.subject })}`],
    enabled: !!(value.board && value.medium && value.grade && value.subject),
  });
  const chapters = chaptersQ.data?.chapters ?? [];

  // Without "any", fill each level with its first option (like the Tester).
  useEffect(() => {
    if (anyLabel || !scopes.length) return;
    const next = { ...value };
    if (!next.board || !boards.includes(next.board)) next.board = boards[0] ?? "";
    const ms = uniq(scopes.filter(s => s.board === next.board).map(s => s.medium));
    if (!next.medium || !ms.includes(next.medium)) next.medium = ms[0] ?? "";
    const gs = uniq(scopes.filter(s => s.board === next.board && s.medium === next.medium).map(s => s.grade));
    if (!next.grade || !gs.includes(next.grade)) next.grade = gs[0] ?? "";
    const ss = uniq(scopes.filter(s => s.board === next.board && s.medium === next.medium && s.grade === next.grade).flatMap(s => s.subjects));
    if (needSubject && (!next.subject || !ss.includes(next.subject))) next.subject = ss[0] ?? "";
    if (JSON.stringify(next) !== JSON.stringify(value)) onChange(next);
  }, [scopes, value.board, value.medium, value.grade, value.subject]);

  if (loading) return <p className="text-[14px] text-gray-500">Loading the classes and subjects…</p>;
  if (error) return <p className="text-[14px] text-red-600">{error}</p>;
  if (!scopes.length) return <p className="text-[14px] text-gray-500" data-testid="scope-empty">This account has no synced curriculum yet (Ext. Content).</p>;

  const any = (label: string) => anyLabel ? <option value="">{label}</option> : null;
  const set = (patch: Partial<Scope>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="scope-picker">
      <label className="text-[13px] font-medium text-gray-700">Board
        <select className={selectClass} value={value.board} onChange={e => set({ board: e.target.value, medium: "", grade: "", subject: "", chapter: "" })} data-testid="scope-board">
          {any(anyLabel!)}{boards.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label className="text-[13px] font-medium text-gray-700">Medium
        <select className={selectClass} value={value.medium} disabled={!value.board} onChange={e => set({ medium: e.target.value, grade: "", subject: "", chapter: "" })} data-testid="scope-medium">
          {any("Any")}{mediums.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="text-[13px] font-medium text-gray-700">Grade
        <select className={selectClass} value={value.grade} disabled={!value.medium} onChange={e => set({ grade: e.target.value, subject: "", chapter: "" })} data-testid="scope-grade">
          {any("Any")}{grades.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </label>
      <label className="text-[13px] font-medium text-gray-700">Subject{needSubject && <span className="font-normal text-gray-400"> (required)</span>}
        <select className={selectClass} value={value.subject} disabled={!value.grade} onChange={e => set({ subject: e.target.value, chapter: "" })} data-testid="scope-subject">
          {!needSubject && <option value="">All subjects</option>}{subjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="text-[13px] font-medium text-gray-700">Chapter
        <select className={selectClass} value={value.chapter} disabled={!value.subject || chaptersQ.isLoading} onChange={e => set({ chapter: e.target.value })} data-testid="scope-chapter">
          <option value="">{chaptersQ.isLoading ? "Loading…" : "All chapters"}</option>
          {chapters.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    </div>
  );
}
