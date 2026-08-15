import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { ArrowLeft, Sparkles, Save, Plus, Zap, Edit2, Trash2, Link2, MessageSquareText, Settings } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface GuidanceCampaign {
  id: string;
  businessAccountId: string;
  name: string;
  description: string | null;
  isActive: string;
  showHeader: string;
  createdAt: string;
  updatedAt: string;
}

interface ProactiveGuidanceRule {
  id: string;
  businessAccountId: string;
  name: string;
  urlPattern: string;
  message: string;
  isActive: string;
  priority: number;
  campaignId: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function EditGuidanceCampaign() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/guidance-campaigns/:id");
  const campaignId = params?.id;
  const isNewCampaign = campaignId === "new";

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    isActive: "true",
    showHeader: "false",
  });
  
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingRule, setDeletingRule] = useState<ProactiveGuidanceRule | null>(null);

  const { data: campaignData, isLoading } = useQuery<GuidanceCampaign & { rules?: ProactiveGuidanceRule[] }>({
    queryKey: [`/api/guidance-campaigns/${campaignId}`],
    enabled: !isNewCampaign && !!campaignId,
  });
  
  const campaign = campaignData;
  const rules = campaignData?.rules || [];

  useEffect(() => {
    if (campaign) {
      setFormData({
        name: campaign.name,
        description: campaign.description || "",
        isActive: campaign.isActive,
        showHeader: campaign.showHeader || "false",
      });
    }
  }, [campaign]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/guidance-campaigns", data);
    },
    onSuccess: (result: GuidanceCampaign) => {
      queryClient.invalidateQueries({ queryKey: ["/api/guidance-campaigns"] });
      toast({
        title: "Campaign created",
        description: "Guidance campaign has been created successfully.",
      });
      navigate(`/guidance-campaigns/${result.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("PUT", `/api/guidance-campaigns/${campaignId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guidance-campaigns"] });
      queryClient.invalidateQueries({ queryKey: [`/api/guidance-campaigns/${campaignId}`] });
      toast({
        title: "Campaign updated",
        description: "Guidance campaign has been updated successfully.",
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

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/proactive-guidance-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/guidance-campaigns/${campaignId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/proactive-guidance-rules"] });
      setIsDeleteDialogOpen(false);
      setDeletingRule(null);
      toast({
        title: "Rule deleted",
        description: "Guidance rule has been deleted.",
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isNewCampaign) {
      createMutation.mutate(formData);
    } else {
      updateMutation.mutate(formData);
    }
  };

  const handleDeleteRule = (rule: ProactiveGuidanceRule) => {
    setDeletingRule(rule);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteRule = () => {
    if (deletingRule) {
      deleteRuleMutation.mutate(deletingRule.id);
    }
  };

  if (!isNewCampaign && isLoading) {
    return (
      <div className="container mx-auto py-8 space-y-6 max-w-4xl px-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-[500px] w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto py-8 space-y-8 max-w-4xl px-6">
        
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/guidance-campaigns")}
              className="mt-1 hover:bg-primary/10 rounded-xl"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-400 to-violet-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {isNewCampaign ? "Create Campaign" : "Edit Campaign"}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {isNewCampaign ? "Set up a new guidance campaign" : "Configure campaign settings and manage rules"}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {!isNewCampaign && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => navigate(`/guidance-campaigns/${campaignId}/settings`)}
              className="rounded-xl hover:bg-muted/50"
            >
              <Settings className="w-5 h-5" />
            </Button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          
          <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
            <CardContent className="p-6 space-y-6">
              
              <div className="flex items-center gap-2 pb-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Campaign Details</span>
              </div>
              
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Campaign Name
                  </Label>
                  <Input
                    id="name"
                    placeholder="e.g., Checkout Flow, Product Pages"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="h-11 rounded-xl border-muted-foreground/20 focus:border-primary/50 transition-colors"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Description (Optional)
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Describe the purpose of this campaign..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="rounded-xl border-muted-foreground/20 focus:border-primary/50 transition-colors resize-none"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
            <CardContent className="p-0">
              <label 
                htmlFor="isActive"
                className="flex items-center justify-between p-5 cursor-pointer hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                    formData.isActive === "true" 
                      ? "bg-emerald-500/10 text-emerald-600" 
                      : "bg-muted text-muted-foreground"
                  }`}>
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-sm font-medium block">Active</span>
                    <span className="text-xs text-muted-foreground">
                      {formData.isActive === "true" ? "This campaign is currently live" : "Enable to make this campaign live"}
                    </span>
                  </div>
                </div>
                <Switch
                  id="isActive"
                  checked={formData.isActive === "true"}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked ? "true" : "false" })}
                />
              </label>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between pt-2">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={() => navigate("/guidance-campaigns")}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending || updateMutation.isPending}
              className="rounded-xl px-6 h-11 shadow-lg shadow-primary/20"
            >
              <Save className="w-4 h-4 mr-2" />
              {isNewCampaign ? "Create Campaign" : "Save Changes"}
            </Button>
          </div>
        </form>

        {!isNewCampaign && (
          <>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Guidance Rules</h2>
                  <p className="text-sm text-muted-foreground">Rules that belong to this campaign</p>
                </div>
                <Button 
                  onClick={() => navigate(`/proactive-guidance/new?campaignId=${campaignId}`)}
                  variant="outline"
                  className="rounded-xl"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Rule
                </Button>
              </div>

              {rules && rules.length > 0 ? (
                <div className="space-y-3">
                  {rules.map((rule) => (
                    <Card 
                      key={rule.id} 
                      className={`border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden transition-all hover:shadow-xl ${
                        rule.isActive === "true" ? "" : "opacity-60"
                      }`}
                    >
                      <CardContent className="p-0">
                        <div className="flex items-stretch">
                          <div 
                            className={`w-1.5 ${
                              rule.isActive === "true" 
                                ? "bg-gradient-to-b from-emerald-400 to-emerald-600" 
                                : "bg-muted-foreground/30"
                            }`}
                          />
                          
                          <div className="flex-1 p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 mb-2">
                                  <h3 className="font-semibold text-sm">{rule.name}</h3>
                                </div>
                                
                                <div className="flex items-center gap-2 mb-2">
                                  <Link2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                  <code className="text-xs bg-muted/80 px-2 py-0.5 rounded-lg font-mono text-muted-foreground truncate max-w-md">
                                    {rule.urlPattern}
                                  </code>
                                </div>
                                
                                <div className="flex items-start gap-2">
                                  <MessageSquareText className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                                  <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">
                                    {rule.message}
                                  </p>
                                </div>
                              </div>
                              
                              <div className="flex gap-1 flex-shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-xl hover:bg-primary/10"
                                  onClick={() => navigate(`/proactive-guidance/${rule.id}`)}
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-xl hover:bg-destructive/10"
                                  onClick={() => handleDeleteRule(rule)}
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
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
                  <CardContent className="py-12">
                    <div className="text-center">
                      <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                        <Sparkles className="w-6 h-6 text-muted-foreground/50" />
                      </div>
                      <h3 className="font-semibold text-sm mb-1">No rules yet</h3>
                      <p className="text-xs text-muted-foreground mb-4">
                        Add guidance rules to this campaign
                      </p>
                      <Button 
                        onClick={() => navigate(`/proactive-guidance/new?campaignId=${campaignId}`)}
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add First Rule
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}

        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent className="rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Rule</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{deletingRule?.name}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={confirmDeleteRule} 
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
