/**
 * Reply-classification presets.
 *
 * These are starting points shown in the campaign builder — an operator picks
 * one and can then add / remove / rename categories freely. Nothing here is
 * privileged: a fully custom list behaves identically at runtime. Adding a new
 * vertical to the product means adding a preset here, not changing any engine
 * code.
 */
import type { ReplyClassification } from "./schema";

export interface ClassificationPreset {
  id: string;
  label: string;
  description: string;
  classifications: ReplyClassification[];
}

export const CLASSIFICATION_PRESETS: ClassificationPreset[] = [
  {
    id: "debt_collection",
    label: "Debt Collection / Loan Recovery",
    description: "EMI reminders, overdue follow-up, payment recovery",
    classifications: [
      {
        key: "PTP",
        label: "Promise to Pay",
        description: "Customer commits to paying on a specific date or timeframe.",
        captureFields: [
          { fieldKey: "ptp_date", fieldLabel: "Promised Payment Date", fieldType: "date" },
        ],
      },
      {
        key: "PAID",
        label: "Paid / Payment Already Made",
        description: "Customer states the payment has already been made.",
        captureFields: [
          { fieldKey: "payment_reference", fieldLabel: "Payment Reference", fieldType: "text" },
          { fieldKey: "payment_date", fieldLabel: "Payment Date", fieldType: "date" },
        ],
      },
      {
        key: "PAYMENT_ISSUE",
        label: "Payment Issue",
        description: "Payment failed, NACH/auto-debit issue, bank problem, or broken payment link.",
        captureFields: [
          { fieldKey: "payment_issue_type", fieldLabel: "Issue Type", fieldType: "text" },
        ],
      },
      {
        key: "CANNOT_PAY",
        label: "Can't Pay",
        description: "Insufficient funds, salary delay, job loss, or general financial difficulty.",
        captureFields: [
          { fieldKey: "reason", fieldLabel: "Reason", fieldType: "text" },
          { fieldKey: "expected_date", fieldLabel: "Expected Payment Date", fieldType: "date" },
        ],
      },
      {
        key: "DUE_DATE_QUERY",
        label: "Due Date Query",
        description: "Customer asks when the payment is due or says they were unaware of the due date.",
      },
      {
        key: "ACCOUNT_QUERY",
        label: "Outstanding / Account Query",
        description: "Customer disputes the amount or asks for account details.",
      },
      {
        key: "REFUSAL",
        label: "Refusal / Not Willing to Pay",
        description: "Customer explicitly refuses to pay.",
        captureFields: [
          { fieldKey: "reason", fieldLabel: "Stated Reason", fieldType: "text" },
        ],
      },
      {
        key: "WRONG_NUMBER",
        label: "Wrong Number",
        description: "The contact is not the borrower; wrong person or invalid contact.",
      },
      {
        key: "OTHER",
        label: "Other",
        description: "Any meaningful response that does not fit the categories above.",
      },
    ],
  },
  {
    id: "event_rsvp",
    label: "Event RSVP / Invitations",
    description: "Conferences, webinars, open houses, launch events",
    classifications: [
      {
        key: "CONFIRMED",
        label: "Attending",
        description: "Customer confirms they will attend.",
        captureFields: [
          { fieldKey: "guest_count", fieldLabel: "Number of Guests", fieldType: "text" },
        ],
      },
      {
        key: "DECLINED",
        label: "Not Attending",
        description: "Customer declines the invitation.",
        captureFields: [{ fieldKey: "reason", fieldLabel: "Reason", fieldType: "text" }],
      },
      {
        key: "TENTATIVE",
        label: "Maybe / Tentative",
        description: "Customer is interested but has not committed.",
      },
      {
        key: "RESCHEDULE",
        label: "Wants Different Date",
        description: "Customer wants to attend but on a different date or slot.",
        captureFields: [
          { fieldKey: "preferred_date", fieldLabel: "Preferred Date", fieldType: "date" },
        ],
      },
      {
        key: "WRONG_CONTACT",
        label: "Wrong Contact",
        description: "Not the intended invitee.",
      },
      { key: "OTHER", label: "Other", description: "Any response not fitting the above." },
    ],
  },
  {
    id: "sales_qualification",
    label: "Sales / Lead Qualification",
    description: "Product enquiries, demo booking, cart recovery",
    classifications: [
      {
        key: "INTERESTED",
        label: "Interested — Ready to Buy",
        description: "Customer wants to proceed with a purchase or booking.",
      },
      {
        key: "WANTS_DEMO",
        label: "Wants Demo / Callback",
        description: "Customer wants a demo, site visit, or call before deciding.",
        captureFields: [
          { fieldKey: "preferred_time", fieldLabel: "Preferred Time", fieldType: "text" },
        ],
      },
      {
        key: "NEED_INFO",
        label: "Needs More Information",
        description: "Customer has questions before deciding.",
        captureFields: [{ fieldKey: "question", fieldLabel: "Question Asked", fieldType: "text" }],
      },
      {
        key: "PRICE_CONCERN",
        label: "Price Concern",
        description: "Customer is interested but finds the price too high or wants a discount.",
      },
      {
        key: "NOT_INTERESTED",
        label: "Not Interested",
        description: "Customer does not want the product or service.",
        captureFields: [{ fieldKey: "reason", fieldLabel: "Reason", fieldType: "text" }],
      },
      {
        key: "ALREADY_PURCHASED",
        label: "Already Purchased",
        description: "Customer already bought this or an equivalent elsewhere.",
      },
      { key: "OTHER", label: "Other", description: "Any response not fitting the above." },
    ],
  },
  {
    id: "appointment_scheduling",
    label: "Appointments / Scheduling",
    description: "Clinics, interviews, service visits, consultations",
    classifications: [
      {
        key: "CONFIRMED",
        label: "Appointment Confirmed",
        description: "Customer confirms the scheduled appointment.",
      },
      {
        key: "RESCHEDULE",
        label: "Reschedule Requested",
        description: "Customer wants to move the appointment to a different time.",
        captureFields: [
          { fieldKey: "preferred_date", fieldLabel: "Preferred Date", fieldType: "date" },
          { fieldKey: "preferred_time", fieldLabel: "Preferred Time", fieldType: "text" },
        ],
      },
      {
        key: "CANCELLED",
        label: "Cancelled",
        description: "Customer cancels the appointment.",
        captureFields: [{ fieldKey: "reason", fieldLabel: "Reason", fieldType: "text" }],
      },
      {
        key: "RUNNING_LATE",
        label: "Running Late",
        description: "Customer will attend but arrive late.",
      },
      {
        key: "WRONG_CONTACT",
        label: "Wrong Contact",
        description: "Not the intended person.",
      },
      { key: "OTHER", label: "Other", description: "Any response not fitting the above." },
    ],
  },
];

/** Universal fallback used when a campaign enables classification without picking a preset. */
export const GENERIC_CLASSIFICATIONS: ReplyClassification[] = [
  { key: "POSITIVE", label: "Positive / Interested", description: "Customer responded favourably or agreed." },
  { key: "NEGATIVE", label: "Negative / Declined", description: "Customer responded unfavourably or declined." },
  { key: "QUESTION", label: "Asked a Question", description: "Customer asked for more information." },
  { key: "WRONG_CONTACT", label: "Wrong Contact", description: "Not the intended recipient." },
  { key: "OTHER", label: "Other", description: "Any response not fitting the above." },
];
