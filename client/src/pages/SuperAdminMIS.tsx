import { useQuery } from "@tanstack/react-query";
import { Loader2, BarChart3, Users, Building2, Download } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
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
    <div className="flex flex-col h-screen">
      <header className="border-b bg-gradient-to-r from-red-600 via-purple-600 to-blue-600 text-white p-4">
        <div className="flex items-center gap-3">
          <SidebarTrigger className="text-white hover:bg-white/20" />
          <div>
            <h1 className="text-lg font-semibold">AI Chroney</h1>
            <p className="text-sm text-white/80">MIS Dashboard</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 bg-gray-50 dark:bg-gray-900">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-6 w-6 text-purple-600" />
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">MIS Report</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Month-to-date and today's metrics across all partners
              </p>
            </div>
          </div>
          {data && data.length > 0 && totals && (
            <Button
              onClick={() => downloadPDF(data, totals, totalConversionRate)}
              className="bg-purple-600 hover:bg-purple-700 text-white gap-2"
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

        {data && data.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-purple-600 text-white">
                  <th className="px-4 py-3 text-left font-semibold border-r border-purple-500" rowSpan={2}>
                    Partner Name
                  </th>
                  <th className="px-4 py-3 text-center font-semibold border-r border-purple-500" rowSpan={2}>
                    Type
                  </th>
                  <th className="px-4 py-2 text-center font-semibold border-r border-purple-500" colSpan={2}>
                    Visitors
                  </th>
                  <th className="px-4 py-2 text-center font-semibold border-r border-purple-500" colSpan={2}>
                    Leads
                  </th>
                  <th className="px-4 py-2 text-center font-semibold border-r border-purple-500" colSpan={2}>
                    Conversations
                  </th>
                  <th className="px-4 py-2 text-center font-semibold" colSpan={2}>
                    Conversion Rate
                  </th>
                </tr>
                <tr className="bg-purple-500 text-white text-xs">
                  <th className="px-4 py-2 text-center font-medium border-r border-purple-400">MTD</th>
                  <th className="px-4 py-2 text-center font-medium border-r border-purple-400">Today</th>
                  <th className="px-4 py-2 text-center font-medium border-r border-purple-400">MTD</th>
                  <th className="px-4 py-2 text-center font-medium border-r border-purple-400">Today</th>
                  <th className="px-4 py-2 text-center font-medium border-r border-purple-400">MTD</th>
                  <th className="px-4 py-2 text-center font-medium border-r border-purple-400">Today</th>
                  <th className="px-4 py-2 text-center font-medium border-r border-purple-400">MTD</th>
                  <th className="px-4 py-2 text-center font-medium">Today</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr
                    key={row.name}
                    className={`border-b border-gray-100 dark:border-gray-700 ${
                      i % 2 === 0 ? "bg-white dark:bg-gray-800" : "bg-gray-50 dark:bg-gray-750"
                    } hover:bg-purple-50 dark:hover:bg-gray-700 transition-colors`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white border-r border-gray-100 dark:border-gray-700">
                      {row.name}
                    </td>
                    <td className="px-4 py-3 text-center border-r border-gray-100 dark:border-gray-700">
                      {row.type === "group" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                          <Users className="h-3 w-3" />
                          Group ({row.accountCount})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          <Building2 className="h-3 w-3" />
                          Individual
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-700">
                      {row.visitors.mtd.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-700">
                      {row.visitors.today.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-700">
                      {row.leads.mtd.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-700">
                      {row.leads.today.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-700">
                      {row.conversations.mtd.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-700">
                      {row.conversations.today.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-700">
                      {row.conversionRate.mtd.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300">
                      {row.conversionRate.today.toFixed(2)}%
                    </td>
                  </tr>
                ))}
                <tr className="bg-purple-100 dark:bg-purple-900/30 font-bold border-t-2 border-purple-300 dark:border-purple-700">
                  <td className="px-4 py-3 text-gray-900 dark:text-white border-r border-purple-200 dark:border-purple-700">
                    Total
                  </td>
                  <td className="px-4 py-3 text-center text-gray-900 dark:text-white border-r border-purple-200 dark:border-purple-700">
                  </td>
                  <td className="px-4 py-3 text-center text-gray-900 dark:text-white border-r border-purple-200 dark:border-purple-700">
                    {totals?.visitors.mtd.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-900 dark:text-white border-r border-purple-200 dark:border-purple-700">
                    {totals?.visitors.today.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-900 dark:text-white border-r border-purple-200 dark:border-purple-700">
                    {totals?.leads.mtd.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-900 dark:text-white border-r border-purple-200 dark:border-purple-700">
                    {totals?.leads.today.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-900 dark:text-white border-r border-purple-200 dark:border-purple-700">
                    {totals?.conversations.mtd.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-900 dark:text-white border-r border-purple-200 dark:border-purple-700">
                    {totals?.conversations.today.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-900 dark:text-white border-r border-purple-200 dark:border-purple-700">
                    {totalConversionRate.mtd}%
                  </td>
                  <td className="px-4 py-3 text-center text-gray-900 dark:text-white">
                    {totalConversionRate.today}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
