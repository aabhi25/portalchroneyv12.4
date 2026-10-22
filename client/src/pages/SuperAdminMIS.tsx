import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, Building2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface MISRow {
  name: string;
  type: "group" | "individual";
  accountCount: number;
  visitors: { mtd: number; today: number };
  leads: { mtd: number; today: number };
  conversations: { mtd: number; today: number };
  conversionRate: { mtd: number; today: number };
}

function downloadPDF(data: MISRow[], totals: any, totalConversionRate: any) {
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(16);
  doc.setTextColor(107, 33, 168);
  doc.text("AI Chroney — MIS Report", 14, 18);

  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const dateStr = istNow.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const monthStr = istNow.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated: ${dateStr} | Period: ${monthStr} (MTD)`, 14, 25);

  const head = [
    [
      { content: "Partner Name", rowSpan: 2 },
      { content: "Type", rowSpan: 2 },
      { content: "Visitors", colSpan: 2 },
      { content: "Leads", colSpan: 2 },
      { content: "Conversations", colSpan: 2 },
      { content: "Conversion Rate", colSpan: 2 },
    ],
    ["MTD", "Today", "MTD", "Today", "MTD", "Today", "MTD", "Today"],
  ];

  const body = data.map((row) => [
    row.name,
    row.type === "group" ? `Group (${row.accountCount})` : "Individual",
    row.visitors.mtd.toLocaleString(),
    row.visitors.today.toLocaleString(),
    row.leads.mtd.toLocaleString(),
    row.leads.today.toLocaleString(),
    row.conversations.mtd.toLocaleString(),
    row.conversations.today.toLocaleString(),
    `${row.conversionRate.mtd.toFixed(2)}%`,
    `${row.conversionRate.today.toFixed(2)}%`,
  ]);

  const foot = [
    [
      "Total",
      "",
      totals.visitors.mtd.toLocaleString(),
      totals.visitors.today.toLocaleString(),
      totals.leads.mtd.toLocaleString(),
      totals.leads.today.toLocaleString(),
      totals.conversations.mtd.toLocaleString(),
      totals.conversations.today.toLocaleString(),
      `${totalConversionRate.mtd}%`,
      `${totalConversionRate.today}%`,
    ],
  ];

  autoTable(doc, {
    startY: 30,
    head,
    body,
    foot,
    theme: "grid",
    headStyles: {
      fillColor: [147, 51, 234],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
      fontSize: 9,
    },
    footStyles: {
      fillColor: [243, 232, 255],
      textColor: [55, 15, 100],
      fontStyle: "bold",
      halign: "center",
      fontSize: 9,
    },
    bodyStyles: {
      fontSize: 9,
      halign: "center",
    },
    columnStyles: {
      0: { halign: "left", fontStyle: "bold" },
      1: { halign: "center" },
    },
    alternateRowStyles: { fillColor: [250, 245, 255] },
    styles: { cellPadding: 3 },
  });

  doc.save(`MIS_Report_${dateStr.replace(/\s/g, "_")}.pdf`);
}

export default function SuperAdminMIS() {
  const { data, isLoading, error } = useQuery<MISRow[]>({
    queryKey: ["/api/super-admin/mis"],
    refetchInterval: 60000,
  });

  const totals = data?.reduce(
    (acc, row) => ({
      visitors: { mtd: acc.visitors.mtd + row.visitors.mtd, today: acc.visitors.today + row.visitors.today },
      leads: { mtd: acc.leads.mtd + row.leads.mtd, today: acc.leads.today + row.leads.today },
      conversations: { mtd: acc.conversations.mtd + row.conversations.mtd, today: acc.conversations.today + row.conversations.today },
    }),
    { visitors: { mtd: 0, today: 0 }, leads: { mtd: 0, today: 0 }, conversations: { mtd: 0, today: 0 } }
  );

  const totalConversionRate = totals
    ? {
        mtd: totals.visitors.mtd > 0 ? ((totals.leads.mtd / totals.visitors.mtd) * 100).toFixed(2) : "0.00",
        today: totals.visitors.today > 0 ? ((totals.leads.today / totals.visitors.today) * 100).toFixed(2) : "0.00",
      }
    : { mtd: "0.00", today: "0.00" };

  return (
    <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <p className="text-sm text-gray-500">
            Month-to-date and today's numbers for every partner.
          </p>
          {data && data.length > 0 && totals && (
            <Button
              onClick={() => downloadPDF(data, totals, totalConversionRate)}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
            <span className="ml-3 text-gray-500">Loading MIS data...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            Failed to load MIS data. Please try again.
          </div>
        )}

        {data && data.length === 0 && (
          <div className="text-center py-20 text-gray-500">No data available.</div>
        )}

        {data && data.length > 0 && totals && (
          <div className="overflow-x-auto rounded-2xl border border-black/[0.07] bg-white">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-black/[0.06] text-[12px] text-gray-500">
                  <th className="sticky left-0 z-10 bg-white px-4 pb-1 pt-3 text-left font-medium" rowSpan={2}>Partner</th>
                  <th className="px-4 pb-1 pt-3 text-left font-medium" rowSpan={2}>Type</th>
                  <th className="px-4 pb-1 pt-3 text-center font-medium" colSpan={2}>Visitors</th>
                  <th className="px-4 pb-1 pt-3 text-center font-medium" colSpan={2}>Leads</th>
                  <th className="px-4 pb-1 pt-3 text-center font-medium" colSpan={2}>Conversations</th>
                  <th className="px-4 pb-1 pt-3 text-center font-medium" colSpan={2}>Conversion</th>
                </tr>
                <tr className="border-b border-black/[0.06] text-[11px] uppercase tracking-wide text-gray-400">
                  {["Month", "Today", "Month", "Today", "Month", "Today", "Month", "Today"].map((h, i) => (
                    <th key={i} className="px-4 pb-2 text-right font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.name} className="border-b border-black/[0.04] hover:bg-gray-50/70">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-3 font-medium text-gray-900">{row.name}</td>
                    <td className="px-4 py-3">
                      {row.type === "group" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11.5px] font-medium text-indigo-700">
                          <Users className="h-3 w-3" />Group of {row.accountCount}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-medium text-gray-600">
                          <Building2 className="h-3 w-3" />Account
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-800">{row.visitors.mtd.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{row.visitors.today.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-800">{row.leads.mtd.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{row.leads.today.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-800">{row.conversations.mtd.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{row.conversations.today.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-800">{row.conversionRate.mtd.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right text-gray-500">{row.conversionRate.today.toFixed(2)}%</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold text-gray-900">
                  <td className="sticky left-0 z-10 bg-gray-50 px-4 py-3">Total</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right">{totals.visitors.mtd.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{totals.visitors.today.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{totals.leads.mtd.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{totals.leads.today.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{totals.conversations.mtd.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{totals.conversations.today.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{totalConversionRate.mtd}%</td>
                  <td className="px-4 py-3 text-right">{totalConversionRate.today}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
