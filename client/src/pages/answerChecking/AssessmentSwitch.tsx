import { useQuery } from "@tanstack/react-query";
import { OVERVIEW_KEY, SCOPES_KEY, type Overview, type ScopesResponse } from "./answerCheckApi";

/** Whether AI assessment is switched on for the account being viewed (null while loading). */
export function useAssessmentOn(): { on: boolean | null; overview: Overview | undefined } {
  const { data } = useQuery<Overview>({ queryKey: OVERVIEW_KEY, staleTime: 0, refetchOnMount: "always" });
  return { on: data ? data.enabled : null, overview: data };
}

/** The account's classes and subjects (loaded on their own: a large content store can be slow). */
export function useScopes(): { scopes: ScopesResponse["scopes"]; error: string | null; loading: boolean } {
  const { data, isLoading } = useQuery<ScopesResponse>({ queryKey: SCOPES_KEY });
  return { scopes: data?.scopes ?? [], error: data?.error ?? null, loading: isLoading };
}

/** Shown on the assessment pages while the account's feature switch is off. */
export function AssessmentOffBanner({ accountName }: { accountName?: string }) {
  return (
    <div className="rounded-xl bg-gray-100 px-4 py-3 text-[14px] text-gray-800" data-testid="assessment-off">
      <b>AI assessment is switched off{accountName ? ` for ${accountName}` : ""}.</b> Nothing is checked and no AI cost is spent while it's off; earlier results stay here.
      Switch it on in <b>Settings › Features</b> (AI assessment).
    </div>
  );
}
