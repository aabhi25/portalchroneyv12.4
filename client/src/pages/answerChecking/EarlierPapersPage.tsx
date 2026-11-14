import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FileCheck2, Loader2 } from "lucide-react";
import { Panel } from "@/components/agency/agencyUi";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { API, ASSESS_PATH, PAPER_STATUS_LABEL, PAPER_STATUS_STYLE, fmtMarks, paperRunning, type PaperSummary } from "./answerCheckApi";

/** Answer sheets checked before assessments existed (still viewable). */
export default function EarlierPapersPage() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<{ papers: PaperSummary[] }>({ queryKey: [`${API}/papers?earlier=1`], staleTime: 0 });
  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <SaHeader icon={FileCheck2} tint="bg-orange-500" kind="Education · AI assessment (pilot)" title="Earlier papers" back={{ label: "Assessment", href: ASSESS_PATH }} />
      <SaBody>
        <Panel title="Checked before assessments existed">
          {isLoading ? <p className="text-[14px] text-gray-500">Loading…</p> : (
            <table className="w-full text-[14px]">
              <tbody>
                {(data?.papers ?? []).map(p => (
                  <tr key={p.id} onClick={() => setLocation(`${ASSESS_PATH}/papers/${p.id}`)} className="cursor-pointer border-b border-black/[0.04] hover:bg-gray-50">
                    <td className="py-2.5 pr-3 text-gray-900">{p.title || "Paper"} <span className="text-[12px] text-gray-500">{p.studentLabel}</span></td>
                    <td className="py-2.5 pr-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${PAPER_STATUS_STYLE[p.status]}`}>{paperRunning(p.status) && <Loader2 className="h-3 w-3 animate-spin" />}{PAPER_STATUS_LABEL[p.status]}</span></td>
                    <td className="py-2.5 text-right font-semibold tabular-nums">{p.totals.aiMarks === null ? "—" : `${fmtMarks(p.totals.aiMarks)}/${fmtMarks(p.totals.maxMarks)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </SaBody>
    </div>
  );
}
