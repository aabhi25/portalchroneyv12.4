import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Save } from "lucide-react";
import CampaignForm, {
  CampaignNotice,
  campaignToFormValues,
  type CampaignFormValues,
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
    mutationFn: async (values: CampaignFormValues) =>
      apiRequest("PATCH", `/api/whatsapp/campaigns/${id}`, {
        ...values,
        scheduledAt: values.scheduledAt || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/campaigns"] });
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${id}`] });
      toast({ title: "Campaign updated" });
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
      onSubmit={values => saveMutation.mutate(values)}
      onCancel={() => setLocation(detailPath)}
    />
  );
}
