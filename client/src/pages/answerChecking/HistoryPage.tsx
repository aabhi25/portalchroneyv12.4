import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, Stat } from "@/components/agency/agencyUi";
import { AnswersList } from "./CheckAnswerPage";
import { API, fmtCost, isRunning, type AccuracySummary, type ChecksResponse } from "./answerCheckApi";

type Source = "" | "upload" | "practice";

function share(a: AccuracySummary): string {
  return a.compared ? `${a.withinHalf} of ${a.compared}` : "—";
}

/** Super admin › Answer checking › History & accuracy: every check, and how close the AI is to teachers and to expected marks. */
export default function HistoryPage() {
  const [source, setSource] = useState<Source>("");
  const { data, isLoading } = useQuery<ChecksResponse>({
    queryKey: [`${API}/checks?limit=500${source ? `&source=${source}` : ""}`],
    refetchInterval: q => (q.state.data?.checks.some(isRunning) ? 4000 : false),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const a = data?.accuracy;
  const pct = (x: AccuracySummary) => (x.compared ? ` (${Math.round((x.withinHalf / x.compared) * 100)}%)` : "");
  return (
    <div className="space-y-5" data-testid="history-page">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Answers checked" value={a?.total ?? "—"} hint={a?.needsTeacher ? `${a.needsTeacher} need a teacher` : undefined} />
        <Stat label="Within ½ mark of the teacher" value={a ? share(a.teacher) + pct(a.teacher) : "—"} hint={a?.teacher.compared ? `average gap ${a.teacher.averageGap} · AI higher ${a.teacher.aiHigher}, lower ${a.teacher.aiLower}` : "enter teacher marks on an answer"} />
        <Stat label="Within ½ mark of expected (practice)" value={a ? share(a.expected) + pct(a.expected) : "—"} hint={a?.expected.compared ? `average gap ${a.expected.averageGap}` : undefined} />
        <Stat label="Average time" value={a?.averageSeconds ? `${a.averageSeconds} s` : "—"} />
        <Stat label="Average AI cost per answer" value={a?.averageCostUsd ? fmtCost(a.averageCostUsd) : "—"} />
      </div>
      <Panel
        title="All checked answers"
        subtitle="The AI's gap from expected or teacher marks is in brackets: green = within half a mark."
        actions={
          <>
            <div className="inline-flex rounded-full bg-gray-100 p-1">
              {([["", "All"], ["upload", "Uploads"], ["practice", "Practice"]] as Array<[Source, string]>).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setSource(v)} data-testid={`history-filter-${v || "all"}`}
                  className={`rounded-full px-3 py-1 text-[13px] font-medium ${source === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"}`}>{l}</button>
              ))}
            </div>
            <Button variant="outline" size="sm" asChild><a href={`${API}/export.csv`} data-testid="history-export"><Download className="mr-1 h-3.5 w-3.5" />Download spreadsheet</a></Button>
          </>
        }
      >
        {isLoading ? <p className="text-[14px] text-gray-500">Loading…</p> : <AnswersList checks={data?.checks ?? []} showQuestion />}
      </Panel>
    </div>
  );
}
