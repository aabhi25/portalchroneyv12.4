import { useLocation } from "wouter";
import MoreFeaturesNavTabs from "@/components/MoreFeaturesNavTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Timer, 
  Clock, 
  Sparkles, 
  ArrowRight,
  Smartphone,
  ChevronRight,
} from "lucide-react";

interface UrgencyOfferCampaign {
  id: string;
  isEnabled: boolean;
  name: string;
}

interface ExitIntentSettings {
  isEnabled: boolean;
}

interface IdleTimeoutSettings {
  isEnabled: boolean;
}

export default function SmartDiscountsHub() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: urgencyCampaigns } = useQuery<UrgencyOfferCampaign[]>({
    queryKey: ["/api/urgency-offer-settings"],
  });

  const { data: exitIntentSettings } = useQuery<ExitIntentSettings>({
    queryKey: ["/api/exit-intent-settings"],
  });

  const { data: idleTimeoutSettings } = useQuery<IdleTimeoutSettings>({
    queryKey: ["/api/idle-timeout-settings"],
  });

  const updateUrgencyMutation = useMutation({
    mutationFn: async (isEnabled: boolean) => {
      if (!urgencyCampaigns || urgencyCampaigns.length === 0) return;
      await Promise.all(
        urgencyCampaigns.map(c => 
          apiRequest("PUT", `/api/urgency-offer-settings/${c.id}`, { isEnabled })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/urgency-offer-settings"] });
      toast({ title: "Success", description: "Urgency offers setting updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update setting", variant: "destructive" });
    },
  });

  const updateExitIntentMutation = useMutation({
    mutationFn: async (isEnabled: boolean) => {
      return await apiRequest("PUT", "/api/exit-intent-settings", { isEnabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exit-intent-settings"] });
      toast({ title: "Success", description: "Exit intent setting updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update setting", variant: "destructive" });
    },
  });

  const updateIdleTimeoutMutation = useMutation({
    mutationFn: async (isEnabled: boolean) => {
      return await apiRequest("PUT", "/api/idle-timeout-settings", { isEnabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/idle-timeout-settings"] });
      toast({ title: "Success", description: "Idle timeout setting updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update setting", variant: "destructive" });
    },
  });

  const discountModes = [
    {
      id: "urgency-offers",
      title: "AI Urgency Offers",
      description: "AI detects purchase intent and shows time-limited discount with countdown timer",
      icon: Timer,
      color: "bg-purple-500",
      lightColor: "bg-purple-50",
      borderColor: "border-purple-200",
      path: "/admin/smart-discounts/urgency-offers",
      isEnabled: urgencyCampaigns?.some(c => c.isEnabled) || false,
      onToggle: (checked: boolean) => updateUrgencyMutation.mutate(checked),
      features: ["AI Intent Detection", "Countdown Timer", "WhatsApp Capture"],
    },
    {
      id: "exit-intent",
      title: "Exit Intent Discounts",
      description: "Trigger discounts when visitors show signs of leaving your site",
      icon: ArrowRight,
      color: "bg-orange-500",
      lightColor: "bg-orange-50",
      borderColor: "border-orange-200",
      path: "/admin/smart-discounts/exit-intent",
      isEnabled: exitIntentSettings?.isEnabled || false,
      onToggle: (checked: boolean) => updateExitIntentMutation.mutate(checked),
      features: ["Mouse Movement Detection", "Custom Messages", "Cooldown Control"],
    },
    {
      id: "idle-timeout",
      title: "Idle Timeout Nudges",
      description: "Re-engage visitors who have been inactive for a period of time",
      icon: Clock,
      color: "bg-blue-500",
      lightColor: "bg-blue-50",
      borderColor: "border-blue-200",
      path: "/admin/smart-discounts/idle-timeout",
      isEnabled: idleTimeoutSettings?.isEnabled || false,
      onToggle: (checked: boolean) => updateIdleTimeoutMutation.mutate(checked),
      features: ["Configurable Timeout", "Cart Detection", "Personalized Offers"],
    },
  ];

  return (
    <div>
      <MoreFeaturesNavTabs />
      <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-purple-100">
          <Sparkles className="w-6 h-6 text-purple-600" />
        </div>
        <h1 className="text-3xl font-bold">Smart Discounts</h1>
      </div>
      <p className="text-muted-foreground mb-8">
        Trigger personalized discount offers based on visitor behavior to boost conversions
      </p>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {discountModes.map((mode) => {
          const Icon = mode.icon;
          return (
            <Card 
              key={mode.id}
              className={`relative overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] ${mode.borderColor} border-2`}
              onClick={() => setLocation(mode.path)}
            >
              <div className={`absolute top-0 left-0 right-0 h-1 ${mode.color}`} />
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className={`p-3 rounded-xl ${mode.lightColor}`}>
                    <Icon className={`w-6 h-6 ${mode.color.replace('bg-', 'text-')}`} />
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Badge variant={mode.isEnabled ? "default" : "secondary"}>
                      {mode.isEnabled ? "Active" : "Inactive"}
                    </Badge>
                    <Switch
                      checked={mode.isEnabled}
                      onCheckedChange={mode.onToggle}
                    />
                  </div>
                </div>
                <CardTitle className="text-xl mt-4">{mode.title}</CardTitle>
                <CardDescription className="text-sm">
                  {mode.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  {mode.features.map((feature, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center text-sm text-purple-600 font-medium">
                  Configure settings
                  <ChevronRight className="w-4 h-4 ml-1" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-12">
        <h2 className="text-xl font-semibold mb-4">How Smart Discounts Work</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
            <div className="p-2 rounded-full bg-purple-100">
              <span className="text-purple-600 font-bold text-sm">1</span>
            </div>
            <div>
              <h3 className="font-medium">Detect Behavior</h3>
              <p className="text-sm text-muted-foreground">AI analyzes visitor actions to identify purchase intent</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
            <div className="p-2 rounded-full bg-purple-100">
              <span className="text-purple-600 font-bold text-sm">2</span>
            </div>
            <div>
              <h3 className="font-medium">Trigger Offer</h3>
              <p className="text-sm text-muted-foreground">Show personalized discount at the right moment</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
            <div className="p-2 rounded-full bg-purple-100">
              <span className="text-purple-600 font-bold text-sm">3</span>
            </div>
            <div>
              <h3 className="font-medium">Capture Lead</h3>
              <p className="text-sm text-muted-foreground">Collect contact info for follow-up marketing</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
