import { validatePhoneNumber } from "@shared/validation/phone";

/** The parts of a journey form step the chat widget needs to ask and check one question. */
export interface FormQuestion {
  stepId: string;
  questionText: string;
  questionType: string;
  isRequired: boolean;
  options?: string[];
  placeholder?: string;
  stepType?: string;
}

/** Steps answered by tapping one of a few options (shown as buttons in the chat). */
export function isChoiceQuestion(step: Pick<FormQuestion, "questionType" | "options">): boolean {
  return (step.questionType === "radio" || step.questionType === "dropdown") && (step.options?.length ?? 0) > 0;
}

/** Steps with their own card instead of a chat question (the appointment calendar). */
export function hasOwnCard(step: Pick<FormQuestion, "stepType">): boolean {
  return step.stepType === "book_appointment";
}

/** The journey's closing message (shown as a last chat bubble, with its optional button). */
export function isClosingStep(step: Pick<FormQuestion, "stepType">): boolean {
  return step.stepType === "journey_complete";
}

/** Checks one answer the way every form step does; returns the message to show, or null if it's fine. */
export function validateFormAnswer(step: Pick<FormQuestion, "isRequired" | "questionType">, value: string): string | null {
  if (step.isRequired && !value.trim()) return "This field is required";
  if (step.questionType === "email" && value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return "Please enter a valid email address";
  }
  if (step.questionType === "phone" && value) {
    const cleanPhone = value.replace(/\D/g, '');
    if (cleanPhone.length !== 10) return "Please enter a valid 10-digit mobile number";
    const phoneValidation = validatePhoneNumber(cleanPhone, '10');
    if (!phoneValidation.isValid) return phoneValidation.reasonMessage;
  }
  return null;
}

