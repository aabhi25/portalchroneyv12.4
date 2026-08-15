import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, ArrowLeft, Clock, ShoppingCart } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";

interface IdleTimeoutSettingsData {
  id?: string;
  isEnabled: boolean;
  idleTimeoutSeconds: number;
  requireCartItems: boolean;
  discountPercentage: number;
  discountMessage: string;
  cooldownMinutes: number;
  expiryMinutes: number;
  maxUsesPerVisitor: number;
}

export default function IdleTimeoutSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [form, setForm] = useState<IdleTimeoutSettingsData>({
    isEnabled: false,
    idleTimeoutSeconds: 120,
    requireCartItems: false,
    discountPercentage: 10,
    discountMessage: "Still browsing? Here's {discount}% off to help you decide!",
    cooldownMinutes: 1440,
    expiryMinutes: 60,
    maxUsesPerVisitor: 1,
  });

  const { data: settings, isLoading } = useQuery<IdleTimeoutSettingsData>({
    queryKey: ["/api/idle-timeout-settings"],
  });

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<IdleTimeoutSettingsData>) => {
      return await apiRequest("PUT", "/api/idle-timeout-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/idle-timeout-settings"] });
      toast({ title: "Success", description: "Idle timeout settings saved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save settings", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <Button variant="ghost" onClick={() => setLocation("/admin/smart-discounts")} className="mb-6">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Smart Discounts
      </Button>

      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
          <Clock className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Idle Timeout Nudges</h1>
          <p className="text-muted-foreground">Re-engage visitors who have been inactive</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Enable Idle Timeout</CardTitle>
              <CardDescription>Show discount offers to inactive visitors</CardDescription>
            </div>
            <Switch
              checked={form.isEnabled}
              onCheckedChange={(checked) => {
                setForm({ ...form, isEnabled: checked });
                updateMutation.mutate({ isEnabled: checked });
              }}
            />
          </div>
        </CardHeader>
        
        {form.isEnabled && (
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Idle Timeout: {form.idleTimeoutSeconds} seconds</Label>
              <Slider
                value={[form.idleTimeoutSeconds]}
                onValueChange={([value]) => setForm({ ...form, idleTimeoutSeconds: value })}
                min={30}
                max={300}
                step={30}
              />
              <p className="text-xs text-muted-foreground">
                How long to wait before showing the discount
              </p>
            </div>

            <div className="flex items-center justify-between py-3 px-4 border rounded-lg">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                <div>
                  <Label>Require Cart Items</Label>
                  <p className="text-xs text-muted-foreground">Only show if visitor has items in cart</p>
                </div>
              </div>
              <Switch
                checked={form.requireCartItems}
                onCheckedChange={(checked) => setForm({ ...form, requireCartItems: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label>Discount Percentage: {form.discountPercentage}%</Label>
              <Slider
                value={[form.discountPercentage]}
                onValueChange={([value]) => setForm({ ...form, discountPercentage: value })}
                min={5}
                max={50}
                step={5}
              />
            </div>

            <div className="space-y-2">
              <Label>Discount Message</Label>
              <Textarea
                value={form.discountMessage}
                onChange={(e) => setForm({ ...form, discountMessage: e.target.value })}
                placeholder="Use {discount} as placeholder for the discount percentage"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Use {'{discount}'} to insert the discount percentage
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cooldown (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  max={10080}
                  value={form.cooldownMinutes}
                  onChange={(e) => setForm({ ...form, cooldownMinutes: parseInt(e.target.value) || 1440 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Offer Expiry (minutes)</Label>
                <Input
                  type="number"
                  min={5}
                  max={1440}
                  value={form.expiryMinutes}
                  onChange={(e) => setForm({ ...form, expiryMinutes: parseInt(e.target.value) || 60 })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Max Uses Per Visitor</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={form.maxUsesPerVisitor}
                onChange={(e) => setForm({ ...form, maxUsesPerVisitor: parseInt(e.target.value) || 1 })}
              />
            </div>

            <Button
              onClick={() => updateMutation.mutate(form)}
              disabled={updateMutation.isPending}
              className="w-full"
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
