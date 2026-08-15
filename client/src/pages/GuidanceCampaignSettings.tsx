import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Settings, PanelTop, Code, Copy, Check, Save, Maximize2, Minimize2, Mic } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface GuidanceCampaign {
  id: string;
  businessAccountId: string;
  name: string;
  description: string | null;
  isActive: string;
  showHeader: string;
  widgetSize: string;
  voiceModeEnabled: string;
  voiceModePosition: string;
  createdAt: string;
  updatedAt: string;
}

interface WidgetSettings {
  voiceModeEnabled?: boolean;
}

export default function GuidanceCampaignSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/guidance-campaigns/:id/settings");
  const campaignId = params?.id;

  const [formData, setFormData] = useState({
    showHeader: "false",
    widgetSize: "half",
    voiceModeEnabled: "false",
    voiceModePosition: "in-chat",
  });
  
  const [embedCopied, setEmbedCopied] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: campaign, isLoading } = useQuery<GuidanceCampaign>({
    queryKey: [`/api/guidance-campaigns/${campaignId}`],
    enabled: !!campaignId,
  });
  
  // Query widget settings to check if voice mode is available for this business
  const { data: widgetSettings } = useQuery<WidgetSettings>({
    queryKey: [`/api/widget-settings?businessAccountId=${campaign?.businessAccountId}`],
    enabled: !!campaign?.businessAccountId,
  });
  
  const isVoiceModeAvailable = widgetSettings?.voiceModeEnabled === true || widgetSettings?.voiceModeEnabled === 'true';
  
  const hiChroneyDomain = 'https://portal.aichroney.com';
  
  const campaignEmbedCode = useMemo(() => {
    if (!campaign?.businessAccountId) return '';
    
    return `<!-- Guidance Chatbot Widget - ${campaign.name || ''} -->
<script src="${hiChroneyDomain}/guidance-widget.js" data-business-id="${campaign.businessAccountId}" data-campaign-id="${campaignId}"></script>`;
  }, [campaign?.businessAccountId, campaign?.name, campaignId]);

  useEffect(() => {
    if (campaign) {
      setFormData({
        showHeader: campaign.showHeader || "false",
        widgetSize: campaign.widgetSize || "half",
        voiceModeEnabled: campaign.voiceModeEnabled || "false",
        voiceModePosition: campaign.voiceModePosition || "in-chat",
      });
    }
  }, [campaign]);

  const updateMutation = useMutation({
    mutationFn: async (data: { showHeader: string; widgetSize: string; voiceModeEnabled: string; voiceModePosition: string }) => {
      return apiRequest("PUT", `/api/guidance-campaigns/${campaignId}`, {
        name: campaign?.name,
        description: campaign?.description,
        isActive: campaign?.isActive,
        showHeader: data.showHeader,
        widgetSize: data.widgetSize,
        voiceModeEnabled: data.voiceModeEnabled,
        voiceModePosition: data.voiceModePosition,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/guidance-campaigns/${campaignId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/guidance-campaigns"] });
      setHasChanges(false);
      toast({
        title: "Settings saved",
        description: "Campaign settings have been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  const handleCopyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(campaignEmbedCode);
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2000);
      toast({
        title: "Copied!",
        description: "Embed code copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Unable to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleToggleShowHeader = (checked: boolean) => {
    setFormData({ ...formData, showHeader: checked ? "true" : "false" });
    setHasChanges(true);
  };

  const handleWidgetSizeChange = (size: "full" | "half") => {
    setFormData({ ...formData, widgetSize: size });
    setHasChanges(true);
  };

  const handleToggleVoiceMode = (checked: boolean) => {
    setFormData({ ...formData, voiceModeEnabled: checked ? "true" : "false" });
    setHasChanges(true);
  };

  const handleVoiceModePositionChange = (position: string) => {
    setFormData({ ...formData, voiceModePosition: position });
    setHasChanges(true);
  };

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="container max-w-3xl mx-auto py-8 px-4 space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="container max-w-3xl mx-auto py-8 px-4">
        <p className="text-muted-foreground">Campaign not found</p>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/guidance-campaigns/${campaignId}`)}
            className="mt-1 hover:bg-primary/10 rounded-xl"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center shadow-lg">
                <Settings className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Campaign Settings
                </h1>
                <p className="text-sm text-muted-foreground">
                  {campaign.name}
                </p>
              </div>
            </div>
          </div>
        </div>
        
        {hasChanges && (
          <Button 
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="rounded-xl px-6 h-11 shadow-lg shadow-primary/20"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        )}
      </div>

      <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center gap-2 pb-2">
            <PanelTop className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Widget Appearance</span>
          </div>
          
          <label 
            htmlFor="showHeader"
            className="flex items-center justify-between p-4 rounded-xl border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                formData.showHeader === "true" 
                  ? "bg-blue-500/10 text-blue-600" 
                  : "bg-muted text-muted-foreground"
              }`}>
                <PanelTop className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-medium block">Show Header</span>
                <span className="text-xs text-muted-foreground">
                  {formData.showHeader === "true" ? "Displays header with avatar and title" : "Shows minimal floating close button"}
                </span>
              </div>
            </div>
            <Switch
              id="showHeader"
              checked={formData.showHeader === "true"}
              onCheckedChange={handleToggleShowHeader}
            />
          </label>
          
          <div className="space-y-3">
            <div className="flex items-center gap-3 px-1">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-purple-500/10 text-purple-600">
                <Maximize2 className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-medium block">Widget Size</span>
                <span className="text-xs text-muted-foreground">Choose how tall the widget appears</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleWidgetSizeChange("half")}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  formData.widgetSize === "half"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Minimize2 className="w-4 h-4" />
                  <span className="font-medium text-sm">Half Screen</span>
                </div>
                <p className="text-xs text-muted-foreground">600px fixed height, floating position</p>
              </button>
              <button
                type="button"
                onClick={() => handleWidgetSizeChange("full")}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  formData.widgetSize === "full"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Maximize2 className="w-4 h-4" />
                  <span className="font-medium text-sm">Full Screen</span>
                </div>
                <p className="text-xs text-muted-foreground">Full viewport height, right side panel</p>
              </button>
            </div>
          </div>
          
          {/* Voice Mode Toggle - Only show if voice mode is available for this business */}
          {isVoiceModeAvailable && (
            <div className="space-y-4">
              <label 
                htmlFor="voiceModeEnabled"
                className="flex items-center justify-between p-4 rounded-xl border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                    formData.voiceModeEnabled === "true" 
                      ? "bg-green-500/10 text-green-600" 
                      : "bg-muted text-muted-foreground"
                  }`}>
                    <Mic className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-sm font-medium block">Voice Mode</span>
                    <span className="text-xs text-muted-foreground">
                      {formData.voiceModeEnabled === "true" 
                        ? "Users can speak to the AI assistant" 
                        : "Text-only conversation mode"}
                    </span>
                  </div>
                </div>
                <Switch
                  id="voiceModeEnabled"
                  checked={formData.voiceModeEnabled === "true"}
                  onCheckedChange={handleToggleVoiceMode}
                />
              </label>
              
              {/* Voice Mode Position Selector - Only show when voice mode is enabled */}
              {formData.voiceModeEnabled === "true" && (
                <div className="pl-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Voice Button Position</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "in-chat", label: "In Chat", desc: "Header button" },
                      { value: "bottom-right", label: "Bottom Right", desc: "Corner orb" },
                      { value: "bottom-left", label: "Bottom Left", desc: "Corner orb" },
                      { value: "top-right", label: "Top Right", desc: "Corner orb" },
                      { value: "top-left", label: "Top Left", desc: "Corner orb" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleVoiceModePositionChange(option.value)}
                        className={`p-3 rounded-lg border-2 transition-all text-left ${
                          formData.voiceModePosition === option.value
                            ? "border-primary bg-primary/5"
                            : "border-muted hover:border-muted-foreground/30"
                        }`}
                      >
                        <span className="text-xs font-medium block">{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2 pb-2">
            <Code className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Embed Code</span>
          </div>
          
          <p className="text-sm text-muted-foreground">
            Use this embed code to show only the rules from this campaign on your website.
          </p>
          
          <div className="bg-muted/50 border rounded-xl p-4 overflow-x-auto">
            <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
              {campaignEmbedCode}
            </pre>
          </div>
          
          <Button
            onClick={handleCopyEmbed}
            className="w-full rounded-xl"
            type="button"
            disabled={!campaignEmbedCode}
          >
            {embedCopied ? (
              <>
                <Check className="w-4 h-4 mr-2 text-green-400" />
                Copied to Clipboard
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" />
                Copy Embed Code
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
