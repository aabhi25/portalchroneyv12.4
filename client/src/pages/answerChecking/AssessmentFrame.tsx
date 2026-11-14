import type { ReactNode } from "react";
import { FileCheck2 } from "lucide-react";
import { SaBody, SaHeader } from "@/components/superadmin/SuperAdminFrame";
import { ASSESS_PATH } from "./answerCheckApi";

export type AssessmentTab = "check" | "papers" | "history" | "settings";

const TABS: Array<{ key: AssessmentTab; label: string; href: string }> = [
  { key: "check", label: "Check an answer", href: ASSESS_PATH },
  { key: "papers", label: "Whole paper", href: `${ASSESS_PATH}/papers` },
  { key: "history", label: "History & accuracy", href: `${ASSESS_PATH}/history` },
  { key: "settings", label: "Settings", href: `${ASSESS_PATH}/settings` },
];

/** Education › Assessment (AI assessment pilot, super admins viewing the account): header and tabs. */
export function AssessmentFrame({ tab, children }: { tab: AssessmentTab; children: ReactNode }) {
  return (
    <div className="min-h-full bg-[#f5f5f7]" data-testid="assessment-frame">
      <SaHeader icon={FileCheck2} tint="bg-orange-500" kind="Education · AI assessment (pilot)" title="Assessment" tabs={TABS} activeTab={tab} />
      <SaBody>{children}</SaBody>
    </div>
  );
}
