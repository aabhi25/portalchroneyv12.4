import { useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Send, Clock, Copy } from "lucide-react";
import CampaignForm, {
  CampaignNotice,
  EMPTY_CAMPAIGN_FORM,
  campaignToFormValues,
  toDateTimeLocal,
  type CampaignFormValues,
  type StoredCampaignConfig,
} from "@/components/CampaignForm";

/**
 * Creates a campaign. With `?from=<id>` it starts as a copy of an existing campaign instead of
 * a blank form: the configuration is pre-filled, but nothing is written until the user confirms,
 * and the copy is created through the normal create endpoint. That matters — create always
 * starts a fresh row, so a copy can never inherit the original's counters, status, timestamps,
 * recipient snapshot or message history.
 */

/** Cost controls and doc scoping aren't on the form, but a copy should still inherit them. */
interface SourceCampaign extends StoredCampaignConfig {
  id: string;
  aiKnowledgeDocIds: string[] | null;
  aiDailyTokenBudget: number | null;
  aiMaxRepliesPerRecipient: number | null;
}

interface CampaignListEntry {
  id: string;
  name: string;
}

/**
 * "X (copy)", or "X (copy 2)" and up when that is taken. Campaign names aren't unique in the
 * database; this is purely so a stack of copies stays readable.
 */
export function copyName(original: string, existingNames: string[]): string {
  const taken = new Set(existingNames);
  let candidate = `${original} (copy)`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${original} (copy ${n})`;
  return candidate;
}

/**
 * A schedule that has already passed would create a campaign overdue the moment it exists, so
 * drop it and make the user pick a new time. Judge that on the minute-precision value the form
 * will actually post, not the stored timestamp — a time 30 seconds away survives the rounding
 * as a moment already in the past.
 */
function futureScheduleOnly(iso: string | null): string {
  const local = toDateTimeLocal(iso);
  if (!local) return "";
  return new Date(local).getTime() > Date.now() ? local : "";
}

export default function WhatsAppNewCampaign() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const sourceId = new URLSearchParams(search).get("from");
  const workbookGroupId = new URLSearchParams(search).get("group");
  const workbookName = new URLSearchParams(search).get("workbook");
  const listPath = "/admin/whatsapp-campaigns";

  // These keys are shared with the list and detail pages and the client caches indefinitely, so
  // without an explicit refetch a copy could be seeded from configuration that has since changed.
  const { data: source, isFetching: sourceFetching, error: sourceError } = useQuery<SourceCampaign>({
    queryKey: [`/api/whatsapp/campaigns/${sourceId}`],
    enabled: !!sourceId,
    refetchOnMount: "always",
  });

  // Only needed to pick a name that doesn't clash with an existing copy.
  const { data: existing = [], isFetching: existingFetching } = useQuery<CampaignListEntry[]>({
    queryKey: ["/api/whatsapp/campaigns"],
    enabled: !!sourceId,
    refetchOnMount: "always",
  });

  const createMutation = useMutation({
    mutationFn: async (values: CampaignFormValues) =>
      apiRequest("POST", "/api/whatsapp/campaigns", {
        ...values,
        scheduledAt: values.scheduledAt || null,
        ...(source
          ? {
              aiKnowledgeDocIds: source.aiKnowledgeDocIds ?? [],
              aiDailyTokenBudget: source.aiDailyTokenBudget ?? undefined,
              aiMaxRepliesPerRecipient: source.aiMaxRepliesPerRecipient ?? undefined,
            }
          : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaigns"] });
      toast({ title: source ? "Copy created" : "Campaign created" });
      setLocation(listPath);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Seed once, from data confirmed fresh, and hold onto it. A later background refetch must not
  // recompute these values — the form is uncontrolled from here on, and swapping them out would
  // either do nothing or throw away edits the user has already made.
  const seeded = useRef<{ id: string | null; values: CampaignFormValues } | null>(null);
  if (seeded.current && seeded.current.id !== sourceId) seeded.current = null;

  if (!seeded.current && sourceId && source && !sourceFetching && !existingFetching) {
    seeded.current = {
      id: sourceId,
      values: {
        ...campaignToFormValues(source),
        name: copyName(source.name, existing.map(c => c.name)),
        scheduledAt: futureScheduleOnly(source.scheduledAt),
      },
    };
  }
  const initialValues = seeded.current?.values || (workbookGroupId ? {
    ...EMPTY_CAMPAIGN_FORM,
    name: `${workbookName || "AI Workbook"} Campaign`,
    groupIds: [workbookGroupId],
  } : undefined);

  if (sourceId && sourceError) {
    const notFound = (sourceError as Error & { status?: number }).status === 404;
    return (
      <CampaignNotice
        title="Couldn't load the campaign you're copying"
        body={
          notFound
            ? "It may have been deleted, or it belongs to a different business account."
            : sourceError.message || "Something went wrong while loading it."
        }
        backLabel="Back to campaigns"
        onBack={() => setLocation(listPath)}
      />
    );
  }

  // The form seeds its state once at mount, so don't render it until the values are final.
  if (sourceId && !initialValues) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <CampaignForm
      key={sourceId ?? workbookGroupId ?? "new"}
      heading={source ? `Duplicate: ${source.name}` : workbookGroupId ? "Campaign from AI Workbook" : "New WhatsApp Campaign"}
      initialValues={initialValues}
      submitting={createMutation.isPending}
      pendingLabel="Creating..."
      readyPrefix="Ready to create"
      submitLabel={hasSchedule =>
        hasSchedule
          ? <><Clock className="h-4 w-4" /> Schedule Campaign</>
          : source
            ? <><Copy className="h-4 w-4" /> Create Copy</>
            : <><Send className="h-4 w-4" /> Create Draft</>
      }
      onSubmit={values => createMutation.mutate(values)}
      onCancel={() => setLocation(listPath)}
    />
  );
}
