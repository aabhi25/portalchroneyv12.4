import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { User, Mail, Phone, MapPin, Eye, Calendar, ListChecks, Loader2 } from "lucide-react";

/**
 * Body of the "Form Submission" dialog shown from the Leads pages.
 *
 * The visitor's answers to custom lead-form fields are never stored on the lead row —
 * at capture time each field is written to the linked conversation as a question/answer
 * pair of messages marked `interactionSource: 'form'`. This component reads them back so
 * the admin sees what the visitor actually typed, including for leads captured before
 * this view existed.
 *
 * Conversations are reused across submissions, so one transcript can hold several
 * submissions from different visitors. Selection is therefore fail-closed: a block is
 * only shown when its submitted contact details identify this lead. Showing nothing is
 * always preferable to attributing someone else's answers — and their personal details —
 * to the wrong person.
 */

export interface FormSubmissionLead {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  sourceUrl?: string | null;
  createdAt: string | Date;
  conversationId?: string | null;
}

interface FormMessage {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  createdAt?: unknown;
  interactionSource?: unknown;
}

interface Answer {
  question: string;
  answer: string;
  at: number;
}

/** Labels already rendered as their own row above the answers. */
const DUPLICATE_LABELS = new Set([
  "name",
  "full name",
  "email",
  "email address",
  "phone",
  "mobile",
  "mobile number",
  "phone number",
  "contact number",
]);

const normalize = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const asString = (v: unknown) => (typeof v === "string" ? v : "");
const digits = (v: unknown) => asString(v).replace(/\D/g, "");

const toTime = (v: unknown): number => {
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * Phone numbers are compared on digits only, and one side is allowed to carry a country
 * code the other omits ("+91 98982 22222" vs "9898222222"). The length floor keeps short
 * numeric answers — a year, an age, a pincode — from matching by accident.
 */
const phoneMatches = (a: unknown, b: unknown) => {
  const da = digits(a);
  const db = digits(b);
  if (da.length < 7 || db.length < 7) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
};

/**
 * Turn the ordered form messages into question/answer pairs, then split them into
 * submission blocks. The same label set repeats per submission, so a repeated question
 * marks the start of the next block.
 */
export function buildSubmissionBlocks(messages: unknown): Answer[][] {
  const list = Array.isArray(messages) ? (messages as FormMessage[]) : [];

  const formMessages = list
    .filter((m) => m && normalize(m.interactionSource) === "form")
    .map((m) => ({
      id: asString(m.id),
      role: asString(m.role),
      content: asString(m.content),
      at: toTime(m.createdAt),
    }))
    .sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id.localeCompare(b.id)));

  const blocks: Answer[][] = [];
  let current: Answer[] = [];
  let seen = new Set<string>();

  for (let i = 0; i < formMessages.length - 1; i++) {
    const q = formMessages[i];
    const a = formMessages[i + 1];
    if (q.role !== "assistant" || a.role !== "user") continue;

    const question = q.content.trim();
    const answer = a.content.trim();
    const key = normalize(question);

    if (seen.has(key) && current.length > 0) {
      blocks.push(current);
      current = [];
      seen = new Set<string>();
    }
    seen.add(key);
    current.push({ question, answer, at: a.at });
    i++; // consume the answer message
  }
  if (current.length > 0) blocks.push(current);

  return blocks;
}

/** Does this submission block carry contact details identifying the given lead? */
function blockIdentifiesLead(block: Answer[], lead: FormSubmissionLead): boolean {
  const email = normalize(lead.email);
  const phone = digits(lead.phone);
  const name = normalize(lead.name);

  if (email && block.some((p) => normalize(p.answer) === email)) return true;
  if (phone && block.some((p) => phoneMatches(p.answer, lead.phone))) return true;

  // Only fall back to the name when there is no stronger identifier to check against,
  // since names are far from unique.
  if (!email && !phone && name) {
    return block.some((p) => normalize(p.answer) === name);
  }
  return false;
}

/**
 * Pick the block belonging to this lead. A block must identify the lead by its submitted
 * contact details; time proximity only breaks ties between blocks that already match.
 * Returns null when nothing identifies a single submission.
 */
export function selectBlockForLead(
  blocks: Answer[][],
  lead: FormSubmissionLead,
): Answer[] | null {
  const matches = blocks.filter((block) => blockIdentifiesLead(block, lead));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const target = toTime(lead.createdAt);
  const dist = (b: Answer[]) => Math.abs((b[b.length - 1]?.at ?? 0) - target);
  return matches.reduce((best, block) => (dist(block) < dist(best) ? block : best));
}

export function FormSubmissionDetails({ lead }: { lead: FormSubmissionLead }) {
  const conversationId = lead.conversationId || null;

  const { data: messages, isLoading } = useQuery<unknown>({
    queryKey: ["/api/conversations", conversationId, "form-submission-messages"],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!conversationId,
  });

  const block = selectBlockForLead(buildSubmissionBlocks(messages), lead);
  const answers = (block ?? []).filter(
    (pair) => pair.answer && !DUPLICATE_LABELS.has(normalize(pair.question)),
  );

  const submittedAt = (() => {
    const t = toTime(lead.createdAt);
    return t ? format(new Date(t), "MMM d, yyyy h:mm a") : null;
  })();

  const identityFields = [
    { label: "Name", value: lead.name, icon: User },
    { label: "Email", value: lead.email, icon: Mail },
    { label: "Phone", value: lead.phone, icon: Phone },
  ].filter((f) => f.value);

  const contextFields = [
    // Not a submitted answer — this is resolved from the visitor's IP address, so it can
    // legitimately differ from a city they typed into the form.
    { label: "Detected Location", value: lead.city, icon: MapPin },
    { label: "Source URL", value: lead.sourceUrl, icon: Eye },
    ...(submittedAt ? [{ label: "Submitted", value: submittedAt, icon: Calendar }] : []),
  ].filter((f) => f.value);

  const row = (label: string, value: string, Icon: typeof User) => (
    <div key={label} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
      <Icon className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-gray-900 break-all mt-0.5">{value}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-3 mt-2 flex-1 min-h-0 overflow-y-auto pr-1">
      {identityFields.map((f) => row(f.label, f.value as string, f.icon))}

      {conversationId && isLoading && (
        <div className="flex items-center gap-2 p-3 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading submitted answers...
        </div>
      )}

      {answers.length > 0 && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 border-b border-gray-200">
            <ListChecks className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Answers Submitted
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {answers.map((pair, idx) => (
              <div key={`${pair.question}-${idx}`} className="px-3 py-2">
                <p className="text-xs font-medium text-gray-500">{pair.question}</p>
                <p className="text-sm text-gray-900 break-words mt-0.5">{pair.answer}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {contextFields.map((f) => row(f.label, f.value as string, f.icon))}
    </div>
  );
}
