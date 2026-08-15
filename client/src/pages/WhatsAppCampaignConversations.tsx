import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  CampaignConversationsPanel,
  type Recipient,
  type CampaignMessage,
} from "@/components/whatsapp/CampaignConversationsPanel";

interface CampaignSummary {
  id: string; name: string; status: string;
  startedAt: string | null; completedAt: string | null; createdAt: string;
  totalRecipients: number; repliedCount: number;
}
interface CampaignDetail {
  id: string; name: string; status: string;
  aiEnabled: string; aiAgentName: string;
}
interface RecipientsResponse {
  recipients: Recipient[];
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", scheduled: "secondary", sending: "secondary",
  completed: "default", cancelled: "destructive", failed: "destructive",
};

export default function WhatsAppCampaignConversations() {
  const { toast } = useToast();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null);

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery<CampaignSummary[]>({
    queryKey: ["/api/whatsapp/campaigns"],
    refetchOnMount: "always",
  });

  // Default to the first campaign once list loads
  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      setSelectedCampaignId(campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

  // Reset selected recipient when campaign changes
  const handleCampaignChange = (id: string) => {
    setSelectedCampaignId(id);
    setSelectedRecipient(null);
  };

  const { data: campaignDetail } = useQuery<CampaignDetail>({
    queryKey: [`/api/whatsapp/campaigns/${selectedCampaignId}`],
    enabled: !!selectedCampaignId,
    refetchInterval: (q) => (q.state.error ? false : 10000),
  });

  const { data: recipientsData, isLoading: recipientsLoading } = useQuery<RecipientsResponse>({
    queryKey: [`/api/whatsapp/campaigns/${selectedCampaignId}/recipients`],
    enabled: !!selectedCampaignId,
    refetchInterval: (q) => (q.state.error ? false : 10000),
    refetchOnMount: "always",
  });
  const recipients = recipientsData?.recipients ?? [];

  const { data: messages = [] } = useQuery<CampaignMessage[]>({
    queryKey: [`/api/whatsapp/campaigns/${selectedCampaignId}/recipients/${selectedRecipient?.id}/messages`],
    enabled: !!selectedCampaignId && !!selectedRecipient,
    refetchInterval: 5000,
    refetchOnMount: "always",
  });

  const reconcileMutation = useMutation({
    mutationFn: async () =>
      apiRequest<{ checked: number; updated: number }>("POST", `/api/whatsapp/campaigns/${selectedCampaignId}/reconcile`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${selectedCampaignId}/recipients`] });
      const checked = data?.checked ?? 0;
      const updated = data?.updated ?? 0;
      toast({ title: checked === 0 ? "Nothing to refresh" : `Refreshed ${checked} — updated ${updated}` });
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: e.message, variant: "destructive" }),
  });

  const resendOneMutation = useMutation({
    mutationFn: async (recipientId: string) =>
      apiRequest<{ requeued: number }>("POST", `/api/whatsapp/campaigns/${selectedCampaignId}/recipients/${recipientId}/resend`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/campaigns/${selectedCampaignId}/recipients`] });
      toast({ title: data?.requeued > 0 ? "Recipient queued for resend" : "Nothing to resend" });
    },
    onError: (e: any) => toast({ title: "Resend failed", description: e.message, variant: "destructive" }),
  });

  if (campaignsLoading) {
    return <div className="p-6 text-center text-gray-500">Loading campaigns…</div>;
  }

  if (campaigns.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center">
        <MessageCircle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-700">No campaigns yet</h2>
        <p className="text-sm text-gray-500 mt-1">
          Create and send a campaign — its conversations will appear here.
        </p>
      </div>
    );
  }

  const selectedSummary = campaigns.find(c => c.id === selectedCampaignId);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* Campaign selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 shrink-0">Campaign</label>
        <Select value={selectedCampaignId ?? ""} onValueChange={handleCampaignChange}>
          <SelectTrigger className="w-80">
            <SelectValue placeholder="Select a campaign…" />
          </SelectTrigger>
          <SelectContent>
            {campaigns.map(c => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex items-center gap-2">
                  {c.name}
                  <Badge variant={STATUS_VARIANT[c.status] || "outline"} className="text-[10px] px-1.5 py-0 h-4">
                    {c.status}
                  </Badge>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedSummary && (
          <span className="text-xs text-gray-500">
            {selectedSummary.totalRecipients} recipients · {selectedSummary.repliedCount} replied
          </span>
        )}
      </div>

      {/* Conversation split pane */}
      <CampaignConversationsPanel
        campaign={campaignDetail ?? null}
        recipients={recipients}
        isLoading={recipientsLoading}
        selectedRecipient={selectedRecipient}
        setSelectedRecipient={setSelectedRecipient}
        messages={messages}
        reconcileMutation={reconcileMutation}
        resendOneMutation={resendOneMutation}
      />
    </div>
  );
}
