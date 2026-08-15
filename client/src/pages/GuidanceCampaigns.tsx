import { useState } from "react";
import MoreFeaturesNavTabs from "@/components/MoreFeaturesNavTabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  Zap,
  FileText,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface GuidanceCampaign {
  id: string;
  businessAccountId: string;
  name: string;
  description: string | null;
  isActive: string;
  ruleCount?: number;
  createdAt: string;
  updatedAt: string;
}

export default function GuidanceCampaigns() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingCampaign, setDeletingCampaign] = useState<GuidanceCampaign | null>(null);

  const { data: campaigns, isLoading } = useQuery<GuidanceCampaign[]>({
    queryKey: ["/api/guidance-campaigns"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/guidance-campaigns/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guidance-campaigns"] });
      setIsDeleteDialogOpen(false);
      setDeletingCampaign(null);
      toast({
        title: "Campaign deleted",
        description: "Guidance campaign has been deleted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: string }) => {
      return await apiRequest("PUT", `/api/guidance-campaigns/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guidance-campaigns"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDelete = (campaign: GuidanceCampaign) => {
    setDeletingCampaign(campaign);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (deletingCampaign) {
      deleteMutation.mutate(deletingCampaign.id);
    }
  };

  const handleToggleActive = (campaign: GuidanceCampaign) => {
    const newIsActive = campaign.isActive === "true" ? "false" : "true";
    toggleActiveMutation.mutate({ id: campaign.id, isActive: newIsActive });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <MoreFeaturesNavTabs />
      <div className="container mx-auto py-8 px-6 space-y-8 max-w-5xl">
        
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-400 to-violet-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Guidance Campaigns
              </h1>
              <p className="text-sm text-muted-foreground">
                Organize your proactive guidance rules into campaigns with dedicated embed codes
              </p>
            </div>
          </div>
          <Button 
            onClick={() => navigate("/guidance-campaigns/new")}
            className="rounded-xl px-5 h-11 shadow-lg shadow-primary/20"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Campaign
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-2xl" />
            ))}
          </div>
        ) : campaigns && campaigns.length > 0 ? (
          <div className="space-y-4">
            {campaigns.map((campaign) => (
              <Card 
                key={campaign.id} 
                className={`border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden transition-all hover:shadow-xl cursor-pointer ${
                  campaign.isActive === "true" ? "" : "opacity-60"
                }`}
                onClick={() => navigate(`/guidance-campaigns/${campaign.id}`)}
              >
                <CardContent className="p-0">
                  <div className="flex items-stretch">
                    
                    <div 
                      className={`w-1.5 ${
                        campaign.isActive === "true" 
                          ? "bg-gradient-to-b from-emerald-400 to-emerald-600" 
                          : "bg-muted-foreground/30"
                      }`}
                    />
                    
                    <div className="flex-1 p-5">
                      <div className="flex items-start justify-between gap-4">
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-3">
                            <h3 className="font-semibold text-base">{campaign.name}</h3>
                            <Badge variant="secondary" className="text-[10px] font-normal gap-1 px-2 py-0.5">
                              <FileText className="w-3 h-3" />
                              {campaign.ruleCount || 0} rules
                            </Badge>
                          </div>
                          
                          {campaign.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                              {campaign.description}
                            </p>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-3 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                              campaign.isActive === "true" 
                                ? "bg-emerald-500/10 text-emerald-600" 
                                : "bg-muted text-muted-foreground"
                            }`}>
                              <Zap className="w-4 h-4" />
                            </div>
                            <Switch
                              checked={campaign.isActive === "true"}
                              onCheckedChange={() => handleToggleActive(campaign)}
                            />
                          </div>
                          
                          <div className="w-px h-8 bg-border" />
                          
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-xl hover:bg-primary/10"
                              onClick={() => navigate(`/guidance-campaigns/${campaign.id}`)}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 rounded-xl hover:bg-destructive/10"
                              onClick={() => handleDelete(campaign)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl">
            <CardContent className="py-16">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-muted-foreground/50" />
                </div>
                <h3 className="font-semibold text-lg mb-2">No campaigns yet</h3>
                <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                  Create your first campaign to organize guidance rules and generate dedicated embed codes
                </p>
                <Button 
                  onClick={() => navigate("/guidance-campaigns/new")}
                  className="rounded-xl px-6"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Campaign
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent className="rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{deletingCampaign?.name}"? This will also remove all rules in this campaign. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={confirmDelete} 
                className="bg-destructive text-destructive-foreground rounded-xl"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
