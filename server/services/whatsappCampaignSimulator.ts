import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import {
  marketingCampaignMessages,
  marketingCampaignRecipients,
  marketingCampaigns,
  whatsappTemplates,
  type ReplyClassification,
} from "@shared/schema";
import { CLASSIFICATION_PRESETS } from "@shared/campaignPresets";

const SIMULATION_CAMPAIGN_NAME = "DEV SIMULATION — Loan Recovery (50 replies)";
const SIMULATION_TEMPLATE_NAME = "dev_loan_recovery_simulation_v1";
const SIMULATION_SIZE = 50;

type SimulationCase = {
  key: string;
  replies: string[];
  aiReplies: string[];
  capture?: Record<string, string>;
  callbackRequired?: boolean;
  callbackReason?: string;
};

const LOAN_RECOVERY_CLASSIFICATIONS: ReplyClassification[] =
  CLASSIFICATION_PRESETS.find(preset => preset.id === "debt_collection")?.classifications || [];

// The distribution is intentionally uneven so the outcomes card exercises both
// common and less-common categories without making every bar identical.
const CASE_PLAN: Array<{ key: string; count: number }> = [
  { key: "PTP", count: 8 },
  { key: "PAID", count: 8 },
  { key: "PAYMENT_ISSUE", count: 7 },
  { key: "CANNOT_PAY", count: 7 },
  { key: "DUE_DATE_QUERY", count: 6 },
  { key: "ACCOUNT_QUERY", count: 6 },
  { key: "REFUSAL", count: 4 },
  { key: "WRONG_NUMBER", count: 2 },
  { key: "OTHER", count: 2 },
];

const SIMULATION_CASES: SimulationCase[] = [
  {
    key: "PTP",
    replies: [
      "I will pay the outstanding EMI on the 5th of next month.",
      "Please give me until Friday, I promise to make the payment.",
      "I can clear this amount after my salary comes in next week.",
    ],
    aiReplies: [
      "Thank you for confirming. We have noted your promised payment date and will send a reminder before then.",
      "Thanks, your promise to pay has been recorded. Please use the payment link when you are ready.",
    ],
    capture: { ptp_date: "2026-09-05" },
  },
  {
    key: "PAID",
    replies: [
      "I already paid this instalment yesterday. Please check your records.",
      "Payment was made through UPI this morning.",
      "I have completed the payment. The reference is SIM-PAY-0042.",
    ],
    aiReplies: [
      "Thank you. We have recorded that payment was already made and will verify it against the account.",
      "Thanks for letting us know. We will reconcile the payment and update the account shortly.",
    ],
    capture: { payment_reference: "SIM-PAY-0042", payment_date: "2026-08-25" },
  },
  {
    key: "PAYMENT_ISSUE",
    replies: [
      "The payment link keeps failing when I try to pay.",
      "My auto-debit did not go through even though the balance was available.",
      "The bank declined the transaction. Can you share another way to pay?",
    ],
    aiReplies: [
      "Sorry about the trouble. We have recorded the payment issue and a support team member will help you with another payment option.",
      "We have noted the failed payment attempt. Please try the alternate payment link while our team checks the issue.",
    ],
    capture: { payment_issue_type: "Payment link or bank transaction failed" },
    callbackRequired: true,
    callbackReason: "Customer reported a payment failure and needs payment assistance.",
  },
  {
    key: "CANNOT_PAY",
    replies: [
      "I cannot pay this week because my salary is delayed.",
      "I am short of funds right now. I should be able to pay after the 10th.",
      "I lost my job recently and need some time before I can make the payment.",
    ],
    aiReplies: [
      "We understand. Your situation has been recorded, and a support team member will contact you to discuss the available options.",
      "Thank you for explaining. We have noted the expected payment timeframe for a follow-up.",
    ],
    capture: { reason: "Temporary financial difficulty", expected_date: "2026-09-12" },
    callbackRequired: true,
    callbackReason: "Customer says they cannot pay and needs a repayment discussion.",
  },
  {
    key: "DUE_DATE_QUERY",
    replies: [
      "When is my next payment due?",
      "Please tell me the due date for this instalment.",
      "I am not sure when the EMI is due. Can you confirm?",
    ],
    aiReplies: [
      "Your account team can confirm the exact due date and payment schedule. We have noted your question for follow-up.",
      "We have recorded your due-date question. Please check the account statement or contact support for the schedule.",
    ],
  },
  {
    key: "ACCOUNT_QUERY",
    replies: [
      "Why is the outstanding amount different from my statement?",
      "Please share the account balance and the instalment details.",
      "I want a breakdown of what is still outstanding on my account.",
    ],
    aiReplies: [
      "We have recorded your account question. A support representative will review the balance and share the breakdown.",
      "Thanks, we have noted the outstanding-balance query for account verification.",
    ],
    callbackRequired: true,
    callbackReason: "Customer requested an account balance or outstanding-amount review.",
  },
  {
    key: "REFUSAL",
    replies: [
      "I am not willing to pay this amount because I disagree with the charges.",
      "I will not make this payment until the account is corrected.",
      "I refuse to pay until someone explains these fees.",
    ],
    aiReplies: [
      "We have recorded your concern. A support representative will review the charges with you.",
      "Your dispute has been noted and will be routed to the account support team.",
    ],
    capture: { reason: "Disputes the amount or charges" },
    callbackRequired: true,
    callbackReason: "Customer refused payment and raised a dispute.",
  },
  {
    key: "WRONG_NUMBER",
    replies: [
      "This is the wrong number. I do not know this person.",
      "You have contacted the wrong person.",
    ],
    aiReplies: [
      "Sorry for the inconvenience. We have recorded that this may be the wrong number.",
    ],
  },
  {
    key: "OTHER",
    replies: [
      "Can someone call me about this message?",
      "I received your reminder, thank you.",
    ],
    aiReplies: [
      "Thanks for your reply. We have recorded it and a team member can follow up if needed.",
    ],
  },
];

const CASE_BY_KEY = new Map(SIMULATION_CASES.map(item => [item.key, item]));

function buildCaseSequence(): string[] {
  return CASE_PLAN.flatMap(({ key, count }) => Array.from({ length: count }, () => key));
}

function fixtureName(index: number): string {
  const firstNames = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya", "Vikram", "Isha", "Arjun", "Nisha"];
  const lastNames = ["Sharma", "Patel", "Nair", "Verma", "Kapoor"];
  return `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]}`;
}

function fixturePhone(index: number): string {
  // 202-555-01xx is reserved for fictional use. These numbers are never sent.
  return `120255501${String(index + 1).padStart(2, "0")}`;
}

function replyFor(simulationCase: SimulationCase, index: number): string {
  return simulationCase.replies[index % simulationCase.replies.length];
}

function aiReplyFor(simulationCase: SimulationCase, index: number): string {
  return simulationCase.aiReplies[index % simulationCase.aiReplies.length];
}

export async function simulateWhatsAppCampaign(businessAccountId: string): Promise<{
  campaignId: string;
  created: boolean;
  recipientCount: number;
  repliedCount: number;
  outcomeCounts: Record<string, number>;
}> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("The WhatsApp campaign simulator is available only in development");
  }

  const caseSequence = buildCaseSequence();
  if (caseSequence.length !== SIMULATION_SIZE) {
    throw new Error(`Simulation fixture must contain exactly ${SIMULATION_SIZE} recipients`);
  }

  const classificationByKey = new Map(LOAN_RECOVERY_CLASSIFICATIONS.map(item => [item.key, item]));
  const missingClassification = caseSequence.find(key => !classificationByKey.has(key));
  if (missingClassification) throw new Error(`Simulation classification is not configured: ${missingClassification}`);

  const templateBody = "Hi {{1}}, this is a development-only payment reminder. Please reply with your payment update.";
  return db.transaction(async tx => {
    // A transaction-scoped tenant lock makes "create or return the fixture"
    // atomic even when the development button is clicked twice at once.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`whatsapp-campaign-simulation:${businessAccountId}`}))`);

    const [existing] = await tx
      .select({ id: marketingCampaigns.id, totalRecipients: marketingCampaigns.totalRecipients, repliedCount: marketingCampaigns.repliedCount })
      .from(marketingCampaigns)
      .where(and(
        eq(marketingCampaigns.businessAccountId, businessAccountId),
        eq(marketingCampaigns.name, SIMULATION_CAMPAIGN_NAME),
      ))
      .limit(1);
    if (existing) {
      const outcomeCounts = Object.fromEntries(CASE_PLAN.map(({ key }) => [key, 0]));
      const existingRows = await tx
        .select({ primaryClassification: marketingCampaignRecipients.primaryClassification })
        .from(marketingCampaignRecipients)
        .where(and(
          eq(marketingCampaignRecipients.businessAccountId, businessAccountId),
          eq(marketingCampaignRecipients.campaignId, existing.id),
        ));
      for (const row of existingRows) {
        if (row.primaryClassification && outcomeCounts[row.primaryClassification] !== undefined) {
          outcomeCounts[row.primaryClassification]++;
        }
      }
      return {
        campaignId: existing.id,
        created: false,
        recipientCount: existing.totalRecipients,
        repliedCount: existing.repliedCount,
        outcomeCounts,
      };
    }

    const now = new Date();
    const completedAt = new Date(now.getTime() - 5 * 60 * 1000);
    const startedAt = new Date(completedAt.getTime() - (SIMULATION_SIZE * 4 + 5) * 60 * 1000);
    const [template] = await tx
      .select()
      .from(whatsappTemplates)
      .where(and(
        eq(whatsappTemplates.businessAccountId, businessAccountId),
        eq(whatsappTemplates.name, SIMULATION_TEMPLATE_NAME),
      ))
      .limit(1);
    const simulationTemplate = template
      ? template.status === "draft"
        ? template
        : (await tx
          .update(whatsappTemplates)
          .set({ status: "draft", updatedAt: now })
          .where(eq(whatsappTemplates.id, template.id))
          .returning())[0]
      : (await tx
        .insert(whatsappTemplates)
        .values({
          businessAccountId,
          name: SIMULATION_TEMPLATE_NAME,
          language: "en",
          category: "UTILITY",
          bodyText: templateBody,
          paramCount: 1,
          // Fixture templates remain visible for the simulated campaign preview
          // but cannot be selected by the normal, provider-backed send flow.
          status: "draft",
          buttons: [],
        })
        .returning())[0];

    const [campaign] = await tx
      .insert(marketingCampaigns)
      .values({
        businessAccountId,
        name: SIMULATION_CAMPAIGN_NAME,
        templateId: simulationTemplate.id,
        templateParams: ["{{name}}"],
        groupIds: [],
        status: "completed",
        startedAt,
        completedAt,
        totalRecipients: SIMULATION_SIZE,
        sentCount: SIMULATION_SIZE,
        failedCount: 0,
        repliedCount: SIMULATION_SIZE,
        optedOutCount: 0,
        aiEnabled: "true",
        aiAgentName: "Dev Simulation Agent",
        aiSystemPrompt: "Development fixture only. No WhatsApp provider calls were made.",
        aiUseFaqs: "false",
        aiUseDocs: "false",
        aiUseProducts: "false",
        aiKnowledgeDocIds: [],
        replyClassifications: LOAN_RECOVERY_CLASSIFICATIONS,
      })
      .returning();

    const recipients = [];
    const messages = [];
    const outcomeCounts = Object.fromEntries(CASE_PLAN.map(({ key }) => [key, 0]));

    for (let index = 0; index < SIMULATION_SIZE; index++) {
      const classificationKey = caseSequence[index];
      const simulationCase = CASE_BY_KEY.get(classificationKey)!;
      const inboundBody = replyFor(simulationCase, index);
      const sentAt = new Date(startedAt.getTime() + index * 4 * 60 * 1000);
      const replyAt = new Date(sentAt.getTime() + 2 * 60 * 1000);
      const aiAt = new Date(sentAt.getTime() + 3 * 60 * 1000);
      const phone = fixturePhone(index);
      outcomeCounts[classificationKey]++;

      recipients.push({
        id: randomUUID(),
        campaignId: campaign.id,
        businessAccountId,
        phone,
        sendPhone: phone,
        name: fixtureName(index),
        attributes: {
          account_reference: `SIM-ACCT-${String(index + 1).padStart(3, "0")}`,
          outstanding_amount: `₹${(4200 + index * 275).toLocaleString("en-IN")}`,
          fixture: "development",
        },
        status: "replied",
        msg91MessageId: `dev-simulation-${String(index + 1).padStart(3, "0")}`,
        providerResponse: { simulated: true, providerCallMade: false },
        sentAt,
        deliveredAt: new Date(sentAt.getTime() + 30 * 1000),
        readAt: new Date(sentAt.getTime() + 60 * 1000),
        firstReplyAt: replyAt,
        replyCount: 1,
        aiReplyCount: 1,
        primaryClassification: classificationKey,
        dispositionData: simulationCase.capture || {},
        callbackRequired: simulationCase.callbackRequired || false,
        callbackReason: simulationCase.callbackReason || null,
        customerFeedback: inboundBody,
        classifiedAt: replyAt,
      });

      messages.push(
        {
          campaignId: campaign.id,
          recipientId: recipients[recipients.length - 1].id,
          businessAccountId,
          direction: "outbound_template",
          body: templateBody.replace("{{1}}", fixtureName(index)),
          metadata: { simulated: true, providerCallMade: false, templateName: simulationTemplate.name },
          createdAt: sentAt,
        },
        {
          campaignId: campaign.id,
          recipientId: recipients[recipients.length - 1].id,
          businessAccountId,
          direction: "inbound",
          body: inboundBody,
          metadata: { simulated: true, classification: classificationKey },
          createdAt: replyAt,
        },
        {
          campaignId: campaign.id,
          recipientId: recipients[recipients.length - 1].id,
          businessAccountId,
          direction: "outbound_ai",
          body: aiReplyFor(simulationCase, index),
          metadata: { simulated: true, classification: classificationKey, providerCallMade: false },
          createdAt: aiAt,
        },
      );
    }

    await tx.insert(marketingCampaignRecipients).values(recipients);
    const messageRows = messages;
    await tx.insert(marketingCampaignMessages).values(messageRows);

    return {
      campaignId: campaign.id,
      created: true,
      recipientCount: SIMULATION_SIZE,
      repliedCount: SIMULATION_SIZE,
      outcomeCounts,
    };
  });
}