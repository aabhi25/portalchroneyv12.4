import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FileCheck2, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/agency/agencyUi";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { AssessmentOffBanner, useAssessmentOn } from "./AssessmentSwitch";
import { API, ASSESS_PATH, fmtMarks, scopeLabel, type AssessmentSummary } from "./answerCheckApi";

/** Education › Assessment: the assessments (mock tests) and a button to create one. */
export default function AssessmentsHome() {
  const [, setLocation] = useLocation();
  const { on, overview } = useAssessmentOn();
  const { data, isLoading } = useQuery<{ assessments: AssessmentSummary[]; earlierPapers: number }>({ queryKey: [`${API}/assessments`], staleTime: 0, refetchOnMount: "always" });
  const list = data?.assessments ?? [];
  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <SaHeader
        icon={FileCheck2}
        tint="bg-orange-500"
        kind="Education · AI assessment (pilot)"
        title="Assessment"
        subtitle="Set up a test with its questions and model answers, upload a student's answer sheet, and the AI teacher checks it."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setLocation(`${ASSESS_PATH}/rules`)} data-testid="open-rules"><SlidersHorizontal className="mr-1.5 h-4 w-4" />Marking rules</Button>
            <Button onClick={() => setLocation(`${ASSESS_PATH}/new`)} disabled={on === false} data-testid="new-assessment"><Plus className="mr-1.5 h-4 w-4" />New assessment</Button>
          </>
        }
      />
      <SaBody>
        {on === false && <AssessmentOffBanner accountName={overview?.account?.name} />}
        {overview?.account && !overview.account.hasKey && <div className="rounded-xl bg-amber-50 px-4 py-3 text-[14px] text-amber-900">This account has no OpenAI key, so answers can't be checked. A super admin can add it on the account's "AI & keys" tab.</div>}
        {isLoading ? <p className="text-[14px] text-gray-500">Loading…</p> : list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center" data-testid="assessments-empty">
            <p className="text-[17px] font-semibold text-gray-900">No assessments yet</p>
            <p className="mx-auto mt-1 max-w-md text-[14px] text-gray-500">Create one from the client's question paper: import the PDF or Word file with its answers, or type the questions. Then upload students' answer sheets to check.</p>
            <Button className="mt-4" onClick={() => setLocation(`${ASSESS_PATH}/new`)} disabled={on === false}><Plus className="mr-1.5 h-4 w-4" />New assessment</Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="assessments-list">
            {list.map(a => (
              <button key={a.id} type="button" onClick={() => setLocation(`${ASSESS_PATH}/${a.id}`)} data-testid={`assessment-card-${a.id}`}
                className="rounded-2xl border border-black/[0.06] bg-white p-5 text-left transition hover:border-violet-300 hover:shadow-sm">
                <p className="text-[16px] font-semibold text-gray-900">{a.title}</p>
                <p className="mt-0.5 text-[13px] text-gray-500">{scopeLabel(a) || "No class set"}{a.mockTestId ? ` · Mock test ${a.mockTestId}` : ""}</p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-gray-600">
                  <span><b className="text-gray-900">{a.questionCount}</b> question{a.questionCount === 1 ? "" : "s"}</span>
                  <span><b className="text-gray-900">{fmtMarks(a.totalMarks)}</b> marks</span>
                  <span><b className="text-gray-900">{a.sheetCount}</b> sheet{a.sheetCount === 1 ? "" : "s"} checked</span>
                </div>
              </button>
            ))}
          </div>
        )}
        {!!data?.earlierPapers && (
          <Panel title="Earlier papers" subtitle="Answer sheets checked before assessments existed.">
            <Button variant="outline" size="sm" onClick={() => setLocation(`${ASSESS_PATH}/earlier`)}>Show {data.earlierPapers} earlier paper{data.earlierPapers === 1 ? "" : "s"}</Button>
          </Panel>
        )}
      </SaBody>
    </div>
  );
}
