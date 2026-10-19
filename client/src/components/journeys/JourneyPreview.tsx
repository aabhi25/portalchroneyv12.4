import { useEffect, useRef, useState } from "react";
import { CalendarDays, RotateCcw, Send, ShoppingBag } from "lucide-react";
import { DEFAULT_ENDING_TEXT, type JourneyModel } from "./journeyModel";

interface Line {
  from: "bot" | "you";
  text: string;
}

/**
 * A small chat that plays the journey the way visitors get it: same order, same "only when an
 * earlier answer leads here" skipping and the same option paths (forward only, like the server).
 * The builder owner taps options or types answers to try every path before going live.
 */
export function JourneyPreview({ model, aiWords }: { model: JourneyModel; aiWords: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [typed, setTyped] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const { questions } = model;

  const firstFrom = (start: number) => {
    for (let i = start; i < questions.length; i++) if (!questions[i].onlyWhenLed) return i;
    return null;
  };

  const ask = (index: number | null, before: Line[]) => {
    if (index === null) {
      setLines([...before, { from: "bot", text: model.ending?.message || DEFAULT_ENDING_TEXT }]);
      setCurrent(null);
      setDone(true);
      return;
    }
    setLines([...before, { from: "bot", text: questions[index].text || "(question without words yet)" }]);
    setCurrent(index);
    setDone(false);
  };

  const restart = () => {
    setTyped("");
    ask(firstFrom(0), []);
  };

  // Start over whenever the journey changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(restart, [model]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const answer = (text: string) => {
    if (current === null) return;
    const q = questions[current];
    const withAnswer: Line[] = [...lines, { from: "you", text: text || "Skipped" }];
    const option = q.kind === "choice" ? q.options.find(o => o.label === text) : undefined;
    if (option?.then.kind === "end") {
      setLines([...withAnswer, { from: "bot", text: option.then.message }]);
      setCurrent(null);
      setDone(true);
      return;
    }
    if (option?.then.kind === "goto") {
      const target = option.then.stepId;
      const index = questions.findIndex(x => x.id === target);
      if (index > current) return ask(index, withAnswer);
    }
    ask(firstFrom(current + 1), withAnswer);
  };

  const q = current !== null ? questions[current] : null;
  const needsTyping = q && (q.kind === "short" || q.kind === "name" || q.kind === "mobile" || q.kind === "email" || q.kind === "number" || q.kind === "date");

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-white" data-testid="journey-preview">
      <div className="flex items-center justify-between border-b border-black/[0.06] px-3 py-2">
        <div>
          <p className="text-[13px] font-semibold text-gray-900">Try it</p>
          <p className="text-[11px] text-gray-500">{aiWords ? "The AI will say these in its own words" : "Exactly what visitors see"}</p>
        </div>
        <button type="button" onClick={restart} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-purple-700 hover:bg-purple-50" data-testid="button-preview-restart">
          <RotateCcw className="h-3.5 w-3.5" /> Start again
        </button>
      </div>
      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto bg-gray-50/60 p-3" style={{ minHeight: 260, maxHeight: 460 }}>
        {questions.length === 0 && <p className="py-10 text-center text-[12px] text-gray-400">Add a question to try the journey here.</p>}
        {lines.map((l, i) => (
          <div key={i} className={`flex ${l.from === "you" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-snug ${l.from === "you" ? "bg-purple-600 text-white" : "bg-white text-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"}`}>
              {l.text}
            </div>
          </div>
        ))}
        {q?.kind === "choice" && (
          <div className="flex flex-wrap gap-1.5 pl-1">
            {q.options.filter(o => o.label.trim()).map(o => (
              <button key={o.label} type="button" onClick={() => answer(o.label)} className="rounded-full border-2 border-purple-500 px-3 py-1 text-[12.5px] font-medium text-purple-700 hover:bg-purple-50">
                {o.label}
              </button>
            ))}
          </div>
        )}
        {(q?.kind === "appointment" || q?.kind === "products" || q?.kind === "special") && (
          <div className="pl-1">
            <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-500">
              {q.kind === "appointment" ? <CalendarDays className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
              {q.kind === "appointment" ? "Your appointment calendar shows here" : q.kind === "products" ? "Matching products show here" : "This step runs here"}
            </div>
            <div>
              <button type="button" onClick={() => answer(q.kind === "appointment" ? "Booked" : "Done")} className="rounded-full border-2 border-purple-500 px-3 py-1 text-[12.5px] font-medium text-purple-700 hover:bg-purple-50">
                Continue
              </button>
            </div>
          </div>
        )}
        {done && <p className="pt-1 text-center text-[11px] text-gray-400">End of the journey</p>}
      </div>
      <form
        className="flex items-center gap-2 border-t border-black/[0.06] p-2"
        onSubmit={(e) => { e.preventDefault(); if (needsTyping && (typed.trim() || !q?.required)) { answer(typed.trim()); setTyped(""); } }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={!needsTyping}
          placeholder={needsTyping ? "Type an answer to try" : q?.kind === "choice" ? "Tap an option above" : "—"}
          className="min-w-0 flex-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[13px] focus:border-purple-400 focus:outline-none disabled:bg-gray-50"
          data-testid="input-preview-answer"
        />
        <button type="submit" disabled={!needsTyping} aria-label="Send" className="grid h-8 w-8 place-items-center rounded-full bg-purple-600 text-white disabled:bg-gray-200">
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
