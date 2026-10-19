import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Loader2, Pause, Play, RotateCcw, Sparkles } from "lucide-react";
import { applyOps, emptyBoard, type BoardOp, type BoardState } from "@shared/tutorBoard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TutorBoard } from "./TutorBoard";

type Outline = { title: string; intro: string[]; sections: Array<{ id: string; title: string; goal: string; sourceIds: string[]; questionIds: string[]; mediaIds: string[] }>; recap: string[] };
type Line = { say: string; ops: BoardOp[] };
type Check = { id: string; prompt: string; options: string[]; correctIndex: number; solution: string | null };
type Section = { lines: Line[]; simpler: Line[]; checks: Check[] };
type PackSummary = { chapter: string; sources: number; questions: number; usableChecks: number; figures: number };

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error || "Request failed");
  return json as T;
}

/**
 * Widget Tester: preview the lesson the AI tutor would teach for the selected chapter — the
 * outline, then each section line by line with the board filling in (optionally read aloud by
 * the browser). For judging lesson quality per chapter; the plans are the ones real sessions use.
 */
export function LessonPreview({ scope }: { scope: { board: string; medium: string; grade: string; subject: string; chapter: string } }) {
  const [language, setLanguage] = useState<"en" | "hi" | "hinglish">("en");
  const [outline, setOutline] = useState<Outline | null>(null);
  const [pack, setPack] = useState<PackSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<"" | "outline" | "section">("");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [section, setSection] = useState<Section | null>(null);
  const [useSimpler, setUseSimpler] = useState(false);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(false);

  const scopeKey = JSON.stringify(scope);
  useEffect(() => { setOutline(null); setPack(null); setSection(null); setError(""); setStep(0); stop(); }, [scopeKey, language]);

  const lines = section ? (useSimpler ? section.simpler : section.lines) : [];
  const board: BoardState = useMemo(() => {
    let b = emptyBoard();
    for (let i = 0; i < Math.min(step, lines.length); i++) b = applyOps(b, lines[i].ops);
    return b;
  }, [lines, step]);

  const planLesson = async () => {
    setLoading("outline"); setError("");
    try {
      const r = await post<{ pack: PackSummary; outline: Outline }>("/api/topscholar/tutor/preview-outline", { ...scope, language });
      setPack(r.pack); setOutline(r.outline); setSection(null);
      await loadSection(0);
    } catch (e: any) { setError(e.message); } finally { setLoading(""); }
  };
  const loadSection = async (i: number) => {
    setLoading("section"); setError(""); stop(); setSectionIndex(i); setStep(0); setUseSimpler(false);
    try {
      const r = await post<{ section: Section }>("/api/topscholar/tutor/preview-section", { ...scope, language, sectionIndex: i });
      setSection(r.section);
    } catch (e: any) { setError(e.message); setSection(null); } finally { setLoading(""); }
  };

  function stop() {
    playRef.current = false; setPlaying(false);
    try { window.speechSynthesis?.cancel(); } catch { /* no voice */ }
  }
  const speak = (text: string) => new Promise<void>((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) { setTimeout(resolve, 600 + text.split(/\s+/).length * 320); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = language === "en" ? "en-IN" : "hi-IN";
    const voice = synth.getVoices().find((v) => v.lang === u.lang);
    if (voice) u.voice = voice;
    const guard = setTimeout(resolve, 3000 + text.length * 120);
    u.onend = u.onerror = () => { clearTimeout(guard); resolve(); };
    synth.speak(u);
  });
  const play = async () => {
    if (!lines.length) return;
    playRef.current = true; setPlaying(true);
    for (let i = step >= lines.length ? 0 : step; i < lines.length && playRef.current; i++) {
      setStep(i + 1); // the board shows this line's ops as it is said
      await speak(lines[i].say);
    }
    playRef.current = false; setPlaying(false);
  };

  const current = step > 0 ? lines[step - 1] : null;

  return (
    <Card data-testid="card-lesson-preview">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-teal-600" /> AI tutor — lesson preview</CardTitle>
        <div className="flex items-center gap-2">
          <select value={language} onChange={(e) => setLanguage(e.target.value as any)} className="h-8 rounded-md border px-2 text-sm bg-background" aria-label="Lesson language">
            <option value="en">English</option>
            <option value="hinglish">Hinglish</option>
            <option value="hi">Hindi</option>
          </select>
          <Button size="sm" onClick={planLesson} disabled={loading !== ""} data-testid="button-plan-lesson">
            {loading === "outline" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <BookOpen className="w-4 h-4 mr-1" />}
            {outline ? "Plan again" : "Plan this lesson"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!outline && !error && loading === "" && (
          <p className="text-sm text-muted-foreground">See the lesson the tutor would teach for <strong>{scope.chapter}</strong>: built only from this chapter's synced content. The first plan takes a few seconds; after that it is saved and shared by every student.</p>
        )}
        {error && <p className="text-sm text-red-600" data-testid="text-lesson-error">{error}</p>}
        {pack && (
          <p className="text-xs text-muted-foreground" data-testid="text-lesson-pack">
            Teaching from {pack.sources} note/transcript passages · {pack.figures} figures · {pack.usableChecks} of {pack.questions} questions usable as quick checks.
          </p>
        )}
        {outline && (
          <div className="space-y-2">
            <p className="font-semibold">{outline.title}</p>
            <p className="text-sm text-muted-foreground">Hello: “{outline.intro.join(" ")}”</p>
            <div className="flex flex-wrap gap-2">
              {outline.sections.map((s, i) => (
                <Button key={s.id} size="sm" variant={i === sectionIndex ? "default" : "outline"} onClick={() => loadSection(i)} disabled={loading !== ""} data-testid={`button-section-${i}`}>
                  {i + 1}. {s.title}
                </Button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">Recap: “{outline.recap.join(" ")}”</p>
          </div>
        )}
        {loading === "section" && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Preparing this section…</p>}
        {section && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => { stop(); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0} aria-label="Previous line"><ChevronLeft className="w-4 h-4" /></Button>
                {playing ? (
                  <Button size="sm" onClick={stop}><Pause className="w-4 h-4 mr-1" /> Pause</Button>
                ) : (
                  <Button size="sm" onClick={play} data-testid="button-play-section"><Play className="w-4 h-4 mr-1" /> {step >= lines.length && step > 0 ? "Replay" : "Play with voice"}</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => { stop(); setStep((s) => Math.min(lines.length, s + 1)); }} disabled={step >= lines.length} aria-label="Next line"><ChevronRight className="w-4 h-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => { stop(); setStep(0); }}><RotateCcw className="w-4 h-4 mr-1" /> Restart</Button>
                <label className="flex items-center gap-1.5 text-sm ml-auto">
                  <input type="checkbox" checked={useSimpler} onChange={(e) => { stop(); setUseSimpler(e.target.checked); setStep(0); }} />
                  “I didn't get it” version
                </label>
              </div>
              <ol className="space-y-1.5 text-sm max-h-[340px] overflow-y-auto pr-1">
                {lines.map((l, i) => (
                  <li key={i} className={`rounded-md px-2 py-1 ${i === step - 1 ? "bg-teal-50 dark:bg-teal-950 font-medium" : i < step ? "text-muted-foreground" : ""}`}>
                    <span className="text-xs text-muted-foreground mr-1">{i + 1}.</span>{l.say}
                    {l.ops.length > 0 && <span className="ml-1 text-[11px] text-teal-700 dark:text-teal-300">[{l.ops.map((o) => o.op).join(", ")}]</span>}
                  </li>
                ))}
              </ol>
              {section.checks.length > 0 && (
                <div className="rounded-lg border p-3 text-sm space-y-1">
                  <p className="font-medium">Quick check{section.checks.length > 1 ? "s" : ""} (from the question bank)</p>
                  {section.checks.map((c) => (
                    <div key={c.id}>
                      <p>{c.prompt}</p>
                      <ul className="list-disc pl-5">{c.options.map((o, i) => <li key={i} className={i === c.correctIndex ? "text-green-700 dark:text-green-400 font-medium" : ""}>{o}{i === c.correctIndex ? " ✓" : ""}</li>)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2 min-w-0">
              <TutorBoard board={board} className="h-[380px]" emptyText="Press Play — the board fills in as each line is said." />
              <p className="text-sm min-h-[2.5em]" aria-live="polite">{current ? `🗣 ${current.say}` : ""}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
