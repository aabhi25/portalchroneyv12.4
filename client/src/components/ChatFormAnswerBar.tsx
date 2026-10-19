import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { hasManyChoices, isChoiceQuestion, pickChoice, validateFormAnswer, type FormQuestion } from "@/lib/formAnswer";

/**
 * The answer box under a form question that's asked in the chat (journey forms). It sits where
 * the chat input normally is, so a form reads like a conversation: the question is a chat
 * bubble, the visitor types (or taps an option above) and the answer appears as their bubble.
 */
export function ChatFormAnswerBar({ step, onSubmit, isSubmitting, chatColor, chatColorEnd, isMobile, onSearch }: {
  step: FormQuestion;
  onSubmit: (value: string) => void;
  isSubmitting: boolean;
  chatColor: string;
  chatColorEnd?: string;
  isMobile?: boolean;
  /** Long option lists: what's typed here narrows the option buttons above. */
  onSearch?: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Short option lists are answered by tapping; long ones can also be searched here.
  const searchable = hasManyChoices(step);
  const choice = isChoiceQuestion(step) && !searchable;

  useEffect(() => {
    setValue("");
    setError(null);
    onSearch?.("");
    if (!choice && !isMobile) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.stepId, choice, isMobile]);

  const submit = (answer: string) => {
    if (searchable && answer.trim()) {
      const picked = pickChoice(step.options ?? [], answer);
      if (!picked) {
        setError("Please pick one of the options");
        return;
      }
      setError(null);
      setValue("");
      onSearch?.("");
      onSubmit(picked);
      return;
    }
    const problem = validateFormAnswer(step, answer);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setValue("");
    onSubmit(answer.trim());
  };

  const type = step.questionType === "email" ? "email" : step.questionType === "phone" ? "tel" : step.questionType === "number" ? "number" : step.questionType === "date" ? "date" : "text";
  const inputMode = step.questionType === "phone" ? "numeric" : step.questionType === "email" ? "email" : step.questionType === "number" ? "decimal" : undefined;
  const placeholder = choice
    ? "Choose one of the options above"
    : searchable
    ? `Type to search ${step.options?.length ?? 0} options`
    : step.placeholder || (step.questionType === "phone" ? "Enter 10-digit mobile number" : step.questionType === "email" ? "Enter your email" : "Type your answer...");
  const ready = !!value.trim() && !isSubmitting;
  const gradient = `linear-gradient(135deg, ${chatColor}, ${chatColorEnd || chatColor})`;

  return (
    <div data-testid="form-answer-bar">
      {error && (
        <p className="mb-1.5 px-1 text-xs font-medium text-rose-600" role="alert" data-testid="form-answer-error">{error}</p>
      )}
      <form
        className="relative"
        onSubmit={(e) => { e.preventDefault(); if (!choice) submit(value); }}
      >
        <input
          ref={inputRef}
          type={type}
          inputMode={inputMode}
          value={value}
          disabled={choice || isSubmitting}
          maxLength={step.questionType === "phone" ? 10 : undefined}
          onChange={(e) => {
            setError(null);
            setValue(step.questionType === "phone" ? e.target.value.replace(/\D/g, "").slice(0, 10) : e.target.value);
            if (searchable) onSearch?.(e.target.value);
          }}
          onFocus={() => window.parent.postMessage({ type: "EXPAND_WIDGET" }, "*")}
          placeholder={placeholder}
          aria-label={step.questionText}
          className="w-full rounded-xl sm:rounded-2xl border border-gray-200 bg-white py-2 pl-3 pr-12 placeholder:text-gray-400 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:cursor-not-allowed disabled:bg-gray-50 sm:py-3 sm:pl-4 sm:pr-14"
          style={{ fontSize: isMobile ? "16px" : "15px", minHeight: isMobile ? "48px" : "44px" }}
          data-testid="input-form-answer"
        />
        {!choice && (
          <button
            type="submit"
            disabled={!ready}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 disabled:cursor-not-allowed sm:right-3 sm:h-9 sm:w-9"
            style={{ background: ready ? gradient : "#e5e7eb", boxShadow: ready ? "0 2px 8px rgba(0,0,0,0.15)" : "none" }}
            aria-label="Send answer"
            data-testid="button-form-answer-send"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Send className={`h-4 w-4 ${ready ? "text-white" : "text-gray-400"}`} />}
          </button>
        )}
      </form>
      {!step.isRequired && (
        <div className="pt-1.5 text-center">
          <button
            type="button"
            onClick={() => submit("")}
            disabled={isSubmitting}
            className="text-xs font-medium text-gray-500 hover:text-gray-700"
            data-testid="button-form-answer-skip"
          >
            Skip this question
          </button>
        </div>
      )}
    </div>
  );
}
