import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Save } from "lucide-react";
import CampaignForm, {
  CampaignNotice,
  campaignToFormValues,
  type CampaignFormValues,
  type CampaignSubmitOptions,
  type StoredCampaignConfig,
} from "@/components/CampaignForm";

/**
 * A campaign's recipient list is snapshotted from its contact groups when the send starts, so
 * configuration is only meaningful to change before that. Once it has started, the stored
 * configuration is the record of what actually went out and must not be rewritten.
 */
export const EDITABLE_STATUSES = ["draft", "scheduled"];

interface Campaign extends StoredCampaignConfig {
  id: string;
  status: string;
}

export default function WhatsAppEditCampaign() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const detailPath = `/admin/whatsapp-campaigns/${id}`;

  const { data: campaign, isLoading, error } = useQuery<Campaign>({
    queryKey: [`/api/whatsapp/campaigns/${id}`],
  });

  const saveMutation = useMutation({
    mutationFn: async ({ values, options }: { values: CampaignFormValues; options?: CampaignSubmitOptions }) => {
      await apiRequest("PATCH", `/api/whatsapp/campaigns/${id}`, {
        ...values,
        scheduledAt: values.scheduledAt || null,
        // Clearing the time turns a scheduled campaign back into a draft (it would never start otherwise).
        ...(values.campaignType === "one_time" ? { status: values.scheduledAt ? "scheduled" : "draft" } : {}),
      });
      if (!options?.sendNow) return { sendError: null as string | null, sendMessage: null as string | null };
      try {
        const sent = await apiRequest<{ message?: string; pausedForQuietHours?: boolean }>("POST", `/api/whatsapp/campaigns/${id}/send`);
        return { sendError: null, sendMessage: sent.pausedForQuietHours ? sent.message || "Quiet hours are on; sending starts when they end." : "Messages are going out now." };
      } catch (e: any) {
        return { sendError: e.message as string, sendMessage: null };
      }
    },
    onSuccess: ({ sendError, sendMessage }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaigns"] });
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      if (sendError) toast({ title: "Changes saved, but sending didn't start", description: sendError, variant: "destructive" });
      else toast({ title: sendMessage ? "Campaign started" : "Campaign updated", description: sendMessage ?? undefined });
      setLocation(detailPath);
    },
    onError: (e: any) => toast({ title: "Couldn't save changes", description: e.message, variant: "destructive" }),
  });

  if (error) {
    const notFound = (error as Error & { status?: number }).status === 404;
    return (
      <CampaignNotice
        title={notFound ? "Campaign not found" : "Couldn't load this campaign"}
        body={
          notFound
            ? "It may have been deleted, or it belongs to a different business account."
            : error.message || "Something went wrong while loading this campaign."
        }
        backLabel="Back to campaigns"
        onBack={() => setLocation("/admin/whatsapp-campaigns")}
      />
    );
  }

  if (isLoading || !campaign) {
    return <div className="p-6">Loading...</div>;
  }

  if (!EDITABLE_STATUSES.includes(campaign.status)) {
    return (
      <CampaignNotice
        title="This campaign can no longer be edited"
        body={`It is ${campaign.status}. Its recipients were fixed when the send started, so the configuration is kept as a record of what was actually sent. You can duplicate it instead to run it again.`}
        backLabel="Back to campaign"
        onBack={() => setLocation(detailPath)}
      />
    );
  }

  return (
    <CampaignForm
      // Values seed the form's state, so remount if the campaign identity changes.
      key={campaign.id}
      heading={`Edit: ${campaign.name}`}
      initialValues={campaignToFormValues(campaign)}
      submitting={saveMutation.isPending}
      pendingLabel="Saving..."
      readyPrefix="Ready to save"
      submitLabel={() => <><Save className="h-4 w-4" /> Save Changes</>}
      allowSendNow
      onSubmit={(values, options) => saveMutation.mutate({ values, options })}
      onCancel={() => setLocation(detailPath)}
    />
  );
}
