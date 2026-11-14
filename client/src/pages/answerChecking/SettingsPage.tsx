import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Panel } from "@/components/agency/agencyUi";
import { QUESTION_KINDS, SCORE_BANDS, STRICTNESS, SUBJECT_KINDS, type AnswerCheckSettings, type ScopePick, type SubjectKind } from "@shared/answerCheck";
import { API, KIND_LABEL, OVERVIEW_KEY, scopeLabel, type Overview } from "./answerCheckApi";
import { AssessmentOffBanner, useScopes } from "./AssessmentSwitch";

const SUBJECT_LABEL: Record<SubjectKind, string> = { maths: "Maths", science: "Science", social_science: "Social Science", english: "English & languages", other: "Other subjects" };
const BAND_LABEL: Record<string, string> = { full: "Full marks", high: "High marks (75 % +)", partial: "Partial marks (40–75 %)", low: "Low marks", zero: "Zero" };
const selectClass = "h-9 rounded-md border border-input bg-white px-2 text-[14px]";

const sameScope = (a: ScopePick, b: ScopePick) => a.board === b.board && a.medium === b.medium && a.grade === b.grade && a.subject === b.subject;

/** Super admin › Answer checking › Settings: what the random question picks from, subject rules, when a teacher must look, feedback tone. */
export default function SettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<Overview>({ queryKey: OVERVIEW_KEY, staleTime: 0, refetchOnMount: "always" });
  const { scopes, error: scopesError } = useScopes();
  const [s, setS] = useState<AnswerCheckSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.settings && !s) setS(data.settings); }, [data]);
  if (!s) return <p className="text-[14px] text-gray-500">Loading…</p>;

  const allScopes: ScopePick[] = scopes.flatMap(o => o.subjects.map(subject => ({ board: o.board, medium: o.medium, grade: o.grade, subject })));
  const chosen = (p: ScopePick) => s.scopes.some(x => sameScope(x, p));
  const toggleScope = (p: ScopePick, on: boolean) => setS({ ...s, scopes: on ? [...s.scopes, p] : s.scopes.filter(x => !sameScope(x, p)) });
  const setRule = (k: SubjectKind, patch: Partial<AnswerCheckSettings["subjectRules"][SubjectKind]>) => setS({ ...s, subjectRules: { ...s.subjectRules, [k]: { ...s.subjectRules[k], ...patch } } });

  async function save() {
    setBusy(true);
    try {
      const res = await apiRequest<{ settings: AnswerCheckSettings }>("PUT", `${API}/settings`, { settings: s });
      setS(res.settings);
      qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
      toast({ title: "Settings saved" });
    } catch (e: any) { toast({ title: "Could not save", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5" data-testid="settings-page">
      {data && !data.enabled && <AssessmentOffBanner accountName={data.account?.name} />}
      <Panel title="Random question" subtitle="Which classes and subjects the Random question button picks from. None ticked = all of them.">
        {scopesError && <p className="mb-3 text-[14px] text-red-600">{scopesError}</p>}
        {!allScopes.length && !scopesError && <p className="text-[14px] text-gray-500">This account has no curriculum content yet.</p>}
        {allScopes.length > 0 && (
          <div className="mb-4 grid max-h-72 gap-1.5 overflow-y-auto rounded-xl border border-black/[0.06] p-3 md:grid-cols-2" data-testid="settings-scopes">
            {allScopes.map(p => (
              <label key={`${p.board}|${p.medium}|${p.grade}|${p.subject}`} className="flex items-center gap-2 text-[14px] text-gray-800">
                <Checkbox checked={chosen(p)} onCheckedChange={v => toggleScope(p, !!v)} />{scopeLabel(p)}
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-gray-700">Question types</p>
            <div className="flex gap-4">
              {QUESTION_KINDS.map(k => (
                <label key={k} className="flex items-center gap-2 text-[14px]">
                  <Checkbox checked={s.questionKinds.includes(k)} onCheckedChange={v => setS({ ...s, questionKinds: v ? [...s.questionKinds, k] : s.questionKinds.filter(x => x !== k) })} data-testid={`settings-kind-${k}`} />{KIND_LABEL[k]}
                </label>
              ))}
            </div>
          </div>
          <label className="text-[13px] font-medium text-gray-700">Marks from<Input value={s.minMarks} onChange={e => setS({ ...s, minMarks: Number(e.target.value) || 0 })} inputMode="numeric" className="mt-1 w-20" data-testid="settings-min" /></label>
          <label className="text-[13px] font-medium text-gray-700">to<Input value={s.maxMarks} onChange={e => setS({ ...s, maxMarks: Number(e.target.value) || 0 })} inputMode="numeric" className="mt-1 w-20" data-testid="settings-max" /></label>
        </div>
      </Panel>

      <Panel title="Marking rules by subject" subtitle="Used for every question in the subject, on top of each question's own marking scheme.">
        <div className="space-y-5">
          {SUBJECT_KINDS.map(k => {
            const r = s.subjectRules[k];
            return (
              <div key={k} className="rounded-xl border border-black/[0.06] p-4" data-testid={`rules-${k}`}>
                <p className="mb-3 text-[15px] font-semibold text-gray-900">{SUBJECT_LABEL[k]}</p>
                <div className="flex flex-wrap items-center gap-5">
                  <label className="text-[13px] font-medium text-gray-700">Strictness
                    <select className={`${selectClass} ml-2`} value={r.strictness} onChange={e => setRule(k, { strictness: e.target.value as any })} data-testid={`rules-${k}-strictness`}>
                      {STRICTNESS.map(x => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[13px] font-medium text-gray-700"><Switch checked={r.unitsRequired} onCheckedChange={v => setRule(k, { unitsRequired: v })} />Units required</label>
                  <label className="flex items-center gap-2 text-[13px] font-medium text-gray-700"><Switch checked={r.diagramsCount} onCheckedChange={v => setRule(k, { diagramsCount: v })} />Diagrams count</label>
                  <label className="text-[13px] font-medium text-gray-700">Spelling & grammar
                    <select className={`${selectClass} ml-2`} value={r.languageWeight} onChange={e => setRule(k, { languageWeight: e.target.value as any })}>
                      <option value="none">Don't count</option><option value="some">Count a little</option><option value="full">Count fully</option>
                    </select>
                  </label>
                </div>
                <Textarea value={r.notes} onChange={e => setRule(k, { notes: e.target.value })} rows={2} className="mt-3 text-[14px]" placeholder="Extra instructions for the marker" />
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="When a teacher must look" subtitle="Answers below these levels are marked “Needs a teacher” instead of going straight to the student.">
        <div className="flex flex-wrap gap-6">
          <label className="text-[13px] font-medium text-gray-700">Handwriting readable below (%)
            <Input value={Math.round(s.legibilityThreshold * 100)} onChange={e => setS({ ...s, legibilityThreshold: (Number(e.target.value) || 0) / 100 })} inputMode="numeric" className="mt-1 w-24" data-testid="settings-legibility" />
          </label>
          <label className="text-[13px] font-medium text-gray-700">AI sure of its marks below (%)
            <Input value={Math.round(s.confidenceThreshold * 100)} onChange={e => setS({ ...s, confidenceThreshold: (Number(e.target.value) || 0) / 100 })} inputMode="numeric" className="mt-1 w-24" data-testid="settings-confidence" />
          </label>
        </div>
        <p className="mt-2 text-[13px] text-gray-500">Blank pages and answers with three or more unreadable parts always go to a teacher.</p>
      </Panel>

      <Panel title="Feedback tone" subtitle="How the AI talks to the student at each score.">
        <div className="grid gap-3 md:grid-cols-2">
          {SCORE_BANDS.map(b => (
            <label key={b} className="block text-[13px] font-medium text-gray-700">{BAND_LABEL[b]}
              <Textarea value={s.feedbackTone[b]} onChange={e => setS({ ...s, feedbackTone: { ...s.feedbackTone, [b]: e.target.value } })} rows={2} className="mt-1 text-[14px]" />
            </label>
          ))}
        </div>
      </Panel>

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={save} disabled={busy} className="shadow-lg" data-testid="settings-save">{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save settings</Button>
      </div>
    </div>
  );
}
