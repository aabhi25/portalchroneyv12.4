import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { CalendarCheck, FilePlus2, GraduationCap, Landmark, Loader2, Sparkles, Target } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { kindFields, type AnswerKind, type StepRow } from "./journeyModel";

interface TemplateOption {
  label: string;
  /** Ends the chat with this message instead of going on. */
  end?: string;
}
interface TemplateQuestion {
  text: string;
  kind: AnswerKind;
  required?: boolean;
  options?: (string | TemplateOption)[];
  savedAs?: string;
}
interface JourneyTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  questions: TemplateQuestion[];
  ending: string;
}

/** Ready-made journeys to start from; every part can be edited afterwards. */
const TEMPLATES: JourneyTemplate[] = [
  {
    id: "admission_enquiry",
    name: "Admission enquiry",
    description: "Course, city, name and mobile for a counsellor to call back",
    icon: GraduationCap,
    questions: [
      { text: "Which course are you interested in?", kind: "choice", options: ["MBA", "BBA", "MCA", "B.Com", "Not sure yet"], savedAs: "course" },
      { text: "Which city are you from?", kind: "short", savedAs: "city" },
      { text: "Great! May I know your name?", kind: "name" },
      { text: "Please share your mobile number so a counsellor can call you.", kind: "mobile" },
    ],
    ending: "Thank you! Our counsellor will call you shortly.",
  },
  {
    id: "loan_eligibility",
    name: "Loan eligibility",
    description: "Loan type, income and work, then name and mobile",
    icon: Landmark,
    questions: [
      { text: "What kind of loan are you looking for?", kind: "choice", options: ["Personal loan", "Home loan", "Business loan", "Education loan"], savedAs: "loan_type" },
      { text: "What is your monthly income?", kind: "choice", options: ["Below ₹25,000", "₹25,000 – ₹50,000", "₹50,000 – ₹1 lakh", "Above ₹1 lakh"], savedAs: "income" },
      { text: "Are you salaried or self-employed?", kind: "choice", options: ["Salaried", "Self-employed"], savedAs: "employment" },
      { text: "May I know your name?", kind: "name" },
      { text: "Your mobile number, so we can share your eligibility?", kind: "mobile" },
    ],
    ending: "Thanks! We'll check your eligibility and get back to you shortly.",
  },
  {
    id: "appointment_booking",
    name: "Appointment booking",
    description: "Reason, name and mobile, then picks a time",
    icon: CalendarCheck,
    questions: [
      { text: "What would you like to book an appointment for?", kind: "short", savedAs: "reason" },
      { text: "May I know your name?", kind: "name" },
      { text: "Your mobile number, for the confirmation?", kind: "mobile" },
      { text: "Pick a time that suits you.", kind: "appointment" },
    ],
    ending: "You're booked! We'll see you then.",
  },
  {
    id: "lead_qualification",
    name: "Lead qualification",
    description: "Need, budget and timing; casual visitors end politely",
    icon: Target,
    questions: [
      { text: "What are you looking for today?", kind: "short", savedAs: "requirement" },
      { text: "What budget do you have in mind?", kind: "choice", options: ["Under ₹50,000", "₹50,000 – ₹2 lakh", "Above ₹2 lakh"], savedAs: "budget" },
      {
        text: "When are you planning to buy?", kind: "choice", savedAs: "timeline",
        options: ["This week", "This month", { label: "Just exploring", end: "No problem! Feel free to ask me anything while you look around." }],
      },
      { text: "May I know your name?", kind: "name" },
      { text: "Your mobile number, so our team can reach you?", kind: "mobile" },
      { text: "And your email, if you'd like details there too?", kind: "email", required: false },
    ],
    ending: "Thank you! Our team will be in touch soon.",
  },
];

async function createFromTemplate(t: JourneyTemplate | null): Promise<string> {
  const journey = await apiRequest<{ id: string }>("POST", "/api/journeys", {
    name: t ? t.name : "New journey",
    description: t ? t.description : "",
    templateType: t ? t.id : "custom",
    journeyType: "form",
    status: "active",
    isDefault: "false",
    triggerMode: "manual",
    startFromScratch: "false",
  });
  if (!t) return journey.id;
  const post = (body: Record<string, unknown>) => apiRequest<StepRow>("POST", `/api/journeys/${journey.id}/steps`, body);

  const questionIds: string[] = [];
  for (let i = 0; i < t.questions.length; i++) {
    const q = t.questions[i];
    const options = (q.options ?? []).map((o: string | TemplateOption) => (typeof o === "string" ? o : o.label));
    const step = await post({
      questionText: q.text,
      ...kindFields(q.kind),
      isRequired: q.required === false ? "false" : "true",
      multipleChoiceOptions: q.kind === "choice" ? JSON.stringify(options) : null,
      crmFieldKey: q.savedAs ?? (q.kind === "name" ? "name" : null),
      isConditional: "false",
      stepOrder: String(i),
    });
    questionIds.push(step.id);
  }
  let order = t.questions.length;
  await post({ questionText: t.ending, questionType: "text", toolTrigger: "journey_complete", isRequired: "false", isConditional: "false", stepOrder: String(order++) });

  // Options that end the chat get their own closing message.
  for (let i = 0; i < t.questions.length; i++) {
    const q = t.questions[i];
    const routes: { matchType: string; matchValue: string; targetStepId: string; label: string }[] = [];
    for (const o of q.options ?? []) {
      if (typeof o === "string" || !o.end) continue;
      const ending = await post({ questionText: o.end, questionType: "text", toolTrigger: "journey_complete", isRequired: "false", isConditional: "true", stepOrder: String(order++) });
      routes.push({ matchType: "exact", matchValue: o.label, targetStepId: ending.id, label: o.label });
    }
    if (routes.length > 0) {
      await apiRequest("PUT", `/api/journeys/${journey.id}/steps/${questionIds[i]}`, { branchingCondition: JSON.stringify({ routes, defaultNextStepId: null }) });
    }
  }
  return journey.id;
}

/**
 * "Create a journey": start from a template, describe it in your own words (the AI builds the
 * questions), or start blank.
 */
export function NewJourneyDialog({ open, onOpenChange, onCreated, onDescribe }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (journeyId: string) => void;
  onDescribe: () => void;
}) {
  const { toast } = useToast();
  const [creating, setCreating] = useState<string | null>(null);

  const create = async (t: JourneyTemplate | null) => {
    setCreating(t?.id ?? "blank");
    try {
      const id = await createFromTemplate(t);
      onCreated(id);
      onOpenChange(false);
      toast({ title: t ? `“${t.name}” created` : "Journey created", description: "Edit the questions and try it on the right." });
    } catch (e: any) {
      toast({ title: "Couldn't create the journey", description: e?.message, variant: "destructive" });
    } finally {
      setCreating(null);
    }
  };

  const card = (key: string, Icon: LucideIcon, title: string, text: string, onClick: () => void, accent = false) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      disabled={!!creating}
      className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:opacity-60 ${accent ? "border-purple-300 bg-purple-50/60 hover:bg-purple-50" : "border-gray-200 hover:border-purple-300 hover:bg-purple-50/40"}`}
      data-testid={`new-journey-${key}`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${accent ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-700"}`}>
        {creating === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-gray-900">{title}</span>
        <span className="block text-[13px] text-gray-500">{text}</span>
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a journey</DialogTitle>
          <DialogDescription>Questions the assistant asks one after another, with each answer saved to the lead.</DialogDescription>
        </DialogHeader>
        <div className="mt-2 grid gap-3">
          {card("describe", Sparkles, "Describe it in your own words", "Write or paste what you'd like to ask; the AI turns it into questions.", () => { onOpenChange(false); onDescribe(); }, true)}
        </div>
        <p className="mb-1 mt-4 text-[13px] font-medium text-gray-700">Or start from a template</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map(t => card(t.id, t.icon, t.name, t.description, () => create(t)))}
          {card("blank", FilePlus2, "Start blank", "Add your own questions one by one.", () => create(null))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
