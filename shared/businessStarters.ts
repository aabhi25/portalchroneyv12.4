/**
 * Business starter packs — what a new account gets when the super admin picks
 * "What kind of business?" in the New account box.
 *
 * A pack is a one-time starting point, applied once when the account is
 * created (server/services/businessStarters.ts). Nothing links the account to
 * the pack afterwards: everything it sets is an ordinary setting the super
 * admin or the business can change later (Features, Training, Appointments).
 *
 * Kept free of server/client-only imports so both bundles can use it.
 * To add a business type, add one entry to BUSINESS_STARTERS.
 */
import { LEAD_FIELD_LABELS, createDefaultLeadTrainingConfig, type LeadFieldId, type LeadTrainingConfig } from "./leadTrainingConfig";

export const BUSINESS_STARTER_KEYS = [
  "blank", "clinic", "dentist", "salon", "education", "real_estate", "online_store", "jewellery",
] as const;
export type BusinessStarterKey = (typeof BUSINESS_STARTER_KEYS)[number];

export type StarterInstruction =
  | { type: "always" | "fallback"; text: string }
  | { type: "conditional"; text: string; keywords: string[] };

export interface BusinessStarter {
  key: BusinessStarterKey;
  label: string;
  /** One line under the tile. */
  description: string;
  /** Features switched on (anything not listed stays off; Website chat is always on). */
  switches: {
    whatsapp?: boolean;
    appointments?: boolean;
    supportTickets?: boolean;
    visualSearch?: boolean;
    jewelryShowcase?: boolean;
  };
  /** Weekly booking hours. days: 0 = Sunday … 6 = Saturday; times "HH:mm" (24-hour). */
  hours?: { days: number[]; start: string; end: string; slotMinutes: number };
  personality?: "friendly" | "professional" | "polite" | "casual";
  /** {business} is replaced with the account name. */
  welcomeMessage?: string;
  /** Added to Training › Instructions. At most one "fallback". */
  instructions: StarterInstruction[];
  /** Appointments › booking suggestions: when these words come up, the AI offers to book. */
  bookingTriggers?: { keywords: string[]; prompt: string }[];
  /** Training › lead details: which details to ask for, and after which reply. */
  leadDetails?: { ask: LeadFieldId[]; askAfter: number };
}

const CALL_BACK_FALLBACK = (team: string) =>
  `If you don't know the answer, say you'll pass the question to the ${team}, and ask for their name and phone number so they can get back to them.`;

export const BUSINESS_STARTERS: BusinessStarter[] = [
  {
    key: "blank",
    label: "Blank",
    description: "Start from scratch",
    switches: {},
    instructions: [],
  },
  {
    key: "clinic",
    label: "Clinic / Doctor",
    description: "Appointments, patient enquiries",
    switches: { appointments: true },
    hours: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00", slotMinutes: 30 },
    personality: "professional",
    welcomeMessage: "Hi! Welcome to {business}. I can help you book an appointment or answer questions about the clinic.",
    instructions: [
      { type: "always", text: "You are the assistant for a medical clinic. Be polite, calm and professional, and keep answers short and clear." },
      { type: "always", text: "Never diagnose, suggest medicines or doses, or say whether a symptom is serious. For any health question, suggest booking an appointment with the doctor." },
      { type: "always", text: "Don't promise any treatment result. Only share fees, doctor names and timings that are in your training." },
      {
        type: "conditional",
        keywords: ["emergency", "chest pain", "bleeding", "unconscious", "can't breathe", "breathing problem", "accident", "poison"],
        text: "This may be an emergency. Tell the person to call an ambulance (108 in India) or go to the nearest hospital straight away. Do not try to book an appointment.",
      },
      {
        type: "conditional",
        keywords: ["fees", "fee", "charges", "cost", "price"],
        text: "Only share fees that are in your training. If you don't have them, offer to have the clinic call back with the details and ask for their phone number.",
      },
      { type: "fallback", text: CALL_BACK_FALLBACK("clinic team") },
    ],
    bookingTriggers: [
      { keywords: ["appointment", "consultation", "book", "check-up", "checkup", "see the doctor", "visit"], prompt: "Would you like me to book an appointment with the doctor for you?" },
    ],
    leadDetails: { ask: ["name", "mobile"], askAfter: 1 },
  },
  {
    key: "dentist",
    label: "Dentist",
    description: "Appointments, treatment enquiries",
    switches: { appointments: true },
    hours: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00", slotMinutes: 30 },
    personality: "professional",
    welcomeMessage: "Hi! Welcome to {business}. I can help you book a check-up or answer questions about our treatments.",
    instructions: [
      { type: "always", text: "You are the assistant for a dental clinic. Be polite, calm and reassuring, and keep answers short and clear." },
      { type: "always", text: "Never diagnose or suggest medicines or doses. For any question about pain or a problem with teeth or gums, suggest booking a check-up with the dentist." },
      { type: "always", text: "Don't promise any treatment result. Only share fees, treatments, dentist names and timings that are in your training." },
      {
        type: "conditional",
        keywords: ["severe pain", "swelling", "bleeding", "broken tooth", "knocked out", "accident", "emergency"],
        text: "For severe pain, heavy bleeding, swelling of the face or an injury, tell them to call the clinic straight away (or go to the nearest hospital if it is serious), and offer the earliest appointment.",
      },
      {
        type: "conditional",
        keywords: ["fees", "fee", "charges", "cost", "price"],
        text: "Only share fees that are in your training. If you don't have them, say the cost depends on the check-up, and offer to have the clinic call back with the details.",
      },
      { type: "fallback", text: CALL_BACK_FALLBACK("clinic team") },
    ],
    bookingTriggers: [
      { keywords: ["appointment", "book", "check-up", "checkup", "cleaning", "toothache", "braces", "root canal", "implant", "whitening"], prompt: "Would you like me to book a check-up with the dentist for you?" },
    ],
    leadDetails: { ask: ["name", "mobile"], askAfter: 1 },
  },
  {
    key: "salon",
    label: "Salon / Spa",
    description: "Bookings for services",
    switches: { appointments: true },
    hours: { days: [0, 1, 2, 3, 4, 5, 6], start: "10:00", end: "20:00", slotMinutes: 30 },
    personality: "friendly",
    welcomeMessage: "Hi! Welcome to {business}. Would you like to book a service or know more about what we offer?",
    instructions: [
      { type: "always", text: "You are the assistant for a salon and spa. Be warm and friendly, and keep answers short." },
      { type: "always", text: "Only share services, prices and stylists that are in your training. If a price isn't there, say it depends on the service and offer to book a consultation." },
      {
        type: "conditional",
        keywords: ["allergy", "allergic", "sensitive skin", "pregnant", "pregnancy"],
        text: "Suggest they mention it to the staff at their visit, and for treatments like hair colour or facials, recommend a patch test first. Don't give medical advice.",
      },
      { type: "fallback", text: CALL_BACK_FALLBACK("salon team") },
    ],
    bookingTriggers: [
      { keywords: ["book", "appointment", "slot", "haircut", "hair colour", "facial", "massage", "spa", "manicure", "pedicure", "bridal", "makeup"], prompt: "Would you like me to book that for you?" },
    ],
    leadDetails: { ask: ["name", "mobile"], askAfter: 2 },
  },
  {
    key: "education",
    label: "Coaching / Education",
    description: "Admissions enquiries, WhatsApp",
    switches: { whatsapp: true },
    personality: "professional",
    welcomeMessage: "Hi! Welcome to {business}. I can help you find the right course and answer questions about admissions.",
    instructions: [
      { type: "always", text: "You are the admissions assistant for an education provider. Be helpful and encouraging, and keep answers short." },
      { type: "always", text: "Find out which course or programme they are interested in, their current qualification and when they want to start. Ask one question at a time." },
      { type: "always", text: "Only share fees, eligibility, dates and placement figures that are in your training. Never promise admission, results or jobs." },
      {
        type: "conditional",
        keywords: ["fees", "fee", "emi", "scholarship", "loan", "installment", "instalment"],
        text: "Share only what is in your training about fees, EMIs or scholarships. Otherwise, offer a call from a counsellor and ask for their phone number.",
      },
      { type: "fallback", text: CALL_BACK_FALLBACK("admissions counsellors") },
    ],
    leadDetails: { ask: ["name", "mobile", "email"], askAfter: 2 },
  },
  {
    key: "real_estate",
    label: "Real estate",
    description: "Property enquiries, site visits",
    switches: { whatsapp: true, appointments: true },
    hours: { days: [0, 1, 2, 3, 4, 5, 6], start: "10:00", end: "19:00", slotMinutes: 60 },
    personality: "professional",
    welcomeMessage: "Hi! Welcome to {business}. Tell me what you're looking for and I'll help you find the right property.",
    instructions: [
      { type: "always", text: "You are the assistant for a real-estate business. Be professional and helpful, and keep answers short." },
      { type: "always", text: "Find out what they are looking for: buy or rent, location, budget and type of property (for example 2 BHK). Ask one question at a time." },
      { type: "always", text: "Only share projects, prices, sizes and availability that are in your training. Never promise returns, approvals or possession dates." },
      {
        type: "conditional",
        keywords: ["loan", "home loan", "emi", "interest rate"],
        text: "Say the team can guide them on home-loan options and offer a call back. Don't quote interest rates.",
      },
      { type: "fallback", text: CALL_BACK_FALLBACK("sales team") },
    ],
    bookingTriggers: [
      { keywords: ["site visit", "visit", "see the property", "see the flat", "meeting", "book a visit"], prompt: "Would you like to book a site visit?" },
    ],
    leadDetails: { ask: ["name", "mobile"], askAfter: 2 },
  },
  {
    key: "online_store",
    label: "Online store",
    description: "Products, photo search, support",
    switches: { visualSearch: true, supportTickets: true },
    personality: "friendly",
    welcomeMessage: "Hi! Welcome to {business}. I can help you find products or check on an order.",
    instructions: [
      { type: "always", text: "You are the shopping assistant for an online store. Be friendly and help people find the right product." },
      { type: "always", text: "Only share products, prices, offers, delivery times and return rules that are in your training or product list." },
      {
        type: "conditional",
        keywords: ["order", "delivery", "return", "refund", "exchange", "cancel", "damaged"],
        text: "If they have a problem with an order, ask for their order number and contact details and pass it to the support team.",
      },
      { type: "fallback", text: "If you don't know the answer, say the support team will check and get back to them, and ask for their name and phone number or email." },
    ],
    leadDetails: { ask: ["name", "mobile"], askAfter: 3 },
  },
  {
    key: "jewellery",
    label: "Jewellery store",
    description: "Jewelry Showcase (Vista)",
    switches: { jewelryShowcase: true },
    personality: "polite",
    welcomeMessage: "Hi! Welcome to {business}. I can help you explore our designs. You can also upload a photo to find similar pieces.",
    instructions: [
      { type: "always", text: "You are the assistant for a jewellery store. Be warm, polite and elegant." },
      { type: "always", text: "Only share designs, prices, purity (for example 22K or 18K) and making charges that are in your training or product list. Gold rates change daily, so don't quote a gold rate unless it is in your training." },
      {
        type: "conditional",
        keywords: ["custom", "customise", "customize", "bridal", "wedding", "engagement"],
        text: "Offer a call or a store visit with a design expert, and ask for their name and phone number.",
      },
      { type: "fallback", text: CALL_BACK_FALLBACK("store team") },
    ],
    leadDetails: { ask: ["name", "mobile"], askAfter: 2 },
  },
];

/** Training › lead details: the pack's fields on (and required) in its order, after its reply; the rest off. */
export function starterLeadConfig(details: NonNullable<BusinessStarter["leadDetails"]>): LeadTrainingConfig {
  const config = createDefaultLeadTrainingConfig();
  const order = [...details.ask, ...config.fields.map(f => f.id).filter(id => !details.ask.includes(id))];
  config.fields = order.map((id, i) => {
    const f = config.fields.find(x => x.id === id)!;
    const asked = details.ask.includes(id);
    return { ...f, enabled: asked, required: asked, priority: i + 1, captureStrategy: "custom", customAskAfter: details.askAfter };
  });
  return config;
}

export function getBusinessStarter(key: unknown): BusinessStarter | undefined {
  return BUSINESS_STARTERS.find(s => s.key === key);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function time12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

/** "Mon–Sat" for consecutive days, else a list ("Mon, Wed, Fri"); every day is "Every day". */
export function describeDays(days: number[]): string {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (consecutive && sorted.length > 2) return `${DAY_NAMES[sorted[0]]}–${DAY_NAMES[sorted[sorted.length - 1]]}`;
  return sorted.map(d => DAY_NAMES[d]).join(", ");
}

export function describeHours(hours: NonNullable<BusinessStarter["hours"]>): string {
  return `${describeDays(hours.days)}, ${time12(hours.start)}–${time12(hours.end)}, ${hours.slotMinutes}-minute slots`;
}

/** The features a pack switches on, in Features-page wording. */
export function starterFeatureLabels(s: BusinessStarter): string[] {
  return [
    "Website chat",
    s.switches.whatsapp && "WhatsApp",
    s.switches.appointments && "Appointments",
    s.switches.supportTickets && "Support tickets",
    s.switches.visualSearch && "Visual product search",
    s.switches.jewelryShowcase && "Jewelry Showcase (Vista)",
  ].filter((x): x is string => !!x);
}

/** Plain-language lines: what picking this pack sets up. Shown on the tile preview and the "created" screen. */
export function describeBusinessStarter(s: BusinessStarter): string[] {
  if (s.key === "blank") return ["Website chat on, everything else off. Nothing else is filled in."];
  const lines = [`Switches on: ${starterFeatureLabels(s).join(", ")}`];
  if (s.hours) lines.push(`Opening hours: ${describeHours(s.hours)}`);
  if (s.instructions.length) lines.push(`${s.instructions.length} training instructions${s.personality ? `, a ${s.personality} tone` : ""} and a welcome message`);
  if (s.leadDetails) lines.push(`Asks for: ${s.leadDetails.ask.map(id => LEAD_FIELD_LABELS[id]).join(", ")}`);
  if (s.bookingTriggers?.length) lines.push(`Offers a booking when visitors say words like "${s.bookingTriggers[0].keywords.slice(0, 3).join('", "')}"`);
  return lines;
}
