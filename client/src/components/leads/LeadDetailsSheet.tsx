import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, Eye, FileText, GitBranch, Loader2, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import type { Lead } from "@shared/schema";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatCrmSyncError } from "@/lib/crmSyncError";
import { LeadCallsPanel } from "@/components/calling/LeadCallsPanel";
import { LeadStoryTimeline } from "./LeadStoryTimeline";
import { CHANNEL_META, ChannelBadge, ChannelTrail, type SocialCrm, type UnifiedLeadRow } from "./UnifiedLeadParts";
import { crmStatusLook, syncButtonLabel, type CrmTarget } from "./LeadCrm";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-gray-400">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-gray-900">{children || <span className="text-gray-400">—</span>}</dd>
    </>
  );
}

/** A website lead as a row of the unified list (for links that open one lead directly). */
export function websiteRowFromLead(lead: Lead): UnifiedLeadRow {
  const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
  return {
    key: `website:${lead.id}`,
    channel: "website",
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    capturedAt: iso(lead.lastEnquiryAt ?? lead.createdAt)!,
    firstCapturedAt: iso(lead.createdAt)!,
    enquiryCount: lead.enquiryCount ?? 1,
    crm: {
      leadsquared: { status: lead.leadsquaredSyncStatus, error: lead.leadsquaredSyncError, syncedAt: iso(lead.leadsquaredSyncedAt), crmLeadId: lead.leadsquaredLeadId },
      salesforce: { status: lead.salesforceSyncStatus, error: lead.salesforceSyncError, syncedAt: iso(lead.salesforceSyncedAt), crmLeadId: lead.salesforceLeadId },
      customCrm: { status: lead.customCrmSyncStatus, error: lead.customCrmSyncError, syncedAt: iso(lead.customCrmSyncedAt), crmLeadId: lead.customCrmLeadId },
    },
    detail: lead as unknown as Record<string, any>,
  };
}

/**
 * Everything about one lead, from any channel, in a panel on the right: contact details, where
 * they came from, each CRM's status with Sync / Retry, what was captured, and phone calls.
 */
export function LeadDetailsSheet({
  row, onClose, targets, isSyncing, onSync, onSelectRow, onViewChat, onViewForm, onViewJourney, onOpenChannelPage, onDelete, showInternalIds,
  journeyResponsesUrl, showCalls = true, showStory = true, onOpenConversation, accountName, noCrmText = "No CRM is connected. Connect one in Settings › Connected apps.",
}: {
  row: UnifiedLeadRow | null;
  onClose: () => void;
  targets: CrmTarget[];
  isSyncing: (crm: SocialCrm) => boolean;
  onSync: (crm: SocialCrm) => void;
  /** Show another of this person's rows (same person on another channel). */
  onSelectRow: (row: UnifiedLeadRow) => void;
  onViewChat?: () => void;
  onViewForm?: () => void;
  onViewJourney?: () => void;
  onOpenChannelPage?: () => void;
  onDelete?: () => void;
  showInternalIds: boolean;
  /** Where the lead's journey answers come from (default: the business account's lead API). */
  journeyResponsesUrl?: string;
  /** The phone calls panel (business accounts only). */
  showCalls?: boolean;
  /** The story so far + cross-channel timeline (business accounts only). */
  showStory?: boolean;
  /** Open one of the person's website chats (from the timeline). */
  onOpenConversation?: (conversationId: string) => void;
  /** The business the lead belongs to (group admin view). */
  accountName?: string | null;
  /** Shown in "CRM sync" when there is nothing to list. */
  noCrmText?: string;
}) {
  const { toast } = useToast();
  const website = row?.channel === "website" ? (row.detail as unknown as Lead) : null;
  const extracted: Record<string, any> = (!website && row?.detail?.extractedData) || {};
  const extractedEntries = Object.entries(extracted).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object" && String(v).trim() !== "");
  const sender = row && !website ? (row.detail?.senderUsername ? `@${row.detail.senderUsername}` : row.detail?.senderName || row.detail?.senderPhone || null) : null;
  // Interests only (journey answers are listed below with their questions). The list API sends
  // interestTopics; a lead opened from a link falls back to the stored topics minus funnel markers.
  const FUNNEL_MARKERS = ["Via Form", "Via Journey Form", "Discount Availed"];
  const listedInterests = (row?.detail as any)?.interestTopics as string[] | undefined;
  const storedTopics = website && Array.isArray(website.topicsOfInterest) ? (website.topicsOfInterest as string[]) : [];
  const { data: journey } = useQuery<{ journeyName: string | null; responses: Array<{ question: string; answer: string; stepOrder: number }> }>({
    queryKey: [journeyResponsesUrl || "/api/leads", website?.id, "journey-responses"],
    queryFn: async () => {
      const res = await fetch(journeyResponsesUrl || `/api/leads/${website!.id}/journey-responses`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load journey answers");
      return res.json();
    },
    enabled: !!website?.id && !!website?.conversationId,
  });
  const journeyAnswers = (journey?.responses || []).filter(r => r.answer && r.answer.trim());
  const answerTexts = new Set(journeyAnswers.map(r => r.answer.trim().toLowerCase()));
  const topics = (Array.isArray(listedInterests) ? listedInterests : storedTopics)
    .filter(t => !FUNNEL_MARKERS.includes(t) && !answerTexts.has(t.trim().toLowerCase()));
  const city = website ? website.city : typeof extracted.city === "string" ? extracted.city : null;
  // What was last sent to each CRM ("_hash" and other internal keys left out). Hidden when phones are masked.
  const sentFields = (payload: unknown) => payload && typeof payload === "object"
    ? Object.entries(payload as Record<string, unknown>).filter(([k]) => !k.startsWith("_")) : [];
  const syncedFieldLists = [
    { crm: "leadsquared", label: "LeadSquared", fields: sentFields(website?.leadsquaredSyncPayload) },
    { crm: "meritto", label: "Meritto", fields: sentFields(website?.merittoSyncPayload) },
  ].filter(l => l.fields.length > 0);

  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast({ title: "Copied", description: `${what} copied.` }),
      () => toast({ title: "Couldn't copy", description: "Select the text and copy it yourself.", variant: "destructive" }),
    );
  };

  return (
    <Sheet open={!!row} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[520px]" data-testid="lead-details-sheet">
        {row && (
          <div className="px-6 pb-10 pt-6">
            <SheetHeader className="space-y-1 text-left">
              <p className="text-[12px] text-gray-500">Lead</p>
              <SheetTitle className="text-[24px] font-semibold tracking-tight">{row.name || "Anonymous"}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2 text-[13px]">
                <ChannelTrail row={row} />
                <span>· {format(new Date(row.capturedAt), "d MMM yyyy, h:mm a")}</span>
              </SheetDescription>
            </SheetHeader>

            {showStory && (row.channel === "website" || row.channel === "whatsapp") && (
              <LeadStoryTimeline channel={row.channel} id={row.id} onOpenConversation={onOpenConversation} />
            )}

            <Section title="Contact">
              <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px]">
                <Field label="Phone"><span className="font-mono">{row.phone}</span></Field>
                <Field label="Email">{row.email}</Field>
                <Field label="City">{city}</Field>
                {sender && <Field label="From">{sender}</Field>}
              </dl>
            </Section>

            <Section title="Where they came from">
              <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px]">
                {accountName && <Field label="Account">{accountName}</Field>}
                <Field label="Channel"><ChannelBadge channel={row.channel} /></Field>
                {website?.sourceUrl && (
                  <Field label="Page">
                    <a href={website.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-purple-700 hover:underline">{website.sourceUrl}</a>
                  </Field>
                )}
                {(row.enquiryCount ?? 1) > 1 && row.firstCapturedAt ? (
                  <>
                    <Field label="Latest enquiry">{format(new Date(row.capturedAt), "PPpp")} <span className="text-gray-500">· {row.enquiryCount} enquiries</span></Field>
                    <Field label="First enquiry">{format(new Date(row.firstCapturedAt), "PPpp")}</Field>
                  </>
                ) : (
                  <Field label="Captured">{format(new Date(row.capturedAt), "PPpp")}</Field>
                )}
              </dl>
              {row.linked && row.linked.length > 0 && (
                <div className="mt-3 rounded-xl border border-black/[0.07] bg-gray-50 p-3">
                  <p className="text-[12.5px] text-gray-600">The same person also reached you on:</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.linked.map(l => (
                      <button key={l.key} type="button" onClick={() => onSelectRow(l)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-[12.5px] shadow-sm hover:bg-purple-50" data-testid={`lead-linked-${l.channel}`}>
                        <ChannelBadge channel={l.channel} />
                        <span className="text-gray-500">{format(new Date(l.capturedAt), "d MMM")}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {onViewChat && <Button variant="outline" size="sm" onClick={onViewChat}><Eye className="mr-1.5 h-4 w-4" />View chat</Button>}
                {onViewForm && <Button variant="outline" size="sm" onClick={onViewForm}><FileText className="mr-1.5 h-4 w-4" />View form</Button>}
                {onViewJourney && <Button variant="outline" size="sm" onClick={onViewJourney}><GitBranch className="mr-1.5 h-4 w-4" />View journey answers</Button>}
                {onOpenChannelPage && CHANNEL_META[row.channel].page && (
                  <Button variant="outline" size="sm" onClick={onOpenChannelPage}><ExternalLink className="mr-1.5 h-4 w-4" />Open in {CHANNEL_META[row.channel].label}</Button>
                )}
              </div>
            </Section>

            <Section title="CRM sync">
              {targets.length === 0 ? (
                <p className="text-[13.5px] text-gray-500">{noCrmText}</p>
              ) : (
                <ul className="overflow-hidden rounded-xl border border-black/[0.07] bg-white">
                  {targets.map(t => {
                    const look = crmStatusLook(t.state?.status);
                    const syncing = isSyncing(t.crm);
                    const showError = t.state?.error && t.state.status !== "synced";
                    return (
                      <li key={t.crm} className="border-t border-black/[0.06] px-4 py-3 first:border-t-0" data-testid={`lead-crm-${t.crm}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-medium text-gray-900">{t.label}</span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${look.className}`}>{syncing ? "Sending…" : look.text}</span>
                          {t.state?.syncedAt && t.state.status === "synced" && (
                            <span className="text-[12px] text-gray-500">{format(new Date(t.state.syncedAt), "d MMM, h:mm a")}</span>
                          )}
                          {t.canSync && (
                            <Button size="sm" className="ml-auto h-7 px-2.5 text-[12.5px]" variant={t.state?.status ? "outline" : "default"} onClick={() => onSync(t.crm)} disabled={syncing} data-testid={`button-sheet-sync-${t.crm}`}>
                              {syncing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                              {syncButtonLabel(t)}
                            </Button>
                          )}
                        </div>
                        {t.state?.crmLeadId && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-gray-500">
                            {t.label} ID <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">{t.state.crmLeadId}</code>
                            <button type="button" aria-label={`Copy ${t.label} ID`} onClick={() => copy(t.state!.crmLeadId!, `${t.label} ID`)} className="text-gray-400 hover:text-gray-700"><Copy className="h-3.5 w-3.5" /></button>
                          </div>
                        )}
                        {t.state?.status === "disqualified" && (
                          <p className="mt-1.5 text-[12.5px] text-amber-700">Not sent because {t.state.error || "the answer did not match the qualifying values"}.</p>
                        )}
                        {showError && t.state?.status !== "disqualified" && (
                          <p className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12.5px] text-red-700">{formatCrmSyncError(t.state!.error)}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {syncedFieldLists.map(list => (
                <details key={list.crm} className="mt-2 text-[12.5px]" data-testid={`lead-sent-fields-${list.crm}`}>
                  <summary className="cursor-pointer text-gray-500">Fields sent to {list.label}{list.crm === "meritto" ? " (last send)" : ""}</summary>
                  <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-gray-50 p-3">
                    {list.fields.map(([k, v]) => (
                      <div key={k} className="flex gap-2"><span className="min-w-[130px] font-mono text-gray-500">{k}</span><span className="break-all text-gray-800">{v == null ? "—" : String(v)}</span></div>
                    ))}
                  </div>
                </details>
              ))}
            </Section>

            {(topics.length > 0 || journeyAnswers.length > 0 || website?.message || extractedEntries.length > 0) && (
              <Section title="What they told us">
                {journeyAnswers.length > 0 && (
                  <div className="mb-3">
                    {journey?.journeyName && (
                      <p className="mb-1.5 flex items-center gap-1 text-[12px] text-gray-500">
                        <GitBranch className="h-3.5 w-3.5" />
                        {journey.journeyName}
                      </p>
                    )}
                    <dl className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                      {journeyAnswers.map((r, i) => (
                        <div key={i} className="px-3 py-2">
                          <dt className="text-[12px] text-gray-500">{r.question}</dt>
                          <dd className="text-[14px] font-medium text-gray-900">{r.answer}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                {topics.length > 0 && (
                  <div>
                    {journeyAnswers.length > 0 && <p className="mb-1.5 text-[12px] text-gray-500">Interests</p>}
                    <div className="flex flex-wrap gap-1.5">
                      {topics.map((t, i) => <span key={i} className="rounded-full bg-purple-50 px-2.5 py-0.5 text-[12.5px] text-purple-700">{t}</span>)}
                    </div>
                  </div>
                )}
                {website?.message && <p className="mt-2 text-[14px] text-gray-700">{website.message}</p>}
                {extractedEntries.length > 0 && (
                  <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13.5px]">
                    {extractedEntries.map(([k, v]) => <Field key={k} label={k.replace(/_/g, " ")}>{String(v)}</Field>)}
                  </dl>
                )}
              </Section>
            )}

            {website && showCalls && (
              <div className="mt-6">
                <LeadCallsPanel leadId={website.id} leadName={website.name} phone={website.phone} />
              </div>
            )}

            {(onDelete || showInternalIds) && (
              <Section title="More">
                {showInternalIds && (
                  <p className="text-[12px] text-gray-500">
                    Lead ID <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">{row.id}</code>
                    {website?.conversationId && <> · Conversation <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">{website.conversationId}</code></>}
                  </p>
                )}
                {onDelete && (
                  <Button variant="outline" size="sm" className="mt-3 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={onDelete}>
                    <Trash2 className="mr-1.5 h-4 w-4" />Delete lead
                  </Button>
                )}
              </Section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
