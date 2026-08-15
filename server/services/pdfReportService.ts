import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface InsightsPdfData {
  groupName: string;
  dateRangeText: string;
  generatedText: string;
  totals: { leads: number; conversations: number };
  accountBreakdown: Array<{ businessName: string; leads: number; conversations: number }>;
}

export interface AnalyticsPdfData {
  dateRangeText: string;
  generatedText: string;
  totals: { leads: number; conversations: number };
  accountBreakdown: Array<{ businessName: string; leads: number; conversations: number }>;
}

export interface LeadsPdfData {
  groupName: string;
  dateRangeText: string;
  generatedText: string;
  totalLeads: number;
  totalConversations: number | string;
  conversionRate: string;
  leads: Array<{
    name: string;
    phone: string;
    email: string;
    account: string;
    source: string;
    date: string;
  }>;
}

function toBuffer(doc: jsPDF): Buffer {
  return Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
}

export function renderInsightsPdf(data: InsightsPdfData): Buffer {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.text(`${data.groupName} - Insights`, pageWidth / 2, 20, { align: "center" });

  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Report Period: ${data.dateRangeText}`, pageWidth / 2, 28, { align: "center" });
  doc.text(`Generated: ${data.generatedText}`, pageWidth / 2, 34, { align: "center" });

  doc.setTextColor(0);
  doc.setFontSize(14);
  doc.text("Summary", 14, 48);

  doc.setFontSize(11);
  const totalConvRate = data.totals.conversations > 0
    ? ((data.totals.leads / data.totals.conversations) * 100).toFixed(1)
    : "0";
  doc.text(`Total Leads: ${data.totals.leads}`, 14, 58);
  doc.text(`Total Conversations: ${data.totals.conversations}`, 14, 66);
  doc.text(`Conversion Rate: ${totalConvRate}%`, 14, 74);

  if (data.accountBreakdown.length > 0) {
    doc.setFontSize(14);
    doc.text("Breakdown by Account", 14, 90);

    const tableData = data.accountBreakdown
      .slice()
      .sort((a, b) => b.conversations - a.conversations)
      .map((account) => {
        const rate = account.conversations > 0
          ? ((account.leads / account.conversations) * 100).toFixed(1) + "%"
          : "0%";
        return [account.businessName, account.leads.toString(), account.conversations.toString(), rate];
      });

    autoTable(doc, {
      startY: 96,
      head: [["Account", "Leads", "Chats", "Conv. Rate"]],
      body: tableData,
      styles: { fontSize: 10 },
      headStyles: { fillColor: [124, 58, 237] },
    });
  }

  return toBuffer(doc);
}

export function renderAnalyticsPdf(data: AnalyticsPdfData): Buffer {
  const doc = new jsPDF();

  doc.setFontSize(20);
  doc.setTextColor(88, 28, 135);
  doc.text("Analytics Report", 14, 20);

  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Date Range: ${data.dateRangeText}`, 14, 30);
  doc.text(`Generated: ${data.generatedText}`, 14, 37);

  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text("Summary", 14, 50);

  const totalLeads = data.totals.leads || 0;
  const totalConversations = data.totals.conversations || 0;
  const conversionRate = totalConversations > 0
    ? ((totalLeads / totalConversations) * 100).toFixed(1)
    : "0.0";

  doc.setFontSize(11);
  doc.text(`Total Leads: ${totalLeads.toLocaleString()}`, 14, 60);
  doc.text(`Total Conversations: ${totalConversations.toLocaleString()}`, 14, 67);
  doc.text(`Conversion Rate: ${conversionRate}%`, 14, 74);

  doc.setFontSize(14);
  doc.text("Account Breakdown", 14, 90);

  const tableData = (data.accountBreakdown || []).map((account) => {
    const leads = account.leads || 0;
    const conversations = account.conversations || 0;
    const conversion = conversations > 0
      ? ((leads / conversations) * 100).toFixed(1) + "%"
      : "0.0%";
    return [account.businessName || "Unknown", leads.toString(), conversations.toString(), conversion];
  });

  autoTable(doc, {
    startY: 95,
    head: [["Account", "Leads", "Conversations", "Conversion"]],
    body: tableData,
    headStyles: { fillColor: [88, 28, 135] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  return toBuffer(doc);
}

export function renderLeadsPdf(data: LeadsPdfData): Buffer {
  const doc = new jsPDF();

  doc.setFontSize(22);
  doc.setTextColor(88, 28, 135);
  doc.text("Leads Report", 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Group: ${data.groupName}`, 14, 28);
  doc.text(`Date Range: ${data.dateRangeText}`, 14, 34);
  doc.text(`Generated: ${data.generatedText}`, 14, 40);

  doc.setFillColor(245, 243, 255);
  doc.rect(14, 47, 182, 28, "F");

  doc.setFontSize(9);
  doc.setTextColor(88, 28, 135);
  doc.text("TOTAL UNIQUE LEADS", 24, 56);
  doc.text("TOTAL CONVERSATIONS", 90, 56);
  doc.text("CONVERSION RATE", 158, 56);

  doc.setFontSize(16);
  doc.setTextColor(30, 10, 60);
  const convDisplay = typeof data.totalConversations === "number"
    ? data.totalConversations.toLocaleString()
    : data.totalConversations;
  const rateDisplay = data.conversionRate === "N/A" ? "N/A" : `${data.conversionRate}%`;
  doc.text(data.totalLeads.toLocaleString(), 24, 68);
  doc.text(convDisplay, 90, 68);
  doc.text(rateDisplay, 158, 68);

  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text("Leads", 14, 86);

  const tableData = data.leads.map((lead) => [
    lead.name || "-",
    lead.phone || "-",
    lead.email || "-",
    lead.account || "-",
    lead.source || "-",
    lead.date || "-",
  ]);

  autoTable(doc, {
    startY: 90,
    head: [["Name", "Phone", "Email", "Account", "Source", "Date"]],
    body: tableData,
    headStyles: { fillColor: [88, 28, 135], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 245, 255] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 28 },
      2: { cellWidth: 38 },
      3: { cellWidth: 32 },
      4: { cellWidth: 32 },
      5: { cellWidth: 24 },
    },
  });

  return toBuffer(doc);
}
